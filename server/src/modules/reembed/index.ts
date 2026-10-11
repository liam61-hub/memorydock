import { config } from '../../config.js';
import {
  CHUNKS_TABLE_NAME,
  TABLE_NAME,
  ensureIndex,
  getChunksTable,
  getConnection,
  getTable,
  resetConnection,
} from '../../db/lancedb.js';
import { fromRow, toRow } from '../../db/schema.js';
import { embed } from '../embedding/index.js';

/**
 * Abstraction over the storage + embedding side effects, so the orchestration
 * logic can be unit-tested without touching LanceDB or a real embedding API.
 */
export interface ReembedContext {
  loadRows(): Promise<{ entries: Record<string, unknown>[]; chunks: Record<string, unknown>[] }>;
  embed(text: string): Promise<number[]>;
  writeRows(rows: { entries: Record<string, unknown>[]; chunks: Record<string, unknown>[] }): Promise<void>;
  log?(message: string): void;
}

export interface ReembedResult {
  entries: number;
  chunks: number;
  dim: number;
}

/**
 * Re-embed every entry and chunk with the currently configured embedding
 * model, then replace the tables in one atomic overwrite.
 *
 * All embedding happens BEFORE any write: if embedding fails midway, the
 * existing tables are left completely untouched.
 */
export async function reembedAll(ctx: ReembedContext): Promise<ReembedResult> {
  const { entries, chunks } = await ctx.loadRows();
  if (entries.length === 0 && chunks.length === 0) {
    // Recreate even an empty table so `reembed --yes` can migrate a stale
    // vector schema after the embedding model dimension changes.
    await ctx.writeRows({ entries: [], chunks: [] });
    return { entries: 0, chunks: 0, dim: 0 };
  }

  let dim = 0;
  const reembeddedEntries: Record<string, unknown>[] = [];
  for (let i = 0; i < entries.length; i++) {
    const vector = await ctx.embed(entries[i].content as string);
    dim = vector.length;
    reembeddedEntries.push({ ...entries[i], vector });
    if (i > 0 && i % 20 === 0) {
      ctx.log?.(`Re-embedded ${i + 1}/${entries.length} entries`);
    }
  }

  const reembeddedChunks: Record<string, unknown>[] = [];
  for (const row of chunks) {
    const vector = await ctx.embed(row.content as string);
    dim = vector.length;
    reembeddedChunks.push({ ...row, vector });
  }

  await ctx.writeRows({ entries: reembeddedEntries, chunks: reembeddedChunks });
  return { entries: entries.length, chunks: chunks.length, dim };
}

/** Seed row used to create a table when the dataset is empty (schema inference). */
function entrySeed(): Record<string, unknown> {
  return {
    id: '__seed__',
    tenant_id: 'default',
    title: '',
    content: '',
    content_type: 'note',
    tags: ['__seed__'],
    source: '',
    status: 'active',
    metadata: '{}',
    vector: new Array(config.embedding.dim).fill(0),
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function chunkSeed(): Record<string, unknown> {
  return {
    id: '__seed__',
    parent_id: '__seed__',
    tenant_id: 'default',
    chunk_index: 0,
    content: '',
    vector: new Array(config.embedding.dim).fill(0),
    created_at: new Date().toISOString(),
  };
}

/**
 * Build the production reembed context backed by the real LanceDB storage.
 */
export async function buildLanceReembedContext(
  log: (message: string) => void = () => {},
): Promise<ReembedContext> {
  return {
    loadRows: async () => {
      const table = await getTable();
      const chunksTable = await getChunksTable();
      const rawEntries = await table.query().toArray();
      const rawChunks = await chunksTable.query().toArray();

      // Normalize via fromRow/toRow so tags (Arrow Utf8Vector) become plain
      // JS arrays — writing Arrow vectors back would corrupt the data.
      const entries = rawEntries.map(r => toRow(fromRow(r))) as unknown as Record<string, unknown>[];
      const chunks = rawChunks.map(r => ({ ...r })) as Record<string, unknown>[];
      return { entries, chunks };
    },
    embed: (text: string) => embed(text),
    writeRows: async ({ entries, chunks }) => {
      const db = await getConnection();
      // Overwrite with a seed row first so an empty dataset still yields a
      // valid schema, then delete the seed.
      await db.createTable(TABLE_NAME, [entrySeed(), ...entries], { mode: 'overwrite' });
      const table = await db.openTable(TABLE_NAME);
      await table.delete("id = '__seed__'");

      await db.createTable(CHUNKS_TABLE_NAME, [chunkSeed(), ...chunks], { mode: 'overwrite' });
      const chunksTable = await db.openTable(CHUNKS_TABLE_NAME);
      await chunksTable.delete("id = '__seed__'");

      resetConnection();
      await ensureIndex();
      log('Tables rebuilt and index ensured');
    },
    log,
  };
}
