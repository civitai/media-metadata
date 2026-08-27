import type { CivitaiResource, GenerationMetadata } from '../../../shared/schema';
import type { ParserContext } from '../types';
import type { AdditionalResource, ComfyNode } from './graph';

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

const NAME_WIDGET_KEYS = ['value', 'string'];

// Recover a resource name/AIR from a widget value that may be a literal string or a node link.
// Civitai's ComfyUI resource picker (CivitaiModelSelector) carries AIRs; primitive/string nodes
// expose the value under a `value`/`string` widget. Returns undefined when nothing usable exists.
export function resolveResourceName(
  value: unknown,
  widgetKey: string,
  prompt: Record<string, ComfyNode>,
  depth = 0
): string | undefined {
  if (typeof value === 'string') return value;
  if (depth >= 5 || value == null) return undefined;

  // Un-resolved node link: [nodeId, outputSlot]
  if (Array.isArray(value)) {
    const node = prompt[value[0]];
    if (!node) return undefined;
    if (node.class_type === 'CivitaiModelSelector') return getSelectorAir(node, value[1]);
    return resolveResourceName(node, widgetKey, prompt, depth + 1);
  }

  if (typeof value !== 'object') return undefined;
  const node = value as ComfyNode;
  if (node.class_type === 'CivitaiModelSelector') return getSelectorAir(node, undefined);
  for (const key of [widgetKey, ...NAME_WIDGET_KEYS]) {
    const nested = resolveResourceName(node.inputs?.[key], widgetKey, prompt, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

const LEGACY_AIR_KEYS = ['ckpt_airs', 'lora_airs', 'embedding_airs'];

/** Pre-compliance workflows stored `modelId@versionId` strings under per-type extra keys. */
export function parseLegacyAirKeys(workflowExtra: Record<string, unknown> | undefined) {
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
export function applyCivitaiAirs(
  metadata: GenerationMetadata,
  airs: string[],
  additionalResources: AdditionalResource[],
  ctx: ParserContext
): void {
  const civitaiResources = (metadata.civitaiResources ?? []) as CivitaiResource[];

  for (const air of airs) {
    const { version, type } = ctx.resolveAir(air);
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
