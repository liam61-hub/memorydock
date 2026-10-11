import * as lancedb from '@lancedb/lancedb';
import { config } from '../config.js';
import type { Connection, Table } from '@lancedb/lancedb';

let conn: Connection | null = null;
let table: Table | null = null;
let chunksTable: Table | null = null;
let indexed = false;

export const TABLE_NAME = 'memory_entries';
export const CHUNKS_TABLE_NAME = 'memory_chunks';
/** Pre-2.0 table names, supported only by the one-time legacy copier. */
export const LEGACY_TABLE_NAME = 'knowledge_entries';
export const LEGACY_CHUNKS_TABLE_NAME = 'knowledge_chunks';

async function migrateLegacyTable(db: Connection, legacyName: string, currentName: string): Promise<void> {
  const names = await db.tableNames();
  if (!names.includes(legacyName)) return;

  const legacy = await db.openTable(legacyName);
  const legacyCount = await legacy.countRows();
  if (!names.includes(currentName)) {
    if (legacyCount === 0) {
      const schema = await legacy.schema();
      await db.createEmptyTable(currentName, schema);
    } else {
      await db.createTable(currentName, await legacy.query().toArrow());
    }
  }
  legacy.close();

  const current = await db.openTable(currentName);
  const currentCount = await current.countRows();
  current.close();

  if (legacyCount === 0 && currentCount > 0) {
    // Empty legacy table next to a populated current table: nothing to carry
    // over, just drop the empty legacy name.
    await db.dropTable(legacyName);
    return;
  }
  if (currentCount !== legacyCount) {
    throw new Error(`Memory table migration verification failed: ${legacyCount} source rows, ${currentCount} destination rows`);
  }
  await db.dropTable(legacyName);
}

export async function migrateLegacyTables(db: Connection): Promise<void> {
  await migrateLegacyTable(db, LEGACY_TABLE_NAME, TABLE_NAME);
  await migrateLegacyTable(db, LEGACY_CHUNKS_TABLE_NAME, CHUNKS_TABLE_NAME);
}

export async function getConnection(): Promise<Connection> {
  if (!conn) {
    conn = await lancedb.connect(config.lancedb.path);
    await migrateLegacyTables(conn);
  }
  return conn;
}

/**
 * Bring an existing table up to the current schema: add the columns that were
 * introduced after 2.0 (`version`, `review_status`, `parent_id`) when they are
 * missing. Re-reads the schema before each addition so consecutive adds in one
 * call always work from fresh state. Shared by `getTable()` and the storage
 * migration, so a migrated index is schema-identical to a freshly created one.
 */
export async function ensureCurrentSchema(table: Table): Promise<void> {
  const ensureColumn = async (name: string, valueSql: string): Promise<void> => {
    const schema = await table.schema();
    if (schema.fields.some((f: { name: string }) => f.name === name)) return;
    await table.addColumns([{ name, valueSql }]);
  };
  // Existing rows default to version 1 and approved review status; parent_id
  // must be string-typed so it can hold the '' values toRow() writes.
  await ensureColumn('version', '1');
  await ensureColumn('review_status', "'approved'");
  await ensureColumn('parent_id', "''");
}

export async function getTable(): Promise<Table> {
  if (table) return table;

  const db = await getConnection();
  const tableNames = await db.tableNames();

  if (tableNames.includes(TABLE_NAME)) {
    table = await db.openTable(TABLE_NAME);
    indexed = true; // assume already indexed if table exists
    await ensureCurrentSchema(table);
  } else {
    // Create the table with one empty seed row so LanceDB infers the schema
    const seed = {
      id: '__seed__',
      tenant_id: 'default',
      title: '',
      content: '',
      content_type: 'note',
      tags: ['__seed__'],
      source: '',
      status: 'active',
      review_status: 'approved',
      parent_id: '',
      metadata: '{}',
      vector: new Array(Number(process.env.EMBEDDING_DIM || config.embedding.dim)).fill(0),
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    table = await db.createTable(TABLE_NAME, [seed]);
    // Delete the seed row
    await table.delete("id = '__seed__'");
  }

  return table;
}

/**
 * Ensure the vector index has been created.
 */
export async function ensureIndex(): Promise<void> {
  if (indexed) return;
  const t = await getTable();
  try {
    await t.createIndex('vector', {
      config: lancedb.Index.ivfPq({ numPartitions: 4, numSubVectors: 8 }),
    });
    indexed = true;
  } catch (err) {
    // Index may already exist
    console.warn('ensureIndex: index may already exist, skipping:', (err as Error).message);
    indexed = true;
  }
}

export async function getChunksTable(): Promise<Table> {
  if (chunksTable) return chunksTable;

  const db = await getConnection();
  const tableNames = await db.tableNames();

  if (tableNames.includes(CHUNKS_TABLE_NAME)) {
    chunksTable = await db.openTable(CHUNKS_TABLE_NAME);
  } else {
    const seed = {
      id: '__seed__',
      parent_id: '__seed__',
      tenant_id: 'default',
      chunk_index: 0,
      content: '',
      vector: new Array(Number(process.env.EMBEDDING_DIM || config.embedding.dim)).fill(0),
      created_at: new Date().toISOString(),
    };
    chunksTable = await db.createTable(CHUNKS_TABLE_NAME, [seed]);
    await chunksTable.delete("id = '__seed__'");
  }

  return chunksTable;
}

export function resetConnection(): void {
  conn = null;
  table = null;
  chunksTable = null;
  indexed = false;
}
