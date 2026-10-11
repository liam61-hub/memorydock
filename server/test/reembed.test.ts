import { describe, expect, it, vi } from 'vitest';
import { reembedAll, type ReembedContext } from '../src/modules/reembed/index.js';

/** A row mirroring the memory_entries LanceDB schema. */
function entryRow(id: string, content: string): Record<string, unknown> {
  return {
    id,
    tenant_id: 'default',
    title: `title-${id}`,
    content,
    content_type: 'note',
    tags: ['a'],
    source: '',
    status: 'active',
    metadata: '{}',
    vector: [0, 0, 0],
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function chunkRow(parentId: string, index: number, content: string): Record<string, unknown> {
  return {
    id: `${parentId}-c${index}`,
    parent_id: parentId,
    tenant_id: 'default',
    chunk_index: index,
    content,
    vector: [0, 0, 0],
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function makeCtx(overrides: Partial<ReembedContext> = {}): {
  ctx: ReembedContext;
  writeSpy: ReturnType<typeof vi.fn>;
  embedCalls: string[];
} {
  const embedCalls: string[] = [];
  const writeSpy = vi.fn().mockResolvedValue(undefined);
  const ctx: ReembedContext = {
    loadRows: async () => ({
      entries: [entryRow('e1', 'first entry'), entryRow('e2', 'second entry')],
      chunks: [chunkRow('e1', 0, 'first chunk')],
    }),
    embed: async (text) => {
      embedCalls.push(text);
      return [1, 2, 3, 4]; // 4-dim vectors
    },
    writeRows: writeSpy,
    log: () => {},
    ...overrides,
  };
  return { ctx, writeSpy, embedCalls };
}

describe('reembedAll', () => {
  it('re-embeds every entry and chunk, preserving all other fields', async () => {
    const { ctx, writeSpy, embedCalls } = makeCtx();

    const result = await reembedAll(ctx);
    expect(result).toEqual({ entries: 2, chunks: 1, dim: 4 });

    const written = writeSpy.mock.calls[0][0] as { entries: Record<string, unknown>[]; chunks: Record<string, unknown>[] };
    expect(written.entries).toHaveLength(2);
    expect(written.chunks).toHaveLength(1);

    // Vectors replaced with new dim, everything else preserved
    for (const row of written.entries) {
      expect(row.vector).toEqual([1, 2, 3, 4]);
      expect(row.id).toBe(row.id === 'e1' ? 'e1' : 'e2');
      expect(row.content_type).toBe('note');
      expect(row.created_at).toBe('2026-01-01T00:00:00.000Z');
    }
    expect(written.chunks[0].vector).toEqual([1, 2, 3, 4]);
    expect(written.chunks[0].parent_id).toBe('e1');

    // Every unique text was embedded exactly once
    expect(embedCalls).toEqual(['first entry', 'second entry', 'first chunk']);
  });

  it('writes nothing if embedding fails midway (existing table stays intact)', async () => {
    let calls = 0;
    const { ctx, writeSpy } = makeCtx({
      embed: async () => {
        calls++;
        if (calls === 2) throw new Error('embedding api down');
        return [1, 1, 1, 1];
      },
    });

    await expect(reembedAll(ctx)).rejects.toThrow('embedding api down');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('rebuilds an empty dataset so its vector schema follows the active model', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const ctx: ReembedContext = {
      loadRows: async () => ({ entries: [], chunks: [] }),
      embed: async () => [1],
      writeRows: writeSpy,
    };

    const result = await reembedAll(ctx);
    expect(result).toEqual({ entries: 0, chunks: 0, dim: 0 });
    expect(writeSpy).toHaveBeenCalledWith({ entries: [], chunks: [] });
  });
});
