import type { MediaMetadata, ReadOptions } from '../image/read/read';
import { readMetadata } from '../image/read/read';
import type { BinaryInput } from '../shared/types';
import type { CivitaiMetadata } from './normalized';
import type { CivitaiPluginOptions } from './plugin';
import { civitai } from './plugin';

export type CivitaiReadOptions = Omit<ReadOptions, 'plugins'> &
  CivitaiPluginOptions & {
    /** Additional plugins applied after civitai(). */
    plugins?: ReadOptions['plugins'];
  };

/**
 * `readMetadata` with the civitai() plugin baked in — the one-symbol way to
 * read civitai images without the silent degradation of forgetting the plugin
 * (madeOnSite false, on-site formats undetected, resources unresolved). The
 * return type guarantees `md.civitai` is present.
 */
export async function readCivitaiMetadata(
  input: BinaryInput,
  options?: CivitaiReadOptions
): Promise<MediaMetadata & { civitai: CivitaiMetadata }> {
  const { resolveAir, plugins, ...rest } = options ?? {};
  const md = await readMetadata(input, {
    ...rest,
    plugins: [civitai({ resolveAir }), ...(plugins ?? [])],
  });
  return md as MediaMetadata & { civitai: CivitaiMetadata };
}
