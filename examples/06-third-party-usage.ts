/**
 * Third-party usage — consuming the package outside civitai.
 *
 * The default ParserContext bakes in civitai's conventions so civitai gets
 * correct results with zero config; everything civitai-specific is overridable:
 *   - resolveAir:        how `urn:air:...` identifiers resolve (or throw)
 *   - samplerMap:        sampler-name normalization table
 *   - a1111ExcludedKeys: which unified-bag keys are internal (extend with yours)
 *   - onDebug:           hook for intermediate parser state (node graphs)
 *
 * Run: pnpm exec tsx examples/06-third-party-usage.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultA1111ExcludedKeys, encodeMetadata, readMetadata, samplerMap } from '../src/index';

const file = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'images',
  'comfyui',
  'workflow-22566974.png'
);
const bytes = new Uint8Array(await readFile(file));

const md = await readMetadata(bytes, {
  context: {
    // keep civitai AIR resolution out entirely: unresolvable AIRs stay raw strings
    resolveAir: () => {
      throw new Error('AIR resolution disabled');
    },
    // add sampler aliases for your own UI
    samplerMap: new Map([...samplerMap, ['My Sampler', ['my_sampler_internal']]]),
    // watch the ComfyUI node graph as it's parsed
    onDebug: (key) => console.log('[debug hook]', key),
  },
});
console.log('generator:', md.generator, '| prompt:', String(md.meta.prompt).slice(0, 60));

// exclude your own internal keys when encoding back to A1111 text
const text = encodeMetadata({ ...md.meta, myAppInternalId: 'abc123' }, 'automatic1111', {
  a1111ExcludedKeys: [...defaultA1111ExcludedKeys, 'myAppInternalId'],
});
console.log('encoded contains internal key:', text.includes('myAppInternalId'));
