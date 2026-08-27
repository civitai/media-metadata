/**
 * Resize/convert without losing generation metadata — the write side.
 *
 * Mirrors in the civitai app:
 *   src/shared/utils/canvas-utils.ts canvasToBlobWithImageExif   (getCroppedImg,
 *     imageToJpegBlob, resizeImage — today a hand-rolled JPEG-only EXIF splice)
 *   src/components/Generation/Input/DrawingEditor/drawing.utils.ts exportDrawingToBlob
 *
 * In the browser those become:
 *   const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
 *   const restored = await copyMetadata(sourceFile, blob);
 *   return new Blob([restored], { type: 'image/jpeg' });
 *
 * This node version simulates the resize with sharp. Unlike the app's current
 * code, PNG targets keep ComfyUI workflows.
 *
 * Run: pnpm exec tsx examples/02-resize-preserving-metadata.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { copyMetadata, readMetadata } from '../src/index';
import { civitai } from '../src/civitai/index';

const file = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'images',
  'comfyui',
  'workflow-22566974.png'
);
const source = new Uint8Array(await readFile(file));

// resizing strips everything…
const resized = await sharp(source).resize({ width: 256 }).png().toBuffer();
const strippedMd = await readMetadata(new Uint8Array(resized), { plugins: [civitai()] });
console.log('after resize:  generator =', strippedMd.generator);

// …copyMetadata puts it back
const restored = await copyMetadata(source, new Uint8Array(resized));
const md = await readMetadata(restored, { plugins: [civitai()] });
console.log('after restore: generator =', md.generator);
console.log(
  'workflow survived:',
  typeof md.raw.comfy === 'string' && md.raw.comfy.includes('"workflow"')
);
