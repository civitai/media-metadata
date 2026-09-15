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

// Bounds the WORK, not the node count: a subtree feeding two inputs is walked
// once per path, so a diamond chain costs 2^depth without this. Real concatenate
// chains run to ~10 nodes, and a chain longer than this truncates SILENTLY.
const MAX_PROMPT_NODES = 512;

/** Widget keys a primitive string node puts its literal under (PrimitiveStringMultiline, String Literal). */
const LITERAL_TEXT_KEYS = ['value', 'string'];

/** Last-resort prompt source for text the executed graph doesn't carry — see `createWidgetTextFallback`. */
export type PromptTextFallback = (
  node: ComfyNode,
  target: 'positive' | 'negative'
) => string | undefined;

/**
 * `path` holds the nodes on the way to the current one, NOT every node seen: a
 * graph is a DAG, and the same string subtree feeding two inputs of a
 * concatenate is legal — treating the second visit as a cycle silently drops
 * that whole subtree's text. `budget` is what keeps that from being unbounded.
 */
type PromptWalk = { path: Set<ComfyNode>; budget: number };

export function getPromptText(
  node: ComfyNode,
  target: 'positive' | 'negative' = 'positive',
  fallback?: PromptTextFallback,
  walk: PromptWalk = { path: new Set(), budget: MAX_PROMPT_NODES }
): string {
  return walkPromptText(node, target, fallback, walk, false) ?? '';
}

/**
 * `undefined` means this node supplies no text AT ALL; `''` means it supplies
 * text and that text is empty. The caller needs the difference: an empty value
 * the graph actually resolved is the answer, and reaching past it to a stale UI
 * widget fabricates a prompt the run never used.
 *
 * `viaStringEdge` is false on the conditioning hops and true once the walk is
 * following a string input. Only then may a bare `value`/`string` widget be read
 * as prompt text — on a conditioning node that widget is a mode, not a prompt.
 */
function walkPromptText(
  node: ComfyNode,
  target: 'positive' | 'negative',
  fallback: PromptTextFallback | undefined,
  walk: PromptWalk,
  viaStringEdge: boolean
): string | undefined {
  if (!node || walk.path.has(node) || walk.budget <= 0) return undefined;
  walk.budget--;
  walk.path.add(node);
  try {
    return readPromptText(node, target, fallback, walk, viaStringEdge);
  } finally {
    walk.path.delete(node);
  }
}

function readPromptText(
  node: ComfyNode,
  target: 'positive' | 'negative',
  fallback: PromptTextFallback | undefined,
  walk: PromptWalk,
  viaStringEdge: boolean
): string | undefined {
  if (node.class_type === 'ControlNetApply' || node.class_type === 'FluxGuidance')
    return walkPromptText(node.inputs.conditioning as ComfyNode, target, fallback, walk, false);

  // Handle wildcard nodes
  if (node.inputs?.populated_text) node.inputs.text = node.inputs.populated_text;

  const text = node.inputs?.text;
  let resolvedEmpty = false;
  if (typeof text === 'string') {
    if (text) return text;
    resolvedEmpty = true;
  } else if (text && typeof (text as ComfyNode).class_type !== 'undefined') {
    const linked = walkPromptText(text as ComfyNode, target, fallback, walk, true);
    if (linked) return linked;
    if (linked !== undefined) resolvedEmpty = true;
  }

  if (node.inputs?.text_g) {
    if (!node.inputs?.text_l || node.inputs?.text_l === node.inputs?.text_g)
      return node.inputs.text_g as string;
    return `${node.inputs.text_g}, ${node.inputs.text_l}`;
  }
  if (node.inputs?.[`text_${target}`]) return node.inputs[`text_${target}`] as string;

  if (viaStringEdge)
    for (const key of LITERAL_TEXT_KEYS) {
      const literal = node.inputs?.[key];
      if (typeof literal === 'string') return literal;
    }

  // Concatenate chains over primitive string nodes: every word is in the executed
  // graph, only the joining is missing.
  if (node.inputs?.string_a !== undefined || node.inputs?.string_b !== undefined) {
    const parts: string[] = [];
    let anyResolved = false;
    for (const part of [node.inputs.string_a, node.inputs.string_b]) {
      let value: string | undefined;
      if (typeof part === 'string') value = part;
      else if (part && typeof (part as ComfyNode).class_type === 'string')
        value = walkPromptText(part as ComfyNode, target, fallback, walk, true);
      if (value === undefined) continue;
      anyResolved = true;
      if (value.length) parts.push(value);
    }
    if (parts.length) {
      const delimiter = typeof node.inputs.delimiter === 'string' ? node.inputs.delimiter : '';
      return parts.join(delimiter);
    }
    if (anyResolved) return '';
  }

  if (resolvedEmpty) return '';
  return fallback?.(node, target);
}

export type ComfyNumber = ComfyNode | number;
export function getNumberValue(input: ComfyNumber, valueNames = ['Value']) {
  if (typeof input === 'number') return input;
  // Widgets reach here holding anything; throwing would cost the image every
  // field, not one. A numeric string is a value, not a miss — returning the
  // default 0 for it would report a wrong number instead of no number.
  const direct = toNumber(input);
  if (direct !== undefined) return direct;
  if (!input || typeof input !== 'object' || !input.inputs) return 0;
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
  /**
   * Nodes matching KSampler's input shape under an unknown class. Optional so that
   * adding it stayed a non-breaking change for anyone constructing a GraphScan.
   */
  inferredSamplerNodes?: SamplerNode[];
  models: string[];
  upscalers: string[];
  vaes: string[];
  controlNets: string[];
  additionalResources: AdditionalResource[];
  /** The Flux-style sampler node, when the graph has one. */
  customAdvancedSampler: ComfyNode | undefined;
  /** `scanComfyState` sets this; a plugin calling `scanGraph` directly gets no fallback. */
  promptTextFallback?: PromptTextFallback;
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

const UNSET_NAME = 'none';

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
    // pysssss loaders wrap the widget value as `{ content, image }` — a bare object
    // with no `inputs` of its own, which the widget walk below cannot see into.
    const content = (value as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    for (const key of [widgetKey, ...NAME_WIDGET_KEYS]) {
      const nested = resolve(node.inputs?.[key], widgetKey, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }
  return (value, widgetKey) => resolve(value, widgetKey);
}

const LORA_TAG = /<lora:([^>]+)>/gi;

/**
 * A1111-style `<lora:name:weight>` tags, as the LoraManager and Anima remap nodes
 * write them. The body is split from the RIGHT and only trailing numeric segments
 * are taken as weights, because a name may contain colons and a weight may be
 * spelled in ways a number pattern won't match (`+0.5`, `1e-2`). Matching the
 * weight inside the tag pattern instead loses the whole lora when the spelling is
 * unexpected, where the name alone is still worth having.
 */
export function parseLoraTags(text: unknown): { name: string; strength?: number }[] {
  if (typeof text !== 'string' || !/<lora:/i.test(text)) return [];
  const tags: { name: string; strength?: number }[] = [];
  for (const match of text.matchAll(LORA_TAG)) {
    const segments = match[1].split(':');
    let strength: number | undefined;
    while (segments.length > 1) {
      const weight = toNumber(segments[segments.length - 1].trim());
      if (weight === undefined) break;
      segments.pop();
      // the first weight from the right is clip strength when two are present
      strength = weight;
    }
    const name = segments.join(':').trim();
    if (name) tags.push({ name, strength });
  }
  return tags;
}

type LoraManagerEntry = {
  name?: string;
  strength?: string | number;
  clipStrength?: string | number;
  active?: boolean;
};

function loraManagerEntries(loras: unknown): LoraManagerEntry[] {
  if (Array.isArray(loras)) return loras as LoraManagerEntry[];
  const wrapped = (loras as { __value__?: unknown } | null)?.__value__;
  return Array.isArray(wrapped) ? (wrapped as LoraManagerEntry[]) : [];
}

function toNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

const SAMPLER_INPUTS = ['positive', 'negative', 'latent_image', 'sampler_name'];

function isSamplerShaped(inputs: ComfyNode['inputs']): boolean {
  // `in` throws on a primitive, and this runs against every unrecognized node in
  // the graph — a Note whose inputs are a bare string would cost the whole image.
  if (!inputs || typeof inputs !== 'object') return false;
  return SAMPLER_INPUTS.every((key) => key in inputs);
}

/** steps/cfg may arrive as linked primitive nodes rather than literals. */
function toSamplerNode(inputs: ComfyNode['inputs']): SamplerNode {
  const simplified = { ...inputs };
  if (simplified.steps != null) simplified.steps = getNumberValue(simplified.steps as ComfyNumber);
  if (simplified.cfg != null) simplified.cfg = getNumberValue(simplified.cfg as ComfyNumber);
  return simplified as unknown as SamplerNode;
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
    inferredSamplerNodes: [],
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

  const pushLora = (name: string | undefined, rawStrength: unknown, rawClip: unknown) => {
    if (!name || name.toLowerCase() === UNSET_NAME) return;
    // Coerce here rather than at each call site: a strength widget converted to an
    // input arrives as a NODE, and `additionalResources[].strength` is a required
    // number in the schema, so one bad weight fails safeParse and the reader falls
    // back to an empty bag — costing the image every field it had.
    const strength = toNumber(rawStrength);
    // strength ~0 means the lora is wired in but disabled
    if (strength != null && strength < 0.001 && strength > -0.001) return;
    scan.additionalResources.push({
      name,
      type: 'lora',
      strength: strength as number,
      strengthClip: toNumber(rawClip) as number,
    });
  };

  const nodes = Object.values(prompt);
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node.inputs)) {
      // Only a resolvable `[nodeId, slot]` link is rewritten. A widget holding a
      // genuine array — LoraManager's `loras` stack — must survive: `prompt[{…}]`
      // is undefined, and overwriting with it silently discards the whole stack.
      if (Array.isArray(value) && !RESOURCE_NAME_KEYS.includes(key) && prompt[value[0] as string])
        node.inputs[key] = prompt[value[0] as string];
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
      case 'LoraLoaderModelOnly':
      case 'LoraLoader|pysssss':
      case 'LoraLoaderModelOnly|pysssss':
        pushLora(
          resolveName(node.inputs.lora_name, 'lora_name'),
          node.inputs.strength_model as number,
          node.inputs.strength_clip as number
        );
        break;
      // rgthree keeps the whole stack on one node; there are no per-lora loader nodes to find.
      case 'Power Lora Loader (rgthree)':
        for (const [key, value] of Object.entries(node.inputs)) {
          if (!/^lora_\d+$/.test(key)) continue;
          const entry = value as {
            on?: boolean;
            lora?: string;
            strength?: number;
            strengthTwo?: number;
          };
          if (!entry || entry.on === false) continue;
          pushLora(entry.lora, entry.strength, entry.strengthTwo);
        }
        break;
      case 'Lora Loader Stack (rgthree)':
        for (const key of Object.keys(node.inputs)) {
          const slot = /^lora_(\d+)$/.exec(key);
          if (!slot) continue;
          pushLora(
            resolveName(node.inputs[key], key),
            toNumber(node.inputs[`strength_${slot[1]}`]),
            undefined
          );
        }
        break;
      // LoraManager writes names with no file extension.
      case 'Lora Loader (LoraManager)':
      case 'Lora Stacker (LoraManager)': {
        const entries = loraManagerEntries(node.inputs.loras);
        for (const entry of entries) {
          if (entry?.active === false) continue;
          pushLora(entry?.name, toNumber(entry?.strength), toNumber(entry?.clipStrength));
        }
        // Tag text duplicates the `loras` widget, so read it only when that widget is empty.
        if (!entries.length)
          for (const tag of parseLoraTags(node.inputs.text))
            pushLora(tag.name, tag.strength, undefined);
        break;
      }
      case 'AnimaLoRARemapTagLoader':
        for (const tag of parseLoraTags(node.inputs.text))
          pushLora(tag.name, tag.strength ?? toNumber(node.inputs.default_weight), undefined);
        break;
      case 'CheckpointLoaderSimple':
      case 'CheckpointLoader':
      case 'CheckpointLoader|pysssss':
      case 'CheckpointLoaderSimple|pysssss':
        push(scan.models, node.inputs.ckpt_name, 'ckpt_name');
        break;
      // easy-use's `vae_name` is a mode ('Baked VAE'), not a file — deliberately not pushed to vaes.
      case 'easy fullLoader':
      case 'easy a1111Loader':
      case 'easy comfyLoader':
        push(scan.models, node.inputs.ckpt_name, 'ckpt_name');
        pushLora(
          resolveName(node.inputs.lora_name, 'lora_name'),
          toNumber(node.inputs.lora_model_strength),
          toNumber(node.inputs.lora_clip_strength)
        );
        break;
      case 'UNETLoader':
      case 'UnetLoaderGGUF':
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
      // Vendor samplers (IllustriousKSamplerPro, KSampler_A1111, Tiled KSampler, …) reimplement
      // KSampler's contract under their own class; shape-matching covers those not yet enumerated.
      default:
        if (isSamplerShaped(node.inputs))
          (scan.inferredSamplerNodes ??= []).push(toSamplerNode(node.inputs));
    }
  }

  scan.customAdvancedSampler = nodes.find((x) => x.class_type === 'SamplerCustomAdvanced');
  return scan;
}
