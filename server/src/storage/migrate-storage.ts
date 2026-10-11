import * as fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as lancedb from '@lancedb/lancedb';
import { config } from '../config.js';
import {
  CHUNKS_TABLE_NAME,
  LEGACY_CHUNKS_TABLE_NAME,
  LEGACY_TABLE_NAME,
  TABLE_NAME,
  ensureCurrentSchema,
  migrateLegacyTables,
} from '../db/lancedb.js';
import { fromRow } from '../db/schema.js';
import { settingsPath, userDataDir } from '../local-config.js';
import { writeMarkdownNote } from './markdown-notes.js';

export interface StorageMigrationResult {
  source: string;
  target: string;
  entries: number;
  backup: string;
  record: string;
}

export interface StorageMigrationOptions {
  /** Copy a legacy config.json into MEMORYDOCK_HOME when one is found (default true). */
  migrateConfig?: boolean;
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true).catch(() => false);
}

async function directoryIsEmpty(target: string): Promise<boolean> {
  return fs.readdir(target).then(entries => entries.length === 0).catch(() => true);
}

function migrationTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function idsDigest(ids: string[]): string {
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}

/**
 * Platform-aware candidates for a pre-2.0 config file. No legacy environment
 * variables are consulted: 2.0 dropped the FLOWNOTE_ and KNOWLEDGE_ aliases.
 */
export function legacyConfigCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): string[] {
  if (platform === 'win32') {
    const appData = env.APPDATA;
    return appData
      ? [path.join(appData, 'MemoryDock', 'config.json'), path.join(appData, 'FlowNote', 'config.json')]
      : [];
  }
  if (platform === 'darwin') {
    const support = path.join(homeDir, 'Library', 'Application Support');
    return [path.join(support, 'MemoryDock', 'config.json'), path.join(support, 'FlowNote', 'config.json')];
  }
  const configHome = env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  return [
    path.join(configHome, 'memorydock', 'config.json'),
    path.join(configHome, 'flownote', 'config.json'),
    path.join(homeDir, '.memorydock', 'config.json'),
    path.join(homeDir, '.flownote', 'config.json'),
  ];
}

async function migrateExistingConfiguration(): Promise<void> {
  const destination = settingsPath();
  if (await exists(destination)) return;
  const source = legacyConfigCandidates().find(candidate => existsSync(candidate) && statSync(candidate).isFile());
  if (!source) return;
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.copyFile(source, destination);
}

/**
 * One legacy index only: never merge a pre-2.0 table into an existing 2.0
 * table, and refuse sources that contain no supported table at all.
 */
export function assertMigratableTableSet(names: string[], source: string): void {
  const hasLegacy = names.includes(LEGACY_TABLE_NAME);
  const hasCurrent = names.includes(TABLE_NAME);
  if (hasLegacy && hasCurrent) {
    throw new Error(
      `Refusing to merge: ${source} contains both ${TABLE_NAME} and ${LEGACY_TABLE_NAME}. ` +
        'Point --from at a single pre-2.0 or 2.0 index.',
    );
  }
  if (!hasLegacy && !hasCurrent) {
    throw new Error(`Source does not contain a supported memory table (${TABLE_NAME} or ${LEGACY_TABLE_NAME}): ${source}`);
  }
  if (names.includes(LEGACY_CHUNKS_TABLE_NAME) && names.includes(CHUNKS_TABLE_NAME)) {
    throw new Error(`Refusing to merge: ${source} contains both ${CHUNKS_TABLE_NAME} and ${LEGACY_CHUNKS_TABLE_NAME}.`);
  }
  const known = new Set([TABLE_NAME, CHUNKS_TABLE_NAME, LEGACY_TABLE_NAME, LEGACY_CHUNKS_TABLE_NAME]);
  const unexpected = names.filter(n => !known.has(n));
  if (unexpected.length > 0) console.warn(`migrate-storage: carrying over extra tables: ${unexpected.join(', ')}`);
}

/** Rename with a cross-volume (EXDEV) fallback to copy + unlink. */
function moveDirectory(from: string, to: string): Promise<void> {
  return fs.rename(from, to).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EXDEV') throw error;
    await fs.cp(from, to, { recursive: true, errorOnExist: true });
    await fs.rm(from, { recursive: true, force: true });
  });
}

/**
 * One-time pre-2.0 storage migration:
 * 1. durable snapshot of the source under `<home>/backups/pre-v2-<stamp>/index`,
 * 2. all work on a private copy (the source is never modified),
 * 3. legacy table rename + schema upgrade + verification (count, IDs, columns),
 * 4. regenerate Markdown notes and migrate the legacy config,
 * 5. atomic swap of the verified copy into the destination,
 * 6. write the migration record last — its presence marks a completed migration.
 */
export async function migrateStorage(sourcePath: string, options: StorageMigrationOptions = {}): Promise<StorageMigrationResult> {
  const source = path.resolve(sourcePath);
  const target = path.resolve(config.lancedb.path);
  if (source === target) throw new Error('Source and destination index paths are the same');
  if (!await exists(source)) throw new Error(`Source index does not exist: ${source}`);
  if (await exists(target) && !await directoryIsEmpty(target)) {
    throw new Error(`Destination index is not empty: ${target} (a previous migration already completed)`);
  }

  const root = userDataDir();
  const stamp = migrationTimestamp();
  const backup = path.join(root, 'backups', `pre-v2-${stamp}`, 'index');
  const temporary = path.join(root, `.index-migration-${randomUUID()}`);
  const record = path.join(root, 'migrations', `${stamp}.json`);

  // 1. Durable snapshot of the source before anything is touched.
  await fs.mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
  await fs.cp(source, backup, { recursive: true, errorOnExist: true });

  // 2. All work happens on a private copy; the source is never modified.
  await fs.cp(source, temporary, { recursive: true, errorOnExist: true });
  try {
    const database = await lancedb.connect(temporary);
    const sourceNames = await database.tableNames();
    assertMigratableTableSet(sourceNames, source);

    const sourceTableName = sourceNames.includes(TABLE_NAME) ? TABLE_NAME : LEGACY_TABLE_NAME;
    const sourceTable = await database.openTable(sourceTableName);
    const sourceIds = (await sourceTable.query().select(['id']).toArray()).map(r => String(r.id)).sort();
    sourceTable.close();

    await migrateLegacyTables(database);
    const names = await database.tableNames();
    if (!names.includes(TABLE_NAME)) throw new Error(`Migration produced no ${TABLE_NAME} table: ${source}`);

    const table = await database.openTable(TABLE_NAME);
    await ensureCurrentSchema(table);
    const rows = await table.query().toArray();
    const entries = rows.length;
    if (entries !== await table.countRows()) {
      throw new Error('Migration verification failed: row count changed during read');
    }
    const migratedIds = rows.map(r => String(r.id)).sort();
    if (idsDigest(migratedIds) !== idsDigest(sourceIds)) {
      throw new Error('Migration verification failed: entry IDs changed');
    }
    const columns = new Set((await table.schema()).fields.map((f: { name: string }) => f.name));
    for (const column of ['version', 'review_status', 'parent_id']) {
      if (!columns.has(column)) throw new Error(`Migration verification failed: missing column ${column}`);
    }
    table.close();
    database.close();

    // Re-open once to prove the migrated copy is readable by a fresh connection.
    const reopened = await lancedb.connect(temporary);
    await reopened.tableNames();
    reopened.close();

    // 3. Notes + configuration — after verification, still before the swap.
    for (const row of rows) await writeMarkdownNote(fromRow(row));
    if (options.migrateConfig !== false) await migrateExistingConfiguration();

    // 4. Swap: remove an empty destination, then move the verified copy into place.
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    if (await exists(target)) await fs.rm(target, { recursive: true, force: true });
    await moveDirectory(temporary, target);

    // 5. Record last: its presence marks a completed migration.
    await fs.mkdir(path.dirname(record), { recursive: true, mode: 0o700 });
    await fs.writeFile(record, `${JSON.stringify({
      source,
      target,
      entries,
      backup,
      migrated_at: new Date().toISOString(),
      version: 2,
      schema_version: 2,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

    return { source, target, entries, backup, record };
  } finally {
    // The rename above already moved the temp dir; a failure here is expected.
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}
