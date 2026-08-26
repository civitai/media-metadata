import type { ComfyNode } from './graph';

// Resource-name widgets (checkpoint/lora/vae/... names) whose links we resolve to a name/AIR
// rather than to a node object. Their links are left un-resolved by the generic pass so
// resolveResourceName still sees the [nodeId, outputSlot] link and can honor the output slot.
export const RESOURCE_NAME_KEYS = [
  'ckpt_name',
  'unet_name',
  'model_name',
  'vae_name',
  'control_net_name',
  'lora_name',
];
const NAME_WIDGET_KEYS = ['value', 'string'];

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

export function pushResourceName(
  names: string[],
  value: unknown,
  widgetKey: string,
  prompt: Record<string, ComfyNode>
) {
  const name = resolveResourceName(value, widgetKey, prompt);
  if (name) names.push(name);
}
