import type { FastifyInstance } from 'fastify';
import { getTable, getChunksTable } from '../../db/lancedb.js';
import { fromRow, withoutVector } from '../../db/schema.js';
import { embed, checkEmbeddingHealth } from '../embedding/index.js';
import type { SearchRequest, SearchResponse, SearchResultItem, SearchSortBy, ChunkMatch } from '../../types.js';

/** Valid content_type enum values */
const VALID_CONTENT_TYPES = new Set(['project', 'note', 'article', 'doc', 'personal_info']);
/** Valid status enum values */
const VALID_STATUSES = new Set(['active', 'archived']);

type LanceDistanceRow = Record<string, unknown> & { _distance?: number };

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
 * Register the search route.
 */
export async function registerSearchRoutes(app: FastifyInstance) {

  app.post<{ Body: SearchRequest }>('/api/search', {
    schema: {
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1 },
          content_type: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          status: { type: 'string' },
          top_k: { type: 'integer', minimum: 1, maximum: 50, default: 5 },
          created_after: { type: 'string' },
          created_before: { type: 'string' },
          sort_by: { type: 'string', enum: ['relevance', 'created_at', 'updated_at'] },
        },
      },
    },
  }, async (request, reply) => {
    const { query, content_type, tags, status, top_k = 5, created_after, created_before, sort_by } = request.body;

    const tid = tenantId(request);
    let degraded = false;
    let items: SearchResultItem[];
    const chunkMatches = new Map<string, ChunkMatch[]>(); // entryId → matched chunks

    // Try vector search
    const embeddingHealthy = await checkEmbeddingHealth();

    if (embeddingHealthy) {
      try {
        // 1. Embed the query
        const queryVector = await embed(query);

        // 2. LanceDB vector search + chunk search (in parallel)
        const table = await getTable();
        const chunksTbl = await getChunksTable().catch(() => null);
        const k = Math.min(top_k * 3, 50);

        const [vectorResults, chunkResults] = await Promise.all([
          table.query().nearestTo(queryVector).limit(k).toArray(),
          chunksTbl
            ? chunksTbl.query().nearestTo(queryVector).limit(top_k * 2).toArray().catch(() => [])
            : Promise.resolve([] as LanceDistanceRow[]),
        ]);

        // 3. Score parent documents
        const scored = vectorResults
          .map(r => {
            const entry = fromRow(r);
            const distance = typeof r._distance === 'number' ? r._distance : undefined;
            const vectorScore = distance != null ? 1 / (1 + distance) : 0.5;
            return { entry, vectorScore };
          })
          .filter(item => item.entry.tenant_id === tid && item.entry.review_status === 'approved');

        // 4. Map chunk hits back to parent documents and boost their scores
        for (const cr of chunkResults) {
          const parentId = cr.parent_id as string;
          if (!parentId) continue;
          const chunkScore = cr._distance != null ? 1 / (1 + (cr._distance as number)) : 0.5;

          if (!chunkMatches.has(parentId)) {
            chunkMatches.set(parentId, []);
          }
          chunkMatches.get(parentId)!.push({
            chunk_index: cr.chunk_index as number,
            content_preview: (cr.content as string).slice(0, 200),
            score: Math.round(chunkScore * 1000) / 1000,
          });

          // Boost the parent document's score
          const existing = scored.find(s => s.entry.id === parentId);
          if (existing) {
            existing.vectorScore = Math.max(existing.vectorScore, chunkScore);
          }
        }

        // 5. Keyword match weight + date filter + sort
        items = rankAndFilter(scored, query, content_type, tags, status, created_after, created_before, sort_by, top_k);

        // 6. When vector results are weak, automatically append keyword recall
        if (items.length < top_k / 2 || (items.length > 0 && items[0].score < 0.3)) {
          const kItems = await keywordFallback(query, content_type, tags, status, created_after, created_before, sort_by, tid, top_k);
          // Merge and dedupe (vector results win)
          const existingIds = new Set(items.map(i => i.entry.id));
          for (const ki of kItems) {
            if (!existingIds.has(ki.entry.id)) {
              items.push(ki);
            }
          }
          degraded = items.length > 0 && items[0].score < 0.3; // mark the degraded state
        }
      } catch {
        // Vector search failed: degrade
        degraded = true;
        items = await keywordFallback(query, content_type, tags, status, created_after, created_before, sort_by, tid, top_k);
      }
    } else {
      // Embedding API unavailable: degrade directly
      degraded = true;
      items = await keywordFallback(query, content_type, tags, status, created_after, created_before, sort_by, tid, top_k);
    }

    if (sort_by === 'created_at' || sort_by === 'updated_at') {
      items = applySorting(items, sort_by).slice(0, top_k);
    } else {
      items = items.slice(0, top_k);
    }

    // Build the suggestion message
    let suggestion: string | undefined;
    if (items.length === 0) {
      suggestion = `No results found for "${query}". Try different keywords or check the content type filter. Available types: project, note, article, doc, personal_info.`;
    }

    const response: SearchResponse = {
      items: items.map(item => ({
        entry: withoutVector(item.entry),
        score: item.score,
        matched_chunks: chunkMatches.get(item.entry.id),
      })),
      total: items.length,
      degraded,
      suggestion,
    };

    return reply.send({ status: true, data: response });
  });
}

/**
 * Date range filter helper.
 */
function matchDateRange(
  entryCreatedAt: string,
  createdAfter?: string,
  createdBefore?: string,
): boolean {
  if (createdAfter && entryCreatedAt < createdAfter) return false;
  if (createdBefore && entryCreatedAt > createdBefore) return false;
  return true;
}

/**
 * Sorting helper.
 */
function applySorting(
  items: SearchResultItem[],
  sortBy: SearchSortBy = 'relevance',
): SearchResultItem[] {
  switch (sortBy) {
    case 'created_at':
      return items.sort((a, b) => b.entry.created_at.localeCompare(a.entry.created_at) || a.entry.id.localeCompare(b.entry.id));
    case 'updated_at':
      return items.sort((a, b) => b.entry.updated_at.localeCompare(a.entry.updated_at));
    case 'relevance':
    default:
      return items.sort((a, b) => b.score - a.score);
  }
}

/**
 * Hybrid ranking: vector similarity (0.7) + keyword match (0.3) + status weight + date filter.
 */
function rankAndFilter(
  scored: { entry: ReturnType<typeof fromRow>; vectorScore: number }[],
  query: string,
  content_type?: string,
  tags?: string[],
  status?: string,
  created_after?: string,
  created_before?: string,
  sort_by?: SearchSortBy,
  topK: number = 5,
): SearchResultItem[] {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);

  const results = scored.map(({ entry, vectorScore }) => {
    // Type filter
    if (content_type && entry.content_type !== content_type) return null;
    // Tag filter
    if (tags && tags.length > 0 && !tags.some(t => entry.tags.includes(t))) return null;
    // Status filter
    if (status && entry.status !== status) return null;
    // Date filter
    if (!matchDateRange(entry.created_at, created_after, created_before)) return null;

    // Keyword match score
    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();

    let keywordScore = 0;
    for (const term of queryTerms) {
      if (titleLower.includes(term)) keywordScore += 0.6;
      if (contentLower.includes(term)) keywordScore += 0.4;
    }
    keywordScore = Math.min(keywordScore / queryTerms.length, 1.0);

    // Final score: vector similarity primary, keywords secondary
    let finalScore = vectorScore * 0.7 + keywordScore * 0.3;

    // Status weight
    if (entry.status === 'archived') {
      finalScore *= 0.5;
    }

    return { entry, score: Math.round(finalScore * 1000) / 1000 };
  });

  const filtered = results.filter((item): item is SearchResultItem => item !== null);
  return applySorting(filtered, sort_by).slice(0, topK);
}

/**
 * Degraded mode: pure keyword search + date filter.
 */
async function keywordFallback(
  query: string,
  content_type: string | undefined,
  tags: string[] | undefined,
  status: string | undefined,
  created_after: string | undefined,
  created_before: string | undefined,
  sort_by: SearchSortBy | undefined,
  tenantId: string,
  topK: number = 5,
): Promise<SearchResultItem[]> {
  const table = await getTable();

  // Push validated filters down into the LanceDB where() clause
  let whereClause = `tenant_id = '${escapeSQL(tenantId)}'`;
  whereClause += " AND review_status = 'approved'";
  if (content_type && VALID_CONTENT_TYPES.has(content_type)) {
    whereClause += ` AND content_type = '${escapeSQL(content_type)}'`;
  }
  if (status && VALID_STATUSES.has(status)) {
    whereClause += ` AND status = '${escapeSQL(status)}'`;
  }

  const all = await table.query().where(whereClause).limit(2000).toArray();
  const entries = all.map(r => fromRow(r));

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);

  const scored = entries.map(entry => {
    if (tags && tags.length > 0 && !tags.some(t => entry.tags.includes(t))) return null;
    if (!matchDateRange(entry.created_at, created_after, created_before)) return null;

    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();

    let score = 0;
    for (const term of queryTerms) {
      if (titleLower.includes(term)) score += 3;
      if (contentLower.includes(term)) score += 1;
    }

    if (entry.status === 'archived') score *= 0.5;

    return score > 0 ? { entry, score } : null;
  });

  const filtered = scored.filter((item): item is SearchResultItem => item !== null);
  return applySorting(filtered, sort_by).slice(0, topK);
}
