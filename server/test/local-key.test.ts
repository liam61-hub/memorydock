import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateLocalKey, loadOrCreateLocalKey } from '../src/modules/auth/local-key.js';

describe('loadOrCreateLocalKey', () => {
  it('creates a new key file with a "md_" prefixed key when none exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memorydock-key-'));
    const keyFile = join(dir, 'nested', 'api-key.txt');

    const result = loadOrCreateLocalKey({ keyFile });
    expect(result.created).toBe(true);
    expect(result.key.startsWith('md_')).toBe(true);
    expect(result.key.length).toBeGreaterThan(20);
    expect(existsSync(keyFile)).toBe(true);
    expect(readFileSync(keyFile, 'utf-8').trim()).toBe(result.key);

    rmSync(dir, { recursive: true, force: true });
  });

  it('reuses the existing key file instead of generating a new one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memorydock-key-'));
    const keyFile = join(dir, 'api-key.txt');

    const first = loadOrCreateLocalKey({ keyFile });
    const second = loadOrCreateLocalKey({ keyFile });
    expect(second.created).toBe(false);
    expect(second.key).toBe(first.key);

    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers the environment API_KEY override over the key file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memorydock-key-'));
    const keyFile = join(dir, 'api-key.txt');
    loadOrCreateLocalKey({ keyFile });

    const result = loadOrCreateLocalKey({ keyFile, envOverride: 'md_customoverride' });
    expect(result.key).toBe('md_customoverride');
    expect(result.created).toBe(false);
    // The file is left untouched
    expect(readFileSync(keyFile, 'utf-8').trim()).not.toBe('md_customoverride');

    rmSync(dir, { recursive: true, force: true });
  });

  it('generates unique keys across calls', () => {
    expect(generateLocalKey()).not.toBe(generateLocalKey());
  });
});
