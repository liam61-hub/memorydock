import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Must be set before dynamically importing app modules (config.ts reads env at module load).
// test/setup-env.ts provides a per-file throwaway MEMORYDOCK_INDEX_PATH.
if (!process.env.MEMORYDOCK_INDEX_PATH) throw new Error('setup-env must provide MEMORYDOCK_INDEX_PATH');

vi.mock('../src/modules/embedding/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/embedding/index.js')>();
  return { ...actual, embed: vi.fn() };
});

/** Mutable state for the child_process mock (reset in afterEach). */
const mockExec = { targets: [] as string[], failClone: false };

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const fs = await import('node:fs');
  const path = await import('node:path');
  return {
    ...actual,
    execFile: (
      cmd: string,
      args: string[],
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      if (cmd === 'git' && args[0] === 'clone') {
        if (mockExec.failClone) {
          cb(new Error('mock clone failure'), { stdout: '', stderr: '' });
          return;
        }
        const target = args[args.length - 1];
        mockExec.targets.push(target);
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, 'README.md'), 'Mocked clone README');
        cb(null, { stdout: '', stderr: '' });
        return;
      }
      cb(new Error(`unexpected execFile: ${cmd} ${args.join(' ')}`), { stdout: '', stderr: '' });
    },
  };
});

let registerProjectRoutes: (app: FastifyInstance) => Promise<void>;
let resetConnection: () => void;
let embedMock: ReturnType<typeof vi.fn>;
let isImportTmpDir: (dir: string) => boolean;

const vec8 = () => new Array(8).fill(0.1);

beforeAll(async () => {
  const project = await import('../src/modules/project/index.js');
  registerProjectRoutes = project.registerProjectRoutes;
  isImportTmpDir = project.isImportTmpDir;
  const db = await import('../src/db/lancedb.js');
  resetConnection = db.resetConnection;
  const emb = await import('../src/modules/embedding/index.js');
  embedMock = vi.mocked(emb.embed);
});

afterEach(() => {
  resetConnection();
  embedMock.mockReset();
  mockExec.targets.length = 0;
  mockExec.failClone = false;
});

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerProjectRoutes(app);
  return app;
}

/** Poll a task until it leaves 'processing' */
async function pollTask(app: FastifyInstance, taskId: string) {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/projects/import/${taskId}` });
    expect(res.statusCode).toBe(200);
    const task = res.json().data as { status: string; error?: string };
    if (task.status !== 'processing') return task;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('task did not finish');
}

describe('isImportTmpDir', () => {
  it('accepts only dirs this module created', () => {
    const tmp = path.resolve(os.tmpdir());
    expect(isImportTmpDir(path.join(tmp, 'memorydock-import-abc'))).toBe(true);
    expect(isImportTmpDir(process.cwd())).toBe(false);
    expect(isImportTmpDir(path.join(tmp, 'not-an-import'))).toBe(false);
    // traversal back out of the tmp dir
    expect(isImportTmpDir(path.join(tmp, 'memorydock-import-a', '..', '..'))).toBe(false);
    // filesystem root and the tmp dir itself
    expect(isImportTmpDir(path.parse(tmp).root)).toBe(false);
    expect(isImportTmpDir(tmp)).toBe(false);
  });
});

describe('POST /api/projects/scan', () => {
  it('imports a local dir and never deletes it', async () => {
    const app = await buildApp();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorydock-scan-'));
    fs.writeFileSync(path.join(dir, 'README.md'), 'Fastify + LanceDB demo project');
    embedMock.mockResolvedValue(vec8());

    const start = await app.inject({
      method: 'POST', url: '/api/projects/scan', payload: { local_path: dir },
    });
    expect(start.statusCode).toBe(202);
    const taskId = start.json().data.task_id;

    const task = await pollTask(app, taskId);
    expect(task.status).toBe('completed');

    const list = await app.inject({ method: 'GET', url: '/api/projects' });
    const items = list.json().data.items as Array<{ name: string }>;
    expect(items.some(i => i.name === path.basename(dir))).toBe(true);

    // the cleanup guard must never delete non-import paths
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('POST /api/projects/import', () => {
  it('clones into the OS temp dir and removes it after completion', async () => {
    const app = await buildApp();
    embedMock.mockResolvedValue(vec8());

    const start = await app.inject({
      method: 'POST', url: '/api/projects/import', payload: { repo_url: 'https://example.com/demo.git' },
    });
    expect(start.statusCode).toBe(202);
    const taskId = start.json().data.task_id;

    const task = await pollTask(app, taskId);
    expect(task.status).toBe('completed');

    expect(mockExec.targets).toHaveLength(1);
    const target = mockExec.targets[0];
    const tmp = path.resolve(os.tmpdir());
    // cloned inside the OS temp dir, with this module's prefix
    expect(path.resolve(target).startsWith(tmp + path.sep)).toBe(true);
    expect(path.basename(target).startsWith('memorydock-import-')).toBe(true);
    // cleaned up after the task completed
    expect(fs.existsSync(target)).toBe(false);

    // the imported entry is listed
    const list = await app.inject({ method: 'GET', url: '/api/projects' });
    const items = list.json().data.items as Array<{ name: string }>;
    expect(items.some(i => i.name === 'demo')).toBe(true);
  });

  it('cleans up the clone dir when embedding fails', async () => {
    const app = await buildApp();
    embedMock.mockRejectedValueOnce(new Error('embedding down'));

    const start = await app.inject({
      method: 'POST', url: '/api/projects/import', payload: { repo_url: 'https://example.com/demo.git' },
    });
    const taskId = start.json().data.task_id;

    const task = await pollTask(app, taskId);
    expect(task.status).toBe('failed');
    expect(task.error).toContain('embedding down');

    expect(mockExec.targets).toHaveLength(1);
    expect(fs.existsSync(mockExec.targets[0])).toBe(false);
  });
});
