/**
 * AIR (AI Resource) identifier parsing, e.g. `urn:air:sd1:checkpoint:civitai:43331@176425`.
 * Vendored from @civitai/client so the package has no dependency on it.
 * https://github.com/civitai/civitai/wiki/AIR-%E2%80%90-Uniform-Resource-Names-for-AI
 */
const AIR_REGEX =
  /^(?:urn:)?(?:air:)?(?:(?<ecosystem>[a-zA-Z0-9_\-/]+):)?(?:(?<type>[a-zA-Z0-9_\-/]+):)?(?<source>[a-zA-Z0-9_\-/]+):(?<id>[a-zA-Z0-9_\-/.]+)(?:@(?<version>[a-zA-Z0-9_\-/.]+))?(?:\+(?<modelFileId>\d+))?(?:\.(?<format>[a-zA-Z0-9_-]+))?$/i;

export type ParsedAir = {
  ecosystem?: string;
  type?: string;
  source?: string;
  /** Numeric model id; NaN when the id segment is not numeric (e.g. huggingface repos). */
  model: number;
  /** Numeric version id; NaN when absent or not numeric. */
  version: number;
  modelFileId?: string;
  format?: string;
};

export function parseAir(identifier: string): ParsedAir {
  const match = AIR_REGEX.exec(identifier);
  if (!match?.groups) throw new Error(`Invalid AIR identifier: ${identifier}`);
  const { id, version, ...rest } = match.groups;
  return { ...rest, model: Number(id), version: Number(version) };
}

export function parseAirSafe(identifier: string | undefined): ParsedAir | undefined {
  if (identifier === undefined) return undefined;
  const match = AIR_REGEX.exec(identifier);
  if (!match?.groups) return undefined;
  const { id, version, ...rest } = match.groups;
  return { ...rest, model: Number(id), version: Number(version) };
}

export function isAir(identifier: string): boolean {
  return AIR_REGEX.test(identifier);
}
