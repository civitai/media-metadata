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

```ts
import { readMetadata } from '@civitai/media-metadata';

const md = await readMetadata(fileOrBytesOrUrl);
// md.format     -> 'png' | 'jpeg' | 'webp' | 'unknown'
// md.generator  -> 'automatic1111' | 'comfyui' | 'swarmui' | 'ruinedfooocus' | null
// md.meta       -> parsed generation metadata (prompt, sampler, resources, ...)
// md.exif       -> raw flattened tags
// md.madeOnSite -> civitai's on-site marker (EXIF Artist === 'ai')
```

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

## Civitai conventions

Civitai-specific behavior is injectable and lives under `@civitai/media-metadata/civitai`:
AIR identifier parsing (`parseAir`), the on-site marker (`isMadeOnSite`). The default parser
context includes it, so results match civitai.com out of the box; pass your own `ParserContext`
to override (e.g. `resolveAir`, `samplerMap`, `a1111ExcludedKeys`, `onDebug`).

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

## Development

```bash
pnpm install
pnpm test          # vitest, includes the fixture corpus
pnpm typecheck
pnpm lint
pnpm build         # tsup -> dist (ESM + CJS + d.ts)
```

Node 24 (`.nvmrc`), pnpm 10.
