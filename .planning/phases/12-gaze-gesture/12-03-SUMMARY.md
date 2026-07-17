---
phase: 12-gaze-gesture
plan: 03
subsystem: animation
tags: [gesture, talk-cycle, procedural-motion, react]
dependency-graph:
  requires: []
  provides:
    - packages/react/src/animation/talkCycle.ts#detectLoopBoundary
    - packages/react/src/animation/gesture.ts
  affects:
    - packages/react/src/animation/AnimationStateEngine.ts (future consumer — wiring is a later plan's scope)
tech-stack:
  added: []
  patterns:
    - "Pure loop-boundary detector extracted once, reused by two independent consumers (talk-cycle + gesture) to prevent drift on edge cases"
    - "Triggered one-shot pulse mirroring blink.ts's sin(anim*PI) envelope, applied additively via bone.quaternion.multiply()"
key-files:
  created:
    - packages/react/src/animation/gesture.ts
    - packages/react/src/animation/gesture.test.ts
  modified:
    - packages/react/src/animation/talkCycle.ts
    - packages/react/src/animation/talkCycle.test.ts
decisions:
  - "GESTURE_AMPLITUDE=0.25rad / GESTURE_DURATION_SECONDS=0.5s chosen (Claude's Discretion per 12-CONTEXT.md) as a visibly deliberate nod/shake — larger than breathing's ~0.03rad idle amplitude, longer than blink's ~150ms envelope, since a gesture must read as an intentional communicative signal"
  - "Gesture state's prevActionTime is tracked independently of talkCycle.ts's own TalkCycleState.prevActionTime — each detectLoopBoundary consumer owns its own previous-time sample per the plan's interface contract"
metrics:
  duration: "~35 min"
  completed: "2026-07-18"
---

# Phase 12 Plan 03: Extract detectLoopBoundary + Implement gesture.ts Summary

Extracted talkCycle.ts's inline loop-boundary wrap-detection into a reusable pure `detectLoopBoundary` function, then built `gesture.ts` — a triggered, consumed-and-cleared one-shot bone-delta pulse for LLM-triggered nod/shake gestures — reusing that extracted primitive so gesture queuing during `speaking` and talk-cycle variant-switching can never disagree on where a loop boundary is.

## What Was Built

### Task 1: `detectLoopBoundary` extraction (talkCycle.ts)
- Added `export function detectLoopBoundary(currentTime, prevTime, duration): boolean` capturing exactly the boolean decision from the previous inline block (lines ~96-109): false on null/non-positive-duration/no-prior-sample, true on a frame-over-frame time decrease (wrap) or a crossing of `duration` without wrapping (e.g. a non-looping clip clamped at its end), false otherwise.
- `stepTalkCycle` now calls `detectLoopBoundary(currentTime, state.prevActionTime, duration)` for its boundary decision; the `state.prevActionTime = currentTime` mutation stays in the caller, unchanged in timing/placement from before the refactor.
- Added 7 new `detectLoopBoundary` test cases (null currentTime/duration, non-positive duration, null prevTime, wrap, crossing, mid-clip no-boundary). All 9 pre-existing `stepTalkCycle` test cases pass unmodified — confirms the extraction is behavior-preserving.

### Task 2: `gesture.ts` (new)
- `createGestureState()` → `{ activeGesture: null, elapsed: 0, prevActionTime: null }`.
- `stepGesture(state, params)` where `params` = `{ adapter, chatStatus, gestureHint, currentAction, delta, onConsume }`, mirroring `talkCycle.ts`'s params-object convention.
- Trigger logic (D-06/GEST-02): when `activeGesture` is null and `gestureHint` is `"nod"`/`"shake"` — starts immediately when `chatStatus !== "speaking"`; when `chatStatus === "speaking"`, starts only once `detectLoopBoundary(currentAction?.time, state.prevActionTime, currentAction?.getClip().duration)` returns true. `onConsume()` fires exactly once, the frame the pulse begins.
- Playback: rise-then-fall envelope (`Math.sin(progress * Math.PI)`, `progress = min(elapsed/0.5, 1)`) applied as an axis-angle delta on the head bone — X-axis (pitch) for `nod`, Y-axis (yaw) for `shake` — written additively via `head.quaternion.multiply(_scratchGesture)`, a module-scoped scratch quaternion (never `new` in the per-frame path). Clears `activeGesture`/`elapsed` once `elapsed >= 0.5s`.
- `"none"`, `null`, and any unrecognized `gestureHint` value are no-ops (never throw) — satisfies threat T-12-04 (tampering via an out-of-enum tool-call value).
- Defensive early-return (no throw) when `adapter.getHumanoidBoneNode("head")` resolves to null — the trigger latch and `onConsume()` still fire (decoupled from bone resolution), only the bone write is skipped, matching `breathing.ts`'s precedent of returning before any write when a bone is unresolved.
- `useGesture()` — thin `useRef`-backed hook wrapper around `stepGesture`, following `useBreathing()`/`useTalkCycle()`'s shape exactly.
- Not exported from `packages/react/src/index.ts` (verified via grep — matches breathing.ts/blink.ts/sway.ts precedent).

### Test coverage (gesture.test.ts, 13 cases)
Immediate start outside `speaking` (D-06); deferred start mid-clip while `speaking`; start exactly at a simulated loop boundary while `speaking` with `onConsume` firing then; `onConsume` called exactly once across multiple frames of an active pulse; additive (non-overwriting) write preserving a pre-existing base orientation; nod = pure X-axis rotation (y/z components ≈ 0); shake = pure Y-axis rotation (x/z components ≈ 0); `"none"`/`null`/unrecognized-value no-ops; defensive no-throw when the head bone is unresolved; pulse self-clears after its duration; and an explicit documentation-test that `stepGesture` has no re-entrancy guard beyond `activeGesture !== null` (callers must clear the hint via `onConsume` to avoid re-triggering — this is the caller's responsibility per the plan's params contract, not a gesture.ts bug).

## Verification

- `cd packages/react && pnpm test -- talkCycle gesture` — 9 test files, 126 tests, all passing (16 talkCycle + 13 gesture, plus the full existing suite unaffected).
- `cd packages/react && npx tsc --noEmit` — exits 0, no type errors.
- `grep -c "detectLoopBoundary(" talkCycle.ts` = 2 (defined once, called by `stepTalkCycle` once).
- `grep -c "currentTime < state.prevActionTime"` on both files = 0 (no duplicated inline wrap math anywhere).
- `grep -c "\.multiply("` on gesture.ts = 1 real call site (`head.quaternion.multiply(_scratchGesture)`) plus 1 doc-comment mention.
- Module-scoped `_scratchGesture = new THREE.Quaternion()` declared once at module scope — no per-frame allocation.

## Deviations from Plan

None — plan executed exactly as written. `GESTURE_AMPLITUDE`/`GESTURE_DURATION_SECONDS` numeric values were Claude's Discretion per 12-CONTEXT.md (no mandated exact numbers), chosen by extrapolating from `breathing.ts`'s amplitude and `blink.ts`'s envelope duration as instructed.

## Threat Flags

None — both threats in the plan's threat_model (T-12-04, T-12-05) were explicitly mitigated as designed: `gestureHint` narrowing to `"nod"`/`"shake"` only (never throws on out-of-enum values), and the bone write is a bounded, additive `multiply()`-only one-shot that never interrupts a playing clip (queued to the loop boundary during `speaking`). No new network endpoints, auth paths, or trust-boundary-crossing surface was introduced by this plan.

## Known Stubs

None. `gesture.ts` is fully self-contained and functional; it is intentionally not yet wired into `AnimationStateEngine.ts`'s `update()` call site or `KhaveeProvider.tsx`'s context (per 12-CONTEXT.md's Integration Points, that plumbing — threading a gesture-hint signal from a tool's `execute` callback through context into the animation controller — is explicitly deferred to a later plan in this phase, mirroring how Phase 11's `currentVolume` was threaded through). This module and its extracted `detectLoopBoundary` primitive are ready for that wiring but are not consumed by any call site yet.

## Self-Check: PASSED

- FOUND: packages/react/src/animation/talkCycle.ts (modified, detectLoopBoundary exported)
- FOUND: packages/react/src/animation/talkCycle.test.ts (modified, detectLoopBoundary tests added)
- FOUND: packages/react/src/animation/gesture.ts (created)
- FOUND: packages/react/src/animation/gesture.test.ts (created)
- FOUND: commit bbc40c7 (refactor(12-03): extract detectLoopBoundary pure function from talkCycle)
- FOUND: commit 6bda1dc (feat(12-03): implement gesture.ts triggered one-shot bone-delta pulse)
