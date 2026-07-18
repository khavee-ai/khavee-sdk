---
phase: 12-gaze-gesture
reviewed: 2026-07-18T23:20:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - packages/react/src/animation/gaze.ts
  - packages/react/src/animation/gaze.test.ts
findings:
  critical: 1
  warning: 2
  info: 3
  total: 6
status: issues_found
---

# Phase 12: Code Review Report (Wave 7 — 12-07/12-08 gap-closure re-review)

**Reviewed:** 2026-07-18T23:20:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

This is a scoped re-review of `packages/react/src/animation/gaze.ts` and its test file, covering the two gap-closure plans (12-07: persistent frame-rate-independent smoothing; 12-08: group-rotation-agnostic camera target + frontal-range relaxation) that were verified by 12-09 to *not* fully resolve the reported GLB-only idle-animation spin/twist.

Per the reviewer prompt, I focused specifically on hunting for a mechanism in `gaze.ts` that could produce a spin/twist independent of (or in addition to) the world-target math 12-08 already fixed. I found one: **the persisted `GazeState.smoothedTarget` is an absolute quaternion that is only re-seeded on a mode transition out of `"none"`, never on a discontinuity in the head bone's own mixer-driven base pose.** I verified empirically (via a throwaway vitest run against the actual shipped `gaze.ts`, not just code reading) that this causes the applied per-frame delta to blow past `MAX_GAZE_ANGLE_RAD` by a wide margin whenever the head bone's base orientation changes discontinuously between two frames — e.g. an idle-clip loop-seam discontinuity, or a `switchToClip`/crossfade boundary, both of which occur in the real per-frame call chain immediately before `gaze.step()` runs (`AnimationStateEngine.ts` steps 0, 1, 9 all run before step 10/gaze). This is not a hypothetical: an 8-degree base-pose jump (a very plausible magnitude for an imperfectly-looped idle clip) produced a 0.177 rad (~10.1°) applied delta that frame — **3.5x** the declared 0.05 rad bound; a 90-degree jump produced **28x** the bound. Every existing test (both pre-existing and the new 12-07/12-08 tests) holds the base pose perfectly fixed across all simulated frames, so this class of bug is completely untested and was not caught by either gap-closure plan's "150/150 passing" gate.

This gives the next investigation (12-10) a concrete, reproducible mechanism to check against the real bundled assets: does `happy.glb`'s idle clip have a head-bone discontinuity at its loop seam (or during a talk-cycle variant switch) that `male.vrm`'s idle clip does not? If so, this — not the world-target math 12-08 already fixed — is the more likely explanation for why the spin persists on GLB only.

Secondary findings below cover the test-coverage gap that let this through, a documentation claim that is no longer accurate, and a few smaller observations to help scope 12-10.

## Critical Issues

### CR-01: `GazeState.smoothedTarget`'s persisted-absolute design breaks the `MAX_GAZE_ANGLE_RAD` bound whenever the head bone's base pose changes between frames — verified to reproduce a multi-times-the-bound rotation snap, a strong candidate for the still-open GLB idle-spin

**File:** `packages/react/src/animation/gaze.ts:432-453` (interacting with the re-seed guard at `:328-338` and `GazeState` at `:230-249`)

**Issue:**

`stepGaze` re-seeds `state.smoothedTarget` from the current base pose only when `enteringFromNone` (a transition out of `"none"`, i.e. `starting`/`stopped` → a live mode) or on first-ever use (`!state.smoothedInitialized`):

```ts
const enteringFromNone = state.activeMode === "none";
state.activeMode = mode;
_scratchCurrent.copy(head.quaternion);
if (!state.smoothedInitialized || enteringFromNone) {
  state.smoothedTarget.copy(_scratchCurrent);
  state.smoothedInitialized = true;
}
```

Every frame after that, `state.smoothedTarget` is advanced toward *this frame's* clamped target:

```ts
state.smoothedTarget.slerp(_scratchClampedTarget, smoothT);
_scratchEasedTarget.copy(state.smoothedTarget);
_scratchDelta.copy(_scratchCurrent).invert().multiply(_scratchEasedTarget);
head.quaternion.multiply(_scratchDelta);
```

`_scratchClampedTarget` is correctly bounded to `MAX_GAZE_ANGLE_RAD` (or less, post-frontal-relaxation) **relative to that frame's `_scratchCurrent`** — but `state.smoothedTarget` is an *absolute* quaternion carried across frames at only a fractional `smoothT` (~8.6% per 16ms frame, given `GAZE_SMOOTH_TIME_CONSTANT = 0.18`) catch-up rate. If `head.quaternion` (the mixer-driven base pose gaze diffs against) itself changes discontinuously between two consecutive frames — a real idle clip loop restart, a `talkCycle`/`switchToClip` variant change, or a crossfade boundary, all of which run in `AnimationStateEngine.ts` *before* `gaze.step()` in the same per-frame `update()` — then `state.smoothedTarget` (still anchored near the *old* base) is no longer within `MAX_GAZE_ANGLE_RAD` of the *new* base, and the final delta `_scratchCurrent.invert().multiply(_scratchEasedTarget)` is **not re-clamped after smoothing**. The result is an unbounded, visibly large single-frame (or few-frame) rotation snap on the head bone — exactly the kind of thing a human would describe as a "spin/twist."

I verified this empirically against the actual shipped code (not a hypothetical read), running `stepGaze` to full convergence from an identity base pose, then jumping the base pose by a single discontinuous rotation before one more `stepGaze` call, and measuring the resulting delta from that frame's (jumped) base:

| Simulated base-pose jump between frames | Applied delta this frame | vs. `MAX_GAZE_ANGLE_RAD` (0.05 rad) |
|---|---|---|
| 8° (plausible idle-loop-seam discontinuity) | 0.177 rad (~10.1°) | **3.5x** the declared bound |
| 90° (extreme, for scale) | 1.422 rad (~81.5°) | **28.4x** the declared bound |

This directly contradicts the guarantee every existing test and both 12-07/12-08's `<behavior>` blocks assert ("converges monotonically toward the target, never exceeding the max" / "MAX_GAZE_ANGLE_RAD clamp ... preserved and re-verified") — that guarantee only holds when the base pose is held perfectly fixed across frames, which none of `AnimationStateEngine.ts`'s real per-frame call chain does (mixer-driven idle clips continuously vary the head bone; clip switches/crossfades change it discontinuously).

This is a strong, reproducible candidate for the root cause 12-08 did not find: it is independent of the world-target math 12-08 fixed (it reproduces identically in `"thinking"`/aversion mode, which has no camera dependency at all), it is a real correctness defect (violates the module's own documented invariant), and its visibility would plausibly differ per avatar format depending on how cleanly each rig's idle clip loops or how the two formats' clip libraries drive talk-cycle variant switching — matching the observed GLB-only symptom without requiring any new assumption beyond "GLB's idle clip likely has a less clean loop/transition than VRM's."

**Fix:** Re-clamp the *final* delta to the bound immediately before applying it, regardless of how far `smoothedTarget` has drifted from the current frame's base — e.g. reusing the same angle-then-slerp idiom already used for `_scratchClampedTarget` earlier in this function:

```ts
// Final safety clamp: no matter how far state.smoothedTarget has drifted
// from THIS frame's base (e.g. a discontinuous mixer/clip-switch jump),
// the applied delta from base must never exceed the declared bound.
const deltaAngle = _scratchCurrent.angleTo(_scratchEasedTarget);
if (deltaAngle > MAX_GAZE_ANGLE_RAD && deltaAngle > 0) {
  const t = MAX_GAZE_ANGLE_RAD / deltaAngle;
  _scratchDelta.copy(_scratchCurrent).slerp(_scratchEasedTarget, t).premultiply(_scratchCurrent.clone().invert());
} else {
  _scratchDelta.copy(_scratchCurrent).invert().multiply(_scratchEasedTarget);
}
head.quaternion.multiply(_scratchDelta);
```

(Or, more robustly: re-seed `state.smoothedTarget` from the fresh base whenever `_scratchCurrent.angleTo(state.smoothedTarget)` exceeds some "this is clearly a discontinuity, not normal drift" threshold, in addition to the existing `enteringFromNone` re-seed — treating a large single-frame base jump the same way a mode-from-`"none"` transition is already treated.)

## Warnings

### WR-01: No test exercises a base pose that changes between frames — the exact scenario that exposes CR-01 — despite `runUntilConverged`'s doc comment claiming to mirror the real per-frame call order

**File:** `packages/react/src/animation/gaze.test.ts:56-80` (`runUntilConverged`), and every describe block that uses it or a bare `head.quaternion.copy(identity)` reset

**Issue:** `runUntilConverged`'s comment states it "mimic[s] the real call order (`mixer.update()` -> ...procedural stack... -> `gaze.step()` last)" — true for *ordering*, but every simulated frame resets `head.quaternion` to the exact same fixed `baseQuat` (`head.quaternion.copy(baseQuat)` inside the loop). In real production, the mixer writes a *different* pose every frame (continuous idle-clip head motion), and `switchToClip`/crossfade boundaries can write a *discontinuous* pose change on a single frame. None of the 20 tests in this file (nor the pre-existing 17) ever vary the base pose across frames, so the `MAX_GAZE_ANGLE_RAD`-bound assertions in "converges monotonically... never exceeding the max" and similar tests only prove the bound holds in the (production-unrealistic) fixed-base-pose case. This is precisely the gap that let CR-01 ship through two rounds of otherwise-thorough TDD (150/150 → 150/150 passing, `tsc` clean, both times).

**Fix:** Add at least one test that (a) converges gaze fully from a fixed base, then (b) changes the base pose by a single discontinuous jump (simulating a clip-switch/loop-restart) before one more `stepGaze` call, and (c) asserts the applied delta *from that frame's new base* still respects `MAX_GAZE_ANGLE_RAD`. As currently written, this test would fail against the shipped code (see CR-01) — write it RED first per this project's TDD gate, then land the CR-01 fix to turn it GREEN.

### WR-02: Documentation/behavior-contract claims about the `MAX_GAZE_ANGLE_RAD` bound are stated as unconditional guarantees but are not

**File:** `packages/react/src/animation/gaze.ts:1-126` (file header, "steps 4-5" description); also `12-07-SUMMARY.md` ("`MAX_GAZE_ANGLE_RAD` clamp ... are all preserved and re-verified") and `12-08-SUMMARY.md`

**Issue:** The file header and both plans' summaries assert the angle bound holds generally after the smoothing/relaxation changes. Per CR-01, it does not hold in general — only when the base pose is stable frame-to-frame. Readers of this file (including whoever picks up 12-10) would reasonably assume the bound is airtight based on this documentation, which could misdirect further investigation away from gaze.ts itself.

**Fix:** Either fix CR-01 so the claim becomes true, or (at minimum, if a full fix is deferred) update the file header to explicitly document the known gap: "the bound holds only when the underlying base pose is stable between frames; a discontinuous base-pose change (clip switch, loop restart) can transiently exceed it — see CR-01/12-10."

## Info

### IN-01: Frontal-range relaxation reduces the *amplitude* of the `setFromUnitVectors` near-antiparallel instability but does not stabilize its *direction*

**File:** `packages/react/src/animation/gaze.ts:198-202`, `:418-425`

**Issue:** `computeFrontalContribution` scales the clamped target's magnitude down as the raw angle approaches π, which is a reasonable, deliberate design choice (there is no unique "shortest path" exactly at the antiparallel singularity). However, it's worth noting for 12-10: the underlying rotation *axis* computed by `setFromUnitVectors` in this near-antiparallel zone is still highly sensitive to small perturbations in `_scratchCurrentWorldForward` (itself affected by every frame's breathing/sway ancestor writes) — the relaxation shrinks the resulting wobble's *magnitude* toward zero as the angle approaches π, but does not eliminate frame-to-frame *axis* variance in the still-nonzero contribution zone (e.g. ~13% contribution at GLB's measured ~168° raw angle). Not a code defect — the design is reasonable given the constraints — but worth keeping in mind if 12-10 investigates whether a small, wobbly-axis head nudge (rather than CR-01's much larger base-pose-jump snap) is also a contributing factor.

### IN-02: `gaze.ts` only ever writes the head bone — worth flagging against 12-09's "body" language when scoping 12-10

**File:** `packages/react/src/animation/gaze.ts:295` (`adapter.getHumanoidBoneNode("head")`)

**Issue:** `12-09-VERIFICATION.md` describes the persisting symptom as "the model's body still spins/twists" (and "the idle-animation spin/twist on GLB is not gone"). `gaze.ts` never touches spine/chest/hips (those are `breathing.ts`/`sway.ts`'s domain per `AnimationStateEngine.ts` steps 5-7) — it is architecturally confined to the head bone. CR-01's discontinuous-jump bug can absolutely produce a visible head/neck snap that a human might describe loosely as "the body twisting," so this doesn't rule gaze.ts out, but if fixing CR-01 doesn't fully resolve the reported symptom, 12-10 should also examine `breathing.ts`/`sway.ts` and the idle clip's own loop continuity independent of gaze, since those are the only systems in this pipeline that write to spine/chest/hips.

### IN-03: `computeFrontalContribution` is a pure, boundary-condition-rich function but is not exported for direct unit testing

**File:** `packages/react/src/animation/gaze.ts:198-202`

**Issue:** Unlike `MAX_GAZE_ANGLE_RAD`/`createGazeState`/`stepGaze`, `computeFrontalContribution` has no direct unit test — its boundary behavior (exactly at `GAZE_FRONTAL_RANGE_RAD`, exactly at `Math.PI`, and the linear falloff in between) is only verified indirectly through `stepGaze`'s integration-style tests in `gaze.test.ts:365-448`, which makes it harder to pin down whether a future regression is in the falloff formula itself versus somewhere else in the camera-mode pipeline.

**Fix:** Consider exporting `computeFrontalContribution` (even if only for test purposes, following this file's existing pattern of exporting `MAX_GAZE_ANGLE_RAD`/`GAZE_SMOOTH_TIME_CONSTANT` for testability) and adding direct boundary-value tests (`computeFrontalContribution(GAZE_FRONTAL_RANGE_RAD) === 1`, `computeFrontalContribution(Math.PI) === 0`, midpoint linearity).

---

_Reviewed: 2026-07-18T23:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
