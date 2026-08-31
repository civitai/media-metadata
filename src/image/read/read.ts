import type { CivitaiMetadata } from '../../civitai/normalized';
import type { GenerationMetadata } from '../../shared/schema';
import { generationMetadataSchema } from '../../shared/schema';
import type { BinaryInput, ExifData, Generator, ImageFormat } from '../../shared/types';
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
   * `@civitai/generation-metadata/civitai`). Applied in order; explicit `parsers`/
   * `context` options override plugin contributions.
   */
  plugins?: ParserPlugin[];
  /** Parser registry to walk, in order. Defaults to the built-in parsers. */
  parsers?: MetadataParser<any>[];
  /** Overrides for injectable behavior (sampler map, extractors, debug hook). */
  context?: Partial<ParserContext>;
}

/**
 * Envelope slots plugins may fill, keyed by plugin namespace. Third-party
 * plugins get typed access via declaration merging:
 *
 *   declare module '@civitai/generation-metadata' {
 *     interface PluginNamespaces { myPlugin: MyNamespace }
 *   }
 *
 * after which `md.myPlugin` is typed on every MediaMetadata (write it from
 * your plugin's `enrich` hook). All slots are optional on the envelope —
 * present only when the owning plugin ran.
 */
export interface PluginNamespaces {
  /** Set by the civitai() plugin. */
  civitai: CivitaiMetadata;
}

export interface MediaMetadata extends Partial<PluginNamespaces> {
  format: ImageFormat | 'unknown';
  /** Which generator's format matched, or null when none did. */
  generator: Generator | null;
  /**
   * The primary output: the verbatim per-generator bag (schema-validated; `{}`
   * on no match/failure). Preserves every passthrough key exactly as the source
   * wrote it — also the civitai app's storage shape. Normalization is a plugin
   * concern (the civitai() plugin puts its view at `md.civitai.generation`).
   */
  raw: GenerationMetadata;
  /** Flattened raw tags (including the raw `userComment` bytes when present). */
  exif: Readonly<ExifData>;
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

  const md: MediaMetadata = { format, generator, raw, exif };
  for (const plugin of plugins ?? []) plugin.enrich?.(md);
  return md;
}
