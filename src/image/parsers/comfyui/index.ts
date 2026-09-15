import type { ComfyMetaSchema, GenerationMetadata } from '../../../shared/schema';
import type { ExifData } from '../../../shared/types';
import { fromJson, removeEmpty } from '../../../shared/utils';
import { decodeUserComment } from '../../read/user-comment';
import { applyA1111Compat } from '../a1111-compat';
import type { MetadataParser, ParserContext } from '../types';
import type { ComfyNode, GraphScan, NodeNameIntercept, PromptTextFallback } from './graph';
import {
  cleanBadJson,
  createNameResolver,
  getNumberValue,
  getPromptText,
  scanGraph,
} from './graph';
import { applyFluxSampler } from './flux';

export type ComfyUiState = {
  prompt?: string;
  workflow?: string;
  extraMetadata?: unknown;
};

// #region [detect]
/** Standard ComfyUI PNG (`prompt`/`workflow` text chunks) and WebP (prompt JSON in EXIF Model). */
export function detectComfy(exif: Readonly<ExifData>): ComfyUiState | null {
  if (exif.prompt || exif.workflow) {
    return {
      prompt: exif.prompt as string | undefined,
      workflow: exif.workflow as string | undefined,
      extraMetadata: exif.extraMetadata,
    };
  }

  // ComfyUI webp save nodes put the prompt JSON in the EXIF Model tag, prefixed `prompt:`
  const model = exif.Model;
  if (!Array.isArray(model) || typeof model[0] !== 'string' || !model[0].startsWith('prompt:'))
    return null;

  const comfyJson = model[0].replace(/^prompt:/, '');
  let extraMetadata: unknown;
  if (exif.userComment instanceof Uint8Array) {
    try {
      extraMetadata = (
        JSON.parse(decodeUserComment(exif.userComment)) as { extraMetadata?: unknown }
      )?.extraMetadata;
      // some writers double-encode it
      if (typeof extraMetadata === 'string') extraMetadata = JSON.parse(extraMetadata);
    } catch {
      extraMetadata = undefined;
    }
  }
  return { prompt: comfyJson, workflow: comfyJson, extraMetadata };
}
// #endregion

// #region [parse phases]
/** Classic KSampler graph: read params off the sampler feeding an EmptyLatentImage. */
export function applySamplerNode(metadata: GenerationMetadata, scan: GraphScan) {
  const candidates = scan.samplerNodes.length
    ? scan.samplerNodes
    : (scan.inferredSamplerNodes ?? []);
  const node =
    candidates.find((x) => x.latent_image?.class_type === 'EmptyLatentImage') ?? candidates[0];
  if (!node) return;
  metadata.prompt = getPromptText(node.positive, 'positive', scan.promptTextFallback);
  metadata.negativePrompt = getPromptText(node.negative, 'negative', scan.promptTextFallback);
  metadata.cfgScale = node.cfg;
  metadata.steps = node.steps;
  const seed = node.seed ?? node.noise_seed;
  if (seed !== undefined) metadata.seed = getNumberValue(seed, ['Value', 'seed']);
  metadata.sampler = node.sampler_name;
  metadata.scheduler = node.scheduler;
  metadata.denoise = node.denoise;
  // A KSampler always carries a latent; a node matched on shape alone need not.
  metadata.width = dimension(node.latent_image?.inputs?.width, 'width');
  metadata.height = dimension(node.latent_image?.inputs?.height, 'height');
}

/**
 * A size widget may be linked to a resolution picker rather than typed in, and the
 * link resolves to the picker NODE. Storing that object publishes a chunk of graph
 * as the image's width; `getNumberValue`'s 0 default is no better, so miss instead.
 *
 * `axis` is why this isn't a shared key list: a picker node carries both `width`
 * and `height`, and a list that tried each in turn would report the width twice.
 */
function dimension(value: unknown, axis: 'width' | 'height'): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return toFiniteNumber(value);
  const inputs = (value as ComfyNode | undefined)?.inputs;
  if (!inputs) return undefined;
  for (const key of ['value', 'int', 'Value', axis]) {
    const found = toFiniteNumber(inputs[key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** The workflow fallback is restricted to text-encode nodes; other widgets hold filenames and modes. */
const TEXT_ENCODE_CLASS = /textencode/i;

type WorkflowNode = {
  id?: number | string;
  type?: string;
  widgets_values?: unknown;
  /** Newer frontends also key the widget values by name. */
  widgets_values_named?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Positional widgets don't say which slot is the text; guessing stored `token_normalization` as a prompt, so read slot 0 or decline. */
function promptWidget(node: WorkflowNode, target: 'positive' | 'negative'): string | undefined {
  const named = asRecord(node.widgets_values_named) ?? asRecord(node.widgets_values);
  if (named) {
    for (const key of ['text', `text_${target}`, 'text_g', 'populated_text'])
      if (nonEmptyString(named[key])) return named[key] as string;
    return undefined;
  }
  return Array.isArray(node.widgets_values) ? nonEmptyString(node.widgets_values[0]) : undefined;
}

/**
 * ComfyUI keeps a node's last widget value in the UI `workflow` graph after that
 * widget is converted to a link, so a prompt fed in from another node is absent
 * from the executed `prompt` graph but still present in `workflow`.
 */
export function createWidgetTextFallback(
  workflowJson: string | undefined,
  prompt: Record<string, ComfyNode>
): PromptTextFallback | undefined {
  if (!workflowJson) return undefined;
  let workflowNodes: WorkflowNode[];
  try {
    workflowNodes =
      (JSON.parse(cleanBadJson(workflowJson)) as { nodes?: WorkflowNode[] }).nodes ?? [];
  } catch {
    return undefined;
  }
  if (!workflowNodes.length) return undefined;

  const byId = new Map<string, WorkflowNode>();
  const ambiguous = new Set<string>();
  for (const node of workflowNodes) {
    if (node?.id == null) continue;
    const id = String(node.id);
    // Two nodes on one id says nothing about which the executed graph means, and
    // last-write-wins would pick one of their prompts at random.
    if (byId.has(id)) ambiguous.add(id);
    byId.set(id, node);
  }
  for (const id of ambiguous) byId.delete(id);
  const idByNode = new Map<ComfyNode, string>();
  for (const [id, node] of Object.entries(prompt)) idByNode.set(node, id);

  return (node, target) => {
    if (!TEXT_ENCODE_CLASS.test(node.class_type ?? '')) return undefined;
    const id = idByNode.get(node);
    const workflowNode = id !== undefined ? byId.get(id) : undefined;
    // Same id AND same class, or the two graphs aren't describing the same node.
    if (!workflowNode || workflowNode.type !== node.class_type) return undefined;
    return promptWidget(workflowNode, target);
  };
}

/** Shared body for the core parser and plugin parsers that extend it. */
export function scanComfyState(
  state: ComfyUiState,
  ctx: ParserContext,
  intercept?: NodeNameIntercept
): { prompt: Record<string, ComfyNode>; scan: GraphScan } {
  const prompt = JSON.parse(cleanBadJson(state.prompt as string)) as Record<string, ComfyNode>;
  ctx.onDebug?.('nodeJson', prompt);
  const scan = scanGraph(prompt, createNameResolver(prompt, intercept));
  scan.promptTextFallback = createWidgetTextFallback(state.workflow, prompt);
  return { prompt, scan };
}

export function baseComfyMetadata(state: ComfyUiState, scan: GraphScan): GenerationMetadata {
  return {
    engine: 'ComfyUI',
    models: scan.models,
    upscalers: scan.upscalers,
    vaes: scan.vaes,
    additionalResources: scan.additionalResources,
    controlNets: scan.controlNets,
    // Stringified to reduce stored size
    comfy: `{"prompt": ${state.prompt}, "workflow": ${state.workflow}}`,
  };
}

export function encodeComfy(meta: GenerationMetadata): string {
  const comfy = typeof meta.comfy === 'string' ? fromJson<ComfyMetaSchema>(meta.comfy) : meta.comfy;
  return comfy && comfy.workflow ? JSON.stringify(comfy.workflow) : '';
}
// #endregion

export const comfyUiParser: MetadataParser<ComfyUiState> = {
  generator: 'comfyui',
  detect(exif) {
    return detectComfy(exif);
  },
  parse(state, ctx) {
    const { scan } = scanComfyState(state, ctx);
    const metadata = baseComfyMetadata(state, scan);

    if (scan.customAdvancedSampler) {
      applyFluxSampler(scan.customAdvancedSampler, metadata, scan.promptTextFallback);
    } else {
      applySamplerNode(metadata, scan);
    }
    if (state.extraMetadata) metadata.extra = state.extraMetadata as Record<string, unknown>;

    applyA1111Compat(metadata, ctx.samplerMap);
    return removeEmpty(metadata);
  },
  encode(meta) {
    return encodeComfy(meta);
  },
};
