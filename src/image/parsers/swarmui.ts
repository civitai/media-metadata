import type { GenerationMetadata } from '../../shared/schema';
import { removeEmpty } from '../../shared/utils';
import { applyA1111Compat } from './a1111-compat';
import type { MetadataParser } from './types';

function cleanBadJson(str: string) {
  return str
    .replace(/\[NaN\]/g, '[]')
    .replace(/\bNaN\b/g, '0')
    .replace(/\[Infinity\]/g, '[]');
}

type SwarmUiMetadata = {
  sui_image_params?: Record<string, any>;
  sui_models?: { name: string; param: string; hash: string; weight?: number }[];
};

export type SwarmUiState = { params: string };

// https://github.com/mcmonkeyprojects/SwarmUI/blob/master/docs/Image%20Metadata%20Format.md#sui_models
export const swarmUiParser: MetadataParser<SwarmUiState> = {
  generator: 'swarmui',
  detect(exif) {
    const params = exif.parameters;
    if (typeof params !== 'string') return null;
    if (!params.includes('sui_image_params')) return null;
    return { params };
  },
  parse(state, ctx) {
    const parsed: SwarmUiMetadata = JSON.parse(cleanBadJson(state.params));
    const generationDetails = parsed.sui_image_params ?? {};

    ctx.onDebug?.('nodeJson', generationDetails);

    const metadata: GenerationMetadata = removeEmpty({
      prompt: generationDetails.prompt,
      negativePrompt: generationDetails.negativeprompt,
      cfgScale: generationDetails.cfgscale,
      steps: generationDetails.steps,
      seed: generationDetails.seed,
      width: generationDetails.width,
      height: generationDetails.height,
      sampler: generationDetails.sampler,
      scheduler: generationDetails.scheduler,
      // upstream writes `swarm_version` (see docs/format-references.md);
      // `swarmVersion` is kept as a fallback for our own historical encodes
      version: generationDetails.swarm_version ?? generationDetails.swarmVersion,
      Model: generationDetails.model,
      resources: getResources(parsed),
    });

    applyA1111Compat(metadata, ctx.samplerMap, { preserveOriginal: true });

    return metadata;
  },
  encode(meta) {
    return JSON.stringify({
      sui_image_params: {
        prompt: meta.prompt,
        negativeprompt: meta.negativePrompt,
        cfgscale: meta.cfgScale,
        steps: meta.steps,
        seed: meta.seed,
        width: meta.width,
        height: meta.height,
        aspectratio: 'custom',
        sampler: meta.originalSampler ?? meta.sampler,
        scheduler: meta.scheduler,
        model: meta.Model,
        swarm_version: meta.version,
      },
      sui_models: (
        meta.resources as
          { type: string; name?: string; weight?: number; hash?: string }[] | undefined
      )?.map(({ type, name, weight, hash }) => ({
        name: name!,
        weight: weight,
        hash: hash!,
        param: type,
      })),
    } satisfies SwarmUiMetadata);
  },
};

function getResources({ sui_image_params = {}, sui_models = [] }: SwarmUiMetadata) {
  const loras: string[] = sui_image_params.loras ?? [];
  const resources = sui_models.map(({ name, param, hash, weight }) => {
    const nameWithoutExtension = name.split('.')[0];
    let type = param;
    if (type === 'loras') type = 'lora';
    const loraIndex = loras.findIndex((lora) => lora === nameWithoutExtension);
    return removeEmpty({
      name: nameWithoutExtension,
      type,
      hash: hash?.replace('0x', '').slice(0, 12),
      weight:
        weight ?? (loraIndex > -1 ? Number(sui_image_params.loraweights[loraIndex]) : undefined),
    });
  });

  return resources;
}
