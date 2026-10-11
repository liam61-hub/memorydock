import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

let mod: typeof import('../src/modules/backup/index.js');
let indexDir: string;
let backupDir: string;

beforeAll(async () => {
  mod = await import('../src/modules/backup/index.js');
  ({ indexDir, backupDir } = mod.backupPaths());
});

afterEach(() => {
  rmSync(indexDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe('backup module', () => {
  it('archives the index directory into the backups directory', async () => {
    mkdirSync(path.join(indexDir, 'tables'), { recursive: true });
    writeFileSync(path.join(indexDir, 'tables', 'a.lance'), 'payload');

    const { name, size } = await mod.createBackup();
    expect(name).toMatch(/^memory-.*\.tar\.gz$/);
    expect(size).toBeGreaterThan(0);
    expect(existsSync(path.join(backupDir, name))).toBe(true);

    const listing = execFileSync('tar', ['-tzf', name], { cwd: backupDir }).toString();
    expect(listing).toContain('index/');
    expect(listing).toContain('a.lance');
  });

  it('restores a backup over the live index (in place, newer files kept)', async () => {
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(path.join(indexDir, 'A.txt'), 'A');

    const { name } = await mod.createBackup();
    rmSync(path.join(indexDir, 'A.txt'), { force: true });
    writeFileSync(path.join(indexDir, 'B.txt'), 'B');

    await mod.restoreBackup(name);
    expect(readFileSync(path.join(indexDir, 'A.txt'), 'utf-8')).toBe('A');
    expect(readFileSync(path.join(indexDir, 'B.txt'), 'utf-8')).toBe('B');
  });

  it('throws when the index directory does not exist', async () => {
    rmSync(indexDir, { recursive: true, force: true });
    await expect(mod.createBackup()).rejects.toThrow(/does not exist/);
  });

  it('keeps at most 28 backups, oldest rotated out', async () => {
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(path.join(indexDir, 'x.txt'), 'x');
    mkdirSync(backupDir, { recursive: true });
    for (let i = 0; i < 30; i++) {
      const seeded = `memory-2026-01-${String(i + 1).padStart(2, '0')}T00-00-00-000Z.tar.gz`;
      writeFileSync(path.join(backupDir, seeded), 'stub');
    }

    await mod.createBackup(); // creates the 31st backup
    const files = readdirSync(backupDir).filter(f => f.startsWith('memory-') && f.endsWith('.tar.gz'));
    expect(files.length).toBe(28);
    expect(mod.listBackups(backupDir).length).toBe(28);
    // the oldest seeded files were rotated out
    expect(files).not.toContain('memory-2026-01-01T00-00-00-000Z.tar.gz');
    expect(files).not.toContain('memory-2026-01-02T00-00-00-000Z.tar.gz');
    expect(files).not.toContain('memory-2026-01-03T00-00-00-000Z.tar.gz');
  });

  it('rejects a traversal name on restore', async () => {
    await expect(mod.restoreBackup('../evil.tar.gz')).rejects.toThrow(/Invalid backup name/);
  });

  it('rejects a missing backup file on restore', async () => {
    await expect(mod.restoreBackup('memory-2099-01-01T00-00-00-000Z.tar.gz')).rejects.toThrow(/not found/);
  });
});
