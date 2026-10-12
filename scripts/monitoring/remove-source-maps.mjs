import { readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
// Run only after upload has succeeded (or local monitoring is disabled).
async function clean(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await clean(file);
    else if (entry.name.endsWith('.map')) await unlink(file);
  }
}
await clean(resolve('.next'));
