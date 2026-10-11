import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import { getTable } from '../../db/lancedb.js';
import { toRow } from '../../db/schema.js';
import { embed } from '../embedding/index.js';
import { config } from '../../config.js';
import type { ImportProjectRequest, TaskStatus } from '../../types.js';

const execFileAsync = promisify(execFile);
const tasks = new Map<string, TaskStatus>();

/** Valid content_type enum values (same as the memory module) */
const VALID_CONTENT_TYPES = new Set(['project', 'note', 'article', 'doc', 'personal_info']);

/** Valid status enum values (same as the memory module) */
const VALID_STATUSES = new Set(['active', 'archived']);

/** Escape single quotes in SQL strings (defensive: applied even after enum validation) */
function escapeSQL(val: string): string {
  return val.replace(/'/g, "''");
}

/** Task TTL: auto-clean completed tasks after 1 hour */
const TASK_COMPLETED_TTL_MS = 60 * 60 * 1000;
/** Keep failed tasks for 24 hours for troubleshooting */
const TASK_FAILED_TTL_MS = 24 * 60 * 60 * 1000;

/** Schedule automatic task cleanup */
function scheduleTaskCleanup(taskId: string, isFailed: boolean) {
  const ttl = isFailed ? TASK_FAILED_TTL_MS : TASK_COMPLETED_TTL_MS;
  setTimeout(() => {
    tasks.delete(taskId);
  }, ttl).unref();
}

/** Prefix of the temporary clone directories created by this module. */
const IMPORT_TMP_PREFIX = 'memorydock-import-';

/** Temp clone target: OS temp dir on every platform (`/tmp`, `%TEMP%`, ...). */
function importTmpDir(): string {
  return path.join(path.resolve(os.tmpdir()), `${IMPORT_TMP_PREFIX}${crypto.randomUUID()}`);
}

/** True only for directories this module created (guard before any deletion). */
export function isImportTmpDir(dir: string): boolean {
  const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(dir));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
    && path.basename(rel).startsWith(IMPORT_TMP_PREFIX);
}

/** Git URL validation (only standard URLs starting with https:// or git@) */
const GIT_URL_RE = /^(https:\/\/|git@)[^\s;|&`$()[\]{}<>\\]+\.git$/;
function isValidGitUrl(url: string): boolean {
  return GIT_URL_RE.test(url);
}

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
 * Get the tenant_id from the request.
 */
function tenantId(request: { tenantId?: string }): string {
  return request.tenantId ?? 'default';
}

export async function registerProjectRoutes(app: FastifyInstance) {

  app.post<{ Body: ImportProjectRequest }>('/api/projects/import', {
    schema: {
      body: {
        type: 'object',
        anyOf: [
          { required: ['repo_url'] },
          { required: ['local_path'] },
        ],
        properties: {
          repo_url: { type: 'string' },
          local_path: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { repo_url, local_path } = request.body;
    if (repo_url && !isValidGitUrl(repo_url)) {
      return reply.status(400).send({ status: false, message: 'Invalid git URL format' });
    }
    const taskId = uuidv4();
    tasks.set(taskId, { task_id: taskId, status: 'processing', progress: 'Starting...' });
    runImport(taskId, repo_url, local_path, tenantId(request)).catch(err => {
      tasks.set(taskId, { task_id: taskId, status: 'failed', error: (err as Error).message });
      scheduleTaskCleanup(taskId, true);
    });
    return reply.status(202).send({ status: true, data: { task_id: taskId, status: 'processing' } });
  });

  app.get<{ Params: { task_id: string } }>('/api/projects/import/:task_id', async (request, reply) => {
    const task = tasks.get(request.params.task_id);
    if (!task) return reply.status(404).send({ status: false, message: 'Task not found' });
    return reply.send({ status: true, data: task });
  });

  app.post<{ Body: ImportProjectRequest }>('/api/projects/scan', {
    schema: {
      body: {
        type: 'object',
        required: ['local_path'],
        properties: {
          local_path: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { local_path } = request.body;
    const taskId = uuidv4();
    tasks.set(taskId, { task_id: taskId, status: 'processing', progress: 'Scanning...' });
    runImport(taskId, undefined, local_path, tenantId(request)).catch(err => {
      tasks.set(taskId, { task_id: taskId, status: 'failed', error: (err as Error).message });
      scheduleTaskCleanup(taskId, true);
    });
    return reply.status(202).send({ status: true, data: { task_id: taskId, status: 'processing' } });
  });

  app.get('/api/projects', async (request, reply) => {
    const query = request.query as {
      content_type?: string; tech_stack?: string; keyword?: string; status?: string;
      sort_by?: string; sort_order?: string; page?: string; page_size?: string;
    };
    const tid = tenantId(request);
    const sortBy = query.sort_by || 'created_at';
    const sortOrder = query.sort_order || 'desc';
    // Pagination: only applied when page_size is explicitly passed (max 100);
    // otherwise return everything — legacy callers such as MCP list_projects
    // used to get the full result set and must not be truncated by default
    const pageSizeRaw = parseInt(query.page_size || '', 10);
    const hasPaging = Number.isInteger(pageSizeRaw) && pageSizeRaw > 0;
    const pageSize = hasPaging ? Math.min(pageSizeRaw, 100) : 0;
    const page = hasPaging ? Math.max(parseInt(query.page || '1', 10), 1) : 1;

    const table = await getTable();

    // Push validated enum filters down into the LanceDB where() clause (invalid values silently ignored, same as the memory module)
    let whereClause = `tenant_id = '${escapeSQL(tid)}'`;
    if (query.content_type && VALID_CONTENT_TYPES.has(query.content_type)) {
      whereClause += ` AND content_type = '${escapeSQL(query.content_type)}'`;
    }
    // Only filter when status is explicitly passed; otherwise return all (keeps legacy MCP list_projects callers working)
    if (query.status && VALID_STATUSES.has(query.status)) {
      whereClause += ` AND status = '${escapeSQL(query.status)}'`;
    }

    const all = await table.query().where(whereClause).limit(2000).toArray();
    const rows = all.map(r => ({
      id: r.id as string,
      tenant_id: r.tenant_id as string,
      name: r.title as string,
      description: (r.content as string).slice(0, 200),
      tech_stack: (r.tags as string[]) || [],
      created_at: r.created_at as string,
      metadata: safeJsonParse(r.metadata),
    }));
    let filtered = rows;
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      filtered = filtered.filter(r => r.name.toLowerCase().includes(kw) || r.description.toLowerCase().includes(kw));
    }
    if (query.tech_stack) {
      const techs = query.tech_stack.split(',');
      filtered = filtered.filter(r => techs.some(t => r.tech_stack.includes(t)));
    }
    // sort
    filtered.sort((a, b) => {
      const va = (a as Record<string, unknown>)[sortBy] as string || '';
      const vb = (b as Record<string, unknown>)[sortBy] as string || '';
      return sortOrder === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });

    // Pagination (only when explicitly requested; otherwise return all and report the actual count as page_size)
    const total = filtered.length;
    const paged = hasPaging ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered;

    return reply.send({
      status: true,
      data: { items: paged, page, page_size: hasPaging ? pageSize : total, total },
    });
  });
}

async function runImport(taskId: string, repoUrl: string | undefined, localPath: string | undefined, tid: string) {
  // Clone into a fresh random dir under the OS temp dir (works on Windows too).
  const tmpDir = repoUrl ? importTmpDir() : undefined;
  const workDir = tmpDir ?? localPath!;

  try {
    if (repoUrl) {
      tasks.set(taskId, { task_id: taskId, status: 'processing', progress: 'Cloning repository...' });
      await execFileAsync('git', ['clone', '--depth', '1', repoUrl, workDir]);
    }

    tasks.set(taskId, { task_id: taskId, status: 'processing', progress: 'Analyzing...' });
    const readme = readOptional(path.join(workDir, 'README.md'));
    const pkgJson = readOptional(path.join(workDir, 'package.json'));
    const pomXml = readOptional(path.join(workDir, 'pom.xml'));

    let summary: string;
    try {
      summary = await generateSummary(readme, pkgJson, pomXml);
    } catch {
      summary = readme.slice(0, 512) || `Imported from ${repoUrl || localPath}`;
    }

    tasks.set(taskId, { task_id: taskId, status: 'processing', progress: 'Embedding...' });
    const vector = await embed(summary);
    const name = repoUrl
      ? repoUrl.split('/').pop()?.replace('.git', '') || repoUrl
      : path.basename(workDir);

    const entry = {
      id: uuidv4(), tenant_id: tid, title: name, content: summary,
      content_type: 'project' as const,
      tags: extractTechStack(readme, pkgJson, pomXml),
      source: repoUrl || `local:${workDir}`,
      status: 'active' as const,
      review_status: 'approved' as const,
      parent_id: null,
      metadata: { repo_url: repoUrl, local_path: localPath },
      vector, version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };

    const table = await getTable();
    await table.add([toRow(entry)]);

    // Do not report completion until the temporary clone has been removed.
    // Callers may poll immediately after seeing the completed state.
    if (tmpDir && isImportTmpDir(tmpDir)) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    tasks.set(taskId, {
      task_id: taskId, status: 'completed', progress: 'Done',
      result: { id: entry.id, name: entry.title },
    });
    scheduleTaskCleanup(taskId, false);
  } finally {
    // Always remove the temp clone dir, including on failure paths.
    if (tmpDir && isImportTmpDir(tmpDir)) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function readOptional(fp: string): string {
  try { return fs.readFileSync(fp, 'utf-8'); } catch { return ''; }
}

async function generateSummary(readme: string, pkgJson: string, pomXml: string): Promise<string> {
  if (!config.llm.apiKey) {
    // LLM not configured: fall back to the README snippet instead of failing.
    return readme.slice(0, 512);
  }

  const sections = [
    readme ? `README:\n${readme.slice(0, 1000)}` : '',
    pkgJson ? `package.json:\n${pkgJson.slice(0, 500)}` : '',
    pomXml ? `pom.xml:\n${pomXml.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n\n');

  const resp = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.llm.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.llm.model, messages: [{ role: 'user', content: `Summarize the following project in about 200 words:\n\n${sections}\n\nProject summary:` }], max_tokens: 300, temperature: 0.3 }),
  });
  if (!resp.ok) throw new Error(`LLM API: ${resp.status}`);
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || readme.slice(0, 512);
}

function extractTechStack(readme: string, pkgJson: string, pomXml: string): string[] {
  const allText = [readme, pkgJson, pomXml].join(' ').toLowerCase();
  const known = ['java','python','javascript','typescript','go','rust','kotlin','spring','vue','react','node.js','nodejs','express','fastify','docker','kubernetes','mysql','postgresql','redis','mongodb','maven','gradle','npm','pnpm','git'];
  return known.filter(t => allText.includes(t));
}
