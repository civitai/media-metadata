/**
 * Which embed targets a fixture's metadata round-trips losslessly:
 * - A1111 text and no-metadata images survive both containers.
 * - ComfyUI survives PNG always; JPEG only when the source was already the
 *   legacy JPEG UserComment format (a fresh comfy→jpeg embed is lossy by design).
 * - SwarmUI/RuinedFooocus detectors only read the `parameters` chunk, so PNG only.
 */
export function defaultRoundTripFormats(md: {
  generator: string | null;
  format: string;
}): ('png' | 'jpeg')[] {
  if (md.generator === 'swarmui' || md.generator === 'ruinedfooocus') return ['png'];
  if (md.generator === 'comfyui') return md.format === 'jpeg' ? ['png', 'jpeg'] : ['png'];
  return ['png', 'jpeg'];
}
