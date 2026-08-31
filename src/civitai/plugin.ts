import {
  hashesDetailExtractor,
  jsonBlockDetailExtractor,
} from '../image/parsers/detail-extractors';
import type { ParserPlugin } from '../image/plugins';
import { normalizeCivitaiGeneration } from './normalized';
import type { ParsedAir } from './air';
import { parseAir } from './air';
import { civitaiMetadataExtractor, civitaiResourcesExtractor } from './a1111';
import { createCivitaiComfyParser } from './comfy';
import { isMadeOnSite } from './conventions';

export interface CivitaiPluginOptions {
  /** Override AIR identifier resolution (default: the vendored civitai parser). */
  resolveAir?: (air: string) => ParsedAir;
}

/**
 * The civitai plugin: extends the bare reader with everything civitai.com writes —
 * `Civitai resources`/`Civitai metadata` blocks with AIR resolution, the
 * CivitaiModelSelector comfy node, on-site generation formats (legacy UserComment
 * JSON, curated extraMetadata summaries), and the made-on-site marker.
 */
export function civitai(options?: CivitaiPluginOptions): ParserPlugin {
  const resolveAir = options?.resolveAir ?? parseAir;
  const comfyParser = createCivitaiComfyParser(resolveAir);
  return {
    name: 'civitai',
    parsers: (parsers) => parsers.map((p) => (p.generator === 'comfyui' ? comfyParser : p)),
    context: {
      a1111DetailExtractors: [
        hashesDetailExtractor,
        civitaiResourcesExtractor(resolveAir),
        civitaiMetadataExtractor,
        jsonBlockDetailExtractor,
      ],
    },
    enrich: (md) => {
      md.civitai = {
        madeOnSite: isMadeOnSite(md.exif),
        extra: md.raw.extra as Record<string, unknown> | undefined,
        generation:
          md.generator && Object.keys(md.raw).length > 0
            ? normalizeCivitaiGeneration(md.raw, md.generator)
            : undefined,
      };
    },
  };
}
