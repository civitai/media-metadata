/**
 * CI entry for fixture reports: read a GitHub issue body (env ISSUE_BODY +
 * ISSUE_NUMBER), download every image the reporter attached, save each as a
 * fixture with a blessed expectation pinning CURRENT parser output, and update
 * the manifest. Runs inside .github/workflows/fixture-report.yml, which turns
 * the changes into a PR for human review.
 *
 * Local dry-run: ISSUE_NUMBER=123 ISSUE_BODY="...url..." tsx scripts/ingest-report.ts
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readMetadata } from './read';
import { defaultRoundTripFormats } from './roundtrip-defaults';

const ROOT = join(import.meta.dirname, '..', 'fixtures');
const MAX_BYTES = 8_000_000;

const issueNumber = process.env.ISSUE_NUMBER;
const issueBody = process.env.ISSUE_BODY ?? '';
if (!issueNumber) {
  console.error('ISSUE_NUMBER is required');
  process.exit(1);
}

// GitHub attachment URL shapes (drag-and-drop into an issue)
const ATTACHMENT_URL =
  /https:\/\/(?:github\.com\/user-attachments\/assets\/[\w-]+|(?:private-)?user-images\.githubusercontent\.com\/\S+?\.(?:png|jpe?g|webp))/gi;

const urls = [...new Set(issueBody.match(ATTACHMENT_URL) ?? [])];
if (urls.length === 0) {
  console.error('No image attachments found in the issue body.');
  process.exit(1);
}

type ManifestEntry = {
  file: string;
  url: string;
  sha256: string;
  generator: string | null;
  notes?: string;
};
let manifest: ManifestEntry[] = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
const knownShas = new Set(manifest.map((m) => m.sha256));

let saved = 0;
for (const [index, url] of urls.entries()) {
  const res = await fetch(url, {
    headers: process.env.GITHUB_TOKEN
      ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : undefined,
  });
  if (!res.ok) {
    console.error(`skip ${url}: HTTP ${res.status}`);
    continue;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) {
    console.error(`skip ${url}: ${bytes.length} bytes exceeds the ${MAX_BYTES} cap`);
    continue;
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (knownShas.has(sha256)) {
    console.error(`skip ${url}: identical image already in the corpus`);
    continue;
  }

  const md = await readMetadata(bytes);
  if (md.format === 'unknown') {
    console.error(`skip ${url}: not a supported image format`);
    continue;
  }
  const dir = md.generator ?? 'none';
  const name = `report-${issueNumber}${urls.length > 1 ? `-${index + 1}` : ''}`;
  const file = `${dir}/${name}.${md.format}`;

  await mkdir(join(ROOT, 'images', dir), { recursive: true });
  await writeFile(join(ROOT, 'images', file), bytes);
  await writeFile(
    join(ROOT, 'images', file.replace(/\.\w+$/, '.expected.json')),
    JSON.stringify(
      {
        generator: md.generator,
        madeOnSite: md.madeOnSite ?? false,
        meta: md.meta,
        roundTrip: { formats: defaultRoundTripFormats(md) },
      },
      null,
      2
    ) + '\n'
  );
  manifest = manifest.filter((m) => m.file !== file);
  manifest.push({
    file,
    url,
    sha256,
    generator: md.generator,
    notes: `fixture-report issue #${issueNumber} — expectation pins parser output AT INGEST TIME; review against the report before merging`,
  });
  knownShas.add(sha256);
  saved++;
  console.log(`saved ${file} (${bytes.length}b, generator=${md.generator})`);
}

if (saved === 0) {
  console.error('No fixtures ingested.');
  process.exit(1);
}
manifest.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${saved} fixture(s) ingested from issue #${issueNumber}.`);
