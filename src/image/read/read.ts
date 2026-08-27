import type { NormalizedGeneration } from '../../shared/normalized';
import { normalizeGeneration } from '../../shared/normalized';
import type { GenerationMetadata } from '../../shared/schema';
import { generationMetadataSchema } from '../../shared/schema';
import type {
  BinaryInput,
  CivitaiMetadata,
  ExifData,
  Generator,
  ImageFormat,
} from '../../shared/types';
import { sniffFormat } from '../format';
import { defaultParsers } from '../parsers/registry';
import type { MetadataParser, ParserContext } from '../parsers/types';
import { createParserContext } from '../parsers/types';
import type { ParserPlugin } from '../plugins';
import { applyPlugins } from '../plugins';
import { extractExif, toBytes } from './exif';

export interface ReadOptions {
  /**
   * Plugins extending the bare reader (e.g. `civitai()` from
   * `@civitai/media-metadata/civitai`). Applied in order; explicit `parsers`/
   * `context` options override plugin contributions.
   */
  plugins?: ParserPlugin[];
  /** Parser registry to walk, in order. Defaults to the built-in parsers. */
  parsers?: MetadataParser<any>[];
  /** Overrides for injectable behavior (sampler map, extractors, debug hook). */
  context?: Partial<ParserContext>;
}

export interface MediaMetadata {
  format: ImageFormat | 'unknown';
  /** Which generator's format matched, or null when none did. */
  generator: Generator | null;
  /**
   * The primary output: a generator-independent, stably-typed view of the
   * generation metadata. Absent when nothing matched or parsing failed.
   */
  generation?: NormalizedGeneration;
  /**
   * The verbatim per-generator bag (schema-validated; `{}` on no match/failure).
   * Preserves every passthrough key exactly as the source wrote it — the escape
   * hatch for generator-specific detail, and the civitai app's storage shape.
   */
  raw: GenerationMetadata;
  /** Flattened raw tags (including the raw `userComment` bytes when present). */
  exif: Readonly<ExifData>;
  /** Set by the civitai() plugin; absent without it. */
  civitai?: CivitaiMetadata;
}

export async function readMetadata(
  input: BinaryInput,
  options?: ReadOptions
): Promise<MediaMetadata> {
  const bytes = await toBytes(input);
  const format = sniffFormat(bytes);
  const exif = extractExif(bytes);

  const plugins = options?.plugins;
  // plugins transform the base registry (explicit or default); explicit context wins over plugin context
  const { parsers, context } = applyPlugins(plugins, options?.parsers ?? defaultParsers);
  const ctx = createParserContext({ ...context, ...options?.context });

  let generator: Generator | null = null;
  let rawMeta: GenerationMetadata | undefined;
  for (const parser of parsers) {
    let state: unknown = null;
    try {
      state = parser.detect(exif, ctx);
    } catch {
      continue;
    }
    if (!state) continue;

    generator = parser.generator;
    try {
      rawMeta = parser.parse(state, ctx);
    } catch {
      rawMeta = undefined;
    }
    break;
  }

  const result = generationMetadataSchema.safeParse(rawMeta ?? {});
  const raw = (result.success ? result.data : {}) as GenerationMetadata;

  const generation =
    generator && Object.keys(raw).length > 0 ? normalizeGeneration(raw, generator) : undefined;

  const md: MediaMetadata = { format, generator, generation, raw, exif };
  for (const plugin of plugins ?? []) plugin.enrich?.(md);
  return md;
}
