import { readFile } from 'node:fs/promises';
import type { MediaMetadata, ReadOptions } from './image/read/read';
import { readMetadata } from './image/read/read';

/** Read generation metadata from a file on disk (node only). */
export async function readMetadataFromFile(
  path: string,
  options?: ReadOptions
): Promise<MediaMetadata> {
  const bytes = await readFile(path);
  return readMetadata(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), options);
}
