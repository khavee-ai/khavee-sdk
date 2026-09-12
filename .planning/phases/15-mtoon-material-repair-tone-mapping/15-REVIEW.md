---
phase: 15-mtoon-material-repair-tone-mapping
reviewed: 2026-09-13T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - packages/react/src/utils/mtoonRepair.ts
  - packages/react/src/utils/mtoonRepair.test.ts
  - packages/react/src/utils/mtoonRepair.assets.test.ts
  - packages/react/src/utils/renderQuality.tsx
  - packages/react/src/VRMAvatar.tsx
  - packages/react/src/GLBAvatar.tsx
  - packages/react/src/index.ts
  - apps/playground/src/app/mtoon-spike/page.tsx
  - apps/playground/src/app/vrm-avatar-test/page.tsx
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
resolved:
  - WR-02  # fixed in e758625 — achromatic lightness floor + 4 regression tests
  - WR-03  # fixed in e758625 — local vendor-neutral MToonDebugMode union
outstanding:
  - WR-01  # accepted: over-exclusion fails safe; carried to Phase 16
  - IN-01
  - IN-02
  - IN-03
  - IN-04
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-09-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the MToon repair pass (`mtoonRepair.ts`), its two test files, the `VRMAvatar`/`GLBAvatar` wiring, the public export surface, and both playground pages against the phase's own stated invariants (non-cumulative toggle, face-detail exclusion, backward compatibility).

The core mechanics hold up under adversarial tracing:

- **Non-cumulative toggling** (`VRMAvatar.tsx:579-599`) is correctly ordered: the snapshot effect is declared before the apply-preset effect, so `mtoonSnapshotRef.current` is always populated with authored values before the apply effect reads it in the same commit. I traced React's effect-cleanup/re-run ordering across `src` changes, `materialPreset` toggles, and React 18 StrictMode's mount→cleanup→remount double-invocation (the double-invoke happens while `scene` is still `undefined`, since `useLoadVRM`'s fetch/parse is always asynchronous — so it can never snapshot an already-mutated scene in practice). I could not construct a sequence that snapshots post-repair values given the current architecture (every mount produces a freshly-parsed, never-repaired `THREE.Group` — see `useLoadVRM`'s per-instance `GLTFLoader.parseAsync`).
- **Face-detail exclusion** runs unconditionally before any rule (`mtoonRepair.ts:296-301`), with no early-return path that could bypass it, and cross-checked correctly against spike 001's `audit-result.json` ground truth for all three shipped `.vrm` assets — no false negatives (face materials leaking into repair) found.
- **Deletion of the old spike file** is clean — no dangling imports of `mtoon-spike/repairMToon.ts` remain anywhere in the tree.
- **GLBAvatar** is untouched except for an explanatory comment, confirmed via `git diff`.

Where I found real gaps: the face-detail regex is broader than it needs to be in a way that risks the opposite failure mode (skipping legitimate non-face materials on models outside the three tested assets), the black/near-black rim-tint case is under-specified and effectively a silent no-op for genuinely black materials, and a newly-public function's parameter type isn't reachable by external consumers of `@khaveeai/react`. None of these are crashes or data-loss risks, so nothing here rises to Critical, but three are worth fixing.

## Warnings

### WR-01 [ACCEPTED — carried to Phase 16]: `FACE_DETAIL_MATERIAL_RE`'s bare `shadow` token can exclude legitimate non-face materials from repair

**File:** `packages/react/src/utils/mtoonRepair.ts:26-27`
**Issue:** The face-detail classifier is:
```ts
export const FACE_DETAIL_MATERIAL_RE =
  /eye|iris|highlight|lash|eyeline|brow|mouth|tooth|teeth|tongue|face_?e|shadow/i;
```
The bare `shadow` alternative matches *any* material name containing that substring, anywhere, not just face-adjacent ones — e.g. a body material named `Body_ShadowMap`, `Cloth_Shade`, or (matching case-insensitively) `N00_Hair_Shadow_01` would be classified as face-detail and permanently excluded from repair, even though it's exactly the kind of material R1-R5 are meant to fix.

I verified against `.planning/spikes/001-mtoon-runtime-audit/audit-result.json` that on the three shipped `.vrm` assets, every regex match is also independently reachable via one of the other tokens (`eye`, `face_?e`, etc.) — i.e. `shadow` currently fires as dead weight on the tested fixtures, not a proven bug on those three files. But the regex is public API (`FACE_DETAIL_MATERIAL_RE` is exported from `@khaveeai/react`) and is exercised against *arbitrary future `.vrm` uploads* in production (`VRMAvatar`'s default `materialPreset="repair"`), not just the three regression-tested assets. A body/cloth material whose author happened to name a shadow-map texture slot or material with "shadow" in it will silently never be repaired, with no log entry and no way to tell from the outside that this happened (repair vs. face-skip are not distinguished in any user-facing signal beyond `RepairResult.skippedFaceDetail`, which conflates the two).
**Fix:** Anchor the `shadow` alternative to actual face-adjacent naming, e.g. require it to co-occur with `face`/`eye` context, or drop it if the three-asset audit shows no material actually needs it to be classified as face-detail:
```ts
export const FACE_DETAIL_MATERIAL_RE =
  /eye|iris|highlight|lash|eyeline|brow|mouth|tooth|teeth|tongue|face_?e|(?:eyes?|face)[-_]?shadow/i;
```

### WR-02 [RESOLVED e758625]: R1's rim-tint fix is a silent no-op for genuinely black/near-black base materials, and the achromatic branch has zero test coverage

**File:** `packages/react/src/utils/mtoonRepair.ts:346-385`
**Issue:** MTOON-03's fix derives the rim tint from `averageTextureColor(m.map) * m.color` (or `m.color` alone when there's no map), then branches on HSL saturation:
```ts
if (hsl.s >= opts.rimAchromaticThreshold) {
  const boostedS = Math.min(1, hsl.s * opts.rimSaturationBoost);
  base.setHSL(hsl.h, boostedS, THREE.MathUtils.clamp(hsl.l, 0.35, 0.8));
} else {
  achromaticScale = 0.5; // do NOT invent a hue
}
m.parametricRimColorFactor.copy(base).multiplyScalar(opts.rimStrength * achromaticScale);
```
If a material's base colour is genuinely black — a black-texture/black-`litFactor` garment (common: shoes, straps, dark hair accents) — `base` is `[0,0,0]`, `hsl.s` reads `0` (three.js's `Color.getHSL` returns `s=0` exactly for `min===max`, not `NaN`), the achromatic branch fires, and `base` (still `[0,0,0]`) is scaled by `0.5 * rimStrength` — still `[0,0,0]`. R1 fires (it detects the *original* rim as near-black and logs an `R1-rim` entry with a nonzero "after" value being computed), but the material's rim colour is left at `[0,0,0]` — exactly the defect R1 exists to fix ("a black rim colour means no rim light at all", line 343). This isn't hypothetical dead code: `lit=[1,1,1]` (white litFactor) is the norm across all three shipped assets' body/cloth materials (verified against `audit-result.json`), so any of those with a near-black base texture would hit this path in production.

Compounding this: neither `mtoonRepair.test.ts` nor `mtoonRepair.assets.test.ts` exercises the achromatic branch (`hsl.s < rimAchromaticThreshold`) at all — the existing tests cover a saturated blue texture, a saturated blue `litFactor`-only fallback, and a face-detail skip, but never a grey/black/white base colour. This is precisely the branch the MTOON-03 fix comment calls out as safety-critical ("do NOT invent a hue... e.g. red"), and it currently ships with no regression protection.
**Fix:** Give the achromatic branch a lightness floor so a genuinely-dark material still gets a *visible* (if desaturated) rim, e.g. `base.setHSL(hsl.h, hsl.s, Math.max(hsl.l, 0.3))` before scaling, and add a unit test with `material.color = new THREE.Color(0,0,0)` / no map asserting the resulting rim is not still `[0,0,0]`.

### WR-03 [RESOLVED e758625]: `setMToonDebugMode`'s parameter type isn't reachable by external consumers of `@khaveeai/react`

**File:** `packages/react/src/utils/mtoonRepair.ts:407`, `packages/react/src/utils/renderQuality.tsx:24-38`, `packages/react/src/index.ts:11-29`
**Issue:** `setMToonDebugMode(root, mode: MToonMaterialDebugMode)` is now publicly exported from `@khaveeai/react` (via `renderQuality.tsx` → `index.ts`), but `MToonMaterialDebugMode` itself — the enum needed to call it — is never re-exported. `@pixiv/three-vrm` is a `dependency` (not a `peerDependency`) of `@khaveeai/react` (`packages/react/package.json`), so under pnpm's strict, non-hoisted `node_modules` layout, a consuming app that has *not itself* listed `@pixiv/three-vrm` in its own `package.json` cannot resolve `import { MToonMaterialDebugMode } from "@pixiv/three-vrm"` — the package exists somewhere in the pnpm store but is not a direct dependency of the consumer, so plain Node/TS module resolution will fail for it (`Cannot find module '@pixiv/three-vrm'` or, in npm's flatter hoisting, works only by accident of hoisting order). A consumer who follows the exported API surface literally (`import { setMToonDebugMode } from "@khaveeai/react"`) has no supported way to construct a valid `mode` argument without adding an undeclared transitive dependency.
**Fix:** Re-export the enum alongside the function:
```ts
// renderQuality.tsx
export { MToonMaterialDebugMode } from "@pixiv/three-vrm";
```
and add it to `index.ts`'s export list, or accept a plain `"none" | "litShadeRate"` string union in `setMToonDebugMode`'s own signature and map internally, avoiding the external-type leak entirely.

## Info

### IN-01: `RepairOptions` requires every field — no `Partial<RepairOptions>` support for single-field overrides

**File:** `packages/react/src/utils/mtoonRepair.ts:42-77, 287-290`
**Issue:** `repairMToonMaterials(root, opts: RepairOptions = DEFAULT_REPAIR)` takes the full options object, not `Partial<RepairOptions>`. A caller who wants to change just `rimStrength` must manually spread `{...DEFAULT_REPAIR, rimStrength: 0.6}` rather than passing `{rimStrength: 0.6}` — a common ergonomics pattern elsewhere in the codebase (e.g. `RendererDefaultOptions`/`MeshRenderFlagOptions` in the same file's neighbor `renderQuality.tsx` are also fully-required, so this is at least consistent with local convention, but worth flagging since this is new public API).
**Fix:** `export function repairMToonMaterials(root: THREE.Object3D, opts: Partial<RepairOptions> = {}): RepairResult { const merged = { ...DEFAULT_REPAIR, ...opts }; ... }`

### IN-02: `repairMToonMaterials` unconditionally forces `needsUpdate = true` on every non-face MToon material, even when no rule fired

**File:** `packages/react/src/utils/mtoonRepair.ts:387`
**Issue:** `m.needsUpdate = true;` sits outside all the rule `if` blocks, at the end of the per-material callback, so it runs for every material that isn't face-detail-excluded — including materials where none of R1-R5 changed anything (already-correct, well-authored materials). `needsUpdate = true` forces three.js to re-evaluate/recompile the material's shader program on the next render. This is called every time `materialPreset` is applied (mount + every toggle), so a well-authored model (the `3636451243928341470.vrm` non-regression control, 21 materials) pays for a shader recompile check on ~14 untouched materials every single toggle. Not flagged as a bug since it doesn't produce incorrect output, but it's an avoidable invalidation.
**Fix:** Move `m.needsUpdate = true;` inside each rule's `if` block (or track a local `touched` boolean per material and only set it once, at the end, if any rule fired).

### IN-03: R1's log entry doesn't reflect the fresnel-power side effect it can also apply

**File:** `packages/react/src/utils/mtoonRepair.ts:375-384`
**Issue:** When R1 injects a rim colour, it also conditionally raises `parametricRimFresnelPowerFactor` to `opts.fresnelTarget` when it's `< 2` (the "TRAP" comment correctly explains why this is required). However, the `push("R1-rim", before, fmt(...))` call only records the rim-colour before/after — the fresnel-power mutation that happened in the same rule application is invisible in `RepairLogEntry`. A consumer reading `result.log` (e.g. the `mtoon-spike` page's diagnostic panel, which renders `before → after` per entry) sees an incomplete picture of what R1 actually changed on that material.
**Fix:** Either add a second log push for the fresnel side effect, or fold both mutations into one entry's `after` string (e.g. `after: `${fmt(color)} fresnel=${m.parametricRimFresnelPowerFactor}`\`).

### IN-04: Duplicated pixel-averaging loop between the typed-array and canvas-readback paths

**File:** `packages/react/src/utils/mtoonRepair.ts:142-168, 190-208`
**Issue:** The alpha-filtered RGB-averaging loop (iterate 4 bytes at a time, skip `alpha < 128`, divide by count, convert via `THREE.Color.setRGB(..., THREE.SRGBColorSpace)`) is written out twice, once for the raw-typed-array path and once for the canvas-readback path, with only the data source differing. Not a functional bug (both copies are correct and match each other), but a maintenance risk — a future threshold/colour-space fix applied to one copy and not the other would silently diverge.
**Fix:** Extract a shared `averageRGBA(data: ArrayLike<number>): THREE.Color | null` helper and call it from both branches.

---

_Reviewed: 2026-09-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Resolution (2026-09-13)

**WR-02 — FIXED** (`e758625`). Added `RIM_ACHROMATIC_LIGHTNESS_FLOOR = 0.3`,
applied only in the achromatic branch, so a black/near-black base now receives
a visible but deliberately desaturated rim instead of silently staying at
`[0,0,0]`. Kept as a module constant, not a `RepairOptions` field, because
every field of that interface is required and adding one would break callers
constructing it as a literal. Four regression tests added covering the
previously-untested achromatic branch: black base gets a visible rim and its
log entry reflects a real change, mid-grey and white bases stay achromatic
while remaining visible, and the spike-002 fresnel trap still fires on this
path. Confirmed the black-base test fails with the floor at `0` and passes at
`0.3`, so it pins the fix rather than merely describing it.

**WR-03 — FIXED** (`e758625`). Rather than re-exporting the vendor enum,
declared `MToonDebugMode` locally in `mtoonRepair.ts` as
`"none" | "normal" | "litShadeRate" | "uv"`. The vendor "enum" is a const
object over those same string literals, so the local union is structurally
identical and still assigns to `material.debugMode` without mapping — while
keeping the public surface vendor-agnostic per this project's vendor-neutrality
constraint. Exported through `renderQuality.tsx` and `index.ts`; `VRMAvatar`
now passes plain literals, removing the last `@pixiv` debug-enum reference
from the package.

**WR-01 — ACCEPTED, carried forward.** The `shadow` token's over-match causes
*over-exclusion*, which fails safe: an affected material is simply left
unrepaired, never broken. No effect on the three shipped assets. Narrowing the
regex needs evidence from a wider asset set than we currently have, so it is
better done alongside Phase 16's lighting work than guessed at now.

**IN-01 … IN-04 — carried forward.** Ergonomics and efficiency, no correctness
impact. IN-02 (unconditional `needsUpdate`) is the one worth doing first, since
it costs a shader-recompile check per untouched material on every preset toggle.

Post-fix state: `@khaveeai/react` 178/178 (was 174), `openai-stt-tts` 13/13,
`tsc` clean, build clean.
