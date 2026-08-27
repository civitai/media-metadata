/**
 * Primitives for the A1111 "parameters" text format:
 *
 *   <prompt lines>
 *   Negative prompt: <negative lines>
 *   Steps: 30, Sampler: Euler a, CFG scale: 7, ..., Key: "quoted, value", ...
 *
 * The format is not a grammar anyone specified — it's whatever A1111 and its
 * extensions print — so these are hand-written scanners rather than regexes:
 * values may contain quoted commas, nested key/value blocks, ISO dates with
 * colons, and arbitrary JSON blobs appended by extensions.
 */

const SD_KEY_MAP = new Map<string, string>([
  ['Seed', 'seed'],
  ['CFG scale', 'cfgScale'],
  ['Sampler', 'sampler'],
  ['Steps', 'steps'],
  ['Clip skip', 'clipSkip'],
]);

/** A1111 label → unified key (e.g. 'CFG scale' → 'cfgScale'); unknown labels pass through. */
export function toUnifiedKey(key: string): string {
  return SD_KEY_MAP.get(key.trim()) ?? key.trim();
}

/** unified key → A1111 label, for encoding back to text. */
export function toA1111Key(key: string): string {
  for (const [label, unified] of SD_KEY_MAP) {
    if (unified === key) return label;
  }
  return key;
}

/**
 * Normalize generation text so the section keywords sit on their own lines.
 * Some tools jam everything on one line with `.`/`,` delimiters.
 */
export function normalizeGenerationDetails(details: string): string {
  if (!details) return '';
  const clean = details.replace(/^Parameters\s*:\s*/, '');

  // If a "Steps:" line already exists, the metadata is already structured across lines —
  // leave it untouched. This is what protects keywords that appear inside prompt text
  // (e.g. "Hires steps:", or a prompt that literally says "steps:"). Only jammed
  // single-line formats need fixing below.
  if (/(^|\n)Steps: ?\d/.test(clean)) return clean;

  // Put each section keyword on its own line. Split only when preceded by a real `,`/`.`
  // delimiter (what the single-line formats use as separators). Keep every quantifier
  // bounded ({0,7}, not *) so a crafted run of delimiters can't cause catastrophic
  // backtracking (ReDoS) — this runs on untrusted uploaded image metadata.
  return clean
    .replace(/[ \t\r]{0,7}[.,][ \t\r.,]{0,7}(Negative prompt:)/gi, '\n$1')
    .replace(/[ \t\r]{0,7}[.,][ \t\r.,]{0,7}(Steps:)(?=\s*\d)/gi, '\n$1');
}

/**
 * Find a balanced `{...}` JSON object following `prefix`, tolerating nested
 * braces and braces inside strings. Returns the JSON text and the span of
 * prefix+json in `str` so the caller can cut it out.
 */
export function extractBalancedJson(
  str: string,
  prefix: string
): { json: string; start: number; end: number } | null {
  const prefixIndex = str.indexOf(prefix);
  if (prefixIndex === -1) return null;

  const jsonStart = str.indexOf('{', prefixIndex + prefix.length);
  if (jsonStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        return { json: str.substring(jsonStart, i + 1), start: prefixIndex, end: i + 1 };
      }
    }
  }

  return null;
}

function isPartialDate(value: string) {
  return value.length === 14 && value[11] === 'T';
}

/** A1111's quote(): JSON-quote a settings value that would break the line format. */
export function quoteInfotextValue(value: string): string {
  return /[,\n:"]/.test(value) ? JSON.stringify(value) : value;
}

// Anchored: KV blocks (`Lora hashes: "a: 1"`, `ControlNet 0: "Module: none, …"`)
// BEGIN with `key: `; quoted prose that merely contains a colon later does not.
const KEY_VALUE_SHAPE = /^[\w][\w\s.+-]*: /;

/**
 * A quoted value is either a nested key/value block (`Lora hashes: "a: 1, b: 2"`,
 * which A1111 splits after unquoting — we recurse directly) or an A1111
 * JSON-quoted plain string (`Wildcard prompt: "text, with commas"`), which
 * unquotes back to text like upstream's unquote().
 */
function resolveQuotedValue(raw: string): unknown {
  if (KEY_VALUE_SHAPE.test(raw)) return parseDetailsLine(raw);
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

/**
 * Parse the comma-separated `Key: value` details line. Quoted values recurse
 * into nested key/value blocks or unquote to plain strings (see
 * resolveQuotedValue); ISO-8601 timestamps are kept whole despite their colons.
 */
export function parseDetailsLine(line: string | undefined): Record<string, any> {
  const result: Record<string, any> = {};
  if (!line) return result;
  let currentKey = '';
  let currentValue = '';
  let insideQuotes = false;
  let insideDate = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '\\' && insideQuotes) {
      // JSON-style escape inside a quoted value: keep the pair verbatim so an
      // escaped quote can't flip the quote state; resolveQuotedValue decodes it
      currentValue += char + (line[i + 1] ?? '');
      i++;
    } else if (char === '"') {
      if (insideQuotes) {
        if (currentKey) result[currentKey] = resolveQuotedValue(currentValue.trim());
        currentKey = '';
      }
      insideQuotes = !insideQuotes;
    } else if (char === ':' && !insideQuotes && !insideDate) {
      if (isPartialDate(currentValue)) insideDate = true;
      else {
        currentKey = toUnifiedKey(currentValue);
        currentValue = '';
      }
    } else if (char === ',' && !insideQuotes) {
      if (insideDate) insideDate = false;
      if (currentKey) result[currentKey] = currentValue.trim();
      currentKey = '';
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  if (currentKey) result[currentKey] = currentValue.trim();

  return result;
}
