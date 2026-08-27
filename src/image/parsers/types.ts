import { samplerMap } from '../../shared/constants';
import type { GenerationMetadata } from '../../shared/schema';
import type { ExifData, Generator } from '../../shared/types';
import { hashesDetailExtractor, jsonBlockDetailExtractor } from './detail-extractors';

/**
 * A details-line extractor: pull a structured block (e.g. a JSON blob some tool
 * appends) out of the A1111 details line into `metadata`, returning the line
 * with the block removed so the plain key/value scanner never sees it.
 * Extractors run in order before the scanner.
 */
export type A1111DetailExtractor = (
  detailsLine: string,
  metadata: GenerationMetadata,
  ctx: ParserContext
) => string;

export interface ParserContext {
  /** A1111 sampler name → equivalent names in other UIs. */
  samplerMap: ReadonlyMap<string, string[]>;
  /**
   * Keys of the unified metadata bag that are internal/cross-parser fields rather
   * than A1111 text fields — skipped when parsing details-line passthrough entries
   * and when encoding back to A1111 text. A denylist on purpose: the A1111 format
   * is open-ended (extensions add arbitrary `Key: value` pairs), so an allowlist
   * would silently drop legitimate keys. Extend it if you add your own internal keys.
   */
  a1111ExcludedKeys: readonly string[];
  /** Pre-scan extractors for the A1111 details line. Plugins prepend/append their own. */
  a1111DetailExtractors: readonly A1111DetailExtractor[];
  /** Debug hook for intermediate parser state (e.g. the ComfyUI node graph). */
  onDebug?: (key: string, value: unknown) => void;
}

export const defaultA1111ExcludedKeys: readonly string[] = [
  'hashes',
  'civitaiResources',
  'scheduler',
  'vaes',
  'additionalResources',
  'comfy',
  'upscalers',
  'models',
  'controlNets',
  'denoise',
  'other',
  'external',
];

export function createParserContext(overrides?: Partial<ParserContext>): ParserContext {
  return {
    samplerMap,
    a1111ExcludedKeys: defaultA1111ExcludedKeys,
    a1111DetailExtractors: [hashesDetailExtractor, jsonBlockDetailExtractor],
    ...overrides,
  };
}

/**
 * A metadata parser for one generator's format. `detect` inspects the flattened
 * tags WITHOUT mutating them and returns the parser's normalized private state,
 * or null when the format doesn't match. `parse` turns that state into metadata.
 */
export interface MetadataParser<TState = unknown> {
  generator: Generator;
  detect(exif: Readonly<ExifData>, ctx: ParserContext): TState | null;
  parse(state: TState, ctx: ParserContext): GenerationMetadata;
  encode(meta: GenerationMetadata, ctx: ParserContext): string;
}
