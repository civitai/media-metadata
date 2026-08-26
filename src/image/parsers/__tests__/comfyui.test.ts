import { describe, expect, it } from 'vitest';
import { comfyUiParser } from '../comfyui';
import { createParserContext } from '../types';

const ctx = createParserContext();

function detectAndParse(exif: Record<string, unknown>) {
  const state = comfyUiParser.detect(exif, ctx);
  expect(state).not.toBeNull();
  return comfyUiParser.parse(state!, ctx) as Record<string, any>;
}

const baseExtra = {
  prompt: 'a cat',
  negativePrompt: '',
  cfgScale: 7,
  steps: 20,
  seed: 123,
  sampler: 'Euler',
  denoise: 1,
  resources: [],
};

describe('comfyUiParser - engine + workflow', () => {
  it('sets engine=ComfyUI when the workflow carries no civitai airs', () => {
    const meta = detectAndParse({
      prompt: '{}',
      workflow: '{}',
      extraMetadata: { ...baseExtra, workflowId: 'txt2img' },
    });
    expect(meta.engine).toBe('ComfyUI');
  });

  it('sets engine=Civitai when the workflow carries civitai airs', () => {
    const meta = detectAndParse({
      prompt: '{}',
      workflow: '{"extra":{"airs":["urn:air:sdxl:checkpoint:civitai:123@456"]}}',
      extraMetadata: { ...baseExtra, workflowId: 'txt2img' },
    });
    expect(meta.engine).toBe('Civitai');
  });

  it('preserves the full workflow key (variant not stripped in the parser)', () => {
    const meta = detectAndParse({
      prompt: '{}',
      workflow: '{}',
      extraMetadata: { ...baseExtra, workflowId: 'img2img:hires-fix' },
    });
    expect(meta.workflow).toBe('img2img:hires-fix');
  });

  it('falls back to the `workflow` field when workflowId is absent', () => {
    const meta = detectAndParse({
      prompt: '{}',
      workflow: '{}',
      extraMetadata: { ...baseExtra, workflow: 'txt2img:draft' },
    });
    expect(meta.workflow).toBe('txt2img:draft');
  });
});

describe('comfyUiParser - resource names supplied via node links', () => {
  // Real failing workflow from the "Image upload fails to parse metadata" ticket: the
  // CheckpointLoaderSimple's ckpt_name is a link to a CivitaiModelSelector node rather than a
  // literal string.
  const civitaiSelectorPrompt = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: 996478046243637,
        steps: 20,
        cfg: 8,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ['17', 1] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'beautiful scenery nature glass bottle landscape, purple galaxy bottle,',
        clip: ['4', 1],
      },
    },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'text, watermark', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '17': {
      class_type: 'CivitaiModelSelector',
      inputs: {
        air: 'urn:air:sd1:checkpoint:civitai:43331@176425',
        resources_json:
          '{"bySlot":{"1":"urn:air:sd1:checkpoint:civitai:43331@176425"},"all":["urn:air:sd1:checkpoint:civitai:43331@176425"]}',
        '🔍 Browse Civitai': null,
      },
    },
  };

  it('resolves the AIR from a CivitaiModelSelector link and populates resources', () => {
    const result = detectAndParse({
      prompt: JSON.stringify(civitaiSelectorPrompt),
      workflow: '{}',
    });

    expect(result.models).toEqual(['urn:air:sd1:checkpoint:civitai:43331@176425']);
    expect(result.civitaiResources).toEqual([{ modelVersionId: 176425, type: 'checkpoint' }]);
    expect(result.prompt).toContain('purple galaxy bottle');
  });

  it('resolves each loader to its own slot on a multi-resource selector', () => {
    const ckptAir = 'urn:air:sd1:checkpoint:civitai:43331@176425';
    const upscalerAir = 'urn:air:other:upscaler:civitai:147759@164821';
    // One CivitaiModelSelector feeds two loaders from different output slots. The resolver must
    // honor the output slot (value[1]) — grabbing the node's primary `air` would give both
    // loaders the checkpoint.
    const prompt = {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ['20', 1] } },
      '10': { class_type: 'UpscaleModelLoader', inputs: { model_name: ['20', 2] } },
      '20': {
        class_type: 'CivitaiModelSelector',
        inputs: {
          air: ckptAir,
          resources_json: JSON.stringify({
            bySlot: { '1': ckptAir, '2': upscalerAir },
            all: [ckptAir, upscalerAir],
          }),
        },
      },
    };
    const result = detectAndParse({ prompt: JSON.stringify(prompt), workflow: '{}' });

    expect(result.models).toEqual([ckptAir]);
    expect(result.upscalers).toEqual([upscalerAir]);
  });

  it('captures a non-AIR name from a primitive link but does not surface it as a resource', () => {
    const prompt = {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ['9', 0] } },
      '9': { class_type: 'PrimitiveNode', inputs: { value: 'coolmodel.safetensors' } },
    };
    const result = detectAndParse({ prompt: JSON.stringify(prompt), workflow: '{}' });
    expect(result.models).toEqual(['coolmodel.safetensors']);
    expect(result.civitaiResources ?? []).toEqual([]);
  });

  it('skips a linked name with no resolvable string without throwing', () => {
    const prompt = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ['2', 0] } },
      // upstream node exposes no string name (e.g. it outputs a MODEL, not a filename/AIR)
      '2': { class_type: 'SomeModelPatcher', inputs: { model: ['1', 0], multiplier: 1 } },
    };
    const result = detectAndParse({ prompt: JSON.stringify(prompt), workflow: '{}' });
    expect(result.models ?? []).toEqual([]);
  });
});
