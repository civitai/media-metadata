/** Scripts operate on civitai.com images, so they read with the civitai plugin active. */
import { civitai } from '../src/civitai/plugin';
import type { MediaMetadata } from '../src/image/read/read';
import { readMetadata as base } from '../src/image/read/read';
import type { BinaryInput } from '../src/shared/types';

const plugins = [civitai()];

export function readMetadata(input: BinaryInput): Promise<MediaMetadata> {
  return base(input, { plugins });
}
