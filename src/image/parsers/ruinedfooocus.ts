import type { GenerationMetadata } from '../../shared/schema';
import { applyA1111Compat } from './a1111-compat';
import type { MetadataParser } from './types';

export type RuinedFooocusState = { parameters: string };

export const ruinedFooocusParser: MetadataParser<RuinedFooocusState> = {
  generator: 'ruinedfooocus',
  detect(exif) {
    const parameters = exif.parameters;
    if (typeof parameters !== 'string') return null;
    // whitespace-tolerant: python's json.dumps writes `": "`, JS's stringify writes `":"`
    if (!/"software":\s*"RuinedFooocus"/.test(parameters)) return null;
    return { parameters };
  },
  parse(state, ctx) {
    const {
      Prompt: prompt,
      Negative: negativePrompt,
      cfg: cfgScale,
      steps,
      seed,
      scheduler,
      denoise,
      width,
      height,
      base_model_hash,
      software,
      ...other
    } = JSON.parse(state.parameters);

    const metadata: GenerationMetadata = {
      prompt,
      negativePrompt,
      cfgScale,
      steps,
      seed,
      sampler: other.sampler_name,
      denoise,
      width,
      height,
      Model: other.base_model_name.split('.').slice(0, -1).join('.'),
      'Model hash': base_model_hash,
      software,
      other,
    };

    if (scheduler !== 'simple') metadata.scheduler = scheduler;

    applyA1111Compat(metadata, ctx.samplerMap);

    return metadata;
  },
  encode(meta) {
    return JSON.stringify({
      Prompt: meta.prompt,
      Negative: meta.negativePrompt,
      cfg: meta.cfgScale,
      steps: meta.steps,
      seed: meta.seed,
      scheduler: meta.scheduler ?? 'simple',
      denoise: meta.denoise,
      width: meta.width,
      height: meta.height,
      base_model_hash: meta['Model hash'],
      software: meta.software,
      ...((meta.other as Record<string, unknown>) ?? {}),
    });
  },
};
