import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

beforeEach(() => {
  vi.resetModules();
  spawn.mockReset();
  delete process.env.MEMORYDOCK_API_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MEMORYDOCK_API_URL;
});

describe('ensureServerRunning', () => {
  it('uses an already running local API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'alive' }) }));
    const { ensureServerRunning } = await import('../src/ensure-server.js');
    await ensureServerRunning();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('starts the API for a local MCP client and waits for liveness', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'alive' }) }));
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawn.mockReturnValue(child);
    const { ensureServerRunning } = await import('../src/ensure-server.js');
    await ensureServerRunning();
    expect(spawn).toHaveBeenCalledWith(process.execPath, expect.arrayContaining(['serve']), expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: true }));
    expect(child.unref).toHaveBeenCalled();
  });

  it('does not launch a local process for an unavailable remote API', async () => {
    process.env.MEMORYDOCK_API_URL = 'https://memory.example.test';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));
    const { ensureServerRunning } = await import('../src/ensure-server.js');
    await expect(ensureServerRunning()).rejects.toThrow('Start the target server');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports a failed local process launch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('error', new Error('EPERM')));
      return child;
    });
    const { ensureServerRunning } = await import('../src/ensure-server.js');
    await expect(ensureServerRunning()).rejects.toThrow('Could not start MemoryDock API: EPERM');
  });
});
