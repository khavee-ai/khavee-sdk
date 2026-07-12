---
phase: 10-shared-animation-architecture-crossfade-engine
plan: 02
subsystem: animation
tags: [react, three.js, vitest, vrm, crossfade, blink, state-machine]

# Dependency graph
requires:
  - "10-01: packages/react/src/animation/crossfade.ts (beginCrossfade/stepCrossfade/BlendState)"
  - "10-01: packages/react/src/animation/types.ts (AvatarFormatAdapter)"
provides:
  - "packages/react/src/animation/blink.ts: useBlink() ref-driven blink stepper, adapter-gated, GLB no-op"
  - "packages/react/src/animation/AnimationStateEngine.ts: resolveBaseClip pure fn + useAnimationController hook"
affects: [10-03, 10-04, phase-11-procedural-motion, phase-13-public-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ref-driven procedural delta gated on adapter.getExpressionManager() null-check (not a format-capability flag) — GLB is an automatic no-op"
    - "useAnimationController composes useBlink() + crossfade.ts's beginCrossfade/stepCrossfade behind one update(delta) call, with blend/current-action bookkeeping in useRef (never useState)"
    - "Frame-ordering contract documented in code: mixer.update(delta) -> controller.update(delta) -> vrm.update(delta) — mixer ownership stays with the component"

key-files:
  created:
    - packages/react/src/animation/blink.ts
    - packages/react/src/animation/AnimationStateEngine.ts
    - packages/react/src/animation/AnimationStateEngine.test.ts
  modified: []

key-decisions:
  - "resolveBaseClip's speaking-state talk-clip match uses the same /talk|gesture|speak/i regex GLBAvatar's old setTimeout loop-back used, preserving today's clip-selection behavior while dropping the timer"
  - "useAnimationController takes a getRoot accessor (VRM: scene, GLB: groupRef.current) separate from getBoneNode, matching the plan's interface note that getBoneNode stays reserved for future per-bone procedural work"
  - "Comments documenting the 'no live-clock timer' constraint were phrased to avoid the literal strings setTimeout/setInterval, since the plan's own verification grep (`! grep -Eq 'setTimeout|setInterval' AnimationStateEngine.ts`) matches prose comments as well as code"

requirements-completed: [ANIM-01, XFADE-01]

# Metrics
duration: 14min
completed: 2026-07-12
---

# Phase 10 Plan 02: Blink Migration + AnimationStateEngine Summary

**Migrated the blink procedural delta into a ref-driven, adapter-gated module (D-01) and built the shared `resolveBaseClip` state resolver + `useAnimationController` hook that triggers 10-01's pose-gap-adaptive crossfade on target-clip change, replacing the setTimeout-driven loop-back both avatar components used before.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-12T14:16:xx+07:00 (first task commit)
- **Completed:** 2026-07-12T14:21:33+07:00
- **Tasks:** 2 completed
- **Files modified:** 3 (3 created, 0 modified)

## Accomplishments
- `useBlink()` — the exact refs and per-frame blink logic from `VRMAvatar.tsx:308-317`/`516-553`, ported verbatim (same `Date.now()` timing, same `+= 0.15` step, same `Math.sin(... * Math.PI)` curve), rewritten to read/write through `adapter.getExpressionManager()` so it is an automatic no-op on GLB (adapter returns `null`) instead of something only `VRMAvatar` could run
- `resolveBaseClip` — pure function mapping `chatStatus`/manual `animate()` override to a target base-clip name, unit-tested across all 6 `ChatStatus` values plus null-`currentAnimation` and empty-`availableNames` edge cases (9 tests, all green)
- `useAnimationController` — the single hook both `VRMAvatar` and `GLBAvatar` will consume in 10-03/10-04: on a resolved target-clip change it calls `beginCrossfade` (from 10-01), advances it via `stepCrossfade` and steps blink from one `update(delta)` call, with blend/current-action state held in `useRef` (never `useState`)
- Zero live-clock mechanisms (`setTimeout`/`setInterval`) anywhere in `packages/react/src/animation/` — verified via grep across the whole directory, not just the new files
- `packages/react/src/index.ts` still does not export the `animation/` module (internal-only convention preserved)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate the blink system into the procedural delta layer (D-01)** - `ec1a62e` (feat)
2. **Task 2: Build the AnimationStateEngine (state layer resolver + useAnimationController)** - `e2d9155` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/react/src/animation/blink.ts` - `useBlink()`: ref-driven blink stepper (`blinkState`, `nextBlinkTime`, `isBlinking`, `blinkAnimationRef` refs), `step(adapter, enabled)` gated on `enabled` and a non-null `adapter.getExpressionManager()`
- `packages/react/src/animation/AnimationStateEngine.ts` - `resolveBaseClip(chatStatus, currentAnimation, availableNames)` pure resolver; `useAnimationController(params)` hook composing `useBlink()` + `beginCrossfade`/`stepCrossfade`, returning `{ update(delta) }`
- `packages/react/src/animation/AnimationStateEngine.test.ts` - 9 unit tests covering all 6 `ChatStatus` values, the speaking-with/without-talk-clip branch, null-`currentAnimation` fallback to `availableNames[0]`, and empty-everything -> `null`

## Decisions Made
- Kept the speaking-state talk-clip match regex (`/talk|gesture|speak/i`) identical to `GLBAvatar.tsx`'s old `setTimeout` loop-back's filter, so this phase changes *how* the target clip is applied (eased crossfade, no timer) without changing *which* clip gets selected — avoids conflating a behavior-preserving migration with an unrelated selection-logic change
- Added a `getRoot: () => THREE.Object3D | null` param to `useAnimationController` (VRM passes `scene`, GLB will pass `groupRef.current`) rather than overloading `getBoneNode`, per the plan's explicit interface note — `getBoneNode` stays adapter-level for future per-bone procedural work in Phase 11
- Reworded the two prose comments that would otherwise have contained the literal strings `setTimeout`/`setInterval` (e.g. "live-clock-driven" instead of "setTimeout-driven") because the plan's own automated verification (`! grep -Eq "setTimeout|setInterval" AnimationStateEngine.ts`) is a literal string match with no comment/code distinction — this is a documentation-wording adjustment only, no logic changed

## Deviations from Plan

None - plan executed exactly as written. One environment-setup step was required but is not a plan deviation: this worktree had no `node_modules` installed (fresh worktree checkout), so `pnpm install` was run once before any verification command could execute; this is standard worktree bootstrapping, not a code change.

## Issues Encountered
None beyond the environment bootstrapping noted above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `useBlink()` and `useAnimationController` are ready for 10-03 (`VRMAvatar.tsx` wiring, including the `vrmAdapter` object and `useFrame` reordering) and 10-04 (`GLBAvatar.tsx` wiring, including removal of the dead second `AnimationMixer` and the `setTimeout` loop-back it currently owns)
- `packages/react/src/index.ts` remains unchanged — the `animation/` module stays internal-only per ANIM-01/wayfinder ticket #8
- `useAnimationController`'s frame-ordering contract (`mixer.update` -> `controller.update` -> `vrm.update`) is documented in-code as the insertion point Phase 11's additive bone-delta layer will use

## Self-Check: PASSED

All created files verified on disk and all task commits verified in git log:
- `packages/react/src/animation/blink.ts` - FOUND
- `packages/react/src/animation/AnimationStateEngine.ts` - FOUND
- `packages/react/src/animation/AnimationStateEngine.test.ts` - FOUND
- `.planning/phases/10-shared-animation-architecture-crossfade-engine/10-02-SUMMARY.md` - FOUND
- `ec1a62e` (Task 1) - FOUND
- `e2d9155` (Task 2) - FOUND
- `b49d96b` (SUMMARY commit) - FOUND

---
*Phase: 10-shared-animation-architecture-crossfade-engine*
*Completed: 2026-07-12*
