import { describe, expect, it } from 'vitest';
import { decodeUserComment, encodeUserCommentUTF16BE } from '../user-comment';

describe('decodeUserComment - endianness and encoding', () => {
  const prefix = [0x55, 0x4e, 0x49, 0x43, 0x4f, 0x44, 0x45, 0x00]; // "UNICODE\0"
  const testString = 'Steps: 4, Sampler: Euler, Character: 中';

  it('decodes UTF-16BE correctly (standard EXIF format)', () => {
    const content = [];
    for (let i = 0; i < testString.length; i++) {
      const code = testString.charCodeAt(i);
      content.push((code >> 8) & 0xff);
      content.push(code & 0xff);
    }
    const buffer = new Uint8Array(prefix.concat(content));
    expect(decodeUserComment(buffer)).toBe(testString);
  });

  it('decodes UTF-16LE correctly', () => {
    const content = [];
    for (let i = 0; i < testString.length; i++) {
      const code = testString.charCodeAt(i);
      content.push(code & 0xff);
      content.push((code >> 8) & 0xff);
    }
    const buffer = new Uint8Array(prefix.concat(content));
    expect(decodeUserComment(buffer)).toBe(testString);
  });

  it('decodes UTF-16BE with BOM correctly', () => {
    const content = [0xfe, 0xff];
    for (let i = 0; i < testString.length; i++) {
      const code = testString.charCodeAt(i);
      content.push((code >> 8) & 0xff);
      content.push(code & 0xff);
    }
    const buffer = new Uint8Array(prefix.concat(content));
    expect(decodeUserComment(buffer)).toBe(testString);
  });

  it('decodes UTF-16LE with BOM correctly', () => {
    const content = [0xff, 0xfe];
    for (let i = 0; i < testString.length; i++) {
      const code = testString.charCodeAt(i);
      content.push(code & 0xff);
      content.push((code >> 8) & 0xff);
    }
    const buffer = new Uint8Array(prefix.concat(content));
    expect(decodeUserComment(buffer)).toBe(testString);
  });

  it('round-trips through encodeUserCommentUTF16BE', () => {
    expect(decodeUserComment(encodeUserCommentUTF16BE(testString))).toBe(testString);
  });
});
