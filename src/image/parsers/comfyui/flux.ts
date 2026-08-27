import type { GenerationMetadata } from '../../../shared/schema';
import type { ComfyNode, ComfyNumber } from './graph';
import { getNumberValue } from './graph';

/**
 * Flux-style graphs don't use KSampler — generation params hang off a
 * SamplerCustomAdvanced node's noise/sampler/guider/sigmas/latent inputs.
 */
export function applyFluxSampler(sampler: ComfyNode, metadata: GenerationMetadata): void {
  const seedNode = sampler.inputs.noise as ComfyNode;
  if (seedNode?.class_type === 'RandomNoise') metadata.seed = seedNode.inputs.noise_seed as number;

  const samplerNode = sampler.inputs.sampler as ComfyNode;
  if (samplerNode?.class_type === 'KSamplerSelect')
    metadata.sampler = samplerNode.inputs.sampler_name as string;
  else if (samplerNode?.class_type === 'ODESamplerSelect')
    metadata.sampler = samplerNode.inputs.solver as string;

  const guidanceNode = sampler.inputs.guider as ComfyNode;
  processGuidance: if (guidanceNode?.class_type === 'BasicGuider') {
    const conditioningNode = guidanceNode.inputs.conditioning as ComfyNode;
    let textEncoderNode: ComfyNode | undefined;
    if (conditioningNode?.class_type === 'CLIPTextEncode') {
      textEncoderNode = conditioningNode;
    } else if (conditioningNode?.class_type === 'FluxGuidance') {
      textEncoderNode = conditioningNode.inputs.conditioning as ComfyNode;
      metadata.cfgScale = conditioningNode.inputs.guidance as number;
    }

    if (textEncoderNode?.class_type !== 'CLIPTextEncode') break processGuidance;
    if (typeof textEncoderNode.inputs.text === 'string') {
      metadata.prompt = textEncoderNode.inputs.text;
      break processGuidance;
    }

    // prompt supplied via a linked node rather than a literal
    const textNode = textEncoderNode.inputs.text as ComfyNode;
    if (textNode?.class_type === 'ImpactWildcardProcessor') {
      metadata.prompt = textNode.inputs.populated_text as string;
    } else if (textNode?.class_type === 'String Literal')
      metadata.prompt = textNode.inputs.string as string;
  }

  const schedulerNode = sampler.inputs.sigmas as ComfyNode;
  if (schedulerNode?.class_type === 'BasicScheduler') {
    metadata.steps = schedulerNode.inputs.steps as number;
    metadata.scheduler = schedulerNode.inputs.scheduler as string;
    metadata.denoise = schedulerNode.inputs.denoise as number;
  }

  const latentImageNode = sampler.inputs.latent_image as ComfyNode;
  if (latentImageNode?.class_type === 'EmptyLatentImage') {
    metadata.width = getNumberValue(latentImageNode.inputs.width as ComfyNumber, ['int']);
    metadata.height = getNumberValue(latentImageNode.inputs.height as ComfyNumber, ['int']);
  }
}
