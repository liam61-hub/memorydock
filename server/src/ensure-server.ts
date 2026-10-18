import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { startServiceTask } from './service-task.js';

const defaultApiUrl = `http://${config.host}:${config.port}`;
const apiUrl = process.env.MEMORYDOCK_API_URL || defaultApiUrl;
let pendingStart: Promise<void> | undefined;
let startupInProgress = false;
const startupListeners = new Set<() => void>();

async function isReady(): Promise<boolean> {
  try {
    const response = await fetch(new URL('/health/liveness', apiUrl), {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const body = await response.json() as { status?: string };
    return body.status === 'alive';
  } catch {
    return false;
  }
}

function startDirectly(): { error: Error | undefined } {
  const state: { error: Error | undefined } = { error: undefined };
  const child = spawn(process.execPath, [fileURLToPath(new URL('./cli.js', import.meta.url)), 'serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.on('error', error => { state.error = error; });
  child.unref();
  return state;
}

async function startAndWait(): Promise<void> {
  const target = new URL(apiUrl);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(target.hostname)) {
    throw new Error(`MemoryDock API at ${apiUrl} is unavailable. Start the target server before calling this tool.`);
  }

  const mode = process.env.MEMORYDOCK_LAUNCH_MODE || (process.platform === 'win32' ? 'task' : 'direct');
  if (!['task', 'direct', 'off'].includes(mode)) throw new Error(`Invalid MEMORYDOCK_LAUNCH_MODE: ${mode}`);
  if (mode === 'off') throw new Error('MemoryDock service is unavailable. Run "memorydock serve" from your user shell.');

  let direct: { error: Error | undefined } | undefined;
  if (mode === 'task') {
    try {
      await startServiceTask();
    } catch (error) {
      if (await isReady()) return;
      throw new Error(`Could not start MemoryDock service task: ${(error as Error).message}. Run "memorydock service install" once in a normal PowerShell, or run "memorydock serve" there.`, { cause: error });
    }
  } else {
    direct = startDirectly();
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (direct?.error) throw new Error(`Could not start MemoryDock API: ${direct.error.message}`);
    if (await isReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`MemoryDock API did not start at ${apiUrl} within 30 seconds. Run "memorydock serve" in a user terminal for startup logs.`);
}

/** Share one startup attempt between MCP connection and concurrent tool calls. */
export function ensureServerRunning(onStarting?: () => void): Promise<void> {
  if (onStarting) startupListeners.add(onStarting);
  if (pendingStart) {
    if (startupInProgress) onStarting?.();
    return pendingStart;
  }
  const attempt = (async () => {
    if (await isReady()) return;
    startupInProgress = true;
    for (const listener of startupListeners) listener();
    await startAndWait();
  })();
  pendingStart = attempt.finally(() => {
    pendingStart = undefined;
    startupInProgress = false;
    startupListeners.clear();
  });
  return pendingStart;
}
