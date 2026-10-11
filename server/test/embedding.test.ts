import { afterEach, describe, expect, it, vi } from 'vitest';
import { embed, embedMany, type EmbeddingProviderConfig } from '../src/modules/embedding/index.js';

const PROVIDER: EmbeddingProviderConfig = {
  baseUrl: 'https://emb.test/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  dim: 3,
};

/** Fake OpenAI-compatible embeddings response. */
function embeddingsResponse(vectors: number[][]) {
  return {
    data: vectors.map(embedding => ({ embedding })),
  };
}

describe('embedMany', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends all texts as input array to the configured endpoint and returns all vectors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(embeddingsResponse([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const vectors = await embedMany(['hello', 'world'], { provider: PROVIDER });
    expect(vectors).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://emb.test/v1/embeddings');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('test-model');
    expect(body.input).toEqual(['hello', 'world']);
    expect(init.headers.Authorization).toBe('Bearer sk-test');
  });

  it('returns a single vector from embed()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(embeddingsResponse([[7, 8, 9]])), { status: 200 }),
    ));

    const vector = await embed('single', { provider: PROVIDER });
    expect(vector).toEqual([7, 8, 9]);
  });

  it('uses a keyless local embedding endpoint without an Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(embeddingsResponse([[1, 2, 3]])), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(embed('local', { provider: { ...PROVIDER, baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' } }))
      .resolves.toEqual([1, 2, 3]);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('throws a clear dim mismatch error guiding the user to reconfigure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      // API returns 5 dims, but provider.dim = 3
      new Response(JSON.stringify(embeddingsResponse([[1, 2, 3, 4, 5]])), { status: 200 }),
    ));

    await expect(embed('x', { provider: PROVIDER })).rejects.toThrow(/5.*3.*EMBEDDING_DIM/s);
  });

  it('retries on transient failure and succeeds on the next attempt', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(
        new Response(JSON.stringify(embeddingsResponse([[1, 1, 1]])), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const vectors = await embedMany(['retry me'], { provider: PROVIDER, maxRetries: 2, retryDelayMs: 1 });
    expect(vectors).toEqual([[1, 1, 1]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a helpful error when no base URL is configured', async () => {
    await expect(
      embed('x', { provider: { ...PROVIDER, baseUrl: '' } }),
    ).rejects.toThrow(/EMBEDDING_BASE_URL/);
  });
});
