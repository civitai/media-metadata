/**
 * Ad-hoc fixture hunter: page through the public images API, download originals,
 * run the reader over them, and collect candidates per generator bucket.
 *   tsx scripts/hunt.ts <pages> [apiQuery] [perBucket]
 * Prints found candidates as JSON lines ready for scripts/ingest.ts.
 */
import { readMetadata } from '../src/image/read/read';

const PER_BUCKET: Record<string, number> = {
  automatic1111: 5,
  comfyui: 5,
  swarmui: 5,
  ruinedfooocus: 5,
  none: 3,
};

const found = new Map<string, { id: number; url: string; size: number; format: string }[]>();

const pages = parseInt(process.argv[2] ?? '3');
const extraQuery = process.argv[3] ?? '';
const perBucketOverride = process.argv[4] ? parseInt(process.argv[4]) : undefined;
let cursor: string | undefined;

function done() {
  return Object.entries(PER_BUCKET).every(
    ([bucket, max]) => (found.get(bucket)?.length ?? 0) >= (perBucketOverride ?? max)
  );
}

for (let page = 0; page < pages; page++) {
  const url = `https://civitai.com/api/v1/images?limit=100&nsfw=None${extraQuery}${
    cursor ? `&cursor=${cursor}` : ''
  }`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('api error', res.status);
    break;
  }
  const data = (await res.json()) as {
    items: { id: number; url: string }[];
    metadata?: { nextCursor?: string };
  };
  cursor = data.metadata?.nextCursor;

  for (const item of data.items) {
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
      const bucket = md.generator ?? 'none';
      const max = perBucketOverride ?? PER_BUCKET[bucket] ?? 0;
      const list = found.get(bucket) ?? [];
      if (list.length >= max) continue;
      list.push({ id: item.id, url: item.url, size: bytes.length, format: md.format });
      found.set(bucket, list);
      console.log(
        `FOUND ${bucket}/${md.format}${md.madeOnSite ? '/onsite' : ''}  id=${item.id} size=${bytes.length}  ${item.url}`
      );
    } catch {
      // skip unreadable images
    }
  }
  const counts = [...found.entries()].map(([b, l]) => `${b}:${l.length}`).join(' ');
  console.log(`page ${page + 1} done; ${counts}`);
  if (done() || !cursor) break;
}
