/**
 * Ad-hoc fixture hunter (on-site era pass): find madeOnSite images across image-ID
 * eras (the orchestrator's output format evolved), bucketed by format and ID range.
 * Saves directly into fixtures/ + manifest like bulk-hunt.
 *   tsx scripts/hunt-onsite.ts
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readMetadata } from './read';

const ROOT = join(import.meta.dirname, '..', 'fixtures');
const MAX_BYTES = 2_000_000;
const PER_BUCKET = 3;

// id ranges ≈ eras: <40M ≈ 2023–mid-2024, 40–80M ≈ 2024–2025, 80–120M ≈ 2025–mid-2026
const ID_BUCKETS: { key: string; min: number; max: number }[] = [
  { key: 'lt40m', min: 0, max: 40_000_000 },
  { key: '40to80m', min: 40_000_000, max: 80_000_000 },
  { key: '80to120m', min: 80_000_000, max: 120_000_000 },
];

const SOURCES: { query: string; pages: number }[] = [
  { query: '&sort=Most%20Reactions&period=AllTime', pages: 8 },
  { query: '&modelId=101055&sort=Most%20Reactions&period=AllTime', pages: 3 }, // SDXL 1.0 (2023-24)
  { query: '&modelId=257749&sort=Most%20Reactions&period=AllTime', pages: 3 }, // Pony V6 (2024)
  { query: '&modelId=618692&sort=Most%20Reactions&period=AllTime', pages: 3 }, // Flux.1 D (2024-25)
  { query: '&modelId=4201&sort=Most%20Reactions&period=AllTime', pages: 2 }, // Realistic Vision
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

const counts: Record<string, number> = {};
let scanned = 0;

function bucketFor(id: number, generator: string): string | null {
  const range = ID_BUCKETS.find((b) => id >= b.min && id < b.max);
  return range ? `${generator}/${range.key}` : null;
}

function allMet() {
  return (
    ID_BUCKETS.flatMap((b) => ['automatic1111', 'comfyui'].map((g) => `${g}/${b.key}`)).filter(
      (k) => (counts[k] ?? 0) < PER_BUCKET
    ).length === 0
  );
}

outer: for (const source of SOURCES) {
  let cursor: string | undefined;
  for (let page = 0; page < source.pages; page++) {
    const url = `https://civitai.com/api/v1/images?limit=100${source.query}${
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
      if (item.id >= 120_000_000) continue; // recent era already over-represented
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
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (knownShas.has(sha256)) continue;
        const md = await readMetadata(bytes);
        if (!md.civitai?.madeOnSite || !md.generator) continue;
        const bucket = bucketFor(item.id, md.generator);
        if (!bucket || (counts[bucket] ?? 0) >= PER_BUCKET) continue;

        const dir = md.generator;
        const file = `${dir}/onsite-era-${item.id}.${md.format}`;
        await mkdir(join(ROOT, 'images', dir), { recursive: true });
        await writeFile(join(ROOT, 'images', file), bytes);
        manifest = manifest.filter((m) => m.file !== file);
        manifest.push({
          file,
          url: item.url,
          sha256,
          generator: md.generator,
          notes: `on-site era sweep (${bucket})`,
        });
        knownShas.add(sha256);
        counts[bucket] = (counts[bucket] ?? 0) + 1;
        console.log(`saved [${bucket}] ${file} (${bytes.length}b)`);
      } catch {
        // skip unreadable
      }
    }
    if (allMet()) break outer;
  }
  console.log(`source done ${source.query}; ${JSON.stringify(counts)} scanned=${scanned}`);
}

manifest.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('\nfinal:', JSON.stringify(counts), 'scanned:', scanned);
