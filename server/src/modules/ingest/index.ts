import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getTable } from '../../db/lancedb.js';
import { toRow, fromRow } from '../../db/schema.js';
import { embed } from '../embedding/index.js';
import { withEntryLock } from '../../utils/entry-lock.js';
import { writeMarkdownNote } from '../../storage/markdown-notes.js';
import type { CreateEntryRequest } from '../../types.js';

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

    // Serialize create/overwrite per title to close the race between the duplicate check and the insert
    return withEntryLock(`create:${tid}:${title}`, async () => {
      // Duplicate check
      const existingTable = await getTable();
      const existing = await existingTable.query()
        .where(`tenant_id = '${escapeSQL(tid)}' AND title = '${escapeSQL(title)}'`)
        .limit(1)
        .toArray();

      if (existing.length > 0) {
        const existingEntry = fromRow(existing[0]);
        if (overwrite) {
          await existingTable.delete(`id = '${escapeSQL(existingEntry.id)}'`);
        } else {
          return reply.status(409).send({
            status: false,
            message: `An entry with title "${title.slice(0, 50)}" already exists. Use ?overwrite=true to replace it.`,
            existing_id: existingEntry.id,
          });
        }
      }

      // Embed
      let vector: number[];
      try {
        vector = await embed(content);
      } catch {
        return reply.status(503).send({ status: false, message: 'Embedding service unavailable, please try later' });
      }

      const now = new Date().toISOString();
      const entry = {
        id: uuidv4(),
        tenant_id: tenantId(request),
        title,
        content,
        content_type,
        tags,
        source,
        status: 'active' as const,
        review_status: 'approved' as const,
        parent_id,
        metadata,
        vector,
        version: 1,
        created_at: now,
        updated_at: now,
      };

      await writeMarkdownNote(entry);
      const table = await getTable();
      await table.add([toRow(entry)]);

      return reply.status(201).send({
        status: true,
        data: { id: entry.id, title: entry.title },
      });
    });
  });
}
