import type { GenerationMetadata } from '../../shared/schema';
import { decodeUserComment } from '../read/user-comment';
import {
  extractBalancedJson,
  normalizeGenerationDetails,
  parseDetailsLine,
  toA1111Key,
  toUnifiedKey,
} from './a1111-text';
import type { MetadataParser, ParserContext } from './types';

export { normalizeGenerationDetails } from './a1111-text';

type CivitaiResourceRaw = {
  weight?: number;
  air?: string;
  modelVersionId?: number;
  type?: string;
  versionName?: string;
  modelName?: string;
};

type SDResource = {
  type: string;
  name: string;
  weight?: number;
  hash?: string;
};

export type Automatic1111State = { generationDetails: string };

const HASHES_PREFIX = ', Hashes: ';
const CIVITAI_RESOURCES = /, Civitai resources:\s*(\[\{.*?\}\])/;
const CIVITAI_METADATA_PREFIX = ', Civitai metadata: ';
/** Extension output that breaks details parsing — everything after these is dropped. */
const BAD_EXTENSION_KEYS = ['Resources: ', 'Hashed prompt: ', 'Hashed Negative prompt: '];
const TEMPLATE_KEYS = ['Template: ', 'Negative Template: '] as const;
const EXTRA_NETS_REGEX = /<(lora|hypernet):([a-zA-Z0-9_.-]+):([0-9.]+)>/g;
const NAME_HASH_REGEX = /([a-zA-Z0-9_.]+)\(([a-zA-Z0-9]+)\)/;

/** Drop `Template:`/`Negative Template:` sections (prompt copies A1111 appends). */
function stripTemplateLines(lines: string[]): void {
  for (const key of TEMPLATE_KEYS) {
    const start = lines.findIndex((line) => line.startsWith(key));
    if (start === -1) continue;
    lines.splice(start, 1);

    // a template continues over following lines until the next `Key: ` line
    while (start < lines.length && !/[\w\s]+: /.test(lines[start])) {
      lines.splice(start, 1);
    }
  }
}

/**
 * Pull the `Steps: ...` details line out of `lines` and pre-clean it.
 * Quirk kept from the original implementation: the trailing-comma strip happens
 * BEFORE the indexOf lookup, so a details line that actually ends in a comma is
 * looked up by its stripped text, misses, and splice(-1) removes the LAST line
 * instead — which is almost always the details line anyway. Fixing the lookup
 * would change behavior on inputs where it isn't; parity wins.
 */
function takeDetailsLine(lines: string[]): string | undefined {
  let detailsLine = lines.find((line) => line.startsWith('Steps: '))?.replace(/,\s*$/, '');
  if (detailsLine) lines.splice(lines.indexOf(detailsLine), 1);
  for (const key of BAD_EXTENSION_KEYS) {
    if (!detailsLine?.includes(key)) continue;
    detailsLine = detailsLine.split(key)[0];
  }
  return detailsLine;
}

/** `, Hashes: {...}` → metadata.hashes; returns the details line with the block removed. */
function extractHashes(detailsLine: string | undefined, metadata: GenerationMetadata) {
  const result = detailsLine ? extractBalancedJson(detailsLine, HASHES_PREFIX) : null;
  if (!result || !detailsLine) return detailsLine;
  metadata.hashes = JSON.parse(result.json);
  return detailsLine.slice(0, result.start) + detailsLine.slice(result.end);
}

/** `, Civitai resources: [{...}]` → metadata.civitaiResources with AIRs resolved to version ids. */
function extractCivitaiResources(
  detailsLine: string | undefined,
  metadata: GenerationMetadata,
  ctx: ParserContext
) {
  const match = detailsLine?.match(CIVITAI_RESOURCES)?.[1];
  if (!match || !detailsLine) return detailsLine;
  metadata.civitaiResources = JSON.parse(match);
  for (const resource of metadata.civitaiResources as CivitaiResourceRaw[]) {
    delete resource.modelName;
    delete resource.versionName;
    if (!resource.air) continue;
    const { version, type } = ctx.resolveAir(resource.air);
    resource.modelVersionId = version;
    resource.type = type;
    delete resource.air;
  }
  return detailsLine.replace(CIVITAI_RESOURCES, '');
}

/** `, Civitai metadata: {...}` (may nest) → metadata.extra. */
function extractCivitaiMetadata(detailsLine: string | undefined, metadata: GenerationMetadata) {
  const result = detailsLine ? extractBalancedJson(detailsLine, CIVITAI_METADATA_PREFIX) : null;
  if (!result || !detailsLine) return detailsLine;
  const data = JSON.parse(result.json) as Record<string, any>;
  if (Object.keys(data).length !== 0) metadata.extra = data;
  return detailsLine.slice(0, result.start) + detailsLine.slice(result.end);
}

/** Remaining `Key: value` pairs → metadata, minus internal keys. */
function applyDetailEntries(
  detailsLine: string | undefined,
  metadata: GenerationMetadata,
  ctx: ParserContext
): void {
  for (const [k, v] of Object.entries(parseDetailsLine(detailsLine))) {
    const key = toUnifiedKey(k);
    if (ctx.a1111ExcludedKeys.includes(key)) continue;
    metadata[key] = v;
  }
}

/** Everything left in `lines` is prompt text, split on the Negative prompt marker. */
function applyPrompts(lines: string[], metadata: GenerationMetadata): void {
  const [prompt, ...negativePrompt] = lines
    .join('\n')
    .split('Negative prompt:')
    .map((x) => x.trim());
  metadata.prompt = prompt;
  metadata.negativePrompt = negativePrompt.join(' ').trim();
}

/**
 * Build the resources list from the prompt's extra-network tags plus the
 * extension detail keys (Lora hashes, Model/Refiner hash, Hypernet, AddNet),
 * consuming the detail keys that only exist to carry resource info.
 */
function collectResources(metadata: GenerationMetadata): SDResource[] {
  const prompt = metadata.prompt as string;
  const resources: SDResource[] = [...prompt.matchAll(EXTRA_NETS_REGEX)].map(
    ([, type, name, weight]) => ({ type, name, weight: parseFloat(weight) })
  );

  if (metadata['Lora hashes']) {
    if (!metadata.hashes) metadata.hashes = {};
    for (const [name, hash] of Object.entries(metadata['Lora hashes'])) {
      metadata.hashes[`lora:${name}`] = hash;
      const resource = resources.find((r) => r.name === name);
      if (resource) resource.hash = hash;
      else resources.push({ type: 'lora', name, hash });
    }
    delete metadata['Lora hashes'];
  }

  if (metadata['VAE hash']) {
    if (!metadata.hashes) metadata.hashes = {};
    metadata.hashes['vae'] = metadata['VAE hash'] as string;
    delete metadata['VAE hash'];
  }

  if (metadata['Model'] && metadata['Model hash']) {
    if (!metadata.hashes) metadata.hashes = {};
    if (!metadata.hashes['model']) metadata.hashes['model'] = metadata['Model hash'] as string;
    resources.push({
      type: 'model',
      name: metadata['Model'] as string,
      hash: metadata['Model hash'] as string,
    });
  }

  if (metadata['Refiner'] && metadata['Refiner hash']) {
    if (!metadata.hashes) metadata.hashes = {};
    if (!metadata.hashes['refiner'])
      metadata.hashes['refiner'] = metadata['Refiner hash'] as string;
    resources.push({
      type: 'model',
      name: (metadata['Refiner'] as string).replace(/\.[^/.]+$/, ''),
      hash: metadata['Refiner hash'] as string,
    });
  }

  if (metadata['Hypernet'] && metadata['Hypernet strength'])
    resources.push({
      type: 'hypernet',
      name: metadata['Hypernet'] as string,
      weight: parseFloat(metadata['Hypernet strength'] as string),
    });

  if (metadata['AddNet Enabled'] === 'True') {
    for (let i = 1; metadata[`AddNet Model ${i}`]; i++) {
      const [, name, hash] = (metadata[`AddNet Model ${i}`] as string).match(NAME_HASH_REGEX) ?? [];
      // The extension writes `AddNet Weight A ${i}` (unet) / `B ${i}` (text encoder).
      // A NaN weight here used to fail schema validation and throw away the ENTIRE
      // metadata object, so a missing key must yield no weight, never NaN.
      const weight = parseFloat(
        (metadata[`AddNet Weight A ${i}`] ?? metadata[`AddNet Weight ${i}`]) as string
      );
      resources.push({
        type: (metadata[`AddNet Module ${i}`] as string).toLowerCase(),
        name,
        hash,
        weight: Number.isFinite(weight) ? weight : undefined,
      });
    }
  }

  return resources;
}

/** `Size: 512x768` → width/height. */
function applyDimensions(metadata: GenerationMetadata): void {
  if (!metadata['Size'] || typeof metadata['Size'] !== 'string') return;
  const [w, h] = (metadata['Size'] as string).split('x').map(Number);
  if (w && h) {
    metadata.width = w;
    metadata.height = h;
  }
  delete metadata['Size'];
}

export const automatic1111Parser: MetadataParser<Automatic1111State> = {
  generator: 'automatic1111',
  detect(exif) {
    let generationDetails: string | null = null;
    if (typeof exif.parameters === 'string') {
      generationDetails = exif.parameters;
    } else if (exif.userComment instanceof Uint8Array) {
      generationDetails = decodeUserComment(exif.userComment);
    }

    if (generationDetails?.includes('Steps: ')) {
      return { generationDetails: normalizeGenerationDetails(generationDetails) };
    }

    return null;
  },
  parse(state, ctx) {
    const metadata: GenerationMetadata = {};
    if (!state.generationDetails) return metadata;

    const lines = normalizeGenerationDetails(state.generationDetails)
      .split('\n')
      .filter((line) => line.trim() !== '');
    stripTemplateLines(lines);

    let detailsLine = takeDetailsLine(lines);
    detailsLine = extractHashes(detailsLine, metadata);
    detailsLine = extractCivitaiResources(detailsLine, metadata, ctx);
    detailsLine = extractCivitaiMetadata(detailsLine, metadata);
    applyDetailEntries(detailsLine, metadata, ctx);

    applyPrompts(lines, metadata);
    const resources = collectResources(metadata);
    applyDimensions(metadata);
    metadata.resources = resources as GenerationMetadata['resources'];

    return metadata;
  },
  encode(meta: GenerationMetadata, ctx: ParserContext) {
    const { prompt, negativePrompt, resources: _resources, steps, ...other } = meta;
    const lines = [prompt];
    if (negativePrompt) lines.push(`Negative prompt: ${negativePrompt}`);
    const fineDetails = [];
    if (steps) fineDetails.push(`Steps: ${steps}`);
    for (const [k, v] of Object.entries(other)) {
      if (v == null || typeof v === 'object') continue;
      const key = toA1111Key(k);
      if (ctx.a1111ExcludedKeys.includes(key)) continue;
      fineDetails.push(`${key}: ${v}`);
    }
    if (fineDetails.length > 0) lines.push(fineDetails.join(', '));

    return lines.join('\n');
  },
};

/** Parse A1111 text that didn't come from a file (e.g. pasted parameters). */
export function parseAutomatic1111Text(text: string, ctx: ParserContext): GenerationMetadata {
  return automatic1111Parser.parse({ generationDetails: text }, ctx);
}
