/**
 * Compare two `scripts/replay-dump.ts` outputs field by field. See that file for the
 * workflow. Ad-hoc tool, not a test.
 */
import { readFileSync } from 'node:fs';

const before = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<
  string,
  Record<string, unknown>
>;
const after = JSON.parse(readFileSync(process.argv[3], 'utf8')) as Record<
  string,
  Record<string, unknown>
>;

const gained: Record<string, number> = {};
const lost: Record<string, number> = {};
const changed: Record<string, number> = {};
const examples: string[] = [];
const empty = (s: string) => s === 'null' || s === '""' || s === '[]';

for (const id of Object.keys(before)) {
  const a = before[id];
  const b = after[id];
  if (!b) continue;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = JSON.stringify(a[key] ?? null);
    const y = JSON.stringify(b[key] ?? null);
    if (x === y) continue;
    if (empty(x)) gained[key] = (gained[key] ?? 0) + 1;
    else if (empty(y)) {
      lost[key] = (lost[key] ?? 0) + 1;
      if (examples.length < 20) examples.push(`LOST ${id} ${key}: ${x.slice(0, 110)}`);
    } else {
      changed[key] = (changed[key] ?? 0) + 1;
      if (examples.length < 20)
        examples.push(`CHANGED ${id} ${key}: ${x.slice(0, 80)} -> ${y.slice(0, 80)}`);
    }
  }
}

const sort = (o: Record<string, number>) => Object.entries(o).sort((m, n) => n[1] - m[1]);
console.log(`images compared: ${Object.keys(before).length}`);
console.log('GAINED :', sort(gained));
console.log('LOST   :', sort(lost));
console.log('CHANGED:', sort(changed));
for (const e of examples) console.log('  ', e);
