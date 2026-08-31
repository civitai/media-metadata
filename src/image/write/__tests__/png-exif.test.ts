import { describe, expect, it } from 'vitest';
import { extractExif } from '../../read/exif';
import { createExifTiff } from '../jpeg';
import { parseChunks, setExifChunk } from '../png';

// Smallest valid PNG: IHDR (1x1 grayscale) + IDAT + IEND, CRCs precomputed
// prettier-ignore
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x00, 0x00, 0x00, 0x00, 0x3a, 0x7e, 0x9b,
  0x55, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x01, 0x73, 0x75, 0x01, 0x18, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe('PNG eXIf chunk', () => {
  it('writes Artist/Software into an eXIf chunk that ExifReader reads back', () => {
    const out = setExifChunk(TINY_PNG, createExifTiff({ artist: 'ai', software: 'job-1234' }));
    const exif = extractExif(out);
    // ExifReader surfaces ASCII tag values as arrays
    expect(exif.Artist).toEqual(['ai']);
    expect(exif.Software).toEqual(['job-1234']);
  });

  it('replaces an existing eXIf chunk instead of stacking a second one', () => {
    const once = setExifChunk(TINY_PNG, createExifTiff({ artist: 'first' }));
    const twice = setExifChunk(once, createExifTiff({ artist: 'second' }));
    expect(parseChunks(twice).filter((c) => c.type === 'eXIf')).toHaveLength(1);
    expect(extractExif(twice).Artist).toEqual(['second']);
  });

  it('places the chunk after IHDR, before IDAT', () => {
    const out = setExifChunk(TINY_PNG, createExifTiff({ artist: 'ai' }));
    const types = parseChunks(out).map((c) => c.type);
    expect(types.indexOf('eXIf')).toBeGreaterThan(types.indexOf('IHDR'));
    expect(types.indexOf('eXIf')).toBeLessThan(types.indexOf('IDAT'));
  });
});
