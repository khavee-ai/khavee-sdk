---
phase: 12-gaze-gesture
plan: 04
subsystem: animation
tags: [react, three.js, gaze, gesture, animation-controller, context]

# Dependency graph
requires:
  - phase: 12-gaze-gesture
    plan: 02
    provides: gaze.ts's useGaze()/stepGaze() camera-relative head-tracking module
  - phase: 12-gaze-gesture
    plan: 03
    provides: gesture.ts's useGesture()/stepGesture() triggered nod/shake pulse module
provides:
  - KhaveeProvider.tsx's gestureHint field + PUBLIC setGestureHint (validated LLM-enum setter)
  - useAnimationController's camera/gestureHint/onGestureConsumed params and gaze/gesture composition steps 10/11
affects: [avatar-component-wiring (VRMAvatar.tsx/GLBAvatar.tsx must pass camera + gestureHint + onGestureConsumed to complete GAZE-01/02 and GEST-01/02 end-to-end, not yet done by this plan), 12-05, 12-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Public vs internal-only context setter divergence: setGestureHint is public (LLM tool execute callback lives outside the React tree) while currentVolume's setter stays internal-only (driven from inside KhaveeProvider by the realtime provider's own event) — same context object, deliberately different visibility per writer origin"
    - "Hook-under-test via minimal useRef/useEffect mock (vi.mock('react')) instead of a full React renderer — used only where a controller hook itself (not just its exported pure functions) needed direct assertion, scoped to a single test file"

key-files:
  created: []
  modified:
    - packages/react/src/KhaveeProvider.tsx
    - packages/react/src/animation/AnimationStateEngine.ts
    - packages/react/src/animation/AnimationStateEngine.test.ts

key-decisions:
  - "setGestureHint is public on useKhavee() (unlike currentVolume's setter) because its writer is typically an LLM tool's execute callback, supplied by app code outside the React tree — there is no other reachable path for that code to signal a gesture"
  - "setGestureHint validates against the nod/shake/none allow-list and stores null for none/unrecognized/null, never throwing — mirrors setExpression's clamp-not-throw convention and satisfies T-12-04 (tampering mitigation)"
  - "gaze (step 10) composes before gesture (step 11) in update()'s fixed order, since gesture is a discrete pulse layered on top of gaze's continuous camera-relative offset, not vice versa"
  - "useAnimationController's new params (camera, gestureHint, onGestureConsumed) are all optional, following the currentVolume?/dampProceduralOnManualClip? convention, so existing callers (VRMAvatar.tsx/GLBAvatar.tsx pre-wiring) remain unaffected"
  - "Tested useAnimationController itself (not just its exported pure helpers) via a file-scoped vi.mock('react') replacing only useRef/useEffect with minimal single-call-safe equivalents, since this repo has no React renderer devDependency (@testing-library/react, react-test-renderer) and adding one is a package-manager install outside this plan's scope — verified safe because every hook this controller composes uses only useRef/useEffect, never useState or reconciliation-dependent APIs"

requirements-completed: [GAZE-01, GAZE-02, GEST-01, GEST-02]

# Metrics
duration: ~20min
completed: 2026-07-18
---

# Phase 12 Plan 04: Wire gestureHint + Gaze/Gesture into useAnimationController Summary

**`KhaveeProvider.tsx` now exposes a public, enum-validated `setGestureHint`, and `useAnimationController` steps `useGaze()`/`useGesture()` as appended composition steps 10/11 — the wiring that makes GAZE-01/02 and GEST-01/02 actually run every frame, closing the gap both 12-02 and 12-03 explicitly left for this plan.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-18T02:12:22+07:00
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `gestureHint: "nod" | "shake" | null` and a **public** `setGestureHint(gesture: string | null)` to `KhaveeContextType`/`KhaveeProvider.tsx`, deliberately diverging from `currentVolume`'s internal-only setter: the writer is an LLM tool's `execute` callback supplied outside the React tree, so it must be reachable via `useKhavee()`. The setter validates against the `nod`/`shake`/`none` allow-list and stores `null` for `none`/unrecognized/`null` — never throws (T-12-04 mitigation).
- Imported and instantiated `useGaze()`/`useGesture()` inside `useAnimationController`, extended its params with optional `camera`, `gestureHint`, and `onGestureConsumed`, and appended two new composition steps to `update()`: step 10 (gaze — continuous, camera-relative, guarded on `camera` truthiness) and step 11 (gesture — discrete pulse, wired to `currentActionRef.current` and `onGestureConsumed`). Steps 1-9 are untouched and unreordered (grep-verified).
- Added 4 new controller-level tests exercising `update()` directly (not just pure helper functions), using a file-scoped `vi.mock("react")` to make `useAnimationController` callable outside a React renderer — verifying backward-compatibility (no camera/gestureHint), the D-06 immediate-trigger path (`onGestureConsumed` fires once outside `speaking`), the combined camera+gesture path, and that no spurious trigger fires when `gestureHint` is omitted.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add gestureHint + public validated setGestureHint to KhaveeProvider** - `0c31e37` (feat)
2. **Task 2: Integrate gaze + gesture into useAnimationController composition order** - `9a8c136` (feat)

## Files Created/Modified

- `packages/react/src/KhaveeProvider.tsx` - `gestureHint` field + public `setGestureHint` (enum-validated, clamp-not-throw) added to `KhaveeContextType`, backing `useState`, and the context value object
- `packages/react/src/animation/AnimationStateEngine.ts` - `useGaze`/`useGesture` imports + instantiation; `camera?`/`gestureHint?`/`onGestureConsumed?` params; composition-order header comment extended to steps 10-11; `update()` appends `if (camera) gaze.step(...)` (step 10) and `gesture.step({...})` (step 11) after talk-cycle
- `packages/react/src/animation/AnimationStateEngine.test.ts` - new `describe("useAnimationController — gaze/gesture integration (12-04)")` block (4 tests) plus a file-scoped `vi.mock("react")` enabling direct hook invocation

## Decisions Made

- `setGestureHint` public visibility divergence from `currentVolume` — see key-decisions above; this is the plan's one deliberate departure from the otherwise-followed `currentVolume` precedent, explicitly called for by the plan's own `<action>` block (RESEARCH Pitfall 3).
- Gaze before gesture in composition order (step 10 then 11) — gesture is a discrete pulse meant to layer on top of gaze's continuous offset, matching the plan's explicit ordering rationale.
- All three new `useAnimationController` params are optional, preserving backward compatibility with any pre-existing caller that doesn't yet pass camera/gestureHint.
- Chose a minimal `vi.mock("react")` (only `useRef`/`useEffect` overridden) over adding a React-renderer devDependency, since every hook in this controller's dependency chain uses exclusively those two primitives — confirmed via `grep -n "^import.*react"` across every `animation/*.ts` module before writing the tests.

## Deviations from Plan

**1. [Clarification, not a Rule 1-4 deviation] Added controller-level tests via a `vi.mock("react")` harness not explicitly specified in the plan's `<action>` text.** The plan's Task 2 action explicitly requires "AnimationStateEngine.test.ts test cases asserting: (a) update() runs without throwing when camera/gestureHint are omitted... (b) ...onGestureConsumed is called... (c) existing controller tests still pass" — but the file's own pre-existing header comment states `useAnimationController` "is verified by build here (tsc --noEmit) and by integration in 10-03/10-04," and the repo has no React-renderer devDependency to actually invoke a hook. Rather than skip requirement (a)/(b) or add a new dependency (a package install, out of scope per the deviation rules' package-manager-install exclusion), a file-scoped mock of just `useRef`/`useEffect` was used to make `useAnimationController` directly callable and assertable, satisfying the plan's literal test requirements without introducing new dependencies or touching any other test file's behavior. Verified safe: full 144-test suite passes unchanged plus 4 new tests.

No Rule 1-4 auto-fixes were needed — no bugs, missing critical functionality, blocking issues, or architectural changes were encountered.

## Issues Encountered

- The worktree has no `node_modules` installed (git worktrees don't carry gitignored directories) — `pnpm test`/`tsc` couldn't run directly from the worktree, matching 12-02's documented precedent. Verified by running `vitest` from the main checkout with `--root` pointed at the worktree, and by temporarily symlinking the main checkout's `node_modules` into the worktree for `tsc --noEmit`, removing the symlink immediately after each check (confirmed via `git status --short` — no symlink or environment artifact was committed).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `KhaveeProvider.tsx` and `useAnimationController` are both wired and tested; `tsc --noEmit` is clean and all 144 react-package tests pass (140 pre-existing + 4 new).
- **Not yet done by this plan** (out of this plan's `files_modified` scope, matching 12-02/12-03's own precedent of staged, separate integration steps): `VRMAvatar.tsx`/`GLBAvatar.tsx` do not yet pass `camera` (e.g. via `useThree().camera` or `useFrame`'s `state.camera`) or `gestureHint`/`onGestureConsumed` (from `useKhavee()`) into `useAnimationController`'s call site. Until that final avatar-component wiring lands, gaze/gesture are fully implemented and unit-tested but not yet visually active in a running app — this is the natural next step for a subsequent plan in this phase (12-05/12-06 per the phase's own plan sequence).
- No blockers identified for that follow-up wiring: the params are additive/optional, so the avatar components can adopt them independently without touching this plan's code again.

---

*Phase: 12-gaze-gesture*
*Completed: 2026-07-18*

## Self-Check: PASSED

- FOUND: packages/react/src/KhaveeProvider.tsx (modified, gestureHint + setGestureHint present)
- FOUND: packages/react/src/animation/AnimationStateEngine.ts (modified, useGaze/useGesture wired, steps 10/11 present)
- FOUND: packages/react/src/animation/AnimationStateEngine.test.ts (modified, 4 new controller-level tests added, 55 total)
- FOUND: commit 0c31e37 (feat(12-04): add gestureHint + public setGestureHint to KhaveeProvider)
- FOUND: commit 9a8c136 (feat(12-04): integrate gaze + gesture into useAnimationController)
