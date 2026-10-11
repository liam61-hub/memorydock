import { beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../src/modules/embedding/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/modules/embedding/index.js')>();
  return { ...actual, embed: vi.fn() };
});

let registerMemoryRoutes: (app: FastifyInstance) => Promise<void>;
let embedMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  ({ registerMemoryRoutes } = await import('../src/modules/memory/index.js'));
  const embedding = await import('../src/modules/embedding/index.js');
  embedMock = vi.mocked(embedding.embed);
});

describe('agent proposal review flow', () => {
  it('keeps proposals out of normal search/listing until a person approves them', async () => {
    const app = Fastify();
    await registerMemoryRoutes(app);
    const created = await app.inject({ method: 'POST', url: '/api/memories/proposals', payload: {
      title: 'Use pnpm', content: 'Use pnpm for all package installs.', content_type: 'note', source: 'codex',
    } });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    expect((await app.inject({ method: 'GET', url: '/api/memories' })).json().data.total).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/memories?review_status=pending' })).json().data.total).toBe(1);

    embedMock.mockRejectedValueOnce(new Error('temporary embedding outage'));
    expect((await app.inject({ method: 'POST', url: `/api/memories/${id}/approve` })).statusCode).toBe(503);
    expect((await app.inject({ method: 'GET', url: '/api/memories?review_status=pending' })).json().data.total).toBe(1);

    embedMock.mockResolvedValue(new Array(8).fill(0.25));
    expect((await app.inject({ method: 'POST', url: `/api/memories/${id}/approve` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/memories' })).json().data.total).toBe(1);
    await app.close();
  });
});
