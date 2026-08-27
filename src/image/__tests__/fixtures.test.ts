import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { civitai } from '../../civitai/plugin';
import { readMetadata } from '../read/read';
import { copyMetadata } from '../write/write';

// The corpus is real civitai.com images; expectations encode civitai semantics
const READ_OPTIONS = { plugins: [civitai()] };

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'images');
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

function collectImages(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectImages(full));
    else if (IMAGE_EXT.test(entry.name)) files.push(full);
  }
  return files;
}

const images = collectImages(FIXTURES_DIR);

// The corpus is the point of this repo — a run that finds no images is broken, not green.
it('collects a non-trivial fixture corpus', () => {
  expect(images.length).toBeGreaterThanOrEqual(10);
});

describe.each(images.map((file) => [relative(FIXTURES_DIR, file).replace(/\\/g, '/'), file]))(
  '%s',
  (_label, file) => {
    const expected = JSON.parse(readFileSync(file.replace(IMAGE_EXT, '.expected.json'), 'utf8'));

    it('parses to the blessed expected output', async () => {
      const bytes = readFileSync(file);
      const md = await readMetadata(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        READ_OPTIONS
      );
      expect({ generator: md.generator, madeOnSite: md.madeOnSite, meta: md.meta }).toEqual({
        generator: expected.generator,
        madeOnSite: expected.madeOnSite,
        meta: expected.meta,
      });
    });

    const formats: ('png' | 'jpeg')[] = expected.roundTrip?.formats ?? [];
    it.each(formats.map((f) => [f]))(
      'survives a resize/convert round-trip to %s',
      async (format) => {
        const source = readFileSync(file);
        // sharp strips all metadata by default — exactly what resizing does in the wild
        const resized = await sharp(source).resize({ width: 128 }).toFormat(format).toBuffer();
        const stripped = await readMetadata(new Uint8Array(resized), READ_OPTIONS);
        expect(stripped.generator).toBeNull();

        const restored = await copyMetadata(new Uint8Array(source), new Uint8Array(resized));
        const md = await readMetadata(restored, READ_OPTIONS);
        expect({ generator: md.generator, meta: md.meta }).toEqual({
          generator: expected.generator,
          meta: expected.meta,
        });
      }
    );
  }
);
