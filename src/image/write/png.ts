import { concatBytes, crc32, u32be } from '../../shared/binary';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type PngChunk = { type: string; data: Uint8Array };

export function parseChunks(png: Uint8Array): PngChunk[] {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG (bad signature)');
  }
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length =
      (png[offset] << 24) | (png[offset + 1] << 16) | (png[offset + 2] << 8) | png[offset + 3];
    const type = String.fromCharCode(
      png[offset + 4],
      png[offset + 5],
      png[offset + 6],
      png[offset + 7]
    );
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

export function serializeChunks(chunks: PngChunk[]): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array(PNG_SIGNATURE)];
  for (const chunk of chunks) {
    const typeBytes = new TextEncoder().encode(chunk.type);
    const body = concatBytes([typeBytes, chunk.data]);
    parts.push(new Uint8Array(u32be(chunk.data.length)), body, new Uint8Array(u32be(crc32(body))));
  }
  return concatBytes(parts);
}

function textChunkKeyword(chunk: PngChunk): string | null {
  if (chunk.type !== 'tEXt' && chunk.type !== 'iTXt' && chunk.type !== 'zTXt') return null;
  const nul = chunk.data.indexOf(0);
  if (nul === -1) return null;
  return String.fromCharCode(...chunk.data.subarray(0, nul));
}

function isLatin1(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff || code === 0) return false;
  }
  return true;
}

function makeTextChunk(keyword: string, text: string): PngChunk {
  const keywordBytes = Uint8Array.from(keyword, (c) => c.charCodeAt(0));
  if (isLatin1(text)) {
    const textBytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    return { type: 'tEXt', data: concatBytes([keywordBytes, new Uint8Array([0]), textBytes]) };
  }
  // iTXt, uncompressed, no language tag / translated keyword
  return {
    type: 'iTXt',
    data: concatBytes([
      keywordBytes,
      // keyword-nul, compression flag 0, compression method 0, empty language tag nul, empty translated keyword nul
      new Uint8Array([0, 0, 0, 0, 0]),
      new TextEncoder().encode(text),
    ]),
  };
}

/**
 * Insert or replace a text chunk (tEXt when Latin-1-safe, iTXt otherwise).
 * Any existing tEXt/iTXt/zTXt chunk with the same keyword is removed.
 */
export function setTextChunk(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const chunks = parseChunks(png).filter((c) => textChunkKeyword(c) !== keyword);
  const insertIndex = chunks.findIndex((c) => c.type !== 'IHDR');
  chunks.splice(insertIndex === -1 ? chunks.length : insertIndex, 0, makeTextChunk(keyword, text));
  return serializeChunks(chunks);
}

/**
 * Insert or replace the `eXIf` chunk. `tiff` is a bare EXIF TIFF structure
 * (starting with the II/MM byte-order header — no "Exif\0\0" prefix, per the
 * PNG spec). This is how civitai's generator carries Artist/Software/UserComment
 * in its PNG output.
 */
export function setExifChunk(png: Uint8Array, tiff: Uint8Array): Uint8Array {
  const chunks = parseChunks(png).filter((c) => c.type !== 'eXIf');
  const insertIndex = chunks.findIndex((c) => c.type !== 'IHDR');
  chunks.splice(insertIndex === -1 ? chunks.length : insertIndex, 0, { type: 'eXIf', data: tiff });
  return serializeChunks(chunks);
}

/** Read all text chunks as keyword → text (tEXt latin-1, iTXt utf-8; zTXt skipped). */
export function getTextChunks(png: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of parseChunks(png)) {
    const keyword = textChunkKeyword(chunk);
    if (!keyword) continue;
    const nul = chunk.data.indexOf(0);
    if (chunk.type === 'tEXt') {
      out[keyword] = String.fromCharCode(...chunk.data.subarray(nul + 1));
    } else if (chunk.type === 'iTXt') {
      // keyword \0 compFlag compMethod lang \0 translated \0 text
      let offset = nul + 1;
      const compressed = chunk.data[offset] === 1;
      offset += 2;
      offset = chunk.data.indexOf(0, offset) + 1; // skip language tag
      offset = chunk.data.indexOf(0, offset) + 1; // skip translated keyword
      if (!compressed) out[keyword] = new TextDecoder('utf-8').decode(chunk.data.subarray(offset));
    }
  }
  return out;
}
