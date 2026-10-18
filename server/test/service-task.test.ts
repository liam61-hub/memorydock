import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
  vi.resetModules();
  spawn.mockReset();
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    queueMicrotask(() => child.emit('close', 0));
    return child;
  });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor);
});

describe('Windows on-demand service task', () => {
  it('registers a user-owned task with no trigger and one active instance', async () => {
    const { installServiceTask } = await import('../src/service-task.js');
    await installServiceTask();
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe('powershell.exe');
    const script = Buffer.from(args[3], 'base64').toString('utf16le');
    expect(script).toContain('Register-ScheduledTask');
    expect(script).toContain('-LogonType Interactive -RunLevel Limited');
    expect(script).toContain('-MultipleInstances IgnoreNew');
    expect(script).not.toContain('New-ScheduledTaskTrigger');
    expect(script).toContain("-Execute 'powershell.exe'");
    expect(script).toContain('-WindowStyle Hidden');
    const encodedService = /-WindowStyle Hidden -EncodedCommand ([A-Za-z0-9+/=]+)/.exec(script)?.[1];
    expect(encodedService).toBeDefined();
    const service = Buffer.from(encodedService!, 'base64').toString('utf16le');
    expect(service).toContain('serve *>> $logPath');
    expect(service).toContain("'serve.log'");
    expect(service).toContain(process.execPath.replaceAll("'", "''"));
    expect(options.windowsHide).toBe(true);
  });

  it('requests the registered task without directly spawning the API', async () => {
    const { startServiceTask, SERVICE_TASK_NAME } = await import('../src/service-task.js');
    await startServiceTask();
    expect(spawn).toHaveBeenCalledWith('schtasks.exe', ['/run', '/tn', SERVICE_TASK_NAME], expect.objectContaining({ windowsHide: true }));
  });

  it('surfaces a task launch failure', async () => {
    spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('task missing'));
        child.emit('close', 1);
      });
      return child;
    });
    const { startServiceTask } = await import('../src/service-task.js');
    await expect(startServiceTask()).rejects.toThrow('task missing');
  });

  it('waits for a task another client may already be starting', async () => {
    spawn.mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      queueMicrotask(() => child.emit('close', 1));
      return child;
    });
    const { startServiceTask } = await import('../src/service-task.js');
    await startServiceTask();
    expect(spawn.mock.calls.map(call => call[1][0])).toEqual(['/run', '/query']);
  });
});
