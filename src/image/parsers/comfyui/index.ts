import type { ComfyMetaSchema, GenerationMetadata } from '../../../shared/schema';
import { fromJson, removeEmpty } from '../../../shared/utils';
import { decodeUserComment } from '../../read/user-comment';
import { applyA1111Compat } from '../a1111-compat';
import type { MetadataParser } from '../types';
import { applyCivitaiAirs, parseLegacyAirKeys, resolveResourceName } from './civitai';
import type { ComfyNode, GraphScan } from './graph';
import { cleanBadJson, getNumberValue, getPromptText, scanGraph } from './graph';
import { applyFluxSampler } from './flux';

export type ComfyUiState = {
  prompt?: string;
  workflow?: string;
  extraMetadata?: unknown;
};

// #region [detect]
function detectWebp(exif: Readonly<Record<string, unknown>>): ComfyUiState | null {
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

function detectLegacy(exif: Readonly<Record<string, unknown>>): ComfyUiState | null {
  // Early civitai comfy generations jammed the whole workflow JSON (marked by an
  // `extra` key) into parameters/UserComment
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
// #endregion

// #region [parse phases]
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

/** Classic KSampler graph: read params off the sampler feeding an EmptyLatentImage. */
function applySamplerNode(metadata: GenerationMetadata, scan: GraphScan) {
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
// #endregion

export const comfyUiParser: MetadataParser<ComfyUiState> = {
  generator: 'comfyui',
  detect(exif) {
    // Standard ComfyUI PNG: `prompt` and/or `workflow` text chunks
    if (exif.prompt || exif.workflow) {
      return {
        prompt: exif.prompt as string | undefined,
        workflow: exif.workflow as string | undefined,
        extraMetadata: exif.extraMetadata,
      };
    }
    return detectWebp(exif) ?? detectLegacy(exif);
  },
  parse(state, ctx) {
    const prompt = JSON.parse(cleanBadJson(state.prompt as string)) as Record<string, ComfyNode>;
    ctx.onDebug?.('nodeJson', prompt);

    const scan = scanGraph(prompt, (value, widgetKey) =>
      resolveResourceName(value, widgetKey, prompt)
    );

    // Default to an object (not undefined) so airs discovered in resource names below can be
    // attached even when the image carries only a `prompt` chunk and no `workflow` chunk.
    const workflow = state.workflow ? (JSON.parse(state.workflow) as any) : {};
    const { versionIds, modelIds } = parseLegacyAirKeys(workflow?.extra);
    let isCivitComfy = workflow?.extra?.airs?.length > 0;

    const metadata: GenerationMetadata = {
      engine: isCivitComfy ? 'Civitai' : 'ComfyUI',
      models: scan.models,
      upscalers: scan.upscalers,
      vaes: scan.vaes,
      additionalResources: scan.additionalResources,
      controlNets: scan.controlNets,
      versionIds,
      modelIds,
      // Stringified to reduce stored size; omitted for compliant Civitai workflows,
      // whose graph is recoverable from the airs.
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
      applyCivitaiAirs(metadata, workflow.extra.airs, scan.additionalResources, ctx);
    }

    applyA1111Compat(metadata, ctx.samplerMap);

    return removeEmpty(metadata);
  },
  encode(meta) {
    const comfy =
      typeof meta.comfy === 'string' ? fromJson<ComfyMetaSchema>(meta.comfy) : meta.comfy;

    return comfy && comfy.workflow ? JSON.stringify(comfy.workflow) : '';
  },
};
