---
phase: 12-gaze-gesture
reviewed: 2026-07-18T17:35:54Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - packages/react/src/animation/gaze.ts
  - packages/react/src/animation/gaze.test.ts
findings:
  critical: 0
  warning: 0
  info: 1
  total: 1
status: issues_found
---

# Phase 12: Code Review Report (wave 8, plan 12-10)

**Reviewed:** 2026-07-18T17:35:54Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found (Info only — no Critical or Warning findings)

## Summary

This diff (base `2605f0d`) is a narrowly-scoped gap-closure round: it adds a final re-clamp of the eased/persisted gaze target to `MAX_GAZE_ANGLE_RAD`, measured from the CURRENT frame's captured base pose (`_scratchCurrent`), immediately before deriving the applied delta in `stepGaze`. This directly addresses `12-REVIEW-wave7.md`'s CR-01: `GazeState.smoothedTarget` is a persisted absolute quaternion that is only re-seeded on a `"none"` → live-mode transition, so it can legitimately drift many multiples of `MAX_GAZE_ANGLE_RAD` away from the current base if the head bone's mixer-driven base pose changes discontinuously between two consecutive `stepGaze` calls (idle-clip loop seam, `switchToClip`, crossfade boundary). Two new regression tests (Test A, camera mode; Test B, aversion mode) simulate exactly that discontinuity.

**Verification performed (not just read-through):**
- Ran the full `gaze.test.ts` suite against the current (fixed) `gaze.ts` — all 22 tests pass, including the two new ones.
- Reverted `gaze.ts` to its pre-diff (`2605f0d`) content with the new tests still in place, and re-ran the suite: both new tests fail RED as documented, reproducing angles of `0.1766` rad (camera mode) and `0.0822` rad (aversion mode) against the `0.05` rad bound — matching the plan's claimed `0.177` rad / 3.5x-bound repro number almost exactly. This confirms the tests are not tautological and genuinely exercise the fix.
- Restored the fixed `gaze.ts` (working tree is clean, `git status` shows no diff versus the reviewed commit).
- Traced the clamp math by hand: `Quaternion.slerp(target, t)` on unit quaternions is geodesic-angle-linear, so `angleTo(current, current.clone().slerp(easedTarget, MAX/deltaAngle)) === MAX` exactly (up to floating-point epsilon) whenever `deltaAngle > MAX`. Because spherical caps of radius `MAX_GAZE_ANGLE_RAD` (0.05 rad, far below the π/2 convexity threshold) are geodesically convex, this same reasoning extends the guarantee to the non-discontinuous/continuous-drift case, not just the literal reproduced jump scenario — i.e. this is a general correctness fix, not a narrow patch for one test case.
- Confirmed `tsc --noEmit` is clean for the package and no dangerous patterns (`console.*`, `eval`, `TODO`/`FIXME`/`HACK`, empty catch) were introduced by the diff.

No Critical or Warning issues found. The fix is mathematically sound, correctly scoped to the diff, does not mutate the persisted `smoothedTarget` (preserving the intended re-convergence behavior across subsequent frames), and is verified by tests that were confirmed to be RED against the pre-fix code and GREEN against the fix.

## Info

### IN-01: Redundant `&& deltaAngle > 0` guard in the new re-clamp condition

**File:** `packages/react/src/animation/gaze.ts:485`
**Issue:** The new final re-clamp condition is `if (deltaAngle > MAX_GAZE_ANGLE_RAD && deltaAngle > 0)`. Since `MAX_GAZE_ANGLE_RAD` is a positive constant (`0.05`), `deltaAngle > MAX_GAZE_ANGLE_RAD` already implies `deltaAngle > 0`; the second clause can never independently affect the branch outcome. This mirrors the pre-existing first-clamp idiom at line 417 (`targetAngle > MAX_GAZE_ANGLE_RAD && targetAngle > 0`), which has the identical redundancy — so this isn't a new anti-pattern being introduced, just a verbatim copy of an existing one, per the file's own comment that it deliberately reuses "the SAME `angleTo()`+`copy().slerp()` idiom." Harmless (dead conditional, not a correctness bug), but worth a note since it's genuinely new code in this diff, not a modification of the old redundant line.
**Fix:** Optional cleanup, not required for this gap-closure round (would also apply equally to line 417, which is out of this diff's scope): simplify to `if (deltaAngle > MAX_GAZE_ANGLE_RAD)` since `angleTo()` is guaranteed non-negative and `MAX_GAZE_ANGLE_RAD > 0`.

---

_Reviewed: 2026-07-18T17:35:54Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
