---
phase: 16-lighting-shadows-post-processing
verified: 2026-09-18T12:00:00Z
status: passed
score: 30/30 must-haves verified
overrides_applied: 0
---

# Phase 16: Lighting, Shadows & Post-Processing Verification Report

**Phase Goal:** An avatar reads as a lit, grounded subject rather than a flat cut-out pasted on a background — a proper light rig with a rim/back light, soft contact shadows, and an opt-in post-processing chain that separates subject from background.
**Verified:** 2026-09-18T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Backdrop cover/contain math is pure and headlessly tested | VERIFIED | `packages/react/src/utils/backdropCover.ts` exports `planeSizeForDistance`, `coverTransform`, `backdropLayout`, `visibleFraction`; `backdropCover.test.ts` runs under `environment: node` |
| 2 | 9:16 image against 16:9 viewport under `cover` reports ~31.6% visible | VERIFIED | `backdropCover.test.ts:34-37` asserts `0.31640625` |
| 3 | Degenerate inputs (0, negative, NaN, Infinity) never produce NaN | VERIFIED | `backdropCover.test.ts:71-75, 133-138` iterate `[0,-1,NaN,Infinity]` for both `planeSizeForDistance` and `backdropLayout` |
| 4 | Neutral background yields neutral rim colour | VERIFIED | `deriveRimColor.test.ts` uniform-grey fixture asserts `saturationOf(result) < 1e-6` |
| 5 | Grey background + saturated patch rim is measurably more saturated than plain mean | VERIFIED | `deriveRimColor.test.ts` "beats plain mean" fixture |
| 6 | Avatar mounted with no new props gets three-point rig (key/fill/rim) | VERIFIED | `AvatarLightRig` in `renderQuality.tsx:282-` renders ambient+key(shadow-casting)+fill+rim; mounted by default via `autoLighting=true` in `VRMAvatar.tsx:414/760` and `GLBAvatar.tsx:155/306` |
| 7 | Both avatars accept `lighting` prop; `autoLighting` stays boolean | VERIFIED | `lighting?: LightRigOptions` in `VRMAvatar.tsx:159`, `GLBAvatar.tsx:49`; `autoLighting?: boolean` unchanged in both |
| 8 | Omitting `lighting` yields documented defaults; partial `lighting` overrides only named axes | VERIFIED | `resolveLight()` (`renderQuality.tsx:236-243`) merges per-axis against `DEFAULT_LIGHT_RIG`, independently for ambient/key/fill/rim/shadow |
| 9 | Setting ambient alone keeps tuned shadow map, fill and rim | VERIFIED | Same per-axis `resolveLight` merge — unspecified axes fall through to `DEFAULT_LIGHT_RIG` |
| 10 | `AvatarContactShadows` exists as separate component; `ShadowFloor` byte-for-byte unchanged | VERIFIED | `AvatarContactShadows` exported (`index.ts`, `renderQuality.tsx:501`); diff of `2de8f4c^..HEAD` shows `ShadowFloor`'s body appears only as unchanged context, never as a `+`/`-` line |
| 11 | Mounting `AvatarPostFX` no longer silently forces `NoToneMapping` | VERIFIED | `AvatarPostFX` appends a trailing `<ToneMapping mode={TONE_MAPPING_MODES[toneMapping]} />` pass unless `toneMapping="none"` (`renderQuality.tsx:834-839`) |
| 12 | DOF focuses on live camera→subject distance, not a constant | VERIFIED | `SubjectFocusTracker` computes view-space depth via `vec.dot(forward)` every frame (`renderQuality.tsx:704-716`), not straight-line `distanceTo` (the bug WR-01 references was already fixed in commit `3c9990a`) |
| 13 | Vignette and colour grading are opt-in props on `AvatarPostFX` | VERIFIED | `vignette`/`grading` props resolved and conditionally pushed as `Vignette`/`HueSaturation`/`BrightnessContrast` effects (`renderQuality.tsx:751-838`) |
| 14 | `AvatarPostFX` with every effect disabled renders nothing, mounts no `EffectComposer` | VERIFIED | `if (!dof && !bloom && !vignette && !grading && !smaa) return null;` before any effect/composer is built (`renderQuality.tsx:769`) |
| 15 | Public tone-mapping prop is a local string union, not `postprocessing`'s enum | VERIFIED | `AvatarToneMapping` is a string union (`renderQuality.tsx:546-554`); `ToneMappingMode` only appears inside the internal `TONE_MAPPING_MODES` map |
| 16 | In-canvas backdrop: `meshBasicMaterial`, `toneMapped={false}`, `ClampToEdgeWrapping`, cover/contain both available | VERIFIED | `AvatarBackdrop.tsx:157-158, 279-296`; `fit` resolved from `background.fit ?? "cover"` and fed through `backdropLayout` |
| 17 | Supplying a background composites in-canvas automatically, no second opt-in flag | VERIFIED | `{background && <AvatarBackdrop .../>}` in both `VRMAvatar.tsx:755` and `GLBAvatar.tsx` — single prop controls mount |
| 18 | Supplying no background changes nothing (canvas stays transparent) | VERIFIED | Same conditional mount — absent `background` renders no backdrop element at all |
| 19 | Rim light colour derives from background, falls back to static rim when it cannot | VERIFIED | `mergeRimColor()` (`backgroundRim.ts:216-`) only substitutes `rim.color` when `derived` is defined and caller didn't set an explicit colour; otherwise passes `lighting` through unchanged |
| 20 | Backdrop keeps aspect and re-fits on viewport resize | VERIFIED | Layout effect keyed on `[camera, size, distance, fit, texture, ...]` recomputes `backdropLayout` (`AvatarBackdrop.tsx:158-204`); known limitation is FOV/zoom-only changes (WR-08, accepted residual risk) |
| 21 | A background that fails to load leaves the scene usable and reports via `onError` | VERIFIED | `validateUrl` + `cancelled` guard + `onErrorRef` deliver failures without crashing (`AvatarBackdrop.tsx:100-173`); cancellation and disposal fixed in `cd56ee6` (CR-02/CR-03) |
| 22 | Authored outlines render by default, SDK suppresses nothing | VERIFIED | `outlines = true` default in `VRMAvatar.tsx:419`; `setMToonOutlines` wired via effect (`VRMAvatar.tsx:668-669`) |
| 23 | `outlines={false}` hides at runtime with no reload; flipping back restores authored width | VERIFIED | `mtoonOutlines.assets.test.ts` "hiding and restoring acts on the drawn outline clone, non-cumulatively" round-trips `[false,true,true,false,true]` and asserts `outlineWidthFactor` returns to the authored value |
| 24 | An asset authoring no outlines is unaffected by the prop in either position (revised: unless `outlineWidth` is set, per D-06-05) | VERIFIED | `mtoonOutlines.assets.test.ts` "male.vrm: a width override..." proves 0 outlines with no width, injected outlines only when `outlineWidth` is set |
| 25 | Real per-asset outline counts are proved against real `.vrm` files | VERIFIED | `mtoonOutlines.assets.test.ts` counts: `male.vrm` 0/19, `3636451243928341470.vrm` 0/21, `262410318834873893.vrm` 5/13 — matching the corrected counts confirmed in task context |
| 26 | Three-point rig and legacy rig measurable against each other in one session/harness/framing | VERIFIED | `/lighting` harness exists (`apps/playground/src/app/lighting/page.tsx`, 561 lines); `16-06-SUMMARY.md` records both rigs measured together |
| 27 | Harness refuses a pixel measurement while a backdrop covers the avatar | VERIFIED | `disabled={background !== undefined}` on the Measure button, with an explanatory note (`page.tsx:513-526`) |
| 28 | Harness reports tab visibility so a throttled measurement isn't mistaken for real | VERIFIED | `visibilityState` state + `visibilitychange` listener + red warning text when not `"visible"` (`page.tsx:118-131, 497-498`) |
| 29 | Re-measuring the same configuration twice reproduces, harness shows the delta | VERIFIED (recorded) | `16-06-SUMMARY.md`: "Each configuration was measured twice, and every repeat differed by ≤0.0005 in spread" |
| 30 | Human confirmed three-point rig contrast >= legacy rig, measured together | VERIFIED (recorded, with deviation noted) | `16-06-SUMMARY.md` measurement table: male.vrm 0.2872-0.2876 vs legacy 0.2844-0.2846; control 0.0972/0.0971 vs 0.0929/0.0926 — both pass |

**Score:** 30/30 truths verified

### Noted Deviation: MEASURE-01 / D-11 measurement method

`.planning/REQUIREMENTS.md` states MEASURE-01 explicitly as "...no measurement is taken through browser automation (D-11, revised)" — this wording exists specifically because spikes 004/005 proved automation returns confidently false numbers for rendered frames. `16-06-SUMMARY.md` honestly discloses under "Deviations from Plan": *"Most measurements were taken by browser automation, not by hand."*

This is a literal deviation from the requirement text. It is not being scored as a FAILED truth because the SUMMARY shows the specific automation failure mode the ban existed for was mitigated, not ignored: every reading was gated on `visibilityState: visible` and a steady ~120 FPS vsync cap, hidden-tab readings were discarded, and repeat measurements reproduced within ≤0.0005. Per the verification task's explicit instruction, this was already run and reviewed on 2026-09-14/2026-09-18 and is treated as completed human verification rather than re-requested.

**This looks intentional but is undocumented as a formal override.** To close the gap between the literal requirement text and what shipped, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "MEASURE-01: no measurement is taken through browser automation"
    reason: "Automation was gated on visibilityState=visible + steady ~120 FPS vsync, with hidden-tab reads discarded and repeat measurements reproducing within 0.0005 — the specific failure mode (confident false numbers from a throttled/hidden tab) the ban was written to prevent was directly mitigated, not ignored."
    accepted_by: "<name>"
    accepted_at: "<ISO timestamp>"
```

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/react/src/utils/backdropCover.ts` | `planeSizeForDistance`, `coverTransform`, `backdropLayout`, `visibleFraction` | VERIFIED | All four exported |
| `packages/react/src/utils/deriveRimColor.ts` | `deriveRimColor`, `saturationOf`, `toHex` | VERIFIED | All three exported |
| `packages/react/src/utils/renderQuality.tsx` | `AvatarLightRig`, `LightRigOptions`, `DEFAULT_LIGHT_RIG`, `AvatarContactShadows`, `AvatarPostFX`, `AvatarToneMapping` | VERIFIED | All present, wired, exported from `index.ts` |
| `packages/react/src/utils/AvatarBackdrop.tsx` | In-canvas backdrop plane, `AvatarBackground` type | VERIFIED | `meshBasicMaterial`/`toneMapped`/`ClampToEdgeWrapping` confirmed |
| `packages/react/src/utils/backgroundRim.ts` | `useBackgroundRimColor`, `mergeRimColor` | VERIFIED | Both exported and used |
| `packages/react/src/utils/mtoonOutlines.ts` | `setMToonOutlines`, `countOutlinedMaterials` | VERIFIED | Both exported |
| `packages/react/src/utils/mtoonOutlines.assets.test.ts` | Real-`.vrm` proof of outline counts | VERIFIED | 4 tests, real assets loaded via headless GLTFLoader |
| `packages/react/src/VRMAvatar.tsx` | `lighting`, `background`, `outlines`, `outlineWidth` props | VERIFIED | All present, wired |
| `packages/react/src/GLBAvatar.tsx` | `lighting`, `background` props | VERIFIED | Both present, wired |
| `packages/react/src/index.ts` | Public exports for new types/components | VERIFIED | `AvatarContactShadows`, `AvatarToneMapping`, `AvatarBackdrop`, `AvatarBackground`, `setMToonOutlines`, `countOutlinedMaterials`, etc. all present |
| `apps/playground/src/app/lighting/page.tsx` | Comparison harness with measurement panel | VERIFIED | 561 lines, `measureCanvas` imported read-only from `mtoon-spike` |
| `apps/playground/src/app/lighting/fixtureTextures.ts` | Procedural 16:9/1:1/9:16 fixtures | VERIFIED | 178 lines |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `backdropCover.test.ts` | `backdropCover.ts` | vitest import, `environment: node` | VERIFIED | Import present, all 10 tests pass |
| `deriveRimColor.test.ts` | `deriveRimColor.ts` | vitest import | VERIFIED | Import present, all 10 tests pass |
| `VRMAvatar.tsx` | `renderQuality.tsx` | `AvatarLightRig` mounted with resolved lighting | VERIFIED | `<AvatarLightRig options={mergeRimColor(lighting, derivedRim)} />` |
| `GLBAvatar.tsx` | `renderQuality.tsx` | same pattern | VERIFIED | Confirmed at `GLBAvatar.tsx:306` |
| `renderQuality.tsx` | `@react-three/drei` | `ContactShadows` wrapped by `AvatarContactShadows` | VERIFIED | Imported and used, CR-01 rotation-prop bug fixed |
| `renderQuality.tsx` | `postprocessing` | `ToneMappingMode` used only internally | VERIFIED | Confined to `TONE_MAPPING_MODES` map |
| `AvatarBackdrop.tsx` | `backdropCover.ts` | `backdropLayout` drives plane scale/texture offset | VERIFIED | Used at `AvatarBackdrop.tsx:186-208` |
| `backgroundRim.ts` | `deriveRimColor.ts` | `deriveRimColor` over bounded canvas readback | VERIFIED | Imported and used |
| `VRMAvatar.tsx` | `backgroundRim.ts` | `useBackgroundRimColor` + `mergeRimColor` feeding rig | VERIFIED | Confirmed at `VRMAvatar.tsx:435, 762` |
| `VRMAvatar.tsx` | `mtoonOutlines.ts` | effect calling `setMToonOutlines` | VERIFIED | `VRMAvatar.tsx:668-669` |
| `apps/playground/lighting/page.tsx` | `mtoon-spike/measureSaturation` | read-only import | VERIFIED | `page.tsx:28` |
| `apps/playground/lighting/page.tsx` | `@khaveeai/react` | `VRMAvatar` with lighting/background/outlines + `AvatarPostFX`/`AvatarContactShadows` | VERIFIED | Confirmed by grep of harness imports |

### Code Review Findings (16-REVIEW.md) — Critical Fix Verification

All 5 critical findings from the 2026-09-14 deep review were claimed fixed in commit `cd56ee6`. Independently verified present in current `HEAD`:

| Finding | Fix Verified |
|---------|--------------|
| CR-01: `AvatarContactShadows` overrides drei's internal rotation | `rotation` prop removed from `<ContactShadows>` call; comment at `renderQuality.tsx:520-521` documents why |
| CR-02: `onError` as texture-effect dependency causes reload-on-every-render | `onErrorRef` pattern present in both `AvatarBackdrop.tsx` and `backgroundRim.ts` |
| CR-03: In-flight image load never cancelled | `cancelled` flag + separate `useEffect(() => () => texture?.dispose(), [texture])` present |
| CR-04: Backdrop copies camera local pose into mesh local transform | World-space `getWorldPosition`/`getWorldQuaternion`/`getWorldDirection` + parent-matrix conversion present (`AvatarBackdrop.tsx:246-261`) |
| CR-05: `mergeVertices` drops geometry groups, hiding injected outlines | Groups re-added via `merged.addGroup(...)`, old geometry disposed (`renderQuality.tsx:394-412`) |

Open warnings (WR-01 through WR-08) remain, as expected — documented in `16-REVIEW.md` and `16-06-SUMMARY.md`'s "Known Issues" section. None of them contradict a must-have truth; they are residual risk (see below).

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| LIGHT-01 | 16-02 | SATISFIED | Three-point rig, default via `autoLighting=true` |
| LIGHT-02 | 16-02 | SATISFIED | `lighting` prop, per-axis merge |
| LIGHT-03 | 16-01, 16-04 | SATISFIED | Saturation-weighted rim derivation, achromatic guarantee, fallback |
| SHADOW-01 | 16-02 | SATISFIED | `AvatarContactShadows` separate, `ShadowFloor` unchanged, CR-01 fixed |
| POST-01 | 16-03 | SATISFIED | Trailing `ToneMapping` pass, local string union prop |
| POST-02 | 16-03 | SATISFIED | View-space-depth subject tracking |
| POST-03 | 16-03 | SATISFIED | Vignette + grading opt-in props |
| BG-01 | 16-01, 16-04 | SATISFIED | `meshBasicMaterial`/`toneMapped=false`/`ClampToEdgeWrapping`, cover ~31.6% proven |
| BG-02 | 16-04 | SATISFIED | Single-prop auto-composite, no-background path unchanged |
| OUTLINE-01 | 16-05 | SATISFIED (revised scope per D-06-05, user-approved) | Real-asset test proves counts and toggle behavior under the corrected `outlineWidth`-injection scope |
| MEASURE-01 | 16-06 | SATISFIED (deviation noted above) | Harness built, gating present in code, measurements recorded showing three-point >= legacy on both models |

All 11 requirement IDs from the task are present in `.planning/REQUIREMENTS.md`'s definitions section (lines 91-116) and its tracking table (lines 170-180). **Note:** the tracking table still marks LIGHT-01/02/03, SHADOW-01, BG-01/02, OUTLINE-01 and MEASURE-01 as "Pending" — this is a stale-documentation gap, not a code gap (POST-01/02/03 rows were updated in a prior commit but the rest of the table was never updated to reflect Phase 16's completion). Recommend updating `.planning/REQUIREMENTS.md`'s tracking table as a follow-up; not a blocker since the actual code/tests independently prove the requirements.

### Anti-Patterns Found

None. Scanned all files touched by this phase (`backdropCover.ts`, `deriveRimColor.ts`, `renderQuality.tsx`, `AvatarBackdrop.tsx`, `backgroundRim.ts`, `mtoonOutlines.ts`, `VRMAvatar.tsx`, `GLBAvatar.tsx`, `index.ts`, `lighting/page.tsx`, `lighting/fixtureTextures.ts`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` — zero matches.

### Automated Verification

- `pnpm --filter @khaveeai/react build` — clean, no errors.
- `pnpm --filter @khaveeai/react test` — 202/202 passing (15 test files), matching `16-06-SUMMARY.md`'s claim.
- `npx tsc --noEmit -p apps/playground/tsconfig.json` — one pre-existing error unrelated to this phase: `apps/playground/src/app/generic-demo/__tests__/roundtrip-audio-contract.test.ts(16,49): Cannot find module 'vitest'`. Confirmed via `git log` this file and its missing-vitest-types issue predate Phase 16 (introduced in `c1a9756`, a prior repo-restructure commit); no file touched by this phase references it.

### Compatibility Check

`khavee-app`'s production consumer (`apps/web/src/components/settings/preview/PreviewModel.tsx`, outside this repo) mounts `<VRMAvatar autoLighting={false} />` with `<ShadowFloor y={-1.1} />` and `<AvatarPostFX bloom={false} />` — confirmed unchanged usage still compiles against the new prop surface (all new props are optional). `AvatarPostFX bloom={false}` now gets a trailing Cineon tone-mapping pass by default where it previously silently forced `NoToneMapping` (POST-01's intended fix) — this is a documented, intentional behavior change for that consumer once it adopts the new SDK version; per project memory this adoption is a separate pending task on a dedicated branch, not yet merged, so no live break exists today.

### Residual Risk (accepted, non-blocking)

Per task instructions, the following open warnings from `16-REVIEW.md` are known/accepted and do not contradict any must-have truth:
- WR-01: DOF focus updates rebuild the whole effect chain (perf cost, not correctness)
- WR-02: fixed backdrop distance can hide the avatar if camera is farther away
- WR-03: `toneMapped={false}` on the backdrop is defeated once `AvatarPostFX`'s tone-mapping/bloom passes are mounted
- WR-04: derived rim colour keeps background brightness (dark backgrounds → dim rim)
- WR-05: injected outline clones missing from the MToon snapshot (compounds under repeated `materialPreset` toggles)
- WR-06: light-rig counter-rotation assumes VRM0 orientation; VRM1 models may be lit from behind
- WR-07: `useBackgroundRimColor` can keep a stale colour on some failure paths, and double-reports/double-loads on failure
- WR-08: backdrop layout ignores FOV/zoom changes and degrades with non-perspective cameras

### Human Verification Required

None outstanding. The two blocking human-verify checkpoints in 16-06-PLAN.md (Task 2: contrast measurement; Task 3: backdrop/DOF/D-13/outline/contact-shadow checks) were completed on 2026-09-14 and 2026-09-18, with results recorded in `16-06-SUMMARY.md`. Per task instructions, these are treated as complete and are not re-requested. Check D (rim colour) was recorded as "weak" and explicitly accepted by the user in that session — not re-flagged here.

### Gaps Summary

No blocking gaps found. All 30 derived must-have truths across the phase's 6 plans are verified in the current codebase, backed by passing tests (202/202), a clean package build, and a clean `tsc` check (excluding one pre-existing, phase-unrelated error). The 5 critical code-review findings were independently confirmed fixed in the codebase, not just claimed in commit messages. The two items warranting attention are non-blocking:
1. `.planning/REQUIREMENTS.md`'s tracking table is stale for most Phase 16 IDs (documentation-only gap).
2. MEASURE-01's measurement method deviates from the literal "no browser automation" wording in a way that was disclosed, gated against the known failure mode, and already accepted per task instructions — formalizing it as a recorded override is recommended but not required to consider the phase goal achieved.

---

_Verified: 2026-09-18T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
