import { describe, expect, it } from 'vitest';
import { createCivitaiComfyParser } from '../../../civitai/comfy';
import { parseAir } from '../../../civitai/air';
import { comfyUiParser } from '../comfyui';
import { parseLoraTags } from '../comfyui/graph';
import { generationMetadataSchema } from '../../../shared/schema';
import { createParserContext } from '../types';

const ctx = createParserContext();
// These suites cover civitai semantics (selector nodes, on-site extraMetadata,
// engine detection) — the domain of the civitai plugin's comfy parser.
const civitaiComfy = createCivitaiComfyParser(parseAir);

function detectAndParse(exif: Record<string, unknown>) {
  const state = civitaiComfy.detect(exif, ctx);
  expect(state).not.toBeNull();
  return civitaiComfy.parse(state!, ctx) as Record<string, any>;
}

describe('core comfyUiParser (no plugin)', () => {
  const prompt = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: 1,
        steps: 20,
        cfg: 8,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        positive: ['6', 0],
        negative: ['6', 0],
        latent_image: ['5', 0],
      },
    },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat' } },
    '17': {
      class_type: 'CivitaiModelSelector',
      inputs: { air: 'urn:air:sd1:checkpoint:civitai:43331@176425' },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ['17', 1] } },
  };

  it('parses vanilla graphs but knows nothing about civitai nodes or AIRs', () => {
    const state = comfyUiParser.detect({ prompt: JSON.stringify(prompt), workflow: '{}' }, ctx);
    const meta = comfyUiParser.parse(state!, ctx) as Record<string, any>;
    expect(meta.prompt).toBe('a cat');
    expect(meta.engine).toBe('ComfyUI');
    expect(meta.civitaiResources).toBeUndefined();
    expect(meta.models ?? []).toEqual([]); // selector-supplied name is a civitai concept
    expect(typeof meta.comfy).toBe('string'); // always kept without the plugin
  });

  it('does not detect the civitai legacy UserComment format', () => {
    const legacy = JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} }, extra: {} });
    expect(comfyUiParser.detect({ parameters: legacy }, ctx)).toBeNull();
    expect(civitaiComfy.detect({ parameters: legacy }, ctx)).not.toBeNull();
  });
});

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

describe('comfyUiParser - prompt text the executed graph does not carry', () => {
  // Reduced from image 142356702 (Freshdesk 72488): an iTools prompt loader reads the
  // prompt from a file at run time, so the executed graph holds a link where the text
  // should be and the image parsed with no prompt at all.
  const linkedTextPrompt = {
    '163': {
      class_type: 'KSampler',
      inputs: {
        seed: 769052196751432,
        steps: 5,
        cfg: 1,
        sampler_name: 'dpmpp_sde',
        scheduler: 'beta',
        denoise: 1,
        positive: ['6', 0],
        negative: ['190', 0],
        latent_image: ['162', 0],
      },
    },
    '162': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 768 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: ['200', 0] } },
    '190': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } },
    '200': { class_type: 'iToolsPromptLoader', inputs: { file_path: 'prompts.txt', seed: 0 } },
  };

  const workflowWith = (nodes: unknown[]) => JSON.stringify({ nodes });

  function parseCore(exif: Record<string, unknown>) {
    const state = comfyUiParser.detect(exif, ctx);
    expect(state).not.toBeNull();
    return comfyUiParser.parse(state!, ctx) as Record<string, any>;
  }

  it('recovers the prompt from the workflow widget the encode node kept', () => {
    const meta = parseCore({
      prompt: JSON.stringify(linkedTextPrompt),
      workflow: workflowWith([
        { id: 6, type: 'CLIPTextEncode', widgets_values: ['a marble crown'] },
        { id: 200, type: 'iToolsPromptLoader', widgets_values: ['prompts.txt', 0, 'increment'] },
      ]),
    });
    expect(meta.prompt).toBe('a marble crown');
    // The zero-out node feeds no text, and no widget of its own may stand in for one.
    expect(meta.negativePrompt).toBe('');
  });

  it('never reads a non-encode node widget as the prompt', () => {
    const meta = parseCore({
      prompt: JSON.stringify(linkedTextPrompt),
      workflow: workflowWith([
        { id: 200, type: 'iToolsPromptLoader', widgets_values: ['prompts.txt', 0, 'increment'] },
      ]),
    });
    expect(meta.prompt).toBe('');
  });

  it('keeps the executed graph authoritative when it carries the text itself', () => {
    const prompt = {
      ...linkedTextPrompt,
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'what actually ran' } },
    };
    const meta = parseCore({
      prompt: JSON.stringify(prompt),
      workflow: workflowWith([{ id: 6, type: 'CLIPTextEncode', widgets_values: ['stale text'] }]),
    });
    expect(meta.prompt).toBe('what actually ran');
  });

  it('treats a literal empty prompt as the answer, not as something to fill in', () => {
    const prompt = {
      ...linkedTextPrompt,
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    };
    const meta = parseCore({
      prompt: JSON.stringify(prompt),
      workflow: workflowWith([{ id: 6, type: 'CLIPTextEncode', widgets_values: ['stale text'] }]),
    });
    expect(meta.prompt).toBe('');
  });

  it('ignores a workflow node whose class does not match the executed one', () => {
    const meta = parseCore({
      prompt: JSON.stringify(linkedTextPrompt),
      workflow: workflowWith([
        { id: 6, type: 'SomethingElse', widgets_values: ['not the prompt'] },
      ]),
    });
    expect(meta.prompt).toBe('');
  });
});

describe('comfyUiParser - custom loader nodes', () => {
  function parseLoaders(nodes: Record<string, unknown>) {
    const state = comfyUiParser.detect({ prompt: JSON.stringify(nodes), workflow: '{}' }, ctx);
    const meta = comfyUiParser.parse(state!, ctx) as Record<string, any>;
    return {
      models: meta.models ?? [],
      vaes: meta.vaes ?? [],
      loras: (meta.additionalResources ?? []).map((r: any) => [r.name, r.strength]),
      additionalResources: meta.additionalResources ?? [],
    };
  }

  it('reads pysssss loaders, whose widget value is a { content } object', () => {
    const { models, loras } = parseLoaders({
      '1': {
        class_type: 'CheckpointLoader|pysssss',
        inputs: { ckpt_name: 'novaFlatXL_v90.safetensors', prompt: '', example: '[none]' },
      },
      '2': {
        class_type: 'LoraLoader|pysssss',
        inputs: {
          lora_name: { content: 'saber-ubw-wedding-dress.safetensors', image: null },
          strength_model: 1,
          strength_clip: 1,
        },
      },
    });
    expect(models).toEqual(['novaFlatXL_v90.safetensors']);
    expect(loras).toEqual([['saber-ubw-wedding-dress.safetensors', 1]]);
  });

  it('reads the rgthree power loader stack and honors each row toggle', () => {
    const { loras } = parseLoaders({
      '1': {
        class_type: 'Power Lora Loader (rgthree)',
        inputs: {
          PowerLoraLoaderHeaderWidget: { type: 'PowerLoraLoaderHeaderWidget' },
          lora_1: { on: true, lora: 'Krea2_TextFusion.safetensors', strength: 1 },
          lora_2: { on: false, lora: 'wetness_krea2.safetensors', strength: -1 },
          lora_3: { on: true, lora: 'Dispatch Krea2 Style.safetensors', strength: 0.6 },
        },
      },
    });
    expect(loras).toEqual([
      ['Krea2_TextFusion.safetensors', 1],
      ['Dispatch Krea2 Style.safetensors', 0.6],
    ]);
  });

  it('reads the rgthree fixed-width stack and skips its unfilled slots', () => {
    const { loras } = parseLoaders({
      '1': {
        class_type: 'Lora Loader Stack (rgthree)',
        inputs: {
          lora_01: 'sdxl\\Expressive_H.safetensors',
          strength_01: 0.8,
          lora_02: 'None',
          strength_02: 1,
        },
      },
    });
    expect(loras).toEqual([['sdxl\\Expressive_H.safetensors', 0.8]]);
  });

  it('reads the LoraManager stack, skipping inactive rows and string strengths', () => {
    const { loras } = parseLoaders({
      '1': {
        class_type: 'Lora Loader (LoraManager)',
        inputs: {
          text: '<lora:cunnyfunky_v2:0.60> <lora:Ashima:0.60>',
          loras: {
            __value__: [
              { name: 'cunnyfunky_v2', strength: '0.60', clipStrength: '0.60', active: true },
              { name: 'Ashima', strength: '0.60', clipStrength: '0.60', active: false },
            ],
          },
        },
      },
    });
    expect(loras).toEqual([['cunnyfunky_v2', 0.6]]);
  });

  it('falls back to LoraManager tag text when the stack widget is empty', () => {
    const { loras } = parseLoaders({
      '1': {
        class_type: 'Lora Stacker (LoraManager)',
        inputs: { text: '<lora:Moki Style ANIMA:0.40>', loras: [] },
      },
    });
    expect(loras).toEqual([['Moki Style ANIMA', 0.4]]);
  });

  it('reads lora tags off the Anima remap loader', () => {
    const { loras } = parseLoaders({
      '1': {
        class_type: 'AnimaLoRARemapTagLoader',
        inputs: { text: '<lora:anima_npu_lora_bsk:1>', default_weight: 0.8 },
      },
    });
    expect(loras).toEqual([['anima_npu_lora_bsk', 1]]);
  });

  it('reads GGUF unet loaders as the checkpoint', () => {
    const { models } = parseLoaders({
      '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'krea2\\gonzalomo_v40 Q4.gguf' } },
    });
    expect(models).toEqual(['krea2\\gonzalomo_v40 Q4.gguf']);
  });

  it('reads the easy-use all-in-one loader, whose vae_name is a mode and not a file', () => {
    const { models, vaes, additionalResources } = parseLoaders({
      '1': {
        class_type: 'easy fullLoader',
        inputs: {
          ckpt_name: 'someCheckpoint.safetensors',
          vae_name: 'Baked VAE',
          lora_name: 'myLora.safetensors',
          lora_model_strength: 0.7,
          lora_clip_strength: 0.7,
        },
      },
    });
    expect(models).toEqual(['someCheckpoint.safetensors']);
    expect(additionalResources).toEqual([
      { name: 'myLora.safetensors', type: 'lora', strength: 0.7, strengthClip: 0.7 },
    ]);
    // Positive control: without it this would also pass if VAELoader support were
    // deleted outright, since the helper's `?? []` turns an absent key into [].
    expect(vaes).toEqual([]);
    expect(
      parseLoaders({
        '1': { class_type: 'VAELoader', inputs: { vae_name: 'sdxl_vae.safetensors' } },
      }).vaes
    ).toEqual(['sdxl_vae.safetensors']);
  });

  it('still drops a lora wired in at zero strength', () => {
    const { loras } = parseLoaders({
      '1': {
        class_type: 'Power Lora Loader (rgthree)',
        inputs: { lora_1: { on: true, lora: 'disabled.safetensors', strength: 0 } },
      },
    });
    expect(loras).toEqual([]);
  });
});

describe('comfyUiParser - custom sampler nodes', () => {
  // Vendor samplers take KSampler's inputs under their own class name.
  const customSampler = (class_type: string, extra: Record<string, unknown> = {}) => ({
    '1': {
      class_type,
      inputs: {
        seed: 42,
        steps: 28,
        cfg: 6,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['9', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        ...extra,
      },
    },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a castle' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216 } },
  });

  function parseCustom(nodes: Record<string, unknown>) {
    const state = comfyUiParser.detect({ prompt: JSON.stringify(nodes), workflow: '{}' }, ctx);
    return comfyUiParser.parse(state!, ctx) as Record<string, any>;
  }

  it.each(['IllustriousKSamplerPro', 'KSampler_A1111', 'ClownsharKSampler_Beta', 'Tiled KSampler'])(
    'reads generation params off %s by its input shape',
    (className) => {
      const meta = parseCustom(customSampler(className));
      expect(meta.prompt).toBe('a castle');
      expect(meta.negativePrompt).toBe('blurry');
      expect(meta.steps).toBe(28);
      expect(meta.cfgScale).toBe(6);
      expect(meta.seed).toBe(42);
      expect(meta.width).toBe(832);
      expect(meta.height).toBe(1216);
    }
  );

  it('ignores a node that merely looks adjacent to a sampler', () => {
    const meta = parseCustom({
      '1': {
        class_type: 'ConditioningCombine',
        inputs: { positive: ['2', 0], negative: ['3', 0] },
      },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a castle' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
    });
    expect(meta.prompt).toBeUndefined();
  });

  it('prefers a real KSampler over a shape-matched one', () => {
    const meta = parseCustom({
      ...customSampler('SomeVendorKSampler'),
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed: 7,
          steps: 10,
          cfg: 3,
          sampler_name: 'ddim',
          scheduler: 'normal',
          denoise: 1,
          positive: ['6', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
      },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'the real one' } },
    });
    expect(meta.prompt).toBe('the real one');
    expect(meta.steps).toBe(10);
  });
});

describe('comfyUiParser - prompts assembled inside the executed graph', () => {
  function parseCore(exif: Record<string, unknown>) {
    const state = comfyUiParser.detect(exif, ctx);
    expect(state).not.toBeNull();
    return comfyUiParser.parse(state!, ctx) as Record<string, any>;
  }

  // Reduced from 70088-comfyui-upload.png, attached to Freshdesk 70088: the encode node's
  // text is a link, its cached widget value is empty, and the prompt is spread across
  // primitive string nodes joined by a chain of concatenates.
  const builderGraph = {
    '35': {
      class_type: 'KSampler',
      inputs: {
        seed: 531564026107616,
        steps: 28,
        cfg: 7,
        sampler_name: 'euler_ancestral',
        scheduler: 'normal',
        denoise: 1,
        positive: ['274', 0],
        negative: ['103', 0],
        latent_image: ['100', 0],
      },
    },
    '100': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216 } },
    '103': { class_type: 'CLIPTextEncode', inputs: { text: 'worst quality' } },
    '274': {
      class_type: 'BNK_CLIPTextEncodeAdvanced',
      inputs: {
        text: ['287', 0],
        token_normalization: 'length+mean',
        weight_interpretation: 'comfy++',
      },
    },
    '287': {
      class_type: 'StringConcatenate',
      inputs: { string_a: ['286', 0], string_b: ['288', 0], delimiter: ', ' },
    },
    '286': {
      class_type: 'StringConcatenate',
      inputs: { string_a: ['277', 0], string_b: ['280', 0], delimiter: ', ' },
    },
    '277': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'masterpiece' } },
    '280': { class_type: 'PrimitiveStringMultiline', inputs: { value: '1girl, white hair' } },
    '288': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'simple background' } },
  };

  it('joins a concatenate chain over primitive string nodes, in order', () => {
    const meta = parseCore({ prompt: JSON.stringify(builderGraph), workflow: '{}' });
    expect(meta.prompt).toBe('masterpiece, 1girl, white hair, simple background');
    expect(meta.negativePrompt).toBe('worst quality');
  });

  // The regression this pair exists to stop: BNK_CLIPTextEncodeAdvanced's positional
  // widgets are [text, token_normalization, weight_interpretation], and the text slot
  // is empty here — reading the first non-empty string stored 'length+mean' as the
  // prompt on a real user's image.
  it('never reads a later widget slot when the text slot is empty', () => {
    const noBuilder = {
      ...builderGraph,
      '287': { class_type: 'SomeOpaqueNode', inputs: { seed: 1 } },
    };
    const meta = parseCore({
      prompt: JSON.stringify(noBuilder),
      workflow: JSON.stringify({
        nodes: [
          {
            id: 274,
            type: 'BNK_CLIPTextEncodeAdvanced',
            widgets_values: ['', 'length+mean', 'comfy++'],
          },
        ],
      }),
    });
    expect(meta.prompt).toBe('');
  });

  it('reads the named widget map newer frontends write, by widget name', () => {
    const linked = {
      ...builderGraph,
      '287': { class_type: 'SomeOpaqueNode', inputs: { seed: 1 } },
    };
    const meta = parseCore({
      prompt: JSON.stringify(linked),
      workflow: JSON.stringify({
        nodes: [
          {
            id: 274,
            type: 'BNK_CLIPTextEncodeAdvanced',
            widgets_values: ['', 'length+mean', 'comfy++'],
            widgets_values_named: {
              text: 'the recovered prompt',
              token_normalization: 'length+mean',
            },
          },
        ],
      }),
    });
    expect(meta.prompt).toBe('the recovered prompt');
  });
});

describe('comfyUiParser - a partial graph degrades instead of throwing', () => {
  function parseCore(nodes: Record<string, unknown>) {
    const state = comfyUiParser.detect({ prompt: JSON.stringify(nodes), workflow: '{}' }, ctx);
    return comfyUiParser.parse(state!, ctx) as Record<string, any>;
  }

  // Matching a sampler by shape admits classes that carry none of KSampler's
  // optional inputs. Throwing costs the image every field it DID have, so each of
  // these must come back with the rest of the metadata intact.
  it('handles a shape-matched sampler with no seed of either spelling', () => {
    const meta = parseCore({
      '1': {
        class_type: 'VendorSampler',
        inputs: {
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
      },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a castle' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
    });
    expect(meta.prompt).toBe('a castle');
    expect(meta.seed).toBeUndefined();
    expect(meta.width).toBe(512);
  });

  it('handles a latent_image link pointing at a node the graph does not contain', () => {
    const meta = parseCore({
      '1': {
        class_type: 'KSampler',
        inputs: {
          seed: 5,
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['999', 0],
        },
      },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a castle' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
    });
    expect(meta.prompt).toBe('a castle');
    expect(meta.seed).toBe(5);
    expect(meta.width).toBeUndefined();
  });

  it('handles a sampler whose numeric widgets arrive as strings', () => {
    const meta = parseCore({
      '1': {
        class_type: 'VendorSampler',
        inputs: {
          seed: '42',
          steps: '20',
          cfg: '7',
          sampler_name: 'euler',
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
      },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a castle' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
    });
    expect(meta.prompt).toBe('a castle');
    expect(meta.width).toBe(512);
  });
});

describe('comfyUiParser - shared and cyclic string subtrees', () => {
  const withSampler = (extra: Record<string, unknown>) => ({
    '1': {
      class_type: 'KSampler',
      inputs: {
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        positive: ['10', 0],
        negative: ['99', 0],
        latent_image: ['4', 0],
      },
    },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
    '99': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
    ...extra,
  });

  function parseCore(nodes: Record<string, unknown>) {
    const state = comfyUiParser.detect({ prompt: JSON.stringify(nodes), workflow: '{}' }, ctx);
    return comfyUiParser.parse(state!, ctx) as Record<string, any>;
  }

  // A graph is a DAG: one subtree may feed both inputs of a concatenate. Treating
  // the second visit as a cycle drops the whole subtree — 8 of 800 sampled
  // production graphs reuse a StringConcatenate exactly this way.
  it('reads a subtree reached twice rather than dropping the second visit', () => {
    const meta = parseCore(
      withSampler({
        '10': { class_type: 'CLIPTextEncode', inputs: { text: ['11', 0] } },
        '11': {
          class_type: 'StringConcatenate',
          inputs: { string_a: ['12', 0], string_b: ['12', 0], delimiter: ' | ' },
        },
        '12': {
          class_type: 'StringConcatenate',
          inputs: { string_a: ['13', 0], string_b: ['14', 0], delimiter: ', ' },
        },
        '13': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'alpha' } },
        '14': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'beta' } },
      })
    );
    expect(meta.prompt).toBe('alpha, beta | alpha, beta');
  });

  it('terminates on a string cycle instead of recursing forever', () => {
    const meta = parseCore(
      withSampler({
        '10': { class_type: 'CLIPTextEncode', inputs: { text: ['11', 0] } },
        '11': {
          class_type: 'StringConcatenate',
          inputs: { string_a: ['12', 0], string_b: ['13', 0], delimiter: ', ' },
        },
        '12': {
          class_type: 'StringConcatenate',
          inputs: { string_a: ['11', 0], string_b: ['13', 0], delimiter: ', ' },
        },
        '13': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'alpha' } },
      })
    );
    expect(meta.prompt).toBe('alpha, alpha');
  });

  // Depth is chosen so that losing the budget FAILS rather than hangs. The walk is
  // synchronous, so vitest's setTimeout-based timeout can never fire inside it: at
  // depth 40 an unbudgeted walk is ~2^41 calls (days of CPU, and it OOMs building
  // the string), which wedges the runner with no assertion to read. 20 levels is
  // ~2M calls — about a second — while still being 4000x the budget.
  const DIAMOND_DEPTH = 20;

  it('bounds the work on a deep diamond chain', () => {
    // Each level feeds the next twice, so an unbounded walk is 2^depth.
    const nodes: Record<string, unknown> = {
      '10': { class_type: 'CLIPTextEncode', inputs: { text: ['n0', 0] } },
    };
    for (let i = 0; i < DIAMOND_DEPTH; i++)
      nodes[`n${i}`] = {
        class_type: 'StringConcatenate',
        inputs: { string_a: [`n${i + 1}`, 0], string_b: [`n${i + 1}`, 0], delimiter: '' },
      };
    nodes[`n${DIAMOND_DEPTH}`] = {
      class_type: 'PrimitiveStringMultiline',
      inputs: { value: 'x' },
    };

    const meta = parseCore(withSampler(nodes));
    // One 'x' per leaf visit, so the length IS the visit count: it must stay at the
    // budget, not at 2^20. A loosened budget widens this proportionally.
    expect(meta.prompt.length).toBeLessThanOrEqual(512);
  });
});

describe('comfyUiParser - the flux sampler path', () => {
  // SamplerCustomAdvanced graphs take a different branch from KSampler ones, and it
  // had none of this coverage: every prompt-recovery test above goes through
  // applySamplerNode instead.
  const fluxGraph = (textInputs: Record<string, unknown>) => ({
    '1': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['2', 0],
        sampler: ['3', 0],
        guider: ['4', 0],
        sigmas: ['5', 0],
        latent_image: ['6', 0],
      },
    },
    '2': { class_type: 'RandomNoise', inputs: { noise_seed: 77 } },
    '3': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '4': { class_type: 'BasicGuider', inputs: { conditioning: ['7', 0] } },
    '5': {
      class_type: 'BasicScheduler',
      inputs: { steps: 20, scheduler: 'simple', denoise: 1 },
    },
    '6': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024 } },
    '7': { class_type: 'CLIPTextEncode', inputs: textInputs },
  });

  const parseFlux = (nodes: Record<string, unknown>, workflow: string) => {
    const state = comfyUiParser.detect({ prompt: JSON.stringify(nodes), workflow }, ctx);
    return comfyUiParser.parse(state!, ctx) as Record<string, any>;
  };

  it('recovers the prompt from the workflow widget on a flux graph', () => {
    const meta = parseFlux(
      fluxGraph({ text: ['9', 0] }),
      JSON.stringify({
        nodes: [{ id: 7, type: 'CLIPTextEncode', widgets_values: ['a flux prompt'] }],
      })
    );
    expect(meta.prompt).toBe('a flux prompt');
    expect(meta.seed).toBe(77);
  });

  it('keeps the flux graph authoritative over the workflow widget', () => {
    const meta = parseFlux(
      fluxGraph({ text: 'what actually ran' }),
      JSON.stringify({ nodes: [{ id: 7, type: 'CLIPTextEncode', widgets_values: ['stale'] }] })
    );
    expect(meta.prompt).toBe('what actually ran');
  });

  it('carries the fallback through the civitai plugin parser too', () => {
    const state = civitaiComfy.detect(
      {
        prompt: JSON.stringify(fluxGraph({ text: ['9', 0] })),
        workflow: JSON.stringify({
          nodes: [{ id: 7, type: 'CLIPTextEncode', widgets_values: ['a flux prompt'] }],
        }),
      },
      ctx
    );
    expect((civitaiComfy.parse(state!, ctx) as Record<string, any>).prompt).toBe('a flux prompt');
  });
});

describe('comfyUiParser - malformed and hostile graphs keep their other fields', () => {
  const sampler = (extra: Record<string, unknown>) => ({
    '1': {
      class_type: 'KSampler',
      inputs: {
        seed: 3,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a castle' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
    ...extra,
  });

  // read.ts falls back to an EMPTY bag when parse throws or the schema rejects, so
  // any single bad node costs the image every field it had. These assert the whole
  // pipeline, not just the parser, for that reason.
  function readThrough(nodes: Record<string, unknown>, workflow = '{}') {
    const state = comfyUiParser.detect({ prompt: JSON.stringify(nodes), workflow }, ctx);
    const meta = comfyUiParser.parse(state!, ctx) as Record<string, any>;
    const validated = generationMetadataSchema.safeParse(meta);
    return { meta, valid: validated.success, error: validated.error?.issues?.[0]?.message };
  }

  it('survives a node whose inputs are a bare string', () => {
    const { meta, valid } = readThrough(sampler({ '9': { class_type: 'Note', inputs: 'a note' } }));
    expect(meta.prompt).toBe('a castle');
    expect(valid).toBe(true);
  });

  it('keeps a lora whose strength widget was converted to a link, as a valid number', () => {
    const { meta, valid, error } = readThrough(
      sampler({
        '9': {
          class_type: 'LoraLoader',
          inputs: { lora_name: 'style.safetensors', strength_model: ['10', 0], strength_clip: 1 },
        },
        '10': { class_type: 'PrimitiveFloat', inputs: { value: 0.8 } },
      })
    );
    expect(valid, `schema rejected: ${error}`).toBe(true);
    expect(meta.additionalResources?.[0]?.name).toBe('style.safetensors');
    expect(meta.prompt).toBe('a castle');
  });

  it('keeps the rest of the image when a lora strength is a bare string', () => {
    const { meta, valid, error } = readThrough(
      sampler({
        '9': {
          class_type: 'Power Lora Loader (rgthree)',
          inputs: { lora_1: { on: true, lora: 'a.safetensors', strength: '0.75' } },
        },
      })
    );
    expect(valid, `schema rejected: ${error}`).toBe(true);
    expect(meta.additionalResources).toEqual([
      { name: 'a.safetensors', type: 'lora', strength: 0.75, strengthClip: undefined },
    ]);
  });

  it('declines rather than guessing when the workflow JSON is malformed', () => {
    const { meta } = readThrough(
      { ...sampler({}), '2': { class_type: 'CLIPTextEncode', inputs: { text: ['9', 0] } } },
      '{ this is not json'
    );
    expect(meta.prompt).toBe('');
  });

  it('declines when two workflow nodes claim the same id', () => {
    const { meta } = readThrough(
      { ...sampler({}), '2': { class_type: 'CLIPTextEncode', inputs: { text: ['9', 0] } } },
      JSON.stringify({
        nodes: [
          { id: 2, type: 'CLIPTextEncode', widgets_values: ['first'] },
          { id: 2, type: 'CLIPTextEncode', widgets_values: ['second'] },
        ],
      })
    );
    expect(meta.prompt).toBe('');
  });

  it('does not reach past a linked text that genuinely resolved to empty', () => {
    const { meta } = readThrough(
      {
        ...sampler({}),
        '2': { class_type: 'CLIPTextEncode', inputs: { text: ['9', 0] } },
        '9': { class_type: 'PrimitiveStringMultiline', inputs: { value: '' } },
      },
      JSON.stringify({
        nodes: [
          { id: 2, type: 'CLIPTextEncode', widgets_values: ['STALE, FROM BEFORE THE REWIRE'] },
        ],
      })
    );
    expect(meta.prompt).toBe('');
  });

  it('does not read a mode widget off a node in the conditioning path', () => {
    const { meta } = readThrough({
      ...sampler({}),
      '2': {
        class_type: 'ConditioningSwitch',
        inputs: { conditioning: ['9', 0], value: 'randomize' },
      },
      '9': { class_type: 'CLIPTextEncode', inputs: { text: 'the real prompt' } },
    });
    expect(meta.prompt).not.toBe('randomize');
  });
});

describe('parseLoraTags', () => {
  it('reads tags whatever the case', () => {
    expect(parseLoraTags('<LORA:Cool_Style:0.8>')).toEqual([{ name: 'Cool_Style', strength: 0.8 }]);
  });

  it('keeps the lora when the weight is spelled unusually', () => {
    // `1.0.0` is not a number, and nothing distinguishes a malformed weight from a
    // version suffix in the name — so it stays part of the name. Guessing it off
    // would offer `c` for matching, which is a DIFFERENT lora.
    expect(parseLoraTags('<lora:a:+0.5> <lora:b:1e-2> <lora:c:1.0.0>')).toEqual([
      { name: 'a', strength: 0.5 },
      { name: 'b', strength: 0.01 },
      { name: 'c:1.0.0', strength: undefined },
    ]);
  });

  it('keeps a name containing a colon, and reads model strength from a pair', () => {
    expect(parseLoraTags('<lora:style:anime:0.8> <lora:d:1:0.5>')).toEqual([
      { name: 'style:anime', strength: 0.8 },
      { name: 'd', strength: 1 },
    ]);
  });

  it('reads a bare tag and ignores an empty one', () => {
    expect(parseLoraTags('<lora:plain> <lora:>')).toEqual([{ name: 'plain', strength: undefined }]);
  });

  it('does not backtrack catastrophically on a long unterminated tag', () => {
    const started = performance.now();
    parseLoraTags(`<lora:${'a:'.repeat(20000)}`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('scanGraph - widget arrays that are not node links', () => {
  it('keeps a LoraManager stack that arrives as a bare array', () => {
    const state = comfyUiParser.detect(
      {
        prompt: JSON.stringify({
          '1': {
            class_type: 'Lora Loader (LoraManager)',
            inputs: {
              text: '',
              loras: [
                { name: 'alpha', strength: 0.8, active: true },
                { name: 'beta', strength: 1, active: true },
              ],
            },
          },
        }),
        workflow: '{}',
      },
      ctx
    );
    const meta = comfyUiParser.parse(state!, ctx) as Record<string, any>;
    expect((meta.additionalResources ?? []).map((r: any) => r.name)).toEqual(['alpha', 'beta']);
  });

  it('reads a String Literal node through its `string` widget', () => {
    const state = comfyUiParser.detect(
      {
        prompt: JSON.stringify({
          '1': {
            class_type: 'KSampler',
            inputs: {
              seed: 1,
              steps: 20,
              cfg: 7,
              sampler_name: 'euler',
              scheduler: 'normal',
              denoise: 1,
              positive: ['2', 0],
              negative: ['3', 0],
              latent_image: ['4', 0],
            },
          },
          '2': { class_type: 'CLIPTextEncode', inputs: { text: ['5', 0] } },
          '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
          '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
          '5': { class_type: 'String Literal', inputs: { string: 'from a string literal' } },
        }),
        workflow: '{}',
      },
      ctx
    );
    const meta = comfyUiParser.parse(state!, ctx) as Record<string, any>;
    expect(meta.prompt).toBe('from a string literal');
  });
});

describe('comfyUiParser - latent size supplied by a resolution node', () => {
  const graph = (latent: Record<string, unknown>) => ({
    '1': {
      class_type: 'KSampler',
      inputs: {
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a castle' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
    '4': { class_type: 'EmptyLatentImage', inputs: latent },
    ...(latent.width && Array.isArray(latent.width)
      ? {
          '5': {
            class_type: 'SizePicker',
            inputs: { width: 896, height: 1152, scale_percent: 100 },
          },
        }
      : {}),
  });

  function parseSize(latent: Record<string, unknown>) {
    const state = comfyUiParser.detect(
      { prompt: JSON.stringify(graph(latent)), workflow: '{}' },
      ctx
    );
    const meta = comfyUiParser.parse(state!, ctx) as Record<string, any>;
    return { width: meta.width, height: meta.height };
  }

  it('reads each axis from its OWN key on a picker node carrying both', () => {
    // A single ordered key list returns the picker's `width` for the height too —
    // silently square, and only on graphs that use a picker.
    expect(parseSize({ width: ['5', 0], height: ['5', 1] })).toEqual({
      width: 896,
      height: 1152,
    });
  });

  it('leaves the size absent rather than publishing the picker node', () => {
    const state = comfyUiParser.detect(
      {
        prompt: JSON.stringify({
          ...graph({ width: ['5', 0], height: ['5', 1] }),
          '5': {
            class_type: 'FluxResolutionNode',
            inputs: { megapixel: '1.0', aspect_ratio: '5:7 (Balanced Portrait)' },
          },
        }),
        workflow: '{}',
      },
      ctx
    );
    const meta = comfyUiParser.parse(state!, ctx) as Record<string, any>;
    expect(meta.width).toBeUndefined();
    expect(meta.height).toBeUndefined();
  });

  it('still reads a plain numeric latent', () => {
    expect(parseSize({ width: 768, height: 1024 })).toEqual({ width: 768, height: 1024 });
  });
});
