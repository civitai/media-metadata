import type { MediaMetadata } from './read/read';
import type { MetadataParser, ParserContext } from './parsers/types';

/**
 * A plugin extends the bare-bones reader with ecosystem-specific behavior.
 * The package ships one: `civitai()` (from `@civitai/media-metadata/civitai`),
 * which adds parsing for metadata written by civitai.com — on-site generation
 * formats, `Civitai resources`/`Civitai metadata` blocks, AIR resolution, and
 * the made-on-site marker.
 */
export interface ParserPlugin {
  name: string;
  /** Transform the parser registry — wrap, replace, extend, or reorder parsers. */
  parsers?: (parsers: MetadataParser<any>[]) => MetadataParser<any>[];
  /** Contributions merged into the ParserContext (later plugins win; explicit options win over all). */
  context?: Partial<ParserContext>;
  /** Post-read hook: attach the plugin's namespace to the envelope (e.g. `md.civitai`). */
  enrich?: (md: MediaMetadata) => void;
}

export function applyPlugins(
  plugins: ParserPlugin[] | undefined,
  baseParsers: MetadataParser<any>[]
): { parsers: MetadataParser<any>[]; context: Partial<ParserContext> } {
  let parsers = baseParsers;
  let context: Partial<ParserContext> = {};
  for (const plugin of plugins ?? []) {
    if (plugin.parsers) parsers = plugin.parsers(parsers);
    if (plugin.context) context = { ...context, ...plugin.context };
  }
  return { parsers, context };
}
