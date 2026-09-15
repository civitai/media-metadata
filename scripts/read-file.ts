/**
 * Read one image file off disk through the full civitai read path and print what
 * it parsed to. The companion to `probe.ts`, which takes a URL.
 *
 *   pnpm tsx scripts/read-file.ts <path>
 */
import { readFileSync } from 'node:fs';
import { readMetadata } from './read';

const md = await readMetadata(new Uint8Array(readFileSync(process.argv[2])));

const raw = { ...(md.raw as Record<string, unknown>) };
const comfy = typeof raw.comfy === 'string' ? raw.comfy : undefined;
delete raw.comfy;

console.log('generator:', md.generator, '| format:', md.format);
console.dir(raw, { depth: 6, maxStringLength: 400 });
console.log('comfy blob length:', comfy?.length ?? 0);
console.log('--- normalized resources ---');
console.dir(md.civitai?.generation?.resources, { depth: 4 });
