import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { civitai } from '../../civitai/plugin';
import { readMetadata } from '../read/read';
import type { ParserPlugin } from '../plugins';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'images');
const onsiteJpeg = new Uint8Array(
  readFileSync(join(FIXTURES, 'automatic1111', 'onsite-140937841.jpeg'))
);
const plainA1111Png = new Uint8Array(
  readFileSync(join(FIXTURES, 'automatic1111', 'text-chunks-9517243.png'))
);
const comfyPng = new Uint8Array(readFileSync(join(FIXTURES, 'comfyui', 'workflow-22566974.png')));
// a comfy image whose graph carries civitai AIRs (its expected.json has civitaiResources)
const comfyAirJpeg = new Uint8Array(readFileSync(join(FIXTURES, 'comfyui', 'bulk-140937129.jpeg')));

describe('bare core vs civitai plugin', () => {
  it('core reads vanilla A1111 images fully', async () => {
    const md = await readMetadata(plainA1111Png);
    expect(md.generator).toBe('automatic1111');
    expect(md.raw.prompt).toContain('fishmonger cat');
    expect(md.civitai?.madeOnSite).toBeUndefined();
  });

  it('core parses the A1111-standard fields of civitai images; the blocks stay raw', async () => {
    // Orchestrator output is standard A1111 text with civitai JSON blocks
    // appended. Without the plugin, the standard fields must still parse —
    // the blocks are lifted out as raw strings instead of mangling the scanner.
    const md = await readMetadata(onsiteJpeg);
    expect(md.generator).toBe('automatic1111');
    expect(md.raw.prompt).toContain('poster style');
    expect(md.raw.sampler).toBeDefined();
    expect(md.raw.steps).toBeDefined();
    // the civitai blocks survive uninterpreted as raw JSON strings
    expect(typeof md.raw['Civitai resources']).toBe('string');
    expect(() => JSON.parse(md.raw['Civitai resources'] as string)).not.toThrow();
    // and none of the plugin semantics appear
    expect(md.raw.civitaiResources).toBeUndefined();
    expect(md.civitai?.madeOnSite).toBeUndefined();
  });

  it('the civitai plugin adds resources, extra, and the on-site marker', async () => {
    const md = await readMetadata(onsiteJpeg, { plugins: [civitai()] });
    expect(md.raw.civitaiResources?.length).toBeGreaterThan(0);
    expect(md.raw.extra).toBeDefined();
    expect(md.civitai?.madeOnSite).toBe(true);
  });

  it('the plugin resolves workflow AIRs the core leaves alone', async () => {
    const core = await readMetadata(comfyAirJpeg);
    const withPlugin = await readMetadata(comfyAirJpeg, { plugins: [civitai()] });
    const civitaiTagged =
      withPlugin.generation?.resources.filter((r) => r.civitaiModelVersionId) ?? [];
    expect(civitaiTagged.length).toBeGreaterThan(0);
    expect(withPlugin.raw.civitaiResources?.length).toBeGreaterThan(0);
    expect(core.raw.civitaiResources).toBeUndefined();
    // bare core doesn't even detect this legacy on-site format
    expect(core.generation?.resources.some((r) => r.civitaiModelVersionId) ?? false).toBe(false);
  });

  it('third-party plugins compose: context, parsers, and enrich all apply', async () => {
    const seen: string[] = [];
    const plugin: ParserPlugin = {
      name: 'test',
      context: { onDebug: (key) => seen.push(key) },
      enrich: (md) => {
        (md as unknown as Record<string, unknown>).customFlag = md.generator === 'comfyui';
      },
    };
    const md = await readMetadata(comfyPng, { plugins: [plugin] });
    expect(seen).toContain('nodeJson');
    expect((md as unknown as Record<string, unknown>).customFlag).toBe(true);
  });
});
