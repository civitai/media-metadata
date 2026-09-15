import { describe, expect, it } from 'vitest';
import { civitai } from '../../../civitai/plugin';
import { applyPlugins } from '../../plugins';
import { defaultParsers } from '../registry';
import { automatic1111Parser } from '../automatic1111';
import { parseDetailsLine } from '../a1111-text';
import { createParserContext } from '../types';

// Most of these strings carry civitai blocks (Civitai resources/metadata), so
// run with the civitai plugin's context — the same shape readMetadata composes.
const ctx = createParserContext(applyPlugins([civitai()], defaultParsers).context);

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

  it('reads AddNet weights from the Weight A key and survives schema validation', async () => {
    const { generationMetadataSchema } = await import('../../../shared/schema');
    const rawMetadata = `a castle
Negative prompt: blurry
Steps: 20, Sampler: Euler, CFG scale: 7, Seed: 1, Model hash: aadddd3d75, Model: deliberate_v3, AddNet Enabled: True, AddNet Module 1: LoRA, AddNet Model 1: coolLora(a68c0549f355), AddNet Weight A 1: 0.8, AddNet Weight B 1: 0.8, AddNet Module 2: LoRA, AddNet Model 2: otherLora(bbbb0549f355)`;
    const result = detectAndParse(rawMetadata);
    const resources = result.resources as { type: string; name?: string; weight?: number }[];
    expect(resources).toContainEqual({
      type: 'lora',
      name: 'coolLora',
      hash: 'a68c0549f355',
      weight: 0.8,
    });
    // entry 2 has no weight key at all — must be omitted, never NaN
    const second = resources.find((r) => r.name === 'otherLora')!;
    expect(second.weight).toBeUndefined();

    // The historical failure mode: NaN weight → schema rejects → the app stored {}.
    // A revert of the fix makes this assertion fail with the zod error, not a hang.
    expect(generationMetadataSchema.safeParse(result).success).toBe(true);
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

describe('parseDetailsLine - nested hash blocks keyed on the field name', () => {
  // Reassembled verbatim from the character-split keys stored on image 142441991 by the
  // build that shipped 2026-08-31. The brackets are what failed the shape heuristic.
  const REAL_NAME = 'Krea2 - FACE - Licking Lips (Krea2)';

  it('splits a Lora hashes block whose name carries brackets and dashes', () => {
    const result = parseDetailsLine(`Steps: 24, Lora hashes: "${REAL_NAME}: 4cf2eea941da"`);
    expect(result['Lora hashes']).toEqual({ [REAL_NAME]: '4cf2eea941da' });
  });

  it.each([
    ['非ラテン文字のLoRA', 'aabbccddeeff'],
    ['name with (parens) and [brackets]', '001122334455'],
    ["it's a #1 lora!", '667788990011'],
    ['plain_name_v2', 'bed61886a493'],
  ])('splits a Lora hashes block for the name %s', (name, hash) => {
    const result = parseDetailsLine(`Lora hashes: "${name}: ${hash}"`);
    expect(result['Lora hashes']).toEqual({ [name]: hash });
  });

  it('splits the sibling hash blocks A1111 writes the same way', () => {
    for (const key of ['TI hashes', 'Hashes', 'Hypernet hashes']) {
      const result = parseDetailsLine(`${key}: "a (b): 0011aabb"`);
      expect(result[key], `${key} was left as a raw string`).toEqual({ 'a (b)': '0011aabb' });
    }
  });

  it('does not newly split prose under a key that is not a hash block', () => {
    // The negative control for the rule above: keying on the field name must not widen
    // what gets split. A value that never matched the shape heuristic still must not.
    const result = parseDetailsLine('Wildcard prompt: "  <lora:x:1> a portrait, dramatic"');
    expect(result['Wildcard prompt']).toBe('<lora:x:1> a portrait, dramatic');
  });

  it('leaves the pre-existing shape heuristic alone for non-hash keys', () => {
    // PRE-EXISTING, not introduced here and not fixed here: prose beginning `word: `
    // is split by the shape heuristic, so a Hires prompt can still be mangled. Pinned
    // so a future change to NESTED_BLOCK_KEYS is not blamed for it, and so that
    // widening the heuristic shows up as a change to this expectation.
    const result = parseDetailsLine('Hires prompt: "a portrait: closeup, dramatic", Steps: 24');
    expect(result['Hires prompt']).toEqual({ 'a portrait': 'closeup' });
    expect(result['steps']).toBe('24');
  });
});

describe('collectResources - a Lora hashes block that arrives as a string', () => {
  it('parses it instead of enumerating its characters', () => {
    // The shipped failure: Object.entries over a string yields index/char pairs, so every
    // LoRA was lost AND meta.hashes gained one `lora:<n>` key per character.
    const line =
      'Steps: 24, Sampler: Euler a, Model hash: 23d793a158, Model: GenericModel, Lora hashes: "Krea2 - FACE (Krea2): 4cf2eea941da", Version: v1.9.3';
    const state = automatic1111Parser.detect({ parameters: `a prompt\n${line}` }, ctx);
    const meta = automatic1111Parser.parse(state!, ctx) as Record<string, any>;

    expect(meta.hashes).toEqual({
      model: '23d793a158',
      'lora:Krea2 - FACE (Krea2)': '4cf2eea941da',
    });
    expect(Object.keys(meta.hashes).some((k) => /^lora:\d+$/.test(k))).toBe(false);
    expect(meta.resources).toContainEqual(
      expect.objectContaining({ type: 'lora', name: 'Krea2 - FACE (Krea2)', hash: '4cf2eea941da' })
    );
  });
});
