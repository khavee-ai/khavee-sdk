---
phase: 10-avatar-animation-naturalness
plan: 03
subsystem: animation
tags: [vrm, micro-expressions, procedural-animation, react, threejs]

# Dependency graph
requires:
  - phase: 10-02
    provides: procedural breathing, head movement, eye gaze, and finger gesture layers
provides:
  - Status-based micro-expression scheduler (idle/listening/thinking/speaking)
  - Complete procedural animation layer with all five boolean toggle props
  - Public VRMAvatarProps API with JSDoc documentation
  - Verified barrel exports for AnimationConfig and VRMAvatarProps
affects: [consumer-facing avatar naturalness, developer DX for animation control]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Additive expression blending (micro-expressions + developer values, capped at 1.0)
    - Status-driven animation state machine (effectiveStatus maps ready→idle)
    - Per-frame procedural animation pipeline (bone deltas → developer expressions → micro-expressions → blinking → vrm.update)

key-files:
  created: []
  modified:
    - packages/react/src/VRMAvatar.tsx - Micro-expression scheduler, enableMicroExpressions prop, complete JSDoc
    - packages/react/src/index.ts - Added VRMAvatarProps to barrel exports

key-decisions: []
patterns-established:
  - "Status-based micro-expressions: Different curated targets per chatStatus (idle/listening/thinking/speaking)"
  - "Additive blending: Micro-values compose over developer-set values, never override"
  - "Null-guard pattern: Check expressionManager.getValue(name) !== null before setValue to handle models missing expression names"

requirements-completed: []

# Metrics
duration: 5min
completed: 2026-07-01
---

# Phase 10: Plan 03 (Wave 3 — micro-expressions + final exports) Summary

**Status-based micro-expression scheduler with additive blending and complete procedural animation layer documentation**

## Performance

- **Duration:** 5 min (4:47 execution time)
- **Started:** 2026-07-01T09:56:36Z
- **Completed:** 2026-07-01T10:01:23Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- Implemented D-07 micro-expression schedule with status-based targets (idle→relaxed, listening→happy+surprised, thinking→neutral, speaking→none)
- Added additive blending: micro-expressions compose over developer-set values, capped at 1.0 (Open Question 2 resolution)
- Created complete public API surface: VRMAvatarProps with JSDoc for all five new boolean toggle props
- Verified barrel exports include AnimationConfig and VRMAvatarProps for consumer type safety

## Task Commits

Each task was committed atomically:

1. **Task 1: Add enableMicroExpressions prop and scheduler refs** - `78c82fe` (feat)
2. **Task 2: Implement micro-expression scheduler in useFrame** - `50f5a15` (feat)
3. **Task 3: Update JSDoc, props documentation, and barrel exports** - `84aae74` (feat)

**Plan metadata:** [pending final commit]

_Note: TDD tasks may have multiple commits (test → feat → refactor)_

## Files Created/Modified
- `packages/react/src/VRMAvatar.tsx` - Added enableMicroExpressions prop, microExprTimeRef/nextExprChangeRef/currentExprTargetsRef refs, micro-expression scheduler in useFrame with D-07 schedule, complete component and field-level JSDoc, exported VRMAvatarProps interface
- `packages/react/src/index.ts` - Added VRMAvatarProps to barrel exports alongside AnimationConfig

## Decisions Made
- **D-07 Schedule Implementation:** Used effectiveStatus = chatStatus === "ready" ? "idle" : chatStatus to map ChatStatus to animation schedule keys
- **Additive Blending (Open Question 2):** Micro-expressions add to developer-set values (expressions[name] ?? 0) and cap at Math.min(1, devValue + microTarget) to prevent overriding explicit user intent
- **Null-Guard Pattern (T-10-04):** Check expressionManager.getValue(name) !== null before setValue to handle VRM models that don't support all expression names
- **Export Strategy:** Exported VRMAvatarProps from both the component file and barrel for TypeScript consumers who want to extend the props interface

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **TypeScript strict-mode error during Task 2:** `currentVrm.expressionManager` flagged as possibly undefined inside forEach callback despite outer guard. Fixed by saving expressionManager to local variable `const exprManager = currentVrm.expressionManager` before Object.entries() loop to satisfy TypeScript's control flow analysis.
- **Syntax error during Task 3:** Stray `*/` comment terminator on line 75 from earlier interface duplication. Fixed by removing the extra `*/` and ensuring clean comment block structure.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 10 (avatar-animation-naturalness) Wave 3 complete: all three waves (chatStatus auto-mapping, procedural bone/gaze layers, micro-expressions + documentation) finished
- VRMAvatar now has complete procedural animation layer with five boolean toggles (enableBreathing, enableHeadMovement, enableEyeGaze, enableHandGestures, enableMicroExpressions) all defaulting to true
- Public API surface documented with JSDoc and barrel exports verified
- Ready for consumer testing and subsequent phases

---
*Phase: 10-avatar-animation-naturalness*
*Completed: 2026-07-01*
