import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from './config.js';
import { ensureServerRunning } from './ensure-server.js';

const baseUrl = process.env.MEMORYDOCK_API_URL || `http://${config.host}:${config.port}`;
const packageVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function reportStartup(extra: ToolExtra): void {
  console.error('MemoryDock: starting the local service...');
  const progressToken = extra._meta?.progressToken;
  if (progressToken !== undefined) {
    void extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken, progress: 0, total: 1, message: 'Starting MemoryDock service' },
    }).catch(() => {});
  }
}

async function api<T>(path: string, init: RequestInit = {}, extra?: ToolExtra): Promise<T> {
  await ensureServerRunning(() => { if (extra) reportStartup(extra); });
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json() as { status: boolean; data?: T; message?: string };
  if (!response.ok || !body.status) throw new Error(body.message || `MemoryDock API error ${response.status}`);
  return body.data as T;
}

function text(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }; }

export async function runMcp(): Promise<void> {
  const server = new McpServer({ name: 'memorydock', version: packageVersion });
  server.tool('search_memory', 'Search approved local memories. Project memories should be preferred when relevant.', {
    query: z.string(), top_k: z.number().min(1).max(20).optional(), tags: z.string().optional(),
  }, async (args, extra) => text(await api('/api/search', { method: 'POST', body: JSON.stringify({ query: args.query, top_k: args.top_k, tags: args.tags?.split(',').map(tag => tag.trim()) }) }, extra)));
  server.tool('list_memories', 'List approved local memories without a search query. Use page and page_size to retrieve every page.', {
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(100).optional(),
    content_type: z.enum(['project', 'note', 'article', 'doc', 'personal_info']).optional(),
    tags: z.string().optional(),
  }, async (args, extra) => {
    const params = new URLSearchParams();
    if (args.page !== undefined) params.set('page', String(args.page));
    if (args.page_size !== undefined) params.set('page_size', String(args.page_size));
    if (args.content_type) params.set('content_type', args.content_type);
    if (args.tags) params.set('tags', args.tags);
    return text(await api(`/api/memories?${params}`, {}, extra));
  });
  server.tool('propose_memory', 'Propose a durable memory after useful work. Format structured content as Markdown; the server stores it verbatim. This never becomes searchable until the person approves it in MemoryDock.', {
    title: z.string(), content: z.string().describe('Markdown body. Use headings and lists for structured notes; wrap file paths and commands in code spans.'), content_type: z.string().default('note'), tags: z.string().optional(), source: z.string().optional(),
  }, async (args, extra) => text(await api('/api/memories/proposals', { method: 'POST', body: JSON.stringify({ ...args, tags: args.tags?.split(',').map(tag => tag.trim()), source: args.source || 'agent' }) }, extra)));
  server.tool('push_memory', 'Save a memory directly only when the user explicitly asks to save or remember it. Format structured content as Markdown; the server stores it verbatim.', {
    title: z.string(), content: z.string().describe('Markdown body. Use headings and lists for structured notes; wrap file paths and commands in code spans.'), content_type: z.string().default('note'), tags: z.string().optional(), source: z.string().optional(),
  }, async (args, extra) => text(await api('/api/ingest', { method: 'POST', body: JSON.stringify({ ...args, tags: args.tags?.split(',').map(tag => tag.trim()), source: args.source || 'agent' }) }, extra)));
  server.tool('update_memory', 'Update an approved memory only when the user explicitly asks to change it.', {
    id: z.string(), title: z.string().optional(), content: z.string().describe('Replacement Markdown body; stored verbatim.').optional(), append_content: z.string().describe('Markdown to append; stored verbatim.').optional(), version: z.number().optional(), tags: z.string().optional(), parent_id: z.string().nullable().optional(),
  }, async (args, extra) => text(await api(`/api/memories/${args.id}`, { method: 'PUT', body: JSON.stringify({ ...args, tags: args.tags?.split(',').map(tag => tag.trim()) }) }, extra)));
  await server.connect(new StdioServerTransport());
  void ensureServerRunning(() => { console.error('MemoryDock: starting the local service...'); })
    .catch(error => { console.error(`MemoryDock: ${(error as Error).message}`); });
}
