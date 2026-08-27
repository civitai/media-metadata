import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { civitai } from '../../civitai/plugin';
import type { GenerationMetadata } from '../../shared/schema';
import { generationMetadataSchema } from '../../shared/schema';
import { encodeMetadata } from '../index';
import { defaultParsers } from '../parsers/registry';
import { createParserContext } from '../parsers/types';
import { applyPlugins } from '../plugins';

/**
 * Encode fidelity: for every fixture, encode the blessed meta back into the
 * generator's native text, re-parse that text, and the ENCODABLE SUBSET must
 * survive. Not full round-trip — encoders are deliberately lossy (resources,
 * hashes, objects) — but what they claim to write must read back identically.
 */

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'images');
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

// keys each encoder writes that the matching parser must read back
const COMPARED_KEYS: Record<string, string[]> = {
  automatic1111: ['prompt', 'negativePrompt', 'steps', 'sampler', 'cfgScale', 'seed', 'clipSkip'],
  swarmui: [
    'prompt',
    'negativePrompt',
    'cfgScale',
    'steps',
    'seed',
    'width',
    'height',
    'sampler',
    'scheduler',
    'version',
    'Model',
    'resources',
  ],
  ruinedfooocus: [
    'prompt',
    'negativePrompt',
    'cfgScale',
    'steps',
    'seed',
    'scheduler',
    'denoise',
    'width',
    'height',
    'Model',
    'Model hash',
    'sampler',
    'software',
  ],
};

const PLUGINS = [civitai()];
const { parsers, context } = applyPlugins(PLUGINS, defaultParsers);
const ctx = createParserContext(context);

function reparse(text: string, generator: string): GenerationMetadata {
  const parser = parsers.find((p) => p.generator === generator)!;
  const state = parser.detect({ parameters: text }, ctx);
  expect(state, `re-detect failed for ${generator}`).not.toBeNull();
  const result = generationMetadataSchema.safeParse(parser.parse(state!, ctx));
  expect(result.success, `re-validate failed for ${generator}`).toBe(true);
  return result.data as GenerationMetadata;
}

function collectImages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectImages(full));
    else if (IMAGE_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

const cases = collectImages(FIXTURES_DIR)
  .map((file) => {
    const expected = JSON.parse(readFileSync(file.replace(IMAGE_EXT, '.expected.json'), 'utf8'));
    return {
      label: relative(FIXTURES_DIR, file).replace(/\\/g, '/'),
      generator: expected.generator as string | null,
      meta: expected.meta as GenerationMetadata,
    };
  })
  .filter((c) => c.generator && Object.keys(c.meta).length > 0);

describe.each(cases.filter((c) => COMPARED_KEYS[c.generator!]).map((c) => [c.label, c] as const))(
  '%s',
  (_label, { generator, meta }) => {
    it(`encodes to ${generator} text that re-parses to the same encodable subset`, () => {
      const text = encodeMetadata(meta, generator as never, { plugins: PLUGINS });
      expect(text).not.toBe('');
      const reparsed = reparse(text, generator!);
      for (const key of COMPARED_KEYS[generator!]) {
        if (meta[key] === undefined) continue;
        expect(reparsed[key], `key ${key}`).toEqual(meta[key]);
      }
    });
  }
);

describe.each(
  cases
    .filter((c) => c.generator === 'comfyui' && typeof c.meta.comfy === 'string')
    .map((c) => [c.label, c] as const)
)('%s', (_label, { meta }) => {
  it('comfy encode re-emits the stored workflow verbatim (or nothing when there is none)', () => {
    const text = encodeMetadata(meta, 'comfyui', { plugins: PLUGINS });
    // prompt-chunk-only images store `"workflow": undefined` — invalid JSON, nothing to emit
    let workflow: unknown;
    try {
      workflow = JSON.parse(meta.comfy as string).workflow;
    } catch {
      workflow = undefined;
    }
    if (workflow) expect(JSON.parse(text)).toEqual(workflow);
    else expect(text).toBe('');
  });
});
