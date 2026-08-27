import type { GenerationMetadata } from '../../shared/schema';
import { generationSchema } from '../../shared/schema';
import { extractBalancedJson } from './a1111-text';

const HASHES_PREFIX = ', Hashes: ';

/** `, Hashes: {...}` → metadata.hashes; returns the details line with the block removed. */
export function hashesDetailExtractor(detailsLine: string, metadata: GenerationMetadata): string {
  const result = extractBalancedJson(detailsLine, HASHES_PREFIX);
  if (!result) return detailsLine;
  metadata.hashes = JSON.parse(result.json);
  return detailsLine.slice(0, result.start) + detailsLine.slice(result.end);
}

/** Typed schema fields a raw-string passthrough would fail validation on. */
const TYPED_KEYS = new Set(Object.keys(generationSchema.shape));

/** Balanced `{...}`/`[...]` scan honoring strings/escapes; returns end index or null. */
function scanBalanced(str: string, start: number): number | null {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      const open = stack.pop();
      if ((c === '}' && open !== '{') || (c === ']' && open !== '[')) return null;
      if (stack.length === 0) return i + 1;
    }
  }
  return null;
}

/** Simple quote-parity check matching parseDetailsLine's own quote toggling. */
function outsideQuotes(str: string, index: number): boolean {
  let quotes = 0;
  for (let i = 0; i < index; i++) if (str[i] === '"') quotes++;
  return quotes % 2 === 0;
}

/**
 * Fallback guard: lift any remaining `Key: {...}` / `Key: [...]` JSON block out
 * of the details line into a raw-string passthrough value. Tools append such
 * blocks freely (civitai's among them), and left in place they mangle the plain
 * key/value scanner — historically turning the WHOLE metadata into junk that
 * failed validation. Runs after the specific extractors, which interpret the
 * blocks they own; this one only preserves what nothing else claimed.
 */
export function jsonBlockDetailExtractor(
  detailsLine: string,
  metadata: GenerationMetadata
): string {
  // bounded restart loop: each removal invalidates earlier indices
  for (let guard = 0; guard < 20; guard++) {
    let removed = false;
    for (let i = 0; i < detailsLine.length; i++) {
      const c = detailsLine[i];
      if (c !== '{' && c !== '[') continue;
      if (!outsideQuotes(detailsLine, i)) continue;
      const keyMatch = detailsLine.slice(0, i).match(/(?:^|, )([A-Za-z][^:,"{}[\]]*): $/);
      if (!keyMatch) continue;
      const end = scanBalanced(detailsLine, i);
      if (end === null) continue;
      const raw = detailsLine.slice(i, end);
      try {
        JSON.parse(raw);
      } catch {
        continue;
      }
      const key = keyMatch[1].trim();
      if (!TYPED_KEYS.has(key)) metadata[key] = raw;
      detailsLine = detailsLine.slice(0, keyMatch.index!) + detailsLine.slice(end);
      removed = true;
      break;
    }
    if (!removed) return detailsLine;
  }
  return detailsLine;
}
