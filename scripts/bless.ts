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
import { readMetadata } from '../src/image/read/read';

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

/**
 * Which embed targets a fixture's metadata round-trips losslessly:
 * - A1111 text and no-metadata images survive both containers.
 * - ComfyUI survives PNG always; JPEG only when the source was already the
 *   legacy JPEG UserComment format (a fresh comfy→jpeg embed is lossy by design).
 * - SwarmUI/RuinedFooocus detectors only read the `parameters` chunk, so PNG only.
 */
function defaultRoundTripFormats(md: {
  generator: string | null;
  format: string;
}): ('png' | 'jpeg')[] {
  if (md.generator === 'swarmui' || md.generator === 'ruinedfooocus') return ['png'];
  if (md.generator === 'comfyui') return md.format === 'jpeg' ? ['png', 'jpeg'] : ['png'];
  return ['png', 'jpeg'];
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
    madeOnSite: md.madeOnSite,
    meta: md.meta,
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
