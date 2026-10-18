import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a stable major.minor.patch version, got ${version}`);
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  }
  return 0;
}

function packageVersion(path) {
  return JSON.parse(readFileSync(path, 'utf8')).version;
}

function installedPackagePaths() {
  if (process.env.MEMORYDOCK_INSTALLED_PACKAGE) return [process.env.MEMORYDOCK_INSTALLED_PACKAGE];
  if (process.platform === 'win32') {
    const userPrefix = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm');
    const prefixes = new Set([userPrefix, process.env.npm_config_prefix].filter(Boolean));
    return [...prefixes].map(prefix => join(prefix, 'node_modules', 'memorydock', 'package.json'));
  }
  const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  return [join(root, 'memorydock', 'package.json')];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const source = packageVersion(join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'package.json'));
    const installed = installedPackagePaths().filter(existsSync).map(packageVersion).sort(compareVersions).at(-1);
    if (!installed) {
      console.log(`MemoryDock source ${source}; no global installation found.`);
    } else {
      if (compareVersions(source, installed) < 0) {
        throw new Error(`MemoryDock source ${source} is older than installed ${installed}. Sync the development source before building or publishing.`);
      }
      console.log(`MemoryDock source ${source}; installed ${installed}: OK.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
