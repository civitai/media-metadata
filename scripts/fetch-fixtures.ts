/**
 * Re-download the fixture images listed in fixtures/manifest.json and verify
 * their sha256 against the committed manifest. The images are committed to the
 * repo; this script exists for provenance and refresh, not for normal test runs.
 *
 *   pnpm fetch-fixtures [--verify-only]
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type ManifestEntry = {
  file: string;
  url: string;
  sha256: string;
  generator: string | null;
  notes?: string;
};

const ROOT = join(import.meta.dirname, '..', 'fixtures');
const manifest: ManifestEntry[] = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
const verifyOnly = process.argv.includes('--verify-only');

let failures = 0;
for (const entry of manifest) {
  const target = join(ROOT, 'images', entry.file);
  const synthetic = !entry.url.startsWith('http');
  let bytes: Uint8Array;
  if (verifyOnly || synthetic) {
    // synthetic fixtures (see scripts/make-webp-fixture.ts) have no source URL — verify from disk
    bytes = await readFile(target);
  } else {
    const res = await fetch(entry.url);
    if (!res.ok) {
      console.error(`FAIL ${entry.file}: fetch ${res.status} ${entry.url}`);
      failures++;
      continue;
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== entry.sha256) {
    console.error(
      `FAIL ${entry.file}: sha256 mismatch\n  expected ${entry.sha256}\n  got      ${sha256}`
    );
    failures++;
    continue;
  }
  if (!verifyOnly && !synthetic) await writeFile(target, bytes);
  console.log(`ok   ${entry.file}`);
}

if (failures > 0) {
  console.error(`\n${failures} fixture(s) failed.`);
  process.exit(1);
}
console.log(`\n${manifest.length} fixture(s) ${verifyOnly ? 'verified' : 'fetched'}.`);
