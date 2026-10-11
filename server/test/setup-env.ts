import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll } from 'vitest';

// One throwaway MEMORYDOCK_HOME per test file. Vitest runs setupFiles before
// importing the test file, so config.ts (which reads process.env at module
// load) always sees this file's paths, even for static imports of src modules.
const home = mkdtempSync(path.join(os.tmpdir(), 'memorydock-server-test-'));
process.env.MEMORYDOCK_HOME = home;
process.env.MEMORYDOCK_INDEX_PATH = path.join(home, 'index');
process.env.MEMORYDOCK_NOTES_PATH = path.join(home, 'notes');
process.env.MEMORYDOCK_CONFIG_PATH = path.join(home, 'config.json');
process.env.EMBEDDING_DIM = '8'; // dotenv/config never overrides an existing var
mkdirSync(path.join(home, 'backups'), { recursive: true });

afterAll(() => {
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows may still hold LanceDB handles; global-setup sweeps leftovers next run.
  }
});
