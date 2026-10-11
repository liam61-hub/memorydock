import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalSettings, settingsPath, userDataDir } from '../src/local-config.js';
import { notesRoot } from '../src/storage/markdown-notes.js';

const original = {
  home: process.env.MEMORYDOCK_HOME,
  config: process.env.MEMORYDOCK_CONFIG_PATH,
  notes: process.env.MEMORYDOCK_NOTES_PATH,
  legacyConfig: process.env.FLOWNOTE_CONFIG_PATH,
  legacyNotes: process.env.FLOWNOTE_NOTES_PATH,
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  const restore = (env: string, value: string | undefined) => {
    if (value === undefined) delete process.env[env]; else process.env[env] = value;
  };
  restore('MEMORYDOCK_HOME', original.home);
  restore('MEMORYDOCK_CONFIG_PATH', original.config);
  restore('MEMORYDOCK_NOTES_PATH', original.notes);
  restore('FLOWNOTE_CONFIG_PATH', original.legacyConfig);
  restore('FLOWNOTE_NOTES_PATH', original.legacyNotes);
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'memorydock-storage-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('MemoryDock storage path resolution', () => {
  it('userDataDir respects MEMORYDOCK_HOME', () => {
    const directory = tempDirectory();
    process.env.MEMORYDOCK_HOME = directory;
    expect(userDataDir()).toBe(directory);
  });

  it('settingsPath honors MEMORYDOCK_CONFIG_PATH', () => {
    const directory = tempDirectory();
    const custom = join(directory, 'custom.json');
    process.env.MEMORYDOCK_CONFIG_PATH = custom;
    expect(settingsPath()).toBe(custom);
  });

  it('settingsPath falls back to <home>/config.json when unset', () => {
    const directory = tempDirectory();
    process.env.MEMORYDOCK_HOME = directory;
    delete process.env.MEMORYDOCK_CONFIG_PATH;
    expect(settingsPath()).toBe(join(directory, 'config.json'));
  });

  it('notesRoot honors MEMORYDOCK_NOTES_PATH', () => {
    const directory = tempDirectory();
    const custom = join(directory, 'custom-notes');
    process.env.MEMORYDOCK_NOTES_PATH = custom;
    expect(notesRoot()).toBe(custom);
  });

  it('notesRoot falls back to <home>/notes when unset', () => {
    const directory = tempDirectory();
    process.env.MEMORYDOCK_HOME = directory;
    delete process.env.MEMORYDOCK_NOTES_PATH;
    expect(notesRoot()).toBe(join(directory, 'notes'));
  });

  it('loadLocalSettings reads the settings file at the resolved path', () => {
    const directory = tempDirectory();
    const current = join(directory, 'current.json');
    writeFileSync(current, JSON.stringify({ embedding: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'current', model: 'text-embedding-3-small', dim: 1536 } }));
    process.env.MEMORYDOCK_CONFIG_PATH = current;
    expect(loadLocalSettings().embedding?.apiKey).toBe('current');
  });

  it('ignores legacy FlowNote environment variables (no env aliases in 2.0)', () => {
    const directory = tempDirectory();
    const legacy = join(directory, 'legacy.json');
    writeFileSync(legacy, JSON.stringify({ embedding: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'nomic-embed-text', dim: 768 } }));
    delete process.env.MEMORYDOCK_CONFIG_PATH;
    process.env.FLOWNOTE_CONFIG_PATH = legacy;
    process.env.FLOWNOTE_NOTES_PATH = join(directory, 'legacy-notes');
    delete process.env.MEMORYDOCK_NOTES_PATH;

    // 2.0 deliberately dropped the legacy env aliases: they must not affect resolution.
    expect(settingsPath()).not.toBe(legacy);
    expect(notesRoot()).not.toBe(join(directory, 'legacy-notes'));
    expect(loadLocalSettings().embedding?.model).not.toBe('nomic-embed-text');
  });
});
