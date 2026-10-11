import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'server');
const fixture = readFileSync(join(root, 'scripts', 'mcp-tools-smoke.jsonl'), 'utf8');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run smoke:package so npm_execpath is available');
const temp = mkdtempSync(join(tmpdir(), 'memorydock-package-'));

function npm(args, cwd = packageDir) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, npm_config_registry: 'https://registry.npmjs.org/' },
  });
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.listen(0, '127.0.0.1', resolveListen).once('error', reject));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function ready(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/liveness`);
      if (response.ok && (await response.json()).status === 'alive') return;
    } catch { /* service is still starting */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error('Installed package did not start its local API');
}

let service;
try {
  // Build first, then pack with --ignore-scripts: the prepack lifecycle
  // (vite) prints colored output to stdout, which corrupts pack --json.
  npm(['run', 'build:admin']);
  npm(['run', 'build']);
  const pack = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temp]));
  assert.ok(pack[0].files.some(file => file.path === 'LICENSE'), 'Packed package must contain Apache-2.0 license');
  assert.ok(pack[0].files.some(file => file.path === 'dist/admin/index.html'), 'Packed package must contain the console');
  const tarball = join(temp, pack[0].filename);
  const installRoot = join(temp, 'install');
  npm(['install', '--global', '--prefix', installRoot, tarball]);
  const globalRoot = npm(['root', '--global', '--prefix', installRoot]);
  const cli = join(globalRoot, 'memorydock', 'dist', 'cli.js');
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), pack[0].version);

  const port = await freePort();
  const env = {
    ...process.env,
    MEMORYDOCK_HOME: join(temp, 'data'),
    PORT: String(port),
    HOST: '127.0.0.1',
    SKIP_STARTUP_CHECKS: 'true',
  };
  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', env });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).home, env.MEMORYDOCK_HOME);

  service = spawn(process.execPath, [cli, 'serve'], { env, stdio: 'ignore', windowsHide: true });
  await ready(port);
  const consoleResponse = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(consoleResponse.status, 200);
  assert.match(await consoleResponse.text(), /<html/i);

  const mcp = spawnSync(process.execPath, [cli, 'mcp'], {
    env,
    input: fixture,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(mcp.status, 0, mcp.stderr);
  const lines = mcp.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const names = lines.find(line => line.id === 2)?.result?.tools?.map(tool => tool.name);
  assert.deepEqual(names?.slice().sort(), ['list_memories', 'propose_memory', 'push_memory', 'search_memory', 'update_memory']);
  console.log(`Installed MemoryDock ${pack[0].version}: CLI, console, and MCP tool catalog passed`);
} finally {
  if (service && !service.killed) {
    const exited = new Promise(resolveExit => service.once('exit', resolveExit));
    service.kill();
    await Promise.race([exited, new Promise(resolveWait => setTimeout(resolveWait, 5_000))]);
  }
  rmSync(temp, { recursive: true, force: true });
}
