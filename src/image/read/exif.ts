import ExifReader from 'exifreader';
import type { BinaryInput, ExifData } from '../../shared/types';

/** Normalize any accepted input to bytes. URL strings are fetched. */
export async function toBytes(input: BinaryInput): Promise<Uint8Array> {
  if (typeof input === 'string') {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch ${input}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  throw new Error('Unsupported input type');
}

/**
 * Read all EXIF/text-chunk tags from image bytes and flatten each tag to its
 * `.value`. An EXIF `UserComment` additionally gets normalized to a Uint8Array
 * under the `userComment` key (raw bytes, encoding header included).
 */
export function extractExif(bytes: Uint8Array): ExifData {
  let tags: ExifReader.Tags = {} as ExifReader.Tags;
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    tags = ExifReader.load(buffer, { includeUnknown: true });
  } catch {
    // unreadable/absent metadata block: return no tags
  }

  const exif = Object.entries(tags).reduce((acc, [key, value]) => {
    acc[key] = (value as { value: unknown }).value;
    return acc;
  }, {} as ExifData);

  if (exif.UserComment) {
    exif.userComment = Uint8Array.from(exif.UserComment as Iterable<number>);
  }

  return exif;
}
