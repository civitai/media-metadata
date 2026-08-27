/** Ad-hoc: fetch a URL and report what the reader sees. `tsx scripts/probe.ts <url>` */
import { readMetadata } from './read';

const url = process.argv[2];
const res = await fetch(url);
console.log(
  'status',
  res.status,
  res.headers.get('content-type'),
  res.headers.get('content-length')
);
const bytes = new Uint8Array(await res.arrayBuffer());
console.log('bytes', bytes.length);
const md = await readMetadata(bytes);
console.log('format', md.format, '| generator', md.generator, '| madeOnSite', md.madeOnSite);
console.log('exif keys:', Object.keys(md.exif).slice(0, 40).join(', '));
console.log('meta keys:', Object.keys(md.meta).join(', '));
console.log('prompt:', String(md.meta.prompt ?? '').slice(0, 120));
