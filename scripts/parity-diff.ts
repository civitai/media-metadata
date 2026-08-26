/**
 * Ad-hoc: compare the old app parser's output (parity-old.json, produced by a
 * throwaway script run in the civitai repo) against the blessed expected files.
 *   tsx scripts/parity-diff.ts <parity-old.json>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const old: Record<string, { madeOnSite?: boolean; meta?: any; error?: string }> = JSON.parse(
  readFileSync(process.argv[2], 'utf8')
);
const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'images');

function diff(a: any, b: any, path = ''): string[] {
  if (a === b) return [];
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return [`${path}: old=${JSON.stringify(a)} new=${JSON.stringify(b)}`];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const key of keys) out.push(...diff(a[key], b[key], path ? `${path}.${key}` : key));
  return out;
}

let total = 0;
for (const [file, oldResult] of Object.entries(old)) {
  const expected = JSON.parse(
    readFileSync(join(FIXTURES_DIR, file.replace(/\.(png|jpe?g|webp)$/i, '.expected.json')), 'utf8')
  );
  const diffs = diff(
    { madeOnSite: oldResult.madeOnSite, meta: oldResult.meta, error: oldResult.error },
    { madeOnSite: expected.madeOnSite, meta: expected.meta, error: undefined }
  );
  if (diffs.length) {
    total += diffs.length;
    console.log(`\n== ${file}`);
    for (const d of diffs) console.log('  ' + d);
  }
}
console.log(total === 0 ? '\nPARITY: identical' : `\n${total} difference(s)`);
