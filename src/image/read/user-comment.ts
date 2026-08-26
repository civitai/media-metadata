/**
 * Decode an EXIF UserComment payload: an 8-byte character-code header
 * (`ASCII\0\0\0`, `UNICODE\0`, `UTF8\0\0\0\0`) followed by the text.
 */
export function decodeUserComment(buffer: Uint8Array): string {
  if (buffer.length < 8) return '';

  const header = new TextDecoder('ascii').decode(buffer.subarray(0, 8));
  const content = buffer.subarray(8);

  if (header.startsWith('ASCII')) return new TextDecoder('ascii').decode(content);
  if (header.startsWith('UTF8')) return new TextDecoder('utf-8').decode(content);

  if (content.length >= 2) {
    if (content[0] === 0xfe && content[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(content.subarray(2)).replace(/\0/g, '');
    }
    if (content[0] === 0xff && content[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(content.subarray(2)).replace(/\0/g, '');
    }
  }

  // No BOM: count null bytes at even vs odd offsets to guess UTF-16 endianness.
  let evenZeros = 0;
  let oddZeros = 0;
  const limit = Math.min(content.length, 1000);
  for (let i = 0; i + 1 < limit; i += 2) {
    if (content[i] === 0) evenZeros++;
    if (content[i + 1] === 0) oddZeros++;
  }

  const encoding = oddZeros > evenZeros ? 'utf-16le' : 'utf-16be';
  return new TextDecoder(encoding).decode(content).replace(/\0/g, '');
}

const UNICODE_PREFIX = [0x55, 0x4e, 0x49, 0x43, 0x4f, 0x44, 0x45, 0x00]; // UNICODE\0

export function encodeUserCommentUTF16BE(str: string): Uint8Array {
  const encoded: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    encoded.push((code >> 8) & 0xff);
    encoded.push(code & 0xff);
  }
  return new Uint8Array(UNICODE_PREFIX.concat(encoded));
}
