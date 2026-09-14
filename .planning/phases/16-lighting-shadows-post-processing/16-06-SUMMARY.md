---
phase: 16-lighting-shadows-post-processing
plan: 06
subsystem: measurement-harness
tags: [measurement, lighting, contrast, verification]
requires: [16-02, 16-03, 16-04, 16-05]
provides: [MEASURE-01-harness, permanent-lighting-fixture]
affects: [apps/playground/src/app/lighting]
tech_stack:
  added: []
  patterns: [procedural-fixtures, read-only-import, measurement-gating]
key_files:
  created:
    - apps/playground/src/app/lighting/page.tsx
    - apps/playground/src/app/lighting/fixtureTextures.ts
  modified: []
decisions:
  - id: D-06-01
    decision: "Procedural fixtures instead of binary assets"
    rationale: "No image assets enter repo; three aspect ratios exact by construction"
  - id: D-06-02
    decision: "Measure button disabled when background active, in UI not docs"
    rationale: "measureCanvas skips alpha < 128; backdrop makes it measure wallpaper instead of avatar"
  - id: D-06-03
    decision: "Tab visibility displayed with explicit warning"
    rationale: "Throttled tabs return confident false readings; spike 004/005 both hit this"
metrics:
  duration_min: 25
  completed_at: "2026-09-14"
  tasks_completed: 1
  tasks_total: 3
  files_created: 2
---

# Phase 16 Plan 06: Lighting Comparison Harness — SUMMARY

**One-liner:** Permanent measurement fixture at `/lighting` for same-harness contrast comparison (three-point vs legacy rig), plus human verification gates for backdrop fit, DOF, rim color derivation, and outline cost.

## Status

**Task 1 (autonomous):** COMPLETE — Harness page built and committed (3bfb719)
**Task 2 (checkpoint:human-verify):** READY — Awaiting human contrast measurement
**Task 3 (checkpoint:human-verify):** PENDING — Blocked on Task 2 completion

## What Was Built

### Task 1: Lighting comparison harness page

**Files created:**
- `apps/playground/src/app/lighting/fixtureTextures.ts` — Procedural backdrop fixtures at 16:9, 1:1, 9:16, plus sky-over-ground fixture for rim derivation testing
- `apps/playground/src/app/lighting/page.tsx` — Permanent harness page with:
  - Single Canvas with `preserveDrawingBuffer: true` for pixel readback
  - Fixed camera framing (fov 20, position [0, 0.1, 4]) matching mtoon-spike
  - Controls:
    - Rig: legacy (khavee-app production rig) vs three-point (Phase 16 default)
    - Ambient override slider (for D-04 adoption testing)
    - Model selector: male.vrm vs 3636451243928341470.vrm
    - Background: none/color/fixtures with cover/contain toggle
    - Post FX: bloom, smaa, dof, vignette, grading toggles + tone mapping selector
    - Outlines toggle
  - Readouts:
    - `visibilityState` with warning when not "visible"
    - FPS and mean frame time
    - `gl.info.render.calls` and `gl.info.render.triangles`
  - Measurement panel:
    - Measure button (disabled when background !== none with reason shown)
    - Reproduction check (delta vs prior identical config)
    - Copy rows button (markdown table export)
    - Measurement row display

**Verification passed:**
- `pnpm --filter @khaveeai/react build` — clean
- `npx tsc --noEmit -p apps/playground/tsconfig.json` — no errors in lighting page
- Harness invariants check (preserveDrawingBuffer, measureCanvas, visibilityState, render stats, outlines, background gating) — OK
- `mtoon-spike/` untouched (0 changes)

**Commit:** 3bfb719

## Deviations from Plan

None. Task 1 executed exactly as specified.

## Known Issues

None at this stage. Tasks 2 and 3 are human-verify checkpoints by design.

## Next Steps

**Task 2 (blocking checkpoint):** Human measures contrast under legacy vs three-point rig on both test models in a visible, focused tab. Gate: three-point contrast >= legacy contrast for both models. Reproduction check must show small delta on repeated measurements.

**Task 3 (blocking checkpoint):** Human confirms:
- A: Outline draw-call and frame-time cost (non-zero on male.vrm, zero on control)
- B: Backdrop fit at 16:9, 1:1, 9:16 under cover/contain, across window resize
- C: DOF keeps subject sharp through camera dolly
- D: Rim color picks up upper region hue from photo background, stays neutral on grey
- E: Tone-mapping defect fix (none vs cineon with smaa is visibly different saturation)

## Commits

| Hash    | Message                                              |
|---------|------------------------------------------------------|
| 3bfb719 | feat(16-06): build lighting comparison harness page |

## Self-Check: PASSED

**Files created:**
- ✓ apps/playground/src/app/lighting/fixtureTextures.ts exists
- ✓ apps/playground/src/app/lighting/page.tsx exists

**Commit exists:**
- ✓ 3bfb719 present in git log

**Imports:**
- ✓ measureCanvas imported from ../mtoon-spike/measureSaturation (read-only)
- ✓ mtoon-spike/ directory untouched

**Invariants:**
- ✓ preserveDrawingBuffer: true in Canvas gl prop
- ✓ measureCanvas called on Measure button
- ✓ visibilityState displayed with warning
- ✓ info.render.calls and info.render.triangles displayed
- ✓ outlines prop wired to VRMAvatar
- ✓ background prop wired to VRMAvatar
- ✓ Measure button disabled when background !== undefined
