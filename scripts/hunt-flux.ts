/**
 * Ad-hoc: find ComfyUI Flux-graph (SamplerCustomAdvanced) images by downloading
 * candidates and checking the parsed output — the Flux gallery hides meta from
 * the API, so stored-meta classification can't be used.
 *   tsx scripts/hunt-flux.ts <pages> [apiQuery]
 */
import { readMetadata } from './read';

const pages = parseInt(process.argv[2] ?? '5');
const extraQuery = process.argv[3] ?? '';
let cursor: string | undefined;
let found = 0;

for (let page = 0; page < pages && found < 2; page++) {
  const url = `https://civitai.com/api/v1/images?limit=100${extraQuery}${
    cursor ? `&cursor=${cursor}` : ''
  }`;
  const res = await fetch(url);
  if (!res.ok) break;
  const data = (await res.json()) as {
    items: { id: number; url: string }[];
    metadata?: { nextCursor?: string };
  };
  cursor = data.metadata?.nextCursor;

  for (const item of data.items) {
    if (found >= 2) break;
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
      if (
        md.generator === 'comfyui' &&
        typeof md.meta.comfy === 'string' &&
        md.meta.comfy.includes('SamplerCustomAdvanced')
      ) {
        found++;
        console.log(
          `FOUND comfy-flux (${md.format}) id=${item.id} size=${bytes.length}  ${item.url}`
        );
      }
    } catch {
      // skip
    }
  }
  console.log(`page ${page + 1}; found ${found} cursor=${cursor}`);
  if (!cursor) break;
}
