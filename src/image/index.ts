import { automatic1111Parser } from './parsers/automatic1111';
import { defaultParsers } from './parsers/registry';
import type { ParserContext } from './parsers/types';
import { createParserContext } from './parsers/types';
import type { ParserPlugin } from './plugins';
import { applyPlugins } from './plugins';
import type { MediaMetadata } from './read/read';
import type { GenerationMetadata } from '../shared/schema';
import { generationMetadataSchema } from '../shared/schema';
import type { Generator } from '../shared/types';

export {
  readMetadata,
  type MediaMetadata,
  type PluginNamespaces,
  type ReadOptions,
} from './read/read';
export { applyPlugins, type ParserPlugin } from './plugins';
export {
  canEmbedMetadata,
  embedMetadata,
  copyMetadata,
  payloadFromMediaMetadata,
  type MetadataPayload,
} from './write/write';
export { createExifSegment, createExifTiff, setExifSegment, type ExifTags } from './write/jpeg';
export {
  setExifChunk,
  setTextChunk,
  getTextChunks,
  parseChunks,
  serializeChunks,
} from './write/png';
export { extractExif, toBytes } from './read/exif';
export { decodeUserComment, encodeUserCommentUTF16BE } from './read/user-comment';
export { sniffFormat } from './format';

export { defaultParsers } from './parsers/registry';
export {
  createParserContext,
  defaultA1111ExcludedKeys,
  type A1111DetailExtractor,
  type MetadataParser,
  type ParserContext,
} from './parsers/types';
export { hashesDetailExtractor, jsonBlockDetailExtractor } from './parsers/detail-extractors';
export { applyA1111Compat } from './parsers/a1111-compat';
export {
  automatic1111Parser,
  normalizeGenerationDetails,
  type Automatic1111State,
} from './parsers/automatic1111';
export { swarmUiParser, type SwarmUiState } from './parsers/swarmui';
export { ruinedFooocusParser, type RuinedFooocusState } from './parsers/ruinedfooocus';
export { comfyUiParser, type ComfyUiState } from './parsers/comfyui';
export {
  createNameResolver,
  scanGraph,
  type GraphScan,
  type NodeNameIntercept,
} from './parsers/comfyui/graph';

export interface TextOptions {
  plugins?: ParserPlugin[];
  context?: Partial<ParserContext>;
}

function resolveContext(options?: TextOptions): ParserContext {
  const { context } = applyPlugins(options?.plugins, defaultParsers);
  return createParserContext({ ...context, ...options?.context });
}

/**
 * Parse A1111-style generation text (e.g. pasted parameters) into the same
 * envelope `readMetadata` returns (with `format: 'unknown'` and empty `exif`).
 * Plugins apply fully — extractors AND enrich — so pasted text and a read file
 * feed identical downstream code (e.g. `md.civitai.generation` with the
 * civitai plugin).
 */
export function parseGenerationText(text: string, options?: TextOptions): MediaMetadata {
  const parsed = automatic1111Parser.parse({ generationDetails: text }, resolveContext(options));
  const result = generationMetadataSchema.safeParse(parsed);
  const raw = (result.success ? result.data : {}) as GenerationMetadata;
  const md: MediaMetadata = {
    format: 'unknown',
    generator: Object.keys(raw).length > 0 ? 'automatic1111' : null,
    raw,
    exif: {},
  };
  for (const plugin of options?.plugins ?? []) plugin.enrich?.(md);
  return md;
}

/**
 * Encode metadata back into a generator's native text format. Returns '' on
 * failure by default — pass `throwOnError` when silently embedding nothing
 * would be worse than an exception. Accepts any metadata-shaped record (the
 * encoders read known keys and pass the rest through), so callers with their
 * own validated meta type don't need to cast.
 */
export function encodeMetadata(
  meta: Record<string, unknown>,
  generator: Generator = 'automatic1111',
  options?: TextOptions & { throwOnError?: boolean }
): string {
  const { parsers } = applyPlugins(options?.plugins, defaultParsers);
  const parser = parsers.find((p) => p.generator === generator);
  if (!parser) {
    if (options?.throwOnError) throw new Error(`No parser registered for generator: ${generator}`);
    return '';
  }
  try {
    return parser.encode(meta as GenerationMetadata, resolveContext(options));
  } catch (error) {
    if (options?.throwOnError) throw error;
    return '';
  }
}
