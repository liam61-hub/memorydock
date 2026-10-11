import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { MemoryEntryResponse } from '../src/types.js';

vi.mock('../src/modules/embedding/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/embedding/index.js')>();
  return { ...actual, embed: vi.fn() };
});

let registerMemoryRoutes: (app: FastifyInstance) => Promise<void>;
let getTable: typeof import('../src/db/lancedb.js')['getTable'];
let getChunksTable: typeof import('../src/db/lancedb.js')['getChunksTable'];
let resetConnection: () => void;
let fromRow: typeof import('../src/db/schema.js')['fromRow'];
let embedMock: ReturnType<typeof vi.fn>;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const vec8 = () => new Array(8).fill(0.1);

beforeAll(async () => {
  const memory = await import('../src/modules/memory/index.js');
  registerMemoryRoutes = memory.registerMemoryRoutes;
  const db = await import('../src/db/lancedb.js');
  getTable = db.getTable;
  getChunksTable = db.getChunksTable;
  resetConnection = db.resetConnection;
  const schema = await import('../src/db/schema.js');
  fromRow = schema.fromRow;
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
  return app;
}

async function createEntry(app: FastifyInstance, title: string, content: string): Promise<MemoryEntryResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/memories',
    payload: { title, content, content_type: 'note' },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { data: MemoryEntryResponse }).data;
}

async function queryEntry(id: string) {
  const table = await getTable();
  const rows = await table.query().where(`id = '${id}'`).limit(1).toArray();
  expect(rows.length).toBe(1);
  return fromRow(rows[0]);
}

describe('PUT /api/memories/:id — incremental append via append_content', () => {
  it('append_content appends to the end of the existing content', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '追加-基础', '原始内容');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { append_content: '\n\n追加内容AAA' },
    });

    expect(res.statusCode).toBe(200);
    const entry = await queryEntry(created.id);
    expect(entry.content).toBe('原始内容\n\n追加内容AAA');
  });

  it('tags keep their original values after an append update (not corrupted)', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const res = await app.inject({
      method: 'POST',
      url: '/api/memories',
      payload: { title: '追加-标签保留', content: '原始', content_type: 'note', tags: ['并发', '测试标签'] },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().data;

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { append_content: 'AAA' },
    });
    expect(putRes.statusCode).toBe(200);

    const entry = await queryEntry(created.id);
    expect(entry.tags).toEqual(['并发', '测试标签']);
  });

  it('two concurrent appends both keep their content', async () => {
    const app = await buildApp();
    embedMock.mockImplementation(async () => {
      await sleep(30); // widen the race window
      return vec8();
    });
    const created = await createEntry(app, '追加-并发', 'X');

    const p1 = app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { append_content: 'AAA' },
    });
    const p2 = app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { append_content: 'BBB' },
    });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    const entry = await queryEntry(created.id);
    expect(entry.content).toContain('X');
    expect(entry.content).toContain('AAA');
    expect(entry.content).toContain('BBB');
  });
});

describe('PUT /api/memories/:id — full replacement with optimistic-lock version', () => {
  it('replacement with the correct version succeeds and increments version', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '替换-正确版本', '旧内容');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { content: '新内容', version: created.version },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.version).toBe(2);
    const entry = await queryEntry(created.id);
    expect(entry.content).toBe('新内容');
  });

  it('replacement with a stale version returns 409 with the current version and leaves content unchanged', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '替换-过期版本', '旧内容');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { content: '偷袭内容', version: 5 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe(false);
    expect(res.json().current_version).toBe(created.version);
    const entry = await queryEntry(created.id);
    expect(entry.content).toBe('旧内容');
  });

  it('full replacement without version returns 400 and never silently overwrites', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '替换-缺版本', '旧内容');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { content: '无版本替换' },
    });

    expect(res.statusCode).toBe(400);
    const entry = await queryEntry(created.id);
    expect(entry.content).toBe('旧内容');
  });

  it('returns 400 when both content and append_content are provided', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '替换-语义冲突', '旧内容');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { content: '新内容', append_content: '尾巴', version: created.version },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/memories/:id — error paths', () => {
  it('embedding failure returns 503, subsequent updates work once the lock is released', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '追加-异常恢复', '原始');

    embedMock.mockRejectedValueOnce(new Error('api down'));
    const failRes = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { append_content: 'AAA' },
    });
    expect(failRes.statusCode).toBe(503);

    embedMock.mockResolvedValue(vec8());
    const okRes = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { append_content: 'BBB' },
    });
    expect(okRes.statusCode).toBe(200);
    const entry = await queryEntry(created.id);
    expect(entry.content).toBe('原始BBB');
  });
});

describe('PUT /api/memories/:id — chunk refresh for long content', () => {
  const buildLong = (marker: string) =>
    `# ${marker}\n\n` + Array.from({ length: 260 }, (_, i) => `${marker}第${i}段内容`).join('\n\n');

  it('memory_chunks are refreshed with the new content after replacing a long entry', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '分块-长文替换', buildLong('OLD'));

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { content: buildLong('NEW'), version: created.version },
    });
    expect(res.statusCode).toBe(200);

    const chunksTbl = await getChunksTable();
    const rows = await chunksTbl.query().where(`parent_id = '${created.id}'`).toArray();
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const joined = rows.map(r => String(r.content)).join('');
    expect(joined).toContain('NEW');
    expect(joined).not.toContain('OLD');
  });

  it('old chunks are deleted after a long entry is replaced by a short one', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '分块-变短', buildLong('OLD'));

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { content: '短内容', version: created.version },
    });
    expect(res.statusCode).toBe(200);

    const chunksTbl = await getChunksTable();
    const rows = await chunksTbl.query().where(`parent_id = '${created.id}'`).toArray();
    expect(rows.length).toBe(0);
  });
});

describe('PUT /api/memories/:id — content_type updates', () => {
  it('updating content_type (note → doc) takes effect', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '改类型-成功', '内容');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { content_type: 'doc' },
    });

    expect(res.statusCode).toBe(200);
    const entry = await queryEntry(created.id);
    expect(entry.content_type).toBe('doc');
    // fields not sent in the request are unaffected
    expect(entry.title).toBe('改类型-成功');
  });

  it('an invalid content_type returns 400 and is not persisted', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '改类型-非法', '内容');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { content_type: 'not-a-type' },
    });

    expect(res.statusCode).toBe(400);
    const entry = await queryEntry(created.id);
    expect(entry.content_type).toBe('note');
    expect(entry.version).toBe(1); // version not advanced, entry not corrupted
  });

  it('content_type and tags can be updated in the same request', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());
    const created = await createEntry(app, '改类型-组合', '内容');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/memories/${created.id}`,
      payload: { content_type: 'article', tags: ['a', 'b'] },
    });

    expect(res.statusCode).toBe(200);
    const entry = await queryEntry(created.id);
    expect(entry.content_type).toBe('article');
    expect(entry.tags).toEqual(['a', 'b']);
  });
});
