---
spike: 001
name: mtoon-runtime-audit
type: standard
validates: "Given the real .vrm assets loaded through the SDK's own loader path, when every MToonMaterial's runtime properties are dumped, then the actual post-v0compat values are known and the proposed repair thresholds are confirmed or refuted"
verdict: VALIDATED
related: [002, 003]
tags: [mtoon, vrm, diagnostics, v0compat]
---

# Spike 001: MToon Runtime Audit

## What This Validates

**Given** the real `.vrm` assets loaded through the same path `VRMAvatar.tsx` uses
(`GLTFLoader.parse()` + the full `VRMLoaderPlugin`), **when** every `MToonMaterial`'s runtime
properties are dumped, **then** the actual post-`VRMMaterialsV0CompatPlugin` values are known
and the repair-pass detection thresholds drafted from raw file values are confirmed or refuted.

**Why it had to run first:** the thresholds were drafted by reading `extensions.VRM.materialProperties`
straight out of the `.vrm` files. But `VRMMaterialsV0CompatPlugin` rewrites those values with
non-trivial math before any material exists:

```js
shadingToonyFactor = lerp(_ShadeToony, 1, 0.5 + 0.5 * _ShadeShift)
shadingShiftFactor = -_ShadeShift - (1 - shadingToonyFactor)
giEqualizationFactor = 1 - _IndirectLightIntensity
outlineWidthFactor  = 0.01 * _OutlineWidth          // v0 is cm, v1 is m
```

So file values are **not** what a repair pass would see. Writing the pass against them would
have aimed every rule at the wrong number.

## Research

Sources consulted before building (no library docs needed beyond the installed source):

- `VRMC_materials_mtoon-1.0` spec — lighting model, parameter semantics, ranges, defaults.
- `@pixiv/three-vrm-materials-v0compat@3.4.2` source — the exact conversion math above.
- `@pixiv/three-vrm-materials-mtoon@3.4.2` source — uniform defaults, and confirmation that
  the fragment shader includes `<tonemapping_fragment>` (so renderer tone mapping does affect
  MToon output).
- `.planning/phases/11-idle-transition-talking-states/11-11-SUMMARY.md` — prior headless
  harness precedent, and its claim that the full `VRMLoaderPlugin` crashes in Node.

| Approach | Pros | Cons | Status |
|---|---|---|---|
| Headless Node + full `VRMLoaderPlugin` | Real `MToonMaterial` objects, fast, scriptable, diffable JSON | Phase 11 reported it crashes in Node | **Chosen** (crash turned out to be fixable) |
| Headless Node + `VRMCoreLoaderPlugin` | Known to work (Phase 11 precedent) | Core plugin skips materials entirely — answers nothing | Rejected |
| Browser page that dumps values to console | Perfect runtime fidelity | Slow loop, no diffable artifact, needs a dev server | Deferred to 002/003, which need a browser anyway |

## How to Run

```bash
# one-time: expose the workspace's three/@pixiv deps to the script
ln -sfn ../../../packages/react/node_modules .planning/spikes/001-mtoon-runtime-audit/node_modules

node .planning/spikes/001-mtoon-runtime-audit/audit-mtoon.mjs                 # all default models
node .planning/spikes/001-mtoon-runtime-audit/audit-mtoon.mjs male.vrm        # one model
```

Writes `audit-result.json` alongside the script.

## What to Expect

Per-material runtime values for every `MToonMaterial`, diagnosis flags per material, a
rule-fire-count matrix across models, and a breakdown separating deliberately-flat face
details from genuinely-broken body materials.

## Investigation Trail

**Iteration 1 — module resolution.** Script under `.planning/spikes/` could not resolve `three`
(pnpm strict layout, no hoisting to the repo root). Fixed by symlinking
`packages/react/node_modules` into the spike directory so ESM resolution walks up into it.

**Iteration 2 — reproduced Phase 11's crash, and found what it actually is.**
Full `VRMLoaderPlugin` threw `self is not defined` at `GLTFLoader.js:3377`
(`GLTFParser.loadImageSource`). **This is not an MToon problem — it is glTF image decoding.**
Phase 11 concluded the full plugin "crashes in Node" and fell back to `VRMCoreLoaderPlugin`;
the real constraint is narrower than that, and only affects textures.

**Iteration 3 — stubbed textures, hit a second wall.** Returning `null` from
`parser.assignTexture` moved the failure into three-vrm itself:
`Cannot set properties of undefined (setting 'colorSpace')` at
`GLTFMToonMaterialParamsAssignHelper` — it calls `setTextureColorSpace(materialParams[slot])`
immediately after assigning, with no null check.

**Iteration 4 — image-less `THREE.Texture` stubs.** Returning real but image-less
`new THREE.Texture()` objects satisfied both three and three-vrm. **The full `VRMLoaderPlugin`,
MToon materials included, now loads headless.** This unblocks material-level regression tests
in `packages/react`'s existing vitest suite, which Phase 11 believed impossible.

**Iteration 5 — first audit run refuted two draft rules.** See Results.

**Iteration 6 — corrected the rim rule against the spec.** The draft flagged rim as dead when
`rimLightingMixFactor ≈ 0`. That is backwards: per spec, `rimLightingMixFactor` blends between
*emission* (0) and *lit* (1) rim — `0` makes rim **more** visible, not less. Rim is killed by a
**black `parametricRimColorFactor`**. Flag corrected before the final run.

**Iteration 7 — split `flatNoShade` by material role.** The raw count looked alarming until the
hits were grouped: on `male.vrm` all 7 are eyes/lashes/brows/mouth, where flat shading is
correct anime authoring. Added a name-based face-detail classifier to separate "expected flat"
from "suspiciously flat".

## Results

**Verdict: VALIDATED** — the audit ran against every real asset and produced decisive numbers.
Two of the five draft rules are dead, one is dangerous, and two new rules were discovered.

### Rule fire counts (materials affected / total MToon)

| Rule | `male.vrm` | `3636451243928341470.vrm` *(well-authored 1.0)* | `262410318834873893.vrm` | `amongus.vrm` |
|---|---|---|---|---|
| `rimDead` (rim color ≈ black) | **19/19** | 9/21 | **18/18** | 1/2 |
| `fresnelAbsurd` (> 20) | 0/19 | 0/21 | **18/18** | 0/2 |
| `toonyOutOfRange` (outside 0–1) | 1/19 | 0/21 | 0/18 | 0/2 |
| `toonyTooSoft` (< 0.3) *(new)* | **14/19** | 4/21 | 0/18 | 0/2 |
| `shiftFullyLit` (≥ 0.5) *(new)* | **5/19** | 0/21 | 0/18 | 0/2 |
| `shiftExtremeNegative` (< −0.5) | **0/19** | **0/21** | **0/18** | **0/2** |
| `flatNoShade` (shade ≈ lit) | 7/19 | 7/21 | 7/18 | 1/2 |

### Findings

**1. Draft rule `shadingShiftFactor < -0.5` is dead — zero hits on every model.**
Exactly as predicted during decomposition. `male.vrm`'s raw `_ShadeShift = -1` converts to a
runtime `shadingShiftFactor` of `-0.1507` (body) or `+1` (hair). Delete the rule.

**2. Draft rule `shadeColorFactor ≈ litColor → inject cool shade` is actively dangerous.**
On `male.vrm`, **7 of 7 hits are eyes, eye highlights, eyelashes, eyelines and brows** — where
flat shading is deliberate anime authoring. Even the well-authored VRM 1.0 model has 4 of its
7 flat materials on face details. Repairing these would paint shadows across irises and eye
highlights: strictly worse. Drop the rule, or gate it hard behind a face-detail exclusion.

**3. NEW — `male.vrm`'s real defect is `shadingToonyFactor ≈ 0.15` on 14 of 19 materials.**
That is a very wide, soft lighting ramp — Lambert-ish, not toon at all. This is the actual
mechanism behind "our avatars look flat", and it is invisible from the raw file values
(`_ShadeToony = 0`).

**4. NEW — all 5 hair materials on `male.vrm` render 100% lit, permanently.**
Runtime `shadingToonyFactor = 1` **and** `shadingShiftFactor = 1`. With `shift = +1`,
`dot(N,L) + 1 ≥ 0` always, and `linearstep(-1 + 1, 1 - 1, x)` collapses to a zero-width range —
`shading` saturates at 1, so `lerp(shade, lit, 1)` returns lit colour for every pixel. **The
hair never receives shading under any light direction.**

**5. Rim lighting is dead across the entire VRM 0.x set.** 19/19 and 18/18 materials have a
black `parametricRimColorFactor`. `262410318834873893.vrm` additionally sets
`parametricRimFresnelPowerFactor = 100` on all 18 (razor-thin, invisible rim). Confirms the
pre-spike hypothesis with runtime evidence.

**6. The well-authored model is not untouchable.** `3636451243928341470.vrm` still trips
`rimDead` on 9/21 and `toonyTooSoft` on 4/21. A repair pass **will** modify it — so spike 002's
non-regression check is a real test, not a formality.

**7. Tooling unlock (unplanned).** Phase 11's "full `VRMLoaderPlugin` crashes in Node" is only
true for textures. With image-less `THREE.Texture` stubs the whole plugin loads headless, so
MToon behaviour can be regression-tested in `packages/react`'s existing vitest suite.

### Caveat

Texture-multiplied MToon slots (`shadeMultiplyTexture`, `rimMultiplyTexture`,
`shadingShiftTexture`) are stubbed out and therefore **not** reflected. A material whose rim is
driven by `rimMultiplyTexture` would read as `rimDead` here but may not be. None of the audited
models appear to rely on this, but the repair pass should skip a slot when its multiply texture
is present.

## Signal for Spike 002

Revised repair rule set to build against:

| Rule | Trigger (runtime value) | Action | Evidence |
|---|---|---|---|
| R1 rim injection | `parametricRimColorFactor` ≈ black **and** no `rimMultiplyTexture` | inject a subtle rim colour | 19/19, 18/18 |
| R2 fresnel clamp | `parametricRimFresnelPowerFactor > 20` | clamp to ~5 | 18/18 on one model |
| R3 toony floor | `shadingToonyFactor < 0.3` | raise toward ~0.7–0.9 | 14/19 |
| R4 fully-lit fix | `shadingShiftFactor >= 0.5` | pull back to ~0 | 5/19 (all hair) |
| R5 range clamp | `shadingToonyFactor` outside 0–1 | clamp | 1/19 |
| ~~shift < −0.5~~ | — | **DELETED** — zero hits | 0/78 materials |
| ~~shade ≈ lit~~ | — | **DELETED** — hits are intentional face details | 7/7 on male.vrm |
