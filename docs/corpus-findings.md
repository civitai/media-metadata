# Corpus findings & quirks

Findings from running the parsers against the full fixture corpus (107 real civitai images,
image ids 23K → 140.9M, late-2022 → 2026), cross-checked against the civitai app's original
parser (`src/utils/metadata/*` in civitai/civitai). Status per item: **open decision** (needs a
call), **preserved quirk** (kept deliberately for parity, documented in code/tests), or
**informational**.

Verification method: every fixture has a blessed `.expected.json`; the suite asserts parse +
write round-trips (321 tests); a throwaway script runs the *old app parser* over the same images
and diffs. As of this writing the only old-vs-new differences are the documented `meta.extra`
handling — everything else is byte-identical across the corpus.

---

## 1. 🔴 AddNet images lose ALL metadata (production bug) — FIXED in this package (2026-08-26)

**Fixtures:** `automatic1111/quirk-empty-meta-*.png`, `automatic1111/addnet-*.png` (5 total).

Images from the AddNet extension era detect as A1111 and `parse()` succeeds with 25–42 keys —
then schema validation rejects the whole object and the caller gets `{}`. Cause chain:

1. The parser reads `AddNet Weight ${i}`, but the AddNet extension writes
   `AddNet Weight A ${i}` / `AddNet Weight B ${i}` — so the key is always missing.
2. `parseFloat(undefined)` → `NaN` → the AddNet resource gets `weight: NaN`.
3. `resources[].weight` is `z.number()`; NaN fails; `safeParse` fails; **the entire metadata**
   (prompt, model, seed, everything) is discarded to `{}`.

**Fix applied** in `src/image/parsers/automatic1111.ts`: the parser now reads
`AddNet Weight A ${i}` (falling back to the old key) and omits non-finite weights instead of
emitting NaN. The five fixtures were re-blessed and now pin the recovered metadata (25–42 keys
each); a regression test asserts the parsed result survives schema validation. The same fix was
applied to the civitai app's `src/utils/metadata/automatic.metadata.ts`. Note this makes these
five fixtures an intentional old-vs-new parity divergence (old parser: `{}`; fixed parsers:
full metadata) until the app fix ships.

## 2. Validation is all-or-nothing — open decision

Item 1 is one instance of a general property inherited from the app: one malformed field
anywhere → the whole metadata object becomes `{}`. A salvage mode (strip invalid fields, keep the
rest) would be a deliberate, easily-tested divergence. Worth deciding alongside item 1.

## 3. Sampler mapping: gaps, and TWO diverging tables in the app — open decision

**Corpus evidence:** blessed metas retain un-normalized sampler names `dpmpp_2m_sde_gpu`
(every RuinedFooocus fixture), `dpmpp_3m_sde_gpu` (SwarmUI), `er_sde` (ComfyUI) — the vendored
`samplerMap` has no aliases for them. Inconsistently, `DPM++ SDE` *does* carry its `_gpu` alias
while `DPM++ 2M SDE` doesn't, and there is no `DPM++ 3M SDE` entry at all.

**The deeper issue (flagged by Briant, confirmed 2026-08-26):** the civitai app maintains two
independent sampler tables that have drifted:

| Table | Direction | Karras handling | Location |
|---|---|---|---|
| `samplerMap` (vendored here) | parse: native name → A1111 label | name *suffix* (`dpmpp_2m_karras`) | app `src/server/common/constants.ts:931` |
| `samplersToComfySamplers` | generate: A1111 label → comfy `{sampler, scheduler}` | separate *scheduler* field (correct for comfy) | app `src/shared/constants/generation.constants.ts:265`, used by `orchestrator/ecosystems/comfy-input.ts` |

Drift found while comparing them:

- `samplersToComfySamplers` maps **`DPM2 → 'dpmpp_2'`** and **`DPM2 a → 'dpmpp_2_ancestral'`** —
  sampler names that don't exist in ComfyUI (its own karras rows correctly use `dpm_2` /
  `dpm_2_ancestral`). Looks like a long-standing typo in the *generation* path.
- The generation table has `DPM++ 3M SDE` (+ Karras/Exponential) entries; the parse table
  doesn't — which is exactly why 3M-family names come back un-normalized (above).
- The parse table's `_karras`-suffix aliases only round-trip because `applyA1111Compat` retries
  `name + '_karras'` when `scheduler === 'karras'`.

**Suggested direction:** make this package the single source of truth — one table of
`{ a1111Name, comfySampler, comfyScheduler, aliases[] }` from which both the parse map and a
generate map are derived, exported for the app's generation path to consume. Until then, the two
tables will keep drifting independently.

## 4. Some ComfyUI graphs parse with no prompt — informational

**Fixtures:** 5 of 35 comfy fixtures (e.g. `comfyui/bulk-140935997.png`,
`comfyui/flux-sca-139981506.png`) parse successfully but `prompt` is absent — the graph routes
its text through node types `getPromptText` doesn't traverse. The app is identical. The corpus
now holds concrete graphs to extend coverage against, case by case.

## 5. Many civitai images have NO embedded metadata at all — informational

During collection, 89 scanned images had stored site metadata (at least a prompt) while the file
itself contained nothing our reader — or the app's — could detect. These are consistent with
meta entered via the upload form or stripped by editing tools before upload. Consequence:
**file metadata alone cannot reproduce site metadata for a meaningful slice of images**; the
package can only ever recover what generators actually embedded.

## 6. Passthrough key pollution — informational

The A1111 details line is open-ended, so arbitrary extension output becomes top-level meta keys.
Single-occurrence keys in this corpus include `ponyDiffusionV6XL_v6StartWithThisOne Version`,
`Module 1`, `RNG`, `Mask blur`. Harmless (and load-bearing for keys like `Model hash`), but
consumers must not treat the meta bag as a curated schema.

## 7. Preserved parity quirks — documented, kept deliberately

- **`Created Date` loses a colon**: the details-line scanner consumes the `:` that flips it into
  date mode, producing `2026-02-25T2209:08.816Z`. Pinned by a unit test in
  `src/image/parsers/__tests__/a1111-text.test.ts`.
- **Details line ending in a comma removes the last line**: `takeDetailsLine` strips the
  trailing comma before its indexOf lookup; on a miss, `splice(-1)` removes the last line —
  which is almost always the details line anyway. Doc comment on the function warns against
  "fixing" it.

## 8. Deliberate differences from the app — documented

- The app's `getMetadata()` strips `meta.extra` to three app-specific keys as a zod side
  effect; this package keeps the full record (507 of 507 old-vs-new diffs across the corpus are
  exactly this). The app can re-validate at its boundary to restore old behavior.
- A parser whose `detect` throws is skipped; the app's equivalent aborted the whole read.

## 9. On-site metadata has two format eras — informational

Sweeping popular feeds for `madeOnSite` images across image-ID ranges (2026-08-27, 778 top
all-time images checked) found **no on-site images below ID ~82M carrying embedded generation
metadata in the A1111-style format**. The observable history: on-site generations in the
~82–104M range embed the *legacy ComfyUI JSON* UserComment format (9 fixtures), and the
A1111-style UserComment output appears from ~87M onward (12 fixtures spanning 87M → 140M).
Anything older either never embedded metadata or no longer surfaces in public feeds. The
corpus's on-site coverage now spans both eras; the same-day near-duplicate batch from the first
bulk sweep was pruned to a representative handful.

## 10. Repo weight — open decision

`fixtures/images/` is ~98 MB of committed binary. Options: leave as-is (it's a test corpus),
move `fixtures/images/**` to git-lfs, or trim. The manifest records URL + sha256 for every
non-synthetic image, so the corpus is re-fetchable either way (`pnpm fetch-fixtures`).
