/**
 * Source metadata for enhancement workflows — split parsed meta into
 * { params, resources } the way the generation form consumes it.
 *
 * Mirrors in the civitai app:
 *   src/utils/metadata/extract-source-metadata.ts extractSourceMetadata
 *   (consumed by SourceImageUpload / MetadataExtractionPanel / GenerationForm
 *    via src/store/source-metadata.store.ts)
 *
 * Run: pnpm exec tsx examples/05-extract-source-metadata.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readMetadata } from '../src/index';
import { civitai } from '../src/civitai/index';

async function extractSourceMetadata(bytes: Uint8Array) {
  const { meta } = await readMetadata(bytes, { plugins: [civitai()] });
  if (Object.keys(meta).length === 0) return undefined;

  const { resources, civitaiResources, additionalResources, ...params } = meta;
  const allResources = [
    ...(resources ?? []),
    ...(civitaiResources ?? []),
    ...(additionalResources ?? []),
  ];

  if (Object.keys(params).length === 0 && allResources.length === 0) return undefined;
  return {
    params: Object.keys(params).length ? params : undefined,
    resources: allResources.length ? allResources : undefined,
  };
}

const file = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'images',
  'swarmui',
  'params-24641975.png'
);
const result = await extractSourceMetadata(new Uint8Array(await readFile(file)));
console.log('params keys:', Object.keys(result?.params ?? {}).join(', '));
console.log('resources:', JSON.stringify(result?.resources, null, 2));
