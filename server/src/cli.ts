#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { startServer } from './index.js';
import { createBackup } from './modules/backup/index.js';
import { buildLanceReembedContext, reembedAll } from './modules/reembed/index.js';
import { configuredEmbedding, saveLocalSettings, type EmbeddingProvider } from './local-config.js';
import { userDataDir } from './local-config.js';
import { config } from './config.js';
import { notesRoot } from './storage/markdown-notes.js';
import { writeMarkdownNote } from './storage/markdown-notes.js';
import { migrateStorage } from './storage/migrate-storage.js';
import { getTable } from './db/lancedb.js';
import { fromRow } from './db/schema.js';
import { runMcp } from './mcp.js';
import { ensureServerRunning } from './ensure-server.js';

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return true;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
export interface ParsedArgs {
  command: 'serve' | 'mcp' | 'init' | 'doctor' | 'export' | 'rebuild-notes' | 'migrate-storage' | 'reembed' | 'version' | 'help';
  flags: string[];
  /** `--name value` pairs (e.g. { from: '<path>' }). */
  options: Record<string, string>;
}
export function parseCliArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv; const flags = rest.filter(a => a.startsWith('-'));
  const options: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('-')) continue;
    options[arg.slice(2)] = value;
    i += 1;
  }
  if (cmd === '--version' || cmd === '-v') return { command: 'version', flags, options };
  if (['serve', 'mcp', 'init', 'doctor', 'export', 'rebuild-notes', 'migrate-storage', 'reembed'].includes(cmd || '')) return { command: cmd as ParsedArgs['command'], flags, options };
  return { command: 'help', flags, options };
}
function printHelp(): void { console.log(`MemoryDock — local-first AI agent memory

Usage:
  memorydock init            Configure and test an embedding provider
  memorydock serve           Start the local API and memory console
  memorydock mcp             Start the local stdio MCP adapter
  memorydock doctor          Print configuration and storage health
  memorydock export <path>   Copy Markdown notes to a portable directory
  memorydock rebuild-notes --yes
                             Rebuild Markdown notes from the memory index
  memorydock migrate-storage --from <path> --yes
                             Move a pre-2.0 index into ~/.memorydock
                             (stop "memorydock serve" first)
  memorydock reembed --yes   Rebuild vectors with the configured model
`); }
function printVersion(): void { console.log((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version); }
async function promptSecret(prompt: string): Promise<string> {
  if (!input.isTTY) throw new Error('API key input requires an interactive terminal');
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { input.off('data', onData); input.setRawMode(false); };
    const onData = (chunk: Buffer) => {
      const char = chunk.toString('utf8');
      if (char === '\r' || char === '\n') {
        cleanup(); output.write('\n'); resolve(value); return;
      }
      if (char === '\u0003') { cleanup(); output.write('\n'); reject(new Error('Configuration cancelled')); return; }
      if (char === '\b' || char === '\u007f') { if (value) { value = value.slice(0, -1); output.write('\b \b'); } return; }
      if (!char.startsWith('\u001b')) { value += char; output.write('*'); }
    };
    input.on('data', onData);
  });
}
async function runReembed(flags: string[]): Promise<void> {
  if (!flags.includes('--yes')) throw new Error('This rebuilds vectors in place; rerun with --yes.');
  if (flags.includes('--backup')) await createBackup();
  const result = await reembedAll(await buildLanceReembedContext(console.log));
  console.log(`Re-embed complete: ${result.entries} entries, ${result.chunks} chunks.`);
}
async function runInit(): Promise<void> {
  if (!input.isTTY) throw new Error('memorydock init requires an interactive terminal');
  const rl = createInterface({ input, output });
  let readlineClosed = false;
  try {
    const raw = (await rl.question('Embedding provider (ollama/openai/compatible) [ollama]: ')).trim() || 'ollama';
    if (!['ollama', 'openai', 'compatible'].includes(raw)) throw new Error('Choose ollama, openai, or compatible');
    const provider = raw as EmbeddingProvider;
    const defaultBase = provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : 'https://api.openai.com/v1';
    const baseUrl = (await rl.question(`Base URL [${defaultBase}]: `)).trim() || defaultBase;
    const defaultModel = provider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small';
    const model = (await rl.question(`Embedding model [${defaultModel}]: `)).trim() || defaultModel;
    const defaultDim = provider === 'ollama' ? 768 : 1536;
    const dim = Number((await rl.question(`Embedding dimension [${defaultDim}]: `)).trim() || String(defaultDim));
    if (!Number.isInteger(dim) || dim < 1) throw new Error('Embedding dimension must be a positive integer');
    rl.close();
    readlineClosed = true;
    const apiKey = provider === 'ollama' ? '' : await promptSecret('API key: ');
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model, input: 'MemoryDock configuration check' }), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Provider test failed: ${response.status} ${await response.text()}`);
    const result = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const actualDim = result.data?.[0]?.embedding?.length;
    if (!actualDim) throw new Error('Provider test returned no embedding');
    if (actualDim !== dim) throw new Error(`Provider returned dimension ${actualDim}; run init again with that dimension`);
    console.log(`Configuration saved to ${saveLocalSettings({ embedding: { provider, baseUrl, apiKey, model, dim } })}`);
    console.log('Restart any running "memorydock serve" process to apply this configuration.');
  } finally { if (!readlineClosed) rl.close(); }
}
async function runDoctor(): Promise<void> {
  const embedding = configuredEmbedding();
  const root = notesRoot();
  const notesExist = await fs.stat(root).then(() => true).catch(() => false);
  const indexExists = await fs.stat(config.lancedb.path).then(() => true).catch(() => false);
  const entries = indexExists ? await (await getTable()).countRows() : 0;
  console.log(JSON.stringify({
    home: userDataDir(),
    index_path: config.lancedb.path,
    index_path_exists: indexExists,
    memory_entry_count: entries,
    notes_path: root,
    notes_path_exists: notesExist,
    backups_path: path.join(userDataDir(), 'backups'),
    migrations_path: path.join(userDataDir(), 'migrations'),
    embedding: embedding ? { provider: embedding.provider, baseUrl: embedding.baseUrl, model: embedding.model, dim: embedding.dim, apiKey: embedding.apiKey ? 'configured' : 'not required' } : 'not configured',
  }, null, 2));
}
async function runExport(): Promise<void> {
  const destination = process.argv.slice(3).find(arg => !arg.startsWith('-'));
  if (!destination) throw new Error('Usage: memorydock export <directory>');
  await fs.cp(notesRoot(), path.resolve(destination), { recursive: true, force: true });
  console.log(`Exported Markdown notes to ${path.resolve(destination)}`);
}
async function runRebuildNotes(flags: string[]): Promise<void> {
  if (!flags.includes('--yes')) throw new Error('This creates Markdown mirrors of existing entries; rerun with --yes.');
  const rows = await (await getTable()).query().limit(10000).toArray();
  for (const row of rows) await writeMarkdownNote(fromRow(row));
  console.log(`Migrated ${rows.length} entries to ${notesRoot()}`);
}
async function runMigrateStorage(parsed: ParsedArgs): Promise<void> {
  if (!parsed.flags.includes('--yes')) throw new Error('Storage migration requires explicit confirmation; rerun with --yes.');
  const source = parsed.options.from;
  if (!source) throw new Error('Usage: memorydock migrate-storage --from <path> --yes (stop "memorydock serve" first)');
  const result = await migrateStorage(source);
  console.log(JSON.stringify(result, null, 2));
}
async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  switch (parsed.command) {
    case 'serve': await startServer(); return;
    case 'mcp': await ensureServerRunning(); await runMcp(); return;
    case 'init': await runInit(); return;
    case 'doctor': await runDoctor(); return;
    case 'export': await runExport(); return;
    case 'rebuild-notes': await runRebuildNotes(parsed.flags); return;
    case 'migrate-storage': await runMigrateStorage(parsed); return;
    case 'reembed': await runReembed(parsed.flags); return;
    case 'version': printVersion(); return;
    default: printHelp(); return;
  }
}
if (isMainModule()) main().catch(error => { console.error(`memorydock: ${(error as Error).message}`); process.exit(1); });
