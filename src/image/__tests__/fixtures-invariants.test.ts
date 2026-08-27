import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural rules the normalized layer must hold CORPUS-WIDE, independent of
 * blessed values. The blessed snapshots pin what each fixture produces; these
 * pin the rules a change must never break for ANY fixture — each rule here was
 * a real inconsistency found (and fixed) in a review pass.
 */

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'images');

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.expected.json')) out.push(full);
  }
  return out;
}

const cases = collect(FIXTURES_DIR).map((file) => ({
  label: relative(FIXTURES_DIR, file).replace(/\\/g, '/'),
  expected: JSON.parse(readFileSync(file, 'utf8')),
}));

describe.each(cases.map((c) => [c.label, c.expected] as const))('%s', (_label, expected) => {
  it('holds the normalized-layer invariants', () => {
    const g = expected.generation;
    const raw = expected.meta ?? {};

    // generation exists iff something parsed
    expect(g === null || g === undefined).toBe(Object.keys(raw).length === 0);
    if (!g) return;

    // numeric fields are finite numbers, never strings or objects
    for (const key of ['steps', 'cfgScale', 'seed', 'clipSkip', 'denoise', 'width', 'height']) {
      if (g[key] !== undefined) {
        expect(typeof g[key], key).toBe('number');
        expect(Number.isFinite(g[key]), key).toBe(true);
      }
    }

    // sampler/scheduler are separated and junk-free
    if (g.sampler) expect(g.sampler).not.toMatch(/karras|exponential|undefined/i);
    if (g.scheduler) expect(g.scheduler).toBe(g.scheduler.toLowerCase());

    // prompts are plain trimmed text
    for (const p of [g.prompt, g.negativePrompt]) {
      if (!p) continue;
      expect(p).not.toMatch(/<(lora|lyco|lycoris|hypernet):/i);
      expect(p).not.toMatch(/[,\s]$/);
      expect(p).toBe(p.trim());
    }

    // resources: clean names, no duplicate ids, rawType only on 'other'
    const ids = new Set<number>();
    for (const r of g.resources ?? []) {
      if (r.name) {
        expect(r.name, r.name).not.toMatch(/\.(safetensors|sft|ckpt|pt|pth|bin|gguf)$/i);
        expect(r.name, r.name).not.toMatch(/[\\/]/);
      }
      if (r.rawType !== undefined) expect(r.kind).toBe('other');
      if (r.civitaiModelVersionId !== undefined) {
        expect(ids.has(r.civitaiModelVersionId), `dup id ${r.civitaiModelVersionId}`).toBe(false);
        ids.add(r.civitaiModelVersionId);
      }
      expect(r.name ?? r.hash ?? r.civitaiModelVersionId, 'unidentifiable resource').toBeDefined();
    }

    // the model summary agrees with the checkpoint resource
    if (g.model) {
      const checkpoint = (g.resources ?? []).find((r: any) => r.kind === 'checkpoint');
      expect(checkpoint, 'model without checkpoint resource').toBeDefined();
      if (g.model.name) expect(g.model.name).toBe(checkpoint.name);
    }

    // tool always names the generator that matched
    expect(g.tool?.name).toBe(expected.generator);
  });
});
