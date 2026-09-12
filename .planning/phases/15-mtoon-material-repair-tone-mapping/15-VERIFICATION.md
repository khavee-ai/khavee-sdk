---
phase: 15-mtoon-material-repair-tone-mapping
verified: 2026-09-12T17:13:34Z
status: passed
score: 8/8 success criteria verified (5 human sign-off, 3 code-verified)
overrides_applied: 0
---

# Phase 15: MToon Material Repair & Tone Mapping Verification Report

**Phase Goal:** Every VRM avatar renders with correct toon shading out of the box — MToon values an artist got wrong are repaired automatically, well-authored models are left untouched, and the renderer's tone curve stops eating the saturation toon shading depends on.

**Verified:** 2026-09-12T17:13:34Z
**Status:** passed
**Re-verification:** No — initial verification

## Method

Per the dispatch instructions, criteria 1, 2, 4, 5, 7 were already signed off by the user via live human verification on 2026-09-12 (`15-04-SUMMARY.md`) and are treated as authoritative — not re-judged here. This report focuses verification effort on criteria 3, 6, 8, independently re-derives every automated-test claim (does not trust SUMMARY.md prose), and traces the CONTEXT.md locked decisions against the actual `mtoonRepair.ts` source.

All test suites below were re-run independently in this session (not copy-pasted from SUMMARY.md):

| Suite | Command | Result |
|---|---|---|
| `@khaveeai/react` | `pnpm test` (packages/react) | 174/174 passed — confirmed independently |
| `openai-stt-tts` | `npx vitest run` (packages/providers/openai-stt-tts) | 13/13 passed — confirmed independently |
| `@khaveeai/core` | `npx vitest run` (packages/core) | 10/10 passed — confirmed independently (unrelated to this phase, spot-checked only) |
| `packages/react` build | `npx tsc --noEmit` | Clean, 0 errors |
| playground build | `pnpm --filter @khaveeai/playground exec tsc --noEmit` | Exactly one error: `generic-demo/__tests__/roundtrip-audio-contract.test.ts` missing `vitest` types — confirmed pre-existing (file untouched by this phase's diff; `git diff --stat aadb9b1..HEAD` shows zero changes under `generic-demo/`) |

## Goal Achievement

### Observable Truths / Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `male.vrm` no-props mount: hair shading, visible rim, toon-width ramp | ✓ VERIFIED (human, authoritative) | `15-04-SUMMARY.md` recorded PASS, 2026-09-12. Not re-judged. |
| 2 | Well-authored control judged unchanged (7/21 materials modified) | ✓ VERIFIED (human, authoritative) | `15-04-SUMMARY.md` recorded PASS, 2026-09-12. Not re-judged. |
| 3 | No face-detail material ever modified — proven by automated test against real `.vrm` assets | ✓ VERIFIED (code) | `packages/react/src/utils/mtoonRepair.assets.test.ts` loads `male.vrm`, `3636451243928341470.vrm`, `262410318834873893.vrm` through the **full** `VRMLoaderPlugin` headlessly (texture-decode stubbed only, MToon materials real) and asserts `FACE_DETAIL_MATERIAL_RE` never matches a repaired material's name across all three assets, with an `mtoonCount` canary (19/21/18) proving the loader isn't silently degrading to the materials-skipping variant. Re-ran independently: 5/5 tests in this file pass, including this one, in 1103ms (not a stub — asserts against real per-material data, `expect(leaked).toEqual([])`). |
| 4 | Injected rim carries own hue, repair ON not less saturated than OFF | ✓ VERIFIED (human, authoritative) | `15-04-SUMMARY.md` recorded PASS, 2026-09-12. Not re-judged. Code path (`averageTextureColor` × `m.color`, HSL saturation boost) inspected and matches CONTEXT.md's locked rim-tint-source decision (see below). |
| 5 | `materialPreset="off"` restores authored values live, no reload; defaults to `"repair"` | ✓ VERIFIED (human, authoritative + code) | `15-04-SUMMARY.md` recorded PASS. Code confirms non-cumulative toggle: `VRMAvatar.tsx` snapshot effect (declared first) populates `mtoonSnapshotRef` before the apply-preset effect reads it; apply effect always calls `restoreMToon` before conditionally calling `repairMToonMaterials`, and `materialPreset = "repair"` is the parameter default. |
| 6 | Default renderer tone mapping is `THREE.CineonToneMapping`; `toneMapping` prop still overrides it | ✓ VERIFIED (code) | `packages/react/src/VRMAvatar.tsx:428`: `toneMapping: toneMapping ?? THREE.CineonToneMapping` — nullish-coalescing means an explicit `toneMapping` prop from any caller (including khavee-app's `autoLighting={false}` mount, per CONTEXT.md's explicit downstream-impact note) always wins over the new default. `GLBAvatar.tsx` confirmed unchanged: still `toneMapping ?? THREE.ACESFilmicToneMapping`, per the phase's explicit out-of-scope decision for `happy.glb`'s plain-PBR path. |
| 7 | `debugShading` renders MToon's `litShadeRate` view | ✓ VERIFIED (human, authoritative) | `15-04-SUMMARY.md` recorded PASS, 2026-09-12. Code confirms wiring: `setMToonDebugMode(scene, debugShading ? MToonMaterialDebugMode.LitShadeRate : MToonMaterialDebugMode.None)` driven by a dedicated effect in `VRMAvatar.tsx`. |
| 8 | `openai-stt-tts` and every current `VRMAvatar`/`GLBAvatar` consumer continue to work unchanged | ✓ VERIFIED (code) | `git diff --stat aadb9b1..HEAD -- packages/providers/` returns **empty** — zero provider-package files touched. `openai-stt-tts` full suite re-run independently: 13/13 passed. Every other app consumer of `VRMAvatar`/`GLBAvatar` (`components/Experience.tsx`, `components/VRMAvatarRef.tsx`, `openai-avatar-test/page.tsx`, `xai/page.tsx`, `generic-demo/page.tsx`, `animation-test/page.tsx`, `glb-avatar-test/page.tsx`) shows **zero diff** in `git diff --stat aadb9b1..HEAD`, i.e. they were not touched and did not need to be touched. `VRMAvatarProps`/`GLBAvatarProps` diff shows only two new *optional* props added (`materialPreset`, `debugShading`, both defaulted) — no removed, renamed, or newly-required props, no changed semantics for `toneMapping`/`autoLighting`/any pre-existing prop. `materialPreset` defaulting to `"repair"` changes default *rendered output* by design (intended, human-approved via criterion 2), not the API contract. |

**Score:** 8/8 success criteria verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/react/src/utils/mtoonRepair.ts` | R1-R5 repair pass, face-detail classifier, snapshot/restore, debug setter | ✓ VERIFIED | 414 lines; exports `repairMToonMaterials`, `snapshotMToon`, `restoreMToon`, `setMToonDebugMode`, `averageTextureColor`, `DEFAULT_REPAIR`, `FACE_DETAIL_MATERIAL_RE` plus types — all present and substantive (inspected full rule bodies, not stubs). |
| `packages/react/src/utils/mtoonRepair.test.ts` | Synthetic chromatic-rim proof | ✓ VERIFIED | 111 lines, 7 tests, asserts exact hex colours against `DataTexture` fixtures — not placeholder assertions. |
| `packages/react/src/utils/mtoonRepair.assets.test.ts` | Headless real-asset regression suite | ✓ VERIFIED | 294 lines, 5 tests against real committed `.vrm` files via full `VRMLoaderPlugin`; re-ran independently, all pass. |
| `packages/react/src/utils/renderQuality.tsx` | Re-export surface | ✓ VERIFIED, WIRED | `export { repairMToonMaterials, snapshotMToon, restoreMToon, setMToonDebugMode, ... } from "./mtoonRepair"`. |
| `packages/react/src/index.ts` | Public export of repair API | ✓ VERIFIED, WIRED | `repairMToonMaterials` and siblings re-exported publicly; consumed externally by `apps/playground/src/app/mtoon-spike/page.tsx` via `from "@khaveeai/react"`. |
| `packages/react/src/VRMAvatar.tsx` | `materialPreset`/`debugShading` props, Cineon default, repair/restore effects | ✓ VERIFIED, WIRED | All present; effect ordering verified correct (snapshot before apply). |
| `packages/react/src/GLBAvatar.tsx` | Documented rationale, ACESFilmic retained | ✓ VERIFIED | Comment present; tone-mapping default unchanged (confirmed via diff, not just comment). |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `renderQuality.tsx` | `mtoonRepair.ts` | re-export | ✓ WIRED |
| `index.ts` | `renderQuality.tsx` | public barrel export | ✓ WIRED |
| `mtoonRepair.ts` | `@pixiv/three-vrm` | `instanceof MToonMaterial` narrowing | ✓ WIRED (`forEachMToon` helper) |
| `mtoonRepair.assets.test.ts` | `apps/playground/public/models/*.vrm` | relative `fileURLToPath` resolution | ✓ WIRED (test passes, loads real committed assets) |
| `VRMAvatar.tsx` | `renderQuality.tsx` (repair/restore/setMToonDebugMode) | import | ✓ WIRED |
| `VRMAvatar.tsx` | `THREE.CineonToneMapping` | `toneMapping ?? THREE.CineonToneMapping` | ✓ WIRED |
| `apps/playground/src/app/mtoon-spike/page.tsx` | `@khaveeai/react` | import of repair API | ✓ WIRED (repointed, duplicate `repairMToon.ts` deleted — confirmed via `git diff --stat`, file no longer exists) |
| `apps/playground/src/app/vrm-avatar-test/page.tsx` | `VRMAvatar` `materialPreset`/`debugShading` props | live control bindings | ✓ WIRED (`materialPreset={materialPreset}`, `debugShading={debugShading}` on the real component) |

### Locked Decisions (CONTEXT.md) — Honored Check

| Decision | Honored? | Evidence |
|---|---|---|
| Pass semantics: repair, not override | ✓ | Each rule only fires on a specific out-of-spec condition (R5 out-of-range, R4 ≥0.5 shift, R3 < toonyFloor, R2 > fresnelMax, R1 near-black rim); no unconditional overwrite. |
| `materialPreset` default `"repair"` | ✓ | `materialPreset = "repair"` parameter default in `VRMAvatar.tsx`. |
| Threshold basis: runtime MToon values, never raw file values | ✓ | All rule conditions read live `MToonMaterial` instance fields post-parse (`m.shadingToonyFactor`, etc.), not file JSON. |
| Face-detail materials never touched, exclusion runs before any rule | ✓ | `if (FACE_DETAIL_MATERIAL_RE.test(m.name)) { skippedFaceDetail++; return; }` is the first statement in the per-material callback, before any rule; proven on real assets by `mtoonRepair.assets.test.ts`. |
| Rim injection raises fresnel power when < 2 | ✓ | `if (m.parametricRimFresnelPowerFactor < 2) { m.parametricRimFresnelPowerFactor = opts.fresnelTarget; }` inside R1. |
| Rim tint source: base texture average, not `litFactor` | ✓ | `averageTextureColor(m.map)` sampled and multiplied by `m.color`, with a documented fallback to `m.color` alone only when there's no map. |
| Tone mapping default: `THREE.CineonToneMapping` | ✓ | Confirmed in `VRMAvatar.tsx`. |
| `NoToneMapping` not offered as default | ✓ | Not referenced anywhere as a default; `toneMapping` prop remains open `THREE.ToneMapping` type, caller's choice. |
| Multiply-texture slots skip a rule when present | ✓ | R4 guarded by `!m.shadingShiftTexture`; R1 guarded by `!m.rimMultiplyTexture`. |
| `openai-stt-tts`/existing consumers keep working | ✓ | See criterion 8 above. |
| `GLBAvatar`/`happy.glb` out of scope, unchanged tone curve | ✓ | Confirmed, ACESFilmic retained. |

### Requirements Coverage

**Note on traceability:** `.planning/REQUIREMENTS.md` is the v2.2 "Natural Avatar Animation" milestone document and has not been updated for the v3.1 "Avatar Render Quality" milestone — it contains no `MTOON-*`/`TONE-01`/`TEST-01` entries at all (confirmed via `grep`). Per `CONTEXT.md`, this phase's requirements were not gathered via `/gsd:discuss-phase` and are recorded directly in `ROADMAP.md`'s Phase 15 section instead, which does contain full descriptions and Success Criteria for every ID below. Traceability is verified against `ROADMAP.md` as the authoritative source for this phase; this is a pre-existing project documentation gap (stale `REQUIREMENTS.md` for the new milestone), not a phase defect — flagged as an info-level gap in requirements-doc hygiene, not blocking.

| Requirement | Source Plan(s) | Description (from ROADMAP.md) | Status | Evidence |
|---|---|---|---|---|
| MTOON-01 | 15-01, 15-03, 15-04 | Repair pass (R1-R5) exists as SDK code | ✓ SATISFIED | `mtoonRepair.ts` |
| MTOON-02 | 15-01, 15-02 | Face-detail exclusion | ✓ SATISFIED | Regex + assets test |
| MTOON-03 | 15-01, 15-04 | Chromatic rim from base texture | ✓ SATISFIED | `averageTextureColor` + unit test |
| MTOON-04 | 15-03, 15-04 | `materialPreset` prop, zero-config default | ✓ SATISFIED | `VRMAvatar.tsx` |
| MTOON-05 | 15-03, 15-04 | `debugShading` prop | ✓ SATISFIED | `VRMAvatar.tsx` |
| TONE-01 | 15-03, 15-04 | Cineon default tone mapping | ✓ SATISFIED | `VRMAvatar.tsx` |
| TEST-01 | 15-02, 15-04 | Automated real-asset proof | ✓ SATISFIED | `mtoonRepair.assets.test.ts` |

No orphaned requirements: all 7 IDs declared across the phase's plans are accounted for and satisfied.

### Anti-Patterns Found

Carried forward from `15-REVIEW.md` (0 critical, 3 warning, 4 info) — re-confirmed present in the current code, not newly discovered, and none rise to blocker per this verification's own reading of the source:

| File | Pattern | Severity | Impact |
|---|---|---|---|
| `mtoonRepair.ts:26-27` (`FACE_DETAIL_MATERIAL_RE`) | Bare `shadow` token can exclude legitimate non-face materials (e.g. `Body_ShadowMap`) on **future, untested** `.vrm` uploads | ⚠️ Warning (WR-01, pre-existing) | No effect on the three shipped/tested assets (confirmed dead weight there); risk is scoped to future arbitrary uploads, not this phase's shipped models. |
| `mtoonRepair.ts:346-385` | R1's achromatic branch (`hsl.s < rimAchromaticThreshold`) is a silent no-op for genuinely black base materials (black stays black × 0.5 = black), and has **zero test coverage** | ⚠️ Warning (WR-02, pre-existing) | Independently re-confirmed by reading the code: `achromaticScale = 0.5` scaling a `[0,0,0]` base still yields `[0,0,0]`. Not exercised by either test file (`mtoonRepair.test.ts` covers saturated-blue and no-map cases only; `mtoonRepair.assets.test.ts` cannot exercise it under the headless texture stub). Does not affect the human-verified criteria 1/2/4 (none of the three shipped assets' rim-firing materials are genuinely black — the tested/verified case is white-litFactor + saturated texture). |
| `mtoonRepair.ts:407`, `index.ts` | `MToonMaterialDebugMode` (needed to call the now-public `setMToonDebugMode`) is not re-exported from `@khaveeai/react` | ⚠️ Warning (WR-03, pre-existing) | Confirmed: `grep MToon packages/react/src/index.ts` shows the function exported, not the enum. An external consumer following the documented public API literally cannot construct a valid `mode` argument without an undeclared transitive dependency on `@pixiv/three-vrm`. Does not affect `VRMAvatar`'s own `debugShading` prop (uses the enum internally, string-free at the public prop level) — only affects direct standalone use of `setMToonDebugMode`. |
| `apps/playground` | ESLint cannot load its parser (`eslint-config-next` / `next/dist/compiled/babel/eslint-parser` missing) | ℹ️ Info (environment, pre-existing, unrelated to phase files) | `lint` is unverifiable, not passing — confirmed via `deferred-items.md` and not re-run here since it is a pnpm-hoisting gap, not a code issue. Reported honestly as unverified coverage. |

None of the above are newly introduced by this verification pass; all were already surfaced by `15-REVIEW.md` and are being carried forward for completeness per the dispatch's request to factor review warnings into the assessment. WR-02 in particular ("untested code path") was explicitly flagged by the dispatch — confirmed real, confirmed non-blocking for the phase's shipped assets and human-verified criteria, and worth a follow-up fix (per REVIEW.md's own suggested fix) but does not fail the goal as stated ("well-authored models are left untouched" and "MToon values an artist got wrong are repaired automatically" — a black-on-black rim edge case on a hypothetical future asset is neither of the three assets this phase was scoped and verified against).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Repair pass finds real MToon materials, not degraded loader | `pnpm test` in `packages/react` (`mtoonCount` canary) | 19/21/18 exact match | ✓ PASS |
| Face-detail exclusion holds on real assets | Same suite, `never modifies a face-detail material` test | 0 leaked materials across 3 assets | ✓ PASS |
| Restore is exact | Same suite, `restores every snapshotted field exactly` | All 4 fields match post-restore, incl. hex-equal rim colour | ✓ PASS |
| `openai-stt-tts` unaffected | `npx vitest run` in that package | 13/13 | ✓ PASS |
| Playground compiles (mod. pre-existing unrelated error) | `tsc --noEmit` | 1 pre-existing error only | ✓ PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` probes; it uses vitest suites, which were executed directly above.

### Human Verification Required

None new. All human-gated success criteria (1, 2, 4, 5, 7) were already signed off 2026-09-12 per `15-04-SUMMARY.md` and are treated as authoritative per the dispatch instructions — not re-litigated.

### Gaps Summary

No blocking gaps found. The phase goal — automatic MToon repair that leaves well-authored models untouched, plus a toon-appropriate tone curve default with a working override — is achieved and verified both by code inspection/independent test execution (criteria 3, 6, 8) and by the already-recorded human sign-off (criteria 1, 2, 4, 5, 7).

Three pre-existing code-review warnings (WR-01 regex over-match, WR-02 untested achromatic branch, WR-03 unexported enum) remain open in the codebase. None affect the three shipped `.vrm` assets or the human-verified criteria; they are edge cases surfaced against future/hypothetical inputs or external-consumer ergonomics. Recommended as follow-up cleanup work, not as a blocker to this phase's goal or to proceeding to Phase 16.

The `REQUIREMENTS.md` vs `ROADMAP.md` traceability gap (stale v2.2 doc, no v3.1 entries) is a pre-existing project-process gap that predates this phase and should be flagged for the person maintaining `REQUIREMENTS.md`, not treated as a Phase 15 defect.

---

_Verified: 2026-09-12T17:13:34Z_
_Verifier: Claude (gsd-verifier)_
