/**
 * Ad-hoc bulk fixture collector: sweep a diverse set of API queries, classify
 * every original with the reader, and save up to the per-generator targets
 * directly into fixtures/ (+ manifest). Also records what we FAILED to parse —
 * images whose stored civitai meta exists but our reader detects nothing —
 * and images that detect but parse to {} (quirk candidates, always saved).
 *   tsx scripts/bulk-hunt.ts
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readMetadata } from './read';

const ROOT = join(import.meta.dirname, '..', 'fixtures');
const MAX_BYTES = 2_000_000;

const TARGETS: Record<string, number> = {
  automatic1111: 35,
  comfyui: 30,
  swarmui: 12,
  ruinedfooocus: 8,
  none: 5,
};

// query fragments after ?limit=100&withMeta=true — mixed sorts/eras/galleries
const SOURCES: { query: string; pages: number }[] = [
  { query: '&sort=Newest', pages: 3 },
  { query: '&sort=Most%20Reactions&period=AllTime', pages: 3 },
  { query: '&sort=Most%20Reactions&period=Year', pages: 3 },
  { query: '&sort=Most%20Reactions&period=Month', pages: 3 },
  { query: '&sort=Most%20Comments&period=AllTime', pages: 2 },
  { query: '&modelId=4823&sort=Most%20Reactions&period=AllTime', pages: 3 }, // Deliberate (2023)
  { query: '&modelId=66&sort=Most%20Reactions&period=AllTime', pages: 3 }, // Anything V3 (2022-23)
  { query: '&modelId=4201&sort=Most%20Reactions&period=AllTime', pages: 2 }, // Realistic Vision
  { query: '&modelId=101055&sort=Most%20Reactions&period=AllTime', pages: 2 }, // SDXL 1.0
  { query: '&modelId=618692&sort=Most%20Reactions&period=AllTime', pages: 2 }, // Flux.1 D
  { query: '&username=runew0lf', pages: 2 }, // RuinedFooocus author
  { query: '&modelId=1141&sort=Most%20Reactions&period=AllTime', pages: 1 }, // MJV4 hypernet era
];

type ManifestEntry = {
  file: string;
  url: string;
  sha256: string;
  generator: string | null;
  notes?: string;
};
let manifest: ManifestEntry[] = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
const knownShas = new Set(manifest.map((m) => m.sha256));
const knownIds = new Set(
  manifest.map((m) => m.file.match(/-(\d+)\.\w+$/)?.[1]).filter(Boolean) as string[]
);

const saved: Record<string, number> = {};
const missedByReader: Record<string, number> = {}; // signature of stored meta we failed on
let quirkCount = 0;
let scanned = 0;

function targetsMet() {
  return Object.entries(TARGETS).every(([bucket, max]) => (saved[bucket] ?? 0) >= max);
}

function missSignature(meta: Record<string, any>): string {
  if (meta.software) return `software=${meta.software}`;
  if (meta.comfy) return 'has-comfy';
  if (meta.prompt && meta['Model hash']) return 'a1111-like';
  if (meta.prompt) return 'prompt-only';
  return `keys:${Object.keys(meta).slice(0, 5).sort().join(',')}`;
}

async function save(bucket: string, name: string, bytes: Uint8Array, url: string, notes: string) {
  const md = await readMetadata(bytes);
  const dir = md.generator ?? 'none';
  const ext = md.format === 'unknown' ? 'bin' : md.format;
  const file = `${dir}/${name}.${ext}`;
  await mkdir(join(ROOT, 'images', dir), { recursive: true });
  await writeFile(join(ROOT, 'images', file), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest = manifest.filter((m) => m.file !== file);
  manifest.push({ file, url, sha256, generator: md.generator, notes });
  knownShas.add(sha256);
  saved[bucket] = (saved[bucket] ?? 0) + 1;
  console.log(`saved [${bucket}] ${file} (${bytes.length}b)`);
}

outer: for (const source of SOURCES) {
  let cursor: string | undefined;
  for (let page = 0; page < source.pages; page++) {
    const url = `https://civitai.com/api/v1/images?limit=100&withMeta=true${source.query}${
      cursor ? `&cursor=${cursor}` : ''
    }`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = (await res.json()) as {
      items: { id: number; url: string; meta: Record<string, any> | null }[];
      metadata?: { nextCursor?: string };
    };
    cursor = data.metadata?.nextCursor;

    for (const item of data.items) {
      if (knownIds.has(String(item.id))) continue;
      knownIds.add(String(item.id));
      scanned++;
      try {
        const imgRes = await fetch(item.url);
        if (!imgRes.ok) continue;
        const len = parseInt(imgRes.headers.get('content-length') ?? '0');
        if (len > MAX_BYTES) {
          imgRes.body?.cancel();
          continue;
        }
        const bytes = new Uint8Array(await imgRes.arrayBuffer());
        const sha = createHash('sha256').update(bytes).digest('hex');
        if (knownShas.has(sha)) continue;
        const md = await readMetadata(bytes);
        const bucket = md.generator ?? 'none';

        // gold: detection succeeded but parsing produced nothing
        if (md.generator && Object.keys(md.meta).length === 0) {
          quirkCount++;
          await save(
            bucket,
            `quirk-empty-meta-${item.id}`,
            bytes,
            item.url,
            'QUIRK: generator detected but parse produced empty meta'
          );
          continue;
        }

        // stored civitai meta exists but our reader saw nothing → parser gap, record signature
        const storedMeta = (item.meta as any)?.meta ?? item.meta;
        if (!md.generator && storedMeta && Object.keys(storedMeta).length > 0) {
          const sig = missSignature(storedMeta);
          missedByReader[sig] = (missedByReader[sig] ?? 0) + 1;
        }

        if ((saved[bucket] ?? 0) >= (TARGETS[bucket] ?? 0)) continue;
        // keep 'none' fixtures only when there's also no stored meta (true negatives)
        if (bucket === 'none' && storedMeta && Object.keys(storedMeta).length > 0) continue;
        await save(bucket, `bulk-${item.id}`, bytes, item.url, `bulk sweep (${source.query})`);
      } catch {
        // skip unreadable
      }
    }
    if (targetsMet()) break outer;
  }
  console.log(`source done ${source.query}; saved=${JSON.stringify(saved)} scanned=${scanned}`);
}

manifest.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('\nfinal saved:', JSON.stringify(saved));
console.log('quirk (empty-meta) fixtures:', quirkCount);
console.log(
  'missed by reader (stored meta exists, no detection):',
  JSON.stringify(missedByReader, null, 2)
);
console.log('manifest entries:', manifest.length);
