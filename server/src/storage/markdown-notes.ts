import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { userDataDir } from '../local-config.js';
import type { MemoryEntry } from '../types.js';

function quote(value: string): string { return JSON.stringify(value); }

function frontmatter(entry: MemoryEntry): string {
  return [
    '---', `id: ${quote(entry.id)}`, `title: ${quote(entry.title)}`,
    `content_type: ${quote(entry.content_type)}`, `tags: ${JSON.stringify(entry.tags)}`,
    `source: ${quote(entry.source)}`, `status: ${quote(entry.status)}`,
    `review_status: ${quote(entry.review_status || 'approved')}`,
    `parent_id: ${entry.parent_id ? quote(entry.parent_id) : 'null'}`,
    `metadata: ${JSON.stringify(entry.metadata)}`, `version: ${entry.version}`,
    `created_at: ${quote(entry.created_at)}`, `updated_at: ${quote(entry.updated_at)}`,
    '---', '',
  ].join('\n');
}

export function notesRoot(): string {
  return path.resolve(process.env.MEMORYDOCK_NOTES_PATH || path.join(userDataDir(), 'notes'));
}

export function notePath(id: string): string { return path.join(notesRoot(), `${id}.md`); }

export async function writeMarkdownNote(entry: MemoryEntry): Promise<void> {
  const root = notesRoot();
  await fs.mkdir(root, { recursive: true });
  const file = notePath(entry.id);
  if (entry.version > 1) {
    const historyDir = path.join(root, '.history', entry.id);
    await fs.mkdir(historyDir, { recursive: true });
    try { await fs.copyFile(file, path.join(historyDir, `v${entry.version - 1}.md`)); } catch { /* New note. */ }
  }
  await fs.writeFile(file, `${frontmatter(entry)}${entry.content.trimEnd()}\n`, 'utf8');
}

export async function removeMarkdownNote(id: string): Promise<void> { await fs.rm(notePath(id), { force: true }); }
