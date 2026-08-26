import { concatBytes, u16le, u32le } from '../../shared/binary';
import { isDefined } from '../../shared/utils';
import { encodeUserCommentUTF16BE } from '../read/user-comment';

function makeIFDEntryLE(
  tag: number,
  type: number,
  count: number,
  valueOrOffset: Uint8Array | number
) {
  const entry = [...u16le(tag), ...u16le(type), ...u32le(count)];

  if (valueOrOffset instanceof Uint8Array) {
    const valueBytes = new Uint8Array(4).fill(0);
    valueBytes.set(valueOrOffset.slice(0, 4)); // inline data (padded/truncated to 4 bytes)
    entry.push(...valueBytes);
  } else {
    entry.push(...u32le(valueOrOffset)); // offset into data section
  }

  return entry;
}

function asciiEncoder(value: string | string[]) {
  const str = Array.isArray(value) ? value.join(', ') : value;
  return new TextEncoder().encode(str + '\0');
}

const tagMap = {
  imageDescription: { tag: 0x010e, type: 2, encoder: asciiEncoder },
  software: { tag: 0x0131, type: 2, encoder: asciiEncoder },
  artist: { tag: 0x013b, type: 2, encoder: asciiEncoder },
  userComment: {
    tag: 0x9286,
    type: 7,
    encoder: (value: string | Uint8Array | Uint32Array) => {
      if (value instanceof Uint32Array) return new Uint8Array(value.buffer);
      if (value instanceof Uint8Array) return value;
      return encodeUserCommentUTF16BE(value);
    },
  },
};

export interface ExifTags {
  artist?: string | string[];
  /** Raw already-encoded bytes pass through untouched; a string gets UTF-16BE encoded. */
  userComment?: string | Uint8Array | Uint32Array;
  software?: string | string[];
  imageDescription?: string | string[];
}

/** Build a complete JPEG APP1 segment (marker + length + Exif TIFF/IFD0). */
export function createExifSegment(args: ExifTags): Uint8Array {
  const tagsArray = Object.entries(args)
    .map(([key, value]) => {
      const tagMapMatch = tagMap[key as keyof typeof tagMap];
      if (!tagMapMatch || !value) return null;
      return { key, value, ...tagMapMatch };
    })
    .filter(isDefined)
    .sort((a, b) => a.tag - b.tag);

  const valueBlocks: { tag: number; type: number; count: number; data: Uint8Array }[] = [];

  for (const { value, tag, type, encoder } of tagsArray) {
    const data = encoder(value as any);
    valueBlocks.push({ tag, type, count: data.length, data });
  }

  // prettier-ignore
  const tiffHeader = [
    0x49, 0x49,             // Byte order: "II" = little endian
    0x2A, 0x00,             // TIFF magic number (42)
    0x08, 0x00, 0x00, 0x00, // Offset to first IFD
  ];

  const entryCount = valueBlocks.length;
  const idfBlockSize = u16le(entryCount);
  const nextIFDBlockOffset = u32le(0);

  const dataStart =
    tiffHeader.length + idfBlockSize.length + entryCount * 12 + nextIFDBlockOffset.length;

  let offset = dataStart;
  const entryBytes: number[][] = [];
  const dataBytes: Uint8Array[] = [];

  for (const block of valueBlocks) {
    const isInline = block.type === 2 && block.count <= 4;
    if (isInline) {
      entryBytes.push(makeIFDEntryLE(block.tag, block.type, block.count, block.data));
    } else {
      entryBytes.push(makeIFDEntryLE(block.tag, block.type, block.count, offset));
      dataBytes.push(block.data);
      offset += block.data.length;
    }
  }

  const ifdBlock = [...idfBlockSize, ...entryBytes.flat(), ...nextIFDBlockOffset];

  const exifBody = new Uint8Array([
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00, // "Exif\0\0"
    ...tiffHeader,
    ...ifdBlock,
    ...dataBytes.flatMap((x) => [...x]),
  ]);

  const segmentLength = exifBody.length + 2;
  return new Uint8Array([
    0xff,
    0xe1, // APP1 marker
    (segmentLength >> 8) & 0xff,
    segmentLength & 0xff,
    ...exifBody,
  ]);
}

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function isExifApp1(jpeg: Uint8Array, offset: number): boolean {
  return EXIF_ID.every((byte, i) => jpeg[offset + 4 + i] === byte);
}

/**
 * Insert an APP1-Exif segment into a JPEG, replacing an existing one in place,
 * or inserting after any APP0 (JFIF) segments when none exists.
 */
export function setExifSegment(jpeg: Uint8Array, segment: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG (missing SOI)');

  let offset = 2;
  let insertAt = 2;
  while (offset + 4 <= jpeg.length) {
    if (jpeg[offset] !== 0xff) break;
    const marker = jpeg[offset + 1];
    if (marker === 0xda) break; // start of scan — no more headers
    const length = (jpeg[offset + 2] << 8) | jpeg[offset + 3];
    const segmentEnd = offset + 2 + length;

    if (marker === 0xe1 && isExifApp1(jpeg, offset)) {
      return concatBytes([jpeg.subarray(0, offset), segment, jpeg.subarray(segmentEnd)]);
    }
    if (marker === 0xe0) insertAt = segmentEnd; // keep JFIF first, per spec ordering

    offset = segmentEnd;
  }

  return concatBytes([jpeg.subarray(0, insertAt), segment, jpeg.subarray(insertAt)]);
}
