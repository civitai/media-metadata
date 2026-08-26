/**
 * Ad-hoc: download candidate fixture images and register them in the manifest.
 *   tsx scripts/ingest.ts <candidates.json>
 * candidates.json: [{ "name": "a1111-offsite-12097475", "url": "...", "notes": "..." }]
 * The generator directory and true extension come from the reader, not the URL.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readMetadata } from '../src/image/read/read';

const ROOT = join(import.meta.dirname, '..', 'fixtures');
const candidates: { name: string; url: string; notes?: string }[] = JSON.parse(
  await readFile(process.argv[2], 'utf8')
);

type ManifestEntry = {
  file: string;
  url: string;
  sha256: string;
  generator: string | null;
  notes?: string;
};
let manifest: ManifestEntry[] = [];
try {
  manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
} catch {
  manifest = [];
}

for (const { name, url, notes } of candidates) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`skip ${name}: fetch ${res.status}`);
    continue;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const md = await readMetadata(bytes);
  const dir = md.generator ?? 'none';
  const ext = md.format === 'unknown' ? 'bin' : md.format;
  const file = `${dir}/${name}.${ext}`;
  await mkdir(join(ROOT, 'images', dir), { recursive: true });
  await writeFile(join(ROOT, 'images', file), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest = manifest.filter((m) => m.file !== file);
  manifest.push({ file, url, sha256, generator: md.generator, notes });
  console.log(
    `saved ${file} (${bytes.length}b, generator=${md.generator}, onsite=${md.madeOnSite})`
  );
}

manifest.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${manifest.length} entries`);
