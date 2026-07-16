---
phase: 11-idle-transition-talking-states
plan: 13
subsystem: animation
tags: [react, three.js, vrm, crossfade, procedural-animation, gap-closure, headless-diagnostic, pure-function-extraction]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: "11-11's resetToRestPoseIfNotDriven fix (which resolved G2 but left G1's true pre-connect case unfixed) and 11-12's decisive human re-check finding G1 still failing plus two new findings (G3 Y-drop-on-connect, G4 talk-cycle jiggle)"
provides:
  - "Headless runtime evidence CONFIRMING H-G1 (the crossfade-trigger effect's single pre-connect run happens while clips/root are unresolvable, and never re-fires since targetName/chatStatus don't change again before Connect), H-G3 (a real, smooth, always-present hips-Y settle motion SHARED with G1 -- currently surfaces on Connect purely because G1 delays switchToClip's first success), and H-G4 (resetToRestPoseIfNotDriven fires during a talk-variant switch's near-zero-weight window even though the outgoing action is still meaningfully contributing -- an INDEPENDENT mechanism from G1/G3)"
  - "shouldTriggerClipSwitch: new exported, pure function centralizing the 'should switchToClip (re-)run' decision (including the TALK-01/TRANS-01 speaking-variant guard), called identically by both the crossfade-trigger useEffect AND a new per-frame retry in update() -- this per-frame retry is what actually fixes G1, since update() runs every animation frame regardless of React re-renders"
  - "isBaseActionMeaningfullyDriving: new exported, pure function distinguishing 'no action has ever driven the skeleton' (true first-mount, still resets to the rest-pose anchor) from 'mid-crossfade between two real actions' (the mixer's own blend already produces a continuous pose -- resetting to a stale anchor there was the G4 jiggle)"
affects: [11-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-decision pure-function extraction for a useEffect + imperative-loop pair: rather than trusting a useEffect's dependency array alone to catch every state transition, extract the 'should this side effect (re-)run' predicate into an exported pure function and call it from BOTH the effect (change-driven) and an already-existing per-frame imperative loop (update(), a self-terminating retry) -- closes dependency-array-timing gaps a React effect alone cannot cover without adding fragile new dependency-array signals."
    - "Distinguish 'never driven' from 'mid-transition between two real drivers' via an explicit from-action non-null check, rather than gating solely on the incoming/target driver's own ramped weight -- avoids conflating two different states that need different treatment (reset-to-anchor vs. trust-the-live-blend)."
    - "Headless production-path replay extended one level further (11-09 -> 11-11 -> 11-13): now replays not just beginCrossfade/stepCrossfade timing but the FULL pre-connect ordering sequence (effect fires once while unready -> becomes ready without any dependency change -> N simulated frames with no re-fire), directly measuring the exact gap a prior fix's own harness never covered."

key-files:
  created: []
  modified:
    - packages/react/src/animation/AnimationStateEngine.ts
    - packages/react/src/animation/AnimationStateEngine.test.ts

key-decisions:
  - "Diagnosed all three hypotheses (H-G1, H-G3, H-G4) via a faithful headless replay of the REAL production path (real public/models/male.vrm + Idle.fbx/talking.fbx/talking1.fbx loaded via GLTFLoader.parse()+VRMCoreLoaderPlugin, the real remapMixamoAnimationToVrm retargeter, the real beginCrossfade/stepCrossfade from crossfade.ts) rather than reasoning from code alone -- all three hypotheses were CONFIRMED by measurement (not disproven, unlike 11-11's round), and the shared-vs-independent determination (G1+G3 shared, G4 independent) was likewise evidence-based, not assumed."
  - "Per the plan-checker's blocking requirement, extracted the G1 fix into a new exported, pure, unit-testable function (shouldTriggerClipSwitch) that the useEffect and update()'s new per-frame retry BOTH call -- this is deliberately not a hand-rolled replay of 'what the effect does' in the test file, closing the exact gap that let 11-10/11-12's rounds ship G1 fixes that passed their own tests while the live app stayed broken."
  - "Chose a per-frame retry inside update() (which already runs every animation frame via useFrame, regardless of React re-renders) over adding a new 'clips/root readiness' signal to the useEffect's dependency array -- a new dependency-array signal risks reintroducing a TALK-01-style double-trigger (the exact failure mode the existing getAction/getRoot deps-omission comment already documents), whereas a self-terminating per-frame check (shouldTriggerClipSwitch returns false once currentClipNameRef matches targetName) is safe to call unconditionally every frame with no new re-render surface."
  - "G4's fix (isBaseActionMeaningfullyDriving) explicitly does NOT lower MIN_BASE_ACTION_WEIGHT or remove resetToRestPoseIfNotDriven's anchor-reset for the true first-mount case -- it only adds an additional 'or the from-action is real and non-null' condition, preserving the 11-09/11-11 bounded-accumulation invariant for the case that still needs it while skipping the reset for the case that doesn't (verified by two contrasting regression tests: NEW behavior stays at the mixer's own blend within floating-point tolerance; OLD behavior in the identical window snaps ~0.079rad toward the bind anchor, matching the diagnostic's measured magnitude)."
  - "G3 was determined to be SHARED with G1 (not independent) based on direct measurement: the hips Y motion, driven purely by the SAME crossfade this file already runs, ramps smoothly (totalDelta ~1.008, maxSingleFrameDelta ~0.094, ~9% of total -- no single frame dominates) across the crossfade duration -- it is real, always-present motion that has simply never been visible before because G1 prevented switchToClip from ever succeeding pre-connect. No separate G3-specific code change was made; fixing G1 structurally fixes G3 by moving the same settle to load time."

patterns-established:
  - "shouldTriggerClipSwitch(params): exported, pure, unit-testable decision function called identically by a React useEffect AND an imperative per-frame loop -- the correct pattern anywhere a useEffect's dependency array cannot express 'a dependency of the readiness check, not the trigger value itself, changed' (here: clips/root readiness, not targetName/chatStatus)."
  - "isBaseActionMeaningfullyDriving(currentAction, blendFromAction): exported, pure, unit-testable predicate distinguishing 'never driven' from 'mid-transition between two real drivers' -- the correct pattern anywhere a procedural additive layer needs to know not just 'is the target action ready' but 'is SOMETHING real already driving this frame's base pose.'"

requirements-completed: []  # NOT populated -- this plan's own <verification> section explicitly defers decisive visual confirmation to the 11-14 blocking human-verify checkpoint (this is the fourth round; G1/related requirements have failed human re-verification twice already at 11-10 and 11-12). Headless/unit evidence below confirms the code-level fix is landed and matches the diagnosed mechanism, but requirement completion is not claimed until 11-14 confirms it live.

# Metrics
duration: ~70min (headless diagnostic harness build/iteration + fix + regression tests)
completed: 2026-07-17
---

# Phase 11 Plan 13: Fourth gap-closure pass — G1/G3/G4 root-caused via headless production-path replay and fixed with a shared pure-function extraction (shouldTriggerClipSwitch, isBaseActionMeaningfullyDriving) Summary

**Headless replay of the real pre-connect effect-ordering sequence confirmed G1's actual mechanism (the crossfade-trigger effect's single pre-connect run happens while clips/root are unresolvable and never gets a chance to re-fire), found G3 shares that root cause, found G4 is an independent resetToRestPoseIfNotDriven trigger-condition bug, and fixed both via two new exported pure functions (shouldTriggerClipSwitch, isBaseActionMeaningfullyDriving) that a per-frame update() retry and the existing useEffect both call identically.**

## Performance

- **Duration:** ~70 min (headless VRM/FBX diagnostic harness build + iteration + Node ESM loader workaround, fix, regression tests)
- **Started:** ~2026-07-17T02:20Z (approx, prior to first commit)
- **Completed:** 2026-07-17T02:37Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments

- Built a headless diagnostic harness (Node `--experimental-strip-types` + a small custom ESM resolve hook to handle this codebase's extensionless relative imports, which Node's native loader cannot resolve on its own) that loads the REAL `public/models/male.vrm` via `GLTFLoader.parse()` + `VRMCoreLoaderPlugin` and `Idle.fbx`/`talking.fbx`/`talking1.fbx` via the real `remapMixamoAnimationToVrm`, driving the REAL `beginCrossfade`/`stepCrossfade` from `crossfade.ts` with a deterministically-advanced `performance.now()` (11-11 precedent).
- **H-G1 (pre-connect effect-ordering): CONFIRMED.** Replayed the exact pre-connect sequence: (1) the crossfade-trigger effect's single mount-time run with clips/root NOT yet resolvable — `switchToClip` returns early; (2) clips/root become resolvable on a later render WITHOUT `targetName`/`chatStatus` changing (both are already `"idle"`/`"stopped"` from `KhaveeProvider`'s initial state); (3) ran `update()`'s bone-writing steps for 90 simulated frames with no further `switchToClip` call. Measured: `currentActionRef` stays null and the idle action's weight stays exactly 0 for all 90 frames — the exact case 11-11's own harness never covered (11-11 only ever replayed frames where `currentActionRef` was ALREADY non-null).
- **H-G3 (Y-drop on connect): CONFIRMED SHARED with G1.** `remapMixamoAnimationToVrm` normalizes the hips position track's first keyframe Y to exactly `0`, while the VRM's actual bind-pose local hips Y measured `~1.008`. Empirically running a real `beginCrossfade(null, idleAction, root)` + `mixer.update()` across 30 sampled frames showed a smooth ramp (`totalDelta ≈ 1.008`, `maxSingleFrameDelta ≈ 0.094`, ~9% of total — no discontinuity), confirming this is real, always-present motion that only becomes visible on Connect because G1 delays `switchToClip`'s first success.
- **H-G4 (talk-cycle jiggle): CONFIRMED, INDEPENDENT of G1/G3.** Replayed a real idle (fully driven) -> talking crossfade and sampled the spine bone across the incoming action's first 5 near-zero-weight frames, while the outgoing (idle) action still contributed ~0.98-1.0 weight. `resetToRestPoseIfNotDriven` (gated only on the incoming action's own weight) fired every one of those frames, snapping the torso ~0.079rad toward the bind anchor away from the mixer's own live idle->talking blend — the reported jiggle.
- Fixed G1/G3 by extracting the "should `switchToClip` run" decision into a new exported, pure `shouldTriggerClipSwitch()` (mandated by the plan-checker blocker), called identically by the crossfade-trigger `useEffect` (change-driven) and a new `update()` step 0 (a self-terminating per-frame retry — `update()` already runs every animation frame regardless of React re-renders, closing the gap a dependency-array-only fix cannot).
- Fixed G4 by adding `isBaseActionMeaningfullyDriving()`, which also treats a real, non-null `blendRef.current.from` (the outgoing action) as "driving" — distinguishing the true first-mount case (still resets to the anchor, unchanged from 11-11) from mid-crossfade between two real actions (reset skipped; the mixer's own continuous blend plus unconditional breathing/sway is trusted instead).
- Recorded the full runtime-evidenced diagnosis and fix rationale as a new `11-13 gap closure` file-header block in `AnimationStateEngine.ts`, additive to (not replacing) the existing 11-09/11-11 blocks.
- Added 13 new regression tests (93/93 total, up from 80/80): 6 for `shouldTriggerClipSwitch` (including the exact pre-connect readiness-transition case), 1 end-to-end test wiring the pure function through a real `beginCrossfade`/`stepCrossfade` ramp, 4 for `isBaseActionMeaningfullyDriving`, and 2 contrasting `resetToRestPoseIfNotDriven` regression tests (NEW behavior stays at the mixer's blend within floating-point tolerance; OLD behavior in the identical window reproduces the ~0.079rad snap). The pre-existing 11-09 first-mount spin repro and 11-11 G2 non-snap multi-frame-ramp tests remain present, unmodified, and green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Diagnose G1/G3/G4 at runtime — record evidence, do NOT fix yet** - `b0cec5d` (fix — instrumentation + header diagnosis only, no production behavior change)
2. **Task 2: Fix G1/G3/G4 targeting the confirmed cause(s)** - `068176c` (fix — shouldTriggerClipSwitch + isBaseActionMeaningfullyDriving + regression tests)

**Plan metadata:** committed alongside this SUMMARY (see final commit in git log)

## Files Created/Modified

- `packages/react/src/animation/AnimationStateEngine.ts` — new `11-13 gap closure` file-header diagnosis block (recording the H-G1/H-G3/H-G4 CONFIRMED findings and shared-vs-independent determination, additive to the 11-09/11-11 blocks); new exported `shouldTriggerClipSwitch()` (centralizes the crossfade-trigger decision, including the TALK-01/TRANS-01 speaking-variant guard); new exported `isBaseActionMeaningfullyDriving()` (G4 fix); crossfade-trigger `useEffect` now a thin caller of `shouldTriggerClipSwitch`; `update()` gained a new step 0 (per-frame retry calling the same function) and step 4b now calls `isBaseActionMeaningfullyDriving` instead of `shouldRunProceduralBoneWrites` alone.
- `packages/react/src/animation/AnimationStateEngine.test.ts` — 13 new tests across 4 new `describe` blocks: `shouldTriggerClipSwitch` (6 tests, including the pre-connect readiness-transition case that directly exercises the shipped hook's logic), "G1 fix wired end-to-end through switchToClip" (1 test, real `beginCrossfade`/`stepCrossfade` ramp verification), `isBaseActionMeaningfullyDriving` (4 tests), "G4 fix — resetToRestPoseIfNotDriven does not snap the torso..." (2 contrasting tests).

## Decisions Made

- Diagnosed via a faithful headless replay of the REAL production path and the REAL pre-connect ordering sequence, not code-reading alone — this is what actually confirmed all three hypotheses with concrete measurements (currentActionRef/weight staying at 0 for 90 frames; a smooth ~1.008-unit hips-Y ramp; a ~0.079rad spine snap), rather than relying on assumption.
- Per the plan's explicit plan-checker blocker, extracted the G1 fix into `shouldTriggerClipSwitch` — a new exported, pure function called by BOTH the `useEffect` and `update()`'s new per-frame retry — so the new G1 regression test exercises the exact same decision logic the shipped hook uses, closing the gap that let two prior rounds (11-10, 11-12) ship G1 fixes that passed their own tests while the live app stayed broken.
- Chose a per-frame retry inside `update()` over adding a new dependency-array signal to the `useEffect` — `update()` already runs every animation frame via `useFrame` regardless of React re-renders, so it naturally catches "clips/root just became resolvable" on the very next frame without introducing a new re-render trigger that could reintroduce a TALK-01-style double-trigger (the exact risk the existing `getAction`/`getRoot` deps-omission comment already documents).
- G4's fix explicitly preserves the true first-mount reset (11-09/11-11's invariant) and only adds a narrower "or a real from-action exists" condition, rather than lowering `MIN_BASE_ACTION_WEIGHT` or removing the reset outright (both of which the file header explicitly warns against) — verified via two contrasting regression tests that reproduce both the fixed (no-snap) and old (snap) behaviors in the identical simulated window.
- G3 was determined SHARED with G1 via direct measurement (a smooth, always-present hips-Y ramp driven by the SAME crossfade), so no separate G3-specific code change was made — fixing G1 structurally fixes G3.
- `requirements-completed` intentionally left empty in this SUMMARY's frontmatter: this plan's own `<verification>` section explicitly defers decisive visual/live confirmation to the 11-14 blocking human-verify checkpoint, and G1's underlying requirements have already failed human re-verification twice (11-10, 11-12) despite passing headless/unit evidence at the code level each time — completion is not claimed here.

## Deviations from Plan

None — plan executed exactly as written, including the mandatory headless production-path replay for all three hypotheses and the plan-checker-mandated pure-function extraction for the G1 fix.

## Issues Encountered

- Node's native ESM loader (`node --experimental-strip-types`) cannot resolve this codebase's extensionless relative imports (e.g. `from "./crossfade"`), which the project's bundler-based `moduleResolution` supports but Node's runtime loader does not, and Node 23 removed the older `--experimental-specifier-resolution=node` flag that would have handled this automatically. Resolved by writing a small custom ESM resolve hook (`scratch-resolve-hook.mjs`, registered via `--experimental-loader`) that appends `.ts` to extensionless relative specifiers when the `.ts` file exists on disk. Both the diagnostic script and this loader helper were deleted before either commit — `git status --short` confirmed clean before staging each task.
- The diagnostic script's first draft had two measurement bugs, both fixed before recording final evidence: (1) `idleAction.getEffectiveWeight()` read THREE's unrelated newly-constructed-action default (1) instead of reflecting "was this action ever actually driven" — fixed by explicitly zeroing its weight before the measurement loop; (2) a `performance.now()` reset between `beginCrossfade` and the subsequent `stepCrossfade` sampling loop produced negative elapsed time (garbage/negative weight readings) — fixed by continuing to advance `simulatedMs` from the blend's actual `startTime` rather than resetting it.
- A first version of the "NEW behavior stays at the mixer's own blend" regression test asserted exact `0` deviation but measured a `~5e-8` floating-point residual from `THREE.Quaternion` slerp/copy operations — relaxed to `toBeLessThan(1e-5)`, still several orders of magnitude tighter than the ~0.079rad the contrasting OLD-behavior test measures.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three confirmed mechanisms (G1 pre-connect stall, G3 shared Y-settle, G4 independent talk-cycle jiggle) have a targeted, tested code-level fix landed. `AnimationStateEngine.ts` carries the full runtime-evidenced diagnosis in its `11-13 gap closure` file-header block for 11-14's human re-verification to cross-reference.
- Full `@khaveeai/react` test suite green: 93/93 across 7 suites (up from 80/80 in 11-11/11-12), including the preserved, unmodified 11-09 first-mount spin repro and 11-11 G2 non-snap multi-frame-ramp tests. `tsc --noEmit` clean in `packages/react`.
- `MIN_BASE_ACTION_WEIGHT` unchanged (0.05); `crossfade.ts` unmodified (`git diff --stat` confirms).
- Per this plan's own `<verification>` section, decisive visual confirmation (no pre-connect T-pose, no Y-drop on connect, no talk-cycle jiggle, plus a full 7-requirement regression pass — G2 was already confirmed approved by 11-12 and does not need re-verification unless a subsequent fix touches the same crossfade code path) is deferred to 11-14's blocking human-verify checkpoint. This is the fourth round targeting G1's requirement set; the previous two live re-checks (11-10, 11-12) both found the code-level fix insufficient despite passing headless/unit evidence, so 11-14's live re-check remains the decisive gate — no requirement is claimed complete in this plan's frontmatter.
- No STATE.md/ROADMAP.md/REQUIREMENTS.md updates were made by this worktree agent per the orchestrator's instructions; the orchestrator should record this plan's outcome and the pending 11-14 checkpoint when merging this worktree's results back.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-17*

## Self-Check: PASSED

`packages/react/src/animation/AnimationStateEngine.ts`, `packages/react/src/animation/AnimationStateEngine.test.ts`, and this SUMMARY.md confirmed present on disk. Commits `b0cec5d` (Task 1 diagnosis), `068176c` (Task 2 fix), and `bb81283` (this SUMMARY) confirmed present in `git log --oneline --all`.
