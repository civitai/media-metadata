/**
 * Ad-hoc: summarize the fixture corpus — per-generator/format counts, meta key
 * frequencies, type inconsistencies, and oddities worth a human's attention.
 *   tsx scripts/corpus-report.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'images');
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (IMAGE_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

const images = collect(FIXTURES_DIR);
const byGenerator: Record<string, number> = {};
const byFormat: Record<string, number> = {};
const keyFreq: Record<string, number> = {};
const oddities: string[] = [];
let totalBytes = 0;

for (const image of images) {
  const rel = relative(FIXTURES_DIR, image).replace(/\\/g, '/');
  const expected = JSON.parse(readFileSync(image.replace(IMAGE_EXT, '.expected.json'), 'utf8'));
  const bytes = readFileSync(image);
  totalBytes += bytes.length;
  const generator = expected.generator ?? 'none';
  byGenerator[generator] = (byGenerator[generator] ?? 0) + 1;
  const format = image.match(IMAGE_EXT)![1].toLowerCase().replace('jpg', 'jpeg');
  byFormat[format] = (byFormat[format] ?? 0) + 1;

  const meta = expected.meta as Record<string, unknown>;
  for (const key of Object.keys(meta)) keyFreq[key] = (keyFreq[key] ?? 0) + 1;

  if (expected.generator && Object.keys(meta).length === 0)
    oddities.push(`${rel}: generator=${expected.generator} but meta is EMPTY`);
  if (expected.generator && !meta.prompt) oddities.push(`${rel}: parsed but has NO prompt`);
  if (typeof meta.steps === 'string') oddities.push(`${rel}: steps is a STRING ('${meta.steps}')`);
  if (meta.civitaiResources) {
    const bad = (meta.civitaiResources as any[]).filter(
      (r) => typeof r.modelVersionId !== 'number' || Number.isNaN(r.modelVersionId)
    );
    if (bad.length) oddities.push(`${rel}: ${bad.length} civitaiResources with bad modelVersionId`);
  }
  if (meta.sampler && /[_]/.test(String(meta.sampler)))
    oddities.push(`${rel}: sampler not normalized to A1111 name ('${meta.sampler}')`);
}

console.log('images:', images.length, `(${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
console.log('byGenerator:', JSON.stringify(byGenerator));
console.log('byFormat:', JSON.stringify(byFormat));
console.log('\ntop meta keys:');
for (const [key, count] of Object.entries(keyFreq)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30))
  console.log(`  ${count.toString().padStart(4)}  ${key}`);
console.log('\nrare passthrough keys (seen once):');
console.log(
  '  ' +
    Object.entries(keyFreq)
      .filter(([, c]) => c === 1)
      .map(([k]) => k)
      .join(', ')
);
console.log('\noddities:');
for (const line of oddities) console.log('  ' + line);
if (!oddities.length) console.log('  (none)');
