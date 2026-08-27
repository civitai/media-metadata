import { describe, expect, it } from 'vitest';
import { comfyUiParser, createParserContext, encodeMetadata, parseGenerationText } from '../index';
import type { ParserContext } from '../index';
import { samplerMap } from '../../shared/constants';
import { parseAir, parseAirSafe } from '../../civitai/air';

describe('parseGenerationText', () => {
  it('parses pasted A1111 parameters', () => {
    const meta = parseGenerationText(
      `a castle on a hill\nNegative prompt: blurry\nSteps: 30, Sampler: Euler a, CFG scale: 7, Seed: 42, Size: 512x512`
    );
    expect(meta.prompt).toBe('a castle on a hill');
    expect(meta.negativePrompt).toBe('blurry');
    expect(meta.steps).toBe('30');
    expect(meta.width).toBe(512);
  });
});

describe('encodeMetadata', () => {
  it('encodes to A1111 text by default', () => {
    const text = encodeMetadata({
      prompt: 'a castle',
      negativePrompt: 'blurry',
      steps: 30,
      sampler: 'Euler a',
      cfgScale: 7,
      seed: 42,
    });
    expect(text).toBe(
      'a castle\nNegative prompt: blurry\nSteps: 30, Sampler: Euler a, CFG scale: 7, Seed: 42'
    );
  });

  it('returns empty string for an unknown generator or failed encode', () => {
    expect(encodeMetadata({ comfy: 'not json' }, 'comfyui')).toBe('');
  });

  it('JSON-quotes values with commas/colons (A1111 quote() rule) and they re-parse intact', () => {
    const meta = {
      prompt: 'a castle',
      steps: 30,
      'Hires upscaler': 'R-ESRGAN 4x+ Anime6B, fast: yes',
      'ADetailer prompt': 'face, "quoted", detailed',
    };
    const text = encodeMetadata(meta);
    expect(text).toContain('"R-ESRGAN 4x+ Anime6B, fast: yes"');
    const reparsed = parseGenerationText(text);
    expect(reparsed['Hires upscaler']).toBe('R-ESRGAN 4x+ Anime6B, fast: yes');
    expect(reparsed['ADetailer prompt']).toBe('face, "quoted", detailed');
    expect(reparsed.steps).toBe('30');
  });

  it('honors a caller-supplied a1111ExcludedKeys list', () => {
    const meta = { prompt: 'a castle', steps: 30, myInternalKey: 'secret', scheduler: 'karras' };
    // default context: scheduler excluded, custom key passes through
    expect(encodeMetadata(meta)).toBe('a castle\nSteps: 30, myInternalKey: secret');
    // extended denylist: custom key excluded too
    expect(
      encodeMetadata(meta, 'automatic1111', {
        context: { a1111ExcludedKeys: ['scheduler', 'myInternalKey'] },
      })
    ).toBe('a castle\nSteps: 30');
  });
});

describe('samplerMap injection', () => {
  // One shared normalization table: parser-native sampler names (comfy-style
  // snake_case) are looked up BY VALUE and rewritten to the A1111 display name.
  const prompt = JSON.stringify({
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler_name: 'dpmpp_2m',
        scheduler: 'normal',
        denoise: 1,
        positive: ['6', 0],
        negative: ['6', 0],
        latent_image: ['5', 0],
      },
    },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat' } },
  });

  function parseWith(context: Partial<ParserContext>) {
    const ctx = createParserContext(context);
    const state = comfyUiParser.detect({ prompt, workflow: '{}' }, ctx);
    return comfyUiParser.parse(state!, ctx);
  }

  it('normalizes to A1111 vocabulary by default', () => {
    expect(parseWith({}).sampler).toBe('DPM++ 2M');
  });

  it('an empty samplerMap disables normalization and keeps the native name', () => {
    expect(parseWith({ samplerMap: new Map() }).sampler).toBe('dpmpp_2m');
  });

  it('new ecosystems plug in by appending aliases to the same map', () => {
    const extended = new Map([...samplerMap]);
    extended.set('DPM++ 2M', [...(extended.get('DPM++ 2M') ?? []), 'my_ui_dpm_2m']);
    const promptWithAlias = prompt.replace('"dpmpp_2m"', '"my_ui_dpm_2m"');
    const ctx = createParserContext({ samplerMap: extended });
    const state = comfyUiParser.detect({ prompt: promptWithAlias, workflow: '{}' }, ctx);
    expect(comfyUiParser.parse(state!, ctx).sampler).toBe('DPM++ 2M');
  });
});

describe('parseAir', () => {
  it('parses a full AIR urn', () => {
    const parsed = parseAir('urn:air:sd1:checkpoint:civitai:43331@176425');
    expect(parsed).toMatchObject({
      ecosystem: 'sd1',
      type: 'checkpoint',
      source: 'civitai',
      model: 43331,
      version: 176425,
    });
  });

  it('returns NaN version for non-numeric ids and undefined for garbage', () => {
    expect(Number.isNaN(parseAir('urn:air:sdxl:checkpoint:huggingface:org/repo').version)).toBe(
      true
    );
    expect(parseAirSafe('!!!not an air!!!')).toBeUndefined();
  });
});
