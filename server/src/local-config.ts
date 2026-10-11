import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export type EmbeddingProvider = 'ollama' | 'openai' | 'compatible';

export interface LocalSettings {
  embedding: {
    provider: EmbeddingProvider;
    baseUrl: string;
    apiKey: string;
    model: string;
    dim: number;
  };
  llm?: { baseUrl: string; apiKey: string; model: string };
}

/** One stable per-user root, independent of the process working directory. */
export function userDataDir(): string {
  return path.resolve(process.env.MEMORYDOCK_HOME || path.join(os.homedir(), '.memorydock'));
}

export function settingsPath(): string {
  return path.resolve(process.env.MEMORYDOCK_CONFIG_PATH || path.join(userDataDir(), 'config.json'));
}

export function loadLocalSettings(): Partial<LocalSettings> {
  const file = settingsPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LocalSettings>;
  } catch (error) {
    throw new Error(`Unable to read MemoryDock configuration at ${file}: ${(error as Error).message}`, { cause: error });
  }
}

export function saveLocalSettings(settings: LocalSettings): string {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs are managed by the OS. */ }
  return file;
}

export function configuredEmbedding(): LocalSettings['embedding'] | undefined {
  const stored = loadLocalSettings().embedding;
  const baseUrl = process.env.EMBEDDING_BASE_URL || stored?.baseUrl;
  if (!baseUrl) return undefined;
  return {
    provider: stored?.provider || 'compatible',
    baseUrl,
    apiKey: process.env.EMBEDDING_API_KEY || stored?.apiKey || '',
    model: process.env.EMBEDDING_MODEL || stored?.model || 'text-embedding-3-small',
    dim: Number(process.env.EMBEDDING_DIM || stored?.dim || 1536),
  };
}
