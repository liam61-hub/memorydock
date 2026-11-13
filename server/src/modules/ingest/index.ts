import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getChunksTable, getTable } from '../../db/lancedb.js';
import { toRow, fromRow } from '../../db/schema.js';
import { embed } from '../embedding/index.js';
import { chunkContent, needsChunking } from '../chunking/index.js';
import { withEntryLock } from '../../utils/entry-lock.js';
import { removeMarkdownNote, writeMarkdownNote } from '../../storage/markdown-notes.js';
import type { CreateEntryRequest, MemoryEntry } from '../../types.js';

/** Escape single quotes in SQL strings. */
function escapeSQL(val: string): string {
  return val.replace(/'/g, "''");
}

/**
 * Get the tenant_id from the request.
 */
function tenantId(request: { tenantId?: string }): string {
  return request.tenantId ?? 'default';
}

/**
 * Restore an overwritten entry if persisting its replacement fails.
 */
async function restoreEntry(
  table: Awaited<ReturnType<typeof getTable>>,
  entry: MemoryEntry,
  chunksTable: Awaited<ReturnType<typeof getChunksTable>> | null,
  chunks: Record<string, unknown>[],
): Promise<void> {
  await table.delete(`id = '${escapeSQL(entry.id)}'`);
  await table.add([toRow(entry)]);

  if (chunksTable) {
    await chunksTable.delete(`parent_id = '${escapeSQL(entry.id)}'`);
    if (chunks.length > 0) await chunksTable.add(chunks);
  }

  await writeMarkdownNote(entry);
}

/**
 * Register the ingest routes.
 */
export async function registerIngestRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateEntryRequest; Querystring: { overwrite?: string } }>('/api/ingest', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'content', 'content_type'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          content: { type: 'string', minLength: 1, maxLength: 50000 },
          content_type: { type: 'string', enum: ['project', 'note', 'article', 'doc', 'personal_info'] },
          tags: { type: 'array', items: { type: 'string', maxLength: 50 }, maxItems: 20, default: [] },
          source: { type: 'string', maxLength: 500 },
          metadata: { type: 'object', default: {} },
        },
      },
    },
  }, async (request, reply) => {
    const {
      title,
      content,
      content_type,
      tags = [],
      source = `mcp:${new Date().toISOString()}`,
      metadata = {},
      parent_id = null,
    } = request.body;

    const tid = tenantId(request);
    const overwrite = request.query.overwrite === 'true';

    // Serialize create/overwrite per title to close the race between the duplicate check and the insert.
    return withEntryLock(`create:${tid}:${title}`, async () => {
      const table = await getTable();
      const existing = await table.query()
        .where(`tenant_id = '${escapeSQL(tid)}' AND title = '${escapeSQL(title)}'`)
        .limit(1)
        .toArray();

      let existingEntry: MemoryEntry | null = null;
      if (existing.length > 0) {
        existingEntry = fromRow(existing[0]);
        if (!overwrite) {
          return reply.status(409).send({
            status: false,
            message: `An entry with title "${title.slice(0, 50)}" already exists. Use ?overwrite=true to replace it.`,
            existing_id: existingEntry.id,
          });
        }
      }

      // Finish every embedding call before changing the existing note or index entry.
      const contentChunks = needsChunking(content) ? chunkContent(content) : [];
      const chunkVectors: number[][] = [];
      let vector: number[];
      try {
        if (contentChunks.length > 0) {
          for (const chunkText of contentChunks) {
            chunkVectors.push(await embed(chunkText));
          }

          const dimensions = chunkVectors[0].length;
          vector = new Array(dimensions).fill(0);
          for (const chunkVector of chunkVectors) {
            for (let index = 0; index < dimensions; index++) {
              vector[index] += chunkVector[index] / chunkVectors.length;
            }
          }
        } else {
          vector = await embed(content);
        }
      } catch {
        return reply.status(503).send({ status: false, message: 'Embedding service unavailable, please try later' });
      }

      const now = new Date().toISOString();
      const entry: MemoryEntry = {
        id: uuidv4(),
        tenant_id: tid,
        title,
        content,
        content_type,
        tags,
        source,
        status: 'active',
        review_status: 'approved',
        parent_id,
        metadata,
        vector,
        version: 1,
        created_at: now,
        updated_at: now,
      };

      let chunksTable: Awaited<ReturnType<typeof getChunksTable>> | null = null;
      let previousChunks: Record<string, unknown>[] = [];
      const chunkRows = contentChunks.map((chunkText, index) => ({
        id: uuidv4(),
        parent_id: entry.id,
        tenant_id: tid,
        chunk_index: index,
        content: chunkText,
        vector: chunkVectors[index],
        created_at: now,
      }));

      try {
        if (contentChunks.length > 0 || existingEntry) {
          chunksTable = await getChunksTable();
        }
        if (chunksTable && existingEntry) {
          previousChunks = await chunksTable.query()
            .where(`parent_id = '${escapeSQL(existingEntry.id)}'`)
            .limit(1000)
            .toArray();
        }

        await writeMarkdownNote(entry);
        await table.add([toRow(entry)]);
        if (chunksTable && chunkRows.length > 0) await chunksTable.add(chunkRows);

        if (existingEntry) {
          if (chunksTable) await chunksTable.delete(`parent_id = '${escapeSQL(existingEntry.id)}'`);
          await table.delete(`id = '${escapeSQL(existingEntry.id)}'`);
          await removeMarkdownNote(existingEntry.id);
        }
      } catch (error) {
        request.log.error({ err: error, entryId: entry.id }, 'Failed to persist ingested entry');
        try {
          await table.delete(`id = '${escapeSQL(entry.id)}'`);
          if (chunksTable) await chunksTable.delete(`parent_id = '${escapeSQL(entry.id)}'`);
          await removeMarkdownNote(entry.id);
          if (existingEntry) {
            await restoreEntry(table, existingEntry, chunksTable, previousChunks);
          }
        } catch (restoreError) {
          request.log.error({ err: restoreError, entryId: existingEntry?.id ?? entry.id }, 'Failed to restore entry after ingest persistence error');
        }
        const message = existingEntry
          ? 'Could not replace the entry; the previous entry was restored when possible.'
          : 'Could not save the entry.';
        return reply.status(500).send({ status: false, message });
      }

      return reply.status(201).send({
        status: true,
        data: { id: entry.id, title: entry.title },
      });
    });
  });
}
