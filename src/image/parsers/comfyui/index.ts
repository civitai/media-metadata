import type { ComfyMetaSchema, GenerationMetadata } from '../../../shared/schema';
import type { ExifData } from '../../../shared/types';
import { fromJson, removeEmpty } from '../../../shared/utils';
import { decodeUserComment } from '../../read/user-comment';
import { applyA1111Compat } from '../a1111-compat';
import type { MetadataParser, ParserContext } from '../types';
import type { ComfyNode, GraphScan, NodeNameIntercept } from './graph';
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
  const node =
    scan.samplerNodes.find((x) => x.latent_image?.class_type === 'EmptyLatentImage') ??
    scan.samplerNodes[0];
  if (!node) return;
  metadata.prompt = getPromptText(node.positive, 'positive');
  metadata.negativePrompt = getPromptText(node.negative, 'negative');
  metadata.cfgScale = node.cfg;
  metadata.steps = node.steps;
  metadata.seed = getNumberValue(node.seed ?? node.noise_seed!, ['Value', 'seed']);
  metadata.sampler = node.sampler_name;
  metadata.scheduler = node.scheduler;
  metadata.denoise = node.denoise;
  metadata.width = node.latent_image.inputs.width;
  metadata.height = node.latent_image.inputs.height;
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
      applyFluxSampler(scan.customAdvancedSampler, metadata);
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
