import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as lancedb from '@lancedb/lancedb';

let migrateStorage: typeof import('../src/storage/migrate-storage.js')['migrateStorage'];
let assertMigratableTableSet: typeof import('../src/storage/migrate-storage.js')['assertMigratableTableSet'];
let legacyConfigCandidates: typeof import('../src/storage/migrate-storage.js')['legacyConfigCandidates'];

// Provided by test/setup-env.ts: a per-file throwaway MEMORYDOCK_HOME.
const home = process.env.MEMORYDOCK_HOME!;
const targetIndex = process.env.MEMORYDOCK_INDEX_PATH!;
const originalAppData = process.env.APPDATA;
const originalXdg = process.env.XDG_CONFIG_HOME;
const originalHome = process.env.HOME;

const scratchDirs: string[] = [];

beforeAll(async () => {
  const mod = await import('../src/storage/migrate-storage.js');
  migrateStorage = mod.migrateStorage;
  assertMigratableTableSet = mod.assertMigratableTableSet;
  legacyConfigCandidates = mod.legacyConfigCandidates;
});

afterEach(() => {
  // Restore per-test env mutations.
  process.env.MEMORYDOCK_NOTES_PATH = path.join(home, 'notes');
  if (originalAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppData;
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  // Clean per-test artifacts under the temp home.
  rmSync(targetIndex, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(path.join(home, 'backups'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(path.join(home, 'migrations'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(path.join(home, 'notes'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(path.join(home, 'config.json'), { force: true, maxRetries: 5, retryDelay: 100 });
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function scratchDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'memorydock-migrate-'));
  scratchDirs.push(dir);
  return dir;
}

function tempLeftovers(): string[] {
  return readdirSync(home).filter(n => n.startsWith('.index-migration-'));
}

// Deliberately missing version / review_status / parent_id: a genuine pre-2.0 row.
const LEGACY_ROW = {
  id: 'legacy-1',
  tenant_id: 'default',
  title: 'Legacy entry',
  content: 'old content',
  content_type: 'note',
  tags: ['legacy'],
  source: '',
  status: 'active',
  metadata: '{}',
  vector: new Array(8).fill(0.1),
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

async function buildLegacyIndex(dir: string, tableName = 'knowledge_entries', chunks = true): Promise<void> {
  const db = await lancedb.connect(dir);
  await db.createTable(tableName, [LEGACY_ROW]);
  if (chunks) {
    await db.createTable('knowledge_chunks', [{
      id: 'c1',
      parent_id: 'legacy-1',
      tenant_id: 'default',
      chunk_index: 0,
      content: 'old chunk',
      vector: new Array(8).fill(0.1),
      created_at: '2026-01-01T00:00:00.000Z',
    }]);
  }
  db.close();
}

async function buildMixedIndex(dir: string): Promise<void> {
  await buildLegacyIndex(dir);
  const db = await lancedb.connect(dir);
  await db.createTable('memory_entries', [{
    ...LEGACY_ROW,
    id: 'mem-1',
    title: 'New entry',
    version: 1,
    review_status: 'approved',
    parent_id: '',
  }]);
  db.close();
}

describe('migrateStorage', () => {
  it('migrates a legacy index: rename, schema upgrade, notes, record, pre-v2 backup', async () => {
    const source = path.join(scratchDir(), 'legacy-index');
    await buildLegacyIndex(source);

    const result = await migrateStorage(source, { migrateConfig: false });
    expect(result.entries).toBe(1);
    expect(result.target).toBe(targetIndex);
    expect(existsSync(targetIndex)).toBe(true);

    // Pre-v2 snapshot under <home>/backups.
    expect(path.dirname(path.dirname(result.backup))).toBe(path.join(home, 'backups'));
    expect(existsSync(result.backup)).toBe(true);

    // Markdown notes regenerated from the migrated rows.
    expect(existsSync(path.join(home, 'notes', 'legacy-1.md'))).toBe(true);

    // Migration record written last, version 2.
    expect(path.dirname(result.record)).toBe(path.join(home, 'migrations'));
    const record = JSON.parse(readFileSync(result.record, 'utf-8'));
    expect(record.version).toBe(2);
    expect(record.schema_version).toBe(2);
    expect(record.entries).toBe(1);

    // Destination index: current names only, schema upgraded to 2.0 columns.
    const db = await lancedb.connect(targetIndex);
    const names = await db.tableNames();
    expect(names).toContain('memory_entries');
    expect(names).toContain('memory_chunks');
    expect(names).not.toContain('knowledge_entries');
    expect(names).not.toContain('knowledge_chunks');

    const table = await db.openTable('memory_entries');
    const fields = (await table.schema()).fields.map(f => f.name);
    expect(fields).toContain('version');
    expect(fields).toContain('review_status');
    expect(fields).toContain('parent_id');
    const rows = await table.query().toArray();
    expect(rows.length).toBe(1);
    const row = rows[0] as Record<string, unknown>;
    expect(Number(row.version)).toBe(1); // LanceDB returns integers as BigInt
    expect(row.review_status).toBe('approved');
    expect(row.parent_id).toBe('');
    table.close();
    db.close();

    expect(tempLeftovers()).toEqual([]);
  });

  it('refuses a source without a supported memory table', async () => {
    const source = path.join(scratchDir(), 'other-index');
    const db = await lancedb.connect(source);
    await db.createTable('other_table', [{ id: 'x' }]);
    db.close();

    await expect(migrateStorage(source, { migrateConfig: false }))
      .rejects.toThrow(/does not contain a supported memory table/);
    expect(existsSync(targetIndex)).toBe(false);
    expect(tempLeftovers()).toEqual([]);
  });

  it('refuses to merge a source containing both legacy and current tables', async () => {
    const source = path.join(scratchDir(), 'mixed-index');
    await buildMixedIndex(source);

    await expect(migrateStorage(source, { migrateConfig: false }))
      .rejects.toThrow(/Refusing to merge/);
    expect(existsSync(targetIndex)).toBe(false);
    expect(tempLeftovers()).toEqual([]);
    // The durable snapshot still exists: backup happens before validation.
    const preV2 = readdirSync(path.join(home, 'backups')).filter(n => n.startsWith('pre-v2-'));
    expect(preV2.length).toBe(1);
  });

  it('refuses to run twice: destination index is not empty', async () => {
    const source = path.join(scratchDir(), 'legacy-index');
    await buildLegacyIndex(source);
    await migrateStorage(source, { migrateConfig: false });

    await expect(migrateStorage(source, { migrateConfig: false }))
      .rejects.toThrow(/Destination index is not empty/);
    expect(tempLeftovers()).toEqual([]);
  });

  it('cleans up its temporary directory when the migration fails mid-way', async () => {
    const source = path.join(scratchDir(), 'legacy-index');
    await buildLegacyIndex(source);

    // Block note regeneration: notesRoot() resolves to <file>/notes, whose
    // mkdir fails because the parent is a plain file.
    const blocker = path.join(scratchDir(), 'blocker');
    writeFileSync(blocker, 'not a directory');
    process.env.MEMORYDOCK_NOTES_PATH = path.join(blocker, 'notes');

    await expect(migrateStorage(source, { migrateConfig: false })).rejects.toThrow();
    // Index swap never happened; snapshot and cleanup both correct.
    expect(existsSync(targetIndex)).toBe(false);
    const preV2 = readdirSync(path.join(home, 'backups')).filter(n => n.startsWith('pre-v2-'));
    expect(preV2.length).toBe(1);
    expect(tempLeftovers()).toEqual([]);
    expect(existsSync(path.join(home, 'migrations'))).toBe(false);
  });

  it('resolves identical target, backup, and record paths from any working directory', async () => {
    const source = path.join(scratchDir(), 'legacy-index');
    await buildLegacyIndex(source);
    const cwd = process.cwd();
    const elsewhere = scratchDir();
    try {
      process.chdir(elsewhere);
      const result = await migrateStorage(source, { migrateConfig: false });
      expect(result.target).toBe(targetIndex);
      expect(path.isAbsolute(result.backup)).toBe(true);
      expect(path.dirname(path.dirname(result.backup))).toBe(path.join(home, 'backups'));
      expect(path.isAbsolute(result.record)).toBe(true);
      expect(path.dirname(result.record)).toBe(path.join(home, 'migrations'));
      expect(existsSync(result.target)).toBe(true);
      expect(existsSync(result.backup)).toBe(true);
      expect(existsSync(result.record)).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it('migrates a legacy configuration into MEMORYDOCK_HOME', async () => {
    const source = path.join(scratchDir(), 'legacy-index');
    await buildLegacyIndex(source);

    // Place the legacy config where this platform's candidates actually look:
    // APPDATA on Windows, ~/Library/Application Support on macOS, and
    // XDG_CONFIG_HOME on Linux. os.homedir() reads $HOME on POSIX, so
    // overriding it keeps the test off the real home directory.
    const legacyRoot = path.join(scratchDir(), 'legacy-root');
    let legacyConfigDir: string;
    if (process.platform === 'win32') {
      legacyConfigDir = path.join(legacyRoot, 'FlowNote');
      process.env.APPDATA = legacyRoot;
    } else if (process.platform === 'darwin') {
      legacyConfigDir = path.join(legacyRoot, 'Library', 'Application Support', 'FlowNote');
      process.env.HOME = legacyRoot;
    } else {
      legacyConfigDir = path.join(legacyRoot, 'flownote');
      process.env.XDG_CONFIG_HOME = legacyRoot;
    }
    mkdirSync(legacyConfigDir, { recursive: true });
    writeFileSync(path.join(legacyConfigDir, 'config.json'), JSON.stringify({
      embedding: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'nomic-embed-text', dim: 768 },
    }));
    const result = await migrateStorage(source); // migrateConfig defaults to true
    expect(result.entries).toBe(1);

    const configPath = process.env.MEMORYDOCK_CONFIG_PATH!;
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.embedding.model).toBe('nomic-embed-text');
  });
});

describe('assertMigratableTableSet', () => {
  it('rejects a legacy and a current table coexisting', () => {
    expect(() => assertMigratableTableSet(['memory_entries', 'knowledge_entries'], 'src'))
      .toThrow(/Refusing to merge/);
  });

  it('rejects chunk table coexistence', () => {
    expect(() => assertMigratableTableSet(['memory_entries', 'knowledge_chunks', 'memory_chunks'], 'src'))
      .toThrow(/Refusing to merge/);
  });

  it('rejects sources with no supported table', () => {
    expect(() => assertMigratableTableSet(['other_table'], 'src'))
      .toThrow(/does not contain a supported memory table/);
  });

  it('accepts a pure legacy source and a pure current source', () => {
    expect(() => assertMigratableTableSet(['knowledge_entries', 'knowledge_chunks'], 'src')).not.toThrow();
    expect(() => assertMigratableTableSet(['memory_entries', 'memory_chunks'], 'src')).not.toThrow();
  });
});

describe('legacyConfigCandidates', () => {
  it('returns platform-aware candidates', () => {
    expect(legacyConfigCandidates({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'win32', '/home/x')).toEqual([
      path.join('C:\\Users\\x\\AppData\\Roaming', 'MemoryDock', 'config.json'),
      path.join('C:\\Users\\x\\AppData\\Roaming', 'FlowNote', 'config.json'),
    ]);
    expect(legacyConfigCandidates({}, 'win32', '/home/x')).toEqual([]);

    expect(legacyConfigCandidates({}, 'darwin', '/Users/x')).toEqual([
      path.join('/Users/x', 'Library', 'Application Support', 'MemoryDock', 'config.json'),
      path.join('/Users/x', 'Library', 'Application Support', 'FlowNote', 'config.json'),
    ]);

    expect(legacyConfigCandidates({}, 'linux', '/home/x')).toEqual([
      path.join('/home/x', '.config', 'memorydock', 'config.json'),
      path.join('/home/x', '.config', 'flownote', 'config.json'),
      path.join('/home/x', '.memorydock', 'config.json'),
      path.join('/home/x', '.flownote', 'config.json'),
    ]);
    expect(legacyConfigCandidates({ XDG_CONFIG_HOME: '/tmp/xdg' }, 'linux', '/home/x')).toEqual([
      path.join('/tmp/xdg', 'memorydock', 'config.json'),
      path.join('/tmp/xdg', 'flownote', 'config.json'),
      path.join('/home/x', '.memorydock', 'config.json'),
      path.join('/home/x', '.flownote', 'config.json'),
    ]);
  });
});
