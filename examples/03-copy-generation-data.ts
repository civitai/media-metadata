/**
 * "Copy generation data" — turn parsed metadata back into shareable A1111 text.
 *
 * Mirrors in the civitai app:
 *   src/components/ImageMeta/ImageMeta.tsx:362            copy(encodeMetadata(meta))
 *   src/components/Image/DetailV2/ImageGenerationData.tsx
 *   src/hooks/useMetadataCopy.ts / copyMetadataToClipboard (the clipboard/DOM half
 *     stays in the app; the encoding half is this package)
 *
 * Run: pnpm exec tsx examples/03-copy-generation-data.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeMetadata, readMetadata } from '../src/index';
import { civitai } from '../src/civitai/index';

const file = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'images',
  'automatic1111',
  'lora-hashes-28005051.png'
);
const md = await readMetadata(new Uint8Array(await readFile(file)), { plugins: [civitai()] });

// text/plain half of the clipboard payload (the app pairs it with a JSON-carrying
// text/html blob via its own copyMetadataToClipboard)
const text = encodeMetadata(md.meta);
console.log(text.slice(0, 400));
