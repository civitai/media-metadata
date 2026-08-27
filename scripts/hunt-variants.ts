/**
 * Ad-hoc fixture hunter (variant pass): classify candidates from the STORED meta
 * (needs &withMeta=true) to find parser edge-case variants, verify each with the
 * new reader, and print ingest-ready lines.
 *   tsx scripts/hunt-variants.ts <pages> [apiQuery]
 */
import { readMetadata } from './read';

const pages = parseInt(process.argv[2] ?? '5');
const extraQuery = process.argv[3] ?? '';
let cursor: string | undefined;

const targets: Record<string, { max: number; match: (meta: Record<string, any>) => boolean }> = {
  'a1111-lora-hashes': {
    max: 2,
    match: (m) => !!m.hashes && Object.keys(m.hashes).some((k) => k.startsWith('lora:')),
  },
  'a1111-addnet': { max: 2, match: (m) => m['AddNet Enabled'] === 'True' },
  'a1111-hypernet': { max: 2, match: (m) => !!m.Hypernet },
  'a1111-refiner': { max: 1, match: (m) => !!m['Refiner hash'] },
  'comfy-flux': {
    max: 2,
    match: (m) => typeof m.comfy === 'string' && m.comfy.includes('SamplerCustomAdvanced'),
  },
  'comfy-selector': {
    max: 1,
    match: (m) => typeof m.comfy === 'string' && m.comfy.includes('CivitaiModelSelector'),
  },
  'a1111-old-era': { max: 3, match: (m) => !!m['Model hash'] && !!m.prompt },
};
const counts: Record<string, number> = Object.fromEntries(Object.keys(targets).map((k) => [k, 0]));

for (let page = 0; page < pages; page++) {
  const url = `https://civitai.com/api/v1/images?limit=100&withMeta=true${extraQuery}${
    cursor ? `&cursor=${cursor}` : ''
  }`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('api error', res.status);
    break;
  }
  const data = (await res.json()) as {
    items: { id: number; url: string; meta: Record<string, any> | null }[];
    metadata?: { nextCursor?: string };
  };
  cursor = data.metadata?.nextCursor;

  for (const item of data.items) {
    // gallery-path responses nest the generation meta as item.meta.meta
    const meta = (item.meta?.meta ?? item.meta) as Record<string, any> | null;
    if (!meta) continue;
    const bucket = Object.entries(targets).find(
      ([key, t]) => counts[key] < t.max && t.match(meta)
    )?.[0];
    if (!bucket) continue;
    try {
      const imgRes = await fetch(item.url);
      if (!imgRes.ok) continue;
      const len = parseInt(imgRes.headers.get('content-length') ?? '0');
      if (len > 4_000_000) {
        imgRes.body?.cancel();
        continue;
      }
      const bytes = new Uint8Array(await imgRes.arrayBuffer());
      const md = await readMetadata(bytes);
      if (!md.generator) continue;
      counts[bucket]++;
      console.log(
        `FOUND ${bucket} (${md.generator}/${md.format}) id=${item.id} size=${bytes.length}  ${item.url}`
      );
    } catch {
      // skip
    }
  }
  if (!cursor) break;
  if (Object.entries(targets).every(([k, t]) => counts[k] >= t.max)) break;
}
console.log('final', JSON.stringify(counts));
