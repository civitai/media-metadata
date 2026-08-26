/**
 * Ad-hoc fixture hunter (API-meta pass): page the public images API and classify
 * candidates from the STORED meta (old-parser output) without downloading images.
 * Verifies hits by downloading + running the new reader before printing them.
 *   tsx scripts/hunt-meta.ts <pages> [apiQuery]
 */
import { readMetadata } from '../src/image/read/read';

const pages = parseInt(process.argv[2] ?? '10');
const extraQuery = process.argv[3] ?? '';
let cursor: string | undefined;

const targets = { ruinedfooocus: 5, swarmui: 5, comfywebp: 3 };
const counts: Record<string, number> = { ruinedfooocus: 0, swarmui: 0, comfywebp: 0 };

async function verify(bucket: string, item: { id: number; url: string }) {
  try {
    const res = await fetch(item.url);
    if (!res.ok) return;
    const len = parseInt(res.headers.get('content-length') ?? '0');
    if (len > 4_000_000) {
      res.body?.cancel();
      return;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const md = await readMetadata(bytes);
    const ok =
      bucket === 'comfywebp'
        ? md.generator === 'comfyui' && md.format === 'webp'
        : md.generator === bucket;
    if (ok) {
      counts[bucket]++;
      console.log(`FOUND ${bucket} (${md.format}) id=${item.id} size=${bytes.length}  ${item.url}`);
    }
  } catch {
    // skip
  }
}

for (let page = 0; page < pages; page++) {
  const url = `https://civitai.com/api/v1/images?limit=100${extraQuery}${
    cursor ? `&cursor=${cursor}` : ''
  }`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('api error', res.status, await res.text().catch(() => ''));
    break;
  }
  const data = (await res.json()) as {
    items: { id: number; url: string; meta: Record<string, any> | null }[];
    metadata?: { nextCursor?: string };
  };
  cursor = data.metadata?.nextCursor;

  for (const item of data.items) {
    const meta = item.meta;
    if (!meta) continue;
    if (counts.ruinedfooocus < targets.ruinedfooocus && meta.software === 'RuinedFooocus') {
      await verify('ruinedfooocus', item);
    } else if (counts.swarmui < targets.swarmui && meta.originalSampler) {
      await verify('swarmui', item);
    } else if (counts.comfywebp < targets.comfywebp && meta.comfy) {
      const head = await fetch(item.url, { method: 'HEAD' }).catch(() => null);
      if (head?.headers.get('content-type') === 'image/webp') await verify('comfywebp', item);
    }
  }
  if (page % 5 === 4 || !cursor)
    console.log(`page ${page + 1}; found ${JSON.stringify(counts)} cursor=${cursor}`);
  if (!cursor) break;
  if (Object.entries(targets).every(([k, v]) => counts[k] >= v)) break;
}
console.log('final', JSON.stringify(counts));
