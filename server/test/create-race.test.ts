import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../src/modules/embedding/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/embedding/index.js')>();
  return { ...actual, embed: vi.fn() };
});

let registerMemoryRoutes: (app: FastifyInstance) => Promise<void>;
let registerIngestRoutes: (app: FastifyInstance) => Promise<void>;
let getTable: typeof import('../src/db/lancedb.js')['getTable'];
let getChunksTable: typeof import('../src/db/lancedb.js')['getChunksTable'];
let fromRow: typeof import('../src/db/schema.js')['fromRow'];
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
  getChunksTable = db.getChunksTable;
  resetConnection = db.resetConnection;
  fromRow = (await import('../src/db/schema.js')).fromRow;
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

async function entryByTitle(title: string) {
  const table = await getTable();
  const rows = await table.query().where(`title = '${title}'`).toArray();
  return rows.length > 0 ? fromRow(rows[0]) : null;
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

describe('POST /api/ingest — long content', () => {
  const longContent = (marker: string) =>
    Array.from({ length: 160 }, (_, index) => `${marker} section ${index}: ${'useful knowledge for future reference '.repeat(3)}`).join('\n\n');

  it('keeps short content as a single parent record without child chunks', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());

    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { title: 'ingest短文兼容', content: 'Short note', content_type: 'note' },
    });

    expect(res.statusCode).toBe(201);
    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock).toHaveBeenCalledWith('Short note');
    expect(await countByTitle('ingest短文兼容')).toBe(1);

    const parent = await entryByTitle('ingest短文兼容');
    expect(parent).not.toBeNull();
    const chunks = await (await getChunksTable()).query().where(`parent_id = '${parent!.id}'`).limit(1000).toArray();
    expect(chunks).toHaveLength(0);
  });

  it('embeds long content in chunks linked to the parent and averages their vectors', async () => {
    const app = await buildApp();
    embedMock.mockImplementation(async () => new Array(8).fill(embedMock.mock.calls.length));

    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { title: 'ingest长文分块', content: longContent('LONG'), content_type: 'doc' },
    });

    expect(res.statusCode).toBe(201);
    expect(embedMock.mock.calls.length).toBeGreaterThan(1);
    expect(embedMock.mock.calls.every(([text]) => String(text).length <= 800)).toBe(true);

    const parent = await entryByTitle('ingest长文分块');
    expect(parent).not.toBeNull();
    const chunks = await (await getChunksTable()).query().where(`parent_id = '${parent!.id}'`).limit(1000).toArray();
    expect(chunks.length).toBe(embedMock.mock.calls.length);
    expect(chunks.every(chunk => String(chunk.content).includes('LONG'))).toBe(true);
    expect(chunks.map(chunk => Number(chunk.chunk_index))).toEqual(chunks.map((_, index) => index));

    const expectedMean = (embedMock.mock.calls.length + 1) / 2;
    const parentVector = Array.from(parent!.vector);
    expect(parentVector).toHaveLength(8);
    expect(parentVector.every(value => Math.abs(Number(value) - expectedMean) < 0.001)).toBe(true);
  });

  it('replaces the previous parent and chunks after a successful overwrite', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { title: 'ingest覆盖分块清理', content: longContent('OLD'), content_type: 'doc' },
    });
    expect(created.statusCode).toBe(201);

    const previous = await entryByTitle('ingest覆盖分块清理');
    expect(previous).not.toBeNull();
    const chunksTable = await getChunksTable();
    const oldChunks = await chunksTable.query().where(`parent_id = '${previous!.id}'`).limit(1000).toArray();
    expect(oldChunks.length).toBeGreaterThan(1);

    const replaced = await app.inject({
      method: 'POST',
      url: '/api/ingest?overwrite=true',
      payload: { title: 'ingest覆盖分块清理', content: longContent('NEW'), content_type: 'doc' },
    });
    expect(replaced.statusCode).toBe(201);

    const current = await entryByTitle('ingest覆盖分块清理');
    expect(current).not.toBeNull();
    expect(current!.id).not.toBe(previous!.id);
    expect(current!.content).toContain('NEW');
    expect(await chunksTable.query().where(`parent_id = '${previous!.id}'`).limit(1000).toArray()).toHaveLength(0);
    const newChunks = await chunksTable.query().where(`parent_id = '${current!.id}'`).limit(1000).toArray();
    expect(newChunks.length).toBeGreaterThan(1);
    expect(newChunks.every(chunk => String(chunk.content).includes('NEW'))).toBe(true);
  });

  it('preserves the previous parent and chunks when overwrite embedding fails', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const original = longContent('ORIGINAL');
    const created = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { title: 'ingest覆盖失败保护', content: original, content_type: 'doc' },
    });
    expect(created.statusCode).toBe(201);

    const previous = await entryByTitle('ingest覆盖失败保护');
    expect(previous).not.toBeNull();
    const chunksTable = await getChunksTable();
    const previousChunks = await chunksTable.query().where(`parent_id = '${previous!.id}'`).limit(1000).toArray();
    expect(previousChunks.length).toBeGreaterThan(1);

    embedMock.mockReset();
    embedMock.mockResolvedValueOnce(vec8()).mockRejectedValueOnce(new Error('embedding failed'));
    const failed = await app.inject({
      method: 'POST',
      url: '/api/ingest?overwrite=true',
      payload: { title: 'ingest覆盖失败保护', content: longContent('REPLACEMENT'), content_type: 'doc' },
    });

    expect(failed.statusCode).toBe(503);
    const preserved = await entryByTitle('ingest覆盖失败保护');
    expect(preserved?.id).toBe(previous!.id);
    expect(preserved?.content).toBe(original);
    const preservedChunks = await chunksTable.query().where(`parent_id = '${previous!.id}'`).limit(1000).toArray();
    expect(preservedChunks).toHaveLength(previousChunks.length);
    expect(preservedChunks.every(chunk => String(chunk.content).includes('ORIGINAL'))).toBe(true);
  });
});
