/**
 * Ad-hoc: remove fixtures by basename (image + expectation + manifest entry).
 *   tsx scripts/prune-fixtures.ts <basename> [basename...]
 */
import { readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'fixtures');
const names = new Set(process.argv.slice(2));
if (names.size === 0) {
  console.error('usage: tsx scripts/prune-fixtures.ts <basename> [basename...]');
  process.exit(1);
}

type ManifestEntry = { file: string; [k: string]: unknown };
let manifest: ManifestEntry[] = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
const before = manifest.length;

let removedFiles = 0;
for (const dir of readdirSync(join(ROOT, 'images'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const file of readdirSync(join(ROOT, 'images', dir.name))) {
    const base = file.replace(/\.(expected\.json|png|jpe?g|webp)$/i, '');
    if (!names.has(base)) continue;
    rmSync(join(ROOT, 'images', dir.name, file));
    removedFiles++;
  }
}
manifest = manifest.filter((m) => !names.has(m.file.replace(/^.*\//, '').replace(/\.\w+$/, '')));
await writeFile(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `removed ${removedFiles} file(s), manifest ${before} -> ${manifest.length} entries for ${names.size} basename(s)`
);
