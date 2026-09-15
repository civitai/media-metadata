/**
 * Read real image FILES through the whole reader — container sniff, chunk/EXIF
 * extraction, detect, parse, schema validation, plugin enrich — and write
 * `{ id: md.raw }` to stdout. `replay-dump.ts` starts from a stored graph and so
 * skips everything before `parse`; this is what catches a regression in the rest.
 *
 *   pnpm tsx scripts/replay-files.ts index.json > before.json   (at the base revision)
 *   pnpm tsx scripts/replay-files.ts index.json > after.json
 *   pnpm tsx scripts/replay-compare.ts before.json after.json
 *
 * `index.json` is `[{ id, file, bucket }]`. Ad-hoc tool, not a test: the images are
 * real user uploads read from a scratch directory and are never committed.
 */
import { readFileSync } from 'node:fs';
import { readMetadata } from './read';

type Entry = { id: number; file: string; bucket: string };

const entries: Entry[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out: Record<string, unknown> = {};

for (const entry of entries) {
  try {
    const md = await readMetadata(new Uint8Array(readFileSync(entry.file)));
    const raw = { ...(md.raw as Record<string, unknown>) };
    delete raw.comfy;
    out[entry.id] = { ...raw, __generator: md.generator, __bucket: entry.bucket };
  } catch (e) {
    out[entry.id] = { __threw: (e as Error).message, __bucket: entry.bucket };
  }
}

process.stdout.write(JSON.stringify(out));
