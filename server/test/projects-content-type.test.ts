import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as fs from 'node:fs';

vi.mock('../src/modules/embedding/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/embedding/index.js')>();
  return { ...actual, embed: vi.fn() };
});

let registerMemoryRoutes: (app: FastifyInstance) => Promise<void>;
let registerProjectRoutes: (app: FastifyInstance) => Promise<void>;
let resetConnection: () => void;
let embedMock: ReturnType<typeof vi.fn>;

const vec8 = () => new Array(8).fill(0.1);

beforeAll(async () => {
  const memory = await import('../src/modules/memory/index.js');
  registerMemoryRoutes = memory.registerMemoryRoutes;
  const project = await import('../src/modules/project/index.js');
  registerProjectRoutes = project.registerProjectRoutes;
  const db = await import('../src/db/lancedb.js');
  resetConnection = db.resetConnection;
  const emb = await import('../src/modules/embedding/index.js');
  embedMock = vi.mocked(emb.embed);
});

afterEach(() => {
  resetConnection();
  embedMock.mockReset();
  // Tests in this file reuse titles, so the index must be cleared between them.
  fs.rmSync(process.env.MEMORYDOCK_INDEX_PATH!, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerMemoryRoutes(app);
  await registerProjectRoutes(app);
  return app;
}

/** Seed data via a memory entry POST (content_type validation goes through the real schema) */
async function seedEntry(app: FastifyInstance, title: string, contentType: string, status = 'active') {
  embedMock.mockResolvedValue(vec8());
  const res = await app.inject({
    method: 'POST',
    url: '/api/memories',
    payload: { title, content: `内容-${title}`, content_type: contentType, status },
  });
  expect(res.statusCode).toBe(201);
}

async function listProjects(app: FastifyInstance, query = '') {
  const res = await app.inject({ method: 'GET', url: `/api/projects${query}` });
  expect(res.statusCode).toBe(200);
  return res.json().data as {
    items: Array<{ id: string; name: string }>;
    page?: number;
    page_size?: number;
    total?: number;
  };
}

describe('GET /api/projects — content_type filter', () => {
  it('content_type=project returns only project-type entries', async () => {
    const app = await buildApp();
    await seedEntry(app, 'ProjA', 'project');
    await seedEntry(app, 'ProjB', 'project');
    await seedEntry(app, 'NoteC', 'note');

    const data = await listProjects(app, '?content_type=project');
    const names = data.items.map(i => i.name);
    expect(names).toContain('ProjA');
    expect(names).toContain('ProjB');
    expect(names).not.toContain('NoteC');
  });

  it('content_type=note returns only note-type entries', async () => {
    const app = await buildApp();
    await seedEntry(app, 'ProjA', 'project');
    await seedEntry(app, 'NoteC', 'note');
    await seedEntry(app, 'NoteD', 'note');

    const data = await listProjects(app, '?content_type=note');
    const names = data.items.map(i => i.name);
    expect(names).not.toContain('ProjA');
    expect(names).toContain('NoteC');
    expect(names).toContain('NoteD');
  });

  it('omitting content_type returns all types (backward compatible)', async () => {
    const app = await buildApp();
    await seedEntry(app, 'ProjA', 'project');
    await seedEntry(app, 'NoteC', 'note');
    await seedEntry(app, 'DocE', 'doc');

    const data = await listProjects(app);
    const names = data.items.map(i => i.name);
    expect(names).toEqual(expect.arrayContaining(['ProjA', 'NoteC', 'DocE']));
    expect(data.total).toBe(3);
  });

  it('an invalid content_type is silently ignored, all entries returned', async () => {
    const app = await buildApp();
    await seedEntry(app, 'ProjA', 'project');
    await seedEntry(app, 'NoteC', 'note');

    const data = await listProjects(app, '?content_type=not-a-real-type');
    expect(data.total).toBe(2);
  });
});

describe('GET /api/projects — pagination', () => {
  it('with explicit page_size=20, page=2 returns the remaining entries', async () => {
    const app = await buildApp();
    for (let i = 0; i < 25; i++) {
      await seedEntry(app, `条目-${String(i).padStart(2, '0')}`, i % 2 === 0 ? 'project' : 'note');
    }

    const page1 = await listProjects(app, '?page=1&page_size=20');
    expect(page1.items.length).toBe(20);
    expect(page1.total).toBe(25);
    expect(page1.page).toBe(1);
    expect(page1.page_size).toBe(20);

    const page2 = await listProjects(app, '?page=2&page_size=20');
    expect(page2.items.length).toBe(5);
    expect(page2.total).toBe(25);

    // ids across the two pages do not overlap
    const ids = new Set([...page1.items, ...page2.items].map(i => i.id));
    expect(ids.size).toBe(25);
  });

  it('omitting pagination params returns all entries (backward compatible with callers like MCP list_projects)', async () => {
    const app = await buildApp();
    for (let i = 0; i < 25; i++) {
      await seedEntry(app, `条目-${String(i).padStart(2, '0')}`, i % 2 === 0 ? 'project' : 'note');
    }

    const data = await listProjects(app);
    expect(data.items.length).toBe(25);
    expect(data.total).toBe(25);
    expect(data.page).toBe(1);
    expect(data.page_size).toBe(25); // when unpaginated, page_size holds the actual entry count
  });

  it('page_size above the limit of 100 is truncated to 100', async () => {
    const app = await buildApp();
    await seedEntry(app, 'ProjA', 'project');

    const data = await listProjects(app, '?page_size=200');
    expect(data.page_size).toBe(100);
    expect(data.items.length).toBe(1);
    expect(data.total).toBe(1);
  });

  it('content_type filtering works together with pagination', async () => {
    const app = await buildApp();
    for (let i = 0; i < 5; i++) {
      await seedEntry(app, `Note-${i}`, 'note');
    }
    await seedEntry(app, 'ProjOnly', 'project');

    const data = await listProjects(app, '?content_type=project&page=1&page_size=20');
    expect(data.total).toBe(1);
    expect(data.items.map(i => i.name)).toEqual(['ProjOnly']);
  });
});

describe('GET /api/projects — status filter', () => {
  it('status=active returns only active entries', async () => {
    const app = await buildApp();
    await seedEntry(app, '在用项目A', 'project', 'active');
    await seedEntry(app, '归档项目B', 'project', 'archived');
    await seedEntry(app, '在用笔记C', 'note', 'active');

    const data = await listProjects(app, '?status=active');
    const names = data.items.map(i => i.name);
    expect(names).toContain('在用项目A');
    expect(names).toContain('在用笔记C');
    expect(names).not.toContain('归档项目B');
  });

  it('status=archived returns only archived entries', async () => {
    const app = await buildApp();
    await seedEntry(app, '在用项目A', 'project', 'active');
    await seedEntry(app, '归档项目B', 'project', 'archived');

    const data = await listProjects(app, '?status=archived');
    expect(data.items.map(i => i.name)).toEqual(['归档项目B']);
  });

  it('omitting status returns all entries (archived + active, backward compatible)', async () => {
    const app = await buildApp();
    await seedEntry(app, '在用项目A', 'project', 'active');
    await seedEntry(app, '归档项目B', 'project', 'archived');

    const data = await listProjects(app);
    const names = data.items.map(i => i.name);
    expect(names).toEqual(expect.arrayContaining(['在用项目A', '归档项目B']));
    expect(data.total).toBe(2);
  });

  it('an invalid status is silently ignored, all entries returned', async () => {
    const app = await buildApp();
    await seedEntry(app, '在用项目A', 'project', 'active');
    await seedEntry(app, '归档项目B', 'project', 'archived');

    const data = await listProjects(app, '?status=deleted');
    expect(data.total).toBe(2);
  });
});
