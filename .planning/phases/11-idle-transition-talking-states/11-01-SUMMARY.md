---
phase: 11-idle-transition-talking-states
plan: 01
subsystem: animation
tags: [three.js, vrm, glb, avatar-animation, humanoid-bones]

requires:
  - phase: 10-shared-animation-architecture-crossfade-engine
    provides: "AvatarFormatAdapter interface and shared animation module (state layer, crossfade engine) that VRMAvatar/GLBAvatar implement"
provides:
  - "AvatarFormatAdapter.getHumanoidBoneNode(role) contract — six-role VRM-humanoid-role bone resolver"
  - "VRMAvatar implementation backed by vrm.humanoid.getNormalizedBoneNode(role)"
  - "GLBAvatar implementation backed by literal getObjectByName(role) (correct specifically for happy.glb's node naming)"
affects: [11-02, 11-03, 11-04, 11-05, breathing, sway, procedural-motion]

tech-stack:
  added: []
  patterns:
    - "Humanoid-role bone resolution (getHumanoidBoneNode) is kept strictly separate from literal scene-graph name resolution (getBoneNode) on AvatarFormatAdapter — never conflate the two, never fall back from role-based lookup to a hardcoded literal-name guess"

key-files:
  created: []
  modified:
    - packages/react/src/animation/types.ts
    - packages/react/src/VRMAvatar.tsx
    - packages/react/src/GLBAvatar.tsx

key-decisions:
  - "getHumanoidBoneNode uses a strict six-value union type (hips|spine|chest|upperChest|neck|head), not string, to prevent typos and keep the contract self-documenting"
  - "GLB's implementation is a literal getObjectByName(role) lookup, documented inline as correct only because happy.glb's bundled node names happen to match the VRM humanoid role strings — not a general GLB guarantee"

requirements-completed: [IDLE-01]

duration: ~15min
completed: 2026-07-12
---

# Phase 11 Plan 01: Humanoid Bone Resolution Summary

**Added `AvatarFormatAdapter.getHumanoidBoneNode(role)` — a VRM-humanoid-role bone resolver (backed by `vrm.humanoid.getNormalizedBoneNode` for VRM, literal name lookup for GLB) so Wave-2 breathing/sway can find chest/spine/hips reliably across every VRM rig, including the default `male.vrm` whose chest bone is literally named `J_Bip_C_Chest`.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-12T14:47:02Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- `AvatarFormatAdapter` interface extended with `getHumanoidBoneNode(role)`, documented to never fall back to a hardcoded literal-name guess
- `VRMAvatar.tsx` implements it via `currentVrm?.humanoid?.getNormalizedBoneNode(role) ?? null` — the same proven VRM humanoid API already used by `remapMixamoAnimationToVrm.ts`
- `GLBAvatar.tsx` implements it via `groupRef.current?.getObjectByName(role) ?? null`, with an inline comment explaining this is correct only because `happy.glb`'s node names already match the role strings
- Existing `getBoneNode` (literal lookup used by `crossfade.ts`'s `computePoseGapAngle`) left completely untouched on both adapters
- `pnpm --filter @khaveeai/react build` (tsc) compiles both touched files with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getHumanoidBoneNode to the AvatarFormatAdapter contract** - `2debbd8` (feat)
2. **Task 2: Implement getHumanoidBoneNode on both avatar adapters** - `d175a09` (feat)

_Worktree mode: plan-metadata commit (SUMMARY.md) follows this summary; STATE.md/ROADMAP.md are updated centrally by the orchestrator after merge, not by this agent._

## Files Created/Modified
- `packages/react/src/animation/types.ts` - Added `getHumanoidBoneNode(role)` method + JSDoc to `AvatarFormatAdapter` interface
- `packages/react/src/VRMAvatar.tsx` - Implemented `getHumanoidBoneNode` on `vrmAdapter` via `vrm.humanoid.getNormalizedBoneNode`
- `packages/react/src/GLBAvatar.tsx` - Implemented `getHumanoidBoneNode` on `glbAdapter` via literal `getObjectByName(role)`

## Decisions Made
- Strict six-value union type for `role` (not `string`) to make the contract self-documenting and typo-proof, matching the plan's explicit instruction.
- No fallback logic anywhere in `getHumanoidBoneNode` — returns `null` cleanly if the humanoid/scene isn't ready, letting Wave 2 callers null-check rather than risk resolving the wrong bone.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

`pnpm --filter @khaveeai/react build` reports pre-existing `TS2307: Cannot find module 'vitest'` errors in two unrelated test files (`AnimationStateEngine.test.ts`, `crossfade.test.ts`, last touched in commit `d304eee`, predating this plan). These are out of scope per the Scope Boundary rule (not caused by this plan's changes) and are not fixed. Logged in `.planning/phases/11-idle-transition-talking-states/deferred-items.md`. Both files this plan modifies (`VRMAvatar.tsx`, `GLBAvatar.tsx`) plus `types.ts` compile with zero errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The `getHumanoidBoneNode` contract is now available for Wave 2 (breathing/sway procedural systems) to consume via the adapter without any further interface changes.
- No behavior change shipped in this plan — `useAnimationController({...})` call sites and `useFrame` bodies are untouched, exactly as scoped (Plan 05 wires `currentVolume`/controller params in Wave 3).
- Pre-existing `vitest` module-resolution issue in the animation test suite remains unresolved and is not blocking for this plan's scope; flagged for whichever future plan next touches those test files or the workspace's dependency installation.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-12*
