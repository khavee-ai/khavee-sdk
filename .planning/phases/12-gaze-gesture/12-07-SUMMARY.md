---
phase: 12-gaze-gesture
plan: 07
subsystem: animation
tags: [three.js, quaternion, gaze, easing, exponential-smoothing, vitest]

requires:
  - phase: 12-gaze-gesture
    provides: "stepGaze/gaze.ts camera-relative gaze + thinking aversion delta (12-01..12-06)"
provides:
  - "Persistent, frame-rate-independent exponential smoothing in stepGaze (GazeState.smoothedTarget) replacing the old one-shot modeElapsed/RAMP_SECONDS fade-in"
  - "Mode-switch continuity: camera<->aversion transitions ease from the currently-applied gaze instead of snapping back to the neutral base pose"
  - "gaze.test.ts convergence/frame-rate-independence/mode-switch test coverage closing Gap 1 from 12-06-VERIFICATION.md"
affects: [12-08, 12-09]

tech-stack:
  added: []
  patterns:
    - "Persisted smoothed-target quaternion advanced via `1 - Math.exp(-delta / TIME_CONSTANT)` slerp factor for frame-rate-independent easing of a target-tracking procedural system (contrast with breathing/sway's fixed-axis sine oscillators, which have no target to persist)"

key-files:
  created: []
  modified:
    - packages/react/src/animation/gaze.ts
    - packages/react/src/animation/gaze.test.ts

key-decisions:
  - "Removed GazeState.modeElapsed and the RAMP_SECONDS constant entirely rather than keeping them alongside the new smoothing — the continuous exponential model fully subsumes the one-shot ramp, and no other file references either symbol (grep-verified before removal)"
  - "GAZE_SMOOTH_TIME_CONSTANT = 0.18s chosen as a discretion number (Assumption A1), extrapolated from the old RAMP_SECONDS=0.3s one-shot fade-in and AnimationStateEngine.ts's SETTLE_RAMP_SECONDS=1.2s settle-ramp precedent"
  - "smoothedTarget is only re-seeded to the current base pose on a fresh entry from 'none' (starting/stopped -> a live mode); a switch between two already-live modes (camera<->aversion) eases onward from wherever smoothedTarget already is — this is the specific mechanism that stops the mode-switch snap-to-base reported in Gap 2's human verdict"
  - "Test helper runUntilConverged resets head.quaternion to a fixed base pose before every simulated frame, mirroring the real mixer.update() -> ...procedural stack... -> gaze.step() call order (VRMAvatar.tsx/AnimationStateEngine.ts) — only GazeState persists across frames in production, so the unit tests needed to replicate that reset to correctly prove the MAX_GAZE_ANGLE_RAD bound holds under convergence rather than drifting unboundedly"

patterns-established:
  - "Frame-rate-independent damping via `1 - Math.exp(-delta / TIME_CONSTANT)`: the same total elapsed time converges to the same result whether advanced in one large delta or several small deltas (verified exactly, not just approximately, since exponential decay composition is mathematically exact)"

requirements-completed: [GAZE-01, GAZE-02]

duration: 25min
completed: 2026-07-18
---

# Phase 12 Plan 07: Gaze Smoothing (Gap 1 Closure) Summary

**Replaced stepGaze's one-shot `modeElapsed/RAMP_SECONDS` fade-in with a persisted `GazeState.smoothedTarget` quaternion advanced via frame-rate-independent exponential slerp, closing the GAZE-01/GAZE-02 snapping gap on both VRM and GLB.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-18T10:17:00Z
- **Completed:** 2026-07-18T10:42:30Z
- **Tasks:** 2/2 completed
- **Files modified:** 2

## Accomplishments

- `stepGaze` now eases toward its gaze target continuously, frame over frame, instead of landing exactly on the clamped target the instant the ramp completes (root cause of the human-reported "gaze is snap, not smooth" on both VRM and GLB)
- Mode switches (camera <-> aversion) ease onward from the currently-applied gaze orientation — the smoothed target is only re-seeded to the neutral base pose on a fresh entry from `starting`/`stopped`, never on a live-to-live mode change
- `MAX_GAZE_ANGLE_RAD` clamp, additive-only `multiply()` bone writes, the full `starting`/`stopped` no-op, and the "never call the live bone's orient-toward-target method" guarantee are all preserved and re-verified
- `gaze.test.ts` extended with a `runUntilConverged` helper (correctly simulating the real per-frame mixer-reset call order) and four new tests proving: eases-in-not-jump, monotonic convergence never exceeding the bound, exact frame-rate independence, and no snap-to-base on mode switch
- Full `packages/react` suite: 147/147 passing (up from 144 — 3 net new gaze tests), `tsc --noEmit` clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add persistent frame-rate-independent smoothing to stepGaze** - `7d0df27` (feat)
2. **Task 2: Update and extend gaze.test.ts for smoothing (no per-frame snap)** - `72fc493` (test)

_Note: Task 1 is tagged `tdd="true"` in the plan but was executed as a single cohesive `feat` commit followed by Task 2's `test` commit — the plan's own task split (Task 1 = implementation, Task 2 = full test reconciliation + new coverage) already provides the RED/GREEN separation at the plan level; see "TDD Gate Compliance" below._

## Files Created/Modified

- `packages/react/src/animation/gaze.ts` - `GazeState` gains `smoothedTarget: THREE.Quaternion` + `smoothedInitialized: boolean`, replacing `modeElapsed`; `stepGaze`'s ease step now advances `state.smoothedTarget` via `1 - Math.exp(-delta / GAZE_SMOOTH_TIME_CONSTANT)` instead of a one-shot ramp fraction; file-header comments (steps 4-5, aversion pattern note) updated to describe the new persistent smoothing
- `packages/react/src/animation/gaze.test.ts` - All ramp-setup (`state.modeElapsed = 10`) test scaffolding replaced with a `runUntilConverged` helper that resets the bone to a fixed base pose each simulated frame (matching production's mixer-reset call order); 4 new tests added for convergence/frame-rate-independence/mode-switch-no-snap

## Decisions Made

- Removed `modeElapsed`/`RAMP_SECONDS` entirely (grep-verified no other consumers) rather than leaving dead code alongside the new smoothing fields
- `GAZE_SMOOTH_TIME_CONSTANT = 0.18s` — a discretion number (Assumption A1) balancing "responsive" against "smooth, not snap," extrapolated from the retired `RAMP_SECONDS=0.3s` and `AnimationStateEngine.ts`'s `SETTLE_RAMP_SECONDS=1.2s`
- The test-side `runUntilConverged` helper resets the stub head bone's quaternion before every simulated frame — this was necessary to correctly model production behavior (mixer resets the bone to its clip pose every frame before gaze runs; only `GazeState` persists across frames) and is what makes the "converges to `<= MAX_GAZE_ANGLE_RAD`" assertions hold rather than drifting unboundedly across many un-reset frames

## Deviations from Plan

None — plan executed exactly as written. Both tasks' `<action>` steps, acceptance criteria, and `<behavior>` requirements were implemented as specified; no Rule 1-4 auto-fixes were needed beyond the plan's own explicit instructions.

## TDD Gate Compliance

Task 1 is annotated `tdd="true"` with a `<behavior>` block, but the plan's actual task split already encodes RED/GREEN at the plan level rather than within Task 1 alone: Task 1 (`7d0df27`, `feat`) implements the smoothing; Task 2 (`72fc493`, `test`) is where the full test suite proving the new `<behavior>` guarantees (eases-in-not-jump, monotonic convergence, frame-rate independence, mode-switch-no-snap) is committed. No standalone `test(...)` commit precedes Task 1's `feat(...)` commit in git log — this deviates from the literal RED-before-GREEN commit ordering the TDD gate expects, though the net result (comprehensive test coverage exists and passes before the plan is considered done) is delivered. Flagging here per the plan-level TDD gate enforcement instructions rather than silently treating it as compliant.

## Self-Check: PASSED

- FOUND: packages/react/src/animation/gaze.ts (modified, contains `Math.exp`, 0 `.lookAt(` occurrences)
- FOUND: packages/react/src/animation/gaze.test.ts (modified, contains `smooth` x7, 17 tests passing)
- FOUND commit 7d0df27 (feat(12-07): add persistent frame-rate-independent smoothing to stepGaze)
- FOUND commit 72fc493 (test(12-07): reconcile gaze tests with persistent smoothing, add convergence coverage)
