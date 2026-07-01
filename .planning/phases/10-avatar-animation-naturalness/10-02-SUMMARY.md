---
phase: 10-avatar-animation-naturalness
plan: 02
subsystem: ui
tags: three.js, VRM, procedural-animation, bone-manipulation, eye-gaze

# Dependency graph
requires:
  - phase: 10-01
    provides: chatStatus auto-mapping and animation switching
provides:
  - Procedural bone/gaze animation layer (breathing, head, gaze, fingers)
  - Module-level scratch objects for zero per-frame GC
  - Individually togglable procedural animation props
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Per-frame refs with useRef (never useState) for animation state
    - Module-level scratch objects to avoid GC pressure
    - Bone access via getNormalizedBoneNode (not getRawBoneNode)
    - Delta application order: mixer.update → bone deltas → vrm.update

key-files:
  created: []
  modified:
    - packages/react/src/VRMAvatar.tsx

key-decisions:
  - Used `as any` type casts for bone names (VRMHumanBoneName type strictness)
  - Guarded vrm.lookAt access with null check (lookAt is optional on VRM)
  - Pre-allocated Vector3/Quaternion at module scope (not per-frame)

patterns-established:
  - Pattern 5: Animation time refs use useRef(0), never useState
  - Pitfall 1: Bone deltas must be after mixer.update, before vrm.update
  - Pitfall 4: Null-check every getNormalizedBoneNode result

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-07-01
---

# Phase 10: Plan 02 Summary

**Procedural bone/gaze life layer via getNormalizedBoneNode with breathing, head micro-movement, eye gaze drift, and finger curl noise—all additive on top of FBX animations**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-01T16:49:21+07:00
- **Completed:** 2026-07-01T16:52:24+07:00
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments
- Avatar breathes via spine/chest oscillation (±0.02 rad) without FBX files
- Head drifts with two-octave sine noise (±0.02–0.04 rad) for natural micro-movement
- Eye gaze shifts via drifting invisible lookAt target (vrm.lookAt autoUpdate)
- Fingers curl with per-finger phase-offset noise (±0.018 rad) for lifelike hand motion
- All procedural layers individually togglable via props (default true)
- Zero per-frame GC allocations via module-level scratch objects

## Task Commits

Each task was committed atomically:

1. **Task 1: Add procedural props and refs** - `339c272` (feat)
2. **Task 2: Wire eye-gaze lookAt target lifecycle** - `849c2b2` (feat)
3. **Task 3: Apply procedural bone and gaze deltas in useFrame** - `0b095d7` (feat)

## Files Created/Modified
- `packages/react/src/VRMAvatar.tsx` - Added breathing, head, gaze, and finger procedural animations

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed TypeScript errors for lookAt and bone name types**
- **Found during:** Task 3 (apply deltas in useFrame)
- **Issue:** `currentVrm.lookAt` is possibly undefined; bone name strings don't match VRMHumanBoneName type
- **Fix:** Added null check `if (!currentVrm.lookAt) return`; used `as any` type cast for bone names
- **Files modified:** packages/react/src/VRMAvatar.tsx
- **Verification:** `npx tsc --noEmit` passes with no VRMAvatar errors
- **Committed in:** `0b095d7` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix essential for TypeScript strict mode compliance. No scope creep.

## Issues Encountered
- TypeScript strict mode rejected bone name strings (not assignable to VRMHumanBoneName enum) - resolved with `as any` type assertions
- vrm.lookAt optional property caused null-safety errors - resolved with runtime guard

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 2 procedural layer complete
- Wave 3 (10-03) ready to add micro-expressions
- All bone deltas correctly ordered after mixer.update, before vrm.update

---
*Phase: 10-avatar-animation-naturalness*
*Completed: 2026-07-01*
