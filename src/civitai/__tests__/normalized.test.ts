import { describe, expect, it } from 'vitest';
import { normalizeGeneration } from '../normalized';

describe('normalizeGeneration', () => {
  it('splits an embedded Karras suffix into sampler + scheduler', () => {
    const g = normalizeGeneration({ sampler: 'DPM++ 2M Karras' }, 'automatic1111');
    expect(g.sampler).toBe('DPM++ 2M');
    expect(g.scheduler).toBe('karras');
  });

  it('maps modern A1111 Schedule type, skipping Automatic', () => {
    expect(
      normalizeGeneration({ sampler: 'Euler a', 'Schedule type': 'SGM Uniform' }, 'automatic1111')
        .scheduler
    ).toBe('sgm_uniform');
    expect(
      normalizeGeneration({ sampler: 'Euler a', 'Schedule type': 'Automatic' }, 'automatic1111')
        .scheduler
    ).toBeUndefined();
  });

  it('drops literal undefined sampler strings and canonicalizes known aliases', () => {
    expect(normalizeGeneration({ sampler: 'Undefined' }, 'automatic1111').sampler).toBeUndefined();
    expect(normalizeGeneration({ sampler: 'euler' }, 'comfyui').sampler).toBe('Euler');
    // unknown native names pass through verbatim
    expect(normalizeGeneration({ sampler: 'er_sde' }, 'comfyui').sampler).toBe('er_sde');
  });

  it('applies normalize-only aliases without a raw-bag rewrite path', () => {
    // these canonicalize in generation only — the shared samplerMap must NOT
    // learn them, or applyA1111Compat would change raw and break app parity
    const g = normalizeGeneration(
      { sampler: 'dpmpp_2m_sde_gpu', scheduler: 'karras' },
      'ruinedfooocus'
    );
    expect(g.sampler).toBe('DPM++ 2M SDE');
    expect(g.scheduler).toBe('karras');
    expect(normalizeGeneration({ sampler: 'dpmpp_3m_sde_gpu' }, 'swarmui').sampler).toBe(
      'DPM++ 3M SDE'
    );
  });

  it('reads denoise from the A1111 Denoising strength key', () => {
    expect(normalizeGeneration({ 'Denoising strength': '0.7' }, 'automatic1111').denoise).toBe(0.7);
  });

  it('recovers an orphaned Model hash into the checkpoint resource', () => {
    // early A1111 wrote Model hash without a Model name; RF never builds `hashes`
    const g = normalizeGeneration({ 'Model hash': 'aadddd3d75' }, 'automatic1111');
    expect(g.model).toEqual({ name: undefined, hash: 'aadddd3d75' });
    expect(g.resources).toContainEqual({ kind: 'checkpoint', name: undefined, hash: 'aadddd3d75' });
  });

  it('merges the five resource shapes and drops non-numeric dimensions', () => {
    const g = normalizeGeneration(
      {
        Model: 'dream.safetensors',
        hashes: { model: 'abc123', 'lora:styleLora': 'def456' },
        resources: [{ type: 'lora', name: 'styleLora', weight: 0.8 }],
        models: ['dream.safetensors'],
        width: { inputs: {} } as never, // comfy node-object leak stays out of the clean layer
        height: 512,
      },
      'comfyui'
    );
    expect(g.width).toBeUndefined();
    expect(g.height).toBe(512);
    expect(g.resources).toEqual([
      { kind: 'lora', name: 'styleLora', weight: 0.8, hash: 'def456', rawType: undefined },
      { kind: 'checkpoint', name: 'dream', hash: 'abc123' },
    ]);
    expect(g.model).toEqual({ name: 'dream', hash: 'abc123' });
  });

  it('resource names are basenames without model-file extensions', () => {
    const g = normalizeGeneration(
      {
        models: ['flux1-dev.sft'],
        additionalResources: [
          { type: 'lora', name: 'Style\\snofs_photoSlider_000000200.safetensors', strength: 1 },
        ],
        vaes: ['QwenImage/qwen_image_vae.safetensors'],
      },
      'comfyui'
    );
    expect(g.resources.map((r) => r.name)).toEqual([
      'snofs_photoSlider_000000200',
      'flux1-dev',
      'qwen_image_vae',
    ]);
  });

  it('strips extranet tags from the prompt and trims trailing comma noise', () => {
    const g = normalizeGeneration(
      {
        prompt: '<lora:styleLora:0.8> a castle, <hypernet:hn:1> at night, ',
        negativePrompt: 'blurry, low quality, ',
      },
      'automatic1111'
    );
    expect(g.prompt).toBe('a castle, at night');
    expect(g.negativePrompt).toBe('blurry, low quality');
  });
});
