import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as fs from 'node:fs';

vi.mock('../src/modules/embedding/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/embedding/index.js')>();
  return { ...actual, embed: vi.fn().mockResolvedValue(new Array(8).fill(0.1)), checkEmbeddingHealth: vi.fn().mockResolvedValue(false) };
});

let registerMemoryRoutes: (app: FastifyInstance) => Promise<void>;
let registerSearchRoutes: (app: FastifyInstance) => Promise<void>;
let getTable: typeof import('../src/db/lancedb.js').getTable;
let resetConnection: () => void;
let fromRow: typeof import('../src/db/schema.js').fromRow;
let toRow: typeof import('../src/db/schema.js').toRow;

beforeAll(async () => {
  ({ registerMemoryRoutes } = await import('../src/modules/memory/index.js'));
  ({ registerSearchRoutes } = await import('../src/modules/search/index.js'));
  ({ getTable, resetConnection } = await import('../src/db/lancedb.js'));
  ({ fromRow, toRow } = await import('../src/db/schema.js'));
});

afterEach(() => {
  resetConnection();
  fs.rmSync(process.env.MEMORYDOCK_INDEX_PATH!, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

async function seed(app: FastifyInstance, title: string, createdAt: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/memories', payload: { title, content: `shared ${title}`, content_type: 'note' } });
  expect(response.statusCode).toBe(201);
  const id = response.json().data.id as string;
  const table = await getTable();
  const row = (await table.query().where(`id = '${id}'`).limit(1).toArray())[0];
  const entry = fromRow(row);
  await table.delete(`id = '${id}'`);
  await table.add([toRow({ ...entry, created_at: createdAt })]);
  return id;
}

describe('memory creation order', () => {
  it('sorts the full filtered list before pagination and keeps equal timestamps stable', async () => {
    const app = Fastify({ logger: false });
    await registerMemoryRoutes(app);
    const oldest = await seed(app, 'oldest', '2024-01-01T00:00:00.000Z');
    const newestB = await seed(app, 'newest-b', '2026-01-01T00:00:00.000Z');
    const middle = await seed(app, 'middle', '2025-01-01T00:00:00.000Z');
    const newestA = await seed(app, 'newest-a', '2026-01-01T00:00:00.000Z');
    const expected = [newestA, newestB].sort().concat(middle, oldest);

    const first = (await app.inject({ method: 'GET', url: '/api/memories?page=1&page_size=2' })).json().data;
    const second = (await app.inject({ method: 'GET', url: '/api/memories?page=2&page_size=2' })).json().data;
    expect(first.total).toBe(4);
    expect([...first.items, ...second.items].map((item: { id: string }) => item.id)).toEqual(expected);
    await app.close();
  });

  it('sorts the list by title or updated time when requested', async () => {
    const app = Fastify({ logger: false });
    await registerMemoryRoutes(app);
    await seed(app, 'bravo', '2024-01-01T00:00:00.000Z');
    await seed(app, 'alpha', '2026-01-01T00:00:00.000Z');
    await seed(app, 'charlie', '2025-01-01T00:00:00.000Z');

    const byTitle = (await app.inject({ method: 'GET', url: '/api/memories?sort_by=title&sort_order=asc' })).json().data;
    expect(byTitle.items.map((item: { title: string }) => item.title)).toEqual(['alpha', 'bravo', 'charlie']);

    const byCreatedAsc = (await app.inject({ method: 'GET', url: '/api/memories?sort_by=created_at&sort_order=asc' })).json().data;
    expect(byCreatedAsc.items.map((item: { title: string }) => item.title)).toEqual(['bravo', 'charlie', 'alpha']);

    const invalidField = (await app.inject({ method: 'GET', url: '/api/memories?sort_by=nonsense' })).json().data;
    expect(invalidField.items.map((item: { title: string }) => item.title)).toEqual(['alpha', 'charlie', 'bravo']);
    await app.close();
  });

  it('returns keyword search results in creation order when requested', async () => {
    const app = Fastify({ logger: false });
    await registerMemoryRoutes(app);
    await registerSearchRoutes(app);
    const oldest = await seed(app, 'oldest', '2024-01-01T00:00:00.000Z');
    const newest = await seed(app, 'newest', '2026-01-01T00:00:00.000Z');
    const middle = await seed(app, 'middle', '2025-01-01T00:00:00.000Z');

    const response = await app.inject({ method: 'POST', url: '/api/search', payload: { query: 'shared', top_k: 3, sort_by: 'created_at' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items.map((item: { entry: { id: string } }) => item.entry.id)).toEqual([newest, middle, oldest]);
    await app.close();
  });
});
