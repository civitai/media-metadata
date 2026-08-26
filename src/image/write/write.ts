import type { BinaryInput } from '../../shared/types';
import { sniffFormat } from '../format';
import { toBytes } from '../read/exif';
import type { MediaMetadata } from '../read/read';
import { readMetadata } from '../read/read';
import { decodeUserComment } from '../read/user-comment';
import { createExifSegment, setExifSegment } from './jpeg';
import { setTextChunk } from './png';

/**
 * Format-agnostic carrier for embeddable generation metadata.
 * PNG targets store `parameters` / `prompt` / `workflow` as text chunks;
 * JPEG targets store EXIF Artist/Software plus a UserComment.
 */
export interface MetadataPayload {
  /** A1111/SwarmUI/RuinedFooocus generation text (PNG `parameters` chunk, JPEG UserComment). */
  parameters?: string;
  /** ComfyUI API prompt JSON (PNG `prompt` chunk). */
  prompt?: string;
  /** ComfyUI workflow JSON (PNG `workflow` chunk). */
  workflow?: string;
  artist?: string;
  software?: string;
  /** Raw EXIF UserComment bytes from the source — carried verbatim for lossless JPEG→JPEG copies. */
  userCommentBytes?: Uint8Array;
}

function joinTag(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return undefined;
}

/** Extract the embeddable payload from a read result. */
export function payloadFromMediaMetadata(md: MediaMetadata): MetadataPayload {
  const exif = md.exif;
  const payload: MetadataPayload = {};

  if (typeof exif.parameters === 'string') payload.parameters = exif.parameters;
  if (typeof exif.prompt === 'string') payload.prompt = exif.prompt;
  if (typeof exif.workflow === 'string') payload.workflow = exif.workflow;
  if (exif.userComment instanceof Uint8Array) payload.userCommentBytes = exif.userComment;

  // ComfyUI-in-WebP stores the prompt JSON in the EXIF Model tag
  if (!payload.prompt) {
    const model = exif.Model;
    if (Array.isArray(model) && typeof model[0] === 'string' && model[0].startsWith('prompt:')) {
      const comfyJson = model[0].replace(/^prompt:/, '');
      payload.prompt = comfyJson;
      payload.workflow ??= comfyJson;
    }
  }

  const artist = joinTag(exif.Artist);
  if (artist) payload.artist = artist;
  const software = joinTag(exif.Software);
  if (software) payload.software = software;

  return payload;
}

/** Embed a metadata payload into PNG or JPEG bytes. WebP writing is not supported. */
export async function embedMetadata(
  image: BinaryInput,
  payload: MetadataPayload
): Promise<Uint8Array> {
  let bytes = await toBytes(image);
  const format = sniffFormat(bytes);

  if (format === 'png') {
    let parameters = payload.parameters;
    // A JPEG-sourced payload carries its text in the UserComment bytes
    if (!parameters && !payload.prompt && !payload.workflow && payload.userCommentBytes) {
      parameters = decodeUserComment(payload.userCommentBytes) || undefined;
    }
    if (parameters) bytes = setTextChunk(bytes, 'parameters', parameters);
    if (payload.prompt) bytes = setTextChunk(bytes, 'prompt', payload.prompt);
    if (payload.workflow) bytes = setTextChunk(bytes, 'workflow', payload.workflow);
    return bytes;
  }

  if (format === 'jpeg') {
    let userComment: string | Uint8Array | undefined = payload.userCommentBytes;
    if (!userComment && payload.parameters) userComment = payload.parameters;
    if (!userComment && payload.prompt) {
      // Best effort for ComfyUI → JPEG: the legacy userComment format (workflow
      // JSON with an `extra` key). Lossy — the graph survives, `meta.comfy` differs.
      try {
        userComment = JSON.stringify({ ...JSON.parse(payload.prompt), extra: {} });
      } catch {
        userComment = undefined;
      }
    }
    if (!userComment && !payload.artist && !payload.software) return bytes;
    const segment = createExifSegment({
      artist: payload.artist,
      software: payload.software,
      userComment,
    });
    return setExifSegment(bytes, segment);
  }

  throw new Error(`Metadata writing is not supported for format: ${format}`);
}

/**
 * The resize-safe primitive: read the generation metadata from `source` and
 * embed it into `target` (typically the resized/converted bytes, which lost it).
 */
export async function copyMetadata(source: BinaryInput, target: BinaryInput): Promise<Uint8Array> {
  const md = await readMetadata(source);
  return embedMetadata(target, payloadFromMediaMetadata(md));
}
