import { isMadeOnSite } from '../../civitai/conventions';
import type { GenerationMetadata } from '../../shared/schema';
import { generationMetadataSchema } from '../../shared/schema';
import type { BinaryInput, ExifData, Generator, ImageFormat } from '../../shared/types';
import { sniffFormat } from '../format';
import { defaultParsers } from '../parsers/registry';
import type { MetadataParser, ParserContext } from '../parsers/types';
import { createParserContext } from '../parsers/types';
import { extractExif, toBytes } from './exif';

export interface ReadOptions {
  /** Parser registry to walk, in order. Defaults to the built-in parsers. */
  parsers?: MetadataParser<any>[];
  /** Overrides for injectable behavior (sampler map, AIR resolution, debug hook). */
  context?: Partial<ParserContext>;
}

export interface MediaMetadata {
  format: ImageFormat | 'unknown';
  /** Which generator's format matched, or null when none did. */
  generator: Generator | null;
  /** Parsed + schema-validated generation metadata; `{}` when nothing matched or parsing failed. */
  meta: GenerationMetadata;
  /** Flattened raw tags (including the raw `userComment` bytes when present). */
  exif: Readonly<ExifData>;
  /** Civitai convention: EXIF Artist tag equals 'ai'. */
  madeOnSite: boolean;
}

export async function readMetadata(
  input: BinaryInput,
  options?: ReadOptions
): Promise<MediaMetadata> {
  const bytes = await toBytes(input);
  const format = sniffFormat(bytes);
  const exif = extractExif(bytes);
  const ctx = createParserContext(options?.context);
  const parsers = options?.parsers ?? defaultParsers;

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
  const meta = (result.success ? result.data : {}) as GenerationMetadata;

  return { format, generator, meta, exif, madeOnSite: isMadeOnSite(exif) };
}
