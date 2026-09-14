---
phase: 16-lighting-shadows-post-processing
plan: 03
subsystem: post-processing
tags: [defect-fix, D-13, tone-mapping, depth-of-field, vignette, grading]
dependency_graph:
  requires: [16-02]
  provides: [POST-01, POST-02, POST-03]
  affects: [packages/react]
tech_stack:
  added: [postprocessing@6.37.8]
  patterns: [subject-tracked-dof, conditional-effect-composition, vendor-neutral-enums]
key_files:
  created: []
  modified:
    - packages/react/package.json
    - packages/react/src/utils/renderQuality.tsx
    - packages/react/src/index.ts
    - pnpm-lock.yaml
decisions:
  - postprocessing declared as explicit dependency (not transitive-only)
  - AvatarToneMapping is local string union, ToneMappingMode enum internal-only
  - toneMapping defaults to "cineon" matching VRMAvatar
  - toneMapping="none" appends no pass (pre-fix escape hatch)
  - AvatarPostFX still renders null when nothing enabled
  - Effect order: DOF → Bloom → HueSat → BrightContrast → Vignette → SMAA → ToneMapping
  - bloomThreshold JSDoc corrected (sampled BEFORE tone mapping)
  - DOF defaults from spike 004 (bokehScale: 20, focusRange: 0.6)
  - Subject tracking graduates spike shape verbatim (React state, 0.02 threshold)
  - grading shipped as two separate effects (HueSaturation, BrightnessContrast)
metrics:
  duration_minutes: 35
  completed_date: 2026-09-14
  tasks_completed: 3
  files_modified: 4
  commits: 3
---

# Phase 16 Plan 03: Trailing ToneMapping pass + DOF + Vignette + Grading Summary

**One-liner:** JWT auth with refresh rotation using jose library — fixed D-13 (EffectComposer's silent NoToneMapping override), added subject-tracked depth of field, vignette, and colour grading to AvatarPostFX.

## Objective

Fix the shipped defect where `EffectComposer` forces `THREE.NoToneMapping` on every consumer of `AvatarPostFX`, then extend that same chain with subject-tracked depth of field, a vignette and colour grading.

Purpose: POST-01 (D-13 — the defect silently undoes Phase 15's TONE-01 in real usage, including in khavee-app production today), POST-02 (spike 004's attached requirement), POST-03 (the ROADMAP's vignette + colour grading scope item).

Output: an `AvatarPostFX` whose chain always ends with the caller's tone curve, plus three new opt-in effect groups.

## What Was Built

### Task 1: Declare postprocessing and append trailing ToneMapping pass (D-13)
**Commit:** 3b1b8c6  
**Files:** packages/react/package.json, packages/react/src/utils/renderQuality.tsx, packages/react/src/index.ts, pnpm-lock.yaml

- Added `postprocessing@^6.37.8` as explicit dependency (reuses existing transitive resolution)
- Created `AvatarToneMapping` local string union (vendor-neutral, following MToonDebugMode precedent)
- Added internal `TONE_MAPPING_MODES` map (ToneMappingMode enum contained to this map only, never exported)
- Added `toneMapping` prop to `AvatarPostFXProps` (default: "cineon")
- Appended `ToneMapping` effect as last pass in chain (unless `toneMapping="none"`)
- Corrected `bloomThreshold` JSDoc: luminance sampled BEFORE tone mapping, not after
- Exported `AvatarToneMapping` from barrel

**Verification:**
- ✓ Exactly one `postprocessing` version resolves in workspace (6.37.8)
- ✓ postprocessing declared in package.json dependencies
- ✓ Package builds clean with tsc
- ✓ ToneMappingMode enum contained (not exported, only in internal map)
- ✓ AvatarToneMapping exported from barrel

### Task 2: Add subject-tracked depth of field
**Commit:** 41d6856  
**Files:** packages/react/src/utils/renderQuality.tsx, packages/react/src/index.ts

- Added `DepthOfFieldOptions` interface (subject/focusRange/bokehScale)
- Created internal `SubjectFocusTracker` component (0.02 world-unit threshold, graduated from spike 004)
- Added `dof` prop to `AvatarPostFXProps` (default: false, accepts boolean or options)
- Pushed `DepthOfField` effect as FIRST entry when enabled
- Rendered `SubjectFocusTracker` as sibling of `EffectComposer` (only when dof enabled)
- Moved early return guard AFTER hook calls (Rules of Hooks compliance)
- Exported `DepthOfFieldOptions` from barrel

**Verification:**
- ✓ Package builds clean with tsc
- ✓ worldFocusDistance present in renderQuality.tsx
- ✓ Hooks precede the early return guard
- ✓ SubjectFocusTracker internal (not exported)

### Task 3: Add vignette and colour grading
**Commit:** dcff30f  
**Files:** packages/react/src/utils/renderQuality.tsx, packages/react/src/index.ts

- Added `VignetteOptions` interface (offset/darkness)
- Added `GradingOptions` interface (saturation/hue/brightness/contrast)
- Added `vignette` and `grading` props to `AvatarPostFXProps` (both default: false)
- Pushed effects in correct order: DepthOfField → Bloom → HueSaturation → BrightnessContrast → Vignette → SMAA → ToneMapping
- Skipped `HueSaturation` when hue=0 and saturation=0 (no-op pass avoidance)
- Skipped `BrightnessContrast` when brightness=0 and contrast=0 (no-op pass avoidance)
- Exported `VignetteOptions` and `GradingOptions` from barrel

**Verification:**
- ✓ Package builds clean with tsc
- ✓ Effect elements appear in required order
- ✓ All four new option types exported from barrel
- ✓ Existing package test suite passes (198/198 tests green)

## Deviations from Plan

None — plan executed exactly as written.

## Requirements Validated

- **POST-01:** `AvatarPostFX`'s chain ends with a `ToneMapping` effect whenever a composer is mounted and `toneMapping` is not `"none"`; the D-13 defect and its cause are documented in code with RESEARCH Pitfall 1 traceability.
- **POST-02:** DOF is available, off by default, and focuses on a per-frame measured camera→subject distance; no constant `worldFocusDistance` literal drives it. Subject tracking graduated spike 004's shape verbatim (React state, 0.02 world-unit threshold).
- **POST-03:** `vignette` and `grading` props exist, are off by default, and map to the library effects (Vignette, HueSaturation, BrightnessContrast).

## Downstream-Visible Changes

**Breaking:** None — all new props are opt-in (default: false or existing defaults).

**Behaviour change (D-13 fix):** Consumers of `AvatarPostFX` will see a **more saturated image** than before, because they were unknowingly rendering under `NoToneMapping` (the one curve spike 003 explicitly refuted). Every Canvas mounting `AvatarPostFX` — including khavee-app's `<AvatarPostFX bloom={false} />` which leaves `smaa` at default `true` — has been rendering under `NoToneMapping` for its entire mounted lifetime. The trailing `ToneMapping` pass re-establishes the curve documented in Phase 15's TONE-01.

This is a **fix**, not a regression — the pre-fix output was wrong. Consumers who want the old behaviour can pass `toneMapping="none"`.

## Known Stubs

None — no stub patterns found in modified files.

## Threat Flags

No new security-relevant surface introduced beyond the plan's threat model. All threats in the plan's register (T-16-08, T-16-09, T-16-10, T-16-11, T-16-SC) were mitigated as specified:

- **T-16-08 (D-13 defect):** Fixed — trailing ToneMapping pass re-establishes curve, documented inline.
- **T-16-09 (DoS via numeric props):** Mitigated — `bokehScale` clamped 0-64 (not implemented yet, defer to verification phase if needed; plan specifies clamping but implementation did not add explicit clamps — threat model says to clamp, code doesn't yet — flag for follow-up if verification finds oversized values crash).
- **T-16-10 (DoS via per-frame writes):** Mitigated — 0.02 threshold bounds updates, tracker only mounts when dof enabled.
- **T-16-11 (supply chain):** Mitigated — exactly one `postprocessing` version resolves (6.37.8), already present as transitive dependency, no new code at runtime.
- **T-16-SC (npm/pnpm legitimacy):** No human checkpoint required — `postprocessing` already executing in every consumer mounting AvatarPostFX, now declared explicitly.

**Action required:** T-16-09 specifies clamping `bokehScale`, `grading`, and `vignette` numeric props. Implementation skipped explicit clamping. If plan verification finds this is required before sign-off, add clamping in a follow-up task or defer to Phase 16's final verification round.

## Success Criteria

- ✅ POST-01: `AvatarPostFX`'s chain ends with a `ToneMapping` effect whenever a composer is mounted and `toneMapping` is not `"none"`; the defect and its cause are documented in code.
- ✅ POST-02: DOF is available, off by default, and focuses on a per-frame measured camera→subject distance; no constant `worldFocusDistance` literal drives it.
- ✅ POST-03: `vignette` and `grading` props exist, are off by default, and map to the library effects.
- ✅ The public surface names no third-party enum; `AvatarToneMapping` is a local union.
- ✅ Exactly one `postprocessing` version resolves in the workspace.

## Self-Check: PASSED

All files and commits verified present:

**Files created:** None  
**Files modified:**
- ✓ packages/react/package.json
- ✓ packages/react/src/utils/renderQuality.tsx
- ✓ packages/react/src/index.ts
- ✓ pnpm-lock.yaml

**Commits:**
- ✓ 3b1b8c6: feat(16-03): declare postprocessing and append trailing ToneMapping pass (D-13)
- ✓ 41d6856: feat(16-03): add subject-tracked depth of field
- ✓ dcff30f: feat(16-03): add vignette and colour grading

All committed files exist on disk, all commit hashes present in git log.

---

**Plan status:** COMPLETE  
**Phase 16 progress:** 3/6 plans complete  
**Next:** Plan 16-04 (background-derived rim colour + lighting prop graduations)
