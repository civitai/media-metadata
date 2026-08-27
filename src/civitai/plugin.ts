import {
  hashesDetailExtractor,
  jsonBlockDetailExtractor,
} from '../image/parsers/detail-extractors';
import type { ParserPlugin } from '../image/plugins';
import type { MediaMetadata } from '../image/read/read';
import { resourceKind } from '../shared/normalized';
import type { GenerationMetadata } from '../shared/schema';
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
      };

      // on-site generations put dimensions in the extras payload, not the graph
      if (md.generation && md.civitai.extra) {
        const w = Number(md.civitai.extra.width);
        const h = Number(md.civitai.extra.height);
        if (Number.isFinite(w)) md.generation.width ??= w;
        if (Number.isFinite(h)) md.generation.height ??= h;
      }

      // civitai-resolved resources fold into THE resource list: a resource being
      // "from civitai" is a property (civitaiModelVersionId), not a parallel array
      const resolved = md.raw.civitaiResources as
        { modelVersionId: number; type?: string; weight?: number }[] | undefined;
      if (md.generation && resolved?.length) {
        for (const r of resolved) {
          // on-site resource lists can repeat an id — one entry per civitaiModelVersionId
          if (md.generation.resources.some((x) => x.civitaiModelVersionId === r.modelVersionId))
            continue;
          const { kind, rawType } = resourceKind(r.type);
          // the source formats carry no name/hash link between a resolved id and a
          // graph/extranet entry — attach only on an unambiguous kind+weight match
          const twins = md.generation.resources.filter(
            (x) => x.kind === kind && x.civitaiModelVersionId === undefined && x.weight === r.weight
          );
          if (twins.length === 1) {
            twins[0].civitaiModelVersionId = r.modelVersionId;
          } else {
            md.generation.resources.push({
              kind,
              weight: r.weight,
              civitaiModelVersionId: r.modelVersionId,
              rawType,
            });
          }
        }
        const checkpoint = md.generation.resources.find((x) => x.kind === 'checkpoint');
        if (checkpoint) {
          md.generation.model ??= {};
          md.generation.model.name ??= checkpoint.name;
          md.generation.model.hash ??= checkpoint.hash;
          md.generation.model.civitaiModelVersionId ??= checkpoint.civitaiModelVersionId;
        }
      }
    },
  };
}

/**
 * Adapter for the civitai app: the legacy `ImageMetaProps`-shaped bag the app
 * stores today. The plugin's parsers keep writing their fields into `raw`, so
 * this IS the byte-compatible legacy shape (the app re-validates with its own
 * imageMetaSchema at its boundary, which also re-applies its `extra` stripping).
 */
export function toImageMetaProps(md: MediaMetadata): GenerationMetadata {
  return md.raw;
}
