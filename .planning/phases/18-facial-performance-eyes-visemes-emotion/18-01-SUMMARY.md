---
phase: 18-facial-performance-eyes-visemes-emotion
plan: 01
subsystem: animation
tags: [three.js, vrm, vrm-lookat, react, eye-gaze, blink, procedural-animation]

# Dependency graph
requires: []
provides:
  - "eyeGaze.ts: standalone, unit-tested eye-contact tracking module (lookAt-primary, eye-bone fallback, saccades, glance-aways, shift detection)"
  - "additiveBone.ts: reusable non-accumulating additive bone-write helper for bones the mixer doesn't drive (eyes, jaw)"
  - "blink.ts refactored to a pure stepBlink with forceBlink/coupled external trigger surface (D-02)"
  - "AvatarFormatAdapter role union extended with leftEye/rightEye/jaw; new LookAtController structural type; optional getLookAt() adapter method"
affects: [18-02, 18-03, 18-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure createState/stepX/useX module shape (mirrors gaze.ts/gesture.ts) applied to a new eyeGaze.ts subsystem"
    - "Non-accumulating additive bone write (additiveBone.ts) as a shared primitive for bones not driven by the mixer, reused by both eyeGaze.ts (this plan) and jaw motion (18-03)"
    - "EyeGazeBias field contract (yawOffsetDeg/pitchOffsetDeg/aversionScale/saccadeScale) established as the shape 18-02's emotion module will mirror structurally"

key-files:
  created:
    - packages/react/src/animation/additiveBone.ts
    - packages/react/src/animation/additiveBone.test.ts
    - packages/react/src/animation/blink.test.ts
    - packages/react/src/animation/eyeGaze.ts
    - packages/react/src/animation/eyeGaze.test.ts
  modified:
    - packages/react/src/animation/types.ts
    - packages/react/src/animation/blink.ts
    - packages/react/src/GLBAvatar.tsx
    - pnpm-lock.yaml

key-decisions:
  - "eyeGaze.ts is a fully separate module from gaze.ts (D-03) — gaze.ts is byte-for-byte unchanged, verified in CI via git diff --quiet"
  - "Primary path writes lookAt.yaw/.pitch (autoUpdate=false) instead of eye bones, because VRMCore.update() runs lookAt.update() after humanoid.update() and would otherwise silently overwrite any bone-level saccade write (RESEARCH Pitfall 3)"
  - "Bone-fallback path's local convention treats +Z as forward (not gaze.ts's -Z), verified via the fallback path's own behavior test rather than by inspection, per the plan's explicit instruction"
  - "blink.ts reschedule logic (coupled vs legacy) is decided purely by the coupled option, independent of whether the trigger was the timer or a forced call — simpler than branching on trigger type and satisfies every specified behavior"

patterns-established:
  - "AdditiveBoneSlot / createAdditiveBoneSlot / applyAdditiveDelta: the shared non-accumulating additive-write primitive for any bone not guaranteed to be rewritten every frame by an upstream system"
  - "EyeGazeBias structural contract for future emotion-driven bias input (18-02)"

requirements-completed: [EYE-01, EYE-02]

# Metrics
duration: ~55min
completed: 2026-09-21
---

# Phase 18 Plan 01: Eye-Gaze Subsystem & Blink-Coupling Surface Summary

**New `eyeGaze.ts` module (vrm.lookAt-primary with eye-bone fallback, micro-saccades, glance-aways, blink-shift reporting) plus a `blink.ts` refactor exposing `forceBlink`/`coupled` options, both fully unit-tested and unwired (integration lands in 18-04)**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-09-18 (session 1) / resumed 2026-09-21 (session 2, after a provider rate-limit interruption)
- **Completed:** 2026-09-21
- **Tasks:** 3 (+ 1 unplanned lockfile-sync commit)
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments
- `additiveBone.ts`: a reusable, proven non-accumulating additive bone-write helper (`createAdditiveBoneSlot`/`applyAdditiveDelta`) for bones the animation mixer doesn't drive — 4 passing unit tests covering non-accumulation, upstream-write detection, non-accumulating repeated deltas, and identity no-op.
- `types.ts` extended: `getHumanoidBoneNode` role union gains `leftEye`/`rightEye`/`jaw`; new exported `LookAtController` structural interface; new optional `adapter.getLookAt?()` method. `GLBAvatar.tsx`'s adapter explicitly returns `null` for all three new roles (VRM-only by construction).
- `blink.ts` refactored to a pure `stepBlink(state, adapter, enabled, nowMs, opts?)` state machine with `forceBlink`/`coupled` options, while `useBlink()`'s existing `step(adapter, enabled)` call signature (used by `AnimationStateEngine.ts`) is unchanged and still compiles — 12 new unit tests.
- `eyeGaze.ts`: a complete standalone eye-contact tracking module — lookAt-primary path (drives `vrm.lookAt.yaw`/`.pitch` with `autoUpdate=false`), eye-bone fallback path (via `additiveBone.ts`, clamped to ±12°/±10°), micro-saccades and glance-aways folded into the same write, and `shiftDetected` reporting for future blink-coupling — 14 new unit tests.
- `gaze.ts` (head-bone camera gaze) is verified byte-for-byte unchanged (D-03), enforced by `git diff --quiet` in the plan's own verification block.
- Full `packages/react` suite: 232/232 tests passing, `tsc --noEmit` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend adapter types, add additiveBone helper, null GLB eye/jaw roles** - `91e004c` (feat)
2. **Task 2: Refactor blink.ts to pure stepBlink with forceBlink/coupled options** - `a027c5f` (feat)
3. **Task 3: Create eyeGaze.ts with tests** - `f8d5de0` (feat)

**Unplanned (Rule 3 - blocking fix):** `dc2fa7d` (chore) — pnpm-lock.yaml sync, see Deviations below.

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified
- `packages/react/src/animation/additiveBone.ts` - Non-accumulating additive bone-write helper (`AdditiveBoneSlot`, `createAdditiveBoneSlot`, `applyAdditiveDelta`)
- `packages/react/src/animation/additiveBone.test.ts` - 4 unit tests
- `packages/react/src/animation/types.ts` - `leftEye`/`rightEye`/`jaw` roles, `LookAtController` interface, optional `getLookAt?()`
- `packages/react/src/GLBAvatar.tsx` - adapter explicitly nulls eye/jaw roles
- `packages/react/src/animation/blink.ts` - refactored to pure `stepBlink`/`createBlinkState`/`useBlink` with `forceBlink`/`coupled` options
- `packages/react/src/animation/blink.test.ts` - 12 unit tests
- `packages/react/src/animation/eyeGaze.ts` - new eye-gaze module (`stepEyeGaze`, `createEyeGazeState`, `useEyeGaze`, `resolveEyeGazeMode`, `EyeGazeBias`, `NEUTRAL_EYE_GAZE_BIAS`)
- `packages/react/src/animation/eyeGaze.test.ts` - 14 unit tests
- `pnpm-lock.yaml` - synced with a pre-existing `simplex-noise` dependency drift (unrelated to this plan's own changes)

## Decisions Made
- eyeGaze.ts's bone-fallback path deliberately uses a +Z-forward local convention distinct from gaze.ts's -Z-forward world convention, because the two paths solve different math problems (numeric yaw/pitch atan2 vs. quaternion-diff clamping) — verified correct via the fallback path's own behavior tests rather than by inspection, exactly as the plan specified.
- blink.ts's reschedule-on-blink logic branches only on the `coupled` option, not on which trigger (timer vs forced) started the blink — this is simpler than a trigger-type branch and satisfies every specified behavior (legacy schedule unaffected by non-coupled forced blinks was not required by any test, so the simpler uniform rule was chosen).
- Saccade/glance timer seeds in `createEyeGazeState` use the injected `random` function so tests can guarantee no glance triggers within short convergence windows (`GLANCE_MIN_INTERVAL_S = 6` structurally exceeds any tested window) while still exercising real saccade variance in the dedicated micro-saccade test via a seeded LCG.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Synced pnpm-lock.yaml with an existing simplex-noise dependency drift**
- **Found during:** Task 1 setup (installing worktree dependencies)
- **Issue:** `packages/react/package.json` already declared `simplex-noise@4.0.3` (from a prior, unrelated commit on this branch) but `pnpm-lock.yaml` had never been regenerated, so `pnpm install --frozen-lockfile` failed outright, blocking all test/tsc verification for this plan.
- **Fix:** Ran `pnpm install --no-frozen-lockfile` to regenerate the lockfile entries for `simplex-noise`.
- **Files modified:** `pnpm-lock.yaml`
- **Verification:** Subsequent `pnpm install --frozen-lockfile` would now succeed; all test/tsc commands ran cleanly afterward.
- **Committed in:** `dc2fa7d` (separate chore commit, kept isolated from this plan's own feature commits)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to unblock verification; no scope creep into this plan's actual deliverables.

## Issues Encountered
- Execution was interrupted mid-Task-3 by a provider rate limit after `eyeGaze.ts` was written but before `eyeGaze.test.ts` existed and before either was committed. Resumed in a follow-up session per the orchestrator's explicit state verification (commits `dc2fa7d`/`91e004c`/`a027c5f` already present; `eyeGaze.ts` untracked). No rework was needed — `eyeGaze.ts`'s existing content was read back, the test file was written against it, one test bug was found and fixed (a fallback-path test camera position exceeded `EYE_TRACK_GIVE_UP_YAW_DEG`, unintentionally testing the give-up relaxation instead of normal convergence — corrected to a 45° test angle within range), then both files were committed together.
- One implementation bug was caught by `tsc --noEmit` before commit: `lookAt` (typed `LookAtController | null`) needed non-null assertions in the primary-path branch since TypeScript's narrowing from the earlier `path === "lookAt"` check doesn't persist across the `if/else` inside the camera-mode block. Fixed inline, verified by a clean `tsc --noEmit` run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `eyeGaze.ts` and `blink.ts`'s new trigger surface are both fully built and unit-tested but **not yet wired** into `AnimationStateEngine.ts` or `VRMAvatar.tsx` — that integration (calling `useEyeGaze().step()` per frame and passing its `shiftDetected` result into `blink.step(..., { forceBlink, coupled: true })`) is explicitly deferred to 18-04, per this plan's objective.
- `EyeGazeBias`'s field contract (`yawOffsetDeg`, `pitchOffsetDeg`, `aversionScale`, `saccadeScale`) is now locked and ready for 18-02's emotion module to mirror structurally — do not rename these fields without updating that module too.
- `additiveBone.ts` is ready for reuse by 18-03's jaw motion (viseme work) without modification.
- No blockers identified for 18-02/18-03/18-04.

---
*Phase: 18-facial-performance-eyes-visemes-emotion*
*Completed: 2026-09-21*
