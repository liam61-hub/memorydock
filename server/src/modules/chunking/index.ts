/**
 * Long-text chunking module.
 *
 * Strategy: split by paragraphs first, fall back to sentences.
 * - Split on \n\n first (paragraphs)
 * - Paragraphs exceeding chunkSize are split again on sentence boundaries
 *   (CJK full stop, exclamation/question marks, or newline)
 * - Threshold: content longer than 2000 characters triggers chunking
 */

export interface Chunk {
  id: string;
  parent_id: string;
  tenant_id: string;
  chunk_index: number;
  content: string;
}

/** Character count threshold that triggers chunking (~2000 characters, a safe range of roughly 6000-8000 tokens) */
const CHUNK_THRESHOLD = 2000;

/** Target chunk size (in characters) */
const CHUNK_SIZE = 800;

/**
 * Determine whether the content needs chunking.
 */
export function needsChunking(content: string): boolean {
  return content.length > CHUNK_THRESHOLD;
}

/**
 * Split text into paragraphs.
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Split a paragraph into sentences.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？\n])\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Split long text into multiple chunks.
 * @returns Array of chunk contents
 */
export function chunkContent(content: string): string[] {
  const chunks: string[] = [];
  const paragraphs = splitParagraphs(content);

  let currentChunk = '';

  for (const para of paragraphs) {
    // If the paragraph itself is too long, split it into sentences first
    if (para.length > CHUNK_SIZE) {
      // Flush the currently accumulated chunk
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      const sentences = splitSentences(para);
      for (const sent of sentences) {
        if (currentChunk.length + sent.length > CHUNK_SIZE && currentChunk) {
          chunks.push(currentChunk);
          currentChunk = sent;
        } else {
          currentChunk = currentChunk ? currentChunk + '\n' + sent : sent;
        }
      }
      continue;
    }

    // Normal paragraph: try to fit it into the current chunk
    if (currentChunk.length + para.length > CHUNK_SIZE && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = para;
    } else {
      currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
    }
  }

  // Final chunk
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
