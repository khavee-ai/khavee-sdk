---
phase: 12-gaze-gesture
plan: 10
subsystem: animation
tags: [three.js, quaternion, gaze, gap-closure, vitest, tdd]

requires:
  - phase: 12-gaze-gesture
    provides: "12-REVIEW-wave7.md CR-01 finding: state.smoothedTarget's persisted-absolute design breaks MAX_GAZE_ANGLE_RAD under a discontinuous base-pose jump"
provides:
  - "Final-delta re-clamp in gaze.ts (CR-01 fix): the applied head-bone gaze delta is now provably bounded by MAX_GAZE_ANGLE_RAD even when the mixer-driven base pose changes discontinuously between two consecutive stepGaze calls"
  - "Two RED-first regression tests (camera mode + aversion mode) locking the CR-01 invariant in against future regression"
  - "Empirical, real-asset diagnosis of whether CR-01 applies to the live GLB idle-spin symptom, with the IN-02 fallback pre-scoped by concrete measurement"
affects: [12-11 (pending human-verify outcome)]

tech-stack:
  added: []
  patterns:
    - "Final-delta re-clamp pattern: when a persisted, cross-frame smoothed value is diffed against a per-frame-recomputed base to derive an applied delta, the persisted value's own bound (proven only relative to ITS OWN frame's base at write time) does not transitively bound the delta against a LATER frame's base if the base itself can jump discontinuously — a second re-clamp at the point of final application is required, independent of any earlier per-target clamp"
    - "Empirical applicability diagnosis before declaring a fix complete: write a throwaway headless diagnostic against the REAL bundled asset (not a synthetic proxy) to test BOTH of a hypothesis's untested assumptions (does the discontinuity exist? is the mechanism even active in the observed state?) before assuming a code-level fix resolves a live symptom — mirrors 12-08's 'measure before fixing' precedent, applied here to falsify rather than confirm"

key-files:
  created: []
  modified:
    - packages/react/src/animation/gaze.ts
    - packages/react/src/animation/gaze.test.ts

key-decisions:
  - "Task 1's CR-01 fix landed regardless of Task 2's applicability verdict — it is a correct invariant fix on its own merits (the documented MAX_GAZE_ANGLE_RAD bound must hold unconditionally, not only when the base pose is stable), independent of whether it turns out to be THE cause of the live GLB idle-spin symptom"
  - "Task 2's real-asset diagnostic found gaze is PROVABLY INACTIVE in the exact state /glb-avatar-test's GLB idle plays under: chatStatus is permanently \"stopped\" on that page (KhaveeProvider's default; the page has no chat/connect action to ever change it), and resolveMode(\"stopped\") is gaze.ts's full no-op branch (Pitfall 5) — it returns before ANY read or write of the head bone. This directly falsifies CR-01's untested assumption (b) from the plan"
  - "Verdict: CR-01 NOT SUFFICIENT / FALLBACK PRIMARY — Task 1's fix is real and correct but cannot be the cause of the observed idle-spin, because the code path it fixes never executes on the page where the spin was observed"
  - "The diagnostic found a DIFFERENT, concrete, real-asset-verified discontinuity that IS active in the observed state and is unrelated to gaze.ts entirely: happy.glb's own \"State 1 Idle (loop)\" clip has an authored head-bone loop-seam discontinuity of ~0.202 rad (~11.6 degrees, 4.04x MAX_GAZE_ANGLE_RAD) at its wrap boundary (mixer.time ~11.34s, clip duration 11.333s) — this is baked into the clip itself, driven directly by THREE.AnimationMixer, with no gaze/breathing/sway interaction required to produce a visible head snap"
  - "breathing.step/sway.step (the IN-02 fallback surface) were also measured directly in the observed state (amplitudeScale=SETTLE_SCALE=0.15, matching chatStatus===\"stopped\") and found small: max single-frame spine delta ~0.00586 rad (~0.34 degrees, 0.117x the gaze bound) — an order of magnitude too small to plausibly read as a visible \"spin/twist\" on its own"
  - "12-11 (if the Task 3 human-verify reports the spin persists) should investigate the idle clip's OWN loop-seam continuity (its authored head-bone keyframes at/near the wrap boundary) as the PRIMARY fallback candidate — not breathing.ts/sway.ts, which this plan's measurement shows are too small in magnitude to be the visible cause"

requirements-completed: []
requirements-pending: [GAZE-02]

duration: TBD (in progress — Task 3 is a blocking human-verify checkpoint)
completed: null
---

# Phase 12 Plan 10: Gaze Final-Delta Re-Clamp (CR-01) + Empirical GLB Idle-Spin Applicability Diagnosis Summary

**Landed a correct invariant fix (final-delta re-clamp bounding the applied gaze delta under a discontinuous base-pose jump, RED-first TDD) in gaze.ts, then empirically determined via a real-asset headless diagnostic that this fix is NOT the cause of the still-open GLB idle-spin symptom — gaze is provably inactive on the page where the spin is observed, and the actual discontinuity lives in happy.glb's own idle-clip loop seam, independent of gaze.ts.**

## Performance

- **Started:** 2026-07-18
- **Tasks:** 2/3 completed (Task 3 is a BLOCKING human-verify checkpoint — this plan is paused there, not finished)
- **Files modified (committed):** 2 (`packages/react/src/animation/gaze.ts`, `packages/react/src/animation/gaze.test.ts`)
- **Files created then deleted (throwaway, not committed):** 1 (`packages/react/scripts/tmp-diagnose-glb-idle-headpose.mjs`)

## Task 1: RED-First Regression Test + CR-01 Final-Delta Re-Clamp + WR-02 Doc Correction

**RED evidence (observed against pre-fix gaze.ts, per the plan's requirement to record this before proceeding to the fix):**

| Test | Setup | Observed angle (rad) | vs. MAX_GAZE_ANGLE_RAD (0.05) |
|---|---|---|---|
| Test A (camera mode, "ready") | Converge fully from identity base with a front-facing camera, then jump the base ~8 deg (0.14 rad) around Y, step once more | **0.1766123415933892 rad** (~10.12 deg) | 3.53x the bound |
| Test B (aversion mode, "thinking", camera=null) | Same base-jump setup, no camera dependency | **0.0822062137154008 rad** (~4.71 deg) | 1.64x the bound |

Both closely match the reviewer's independently-measured 0.177 rad for an 8-degree jump (`12-REVIEW-wave7.md` CR-01), confirming the bug reproduces identically via this plan's own harness before any fix landed.

**GREEN fix:** Added `_scratchBoundedEasedTarget`, a new module-scoped scratch quaternion (never `new` inside `stepGaze`'s body — verified 0 per-frame allocations). Immediately before deriving the final delta, `state.smoothedTarget`'s snapshot (`_scratchEasedTarget`) is re-clamped to `MAX_GAZE_ANGLE_RAD` from THIS frame's `_scratchCurrent` using the same `angleTo()` + `copy().slerp()` idiom already used for the earlier per-target clamp — a second, independent application of the same idiom, not a refactor of the first. `state.smoothedTarget` itself is left unmutated by this re-clamp so it keeps drifting/re-converging naturally on subsequent frames (no permanent clipping of the persisted smoothing state).

**WR-02 doc correction:** The file header's steps 4-5 narrative previously implied the `MAX_GAZE_ANGLE_RAD` bound held unconditionally once smoothing was applied. Updated to explicitly document that the persisted `smoothedTarget` can legitimately drift beyond the bound relative to a NEW discontinuous base, and that step 5's final re-clamp (not step 4's smoothing) is what GUARANTEES the applied bound — citing 12-10/CR-01.

**Verification (all green):**
- `pnpm exec vitest run src/animation/gaze.test.ts`: 22/22 passing (20 pre-existing + 2 new)
- `pnpm test` (full `packages/react` suite): 152/152 passing
- `npx tsc --noEmit`: clean (exit 0)
- `grep -n "angleTo" gaze.ts`: 3 call sites within `stepGaze` (existing target-clamp, frontal-range, and the NEW final-delta re-clamp)
- 0 `new THREE.*` allocations inside `stepGaze`'s body
- `git diff --name-only`: only `gaze.ts` + `gaze.test.ts` (no GAZE-01/GEST scope touched)

**Commit:** `3f3876b` — `fix(12-10): re-clamp gaze final delta to bound discontinuous base-pose jumps (CR-01)`

## Task 2: Empirical Applicability Diagnosis (Real happy.glb)

Wrote one throwaway headless Node diagnostic (`packages/react/scripts/tmp-diagnose-glb-idle-headpose.mjs`, mirroring `verify-head-axis.mjs`'s GLTFLoader-against-the-real-asset methodology), ran it, recorded the numbers below, then deleted it. No committed source was changed by this task (`git diff --name-only` after deletion shows nothing new beyond Task 1's already-committed diff; `git status --porcelain` shows no stray `tmp-diagnose*` files).

**Q1 — Does happy.glb's "State 1 Idle (loop)" clip discontinuously jump the head bone's base pose (assumption (a))?**

Driven through a real `THREE.AnimationMixer` for one full cycle plus wrap:
- Clip duration: 11.3333s
- **Max single-frame head-bone delta: 0.201815 rad (~11.56 degrees) — 4.04x MAX_GAZE_ANGLE_RAD**
- Occurred at `mixer.time ≈ 11.344s`, i.e. exactly at the loop-seam wrap boundary (just past the clip's own duration)

**Yes — the clip itself has a real, measurable, authored head-bone loop-seam discontinuity**, independent of any procedural system.

**Q2 — Is gaze even ACTIVE in the state the observed idle plays under (assumption (b))?**

Traced the real code path: `src/app/glb-avatar-test/page.tsx` mounts `<GLBAvatar>` inside a bare `<KhaveeProvider>` with no chat/voice pipeline and no connect action anywhere on the page. `KhaveeProvider.tsx`'s `chatStatus` `useState` default is `"stopped"`, and nothing on this page ever calls `setChatStatus`. `gaze.ts`'s `resolveMode("stopped")` returns `"none"` — the module's Pitfall-5 full no-op branch, which returns before touching the head bone at all.

**No — gaze is provably, permanently inactive on `/glb-avatar-test`.** This directly falsifies CR-01's assumption (b): the code path Task 1 fixed never executes in the state where the human observed the spin.

**Q3 — Do breathing.step/sway.step produce a non-trivial spine/chest delta in this state (IN-02 fallback scope)?**

Measured breathing+sway composed additively on top of the clip-driven spine base, at `amplitudeScale = SETTLE_SCALE = 0.15` (the real production value while `chatStatus === "stopped"` with `currentAnimation === null`, matching this page's default — `dampProceduralOnManualClip`'s guard does not trigger since no manual clip override is active):
- **Max single-frame procedural-only spine delta: 0.005858 rad (~0.34 degrees) — 0.117x MAX_GAZE_ANGLE_RAD**

Small — an order of magnitude below the clip's own loop-seam jump (Q1) and well below anything plausibly visible as a "spin/twist" on its own.

### Verdict: **"CR-01 NOT SUFFICIENT / FALLBACK PRIMARY"**

Gaze is a no-op in the observed state (Q2 = false), so Task 1's fix — while a correct, real invariant fix landed regardless (it closes a genuine, reproducible bug for any consumer that DOES exercise gaze-active chatStatus values on GLB, e.g. a real chat session) — cannot be the cause of the still-open `/glb-avatar-test` idle-spin symptom. The concrete, measured fallback signal for 12-11 is **happy.glb's own idle-clip loop-seam discontinuity (Q1: ~11.6 degrees at the wrap boundary)**, not breathing/sway (Q3: too small, ~0.34 degrees) and not gaze.ts (Q2: inactive). If Task 3's human-verify still shows the spin, 12-11 should investigate the idle clip's own authored keyframes at/near its loop boundary (a clip-asset/loop-continuity issue, likely fixable by re-exporting the clip with matched start/end poses or applying a mixer-level loop-boundary smoothing pass) — not gaze.ts, breathing.ts, or sway.ts, all three of which this plan's measurements show are either inactive or too small in the exact observed state.

No committed source was touched by Task 2 (measurement-only, per the plan's explicit scope).

## Task 3: BLOCKING Human Verification — NOT YET RUN

**Status: PAUSED at checkpoint.** Per the plan's `gap_closure: true` / `autonomous: false` frontmatter and this checkpoint's `gate="blocking"`, the executor STOPS here and does not attempt to run the dev server or self-approve. A human must verify live against `/glb-avatar-test` (happy.glb, "State 1 Idle (loop)") whether:
1. The idle spin/twist is now gone (pass/fail gate for GAZE-02), and
2. Gaze easing on GLB is not regressed (12-07/12-09 PASS must hold).

Given this plan's own Task 2 verdict ("CR-01 NOT SUFFICIENT / FALLBACK PRIMARY"), the expected outcome per the plan's own cross-check instruction is that **the spin will likely still be present** — that is not a failure of this plan's work, it is the expected, pre-scoped result given gaze.ts was never the cause in this specific state. If the human confirms the spin persists, the plan's `<resume-signal>` for "gap remains" applies verbatim: a 12-11 gap-closure round should investigate the idle-clip loop-seam / breathing/sway fallback surface (per this plan's Q1/Q3 measurements pointing specifically at the clip's own loop seam), NOT re-diagnose gaze.ts.

## Files Created/Modified

- `packages/react/src/animation/gaze.ts` — new module-scoped `_scratchBoundedEasedTarget` scratch; final-delta re-clamp immediately before deriving `_scratchDelta`, bounding the applied angle to `MAX_GAZE_ANGLE_RAD` from the current frame's base regardless of how far the persisted `state.smoothedTarget` has drifted; file header steps 4-5 corrected to document this as the actual source of the guarantee (WR-02)
- `packages/react/src/animation/gaze.test.ts` — new describe block "stepGaze — bounded delta under a discontinuous base-pose jump between frames (12-10 gap closure, CR-01/WR-01 regression)" with Test A (camera mode) and Test B (aversion mode), both RED-first confirmed then GREEN after the fix

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

None — the plan's own two-untested-assumptions framing anticipated exactly this outcome (CR-01 landing correctly but potentially not being the live cause), and Task 2's action explicitly required concluding with one of the two named verdicts. No Rule 1-4 deviations were needed; the throwaway diagnostic script and its deletion followed the plan's explicit instructions verbatim.

## Known Stubs

None.

## Threat Flags

None — this plan touches only internal, non-exported quaternion math (gaze.ts/gaze.test.ts) and a throwaway diagnostic script that was deleted before completion; no new trust boundary, network surface, or persisted data path was introduced.

## Issues Encountered

- This worktree had no `node_modules` installed (fresh worktree checkout does not inherit the main repo's install) — `pnpm install --frozen-lockfile` was run first (uses the existing, unmodified `pnpm-lock.yaml`; same environment-setup deviation documented in 12-08-SUMMARY.md, not repeated here as a tracked deviation since it made no code/lockfile change).
- `packages/phases/12-gaze-gesture/12-10-PLAN.md` existed only as an untracked file in the main repo working tree at spawn time (not yet committed there) and was not present in this worktree's checked-out history; it was copied into the worktree so the plan's own tasks could be read and executed. This file is intentionally left uncommitted by this executor — plan-file lifecycle is owned by the orchestrator/plan-phase step, not by plan execution.

## Next Phase Readiness

- Task 1's CR-01 fix is a real, committed, permanent invariant fix — any future consumer that exercises gaze-active chatStatus values (`ready`/`listening`/`speaking`/`thinking`) on GLB now has the bounded-delta guarantee even under a discontinuous mixer/clip-switch base-pose jump, closing a genuine correctness gap regardless of this specific page's outcome.
- **This plan does NOT close GAZE-02 or Phase 12.** Task 3 (blocking human-verify) has not run. The orchestrator must spawn a continuation agent to present the Task 3 checkpoint to the human and handle the resume flow (either sign off GAZE-02 as PASS, unexpected given Task 2's verdict, or record "gap remains" and scope a 12-11 round per this SUMMARY's fallback guidance).
- If 12-11 is needed, it should start from this plan's Q1/Q3 measurements: investigate `happy.glb`'s "State 1 Idle (loop)" clip's own authored loop-seam keyframes (the ~11.6-degree head-bone jump at the wrap boundary), not gaze.ts (inactive in this state) or breathing.ts/sway.ts (too small, ~0.34 degrees).

---
*Phase: 12-gaze-gesture*
*Status: Task 1-2 complete, Task 3 (blocking human-verify) pending*

## Self-Check: PASSED

- FOUND: packages/react/src/animation/gaze.ts
- FOUND: packages/react/src/animation/gaze.test.ts
- FOUND: .planning/phases/12-gaze-gesture/12-10-SUMMARY.md
- FOUND commit 3f3876b (fix(12-10): re-clamp gaze final delta to bound discontinuous base-pose jumps (CR-01))
- CONFIRMED: packages/react/scripts/tmp-diagnose-glb-idle-headpose.mjs does not exist (throwaway deleted)
