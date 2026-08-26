import { describe, expect, it } from 'vitest';
import { automatic1111Parser } from '../automatic1111';
import { createParserContext } from '../types';

const ctx = createParserContext();

function detectAndParse(text: string) {
  const state = automatic1111Parser.detect({ parameters: text }, ctx);
  expect(state).not.toBeNull();
  return automatic1111Parser.parse(state!, ctx);
}

// The actual generationDetails string extracted from a real civitai image.
// The Civitai metadata contains nested objects (aspectRatio, resources array).
const realGenerationDetails = `an ancient warrior princess with sad face, from the side, looking up, in rain, a small stream of water running down over her face, high contrast shadowing,
 candid style. high contrast, grain effect prominent throughout image, high contrast lighting creating dramatic shadows, grainy film-like texture, nipples
Negative prompt: photo , photography, bad quality, bad anatomy, worst quality, low quality, low resolution, extra fingers, blur, blurry, ugly, wrong proportions, watermark, image artifacts, lowres, ugly, jpeg artifacts, deformed, noisy image
Steps: 40, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 2027225909, Size: 1216x832, Clip skip: 2, Created Date: 2026-02-25T22:09:08.8166925Z, Civitai resources: [{"type":"checkpoint","modelVersionId":1714314,"modelName":"Plant Milk \\uD83C\\uDF3F - Model Suite","modelVersionName":"Hemp II"}], Civitai metadata: {"workflow":"txt2img","output":"image","input":"text","priority":"low","outputFormat":"jpeg","ecosystem":"Illustrious","quantity":4,"aspectRatio":{"value":"3:2","width":1216,"height":832},"negativePrompt":"photo , photography, bad quality, bad anatomy, worst quality, low quality, low resolution, extra fingers, blur, blurry, ugly, wrong proportions, watermark, image artifacts, lowres, ugly, jpeg artifacts, deformed, noisy image","sampler":"DPM++ 2M Karras","cfgScale":7,"steps":40,"clipSkip":2,"seed":2027225909,"enhancedCompatibility":false,"prompt":"an ancient warrior princess with sad face, from the side, looking up, in rain, a small stream of water running down over her face, high contrast shadowing,\\n candid style. high contrast, grain effect prominent throughout image, high contrast lighting creating dramatic shadows, grainy film-like texture, nipples","resources":[{"modelVersionId":1714314,"strength":1,"type":"Checkpoint"}]}`;

describe('automatic1111Parser - Civitai metadata with nested JSON', () => {
  it('parses Civitai metadata with nested objects from real image data', () => {
    const result = detectAndParse(realGenerationDetails);
    expect(result.extra).toBeDefined();
    expect(result.extra).toHaveProperty('workflow', 'txt2img');
    expect(result.extra).toHaveProperty('ecosystem', 'Illustrious');
    expect(result.extra?.aspectRatio).toEqual({ value: '3:2', width: 1216, height: 832 });
    expect(result.extra?.resources).toEqual([
      { modelVersionId: 1714314, strength: 1, type: 'Checkpoint' },
    ]);
  });

  it('parses Civitai metadata with nested objects (minimal case)', () => {
    const result = detectAndParse(
      `Steps: 20, Sampler: Euler, Civitai metadata: {"flat": "ok", "nested": {"inner": "value"}}`
    );
    expect(result.extra).toEqual({ flat: 'ok', nested: { inner: 'value' } });
  });

  it('parses flat Civitai metadata', () => {
    const result = detectAndParse(
      `Steps: 20, Sampler: Euler, Civitai metadata: {"remixOfId": 123, "workflow": "txt2img"}`
    );
    expect(result.extra).toEqual({ remixOfId: 123, workflow: 'txt2img' });
  });

  it('does not leave Civitai metadata fragments in other parsed fields', () => {
    const result = detectAndParse(
      `Steps: 20, Sampler: Euler, Size: 512x512, Civitai metadata: {"workflow": "txt2img", "nested": {"a": 1}}`
    );
    expect(result.steps).toBe('20');
    expect(result.sampler).toBe('Euler');
    // The parser extracts "Size" into width/height and deletes the original key.
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result['Size']).toBeUndefined();
    expect(result['Civitai metadata']).toBeUndefined();
  });
});

describe('automatic1111Parser - single-line and delimited metadata parsing', () => {
  it('parses metadata with dot before Negative prompt and Steps', () => {
    const rawMetadata = `Parameters                      : <lora:generic_lora_a:1> generic prompt text <lora:generic_lora_b:1> more prompt text.Negative prompt: negative prompt text, low quality.Steps: 24, Sampler: Euler a, Schedule type: Automatic, CFG scale: 4, Seed: 2366756367, Size: 640x980, Model hash: 23d793a158, Model: GenericModel, Wildcard prompt: "  <lora:generic_lora_a:1> generic prompt text <lora:generic_lora_b:1> more prompt text", Lora hashes: "generic_lora_a: bed61886a493", Version: v1.9.3`;
    const result = detectAndParse(rawMetadata);
    expect(result.prompt).toBe(
      '<lora:generic_lora_a:1> generic prompt text <lora:generic_lora_b:1> more prompt text'
    );
    expect(result.negativePrompt).toBe('negative prompt text, low quality');
    expect(result.steps).toBe('24');
    expect(result.sampler).toBe('Euler a');
    expect(result.cfgScale).toBe('4');
    expect(result.seed).toBe('2366756367');
    expect(result.width).toBe(640);
    expect(result.height).toBe(980);
    expect(result.Model).toBe('GenericModel');
  });

  it('parses metadata with comma-dot before Negative prompt and dot before Steps', () => {
    // Unlike the app's suite (where @civitai/client's Air.parse is stubbed), the AIRs here
    // resolve for real: urn:air:...:12345@67890 → modelVersionId 67890.
    const rawMetadata = `Parameters                      : A generic prompt text.,.Negative prompt: .Steps: 4, Sampler: Euler, CFG scale: 1.0, Seed: 1099633777240739, Size: 1088x1920, Model: generic_model_v1, Version: ComfyUI, Civitai resources: [{"modelName":"Generic Model","versionName":"v1","air":"urn:air:zimageturbo:checkpoint:civitai:12345@67890"}]`;
    const result = detectAndParse(rawMetadata);
    expect(result.prompt).toBe('A generic prompt text');
    expect(result.negativePrompt).toBe('');
    expect(result.steps).toBe('4');
    expect(result.sampler).toBe('Euler');
    expect(result.cfgScale).toBe('1.0');
    expect(result.seed).toBe('1099633777240739');
    expect(result.width).toBe(1088);
    expect(result.height).toBe(1920);
    expect(result.Model).toBe('generic_model_v1');
    expect(result.civitaiResources).toEqual([{ modelVersionId: 67890, type: 'checkpoint' }]);
  });

  it('parses metadata with triple-dot before Negative prompt and dot before Steps', () => {
    const rawMetadata = `Parameters                      : A generic prompt text...Negative prompt: .Steps: 4, Sampler: Euler, CFG scale: 1.0, Seed: 521842852, Size: 1024x1024, Tool: ComfyUI, Technique: txt2img, Model: generic_model_v2, Version: ComfyUI, Civitai resources: [{"modelName":"Generic Model","versionName":"v2","air":"urn:air:flux2:checkpoint:civitai:12345@67890"},{"modelName":"Generic Lora","versionName":"v1.0","weight":1.0,"air":"urn:air:flux2:lora:civitai:11111@22222"}]`;
    const result = detectAndParse(rawMetadata);
    expect(result.prompt).toBe('A generic prompt text');
    expect(result.negativePrompt).toBe('');
    expect(result.steps).toBe('4');
    expect(result.sampler).toBe('Euler');
    expect(result.cfgScale).toBe('1.0');
    expect(result.seed).toBe('521842852');
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
    expect(result.Model).toBe('generic_model_v2');
    expect(result.civitaiResources).toEqual([
      { modelVersionId: 67890, type: 'checkpoint' },
      { modelVersionId: 22222, type: 'lora', weight: 1.0 },
    ]);
  });

  it('does not split the "Hires steps" parameter onto its own line', () => {
    const rawMetadata = `masterpiece, best quality, 1girl
Negative prompt: bad quality, worst quality
Steps: 30, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 12345, Size: 512x768, Denoising strength: 0.4, Hires upscale: 2, Hires steps: 15, Hires upscaler: Latent`;
    const result = detectAndParse(rawMetadata);
    expect(result.prompt).toBe('masterpiece, best quality, 1girl');
    // "Hires steps: 15" must not leak into the negative prompt as a second Steps line
    expect(result.negativePrompt).toBe('bad quality, worst quality');
    expect(result.steps).toBe('30');
    expect(result.seed).toBe('12345');
    expect(result['Hires steps']).toBe('15');
    expect(result['Hires upscaler']).toBe('Latent');
  });

  it('does not split a "steps:" that appears inside the prompt of already-structured metadata', () => {
    const rawMetadata = `tutorial diagram, steps: 1 2 3, colorful
Negative prompt: ugly
Steps: 25, Sampler: Euler, CFG scale: 7`;
    const result = detectAndParse(rawMetadata);
    expect(result.prompt).toBe('tutorial diagram, steps: 1 2 3, colorful');
    expect(result.negativePrompt).toBe('ugly');
    expect(result.steps).toBe('25');
    expect(result.sampler).toBe('Euler');
  });

  it('normalizes a long delimiter run in linear time (no catastrophic backtracking)', () => {
    // The delimiter run must NOT terminate in the keyword the regex is scanning for —
    // otherwise the match succeeds immediately and even an unbounded regex is fast.
    // Here the run is followed by "Steps: 5", so the "Negative prompt:" pass scans the
    // entire run fruitlessly — the true catastrophic-backtracking case (~9s on an
    // unbounded regex at this size).
    const rawMetadata = `x${', '.repeat(50000)}Steps: 5`;
    const start = Date.now();
    const result = detectAndParse(rawMetadata);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.steps).toBe('5');
  });
});
