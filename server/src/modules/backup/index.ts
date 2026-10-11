import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { userDataDir } from '../../local-config.js';

const MAX_BACKUPS = 28; // 7 days × 4 backups/day = 28
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BACKUP_PREFIX = 'memory-';

let backupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Derive backup paths from the MemoryDock data root and the index directory.
 * All returned paths are absolute; tar itself only ever receives relative
 * paths (see `createBackup`), because MSYS/Git Bash tar interprets a leading
 * "D:/..." destination as a remote host ("host:path").
 */
export function backupPaths() {
  const homeDir = userDataDir();
  const indexDir = config.lancedb.path;
  return {
    homeDir,
    indexDir,
    indexName: path.basename(indexDir),
    backupDir: path.join(homeDir, 'backups'),
  };
}

/** Generate a timestamped backup file name, with an optional collision suffix. */
function backupName(counter = 0): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = counter === 0 ? '' : `-${counter}`;
  return `${BACKUP_PREFIX}${ts}${suffix}.tar.gz`;
}

/** Timestamped name that does not collide with existing files in `backupDir`. */
function uniqueBackupName(backupDir: string): string {
  let counter = 0;
  let candidate = backupName(counter);
  while (fs.existsSync(path.join(backupDir, candidate))) {
    counter += 1;
    candidate = backupName(counter);
  }
  return candidate;
}

/**
 * Run tar with an argument vector — never a shell string, never a drive-letter
 * path. `cwd` is fixed so every archive path stays relative. Only portable
 * flags (`-czf`, `-xzf`) are used: both GNU tar and Windows bsdtar accept them.
 */
function runTar(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`tar ${args.join(' ')} failed in ${cwd}: ${(stderr || error.message).trim()}`, { cause: error }));
        return;
      }
      resolve();
    });
  });
}

/** Relative path when `to` is reachable from `from` without a drive letter, else null. */
function safeRelative(from: string, to: string): string | null {
  const rel = path.relative(from, to);
  return !rel || path.isAbsolute(rel) ? null : rel;
}

function moveFile(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch {
    // Cross-volume fallback: copy and unlink.
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}

/**
 * Create a tar.gz backup of the LanceDB index directory into
 * `<MEMORYDOCK_HOME>/backups` as `memory-<timestamp>.tar.gz`.
 *
 * The archive contains the bare index directory (e.g. members `index/...`).
 * Markdown notes are deliberately excluded: they are canonical user-owned
 * files, while the index is the derived artifact backups exist to protect.
 */
export async function createBackup(): Promise<{ name: string; size: number }> {
  const { homeDir, indexDir, indexName, backupDir } = backupPaths();
  if (!fs.existsSync(indexDir)) {
    throw new Error(`Memory index directory does not exist: ${indexDir}`);
  }
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const name = uniqueBackupName(backupDir);
  const destination = path.join(backupDir, name);
  const relativeIndex = safeRelative(homeDir, indexDir);

  if (relativeIndex) {
    // Normal case: the index lives under MEMORYDOCK_HOME. cwd = home, so both
    // the archive path and the index path stay relative.
    await runTar(['-czf', path.join('backups', name), relativeIndex], homeDir);
  } else {
    // Index on another volume: build the archive beside the index with
    // relative paths, then move it into the backups directory.
    const staged = path.join(path.dirname(indexDir), `.${name}.partial`);
    try {
      await runTar(['-czf', path.basename(staged), indexName], path.dirname(indexDir));
      moveFile(staged, destination);
    } finally {
      fs.rmSync(staged, { force: true });
    }
  }

  const size = fs.statSync(destination).size;
  rotateBackups(backupDir);

  return { name, size };
}

/** Rotate old backups, keeping the most recent MAX_BACKUPS files. */
function rotateBackups(backupDir: string) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith(BACKUP_PREFIX) && f.endsWith('.tar.gz'))
      .sort(); // names contain timestamps, so lexicographic sort = chronological

    while (files.length > MAX_BACKUPS) {
      const oldest = files.shift()!;
      fs.unlinkSync(path.join(backupDir, oldest));
    }
  } catch {
    // rotation failure must not block backups
  }
}

/** List all backups, newest first. */
export function listBackups(backupDir: string): { name: string; size: number; created: string }[] {
  if (!fs.existsSync(backupDir)) return [];

  return fs.readdirSync(backupDir)
    .filter(f => f.startsWith(BACKUP_PREFIX) && f.endsWith('.tar.gz'))
    .sort()
    .reverse()
    .map(f => {
      const stat = fs.statSync(path.join(backupDir, f));
      return { name: f, size: stat.size, created: stat.birthtime.toISOString() };
    });
}

/** Resolve a backup file inside the backups directory (no traversal, no subdirs). */
export function resolveBackupFile(name: string): string {
  const { backupDir } = backupPaths();
  if (name !== path.basename(name)) throw new Error('Invalid backup name');
  const file = path.join(backupDir, name);
  if (!fs.existsSync(file)) throw new Error(`Backup file not found: ${name}`);
  return file;
}

/**
 * Restore a backup over the live index. Takes a safety snapshot of the current
 * state first, then extracts in place. The caller must stop `memorydock serve`
 * before restoring: in-place extraction over a live index can fail on Windows
 * file locks.
 */
export async function restoreBackup(name: string): Promise<void> {
  const { homeDir, indexDir, backupDir } = backupPaths();
  resolveBackupFile(name);
  await createBackup(); // safety snapshot of the current state

  const relativeIndex = safeRelative(homeDir, indexDir);
  if (relativeIndex) {
    await runTar(['-xzf', path.join('backups', name)], homeDir);
    return;
  }
  const staged = path.join(path.dirname(indexDir), `.restore-${name}`);
  fs.copyFileSync(path.join(backupDir, name), staged);
  try {
    await runTar(['-xzf', path.basename(staged)], path.dirname(indexDir));
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

/**
 * Register the backup management routes.
 */
export async function registerBackupRoutes(app: FastifyInstance) {

  // Manual backup trigger (localhost only)
  app.post('/api/admin/backup', async (request, reply) => {
    const ip = request.ip || '';
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return reply.status(403).send({ status: false, message: 'Admin endpoints are localhost-only' });
    }

    try {
      const result = await createBackup();
      request.log?.info({ backup: result.name, size: result.size }, 'Manual backup created');
      return reply.status(201).send({
        status: true,
        data: { name: result.name, size_bytes: result.size },
      });
    } catch (err) {
      request.log?.error({ err: (err as Error).message }, 'Backup failed');
      return reply.status(500).send({ status: false, message: `Backup failed: ${(err as Error).message}` });
    }
  });

  // List backups (localhost only)
  app.get('/api/admin/backups', async (request, reply) => {
    const ip = request.ip || '';
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return reply.status(403).send({ status: false, message: 'Admin endpoints are localhost-only' });
    }

    return reply.send({ status: true, data: listBackups(backupPaths().backupDir) });
  });

  // Restore backup (localhost only)
  app.post<{ Body: { name: string } }>('/api/admin/restore', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const ip = request.ip || '';
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return reply.status(403).send({ status: false, message: 'Admin endpoints are localhost-only' });
    }

    const { name } = request.body;
    try {
      resolveBackupFile(name);
    } catch {
      return reply.status(400).send({ status: false, message: 'Backup file not found' });
    }

    try {
      // restoreBackup takes its own safety snapshot of the current state
      await restoreBackup(name);
      request.log?.info({ backup: name }, 'Restore completed');
      return reply.send({ status: true, message: 'Restore completed. Stop and restart memorydock serve so it reloads the index.' });
    } catch (err) {
      request.log?.error({ err: (err as Error).message }, 'Restore failed');
      return reply.status(500).send({ status: false, message: `Restore failed: ${(err as Error).message}` });
    }
  });
}

/**
 * Start the scheduled backup.
 */
export function startScheduledBackup(app: FastifyInstance) {
  if (backupTimer) return;

  // First backup 5 minutes after startup (once the process has stabilized)
  setTimeout(() => {
    createBackup()
      .then(result => app.log.info({ backup: result.name, size: result.size }, 'Initial backup completed'))
      .catch(err => app.log.error({ err: (err as Error).message }, 'Initial backup failed'));

    // Then back up every 6 hours
    backupTimer = setInterval(() => {
      createBackup()
        .then(result => app.log.info({ backup: result.name, size: result.size }, 'Scheduled backup completed'))
        .catch(err => app.log.error({ err: (err as Error).message }, 'Scheduled backup failed'));
    }, BACKUP_INTERVAL_MS);
  }, 5 * 60 * 1000);
}

/**
 * Stop the scheduled backup.
 */
export function stopScheduledBackup() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}
