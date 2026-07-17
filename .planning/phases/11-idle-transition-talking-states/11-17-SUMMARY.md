---
phase: 11-idle-transition-talking-states
plan: 17
subsystem: animation
tags: [three.js, vrm, glb, procedural-animation, gap-closure]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: "11-15/11-16's fixed page-load Y-drop (G5) and the RestPoseAnchor/shouldRunProceduralBoneWrites/isBaseActionMeaningfullyDriving gating machinery this plan extends"
provides:
  - "sway.ts retargeted off hips onto spine+chest — VRM legs no longer visibly sway"
  - "shouldDisableProceduralForManualClip pure gate — GLB procedural motion silenced while a manually-selected non-idle clip is active"
  - "GLBAvatar.tsx opt-in (dampProceduralOnManualClip: true); VRMAvatar.tsx untouched"
affects: [11-18]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exported, pure, unit-testable gate functions for procedural-motion decisions (mirrors shouldRunProceduralBoneWrites/isBaseActionMeaningfullyDriving precedent)"

key-files:
  created: []
  modified:
    - packages/react/src/animation/sway.ts
    - packages/react/src/animation/sway.test.ts
    - packages/react/src/animation/AnimationStateEngine.ts
    - packages/react/src/animation/AnimationStateEngine.test.ts
    - packages/react/src/GLBAvatar.tsx

key-decisions:
  - "Sway retargeted onto spine+chest (already members of RestPoseAnchor) instead of any other bone, to avoid introducing a new accumulation-prone bone (11-09 bug class)"
  - "GLB manual-clip gate forces proceduralScale to a named constant (MANUAL_CLIP_PROCEDURAL_SCALE = 0), not an inline literal, in case a subtler damp is preferred later"
  - "Gate excludes the default idle/ready clip and all status-driven states (speaking/listening/thinking/starting) so only the human's exact reported scenario (a manually-parked non-idle clip) is affected"

patterns-established: []

requirements-completed: [IDLE-01, PERF-01]

# Metrics
duration: 30min
completed: 2026-07-17
---

# Phase 11 Plan 17: Sway Leg-Isolation + GLB Manual-Clip Procedural Gate Summary

Retargeted procedural sway off the hips bone onto spine+chest so VRM leg bones no longer visibly rotate during idle sway, and added a new pure gate that silences GLB procedural breathing/sway whenever a manually-selected non-idle clip is the active base — closing both open findings from 11-16's decisive human checkpoint.

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-17T12:55:00Z (approx, worktree branch check)
- **Completed:** 2026-07-17T13:00:30Z
- **Tasks:** 2 completed
- **Files modified:** 5

## Accomplishments
- Fixed OPEN ISSUE 1 (VRM leg sway): `stepSway` no longer resolves or writes `hips`; it now writes `spine` (required) and `chest` (optional), mirroring `breathing.ts`'s existing upper-body-only target. A stubbed `hips` bone is now asserted to remain exactly unchanged after `stepSway`.
- Fixed OPEN ISSUE 2 (GLB sway too strong after animation change): new exported pure function `shouldDisableProceduralForManualClip` forces `proceduralScale` to 0 in `update()` whenever GLB has opted in (`dampProceduralOnManualClip: true`) and the active clip is the user's own manually-selected, non-idle `animate()` clip. The default idle clip and every status-driven state (speaking/listening/thinking/starting) are unaffected.
- `GLBAvatar.tsx` passes the new opt-in flag; `VRMAvatar.tsx` is byte-for-byte unchanged aside from the shared `sway.ts` retarget (which benefits both formats).
- Full `@khaveeai/react` test suite (106 tests, up from 98 — 8 new/updated sway assertions + 7 new gate tests, no test removed) passes; `tsc --noEmit` is clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Retarget procedural sway off the hips bone onto spine+chest** - `0945258` (fix)
2. **Task 2: Gate procedural body motion off on GLB for manually-selected clips** - `70a1320` (fix)

**Plan metadata:** (this SUMMARY commit)

## Files Created/Modified
- `packages/react/src/animation/sway.ts` - `stepSway` now targets spine+chest, never hips; file header updated with 11-17 rationale
- `packages/react/src/animation/sway.test.ts` - stub adapter extended with a `chest` slot; tests updated to assert hips is never mutated and spine+chest are both written additively
- `packages/react/src/animation/AnimationStateEngine.ts` - new `MANUAL_CLIP_PROCEDURAL_SCALE` constant, new exported `shouldDisableProceduralForManualClip` gate, `dampProceduralOnManualClip` param threaded into `useAnimationController`, `update()` step 3 now computes `disableForManualClip` and forces `proceduralScale` to 0 when it fires, step-6 comment corrected, file-header 11-17 diagnosis block added (additive — all prior 11-09/11-11/11-13/11-15 blocks intact)
- `packages/react/src/animation/AnimationStateEngine.test.ts` - new `shouldDisableProceduralForManualClip` import + a new describe block covering every branch (enabled=false, non-ready/stopped status, null currentAnimation, null activeClipName, mismatched clip, idle-pattern clip, and the positive case)
- `packages/react/src/GLBAvatar.tsx` - passes `dampProceduralOnManualClip: true` in its `useAnimationController` call

## Decisions Made
- Sway retargeted onto spine+chest specifically (not some other upper-body bone) because both are already captured/reset by `RestPoseAnchor`, so no new near-zero-weight accumulation surface is introduced (avoids reintroducing the 11-09 bug class on a fresh bone).
- `MANUAL_CLIP_PROCEDURAL_SCALE` is a named constant (currently `0`, a hard cutoff) rather than an inline literal, so a future subtler damp (small non-zero fraction) can be tuned without touching the gate logic.
- The gate's decision table deliberately excludes the idle/ready clip and all status-driven chatStatus values, so only the exact scenario the human reported (parking on a manually-selected non-idle clip while `ready`/`stopped`) is affected — no regression risk to the previously-approved speaking/listening/thinking/starting procedural amplitude behavior.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` instructions were followed directly; no Rule 1-4 deviations were needed.

## Known Stubs

None introduced by this plan.

## Threat Flags

None — this plan only retargets existing procedural bone writes and adds a gate that reduces (never increases) procedural motion; no new network endpoints, auth paths, file access, or schema changes were introduced. Both threat-register entries in the plan (T-11-17-01, T-11-17-02) are mitigations already implemented as described (no new bone outside RestPoseAnchor; proceduralScale forced to 0 removes the additive deltas entirely for the flagged scenario).

## Verification

- `pnpm --filter @khaveeai/react test` — 8 test files, 106 tests, all passing (up from 98; no prior test removed).
- `npx tsc --noEmit` in `packages/react` — exit 0, no errors.
- `grep 'getHumanoidBoneNode("hips")' packages/react/src/animation/sway.ts` on executable code — 0 matches.
- `grep 'dampProceduralOnManualClip: true' packages/react/src/GLBAvatar.tsx` — 1 match; `grep 'dampProceduralOnManualClip' packages/react/src/VRMAvatar.tsx` — 0 matches.
- All five prior file-header diagnosis blocks (11-09/11-11/11-13/11-15) remain present in `AnimationStateEngine.ts`; the 11-17 note is additive.

Decisive live confirmation (visually verifying no VRM leg sway and no excessive GLB sway on a manually-selected clip) is deferred to 11-18's human checkpoint, per this phase's established diagnose-fix-then-re-verify pattern.

## Self-Check: PASSED

- FOUND: packages/react/src/animation/sway.ts (modified, `getHumanoidBoneNode("hips")` removed from executable code)
- FOUND: packages/react/src/animation/sway.test.ts (modified, hips-untouched assertion added)
- FOUND: packages/react/src/animation/AnimationStateEngine.ts (modified, `shouldDisableProceduralForManualClip` present)
- FOUND: packages/react/src/animation/AnimationStateEngine.test.ts (modified, new 11-17 describe block present)
- FOUND: packages/react/src/GLBAvatar.tsx (modified, `dampProceduralOnManualClip: true` present)
- FOUND: commit 0945258 (Task 1)
- FOUND: commit 70a1320 (Task 2)
