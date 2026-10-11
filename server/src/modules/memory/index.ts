import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getTable, getChunksTable } from '../../db/lancedb.js';
import { toRow, fromRow, withoutVector } from '../../db/schema.js';
import { embed } from '../embedding/index.js';
import { needsChunking, chunkContent } from '../chunking/index.js';
import { withEntryLock } from '../../utils/entry-lock.js';
import { writeMarkdownNote, removeMarkdownNote } from '../../storage/markdown-notes.js';
import { config } from '../../config.js';
import type { CreateEntryRequest, UpdateEntryRequest } from '../../types.js';

/** Valid content_type enum values */
const VALID_CONTENT_TYPES = new Set(['project', 'note', 'article', 'doc', 'personal_info']);

/** Valid status enum values */
const VALID_STATUSES = new Set(['active', 'archived']);

/** UUID format validation (prevents where() injection) */
const UUID_RE = /^[0-9a-f-]{36}$/;
function isValidUUID(id: string): boolean {
  return UUID_RE.test(id);
}

/** Escape single quotes in SQL strings (defensive: applied even after enum validation) */
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
 * Register the memory CRUD routes.
 */
export async function registerMemoryRoutes(app: FastifyInstance) {

  // Agent-initiated memories are deliberately kept out of search until a
  // person reviews them in the local console.
  app.post<{ Body: CreateEntryRequest }>('/api/memories/proposals', async (request, reply) => {
    const { title, content, content_type, tags = [], source = 'agent', metadata = {}, parent_id = null } = request.body;
    if (!title || !content || !VALID_CONTENT_TYPES.has(content_type)) {
      return reply.status(400).send({ status: false, message: 'title, content, and a valid content_type are required' });
    }
    const now = new Date().toISOString();
    const entry = {
      id: uuidv4(), tenant_id: tenantId(request), title, content, content_type, tags, source,
      status: 'active' as const, review_status: 'pending' as const, parent_id,
      // Pending entries need a schema-compatible placeholder vector until a
      // person approves them and the real embedding is generated.
      metadata, vector: new Array(config.embedding.dim).fill(0), version: 1, created_at: now, updated_at: now,
    };
    await writeMarkdownNote(entry);
    await (await getTable()).add([toRow(entry)]);
    return reply.status(201).send({ status: true, data: withoutVector(entry) });
  });

  app.post<{ Params: { id: string } }>('/api/memories/:id/approve', async (request, reply) => {
    const id = request.params.id;
    if (!isValidUUID(id)) return reply.status(400).send({ status: false, message: 'Invalid id format' });
    return withEntryLock(`entry:${id}`, async () => {
      const table = await getTable();
      const rows = await table.query().where(`id = '${id}' AND tenant_id = '${tenantId(request)}'`).limit(1).toArray();
      if (rows.length === 0) return reply.status(404).send({ status: false, message: 'Entry not found' });
      const current = fromRow(rows[0]);
      if (current.review_status === 'approved') return reply.send({ status: true, data: withoutVector(current) });
      let vector: number[];
      try {
        vector = await embed(current.content);
      } catch {
        // Do not touch either store until the only external dependency in this
        // operation (the embedding provider) has completed successfully.
        return reply.status(503).send({ status: false, message: 'Embedding service unavailable, please try later' });
      }

      const approved = { ...current, vector, review_status: 'approved' as const, version: current.version + 1, updated_at: new Date().toISOString() };
      try {
        await writeMarkdownNote(approved);
        await table.delete(`id = '${id}' AND tenant_id = '${tenantId(request)}'`);
        await table.add([toRow(approved)]);
        return reply.send({ status: true, data: withoutVector(approved) });
      } catch (error) {
        // LanceDB has no transaction. Restore the previous canonical note and
        // index entry so a failed approval never drops a pending proposal.
        request.log.error({ err: error, id }, 'Failed to persist approved proposal; restoring previous entry');
        try {
          await table.delete(`id = '${id}' AND tenant_id = '${tenantId(request)}'`);
          await table.add([toRow(current)]);
          await writeMarkdownNote(current);
        } catch (restoreError) {
          request.log.error({ err: restoreError, id }, 'Failed to restore proposal after approval persistence error');
        }
        return reply.status(500).send({ status: false, message: 'Could not approve the memory; the previous proposal was restored.' });
      }
    });
  });

  // Create entry
  app.post<{ Body: CreateEntryRequest; Querystring: { overwrite?: string } }>('/api/memories', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'content', 'content_type'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          content: { type: 'string', minLength: 1, maxLength: 50000 },
          content_type: { type: 'string', enum: ['project', 'note', 'article', 'doc', 'personal_info'] },
          tags: { type: 'array', items: { type: 'string', maxLength: 50 }, maxItems: 20, default: [] },
          source: { type: 'string', maxLength: 500, default: '' },
          status: { type: 'string', enum: ['active', 'archived'], default: 'active' },
          metadata: { type: 'object', default: {} },
        },
      },
    },
  }, async (request, reply) => {
    const { title, content, content_type, tags = [], source = '', status = 'active', metadata = {}, parent_id = null } = request.body;

    const tid = tenantId(request);
    const overwrite = request.query.overwrite === 'true';

    // Serialize create/overwrite per title to close the race between the duplicate check and the insert
    return withEntryLock(`create:${tid}:${title}`, async () => {
      // Duplicate check: exact title match within the tenant
      const existingTable = await getTable();
      const existing = await existingTable.query()
        .where(`tenant_id = '${escapeSQL(tid)}' AND title = '${escapeSQL(title)}'`)
        .limit(1)
        .toArray();

      if (existing.length > 0) {
        const existingEntry = fromRow(existing[0]);
        if (overwrite) {
          // Overwrite mode: delete the old entry, then continue creating the new one
          await existingTable.delete(`id = '${escapeSQL(existingEntry.id)}'`);
        } else {
          return reply.status(409).send({
            status: false,
            message: `An entry with title "${title.slice(0, 50)}" already exists. Use ?overwrite=true to replace it.`,
            existing_id: existingEntry.id,
          });
        }
      }

      const now = new Date().toISOString();
      const entryId = uuidv4();

      // Embed
      let vector: number[];
      try {
        // Long content: chunk it first
        if (needsChunking(content)) {
          const chunks = chunkContent(content);
          const chunkVectors: number[][] = [];

          // Embed each chunk
          for (const chunkText of chunks) {
            const chunkVec = await embed(chunkText);
            chunkVectors.push(chunkVec);
          }

          // Parent document vector = mean pooling of all chunk vectors
          const dim = chunkVectors[0].length;
          vector = new Array(dim).fill(0);
          for (const cv of chunkVectors) {
            for (let i = 0; i < dim; i++) {
              vector[i] += cv[i] / chunkVectors.length;
            }
          }

          // Write chunks to the memory_chunks table
          const chunksTbl = await getChunksTable();
          const chunkRows = chunks.map((chunkText, idx) => ({
            id: uuidv4(),
            parent_id: entryId,
            tenant_id: tid,
            chunk_index: idx,
            content: chunkText,
            vector: chunkVectors[idx],
            created_at: now,
          }));
          for (const cr of chunkRows) {
            await chunksTbl.add([cr]);
          }

          request.log?.info({ entryId, chunks: chunks.length }, 'Chunked entry created');
        } else {
          vector = await embed(content);
        }
      } catch {
        return reply.status(503).send({ status: false, message: 'Embedding service unavailable, please try later' });
      }

      const entry = {
        id: entryId,
        tenant_id: tid,
        title,
        content,
        content_type,
        tags,
        source,
        status,
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

      return reply.status(201).send({ status: true, data: withoutVector(entry) });
    });
  });

  // Get single entry
  app.get<{ Params: { id: string } }>('/api/memories/:id', async (request, reply) => {
    const rowId = request.params.id;
    if (!isValidUUID(rowId)) {
      return reply.status(400).send({ status: false, message: 'Invalid id format' });
    }

    const table = await getTable();
    const tid = tenantId(request);
    const result = await table.query()
      .where(`id = '${rowId}' AND tenant_id = '${tid}'`)
      .limit(1)
      .toArray();

    if (result.length === 0) {
      return reply.status(404).send({ status: false, message: 'Entry not found' });
    }

    const entry = fromRow(result[0]);
    return reply.send({ status: true, data: withoutVector(entry) });
  });

  // Update entry
  app.put<{ Params: { id: string }; Body: UpdateEntryRequest }>('/api/memories/:id', async (request, reply) => {
    const rowId = request.params.id;
    if (!isValidUUID(rowId)) {
      return reply.status(400).send({ status: false, message: 'Invalid id format' });
    }

    const tid = tenantId(request);
    const { title, content, content_type, tags, status, metadata, parent_id, append_content, version } = request.body;

    // Semantic validation (fast-fail outside the lock)
    if (content_type !== undefined && !VALID_CONTENT_TYPES.has(content_type)) {
      return reply.status(400).send({
        status: false,
        message: `Invalid content_type: ${content_type}. Must be one of: ${[...VALID_CONTENT_TYPES].join(', ')}`,
      });
    }
    if (content !== undefined && append_content !== undefined) {
      return reply.status(400).send({
        status: false,
        message: 'content and append_content are mutually exclusive',
      });
    }
    if (content !== undefined && (!Number.isInteger(version) || (version as number) < 1)) {
      return reply.status(400).send({
        status: false,
        message: 'content replace requires version — fetch the entry first (GET /api/memories/:id) or use append_content for incremental updates',
      });
    }

    // Serialize per entry ID: wrap the whole read-modify-reembed-delete-write cycle in a critical section
    return withEntryLock(`entry:${rowId}`, async () => {
      // Re-read the latest data inside the lock (critical: must not use the stale snapshot from outside)
      const table = await getTable();
      const result = await table.query()
        .where(`id = '${rowId}' AND tenant_id = '${tid}'`)
        .limit(1)
        .toArray();

      if (result.length === 0) {
        return reply.status(404).send({ status: false, message: 'Entry not found' });
      }

      const existing = fromRow(result[0]);

      if (parent_id !== undefined) {
        if (parent_id === rowId) return reply.status(400).send({ status: false, message: 'A note cannot be its own parent' });
        let cursor = parent_id;
        while (cursor) {
          const parentRows = await table.query().where(`id = '${escapeSQL(cursor)}' AND tenant_id = '${tid}'`).limit(1).toArray();
          if (parentRows.length === 0) return reply.status(400).send({ status: false, message: 'Parent note not found' });
          const parent = fromRow(parentRows[0]);
          if (parent.id === rowId) return reply.status(400).send({ status: false, message: 'Moving this note would create a cycle' });
          cursor = parent.parent_id;
        }
      }

      // Full replace: optimistic-lock check prevents overwriting from a stale snapshot
      if (content !== undefined && version !== existing.version) {
        return reply.status(409).send({
          status: false,
          message: 'Entry was updated by someone else (version mismatch). Re-read the entry and retry.',
          current_version: existing.version,
        });
      }

      const newContent = content !== undefined
        ? content
        : (append_content !== undefined ? existing.content + append_content : existing.content);
      const contentChanged = newContent !== existing.content;

      // Re-embed when the content changed (also refreshes long-content chunks)
      let vector = existing.vector;
      if (contentChanged) {
        try {
          const chunksTbl = await getChunksTable();
          if (needsChunking(newContent)) {
            const chunks = chunkContent(newContent);
            const chunkVectors: number[][] = [];
            for (const chunkText of chunks) {
              chunkVectors.push(await embed(chunkText));
            }

            // Parent document vector = mean pooling of all chunk vectors
            const dim = chunkVectors[0].length;
            vector = new Array(dim).fill(0);
            for (const cv of chunkVectors) {
              for (let i = 0; i < dim; i++) {
                vector[i] += cv[i] / chunkVectors.length;
              }
            }

            const now = new Date().toISOString();
            const chunkRows = chunks.map((chunkText, idx) => ({
              id: uuidv4(),
              parent_id: rowId,
              tenant_id: tid,
              chunk_index: idx,
              content: chunkText,
              vector: chunkVectors[idx],
              created_at: now,
            }));

            // Inside the lock: delete old chunks then write new ones, back to back
            await chunksTbl.delete(`parent_id = '${escapeSQL(rowId)}'`);
            for (const cr of chunkRows) {
              await chunksTbl.add([cr]);
            }
          } else {
            vector = await embed(newContent);
            // Content shrank back to short form (or was edited): remove stale chunks
            await chunksTbl.delete(`parent_id = '${escapeSQL(rowId)}'`);
          }
        } catch {
          return reply.status(503).send({ status: false, message: 'Embedding service unavailable, please try later' });
        }
      }

      const updated = {
        ...existing,
        title: title ?? existing.title,
        content: newContent,
        content_type: content_type ?? existing.content_type,
        tags: tags ?? existing.tags,
        status: status ?? existing.status,
        metadata: metadata ?? existing.metadata,
        // `null` explicitly moves an entry back to the top level; nullish
        // coalescing would silently keep the old parent instead.
        parent_id: parent_id !== undefined ? parent_id : existing.parent_id,
        vector,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
      };

      // LanceDB has no in-place update: delete + write run back to back inside the lock (nothing in between)
      await writeMarkdownNote(updated);
      await table.delete(`id = '${rowId}' AND tenant_id = '${tid}'`);
      await table.add([toRow(updated)]);

      return reply.send({ status: true, data: withoutVector(updated) });
    });
  });

  // Delete entry
  app.delete<{ Params: { id: string } }>('/api/memories/:id', async (request, reply) => {
    const rowId = request.params.id;
    if (!isValidUUID(rowId)) {
      return reply.status(400).send({ status: false, message: 'Invalid id format' });
    }

    const table = await getTable();
    const tid = tenantId(request);
    await table.delete(`id = '${rowId}' AND tenant_id = '${tid}'`);
    await removeMarkdownNote(rowId);
    return reply.send({ status: true, message: 'Deleted' });
  });

  // List entries
  app.get('/api/memories', async (request, reply) => {
    const query = request.query as {
      content_type?: string;
      tags?: string;
      status?: string;
      review_status?: string;
      page?: string;
      page_size?: string;
    };

    const page = parseInt(query.page || '1', 10);
    const pageSize = Math.min(parseInt(query.page_size || '20', 10), 100);
    const tid = tenantId(request);

    const table = await getTable();

    // Push validated enum filters down into the LanceDB where() clause
    let whereClause = `tenant_id = '${escapeSQL(tid)}'`;
    if (query.content_type && VALID_CONTENT_TYPES.has(query.content_type)) {
      whereClause += ` AND content_type = '${escapeSQL(query.content_type)}'`;
    }
    if (query.status && VALID_STATUSES.has(query.status)) {
      whereClause += ` AND status = '${escapeSQL(query.status)}'`;
    }
    const reviewStatus = query.review_status === 'pending' ? 'pending' : 'approved';
    whereClause += ` AND review_status = '${reviewStatus}'`;

    const all = await table.query().where(whereClause).limit(2000).toArray();
    let rows = all.map(r => fromRow(r));

    // Tag filter (LanceDB array-column filtering is limited; handled in memory)
    if (query.tags) {
      const filterTags = query.tags.split(',');
      rows = rows.filter(r => filterTags.some(t => r.tags.includes(t)));
    }

    // Pagination
    const total = rows.length;
    const offset = (page - 1) * pageSize;
    const paged = rows.slice(offset, offset + pageSize);

    return reply.send({
      status: true,
      data: {
        items: paged.map(withoutVector),
        page,
        page_size: pageSize,
        total,
      },
    });
  });

  app.get('/api/memories/tree', async (request, reply) => {
    const table = await getTable();
    const rows = (await table.query().where(`tenant_id = '${escapeSQL(tenantId(request))}' AND review_status = 'approved'`).limit(2000).toArray()).map(fromRow);
    const byParent = new Map<string | null, typeof rows>();
    for (const entry of rows) {
      const key = entry.parent_id && rows.some(candidate => candidate.id === entry.parent_id) ? entry.parent_id : null;
      byParent.set(key, [...(byParent.get(key) || []), entry]);
    }
    const visit = (parentId: string | null): unknown[] => (byParent.get(parentId) || [])
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(entry => ({ ...withoutVector(entry), children: visit(entry.id) }));
    return reply.send({ status: true, data: { items: visit(null) } });
  });
}
