/**
 * Ad-hoc: synthesize the ComfyUI-WebP fixture. Real ComfyUI webp uploads have
 * become rare on civitai, so this re-containers the REAL prompt graph from the
 * committed ComfyUI PNG fixture into a webp the way ComfyUI's webp save nodes
 * do: prompt JSON in EXIF IFD0 Model, prefixed `prompt:`.
 *   tsx scripts/make-webp-fixture.ts
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { getTextChunks } from '../src/image/write/png';
import { readMetadata } from './read';

const ROOT = join(import.meta.dirname, '..', 'fixtures');
const sourceFile = 'comfyui/workflow-22566974.png';
const targetFile = 'comfyui/webp-model-tag-22566974.webp';

const png = new Uint8Array(await readFile(join(ROOT, 'images', sourceFile)));
const { prompt } = getTextChunks(png);
if (!prompt) throw new Error('source fixture has no prompt chunk');

const webp = await sharp(png)
  .resize({ width: 512 })
  .webp({ quality: 80 })
  .withExif({ IFD0: { Model: `prompt:${prompt}` } })
  .toBuffer();

const md = await readMetadata(new Uint8Array(webp));
console.log('generator:', md.generator, '| format:', md.format);
if (md.generator !== 'comfyui' || md.format !== 'webp') throw new Error('synthesis failed');

await writeFile(join(ROOT, 'images', targetFile), webp);

type ManifestEntry = {
  file: string;
  url: string;
  sha256: string;
  generator: string | null;
  notes?: string;
};
const manifestPath = join(ROOT, 'manifest.json');
let manifest: ManifestEntry[] = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest = manifest.filter((m) => m.file !== targetFile);
manifest.push({
  file: targetFile,
  url: `synthetic:${sourceFile}`,
  sha256: createHash('sha256').update(webp).digest('hex'),
  generator: 'comfyui',
  notes:
    'Synthesized by scripts/make-webp-fixture.ts: the real prompt graph from workflow-22566974.png re-containered as webp with the prompt JSON in EXIF Model, the way ComfyUI webp save nodes write it.',
});
manifest.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('saved', targetFile, `(${webp.length}b)`);
