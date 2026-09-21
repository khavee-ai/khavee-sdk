---
phase: 18-facial-performance-eyes-visemes-emotion
plan: 04
subsystem: animation
tags: [vrm, three.js, react, eye-gaze, viseme, emotion, blink, procedural-animation]

# Dependency graph
requires:
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 01
    provides: "eyeGaze.ts (useEyeGaze/NEUTRAL_EYE_GAZE_BIAS/EyeGazeBias), blink.ts's forceBlink/coupled options"
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 02
    provides: "emotion.ts (useEmotion/EmotionHint), createEmotionTool() in @khaveeai/core"
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 03
    provides: "viseme.ts (useViseme/VisemeChannel/createVisemeChannel)"
provides:
  - "AnimationStateEngine.ts steps 12-14 wiring eye gaze, visemes and emotion into the shared per-frame controller"
  - "selectGestureHint pure helper resolving explicit-vs-emotion-suggested gesture precedence (D-12 gesture)"
  - "useAnimationController's public params extended with emotionHint/onEmotionConsumed/visemeChannel/getNowMs"
affects: [18-05-khaveeprovider-emotion-context, 18-06-demo-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-step ref coupling: a later step's output is stored into a ref and consumed by an EARLIER step on the NEXT frame (forceBlinkRef feeds step 2, emotionCouplingRef feeds steps 8/12), trading one frame of imperceptible latency for a clean single-pass per-frame update() with no reordering"
    - "Single-slot-with-TTL pending-trigger pattern (pendingEmotionGestureRef) for bridging an event-shaped output (emotion's one-shot suggestedGesture) into a state-shaped consumer (gesture.step's per-frame hint), bounding backlog without a queue"

key-files:
  created: []
  modified:
    - packages/react/src/animation/AnimationStateEngine.ts
    - packages/react/src/animation/AnimationStateEngine.test.ts

key-decisions:
  - "selectGestureHint always lets an explicit non-none gestureHint win over an emotion suggestion, and never routes an emotion-sourced gesture's onConsume through onGestureConsumed — this keeps the app/LLM's own gestureHint context state authoritative and un-clearable by a side-channel emotion suggestion (T-18-10)"
  - "emotionCouplingRef/forceBlinkRef intentionally carry the PREVIOUS frame's value into earlier steps rather than reordering steps 2/8/12 after step 14, preserving the file's existing documented step order and its established 11-13/12-04 gap-closure precedent of one-frame-latency ref coupling"
  - "pendingEmotionGestureRef is a single slot (not a queue) with a 4s TTL (EMOTION_GESTURE_TTL_S), so repeated set_emotion tool calls can never build up a gesture backlog (T-18-09)"

patterns-established:
  - "Cross-frame ref coupling for composing independently-tested procedural modules without reordering an already-frame-order-sensitive update() function"

requirements-completed: [EYE-01, EYE-02, VIS-01, VIS-02, VIS-03, EMO-02, EMO-03]

# Metrics
duration: ~35min
completed: 2026-09-21
---

# Phase 18 Plan 04: Facial Performance Controller Wiring Summary

**AnimationStateEngine.ts composes eye-gaze (step 12), viseme (step 13) and emotion (step 14) into the shared per-frame controller, with D-02 blink coupling, D-15 drift suppression, and D-12 gaze-bias/gesture-selection cross-couplings, all covered by 10 new integration tests.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-21 (worktree spawn)
- **Completed:** 2026-09-21
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments
- `AnimationStateEngine.ts` now instantiates `useEyeGaze()`, `useViseme()`, `useEmotion()` alongside the existing 7 procedural hooks and runs them as steps 12-14, every frame, after the existing 11 steps — the file's documented composition-order comment and header are both extended, not reordered.
- `selectGestureHint(explicit, emotionSuggested)` is a new, fully unit-tested pure export: an explicit non-`"none"` `gestureHint` always wins; otherwise an emotion-suggested `"nod"`/`"shake"` plays; the resulting `onConsume` closure only calls `onGestureConsumed` when the explicit path won, so an emotion-sourced gesture can never clear the app/LLM's own gesture-hint context state (T-18-10).
- D-02: `forceBlinkRef` carries step 12's `shiftDetected` result into step 2's `blink.step(..., { forceBlink, coupled: true })` call on the very next frame, and is cleared immediately after read.
- D-15: step 8's `expressionDrift.step` amplitude is multiplied by `emotionCouplingRef.current.driftScale` (the previous frame's emotion output), so drift fades out while an emotion is actively holding the same expression slots, and fades back in once released.
- D-12: the previous frame's `emotion.gazeBias` feeds `eyeGaze.step`'s `bias` param (step 12), and a `suggestedGesture` from step 14 is queued into a single-slot, 4-second-TTL `pendingEmotionGestureRef` (T-18-09) that step 11 ages and offers to `selectGestureHint` alongside the explicit `gestureHint` prop.
- Four new public, JSDoc'd `useAnimationController` params: `emotionHint`, `onEmotionConsumed`, `visemeChannel`, `getNowMs` — all optional, all no-ops when omitted, preserving pre-existing call sites unchanged (verified by a dedicated 60-update backward-compatibility test).
- 10 new tests added to `AnimationStateEngine.test.ts` under `describe("Phase 18 facial steps 12-14 (EYE/VIS/EMO)")`: 4 `selectGestureHint` precedence cases, eye-gaze lookAt wiring, blink-shift coupling across two frames, emotion crossfade-to-steady-intensity + single-consume, emotion-suggested-gesture-never-clears-onGestureConsumed, viseme analysis-to-mouth-shape wiring, and the backward-compatibility 60-update no-throw/no-viseme-write case.
- Full `packages/react` suite: 289/289 passing (70 in `AnimationStateEngine.test.ts`, up from 60), `tsc --noEmit` clean. `gaze.ts`/`gesture.ts`/`expressionDrift.ts` verified byte-for-byte unchanged via `git diff --quiet`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add params, refs, selectGestureHint, and steps 12-14 with cross-couplings** - `391a98c` (feat)
2. **Task 2: Integration tests for steps 12-14 using the existing hook-mock harness** - `edd5227` (test)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified
- `packages/react/src/animation/AnimationStateEngine.ts` - imports `useEyeGaze`/`NEUTRAL_EYE_GAZE_BIAS`/`EyeGazeBias` from `./eyeGaze`, `useViseme`/`VisemeChannel` from `./viseme`, `useEmotion`/`EmotionHint` from `./emotion`; new `selectGestureHint` export; new `EMOTION_GESTURE_TTL_S` constant and module-level `defaultNow()`; four new controller params (`emotionHint`, `onEmotionConsumed`, `visemeChannel`, `getNowMs`); three new refs (`forceBlinkRef`, `emotionCouplingRef`, `pendingEmotionGestureRef`); step 2/8/11 extended with cross-couplings; steps 12-14 appended
- `packages/react/src/animation/AnimationStateEngine.test.ts` - `selectGestureHint` import and a new `describe("Phase 18 facial steps 12-14 (EYE/VIS/EMO)")` block (10 tests) with a combined stub adapter/expression-manager/lookAt helper set, reusing the file's existing `useRef`/`useEffect` mock harness (no renderer dependency added)

## Decisions Made
- Kept `import type { AvatarFormatAdapter } from "./types";` untouched and added a second, separate `import type { LookAtController } from "./types";` line rather than merging the two into one import statement, so the test file's diff against the pre-existing content is purely additive (verified by the plan's own `git diff | grep '^-' | wc -l` acceptance check returning 0).
- `pendingEmotionGestureRef`'s `onConsume` closure clears the ref (rather than calling `onGestureConsumed`) whenever `selectGestureHint`'s `source` is `"emotion"` — this was the one place the plan's cross-coupling logic could have accidentally leaked an emotion-sourced trigger into the app's own gesture-hint lifecycle, so it got its own dedicated regression test (T-18-10).

## Deviations from Plan

None — plan executed exactly as written. One process correction (not a deviation from the plan's content) is documented below because it affected verification, not code:

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Verification commands were initially run against the wrong checkout**
- **Found during:** Task 2, first `pnpm --filter @khaveeai/react exec vitest run ...` after adding the new test `describe` block
- **Issue:** The plan's own `<verify>` command text begins with `cd /Users/whitemalt/Documents/khavee-sdk && pnpm --filter ...`. Running that literally from inside this worktree-isolated agent's shell (whose cwd resets to the worktree root before every Bash call) changed into the **main checkout** for that one command, so `tsc`/`vitest` silently validated the main repo's unmodified copy of `AnimationStateEngine.ts`/`.test.ts` instead of this worktree's edits — the first vitest run reported "60 tests passed" (the pre-Phase-18-04 baseline) with no error, which could have been mistaken for a passing Task 2.
- **Fix:** Re-ran every verification command without the `cd`, directly from the worktree root (`pwd` confirmed `/Users/whitemalt/Documents/khavee-sdk/.claude/worktrees/agent-a3c7fad6102564f4f`), which correctly picked up all 70 tests (60 existing + 10 new).
- **Files modified:** None (verification-only; no source change resulted from this correction beyond the already-planned Task 2 test additions).
- **Verification:** `pnpm --filter @khaveeai/react exec vitest run src/animation/AnimationStateEngine.test.ts` now reports 70/70 from within the worktree; `pnpm --filter @khaveeai/react test` reports 289/289.
- **Committed in:** N/A (no separate commit — verification-only correction, caught before Task 2's `edd5227` commit).

---

**Total deviations:** 1 auto-fixed (1 blocking, verification-only — no code changed as a result beyond the plan's own Task 2 scope)
**Impact on plan:** None on delivered code. Documented so a future executor recognizes this worktree-cwd-reset pitfall rather than trusting a suspiciously-fast/low test-count result.

## Issues Encountered

None beyond the verification-path correction documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `AnimationStateEngine.ts`'s `useAnimationController` now accepts `emotionHint`/`onEmotionConsumed`/`visemeChannel`/`getNowMs` in addition to the pre-existing `gestureHint`/`onGestureConsumed`/`camera` params — 18-05 (`KhaveeProvider.tsx`/`useRealtime.ts`/`useAudioLipSync.ts`) is the next plan to thread real `setEmotionHint`/`setVisemeChannel` context state and the real `createEmotionTool()` wiring through to these params. This plan deliberately did NOT touch those three React files (they were being executed concurrently by 18-05 in a separate worktree) — no merge conflicts expected since this plan's `files_modified` is scoped to `AnimationStateEngine.ts`/`.test.ts` only.
- `VRMAvatar.tsx`/`GLBAvatar.tsx` do not yet pass `emotionHint`/`visemeChannel` into `useAnimationController` — that wiring is also deferred, most likely to 18-05 or 18-06, since it depends on where the avatar components read `useKhavee()`'s emotion/viseme context state from.
- No blockers for 18-05/18-06. `gaze.ts`, `gesture.ts`, `expressionDrift.ts` remain byte-for-byte untouched (verified via `git diff --quiet` per this plan's own verification block).

## Self-Check: PASSED

Both modified files verified present on disk with the expected content
(`grep`-verified exports/comments); both commit hashes (`391a98c`, `edd5227`)
verified present in `git log --oneline -5`.

---
*Phase: 18-facial-performance-eyes-visemes-emotion*
*Completed: 2026-09-21*
