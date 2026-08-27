export type ComfyNode = {
  inputs: Record<string, number | string | Array<string | number> | ComfyNode>;
  class_type: string;
};

export type SamplerNode = {
  seed: number;
  noise_seed?: number;
  steps: number;
  cfg: number;
  sampler_name: string;
  scheduler: string;
  denoise: number;
  model: ComfyNode;
  positive: ComfyNode;
  negative: ComfyNode;
  latent_image: ComfyNode;
};

export function cleanBadJson(str: string) {
  return str
    .replace(/\[NaN\]/g, '[]')
    .replace(/\bNaN\b/g, '0')
    .replace(/\[Infinity\]/g, '[]');
}

const MAX_PROMPT_DEPTH = 20;

export function getPromptText(
  node: ComfyNode,
  target: 'positive' | 'negative' = 'positive',
  visited = new Set<ComfyNode>()
): string {
  if (visited.has(node) || visited.size >= MAX_PROMPT_DEPTH) return '';
  visited.add(node);

  if (node.class_type === 'ControlNetApply')
    return getPromptText(node.inputs.conditioning as ComfyNode, target, visited);
  if (node.class_type === 'FluxGuidance')
    return getPromptText(node.inputs.conditioning as ComfyNode, target, visited);

  // Handle wildcard nodes
  if (node.inputs?.populated_text) node.inputs.text = node.inputs.populated_text;

  if (node.inputs?.text) {
    if (typeof node.inputs.text === 'string') return node.inputs.text;
    if (typeof (node.inputs.text as ComfyNode).class_type !== 'undefined')
      return getPromptText(node.inputs.text as ComfyNode, target, visited);
  }
  if (node.inputs?.text_g) {
    if (!node.inputs?.text_l || node.inputs?.text_l === node.inputs?.text_g)
      return node.inputs.text_g as string;
    return `${node.inputs.text_g}, ${node.inputs.text_l}`;
  }
  if (node.inputs?.[`text_${target}`]) return node.inputs[`text_${target}`] as string;
  return '';
}

export type ComfyNumber = ComfyNode | number;
export function getNumberValue(input: ComfyNumber, valueNames = ['Value']) {
  if (typeof input === 'number') return input;
  for (const name of valueNames) {
    if (typeof input.inputs[name] !== 'undefined') return input.inputs[name] as number;
  }
  return 0;
}

export type AdditionalResource = {
  name: string;
  type: string;
  strength: number;
  strengthClip: number;
};

export type GraphScan = {
  samplerNodes: SamplerNode[];
  models: string[];
  upscalers: string[];
  vaes: string[];
  controlNets: string[];
  additionalResources: AdditionalResource[];
  /** The Flux-style sampler node, when the graph has one. */
  customAdvancedSampler: ComfyNode | undefined;
};

/** Widget keys that hold a resource NAME; how a linked name resolves is the caller's policy. */
export const RESOURCE_NAME_KEYS = [
  'ckpt_name',
  'unet_name',
  'model_name',
  'vae_name',
  'control_net_name',
  'lora_name',
];

const NAME_WIDGET_KEYS = ['value', 'string'];

/** Plugin hook: recognize a custom node that supplies a resource name (e.g. a picker node). */
export type NodeNameIntercept = (
  node: ComfyNode,
  outputSlot: number | string | undefined
) => string | undefined;

/**
 * Build a resolver that recovers a resource name from a widget value that may be
 * a literal string or a node link. Primitive/string nodes expose the value under
 * a `value`/`string` widget; `intercept` lets plugins claim custom node types
 * (civitai's CivitaiModelSelector carries AIRs this way).
 */
export function createNameResolver(
  prompt: Record<string, ComfyNode>,
  intercept?: NodeNameIntercept
): (value: unknown, widgetKey: string) => string | undefined {
  function resolve(value: unknown, widgetKey: string, depth = 0): string | undefined {
    if (typeof value === 'string') return value;
    if (depth >= 5 || value == null) return undefined;

    // Un-resolved node link: [nodeId, outputSlot]
    if (Array.isArray(value)) {
      const node = prompt[value[0]];
      if (!node) return undefined;
      const intercepted = intercept?.(node, value[1]);
      if (intercepted) return intercepted;
      return resolve(node, widgetKey, depth + 1);
    }

    if (typeof value !== 'object') return undefined;
    const node = value as ComfyNode;
    const intercepted = intercept?.(node, undefined);
    if (intercepted) return intercepted;
    for (const key of [widgetKey, ...NAME_WIDGET_KEYS]) {
      const nested = resolve(node.inputs?.[key], widgetKey, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }
  return (value, widgetKey) => resolve(value, widgetKey);
}

/**
 * Single pass over the node graph: resolve `[nodeId, slot]` links to node objects
 * (mutating the freshly-parsed graph — never caller input), collect sampler nodes,
 * and gather resource names via `resolveName` (which owns link-vs-literal policy —
 * see ../civitai.ts for the default that understands CivitaiModelSelector).
 * Resource-name links are deliberately left unresolved so `resolveName` still sees
 * the `[nodeId, outputSlot]` pair and can honor the output slot.
 */
export function scanGraph(
  prompt: Record<string, ComfyNode>,
  resolveName: (value: unknown, widgetKey: string) => string | undefined
): GraphScan {
  const scan: GraphScan = {
    samplerNodes: [],
    models: [],
    upscalers: [],
    vaes: [],
    controlNets: [],
    additionalResources: [],
    customAdvancedSampler: undefined,
  };

  const push = (names: string[], value: unknown, widgetKey: string) => {
    const name = resolveName(value, widgetKey);
    if (name) names.push(name);
  };

  const nodes = Object.values(prompt);
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && !RESOURCE_NAME_KEYS.includes(key))
        node.inputs[key] = prompt[value[0]];
    }

    switch (node.class_type) {
      case 'KSamplerAdvanced': {
        const simplified = { ...node.inputs };
        simplified.steps = getNumberValue(simplified.steps as ComfyNumber);
        simplified.cfg = getNumberValue(simplified.cfg as ComfyNumber);
        scan.samplerNodes.push(simplified as unknown as SamplerNode);
        break;
      }
      case 'KSampler':
      case 'KSampler (Efficient)':
        scan.samplerNodes.push(node.inputs as unknown as SamplerNode);
        break;
      case 'LoraLoader':
      case 'LoraLoaderModelOnly': {
        const strength = node.inputs.strength_model as number;
        // strength ~0 means the lora is wired in but disabled
        if (strength < 0.001 && strength > -0.001) break;
        const loraName = resolveName(node.inputs.lora_name, 'lora_name');
        if (!loraName) break;
        scan.additionalResources.push({
          name: loraName,
          type: 'lora',
          strength,
          strengthClip: node.inputs.strength_clip as number,
        });
        break;
      }
      case 'CheckpointLoaderSimple':
      case 'CheckpointLoader':
        push(scan.models, node.inputs.ckpt_name, 'ckpt_name');
        break;
      case 'UNETLoader':
        push(scan.models, node.inputs.unet_name, 'unet_name');
        break;
      case 'UpscaleModelLoader':
        push(scan.upscalers, node.inputs.model_name, 'model_name');
        break;
      case 'VAELoader':
        push(scan.vaes, node.inputs.vae_name, 'vae_name');
        break;
      case 'ControlNetLoader':
        push(scan.controlNets, node.inputs.control_net_name, 'control_net_name');
        break;
    }
  }

  scan.customAdvancedSampler = nodes.find((x) => x.class_type === 'SamplerCustomAdvanced');
  return scan;
}
