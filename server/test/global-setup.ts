import { readdirSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Remove leftover temp test homes before running tests */
export default function () {
  const remove = (target: string) => {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // ignore locked or missing directories
    }
  };
  try {
    const tmp = os.tmpdir();
    for (const name of readdirSync(tmp)) {
      if (name.startsWith('memorydock-server-test-')) remove(path.join(tmp, name));
    }
  } catch {
    // ignore if the temp directory is unreadable
  }
  try {
    for (const name of readdirSync('./data')) {
      if (name.startsWith('test-')) remove(path.join('data', name)); // pre-2.0 leftovers
    }
  } catch {
    // ignore if the data directory does not exist
  }
}
