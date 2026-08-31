# Changelog

## 0.1.0 — not yet published to npm (stamp the date on publish)

Initial public API.

- `readMetadata` / `parseGenerationText` / `encodeMetadata` over four generator formats
  (Automatic1111, ComfyUI, SwarmUI, RuinedFooocus), PNG / JPEG / WebP read, PNG / JPEG write.
- `copyMetadata` / `embedMetadata`: resize-safe metadata preservation, including ComfyUI
  workflows on PNG and Artist/Software via PNG `eXIf` chunks.
- Plugin architecture with typed envelope namespaces (`PluginNamespaces` declaration merging);
  bundled `civitai()` plugin with `readCivitaiMetadata`, `normalizeCivitaiGeneration`, and
  `normalizeGeneration` under `@civitai/generation-metadata/civitai`.
- Behavior locked by a corpus of 91 real images with blessed expectations, round-trip and
  format-chain tests.
