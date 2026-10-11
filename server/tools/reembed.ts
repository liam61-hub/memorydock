/**
 * Re-embed all memory entries and chunks with the currently configured
 * embedding model. Rebuilds the LanceDB tables in place.
 *
 * Usage:
 *   npx tsx tools/reembed.ts --yes [--backup]
 *
 *   --yes      required confirmation (destructive rebuild)
 *   --backup   create a tar.gz backup of the LanceDB directory first
 */
import { createBackup } from '../src/modules/backup/index.js';
import { buildLanceReembedContext, reembedAll } from '../src/modules/reembed/index.js';

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--yes')) {
    console.error('This rebuilds all embedding vectors in place.');
    console.error('Re-run with --yes to confirm (add --backup to back up the data directory first).');
    process.exit(1);
  }

  if (args.includes('--backup')) {
    console.log('Creating backup before rebuild...');
    const backup = await createBackup();
    console.log(`Backup created: ${backup.name} (${backup.size} bytes)`);
  }

  console.log('Re-embedding all entries and chunks...');
  const ctx = await buildLanceReembedContext((message: string) => console.log(message));
  const result = await reembedAll(ctx);
  console.log(
    `Re-embed complete: ${result.entries} entries, ${result.chunks} chunks, dim=${result.dim}`,
  );
}

main().catch(err => {
  console.error('Re-embed failed:', (err as Error).message);
  console.error('The existing tables were left untouched.');
  process.exit(1);
});
