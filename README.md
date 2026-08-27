# @civitai/media-metadata

Standardized tooling for reading and writing **AI generation metadata** embedded in media files.
Images today (PNG / JPEG / WebP); the API is shaped so video and audio containers can be added
later without breaking changes.

Extracted from the [civitai.com](https://civitai.com) app, redesigned for a clean, immutable API,
and behavior-locked against the original parsers by a corpus of real civitai images that every
test run parses and round-trips.

## Install

```bash
pnpm add @civitai/media-metadata
```

## Reading

The reader is **bare-bones by default** and extended by plugins. The package bundles one plugin:
`civitai()`, which adds everything civitai.com writes. **Reading images from civitai requires
it** — without the plugin, civitai-specific blocks degrade (see Plugins below).

```ts
import { readMetadata } from '@civitai/media-metadata';
import { civitai } from '@civitai/media-metadata/civitai';

const md = await readMetadata(fileOrBytesOrUrl, { plugins: [civitai()] });
// md.generation -> THE PRIMARY OUTPUT: normalized, generator-independent view
//                  (camelCase, guaranteed number types, one merged `resources`
//                   list, `model: {name, hash}`, `tool: {name, version}`)
// md.raw        -> the verbatim per-generator bag, every passthrough key intact
//                  (escape hatch; also the civitai app's storage shape)
// md.civitai    -> the plugin's namespace: { madeOnSite, extra }; resolved resources
//                  appear IN generation.resources, tagged with their civitaiModelVersionId
// md.generator  -> 'automatic1111' | 'comfyui' | 'swarmui' | 'ruinedfooocus' | null
// md.format     -> 'png' | 'jpeg' | 'webp' | 'unknown'
// md.exif       -> raw flattened tags
```

Use `md.generation` unless you need generator-specific detail: it's the stable surface
(`generation.steps` is always a `number`; `generation.resources` merges the five shapes the
underlying formats scatter resources across). `md.raw` preserves the source faithfully — mixed
key casing, string values, extension keys like `AddNet Module 1` — and is what `encodeMetadata`
consumes. Plugins never write into the shared bag's top level; each gets its own namespace
(`md.civitai`).

Inputs can be a `Uint8Array`, `ArrayBuffer`, `Blob`/`File`, or a URL string (fetched). The core is
isomorphic — browser and node — with no native dependencies. Node-only conveniences live under
`@civitai/media-metadata/node` (`readMetadataFromFile`).

### Supported formats

| Generator | Container | Where the metadata lives |
|---|---|---|
| Automatic1111 (and compatible: Forge, on-site civitai) | PNG, JPEG | `parameters` text chunk / EXIF UserComment |
| ComfyUI | PNG, WebP, JPEG (legacy) | `prompt` + `workflow` chunks / EXIF Model tag / UserComment JSON |
| SwarmUI | PNG | `sui_image_params` JSON in `parameters` |
| RuinedFooocus | PNG | JSON in `parameters` with a `software` marker |

Detection order matters (formats overlap) and is preserved from the original app implementation.

## Writing

The write side exists so **resizing or converting an image doesn't silently destroy its generation
data** — including ComfyUI workflows on PNGs, which the pre-package app code lost.

```ts
import { copyMetadata, embedMetadata, payloadFromMediaMetadata } from '@civitai/media-metadata';

// The resize-safe primitive: re-embed source metadata into resized/converted bytes
const restored = await copyMetadata(originalFile, resizedBytes);

// Or lower-level:
const payload = payloadFromMediaMetadata(await readMetadata(originalFile));
const withMeta = await embedMetadata(pngOrJpegBytes, payload);
```

- **PNG**: writes `parameters` / `prompt` / `workflow` as `tEXt` chunks (`iTXt` when the text
  isn't Latin-1-safe), replacing same-keyword chunks.
- **JPEG**: builds and splices an APP1 EXIF segment (Artist, Software, UserComment), replacing an
  existing Exif segment in place. Raw source UserComment bytes are carried verbatim, so JPEG→JPEG
  copies are byte-lossless.
- **WebP**: read-only in v1.

## Plugins

The core parses the four generator formats vanilla-style and knows nothing site-specific. A
`ParserPlugin` has three seams:

- **`parsers`** — transform the registry (wrap, replace, extend, reorder parsers)
- **`context`** — merge `ParserContext` contributions (details-line extractors, sampler map,
  excluded keys, debug hook)
- **`enrich`** — annotate the result envelope after parsing

### The bundled `civitai()` plugin

```ts
import { civitai } from '@civitai/media-metadata/civitai';
const md = await readMetadata(input, { plugins: [civitai()] });
```

It adds: `Civitai resources:` / `Civitai metadata:` details-line blocks (with AIR → version-id
resolution, overridable via `civitai({ resolveAir })`), the `CivitaiModelSelector` ComfyUI node,
civitai's on-site generation formats (legacy UserComment JSON, curated `extraMetadata`
summaries), workflow-AIR → `civitaiResources` resolution with `engine: 'Civitai'`, and the
`madeOnSite` marker.

Civitai's orchestrator writes standard A1111 text with its blocks appended, so **without the
plugin the standard fields (prompt, sampler, steps, size, …) still parse fully** — the core lifts
any unrecognized `Key: {...}`/`Key: [...]` JSON block out of the details line as a raw string
passthrough (`raw['Civitai resources']` etc.) instead of letting it mangle the scanner. The
plugin is what *interprets* those blocks (`civitaiResources` with resolved version ids, `extra`,
`madeOnSite`) and what handles the on-site ComfyUI formats.

### Writing your own

See `examples/06-third-party-usage.ts` for a complete custom plugin (a details-line extractor +
an enrich hook). `parseGenerationText` and `encodeMetadata` accept the same
`{ plugins, context }` options.

## Injectable conventions (`ParserContext`)

### Sampler normalization (`samplerMap`)

`samplerMap` is a single shared table shaped `A1111 display name → [native aliases]`
(`'Euler a' → ['euler_ancestral']`). It's used in one direction only: the ComfyUI, SwarmUI, and
RuinedFooocus parsers look their native sampler name up **by alias value** and rewrite it to the
A1111 name (with a `_karras` retry when the scheduler is karras). The A1111 parser never uses it —
its text already carries A1111 vocabulary. One table works because those UIs all emit the same
comfy-style snake_case family; SwarmUI additionally keeps the native name in `originalSampler`.

- **Add a new ecosystem's names** by appending aliases to the same entries — no second map needed:
  `map.set('DPM++ 2M', [...map.get('DPM++ 2M'), 'my_ui_dpm_2m'])`.
- **Disable normalization** (keep raw native names) by passing `samplerMap: new Map()`.
- A custom parser you register can ignore `ctx.samplerMap` and close over its own table.

### A1111 encode policy (`a1111ExcludedKeys`)

`a1111ExcludedKeys` is the denylist of unified-metadata keys that are internal/cross-parser
fields rather than A1111 text fields (skipped on details-line passthrough and on encode). It's a
denylist rather than an allowlist because the A1111 format is open-ended — extensions add
arbitrary `Key: value` pairs, and an allowlist would silently drop them. The default
(`defaultA1111ExcludedKeys`) covers this package's own internal keys; extend it if you add yours:

```ts
import { defaultA1111ExcludedKeys, encodeMetadata } from '@civitai/media-metadata';

encodeMetadata(meta, 'automatic1111', {
  a1111ExcludedKeys: [...defaultA1111ExcludedKeys, 'myInternalKey'],
});
```

## Examples & playground

`examples/` contains a runnable script for each way civitai uses this package — upload
preprocessing, resize-preserving-metadata, copy generation data, paste-parameters, source-metadata
extraction — plus a third-party usage example with a custom `ParserContext`. Each file's header
names the exact civitai call site it mirrors; `docs/civitai-migration.md` maps every call site to
its replacement API.

```bash
pnpm examples     # run them all against the fixture corpus
pnpm playground   # drag-and-drop parser inspector at http://localhost:5199
```

The playground is a dev-only Vite page: drop any image (or paste a civitai CDN URL) and see the
detected generator, parsed metadata, re-encoded A1111 text, embeddable payload, and raw tags.
Plugin checkboxes control which plugins the next read uses, and "compare vs bare core" adds a
key-level diff showing exactly what each plugin contributed. The mode is linkable:
`http://localhost:5199/?plugins=none` opens in bare-core mode (plugin-free read/write testing),
`?plugins=civitai&compare=1` opens with the plugin plus the diff view; toggling checkboxes keeps
the URL in sync. A **Report parse issue** button
opens a prefilled GitHub issue for images that parse wrong — see below.

### Reporting images that parse wrong

Bad parses become test fixtures through a two-step pipeline:

1. Anyone files an issue via the **fixture-report template** (or the playground's per-card
   Report button / multi-select "Report N selected" button) and drags the *original* image
   file(s) into it — several per issue is fine; each attachment becomes its own fixture.
2. A maintainer adds the `fixture-report` label; the `fixture-report.yml` workflow downloads the
   attachment, ingests it into `fixtures/`, blesses an expectation pinning **current** parser
   output, and opens a PR. The reviewer compares the expectation against the report — if the
   parser needs fixing, the fix lands on that branch with a re-bless before merge.

The label gate means untrusted uploads never enter the repo without maintainer action.
Every card also has a **Transform + copyMetadata** control that resizes/converts the image through
a canvas (which strips all metadata, same as the app's resize path), restores the metadata with
`copyMetadata`, re-reads the result, and badges it "metadata fully preserved" or "lossy for this
target" with a key-level diff — plus a Download button for the transformed file.

## Fixtures & tests

`fixtures/images/<generator>/` holds real images from civitai.com — several per generator — each
with a blessed `<name>.expected.json`. The test suite auto-discovers every image and asserts:

1. **Parse**: output equals the blessed expectation.
2. **Round-trip**: sharp-resize/convert the image (which strips metadata), `copyMetadata` from the
   original, re-read, and the metadata deep-equals the expectation, for each format listed in the
   fixture's `roundTrip.formats`.

Workflow:

```bash
pnpm test                     # run everything
pnpm bless [filter]           # regenerate expected.json from current output (review the diff!)
pnpm fetch-fixtures --verify-only   # check committed fixtures against manifest sha256s
```

`fixtures/manifest.json` records the source URL and sha256 of every image. New fixtures: drop the
image in the right directory (or use `scripts/ingest.ts`), run `pnpm bless`, review, commit. CI
never blesses — a changed expectation is always a reviewed, deliberate decision.

### Adding a parser

Implement `MetadataParser<TState>` (`src/image/parsers/types.ts`): `detect` inspects the flattened
tags **without mutating them** and returns your normalized state or `null`; `parse` turns state
into metadata; `encode` renders your native text format. Register it in
`src/image/parsers/registry.ts` (order matters), add 3–5 real fixture images, and bless.

## Known deliberate differences from the civitai app

- The app's `getMetadata()` stripped the `meta.extra` payload down to three app-specific keys as a
  side effect of its zod schema; this package keeps the full `extra` record. (The app can re-strip.)
- `detect` failures skip to the next parser instead of aborting the whole read.
- AddNet weights are read from `AddNet Weight A ${i}` (what the extension writes) and non-finite
  weights are omitted. Historically a NaN weight failed schema validation and discarded the entire
  metadata object — every AddNet-era image parsed to `{}`. (Fixed in the app in parallel; see
  docs/corpus-findings.md item 1.)
- A1111 `quote()`/`unquote()` semantics (per upstream `infotext_utils.py`): the encoder JSON-quotes
  values containing commas/newlines/colons/quotes, and the parser unquotes quoted prose back to a
  plain string (the app turns it into junk nested objects). Quoted values beginning with `key: `
  (`Lora hashes`, `ControlNet 0`) still parse as nested blocks, matching app output.
- RuinedFooocus detection is whitespace-tolerant (`"software":"RuinedFooocus"` with or without a
  space); the app requires python-json spacing.
- SwarmUI's version is read from the spec-correct `swarm_version` key (also fixed in the app).

## Development

```bash
pnpm install
pnpm test          # vitest, includes the fixture corpus
pnpm typecheck
pnpm lint
pnpm build         # tsup -> dist (ESM + CJS + d.ts)
```

Node 24 (`.nvmrc`), pnpm 10.
