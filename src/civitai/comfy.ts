import type { CivitaiResource, GenerationMetadata } from '../shared/schema';
import type { ExifData } from '../shared/types';
import { removeEmpty } from '../shared/utils';
import { applyA1111Compat } from '../image/parsers/a1111-compat';
import type {
  AdditionalResource,
  ComfyNode,
  NodeNameIntercept,
} from '../image/parsers/comfyui/graph';
import type { ComfyUiState } from '../image/parsers/comfyui/index';
import {
  applySamplerNode,
  baseComfyMetadata,
  detectComfy,
  encodeComfy,
  scanComfyState,
} from '../image/parsers/comfyui/index';
import { applyFluxSampler } from '../image/parsers/comfyui/flux';
import { decodeUserComment } from '../image/read/user-comment';
import type { MetadataParser } from '../image/parsers/types';
import type { ParsedAir } from './air';

// A CivitaiModelSelector can supply several resources on different output slots; resources_json
// maps each output slot to its AIR. Resolve the specific slot the loader is wired to, falling
// back to the node's primary `air` when the slot isn't mapped.
function getSelectorAir(node: ComfyNode, slot: number | string | undefined): string | undefined {
  const raw = node.inputs?.resources_json;
  if (typeof raw === 'string' && slot != null) {
    try {
      const bySlot = (JSON.parse(raw) as { bySlot?: Record<string, string> }).bySlot;
      const air = bySlot?.[String(slot)];
      if (air) return air;
    } catch {
      // fall through to the primary air
    }
  }
  return typeof node.inputs?.air === 'string' ? node.inputs.air : undefined;
}

const selectorIntercept: NodeNameIntercept = (node, slot) =>
  node.class_type === 'CivitaiModelSelector' ? getSelectorAir(node, slot) : undefined;

const LEGACY_AIR_KEYS = ['ckpt_airs', 'lora_airs', 'embedding_airs'];

/** Pre-compliance workflows stored `modelId@versionId` strings under per-type extra keys. */
function parseLegacyAirKeys(workflowExtra: Record<string, unknown> | undefined) {
  const versionIds: number[] = [];
  const modelIds: number[] = [];
  if (workflowExtra) {
    for (const key of LEGACY_AIR_KEYS) {
      const airs = workflowExtra[key] as string[] | undefined;
      if (!airs) continue;
      for (const air of airs) {
        const [modelId, versionId] = air.split('@');
        if (versionId) versionIds.push(parseInt(versionId));
        else if (modelId) modelIds.push(parseInt(modelId));
      }
    }
  }
  return { versionIds, modelIds };
}

/**
 * Resolve the workflow's `urn:air:` identifiers into civitaiResources (dedup by
 * version id, carry lora strength as weight) and drop the matching entries from
 * additionalResources. Non-numeric versions (e.g. huggingface checkpoints) are
 * skipped — they stay in models/vaes/etc. as raw strings rather than becoming a
 * bogus civitaiResource with a null id.
 */
function applyCivitaiAirs(
  metadata: GenerationMetadata,
  airs: string[],
  additionalResources: AdditionalResource[],
  resolveAir: (air: string) => ParsedAir
): void {
  const civitaiResources = (metadata.civitaiResources ?? []) as CivitaiResource[];

  for (const air of airs) {
    const { version, type } = resolveAir(air);
    if (Number.isNaN(version)) continue;
    const resource: CivitaiResource = { modelVersionId: version, type };
    const weight = additionalResources.find((x) => x.name === air)?.strength;
    if (weight) resource.weight = weight;
    const index = civitaiResources.findIndex((x) => x.modelVersionId === resource.modelVersionId);
    if (index > -1) civitaiResources[index] = resource;
    else civitaiResources.push(resource);
    metadata.civitaiResources = civitaiResources;

    const additionalResourceIndex = additionalResources.findIndex((x) => x.name === air);
    if (additionalResourceIndex > -1)
      metadata.additionalResources?.splice(additionalResourceIndex, 1);
  }
}

/** Early civitai on-site comfy generations jammed the workflow JSON (marked by `extra`) into parameters/UserComment. */
function detectLegacy(exif: Readonly<ExifData>): ComfyUiState | null {
  let generationDetails: string | null = null;
  if (typeof exif.parameters === 'string') {
    generationDetails = exif.parameters;
  } else if (exif.userComment instanceof Uint8Array) {
    generationDetails = decodeUserComment(exif.userComment);
  }
  if (!generationDetails) return null;

  try {
    const details = JSON.parse(generationDetails);
    if (!details.extra) return null;
    const { extra: _extra, extraMetadata, ...workflow } = details;
    let parsedExtraMetadata: unknown;
    if (typeof extraMetadata === 'string') {
      try {
        parsedExtraMetadata = JSON.parse(extraMetadata);
      } catch {
        parsedExtraMetadata = undefined;
      }
    }
    return {
      prompt: JSON.stringify(workflow),
      workflow: generationDetails,
      extraMetadata: parsedExtraMetadata,
    };
  } catch {
    return null;
  }
}

/**
 * On-site generations carry a curated summary (extraMetadata) alongside the
 * graph — prefer it over graph inference when it has a prompt.
 */
function applyExtraMetadata(metadata: GenerationMetadata, extraMetadata: Record<string, any>) {
  const {
    prompt,
    negativePrompt,
    cfgScale,
    steps,
    seed,
    sampler,
    denoise,
    workflowId,
    workflow: workflowKey,
    resources,
    ...extra
  } = extraMetadata;
  metadata.prompt = prompt;
  metadata.negativePrompt = negativePrompt;
  metadata.cfgScale = cfgScale;
  metadata.steps = steps;
  metadata.seed = seed;
  metadata.sampler = sampler;
  metadata.denoise = denoise;
  // Newer generations put the workflow key in `workflow`; older ones used `workflowId`.
  // Store the full value (e.g. 'img2img:hires-fix') — consumers normalize it to a
  // technique name at lookup time.
  metadata.workflow = workflowId ?? workflowKey;
  metadata.civitaiResources = resources.map((x: any) => {
    if (x.strength) {
      x.weight = x.strength;
      delete x.strength;
    }
    return x;
  });
  if (extra) metadata.extra = extra;
}

/**
 * The civitai-aware ComfyUI parser: everything the core parser does, plus
 * CivitaiModelSelector resolution, the legacy on-site UserComment format, the
 * on-site extraMetadata summary, and AIR → civitaiResources resolution.
 */
export function createCivitaiComfyParser(
  resolveAir: (air: string) => ParsedAir
): MetadataParser<ComfyUiState> {
  return {
    generator: 'comfyui',
    detect(exif) {
      return detectComfy(exif) ?? detectLegacy(exif);
    },
    parse(state, ctx) {
      const { scan } = scanComfyState(state, ctx, selectorIntercept);

      // Default to an object (not undefined) so airs discovered in resource names below can be
      // attached even when the image carries only a `prompt` chunk and no `workflow` chunk.
      const workflow = state.workflow ? (JSON.parse(state.workflow) as any) : {};
      const { versionIds, modelIds } = parseLegacyAirKeys(workflow?.extra);
      let isCivitComfy = workflow?.extra?.airs?.length > 0;

      const metadata: GenerationMetadata = {
        ...baseComfyMetadata(state, scan),
        engine: isCivitComfy ? 'Civitai' : 'ComfyUI',
        versionIds,
        modelIds,
        // omitted for compliant Civitai workflows, whose graph is recoverable from the airs
        comfy: isCivitComfy
          ? undefined
          : `{"prompt": ${state.prompt}, "workflow": ${state.workflow}}`,
      };

      const extraMetadata = state.extraMetadata as Record<string, any> | undefined;
      if (extraMetadata && typeof extraMetadata === 'object' && extraMetadata.prompt) {
        applyExtraMetadata(metadata, extraMetadata);
      } else if (scan.customAdvancedSampler) {
        applyFluxSampler(scan.customAdvancedSampler, metadata);
      } else {
        applySamplerNode(metadata, scan);
        if (state.extraMetadata) metadata.extra = state.extraMetadata as Record<string, unknown>;
      }

      // AIRs referenced by resource-name widgets count even when workflow.extra.airs is absent
      const workflowAirs = [
        ...scan.models,
        ...scan.upscalers,
        ...scan.vaes,
        ...scan.additionalResources.map((x) => x.name),
      ].filter((x): x is string => typeof x === 'string' && x.startsWith('urn:air:'));
      if (workflowAirs.length > 0) {
        workflow.extra = { airs: workflowAirs };
        isCivitComfy = true;
      }

      if (isCivitComfy) {
        applyCivitaiAirs(metadata, workflow.extra.airs, scan.additionalResources, resolveAir);
      }

      applyA1111Compat(metadata, ctx.samplerMap);
      return removeEmpty(metadata);
    },
    encode(meta) {
      return encodeComfy(meta);
    },
  };
}
