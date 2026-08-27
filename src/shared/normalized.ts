import { samplerMap } from './constants';
import type { GenerationMetadata } from './schema';
import type { Generator } from './types';
import { findKeyForValue } from './utils';

/**
 * The primary, generator-independent view of parsed generation metadata:
 * stable camelCase names, guaranteed number types, and ONE merged resource
 * list. Derived from the verbatim parser bag (`MediaMetadata.raw`), which
 * remains available for generator-specific detail.
 */
export interface NormalizedGeneration {
  prompt?: string;
  negativePrompt?: string;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  clipSkip?: number;
  denoise?: number;
  width?: number;
  height?: number;
  sampler?: string;
  scheduler?: string;
  /** The primary checkpoint, when identifiable. */
  model?: { name?: string; hash?: string; civitaiModelVersionId?: number };
  /** Every resource the metadata references, merged from all source shapes. */
  resources: NormalizedResource[];
  /**
   * `version` is present only when the generator writes one (A1111 and SwarmUI
   * do; ComfyUI and RuinedFooocus don't) — absence means unrecorded, not v0.
   */
  tool: { name: Generator; version?: string };
}

export type ResourceKind =
  | 'checkpoint'
  | 'lora'
  | 'embedding'
  | 'hypernetwork'
  | 'vae'
  | 'upscaler'
  | 'controlnet'
  | 'other';

export interface NormalizedResource {
  kind: ResourceKind;
  name?: string;
  hash?: string;
  weight?: number;
  /**
   * The civitai model-version id, when the metadata identifies the resource on
   * civitai (AIRs, on-site generation blocks). Set by the civitai() plugin.
   */
  civitaiModelVersionId?: number;
  /** The source's original type string when it didn't map to a known kind. */
  rawType?: string;
}

/** Map a source's resource-type string to a normalized kind ('other' + rawType when unknown). */
export function resourceKind(type: string | undefined): { kind: ResourceKind; rawType?: string } {
  return toKind(type);
}

const KIND_MAP: Record<string, ResourceKind> = {
  model: 'checkpoint',
  checkpoint: 'checkpoint',
  lora: 'lora',
  locon: 'lora',
  lycoris: 'lora',
  dora: 'lora',
  hypernet: 'hypernetwork',
  hypernetwork: 'hypernetwork',
  vae: 'vae',
  upscaler: 'upscaler',
  controlnet: 'controlnet',
  embed: 'embedding',
  embedding: 'embedding',
  textualinversion: 'embedding',
};

function toKind(type: string | undefined): { kind: ResourceKind; rawType?: string } {
  const kind = type ? KIND_MAP[type.toLowerCase()] : undefined;
  return kind ? { kind } : { kind: 'other', rawType: type };
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function stripExtension(name: string): string {
  return name.replace(/\.(safetensors|sft|ckpt|pt|pth|bin|gguf)$/i, '');
}

/** Normalized resource names are basenames without model-file extensions. */
function cleanResourceName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const base = name.split(/[\\/]/).pop() ?? name;
  return stripExtension(base) || undefined;
}

/** Trim surrounding whitespace and the trailing comma runs concatenation leaves behind. */
function cleanPromptText(value: unknown): string | undefined {
  const text = asString(value)
    ?.trim()
    .replace(/[\s,]+$/, '');
  return text || undefined;
}

const EXTRANET_TAGS = /<(?:lora|lyco|lycoris|hypernet):[^>]*>/gi;

/** A1111 prompts embed resource directives; the normalized prompt is plain text. */
function stripExtranetTags(prompt: string | undefined): string | undefined {
  if (!prompt || !EXTRANET_TAGS.test(prompt)) return prompt;
  EXTRANET_TAGS.lastIndex = 0;
  const stripped = prompt.replace(EXTRANET_TAGS, '').replace(/[^\S\n]{2,}/g, ' ');
  return cleanPromptText(stripped);
}

class ResourceSet {
  private items: NormalizedResource[] = [];

  private find(kind: ResourceKind, name?: string, hash?: string): NormalizedResource | undefined {
    const norm = name?.toLowerCase();
    return this.items.find(
      (r) =>
        r.kind === kind &&
        ((norm && r.name && r.name.toLowerCase() === norm) ||
          (hash && r.hash && r.hash.toLowerCase() === hash.toLowerCase()))
    );
  }

  add(kind: ResourceKind, fields: Omit<NormalizedResource, 'kind'>): void {
    fields = { ...fields, name: cleanResourceName(fields.name) };
    const existing = this.find(kind, fields.name, fields.hash);
    if (existing) {
      existing.name ??= fields.name;
      existing.hash ??= fields.hash;
      existing.weight ??= fields.weight;
      existing.rawType ??= fields.rawType;
    } else {
      this.items.push({ kind, ...fields });
    }
  }

  all(): NormalizedResource[] {
    return this.items;
  }
}

function isAirName(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith('urn:air:');
}

/**
 * Split scheduler out of the sampler and canonicalize both. The source formats
 * disagree: A1111 bakes the scheduler into the sampler name ('DPM++ 2M Karras',
 * or a separate 'Schedule type' key in modern builds) while ComfyUI-family
 * tools carry it separately. The normalized layer always separates them.
 */
function normalizeSampler(raw: GenerationMetadata): { sampler?: string; scheduler?: string } {
  let sampler = asString(raw.sampler);
  let scheduler = asString(raw.scheduler)?.toLowerCase();

  if (sampler && /^undefined$/i.test(sampler)) sampler = undefined;

  const embedded = sampler?.match(/^(.+?)[ _](karras|exponential)$/i);
  if (embedded) {
    sampler = embedded[1];
    scheduler ??= embedded[2].toLowerCase();
  }

  const scheduleType = asString(raw['Schedule type'])?.toLowerCase().replace(/\s+/g, '_');
  if (!scheduler && scheduleType && scheduleType !== 'automatic') scheduler = scheduleType;

  // canonicalize native aliases the sampler map knows ('euler' → 'Euler');
  // unknown names pass through verbatim
  if (sampler)
    sampler = findKeyForValue(samplerMap, sampler) ?? NORMALIZE_ONLY_ALIASES[sampler] ?? sampler;

  return { sampler, scheduler };
}

/**
 * Aliases applied ONLY in the normalized layer. The shared samplerMap also
 * drives applyA1111Compat, which rewrites the raw bag — these names must not
 * change raw (byte-parity with the civitai app) but do have canonical A1111
 * names generation.sampler should use. Natives with no canonical name
 * (e.g. er_sde) stay verbatim.
 */
const NORMALIZE_ONLY_ALIASES: Record<string, string> = {
  dpmpp_2m_sde_gpu: 'DPM++ 2M SDE',
  dpmpp_3m_sde: 'DPM++ 3M SDE',
  dpmpp_3m_sde_gpu: 'DPM++ 3M SDE',
};

function buildResources(raw: GenerationMetadata): ResourceSet {
  const set = new ResourceSet();

  for (const r of (raw.resources as any[]) ?? []) {
    if (!r || isAirName(r.name)) continue;
    const { kind, rawType } = toKind(r.type);
    set.add(kind, {
      name: asString(r.name),
      hash: asString(r.hash),
      weight: asNumber(r.weight),
      rawType,
    });
  }

  for (const r of (raw.additionalResources as any[]) ?? []) {
    if (!r || isAirName(r.name)) continue;
    const { kind, rawType } = toKind(r.type ?? 'lora');
    set.add(kind, {
      name: asString(r.name),
      weight: asNumber(r.strength),
      rawType,
    });
  }

  // ComfyUI loader-name arrays (AIR entries belong to the civitai namespace, not here)
  const arrayKinds: [keyof GenerationMetadata & string, ResourceKind][] = [
    ['models', 'checkpoint'],
    ['vaes', 'vae'],
    ['upscalers', 'upscaler'],
    ['controlNets', 'controlnet'],
  ];
  for (const [key, kind] of arrayKinds) {
    for (const name of (raw[key] as unknown[]) ?? []) {
      if (typeof name !== 'string' || isAirName(name)) continue;
      set.add(kind, { name });
    }
  }

  // hashes record: `model`/`vae`/`refiner` singletons and `lora:NAME`/`embed:NAME` prefixes
  for (const [key, hash] of Object.entries(raw.hashes ?? {})) {
    if (typeof hash !== 'string') continue;
    if (key === 'model') set.add('checkpoint', { name: asString(raw.Model), hash });
    else if (key === 'vae') set.add('vae', { hash });
    else if (key === 'refiner') set.add('checkpoint', { name: asString(raw.Refiner), hash });
    else {
      const [prefix, ...rest] = key.split(':');
      const name = rest.join(':');
      if (name && (prefix === 'lora' || prefix === 'lycoris')) set.add('lora', { name, hash });
      else if (name && prefix === 'embed') set.add('embedding', { name, hash });
    }
  }

  // 'Model hash' scalar: early A1111 wrote it without a Model name (so the parser
  // never builds hashes.model) and RuinedFooocus never builds `hashes` at all
  if (asString(raw['Model hash']))
    set.add('checkpoint', { name: asString(raw.Model), hash: raw['Model hash'] as string });

  // a1111's bare Model with no hash never reaches `resources`
  if (asString(raw.Model)) set.add('checkpoint', { name: raw.Model as string });

  return set;
}

/** Build the normalized view from a parser's verbatim bag. */
export function normalizeGeneration(
  raw: GenerationMetadata,
  generator: Generator
): NormalizedGeneration {
  const resources = buildResources(raw).all();
  const model = resources.find((r) => r.kind === 'checkpoint');
  const { sampler, scheduler } = normalizeSampler(raw);

  return {
    prompt: stripExtranetTags(cleanPromptText(raw.prompt)),
    negativePrompt: cleanPromptText(raw.negativePrompt),
    steps: asNumber(raw.steps),
    cfgScale: asNumber(raw.cfgScale),
    // seeds above 2^53 lose precision here (as they already do inside JSON-based
    // formats); the exact source text survives in `raw`
    seed: asNumber(raw.seed),
    clipSkip: asNumber(raw.clipSkip ?? raw['Clip skip']),
    denoise: asNumber(raw.denoise ?? raw['Denoising strength']),
    width: asNumber(raw.width),
    height: asNumber(raw.height),
    sampler,
    scheduler,
    model: model ? { name: model.name, hash: model.hash } : undefined,
    resources,
    tool: {
      name: generator,
      version: asString(raw.version) ?? asString(raw.Version) ?? undefined,
    },
  };
}
