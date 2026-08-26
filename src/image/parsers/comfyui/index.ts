import type { CivitaiResource, ComfyMetaSchema, GenerationMetadata } from '../../../shared/schema';
import { fromJson, removeEmpty } from '../../../shared/utils';
import { decodeUserComment } from '../../read/user-comment';
import { applyA1111Compat } from '../a1111-compat';
import type { MetadataParser } from '../types';
import { RESOURCE_NAME_KEYS, pushResourceName, resolveResourceName } from './civitai';
import type { ComfyNode, ComfyNumber, SamplerNode } from './graph';
import { cleanBadJson, getNumberValue, getPromptText } from './graph';

const AIR_KEYS = ['ckpt_airs', 'lora_airs', 'embedding_airs'];

type AdditionalResource = {
  name: string;
  type: string;
  strength: number;
  strengthClip: number;
};

export type ComfyUiState = {
  prompt?: string;
  workflow?: string;
  extraMetadata?: unknown;
};

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

    // WebP: workflow JSON in EXIF Model tag, prefixed with `prompt:`
    const model = exif.Model;
    if (Array.isArray(model) && typeof model[0] === 'string' && model[0].startsWith('prompt:')) {
      const comfyJson = model[0].replace(/^prompt:/, '');
      let extraMetadata: unknown;
      if (exif.userComment instanceof Uint8Array) {
        const extrasJson = decodeUserComment(exif.userComment);
        try {
          extraMetadata = (JSON.parse(extrasJson) as { extraMetadata?: unknown })?.extraMetadata;
          // Fix for bad json
          if (typeof extraMetadata === 'string') extraMetadata = JSON.parse(extraMetadata);
        } catch {
          extraMetadata = undefined;
        }
      }
      return { prompt: comfyJson, workflow: comfyJson, extraMetadata };
    }

    // Legacy: whole workflow JSON jammed into parameters/UserComment with an `extra` key
    let generationDetails: string | null = null;
    if (typeof exif.parameters === 'string') {
      generationDetails = exif.parameters;
    } else if (exif.userComment instanceof Uint8Array) {
      generationDetails = decodeUserComment(exif.userComment);
    }

    if (generationDetails) {
      try {
        const details = JSON.parse(generationDetails);
        const { extra: _extra, extraMetadata, ...workflow } = details;
        let parsedExtraMetadata: unknown;
        if (typeof extraMetadata === 'string') {
          try {
            parsedExtraMetadata = JSON.parse(extraMetadata);
          } catch {
            parsedExtraMetadata = undefined;
          }
        }
        if (details.extra) {
          return {
            prompt: JSON.stringify(workflow),
            workflow: generationDetails,
            extraMetadata: parsedExtraMetadata,
          };
        }
        return null;
      } catch {
        return null;
      }
    }

    return null;
  },
  parse(state, ctx) {
    const prompt = JSON.parse(cleanBadJson(state.prompt as string)) as Record<string, ComfyNode>;
    ctx.onDebug?.('nodeJson', prompt);
    const samplerNodes: SamplerNode[] = [];
    const models: string[] = [];
    const upscalers: string[] = [];
    const vaes: string[] = [];
    const controlNets: string[] = [];
    const additionalResources: AdditionalResource[] = [];
    const nodes = Object.values(prompt);
    for (const node of nodes) {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (Array.isArray(value) && !RESOURCE_NAME_KEYS.includes(key))
          node.inputs[key] = prompt[value[0]];
      }

      if (node.class_type == 'KSamplerAdvanced') {
        const simplifiedNode = { ...node.inputs };

        simplifiedNode.steps = getNumberValue(simplifiedNode.steps as ComfyNumber);
        simplifiedNode.cfg = getNumberValue(simplifiedNode.cfg as ComfyNumber);

        samplerNodes.push(simplifiedNode as unknown as SamplerNode);
      }

      if (node.class_type == 'KSampler') samplerNodes.push(node.inputs as unknown as SamplerNode);
      if (node.class_type == 'KSampler (Efficient)')
        samplerNodes.push(node.inputs as unknown as SamplerNode);

      if (['LoraLoader', 'LoraLoaderModelOnly'].includes(node.class_type)) {
        // Ignore lora nodes with strength 0
        const strength = node.inputs.strength_model as number;
        if (strength < 0.001 && strength > -0.001) continue;

        const loraName = resolveResourceName(node.inputs.lora_name, 'lora_name', prompt);
        if (!loraName) continue;

        additionalResources.push({
          name: loraName,
          type: 'lora',
          strength,
          strengthClip: node.inputs.strength_clip as number,
        });
      }

      if (['CheckpointLoaderSimple', 'CheckpointLoader'].includes(node.class_type))
        pushResourceName(models, node.inputs.ckpt_name, 'ckpt_name', prompt);

      if (node.class_type === 'UNETLoader')
        pushResourceName(models, node.inputs.unet_name, 'unet_name', prompt);

      if (node.class_type == 'UpscaleModelLoader')
        pushResourceName(upscalers, node.inputs.model_name, 'model_name', prompt);

      if (node.class_type == 'VAELoader')
        pushResourceName(vaes, node.inputs.vae_name, 'vae_name', prompt);

      if (node.class_type == 'ControlNetLoader')
        pushResourceName(controlNets, node.inputs.control_net_name, 'control_net_name', prompt);
    }
    const customAdvancedSampler = nodes.find((x) => x.class_type == 'SamplerCustomAdvanced');

    // Default to an object (not undefined) so airs discovered in resource names below can be
    // attached even when the image carries only a `prompt` chunk and no `workflow` chunk.
    const workflow = state.workflow ? (JSON.parse(state.workflow) as any) : {};
    const versionIds: number[] = [];
    const modelIds: number[] = [];
    let isCivitComfy = workflow?.extra?.airs?.length > 0;
    if (workflow?.extra) {
      // Old AIR parsing
      for (const key of AIR_KEYS) {
        const airs = workflow.extra[key];
        if (!airs) continue;

        for (const air of airs) {
          const [modelId, versionId] = air.split('@');
          if (versionId) versionIds.push(parseInt(versionId));
          else if (modelId) modelIds.push(parseInt(modelId));
        }
      }
    }

    const metadata: GenerationMetadata = {
      engine: isCivitComfy ? 'Civitai' : 'ComfyUI',
      models,
      upscalers,
      vaes,
      additionalResources,
      controlNets,
      versionIds,
      modelIds,
      // Converting to string to reduce bytes size
      // isCivitComfy to handle old generations when we weren't compliant
      comfy: isCivitComfy
        ? undefined
        : `{"prompt": ${state.prompt}, "workflow": ${state.workflow}}`,
    };
    const extraMetadata = state.extraMetadata as Record<string, any> | undefined;
    if (extraMetadata && typeof extraMetadata === 'object' && extraMetadata.prompt) {
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
    } else if (customAdvancedSampler) {
      // Flux-style graph

      // Get Seed
      const seedNode = customAdvancedSampler.inputs.noise as ComfyNode;
      if (seedNode?.class_type === 'RandomNoise')
        metadata.seed = seedNode.inputs.noise_seed as number;

      // Get sampler
      const samplerNode = customAdvancedSampler.inputs.sampler as ComfyNode;
      if (samplerNode?.class_type === 'KSamplerSelect')
        metadata.sampler = samplerNode.inputs.sampler_name as string;
      else if (samplerNode?.class_type === 'ODESamplerSelect')
        metadata.sampler = samplerNode.inputs.solver as string;

      // Get Guidance
      const guidanceNode = customAdvancedSampler.inputs.guider as ComfyNode;
      processGuidance: if (guidanceNode?.class_type === 'BasicGuider') {
        // Get cfgScale
        const conditioningNode = guidanceNode.inputs.conditioning as ComfyNode;
        let textEncoderNode: ComfyNode | undefined;
        if (conditioningNode?.class_type === 'CLIPTextEncode') {
          textEncoderNode = conditioningNode;
        } else if (conditioningNode?.class_type === 'FluxGuidance') {
          textEncoderNode = conditioningNode.inputs.conditioning as ComfyNode;
          metadata.cfgScale = conditioningNode.inputs.guidance as number;
        }

        // Get prompt
        if (textEncoderNode?.class_type !== 'CLIPTextEncode') break processGuidance;
        if (typeof textEncoderNode.inputs.text === 'string') {
          metadata.prompt = textEncoderNode.inputs.text;
          break processGuidance;
        }

        // Get prompt from node
        const textNode = textEncoderNode.inputs.text as ComfyNode;
        if (textNode?.class_type === 'ImpactWildcardProcessor') {
          metadata.prompt = textNode.inputs.populated_text as string;
        } else if (textNode?.class_type === 'String Literal')
          metadata.prompt = textNode.inputs.string as string;
      }

      // Get steps
      const schedulerNode = customAdvancedSampler.inputs.sigmas as ComfyNode;
      if (schedulerNode?.class_type === 'BasicScheduler') {
        metadata.steps = schedulerNode.inputs.steps as number;
        metadata.scheduler = schedulerNode.inputs.scheduler as string;
        metadata.denoise = schedulerNode.inputs.denoise as number;
      }

      // Get dimensions
      const latentImageNode = customAdvancedSampler.inputs.latent_image as ComfyNode;
      if (latentImageNode?.class_type === 'EmptyLatentImage') {
        metadata.width = getNumberValue(latentImageNode.inputs.width as ComfyNumber, ['int']);
        metadata.height = getNumberValue(latentImageNode.inputs.height as ComfyNumber, ['int']);
      }
    } else {
      const initialSamplerNode =
        samplerNodes.find((x) => x.latent_image?.class_type == 'EmptyLatentImage') ??
        samplerNodes[0];

      if (initialSamplerNode) {
        metadata.prompt = getPromptText(initialSamplerNode.positive, 'positive');
        metadata.negativePrompt = getPromptText(initialSamplerNode.negative, 'negative');
        metadata.cfgScale = initialSamplerNode.cfg;
        metadata.steps = initialSamplerNode.steps;
        metadata.seed = getNumberValue(initialSamplerNode.seed ?? initialSamplerNode.noise_seed!, [
          'Value',
          'seed',
        ]);
        metadata.sampler = initialSamplerNode.sampler_name;
        metadata.scheduler = initialSamplerNode.scheduler;
        metadata.denoise = initialSamplerNode.denoise;
        metadata.width = initialSamplerNode.latent_image.inputs.width;
        metadata.height = initialSamplerNode.latent_image.inputs.height;
      }
      if (state.extraMetadata) {
        metadata.extra = state.extraMetadata as Record<string, unknown>;
      }
    }

    // Get airs from parsed resources
    const workflowAirs = [
      ...models,
      ...upscalers,
      ...vaes,
      ...additionalResources.map((x) => x.name),
    ].filter((x): x is string => typeof x === 'string' && x.startsWith('urn:air:'));
    if (workflowAirs.length > 0) {
      workflow.extra = { airs: workflowAirs };
      isCivitComfy = true;
    }

    if (isCivitComfy) {
      const civitaiResources = (metadata.civitaiResources ?? []) as CivitaiResource[];

      for (const air of workflow.extra.airs) {
        const { version, type } = ctx.resolveAir(air);
        // Non-Civitai airs (e.g. huggingface checkpoints) have no numeric version — they stay in
        // `models`/etc. as raw strings rather than becoming a bogus civitaiResource with a null id.
        if (Number.isNaN(version)) continue;
        const resource: CivitaiResource = {
          modelVersionId: version,
          type,
        };
        const weight = additionalResources.find((x) => x.name === air)?.strength;
        if (weight) resource.weight = weight;
        const index = civitaiResources.findIndex(
          (x) => x.modelVersionId === resource.modelVersionId
        );
        if (index > -1) civitaiResources[index] = resource;
        else civitaiResources.push(resource);
        metadata.civitaiResources = civitaiResources;

        const additionalResourceIndex = additionalResources.findIndex((x) => x.name === air);
        if (additionalResourceIndex > -1)
          metadata.additionalResources?.splice(additionalResourceIndex, 1);
      }
    }

    // Map to automatic1111 terms for compatibility
    applyA1111Compat(metadata, ctx.samplerMap);

    return removeEmpty(metadata);
  },
  encode(meta) {
    const comfy =
      typeof meta.comfy === 'string' ? fromJson<ComfyMetaSchema>(meta.comfy) : meta.comfy;

    return comfy && comfy.workflow ? JSON.stringify(comfy.workflow) : '';
  },
};
