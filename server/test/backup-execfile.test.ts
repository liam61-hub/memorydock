import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const calls = vi.hoisted(() => [] as Array<{ cmd: string; args: string[]; cwd: string }>);

vi.mock('node:child_process', async () => {
  const fs = await import('node:fs');
  const pathModule = await import('node:path');
  return {
    execFile: (
      cmd: string,
      args: string[],
      options: { cwd: string },
      callback: (error: Error | null) => void,
    ) => {
      calls.push({ cmd, args, cwd: options.cwd });
      // Mocked tar: create the archive file so the caller's statSync succeeds.
      if (cmd === 'tar' && args[0] === '-czf') {
        const file = pathModule.join(options.cwd, args[1]);
        fs.mkdirSync(pathModule.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'stub-archive');
      }
      callback(null);
    },
  };
});

let mod: typeof import('../src/modules/backup/index.js');

beforeAll(async () => {
  mod = await import('../src/modules/backup/index.js');
  const { indexDir } = mod.backupPaths();
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(path.join(indexDir, 'x.txt'), 'x');
});

afterEach(() => {
  calls.length = 0;
});

describe('backup module — execFile contract', () => {
  it('invokes tar via execFile with a plain args vector and a fixed cwd', async () => {
    await mod.createBackup();
    expect(calls.length).toBe(1);
    const call = calls[0];
    expect(call.cmd).toBe('tar');
    expect(Array.isArray(call.args)).toBe(true);
    expect(call.args[0]).toBe('-czf');
    // No shell string: no drive letter, no colon, no quote characters anywhere.
    for (const arg of call.args) {
      expect(arg).not.toMatch(/[":]/);
    }
    // cwd is the MemoryDock home so both archive and index paths stay relative.
    expect(call.cwd).toBe(mod.backupPaths().homeDir);
  });

  it('restore extracts with -xzf using a relative archive path', async () => {
    const { name } = await mod.createBackup();
    calls.length = 0;
    await mod.restoreBackup(name);
    const extract = calls.find(c => c.args[0] === '-xzf');
    expect(extract).toBeTruthy();
    for (const arg of extract!.args) {
      expect(arg).not.toMatch(/[":]/);
    }
    expect(extract!.cwd).toBe(mod.backupPaths().homeDir);
  });
});
