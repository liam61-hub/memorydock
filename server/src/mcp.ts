import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from './config.js';

const baseUrl = process.env.MEMORYDOCK_API_URL || `http://${config.host}:${config.port}`;
const packageVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  }, async args => text(await api('/api/search', { method: 'POST', body: JSON.stringify({ query: args.query, top_k: args.top_k, tags: args.tags?.split(',').map(tag => tag.trim()) }) })));
  server.tool('list_memories', 'List approved local memories without a search query. Use page and page_size to retrieve every page.', {
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(100).optional(),
    content_type: z.enum(['project', 'note', 'article', 'doc', 'personal_info']).optional(),
    tags: z.string().optional(),
  }, async args => {
    const params = new URLSearchParams();
    if (args.page !== undefined) params.set('page', String(args.page));
    if (args.page_size !== undefined) params.set('page_size', String(args.page_size));
    if (args.content_type) params.set('content_type', args.content_type);
    if (args.tags) params.set('tags', args.tags);
    return text(await api(`/api/memories?${params}`));
  });
  server.tool('propose_memory', 'Propose a durable memory after useful work. This never becomes searchable until the person approves it in MemoryDock.', {
    title: z.string(), content: z.string(), content_type: z.string().default('note'), tags: z.string().optional(), source: z.string().optional(),
  }, async args => text(await api('/api/memories/proposals', { method: 'POST', body: JSON.stringify({ ...args, tags: args.tags?.split(',').map(tag => tag.trim()), source: args.source || 'agent' }) })));
  server.tool('push_memory', 'Save a memory directly only when the user explicitly asks to save or remember it.', {
    title: z.string(), content: z.string(), content_type: z.string().default('note'), tags: z.string().optional(), source: z.string().optional(),
  }, async args => text(await api('/api/ingest', { method: 'POST', body: JSON.stringify({ ...args, tags: args.tags?.split(',').map(tag => tag.trim()), source: args.source || 'agent' }) })));
  server.tool('update_memory', 'Update an approved memory only when the user explicitly asks to change it.', {
    id: z.string(), title: z.string().optional(), content: z.string().optional(), append_content: z.string().optional(), version: z.number().optional(), tags: z.string().optional(), parent_id: z.string().nullable().optional(),
  }, async args => text(await api(`/api/memories/${args.id}`, { method: 'PUT', body: JSON.stringify({ ...args, tags: args.tags?.split(',').map(tag => tag.trim()) }) })));
  await server.connect(new StdioServerTransport());
}
