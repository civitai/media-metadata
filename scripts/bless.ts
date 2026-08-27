/**
 * Regenerate `<image>.expected.json` files from the current parser output.
 *
 *   pnpm bless [substring-filter]
 *
 * Prints a diff summary for files that changed. CI never runs this — a blessed
 * expectation is a reviewed, deliberate behavior change.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readMetadata } from './read';
import { defaultRoundTripFormats } from './roundtrip-defaults';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'images');
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

async function collectImages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectImages(full)));
    else if (IMAGE_EXT.test(entry.name)) files.push(full);
  }
  return files;
}

const filter = process.argv[2];
const images = (await collectImages(FIXTURES_DIR)).filter((f) => !filter || f.includes(filter));

if (images.length === 0) {
  console.error('No fixture images found' + (filter ? ` matching "${filter}"` : ''));
  process.exit(1);
}

let changed = 0;
for (const image of images) {
  const bytes = await readFile(image);
  const md = await readMetadata(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const expectedPath = image.replace(IMAGE_EXT, '.expected.json');

  let previous: { roundTrip?: unknown } | undefined;
  try {
    previous = JSON.parse(await readFile(expectedPath, 'utf8'));
  } catch {
    previous = undefined;
  }

  const next = {
    generator: md.generator,
    madeOnSite: md.civitai?.madeOnSite,
    meta: md.raw,
    generation: md.generation ?? null,
    // preserve a hand-edited roundTrip config; otherwise default to the formats
    // this generator's metadata actually survives (see docs/civitai-migration.md)
    roundTrip: previous?.roundTrip ?? { formats: defaultRoundTripFormats(md) },
  };

  const serialized = JSON.stringify(next, null, 2) + '\n';
  const before = previous ? JSON.stringify(previous, null, 2) + '\n' : undefined;
  if (serialized !== before) {
    await writeFile(expectedPath, serialized);
    changed++;
    console.log(`${before ? 'updated' : 'created'}  ${relative(process.cwd(), expectedPath)}`);
  }
}

console.log(`\n${images.length} fixture(s) processed, ${changed} expectation file(s) written.`);
