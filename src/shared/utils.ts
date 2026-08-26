export function findKeyForValue<K, V>(m: ReadonlyMap<K, V[]>, v: V): K | undefined {
  for (const [k, vs] of m) {
    if (vs.includes(v)) return k;
  }
  return undefined;
}

/** Drop null/undefined values and empty arrays (matches the app's removeEmpty). */
export function removeEmpty<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[key] = value;
  }
  return result as T;
}

/** JSON.parse that revives `123n` strings as BigInt and returns null on failure. */
export function fromJson<T extends object>(str: string): T | null {
  try {
    return JSON.parse(str, (_key, value) => {
      if (typeof value === 'string' && /^\d+n$/.test(value)) return BigInt(value.slice(0, -1));
      return value;
    }) as T;
  } catch {
    return null;
  }
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
