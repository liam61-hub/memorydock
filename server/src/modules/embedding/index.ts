import { config } from '../../config.js';

/** OpenAI-compatible embedding provider configuration (bring your own key). */
export interface EmbeddingProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dim: number;
}

export interface EmbedOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  /** Explicit provider override; falls back to env config when omitted. */
  provider?: EmbeddingProviderConfig;
}

/** Configuration errors are not retried (retrying cannot fix them). */
export class EmbeddingConfigError extends Error {}

function resolveProvider(provider?: EmbeddingProviderConfig): EmbeddingProviderConfig {
  if (provider) return provider;
  return {
    baseUrl: config.embedding.baseUrl,
    apiKey: config.embedding.apiKey,
    model: config.embedding.model,
    dim: config.embedding.dim,
  };
}

/**
 * Embed a batch of texts via an OpenAI-compatible embeddings endpoint.
 *
 * Works with OpenAI, together.ai, Ollama (http://localhost:11434/v1) and any
 * other OpenAI-compatible provider.
 */
export async function embedMany(texts: string[], options: EmbedOptions = {}): Promise<number[][]> {
  const provider = resolveProvider(options.provider);
  if (!provider.baseUrl) {
    throw new EmbeddingConfigError('EMBEDDING_BASE_URL is not configured. Set it in .env or the environment.');
  }
  const maxRetries = options.maxRetries ?? config.embedding.maxRetries;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const endpoint = `${provider.baseUrl}/embeddings`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: provider.model, input: texts }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Embedding API returned ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as {
        data?: Array<{ embedding: number[] }>;
      };

      const vectors = data.data?.map(item => item.embedding);
      if (!vectors || vectors.length !== texts.length || vectors.some(v => !v || v.length === 0)) {
        throw new Error('Embedding API returned an empty or incomplete result');
      }

      const mismatch = vectors.find(v => v.length !== provider.dim);
      if (mismatch) {
        throw new EmbeddingConfigError(
          `Embedding model returned ${mismatch.length} dims but EMBEDDING_DIM is ${provider.dim}. ` +
          'Set EMBEDDING_DIM to match the model, then run "memorydock reembed" to rebuild existing vectors.',
        );
      }

      return vectors;
    } catch (err) {
      if (err instanceof EmbeddingConfigError) {
        throw err;
      }
      lastError = err as Error;
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s...
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * Math.pow(2, attempt)));
      }
    }
  }

  throw new Error(`Embedding API failed after ${maxRetries} attempts: ${lastError?.message}`);
}

/** Embed a single text. */
export async function embed(text: string, options: EmbedOptions = {}): Promise<number[]> {
  const vectors = await embedMany([text], options);
  return vectors[0];
}

/** Check whether the embedding endpoint is reachable and healthy. */
export async function checkEmbeddingHealth(): Promise<boolean> {
  try {
    await embed('health check');
    return true;
  } catch {
    return false;
  }
}
