import { automatic1111Parser } from './parsers/automatic1111';
import { defaultParsers } from './parsers/registry';
import type { ParserContext } from './parsers/types';
import { createParserContext } from './parsers/types';
import type { ParserPlugin } from './plugins';
import { applyPlugins } from './plugins';
import type { NormalizedGeneration } from '../shared/normalized';
import { normalizeGeneration } from '../shared/normalized';
import type { GenerationMetadata } from '../shared/schema';
import { generationMetadataSchema } from '../shared/schema';
import type { Generator } from '../shared/types';

export { readMetadata, type MediaMetadata, type ReadOptions } from './read/read';
export { applyPlugins, type ParserPlugin } from './plugins';
export {
  embedMetadata,
  copyMetadata,
  payloadFromMediaMetadata,
  type MetadataPayload,
} from './write/write';
export { createExifSegment, setExifSegment, type ExifTags } from './write/jpeg';
export { setTextChunk, getTextChunks, parseChunks, serializeChunks } from './write/png';
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

/** Parse A1111-style generation text (e.g. pasted parameters) into metadata. */
export function parseGenerationText(
  text: string,
  options?: TextOptions
): { generation?: NormalizedGeneration; raw: GenerationMetadata } {
  const parsed = automatic1111Parser.parse({ generationDetails: text }, resolveContext(options));
  const result = generationMetadataSchema.safeParse(parsed);
  const raw = (result.success ? result.data : {}) as GenerationMetadata;
  const generation =
    Object.keys(raw).length > 0 ? normalizeGeneration(raw, 'automatic1111') : undefined;
  return { generation, raw };
}

/** Encode metadata back into a generator's native text format. Returns '' on failure. */
export function encodeMetadata(
  meta: GenerationMetadata,
  generator: Generator = 'automatic1111',
  options?: TextOptions
): string {
  const { parsers } = applyPlugins(options?.plugins, defaultParsers);
  const parser = parsers.find((p) => p.generator === generator);
  if (!parser) return '';
  try {
    return parser.encode(meta, resolveContext(options));
  } catch {
    return '';
  }
}
