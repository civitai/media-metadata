# Changelog

## Unreleased

ComfyUI coverage: graphs built on custom nodes parsed to little or nothing, so images uploaded
to civitai showed no prompt and no resources (Freshdesk 72488 / 70088).

- **Custom samplers are recognized by shape.** A node carrying KSampler's inputs
  (`positive`/`negative`/`latent_image`/`sampler_name`) under an unrecognized class name —
  `IllustriousKSamplerPro`, `KSampler_A1111`, `ClownsharKSampler_Beta`, `Tiled KSampler` — now
  yields its prompt, seed, steps, cfg and size. A real `KSampler` still wins where both exist,
  which means a graph mixing a vendor base pass with a stock refiner reports the refiner.
  39% of a 500-image no-prompt sample had no recognized sampler at all.
- **Prompts assembled inside the graph are followed.** Primitive string nodes
  (`PrimitiveStringMultiline`, `String Literal`) expose their literal under `value`/`string`, and
  `string_a`/`string_b` concatenate chains are joined with their delimiter. Every word is in the
  executed graph; only the joining was missing. Those two widget keys are read only while the walk
  is following a string input — on a conditioning node the same key holds a mode, not a prompt.
- **Prompt text is recovered from the UI `workflow` graph** when the executed graph has only a
  link — a prompt fed from a file reader or wildcard node lives nowhere else. Taken by widget NAME
  where the frontend records one (`widgets_values_named`), otherwise from slot 0 only, and only on
  text-encode nodes. It never overrides what the executed graph carries, and never fills in for a
  value the graph resolved to empty — including through a link, and including an on-site image
  whose curated summary says the prompt was empty. Each of those is a way to fabricate a prompt
  that was never used, which is worse than reporting none.
- **More loader nodes yield their resources**: `Power Lora Loader (rgthree)` and
  `Lora Loader Stack (rgthree)` (per-row toggles honored), `Lora Loader`/`Lora Stacker (LoraManager)`
  (active rows only, including the bare-array form), `AnimaLoRARemapTagLoader` (`<lora:…>` tags),
  `LoraLoader|pysssss` / `LoraLoaderModelOnly|pysssss` and `CheckpointLoader|pysssss` /
  `CheckpointLoaderSimple|pysssss` (`{ content }` widget values), `easy fullLoader`/`a1111Loader`/
  `comfyLoader`, and `UnetLoaderGGUF`. `<lora:…>` tags are read case-insensitively, and the weight
  is split off from the right so an unexpected spelling (`+0.5`, `1e-2`) costs the weight rather
  than the whole lora. An unfilled `'None'` slot is skipped on every loader, including the plain
  `LoraLoader` (which previously emitted a resource literally named `None`).
- **A partial or hostile graph degrades instead of discarding the image.** `read.ts` falls back to
  an EMPTY metadata bag when the parser throws or the schema rejects, so any one bad node used to
  cost every field the image had. Fixed at four sites: `getNumberValue` no longer throws on a
  non-node (and coerces a numeric string rather than returning its 0 default); the shape match no
  longer uses `in` against possibly-primitive inputs; a shape-matched sampler may lack a seed or a
  reachable latent; and lora strengths are coerced centrally, since a strength widget converted to
  an input arrives as a NODE and `additionalResources[].strength` is a required number.
- **Link resolution no longer destroys widgets that are genuinely arrays.** The pre-pass rewrote
  every array-valued input into the node it pointed at; LoraManager's `loras` stack is an array of
  objects, so `prompt[{…}]` resolved to `undefined` and the whole stack vanished. Only resolvable
  links are rewritten now.
- **The prompt walk tracks the current PATH, not every node seen**, so a string subtree feeding two
  inputs of a concatenate is read both times instead of being mistaken for a cycle (8 of 800 sampled
  graphs do this, and in all 8 the shared node was a subtree rather than a leaf). A work budget
  bounds the diamond case that makes possible.
- **`width`/`height` are numbers or absent.** A size widget linked to a resolution picker resolved
  to the picker NODE, and a `z.looseObject` schema published that object as the image's width; 304
  such blobs appeared in an 800-image sample. Each axis reads its own key, so a picker carrying both
  no longer reports the width twice.

`GraphScan` gained two OPTIONAL fields (`inferredSamplerNodes`, `promptTextFallback`). Optional
deliberately: the type is exported from the package root, and making either required would break
anyone constructing one.

Verified by replaying stored production graphs through this build and through the previous one and
diffing field by field (`scripts/replay-dump.ts` + `scripts/replay-compare.ts` — diff the two RUNS,
never against the stored column, which every parser version there has ever been contributed to).
Over 800 recent ComfyUI images: **no field lost**, beyond the 304 width/height node objects replaced
by absence; gained a prompt on 81, a negative prompt on 18, at least one resource on 160, and full
sampler params on 10. The ten images whose resource list changed each gained entries and dropped
none. On a 500-image sample that had no prompt stored, 226 (45%) now parse one.

## 0.1.0 — 2026-08-31

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
