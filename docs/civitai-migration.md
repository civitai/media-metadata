# Using this package in the civitai app

Every current call site of the old metadata tooling in `civitai/civitai`, mapped to its
replacement here. The `examples/` directory contains a runnable version of each usage pattern.

## Trying it before it's published

From the civitai repo, either of:

```bash
# file dependency (simplest; re-run pnpm install after rebuilding the package)
pnpm add @civitai/media-metadata@file:../media-metadata

# or a workspace-style link for live iteration
pnpm link ../media-metadata
```

Once published, it's just `pnpm add @civitai/media-metadata`.

## The civitai plugin is required

The reader is bare-bones by default; **every read the app does must pass the bundled plugin**:

```ts
import { civitai } from '@civitai/media-metadata/civitai';
const md = await readMetadata(file, { plugins: [civitai()] });
```

The plugin carries all on-site formats, `Civitai resources`/`Civitai metadata` block
interpretation, AIR resolution, and `madeOnSite`. Without it the A1111-standard fields still
parse (the blocks stay as raw string passthrough), but none of the civitai semantics appear and
the legacy on-site ComfyUI format goes undetected. The adapter below is the natural place to
bake the plugin in once so call sites never think about it.

## Recommended adoption shape

Keep `src/utils/metadata/index.ts` as a **thin adapter** that re-exports package APIs under the
old names, so the ~15 call sites don't all change at once. The adapter owns the app-only pieces
(clipboard helpers, `imageMetaSchema` re-validation); parsing/encoding/writing come from the
package. Call sites then migrate to direct package imports opportunistically.

## Call-site map

| Civitai call site | Today | With this package |
|---|---|---|
| `src/utils/media-preprocessors/image.preprocessor.ts:11` (upload pipeline) | `getMetadata(file)` | `(await readMetadata(file)).meta` — optionally re-validated with the app's `imageMetaSchema` if the stricter `extra` shape must be preserved (see README "Known deliberate differences") |
| `src/utils/metadata/index.ts` `ExifParser(file)` → `parse/getMetadata/isMadeOnSite/encode` (GenerationForm.tsx:2719, MetadataExtractionPanel.tsx:222, PanelModal.tsx:499, metadata-test page) | one closure-returning parser | `const md = await readMetadata(file)` → `md.meta`, `md.madeOnSite`; `encodeMetadata(md.meta)` |
| `src/components/ImageMeta/ImageMeta.tsx:362`, `ImageGenerationData.tsx` ("copy generation data") | `encodeMetadata(meta)` | `encodeMetadata(meta)` (same name, from the package) — example 03 |
| `src/hooks/useMetadataCopy.ts` / `copyMetadataToClipboard` | app | **stays in the app** (DOM/clipboard concern); its text half is the package's `encodeMetadata` |
| `src/components/generation_v2/inputs/PromptInput.tsx:65` (paste parameters) | `parsePromptMetadata(text)` | `parseGenerationText(text)` — example 04 |
| `src/utils/metadata/extract-source-metadata.ts` (enhancement workflows / source-metadata.store) | `ExifParser` + manual split | `readMetadata` + the same `{ params, resources }` split — example 05 shows the exact port |
| `src/shared/utils/canvas-utils.ts` `canvasToBlobWithImageExif` (getCroppedImg, imageToJpegBlob, resizeImage) | ~30-line hand-rolled JPEG APP1 splice | `new Blob([await copyMetadata(sourceFile, canvasBlob)])` — example 02. **Bonus**: PNG targets keep ComfyUI workflows, which the current code drops |
| `src/components/Generation/Input/DrawingEditor/drawing.utils.ts:141-172` (duplicate of the splice) | copy-pasted splice | same `copyMetadata` call — deletes the duplication |
| `src/utils/encoding-helpers.ts` (`decodeUserComment`, `encodeUserCommentUTF16BE`, `createExifSegmentFromTags`) | app-local | exported here: `decodeUserComment`, `encodeUserCommentUTF16BE`, `createExifSegment`/`setExifSegment` |
| `src/utils/metadata/index.ts:64` `isMadeOnSite` | `Artist === 'ai'` check | `md.madeOnSite`, or `isMadeOnSite(exif)` from `@civitai/media-metadata/civitai` |
| `src/server/schema/image.schema.ts` `imageMetaSchema` | app schema validates parser output | the package validates with its own vendored `generationMetadataSchema`; the app schema can `.extend()` it, or keep re-validating `md.meta` for the app-only `extra` refinements |
| `src/utils/metadata/audit.ts` (prompt moderation) | app | **stays in the app** — not metadata parsing |
| `src/pages/testing/metadata-test.tsx` (dev harness) | app page | superseded by this repo's `pnpm playground` (drag-and-drop parser inspector) |

## What the app must NOT lose in the swap

- **Registry order** is behavior (`automatic → swarmui → ruinedfooocus → comfy`); the package
  preserves it — don't reorder when customizing `parsers`.
- The app's `getMetadata()` catch-all (`{}` on any failure) is matched by `md.meta` being `{}`
  when nothing parses.
- `extra` stripping: the package keeps the full `extra` record where the old `getMetadata()`
  stripped it to `remixOfId`/`provenance`/`sourceImageIds`. If the app relies on the stripping,
  re-validate `md.meta` with `imageMetaSchema` at the boundary (one line, same behavior as today).
