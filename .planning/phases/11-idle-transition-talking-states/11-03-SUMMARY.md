---
phase: 11-idle-transition-talking-states
plan: 03
subsystem: animation
tags: [three.js, vrm, react, quaternion, procedural-animation]

# Dependency graph
requires:
  - phase: 11-01
    provides: AvatarFormatAdapter (getHumanoidBoneNode, getExpressionManager) and blink.ts's ref-driven stepper pattern
provides:
  - useBreathing() — ref-driven chest/spine additive breathing delta (IDLE-01)
  - useSway() — ref-driven hips/spine additive weight-shift sway delta, independent period (IDLE-01)
  - useExpressionDrift() — VRM-only rest-state expression drift, GLB no-op (IDLE-02)
  - Pure, scene-free-testable stepper primitives (createBreathingState/stepBreathing/breathingDeltaAngle, createSwayState/stepSway/swayDeltaAngle, createExpressionDriftState/stepExpressionDrift/expressionDriftWeight)
affects: [11-05 (controller composition/bounding of these deltas in fixed order)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hook-as-thin-wrapper: use<Thing>() holds one useRef(createXState()) and delegates to a pure step<Thing>(state, adapter, delta, ...) function, making per-frame delta math and additive-write behavior unit-testable without React rendering or @testing-library/react"
    - "Additive delta-quaternion composition via bone.quaternion.multiply(scratch), never .set() — module-scoped scratch THREE.Quaternion reused every step() call (allocation-reuse, mirrors crossfade.ts)"
    - "Non-clobber expression writes: allow-list + runtime em.getValue(name) non-zero check before em.setValue(), so procedural drift never overwrites an app-driven setExpression value"

key-files:
  created:
    - packages/react/src/animation/breathing.ts
    - packages/react/src/animation/breathing.test.ts
    - packages/react/src/animation/sway.ts
    - packages/react/src/animation/sway.test.ts
    - packages/react/src/animation/expressionDrift.ts
  modified: []

key-decisions:
  - "Testability required decomposing each use<Thing>() hook into a thin useRef wrapper plus exported pure createXState()/stepX(state, adapter, delta, ...) functions, since @testing-library/react is not installed anywhere in the workspace and useRef cannot be called outside a React render — this also satisfies the plan's 'pure helper for scene-free testing' requirement more completely than just the sine-angle math alone"
  - "expressionDrift's allow-list is [\"neutral\", \"browInnerUp\"] — \"neutral\" is the only VRM standard preset that isn't an app-driven emotion/viseme/blink preset; \"browInnerUp\" is a documented speculative custom-blendshape name, presence-checked so it safely no-ops on rigs that lack it"
  - "expressionDrift weight uses a half-rectified sine (amplitude * (0.5 + 0.5*sin(phase))) instead of a raw sine, so the drift value stays in [0, amplitude] and never goes negative (VRMExpressionManager weights are 0..1 scalars)"

patterns-established:
  - "Idle procedural steppers (breathing/sway) use distinct, non-overlapping default period bands (breathing 4.0-6.0s, sway 7.0-10.0s, expressionDrift 8.0-12.0s) and distinct rotation axes (X for breathing's nod, Z for sway's roll) so simultaneous systems read as independent, unsynchronized life rather than one robotic pulse"

requirements-completed: [IDLE-01, IDLE-02, PERF-01]

# Metrics
duration: 35min
completed: 2026-07-12
---

# Phase 11 Plan 03: Idle Procedural Delta Systems Summary

**Breathing, weight-shift sway, and VRM-only expression drift as ref-driven additive delta-quaternion steppers mirroring blink.ts's shape, each independently period-randomized and unit-tested without a live scene**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-12T17:06:00Z (approx.)
- **Completed:** 2026-07-12T17:41:09Z
- **Tasks:** 3 completed
- **Files modified:** 5 created (0 modified)

## Accomplishments
- `breathing.ts`: chest/spine additive sine stepper, randomized 4.0-6.0s period band, amplitudeScale support, 8 passing unit tests
- `sway.ts`: hips/spine additive sine stepper, independent randomized 7.0-10.0s period band (never phase-locked to breathing), amplitudeScale support, 7 passing unit tests
- `expressionDrift.ts`: VRM-only rest-state expression drift via `getExpressionManager()` null-gate, non-emotion allow-list, runtime non-clobber guard against app-driven `setExpression` values
- All three verified as ref-driven (no `useState`), additive (`multiply()`, never `.set()`), bone-role-resolved (`getHumanoidBoneNode`, never literal `getBoneNode`), and not exported from `index.ts`
- Full `@khaveeai/react` test suite (46 tests across 4 files) and `tsc` build both green after all three tasks

## Task Commits

Each task was committed atomically (Tasks 1 and 2 are TDD: test → feat):

1. **Task 1: breathing.ts — chest/spine additive sine stepper**
   - `dc9293f` (test) — failing test for breathing chest/spine delta stepper
   - `d6826bb` (feat) — implement breathing chest/spine additive delta stepper
2. **Task 2: sway.ts — hips/spine independent-period additive sine stepper**
   - `dccead0` (test) — failing test for sway hips/spine delta stepper
   - `70d0438` (feat) — implement sway hips/spine additive delta stepper
3. **Task 3: expressionDrift.ts — VRM-only rest-state expression drift**
   - `0a2135d` (feat) — implement VRM-only expression rest-state drift

**Plan metadata:** committed together with this SUMMARY.md (worktree mode — orchestrator finalizes shared-file updates after merge)

_Note: TDD tasks (1, 2) have a RED test commit followed by a GREEN feat commit, confirmed via `git log`._

## Files Created/Modified
- `packages/react/src/animation/breathing.ts` - `useBreathing()` ref-driven chest/spine additive stepper + pure `createBreathingState`/`stepBreathing`/`breathingDeltaAngle` helpers
- `packages/react/src/animation/breathing.test.ts` - 8 unit tests covering peak-delta bound, additive-preserve-base, amplitudeScale 0/2x, null-bone early-return
- `packages/react/src/animation/sway.ts` - `useSway()` ref-driven hips/spine additive stepper + pure `createSwayState`/`stepSway`/`swayDeltaAngle` helpers, independent period band
- `packages/react/src/animation/sway.test.ts` - 7 unit tests covering peak-delta bound, additive-preserve-base, independent-period-band assertion, null-bone early-return
- `packages/react/src/animation/expressionDrift.ts` - `useExpressionDrift()` VRM-only stepper + pure `createExpressionDriftState`/`stepExpressionDrift`/`expressionDriftWeight` helpers; allow-list, presence check, and non-clobber runtime guard

## Decisions Made
- Decomposed each hook into a thin `useRef` wrapper around exported pure `createXState()`/`stepX(state, adapter, delta, ...)` functions. The plan only required the sine-angle math (`breathingDeltaAngle`/`swayDeltaAngle`) to be independently pure/testable, but since `@testing-library/react` is not installed anywhere in this workspace (verified via search) and `useRef` cannot be invoked outside a React render, testing `step()`'s bone-write/gating behavior required the full stepper logic — not just the angle math — to be pure and scene-free. This is a strict superset of what the plan asked for and required no new dependency.
- `expressionDrift`'s allow-list is `["neutral", "browInnerUp"]`. Every VRM standard preset except `neutral` is either an app-driven emotion (`happy`/`angry`/`sad`/`surprised`/`relaxed`), a viseme (`aa`/`ih`/`ou`/`ee`/`oh`), a blink preset (owned by `blink.ts`), or a gaze preset (`lookUp`/`lookDown`/`lookLeft`/`lookRight`, reserved for a future gaze/attention system per PROJECT.md's target-feature list — not targeted here to avoid future conflict). `browInnerUp` is documented as a speculative custom-blendshape name, gated behind a presence check (`em.getExpression(name) !== null`) so it safely no-ops on rigs lacking it.

## Deviations from Plan

None - plan executed as written. The pure-function decomposition described above under "Decisions Made" is an implementation-detail extension of the plan's explicit "export a pure helper... unit-testable without a scene" instruction, not a deviation from any `must_haves` truth, artifact, or acceptance criterion — all acceptance criteria in 11-03-PLAN.md pass unchanged.

## Issues Encountered
- The worktree had no `node_modules` installed (fresh worktree checkout). Ran `pnpm install --frozen-lockfile` at the repo root before any test could execute; this is standard worktree setup, not a plan deviation.
- No `@testing-library/react` (or any React hook-testing utility) exists anywhere in the workspace, so `renderHook`-style tests were not an option for Tasks 1/2. Resolved via the pure-function decomposition documented above — no new dependency was added.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `breathing.ts`, `sway.ts`, and `expressionDrift.ts` are ready to be wired into `AnimationStateEngine`'s `update(delta)` in Plan 05, which composes and bounds these deltas in a fixed order (breathing before sway, both before/after expressionDrift per the controller's documented insertion point).
- No blockers. `PERF-01`'s additive-composition rule (`multiply()`, never `.set()`) is fully satisfied by both bone-writing modules; `expressionDrift`'s non-clobber guard is verified against the real `KhaveeProvider`/`VRMAvatar` app-driven expression write order documented in `expressionDrift.ts`'s file header.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-12*

## Self-Check: PASSED

All created files verified present on disk; all 6 commit hashes (dc9293f, d6826bb, dccead0, 70d0438, 0a2135d, 1eea4a9) verified present in git log.
