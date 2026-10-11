import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../src/modules/embedding/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/embedding/index.js')>();
  return { ...actual, embed: vi.fn() };
});

let registerMemoryRoutes: (app: FastifyInstance) => Promise<void>;
let registerIngestRoutes: (app: FastifyInstance) => Promise<void>;
let getTable: typeof import('../src/db/lancedb.js')['getTable'];
let resetConnection: () => void;
let embedMock: ReturnType<typeof vi.fn>;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const vec8 = () => new Array(8).fill(0.1);

beforeAll(async () => {
  const memory = await import('../src/modules/memory/index.js');
  registerMemoryRoutes = memory.registerMemoryRoutes;
  const ingest = await import('../src/modules/ingest/index.js');
  registerIngestRoutes = ingest.registerIngestRoutes;
  const db = await import('../src/db/lancedb.js');
  getTable = db.getTable;
  resetConnection = db.resetConnection;
  const emb = await import('../src/modules/embedding/index.js');
  embedMock = vi.mocked(emb.embed);
});

afterEach(() => {
  resetConnection();
  embedMock.mockReset();
});

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerMemoryRoutes(app);
  await registerIngestRoutes(app);
  return app;
}

async function countByTitle(title: string): Promise<number> {
  const table = await getTable();
  const rows = await table.query().where(`title = '${title}'`).toArray();
  return rows.length;
}

describe('concurrent create dedup race', () => {
  it('two concurrent POST /api/memories with the same title: one 201 and one 409, only 1 row', async () => {
    const app = await buildApp();
    embedMock.mockImplementation(async () => {
      await sleep(30);
      return vec8();
    });

    const payload = { title: '竞态-知识创建', content: '内容', content_type: 'note' };
    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/memories', payload }),
      app.inject({ method: 'POST', url: '/api/memories', payload }),
    ]);

    expect([r1.statusCode, r2.statusCode].sort()).toEqual([201, 409]);
    expect(await countByTitle('竞态-知识创建')).toBe(1);
  });

  it('two concurrent POST /api/memories?overwrite=true: only 1 row remains', async () => {
    const app = await buildApp();
    embedMock.mockImplementation(async () => {
      await sleep(30);
      return vec8();
    });

    const payload = { title: '竞态-知识覆盖', content: '内容', content_type: 'note' };
    await Promise.all([
      app.inject({ method: 'POST', url: '/api/memories?overwrite=true', payload }),
      app.inject({ method: 'POST', url: '/api/memories?overwrite=true', payload }),
    ]);

    expect(await countByTitle('竞态-知识覆盖')).toBe(1);
  });

  it('two concurrent POST /api/ingest with the same title: one 201 and one 409, only 1 row', async () => {
    const app = await buildApp();
    embedMock.mockImplementation(async () => {
      await sleep(30);
      return vec8();
    });

    const payload = { title: '竞态-ingest创建', content: '内容', content_type: 'note' };
    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/ingest', payload }),
      app.inject({ method: 'POST', url: '/api/ingest', payload }),
    ]);

    expect([r1.statusCode, r2.statusCode].sort()).toEqual([201, 409]);
    expect(await countByTitle('竞态-ingest创建')).toBe(1);
  });

  it('two concurrent POST /api/ingest?overwrite=true: only 1 row remains', async () => {
    const app = await buildApp();
    embedMock.mockImplementation(async () => {
      await sleep(30);
      return vec8();
    });

    const payload = { title: '竞态-ingest覆盖', content: '内容', content_type: 'note' };
    await Promise.all([
      app.inject({ method: 'POST', url: '/api/ingest?overwrite=true', payload }),
      app.inject({ method: 'POST', url: '/api/ingest?overwrite=true', payload }),
    ]);

    expect(await countByTitle('竞态-ingest覆盖')).toBe(1);
  });
});
