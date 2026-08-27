/**
 * Upload preprocessing — what civitai does to every image at upload time.
 *
 * Mirrors in the civitai app:
 *   src/utils/media-preprocessors/image.preprocessor.ts  (getMetadata on the file)
 *   src/utils/image-utils.ts isValidAiMeta               (AI-generated gate)
 *   src/utils/metadata/index.ts isMadeOnSite             (on-site marker)
 *
 * Run: pnpm exec tsx examples/01-upload-preprocessing.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readMetadata } from '../src/index';
import { civitai } from '../src/civitai/index';

const file = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'images',
  'automatic1111',
  'onsite-140937841.jpeg'
);
const bytes = new Uint8Array(await readFile(file));

const md = await readMetadata(bytes, { plugins: [civitai()] });

// The app stores md.meta on the Image row and gates "AI-generated" on it:
const isValidAiMeta = !!(md.meta.prompt || md.meta.civitaiResources);

console.log('generator:   ', md.generator);
console.log('madeOnSite:  ', md.madeOnSite);
console.log('isValidAiMeta:', isValidAiMeta);
console.log('prompt:      ', String(md.meta.prompt).slice(0, 80) + '…');
console.log('sampler:     ', md.meta.sampler, '| steps:', md.meta.steps, '| seed:', md.meta.seed);
console.log('civitaiResources:', JSON.stringify(md.meta.civitaiResources));
