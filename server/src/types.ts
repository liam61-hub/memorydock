/** Memory entry content type */
export type ContentType = 'project' | 'note' | 'article' | 'doc' | 'personal_info';

/** Entry status */
export type EntryStatus = 'active' | 'archived';
export type ReviewStatus = 'pending' | 'approved';

/** Memory entry (LanceDB storage schema) */
export interface MemoryEntry {
  id: string;
  tenant_id: string;
  title: string;
  content: string;
  content_type: ContentType;
  tags: string[];
  source: string;
  status: EntryStatus;
  review_status: ReviewStatus;
  parent_id: string | null;
  metadata: Record<string, unknown>;
  vector: number[];
  /** Optimistic-lock version: incremented on every write (integer); used for conflict detection on full replace */
  version: number;
  created_at: string;
  updated_at: string;
}

/** Entry returned by the API (no vector) */
export type MemoryEntryResponse = Omit<MemoryEntry, 'vector'>;

/** Create entry request */
export interface CreateEntryRequest {
  title: string;
  content: string;
  content_type: ContentType;
  tags?: string[];
  source?: string;
  status?: EntryStatus;
  metadata?: Record<string, unknown>;
  parent_id?: string | null;
}

/** Update entry request */
export interface UpdateEntryRequest {
  title?: string;
  /**
   * Full-replace mode: supply the new content.
   * Must also carry version (the current version number); a mismatch returns
   * 409 to prevent silent overwrites.
   */
  content?: string;
  /**
   * Append mode: append text to the end of the existing content; the server
   * merges it inside the lock, so no version is required and concurrent
   * appends are both preserved.
   * Mutually exclusive with content.
   */
  append_content?: string;
  /** Optimistic-lock version: required when replacing content */
  version?: number;
  /** New content type (values outside the enum return 400) */
  content_type?: ContentType;
  tags?: string[];
  status?: EntryStatus;
  metadata?: Record<string, unknown>;
  parent_id?: string | null;
}

/** Search sort order */
export type SearchSortBy = 'relevance' | 'created_at' | 'updated_at';

/** Search request */
export interface SearchRequest {
  query: string;
  content_type?: ContentType;
  tags?: string[];
  status?: EntryStatus;
  top_k?: number;
  /** ISO date string; filter entries created after this time */
  created_after?: string;
  /** ISO date string; filter entries created before this time */
  created_before?: string;
  /** Sort order; defaults to relevance (highest relevance first) */
  sort_by?: SearchSortBy;
}

/** Search result item (internal use; includes vector) */
export interface SearchResultItem {
  entry: MemoryEntry;
  score: number;
}

/** Search response (returned by the API; no vector) */
export interface SearchResponse {
  items: { entry: MemoryEntryResponse; score: number; matched_chunks?: ChunkMatch[] }[];
  total: number;
  degraded: boolean;
  suggestion?: string;
}

/** Import project request */
export interface ImportProjectRequest {
  repo_url?: string;
  local_path?: string;
}

/** Async task status */
export interface TaskStatus {
  task_id: string;
  status: 'processing' | 'completed' | 'failed';
  progress?: string;
  result?: unknown;
  error?: string;
}

/** Chunk information */
export interface ChunkInfo {
  id: string;
  parent_id: string;
  tenant_id: string;
  chunk_index: number;
  content: string;
  vector: number[];
  created_at: string;
}

/** Chunk match details for a search hit */
export interface ChunkMatch {
  chunk_index: number;
  content_preview: string; // preview of the first 200 characters
  score: number;
}
