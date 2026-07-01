---
phase: 11-bone-masked-upper-body-animation-layering
plan: 01
subsystem: ui
tags: [three.js, vrm, animation, avatar]

# Dependency graph
requires: []
provides:
  - "filterClipTracksByBoneSet() pure utility for deriving bone-masked THREE.AnimationClip sub-clips"
  - "BASE_LOWER_BONES (10) and UPPER_BONES (42) constants partitioning the VRM humanoid rig per D-01/D-02"
affects: [11-02-vrmavatar-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bone-masked sub-clip derivation via vrm.humanoid.getNormalizedBoneNode() name resolution, never string-matching track names directly"

key-files:
  created: [packages/react/src/utils/filterClipTracksByBoneSet.ts]
  modified: []

key-decisions:
  - "BASE_LOWER_BONES/UPPER_BONES exactly partition mixamoVRMRigMap's 52 distinct bone names (10 + 42, disjoint) per CONTEXT.md D-01/D-02"
  - "Original clip.duration always passed through explicitly to new THREE.AnimationClip(...) — never resetDuration() — to prevent base-lower/upper sub-clip drift (Pitfall 4)"

patterns-established:
  - "Bone-set filtering utility mirrors remapMixamoAnimationToVrm.ts's track.name.split('.') + getNormalizedBoneNode(...)?.name convention"

requirements-completed: [BONE-01]

# Metrics
duration: ~3min
completed: 2026-07-01
---

# Phase 11: Bone-Masked Upper-Body Animation Layering Summary (Plan 01)

**filterClipTracksByBoneSet() utility + BASE_LOWER_BONES/UPPER_BONES bone-split constants, mirroring remapMixamoAnimationToVrm.ts's track-filtering convention**

## Performance

- **Duration:** ~3 min
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments
- `filterClipTracksByBoneSet(clip, vrm, boneNames, newName)` derives a bone-masked `THREE.AnimationClip` by resolving VRM humanoid bone names to per-model normalized rig node names via `vrm.humanoid.getNormalizedBoneNode()`, then filtering `clip.tracks` against that resolved set
- `BASE_LOWER_BONES` (10 bones) and `UPPER_BONES` (42 bones) constants partition the full VRM humanoid rig per D-01/D-02, their union covering all 52 distinct `mixamoVRMRigMap` values with no overlap and no omission
- Original `clip.duration` is always passed through explicitly to the new `THREE.AnimationClip`, never auto-recomputed, preventing base-lower/upper sub-clip drift (Pitfall 4)

## Task Commits

1. **Task 1: Create filterClipTracksByBoneSet utility + bone-split constants** - `d82ad12` (feat)

## Files Created/Modified
- `packages/react/src/utils/filterClipTracksByBoneSet.ts` - Pure track-filtering utility + BASE_LOWER_BONES/UPPER_BONES constants

## Decisions Made
None - followed plan as specified.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None. (Note: the executor subagent's own turn was cut short by a transient API error after committing the implementation but before writing this SUMMARY.md; the orchestrator verified the commit and acceptance criteria — exports present, 10+42=52 bone partition, `getNormalizedBoneNode` resolution used, no `startsWith` track matching, no `resetDuration`, `pnpm --filter @khaveeai/react build` green — and closed out the plan by writing this summary.)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `filterClipTracksByBoneSet`, `BASE_LOWER_BONES`, `UPPER_BONES` are ready for Plan 02 to consume when integrating bone-masked upper-body layering into `VRMAvatar.tsx`.
- No blockers.

---
*Phase: 11-bone-masked-upper-body-animation-layering*
*Completed: 2026-07-01*
