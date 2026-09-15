/**
 * Parse every stored ComfyUI graph in a row dump and write `{ id: meta }` to stdout,
 * so two checkouts can be compared field by field. Run it once per checkout — from a
 * `git worktree` at the base revision and from the branch — then:
 *
 *   pnpm tsx scripts/replay-compare.ts before.json after.json
 *
 * Diff the two RUNS, not against the stored `meta` column: that column was written by
 * every parser version there has ever been, so a diff against it reports years of
 * drift as if this change caused it. Ad-hoc tool, not a test.
 */
import { readFileSync } from 'node:fs';
import { createCivitaiComfyParser } from '../src/civitai/comfy';
import { parseAir } from '../src/civitai/air';
import { cleanBadJson } from '../src/image/parsers/comfyui/graph';
import { createParserContext } from '../src/image/parsers/types';

type Row = { id: number; comfy: string | null };

const ctx = createParserContext();
// The app reads through readCivitaiMetadata, so the core parser is the wrong baseline.
const parser = createCivitaiComfyParser(parseAir);
const rows: Row[] = JSON.parse(readFileSync(process.argv[2], 'utf8')).rows;
const out: Record<string, unknown> = {};

for (const row of rows) {
  if (!row.comfy) continue;
  let stored: { prompt?: unknown; workflow?: unknown };
  try {
    stored = JSON.parse(cleanBadJson(row.comfy.replace(/:\s*undefined/g, ': null')));
  } catch {
    continue;
  }
  const state = parser.detect(
    {
      prompt: JSON.stringify(stored.prompt),
      workflow: stored.workflow == null ? undefined : JSON.stringify(stored.workflow),
    },
    ctx
  );
  if (!state) continue;
  try {
    const meta = { ...(parser.parse(state, ctx) as Record<string, unknown>) };
    delete meta.comfy;
    out[row.id] = meta;
  } catch (e) {
    out[row.id] = { __threw: (e as Error).message };
  }
}

process.stdout.write(JSON.stringify(out));
