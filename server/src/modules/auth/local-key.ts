import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Generate a local API key: `md_` + 32 random bytes as hex.
 */
export function generateLocalKey(): string {
  return `md_${randomBytes(32).toString('hex')}`;
}

export interface LocalKeyOptions {
  /** Path of the key file (parent dirs are created as needed). */
  keyFile: string;
  /** Optional override from the environment (API_KEY). */
  envOverride?: string;
}

export interface LocalKeyResult {
  key: string;
  /** True when a new key file was created on this call. */
  created: boolean;
}

/**
 * Load the local API key, creating a new key file on first run.
 *
 * Priority: environment override > existing key file > newly generated key.
 */
export function loadOrCreateLocalKey(options: LocalKeyOptions): LocalKeyResult {
  if (options.envOverride) {
    return { key: options.envOverride, created: false };
  }

  if (existsSync(options.keyFile)) {
    const key = readFileSync(options.keyFile, 'utf-8').trim();
    if (key) {
      return { key, created: false };
    }
  }

  const key = generateLocalKey();
  mkdirSync(dirname(options.keyFile), { recursive: true });
  writeFileSync(options.keyFile, `${key}\n`, { encoding: 'utf-8', mode: 0o600 });
  return { key, created: true };
}
