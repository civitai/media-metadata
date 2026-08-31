/**
 * Third-party usage — the reader is bare-bones by default and extended by plugins.
 *
 * Without plugins you get vanilla parsing of the four generator formats and
 * nothing site-specific. The bundled `civitai()` plugin adds everything
 * civitai.com writes; your own plugin can do the same for your platform via
 * three seams: `parsers` (transform the registry), `context` (extractors,
 * sampler map, excluded keys, debug hook), and `enrich` (annotate the result).
 *
 * Run: pnpm exec tsx examples/06-third-party-usage.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { A1111DetailExtractor, ParserPlugin } from '../src/index';
import { defaultA1111ExcludedKeys, encodeMetadata, readMetadata } from '../src/index';
import { readCivitaiMetadata } from '../src/civitai/index';

const file = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'images',
  'automatic1111',
  'onsite-140937841.jpeg'
);
const bytes = new Uint8Array(await readFile(file));

// 1) Bare core: vanilla A1111 fields only — no civitai semantics
const bare = await readMetadata(bytes);
console.log('bare:   civitaiResources =', bare.raw.civitaiResources, '| namespace =', bare.civitai);

// 2) With the bundled civitai plugin
const site = await readCivitaiMetadata(bytes); // civitai() baked in; md.civitai guaranteed
console.log(
  'plugin: resources =',
  site.civitai.generation?.resources.length,
  `(${site.civitai.generation?.resources.filter((r) => r.modelVersionId).length} with modelVersionId)`,
  '| madeOnSite =',
  site.civitai.madeOnSite
);

// 3) Your own plugin: extract a custom details-line block and tag the result.
// Declare your envelope namespace once via declaration merging (use the
// package name '@civitai/generation-metadata' in your own project) and md.myApp is
// typed everywhere — no casts.
declare module '../src/index' {
  interface PluginNamespaces {
    myApp: { jobId?: string };
  }
}
const myBlockExtractor: A1111DetailExtractor = (line, metadata) => {
  const match = line.match(/, MyApp job: (\S+)/);
  if (!match) return line;
  metadata.myAppJobId = match[1];
  return line.replace(match[0], '');
};
const myPlugin: ParserPlugin = {
  name: 'my-app',
  context: { a1111DetailExtractors: [myBlockExtractor] },
  enrich: (md) => {
    md.myApp = { jobId: md.raw.myAppJobId as string | undefined };
  },
};
const custom = await readMetadata(bytes, { plugins: [myPlugin] });
console.log('custom plugin ran:', custom.myApp !== undefined);

// 4) Context knobs work with or without plugins (e.g. protect your internal keys on encode)
const text = encodeMetadata({ ...site.raw, myAppInternalId: 'abc123' }, 'automatic1111', {
  context: { a1111ExcludedKeys: [...defaultA1111ExcludedKeys, 'myAppInternalId'] },
});
console.log('encoded contains internal key:', text.includes('myAppInternalId'));
