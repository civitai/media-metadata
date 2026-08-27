# Format references — authoritative shapes for each metadata format

Where each format is actually specified (or where its writer's source code lives), what the
canonical shape is, and where this package's implementation is known to differ. Use this when
improving an encoder or adding a parser: **the writer's own source is the spec.**

## Automatic1111 infotext

- **Spec-by-source**: `modules/infotext_utils.py` (parsing, `quote()`/`unquote()`) and
  `modules/processing.py` `create_infotext()` (writing) in
  [AUTOMATIC1111/stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui).
- **Shape**: prompt lines → `Negative prompt:` lines → one settings line of `Key: value` pairs.
  Keys match `\w[\w \-/]+`. **Values containing a comma, newline, or colon are JSON-quoted**
  (`quote()`); readers `unquote()` them back to plain strings. Size is `WIDTHxHEIGHT`, parsed
  upstream into `Size-1`/`Size-2`. `parse_generation_parameters` applies defaults for missing
  keys (`Clip skip` → 1, `Schedule type` → Automatic, `RNG` → GPU, …).
- **Our known deltas**:
  - ~~Encoder didn't apply `quote()`~~ — fixed 2026-08-26: values with commas/newlines/colons/quotes
    are JSON-quoted on encode, and the scanner unquotes them on parse (with escape handling).
    Quoted values that BEGIN with `key: ` (e.g. `Lora hashes`, `ControlNet 0`) still parse as
    nested key/value blocks; quoted prose that merely contains a colon unquotes to a string.
    This diverges from the civitai app, which turns quoted prose into junk nested objects.
  - We do not apply upstream's missing-key defaults (deliberate: we report what's present).

## SwarmUI

- **Spec**: the official
  [Image Metadata Format doc](https://github.com/mcmonkeyprojects/SwarmUI/blob/master/docs/Image%20Metadata%20Format.md).
- **Shape**: JSON in the PNG `parameters` chunk / JPEG EXIF UserComment with root keys
  `sui_image_params` (lowercase simplified param ids; **`swarm_version` is always present**;
  nothing else is guaranteed), optional `sui_extra_data` (timings, `original_prompt`), optional
  `sui_models` (`{ name, param, hash }` — hash is a full `0x` + 64-hex tensorhash or null).
  A `StealthMetadata` mode can hide the JSON in low-value alpha/color bits.
- **Our known deltas** (all shared with the civitai app):
  - ~~`swarmVersion` vs `swarm_version`~~ — fixed 2026-08-26 in this package AND the civitai app
    (read prefers `swarm_version` with `swarmVersion` fallback; encode writes `swarm_version`).
  - We truncate hashes to 12 chars at parse (civitai's matching length), so encode can't restore
    the `0x` + 64-hex form SwarmUI expects.
  - We don't read `sui_extra_data` or stealth metadata.

## ComfyUI

- **Shape**: PNG `prompt` (API-format graph JSON) + `workflow` (UI-format graph JSON) tEXt
  chunks, written by core `SaveImage`; webp save nodes put `prompt:`-prefixed JSON in EXIF
  `Model`. There is no schema — the graph *is* the metadata, and custom nodes extend it freely
  (why every reader, [sd-parsers included](https://github.com/d3x-at/sd-parsers), caveats
  "custom nodes might parse incorrectly").
- **Ours**: read is graph-walking over a known node vocabulary; encode is passthrough of the
  stored `meta.comfy` blob (a graph cannot be synthesized from a parameter bag).

## RuinedFooocus / Fooocus family

- **Spec-by-source**: [RuinedFooocus](https://github.com/runew0lf/RuinedFooocus) writes flat
  JSON (with `"software": "RuinedFooocus"`) into the PNG `parameters` chunk. Mainline
  [Fooocus](https://github.com/lllyasviel/Fooocus) has its own optional JSON scheme
  (off by default — most Fooocus images carry nothing, matching what our corpus hunts found);
  Fooocus-MRE differs again.

## Formats we don't parse yet (reference readers exist)

Multi-format readers worth mining for shapes — both MIT-licensed with test suites:
[sd-parsers](https://github.com/d3x-at/sd-parsers) (Python; A1111, ComfyUI, Fooocus, InvokeAI,
NovelAI incl. the stealth alpha-channel extractor) and
[stable-diffusion-prompt-reader](https://github.com/receyuki/stable-diffusion-prompt-reader)
(A1111, Easy Diffusion, StableSwarmUI, Fooocus-MRE, NovelAI legacy+stealth, InvokeAI, ComfyUI,
Draw Things, Naifu — and notably its *write* side converts everything to A1111 format, the same
one-way-door our encoder treats as the universal target).

- **NovelAI**: legacy PNG tEXt (`Title`/`Description`/`Comment` JSON) and "stealth pnginfo"
  (metadata bit-packed into the alpha channel — survives some re-encodes that strip chunks).
- **InvokeAI**: `invokeai_metadata` (current) / `sd-metadata` (legacy) PNG chunks, versioned
  JSON with typed model/lora references.
- **Easy Diffusion, Draw Things, Naifu**: per-tool JSON shapes; see the readers above.

## Coverage gaps this implies (encode side)

1. ~~Encode round-trip tests per fixture~~ — done 2026-08-26: `encode-roundtrip.test.ts`
   auto-discovers every fixture, encodes the blessed meta, re-parses, and compares the encodable
   subset per generator (91 cases). It immediately caught the RuinedFooocus detector requiring
   python-style `": "` spacing (now whitespace-tolerant) and pinned the SwarmUI resources
   round-trip.
2. ~~A1111 `quote()` support~~ — done 2026-08-26 (see deltas above).
3. ~~SwarmUI `swarm_version` fix~~ — done 2026-08-26, both repos.
4. **Richer opt-in A1111 encode**: reconstruct `<lora:name:weight>` extranets and a `Hashes:`
   block from `resources`/`hashes` when converting comfy/swarm metadata to A1111 text.
5. **New parsers as plugins** (NovelAI, InvokeAI first — both have stable documented shapes and
   reference implementations), with fixture hunts scoped per format.
