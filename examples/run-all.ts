/** Run every example in order (used by `pnpm examples` and CI to keep them honest). */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const files = readdirSync(import.meta.dirname)
  .filter((f) => /^\d+-.*\.ts$/.test(f))
  .sort();

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  await import(pathToFileURL(join(import.meta.dirname, file)).href);
}
console.log(`\n${files.length} examples ran without error.`);
