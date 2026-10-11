import type { MemoryEntry } from '../types.js';

/** Safely parse JSON, returning an empty object on failure. */
function safeJsonParse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return (raw as Record<string, unknown>) || {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Convert an application-layer MemoryEntry into a LanceDB row.
 */
export function toRow(entry: MemoryEntry) {
  return {
    ...entry,
    tags: (entry.tags && entry.tags.length > 0) ? entry.tags : ['uncategorized'],
    metadata: JSON.stringify(entry.metadata || {}),
    // LanceDB cannot infer a column type from a seed whose only value is null.
    parent_id: entry.parent_id || '',
  };
}

/**
 * Convert a LanceDB row into an application-layer MemoryEntry.
 */
export function fromRow(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    title: row.title as string,
    content: row.content as string,
    content_type: row.content_type as MemoryEntry['content_type'],
    // tags may come back as an Arrow Utf8Vector object (not a JS array);
    // passing it through unchanged would corrupt it into an array of empty
    // strings on the next write to LanceDB, so convert to plain JS strings
    tags: Array.from((row.tags ?? []) as Iterable<string>),
    source: (row.source as string) || '',
    status: (row.status as MemoryEntry['status']) || 'active',
    review_status: (row.review_status as MemoryEntry['review_status']) || 'approved',
    parent_id: row.parent_id ? row.parent_id as string : null,
    metadata: safeJsonParse(row.metadata),
    vector: (row.vector as number[]) || [],
    // Legacy rows (pre-migration) have no version column: default to 1;
    // Int64 columns come back as BigInt, so convert to number
    version: row.version != null ? Number(row.version) : 1,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Strip the vector field, for API responses.
 */
export function withoutVector(entry: MemoryEntry): Omit<MemoryEntry, 'vector'> {
  const copy: Partial<MemoryEntry> = { ...entry };
  delete copy.vector;
  return copy as Omit<MemoryEntry, 'vector'>;
}
