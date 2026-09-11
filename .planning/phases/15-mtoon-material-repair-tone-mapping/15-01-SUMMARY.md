---
phase: 15-mtoon-material-repair-tone-mapping
plan: 01
subsystem: rendering
tags: [three.js, mtoon, vrm, material-repair, color-space, vitest, tdd]

# Dependency graph
requires: []
provides:
  - "packages/react/src/utils/mtoonRepair.ts: repairMToonMaterials, snapshotMToon, restoreMToon, setMToonDebugMode, averageTextureColor, DEFAULT_REPAIR, FACE_DETAIL_MATERIAL_RE"
  - "MToon repair pass (R1-R5) importable from @khaveeai/react, re-exported through renderQuality.tsx"
  - "MTOON-03 fix: chromatic rim tint derived from base texture average, not litFactor"
affects: [15-02, 15-03, 15-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Node-testable pure-logic module (mtoonRepair.ts) separated from R3F/JSX module (renderQuality.tsx) via re-export, so vitest environment:node tests avoid the R3F/postprocessing dependency graph"
    - "Texture sampling with dual path: raw typed-array average (headless/Node-safe) + browser canvas readback fallback, both alpha-filtered and colour-space-aware via THREE.Color.setRGB(..., THREE.SRGBColorSpace)"

key-files:
  created:
    - packages/react/src/utils/mtoonRepair.ts
    - packages/react/src/utils/mtoonRepair.test.ts
  modified:
    - packages/react/src/utils/renderQuality.tsx
    - packages/react/src/index.ts

key-decisions:
  - "mtoonRepair.ts lives in its own module (not inline in renderQuality.tsx) so TEST-01-style tests run under vitest environment:node without dragging in @react-three/postprocessing/JSX"
  - "Repair API (repairMToonMaterials, snapshotMToon, restoreMToon, setMToonDebugMode, DEFAULT_REPAIR, FACE_DETAIL_MATERIAL_RE + types) is publicly exported from @khaveeai/react, deviating from the package's usual 'internal helpers stay unexported' convention, per the plan's locked decision (Plan 04 repoints the spike page at this real API; useful standalone for non-VRMAvatar scenes)"
  - "R1's rim tint: sample averageTextureColor(m.map), multiply by m.color (MToon lit colour = litFactor * baseTexture), boost HSL saturation (rimSaturationBoost=2.0) on chromatic results, halve contribution (0.5x) instead of inventing a hue on genuinely achromatic ones (rimAchromaticThreshold=0.02) — deletes the old .lerp(white, 0.6) whitening step that spike 003 proved desaturating"

requirements-completed: [MTOON-01, MTOON-02, MTOON-03]

# Metrics
duration: 15min
completed: 2026-09-11
---

# Phase 15 Plan 01: MToon Material Repair Pass + Chromatic Rim Fix Summary

**Graduated the spike-validated MToon repair pass (R1-R5) into `@khaveeai/react` as public SDK code, and fixed the open MTOON-03 bug: R1's injected rim tint now comes from the material's base texture average multiplied by `litFactor`, not `litFactor` alone — eliminating the grey-rim desaturation spike 003 measured on VRoid models.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-11T11:10:00+07:00 (approx.)
- **Completed:** 2026-09-11T11:16:37+07:00
- **Tasks:** 2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `packages/react/src/utils/mtoonRepair.ts` (414 lines) exports the full repair API: `repairMToonMaterials`, `snapshotMToon`, `restoreMToon`, `setMToonDebugMode`, `averageTextureColor`, `DEFAULT_REPAIR`, `FACE_DETAIL_MATERIAL_RE`, plus `MaterialPreset`/`RepairOptions`/`RepairResult`/`RepairLogEntry`/`MToonSnapshot` types.
- R1-R5 rules run in the load-bearing order R5→R4→R3→R2→R1, with the face-detail exclusion running before any rule (`skippedFaceDetail` counter proves it).
- R4 gained a `shadingShiftTexture` guard (texture-driven values are invisible to factor-only inspection, per spike 001's caveat) that was not in the original spike code.
- Fixed MTOON-03 via TDD: `averageTextureColor` samples a texture's alpha-weighted average colour (raw typed-array path for headless/Node, canvas-readback path for browsers, both colour-space-correct via `THREE.SRGBColorSpace`), and R1's tint derivation now multiplies the sampled colour by `m.color` instead of whitening it.
- Re-exported through `renderQuality.tsx` (keeping it the single render-quality import site for `VRMAvatar`/`GLBAvatar`) and publicly through `packages/react/src/index.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Graduate the repair pass into packages/react/src/utils/mtoonRepair.ts** - `e1e69c6` (feat)
2. **Task 2: Fix MTOON-03 (RED)** - `ab16f1c` (test) — 5 failing tests confirmed (averageTextureColor missing, grey-rim regression proven)
3. **Task 2: Fix MTOON-03 (GREEN)** - `ea08157` (feat) — averageTextureColor implemented, R1 tint rewritten, all 169 tests passing

**Plan metadata:** (this commit) `docs(15-01): complete MToon repair pass plan`

## TDD Gate Compliance

Task 2 was executed as `tdd="true"`. Gate sequence confirmed in git log:

1. RED: `ab16f1c test(15-01): add failing tests for chromatic rim tint fix (MTOON-03)` — 5 tests failed on first run (`averageTextureColor is not a function`; grey-rim assertion failed with `hsl.s === 0`).
2. GREEN: `ea08157 feat(15-01): derive MToon rim tint from base texture, not litFactor (MTOON-03)` — all 7 new tests + full 169-test suite passed.
3. REFACTOR: not needed — no follow-up cleanup commit.

## Files Created/Modified

- `packages/react/src/utils/mtoonRepair.ts` - New module: R1-R5 repair rules, face-detail classifier, snapshot/restore, debug-mode setter, `averageTextureColor` texture sampler.
- `packages/react/src/utils/mtoonRepair.test.ts` - New: unit tests for `averageTextureColor` (null/red/alpha-exclusion/image-less-stub) and the chromatic-rim regression (blue texture + white litFactor → blue rim, not grey; no-map fallback; face-detail skip).
- `packages/react/src/utils/renderQuality.tsx` - Added a re-export block surfacing the repair API from `./mtoonRepair`, with a comment explaining the node-testability split.
- `packages/react/src/index.ts` - Extended the existing `renderQuality` export/export-type lines to include the repair API and its types.

## Decisions Made

- Kept `apps/playground/src/app/mtoon-spike/repairMToon.ts` completely unchanged, as required by the plan (Plan 04 deletes/repoints it) — verified via `git status`/`git diff --stat` showing zero changes to that file.
- Used the exact regex, rule order, and default thresholds from the validated spike; only behavioral deltas are the two required by the plan (R4's `shadingShiftTexture` guard, and the full MTOON-03 rim-tint rewrite).

## Deviations from Plan

None - plan executed exactly as written. Both required behavioral changes from the spike source (R4 multiply-texture guard, R1 fresnel-trap comment) were included in Task 1 as specified; the MTOON-03 fix in Task 2 followed the six-step derivation algorithm from the plan's `<action>` block exactly (sample → multiply by `m.color` → HSL read → saturation boost or achromatic halving → scale by `rimStrength`).

## Issues Encountered

- The worktree had no `node_modules` installed (fresh worktree checkout). Ran `pnpm install --frozen-lockfile` at the repo root before the first build/test — this is environment setup, not a plan deviation, and installed nothing new (lockfile was already up to date, 628 packages reused from the shared pnpm store).
- The worktree's branch (`worktree-agent-adf0edd33d3ffd61f`) had diverged from the plan's expected phase base commit (`aadb9b1`) — its own history was an unrelated older line (`1e134f5` `chore: bump SDK package versions`, `5f7ce9d`, etc., neither an ancestor nor descendant of `aadb9b1`). Per the `<worktree_branch_check>` step's documented recovery path, ran `git reset --hard aadb9b1defdbd856800225df29a04100194013c0` to align the branch to the correct phase base before starting any file edits. This is safe worktree setup (not a destructive operation against shared history), and was done before any task work began.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The repair API is public, tested, and builds clean — ready for Plan 02 (real-asset TEST-01 tests against the headless VRM loader) and Plan 03 (wiring into `VRMAvatar`'s `materialPreset` prop).
- Measured HSL saturation on the blue-texture/white-litFactor unit test case: `{h: 0.6667, s: 1.0, l: 0.225}` on the final `parametricRimColorFactor` (was the grey `[0.45, 0.45, 0.45]` — s≈0 — under the pre-fix `.lerp(white, 0.6)` derivation). This is the number Plan 04's browser saturation sweep should be compared against for a qualitative sanity check, though the real-asset numbers will differ (this is a synthetic single-material fixture, not `male.vrm`).
- No blockers for Plan 02/03/04.

---
*Phase: 15-mtoon-material-repair-tone-mapping*
*Completed: 2026-09-11*

## Self-Check: PASSED

- FOUND: packages/react/src/utils/mtoonRepair.ts
- FOUND: packages/react/src/utils/mtoonRepair.test.ts
- FOUND: .planning/phases/15-mtoon-material-repair-tone-mapping/15-01-SUMMARY.md
- FOUND commit: e1e69c6 (Task 1)
- FOUND commit: ab16f1c (Task 2 RED)
- FOUND commit: ea08157 (Task 2 GREEN)
- FOUND commit: 5a7d3cc (plan metadata)
