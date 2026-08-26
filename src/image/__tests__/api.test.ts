import { describe, expect, it } from 'vitest';
import { encodeMetadata, parseGenerationText } from '../index';
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

  it('honors a caller-supplied a1111ExcludedKeys list', () => {
    const meta = { prompt: 'a castle', steps: 30, myInternalKey: 'secret', scheduler: 'karras' };
    // default context: scheduler excluded, custom key passes through
    expect(encodeMetadata(meta)).toBe('a castle\nSteps: 30, myInternalKey: secret');
    // extended denylist: custom key excluded too
    expect(
      encodeMetadata(meta, 'automatic1111', { a1111ExcludedKeys: ['scheduler', 'myInternalKey'] })
    ).toBe('a castle\nSteps: 30');
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
