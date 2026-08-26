import { automatic1111Parser } from './parsers/automatic1111';
import { defaultParsers } from './parsers/registry';
import type { ParserContext } from './parsers/types';
import { createParserContext } from './parsers/types';
import type { GenerationMetadata } from '../shared/schema';
import type { Generator } from '../shared/types';

export { readMetadata, type MediaMetadata, type ReadOptions } from './read/read';
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
  type MetadataParser,
  type ParserContext,
} from './parsers/types';
export { applyA1111Compat } from './parsers/a1111-compat';
export {
  automatic1111Parser,
  normalizeGenerationDetails,
  type Automatic1111State,
} from './parsers/automatic1111';
export { swarmUiParser, type SwarmUiState } from './parsers/swarmui';
export { ruinedFooocusParser, type RuinedFooocusState } from './parsers/ruinedfooocus';
export { comfyUiParser, type ComfyUiState } from './parsers/comfyui';

/** Parse A1111-style generation text (e.g. pasted parameters) into metadata. */
export function parseGenerationText(
  text: string,
  context?: Partial<ParserContext>
): GenerationMetadata {
  return automatic1111Parser.parse({ generationDetails: text }, createParserContext(context));
}

/** Encode metadata back into a generator's native text format. Returns '' on failure. */
export function encodeMetadata(
  meta: GenerationMetadata,
  generator: Generator = 'automatic1111',
  context?: Partial<ParserContext>
): string {
  const parser = defaultParsers.find((p) => p.generator === generator);
  if (!parser) return '';
  try {
    return parser.encode(meta, createParserContext(context));
  } catch {
    return '';
  }
}
