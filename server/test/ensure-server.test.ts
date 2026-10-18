import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn, startServiceTask } = vi.hoisted(() => ({ spawn: vi.fn(), startServiceTask: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('../src/service-task.js', () => ({ startServiceTask }));

beforeEach(() => {
  vi.resetModules();
  spawn.mockReset();
  startServiceTask.mockReset();
  delete process.env.MEMORYDOCK_API_URL;
  delete process.env.MEMORYDOCK_LAUNCH_MODE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MEMORYDOCK_API_URL;
  delete process.env.MEMORYDOCK_LAUNCH_MODE;
});

describe('ensureServerRunning', () => {
  it('uses an already running API without starting another process', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'alive' }) }));
    const { ensureServerRunning } = await import('../src/ensure-server.js');
    await ensureServerRunning();
    expect(startServiceTask).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('shares a Windows task launch between concurrent callers and waits for readiness', async () => {
    process.env.MEMORYDOCK_LAUNCH_MODE = 'task';
    let release!: () => void;
    const launched = new Promise<void>(resolve => { release = resolve; });
    startServiceTask.mockReturnValue(launched);
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'alive' }) });
    vi.stubGlobal('fetch', fetch);
    const { ensureServerRunning } = await import('../src/ensure-server.js');
    const progressA = vi.fn();
    const progressB = vi.fn();
    const first = ensureServerRunning(progressA);
    const second = ensureServerRunning(progressB);
    await vi.waitFor(() => expect(startServiceTask).toHaveBeenCalledOnce());
    expect(progressA).toHaveBeenCalledOnce();
    expect(progressB).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives setup instructions if the Windows task cannot start', async () => {
    process.env.MEMORYDOCK_LAUNCH_MODE = 'task';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    startServiceTask.mockRejectedValue(new Error('task missing'));
    const { ensureServerRunning } = await import('../src/ensure-server.js');
    await expect(ensureServerRunning()).rejects.toThrow('memorydock service install');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not launch a local process for an unavailable remote API', async () => {
    process.env.MEMORYDOCK_API_URL = 'https://memory.example.test';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));
    const { ensureServerRunning } = await import('../src/ensure-server.js');
    await expect(ensureServerRunning()).rejects.toThrow('Start the target server');
    expect(startServiceTask).not.toHaveBeenCalled();
  });

  it('reports direct launch errors when direct mode is explicitly selected', async () => {
    process.env.MEMORYDOCK_LAUNCH_MODE = 'direct';
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
