import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const defaultApiUrl = `http://${config.host}:${config.port}`;
const apiUrl = process.env.MEMORYDOCK_API_URL || defaultApiUrl;

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

/** Start the local HTTP service on demand for MCP clients. */
export async function ensureServerRunning(): Promise<void> {
  if (await isReady()) return;

  const target = new URL(apiUrl);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(target.hostname)) {
    throw new Error(`MemoryDock API at ${apiUrl} is unavailable. Start the target server before connecting MCP.`);
  }

  const child = spawn(process.execPath, [fileURLToPath(new URL('./cli.js', import.meta.url)), 'serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  let launchError: Error | undefined;
  child.on('error', error => { launchError = error; });
  child.unref();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (launchError) throw new Error(`Could not start MemoryDock API: ${launchError.message}`);
    if (await isReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`MemoryDock API did not start at ${apiUrl} within 30 seconds. Run "memorydock serve" in a terminal for startup logs.`);
}
