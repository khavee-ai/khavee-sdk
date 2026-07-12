---
phase: 11-idle-transition-talking-states
plan: 07
subsystem: animation
tags: [react, three.js, vrm, crossfade, expression-drift, gap-closure]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: "11-06's live-build re-verification findings (TALK-01, TRANS-01, TRANS-02, IDLE-02 diagnosed root causes)"
provides:
  - "Stable chatStatus crossfade-trigger useEffect (no getAction in deps) plus a speaking-variant ownership guard so talkCycle is the sole owner of talk-clip switching during speaking"
  - "Memoized getAction/getRoot accessors in VRMAvatar and GLBAvatar via useCallback"
  - "Visible, continuous, non-freezing VRM expression drift on the bundled VRoid models (relaxed/happy/browInnerUp candidates + ownership-tracking guard)"
  - "Eased ~1.2s settle-scale ramp (easeInOutCubic) replacing the instant stopped-state amplitude cut, applied to both body procedural motion and facial drift"
affects: [11-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Effect-deps stability: never include per-render accessor closures (getAction/getRoot) in a useEffect dependency array that should only fire on meaningful state changes — memoize them with useCallback at the call site instead"
    - "Ownership-tracking runtime guard (lastWritten map) for a procedural system that shares a mutable target with app-driven writes, replacing a naive non-zero read-back check"
    - "Ref-held eased ramp state ({current, from, target, elapsed}) for smoothly retargeting a scalar (settleScale) across chatStatus transitions, mirroring the crossfade engine's own eased-duration pattern"

key-files:
  created:
    - packages/react/src/animation/expressionDrift.test.ts
  modified:
    - packages/react/src/animation/AnimationStateEngine.ts
    - packages/react/src/animation/expressionDrift.ts
    - packages/react/src/VRMAvatar.tsx
    - packages/react/src/GLBAvatar.tsx

key-decisions:
  - "Speaking-variant ownership guard added directly inside the existing crossfade-trigger useEffect (returns early) rather than restructuring talkCycle — talkCycle already owned loop-boundary variant advancement; the bug was the effect re-asserting the first variant, not talkCycle itself"
  - "DRIFT_CANDIDATES reordered to [relaxed, happy, browInnerUp] based on empirical presence/visibility findings against the two bundled VRoid VRM 0.x models (documented in the plan's <empirical_findings> block), not re-derived"
  - "Settle-scale ramp implemented as a ref-held {current,from,target,elapsed} state advanced every update() call, eased via the already-existing easeInOutCubic from crossfade.ts, rather than a new timing utility"
  - "Expression drift's chatStatus !== \"stopped\" hard gate removed entirely; the ramp's eased settleScale is passed as amplitudeScale so facial drift damps/restores in lockstep with body motion instead of hard-cutting"

patterns-established:
  - "amplitudeScale?: number parameter threaded through a procedural step() function to let an eased ramp control a system's damping without a separate on/off gate"

requirements-completed: [TALK-01, TRANS-01, TRANS-02, IDLE-02]

# Metrics
duration: 12min
completed: 2026-07-13
---

# Phase 11 Plan 07: Gap-closure fixes for talk-variant snap-back, crossfade double-trigger, stopped-settle cut, and invisible expression drift Summary

**Fixed three code-level animation-timing bugs (unstable useEffect deps, an instant settle-scale cut, and a self-defeating expression-drift ownership guard) that were causing all four Phase 11 behaviors a human reported failing in 11-06 to actually fail on a live build.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-13T02:18Z (approx, first commit)
- **Completed:** 2026-07-13T02:21:57+07:00
- **Tasks:** 3 completed (Task 2 is TDD: test -> feat, 2 commits)
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- TALK-01/TRANS-01: the chatStatus crossfade-trigger `useEffect` no longer lists `getAction` in its dependency array (it was re-firing on every render during speaking, since `currentVolume` updates every volume tick) and now has an explicit speaking-variant ownership guard so `talkCycle` is the sole owner of which talk clip is showing while `chatStatus === "speaking"`.
- TRANS-02 (and smooths TRANS-01): the `stopped`-state procedural amplitude settle no longer snaps instantly; it eases over ~1.2s via `easeInOutCubic` in both directions (entering and leaving `stopped`), matching the existing starting/stopped crossfade floor window.
- IDLE-02: VRM expression drift now targets `relaxed`/`happy` (empirically present+visible on both bundled VRoid VRM 0.x models) instead of the visually-inert `neutral`, and its runtime "don't clobber app writes" guard now tracks drift's own last-written value instead of misreading its own prior write as external interference — drift no longer freezes after frame 1.
- Facial expression drift now eases with the same settle ramp as body motion (breathing/sway) instead of being hard-gated on/off at the `stopped` boundary.
- `VRMAvatar.tsx`/`GLBAvatar.tsx` memoize `getAction`/`getRoot` via `useCallback` as defense-in-depth.

## Task Commits

Each task was committed atomically:

1. **Task 1: Stabilize the crossfade-trigger effect and make talkCycle the sole speaking-variant owner** - `d00b36d` (fix)
2. **Task 2: Make idle expression drift visible on the bundled VRoid models and non-freezing** (TDD) - `fc05cf5` (test, RED) then `7a783c6` (feat, GREEN)
3. **Task 3: Ease the stopped-settle scale over the ~1.2s floor window** - `939a231` (fix)

**Plan metadata:** committed alongside this SUMMARY (see final commit in git log)

## Files Created/Modified
- `packages/react/src/animation/AnimationStateEngine.ts` - crossfade-trigger effect deps fix + speaking-variant ownership guard (Task 1); `SETTLE_RAMP_SECONDS` + `settleRampRef` eased settle-scale ramp + always-on expression-drift call with `amplitudeScale` (Task 3)
- `packages/react/src/animation/expressionDrift.ts` - new `DRIFT_CANDIDATES` (relaxed/happy/browInnerUp), `lastWritten`-based ownership-tracking guard, per-candidate `phaseOffsets`, optional `amplitudeScale` param, exported `DEFAULT_AMPLITUDE`
- `packages/react/src/animation/expressionDrift.test.ts` - new test file: continuity, yield-to-app, GLB no-op, absent-candidate fallback, amplitudeScale scaling (5 tests)
- `packages/react/src/VRMAvatar.tsx` - `getAction`/`getRoot` wrapped in `useCallback`
- `packages/react/src/GLBAvatar.tsx` - `getAction`/`getRoot` wrapped in `useCallback`

## Decisions Made
- Kept `talkCycle.ts`, `resolveBaseClip`, and the `update()` talk-cycle step entirely unmodified per the plan's explicit instruction — the fix is isolated to effect-deps stability and an ownership guard around the existing crossfade-trigger effect.
- Pinned `phaseOffsets` to `0` in the new amplitudeScale proportionality test (not specified verbatim in the plan's `<behavior>` block) — `createExpressionDriftState()` assigns each candidate a randomized phase offset per instance, so comparing two independently-created states at literally the same `phase` value required pinning the offset to isolate the amplitude-scaling assertion from phase-offset noise. This is a test-only adjustment; the production randomized-offset behavior is unchanged.

## Deviations from Plan

None - plan executed exactly as written. The one test-construction detail above (pinning `phaseOffsets.relaxed = 0` in the amplitudeScale test) is a test-implementation detail within Task 2's `<behavior>` intent (Test 5: "amplitudeScale scales the peak weight proportionally"), not a scope or production-code deviation, so it is not logged as a numbered Rule 1-4 deviation.

## Issues Encountered
- The worktree had no `node_modules` installed (fresh worktree checkout); ran `pnpm install` at the repo root before any test could execute. This is standard worktree setup, not a plan deviation.
- During Task 2's RED phase, 4 of 5 new tests passed against the pre-implementation code (only the continuity test failed with a `DEFAULT_AMPLITUDE` import error). Investigated: the other 4 passed for legitimate-but-coincidental reasons — the old code never touched the `"relaxed"` candidate name at all (old `DRIFT_CANDIDATES` was `["neutral", "browInnerUp"]`), so assertions like "no write occurred to relaxed" or "amplitudeScale=0 produces ~0" were trivially satisfied by the stub's default-zero `getValue`. This is not a case of the feature already existing (fail-fast trigger) — proceeded to GREEN as intended.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three diagnosed root causes from 11-06-SUMMARY.md are fixed in code with passing unit coverage (67/67 tests in `@khaveeai/react`, `tsc --noEmit` clean).
- Behavioral/visual confirmation (talk-variant snap-back gone, smooth start/stop settle, visible VRM drift on a live build) is deferred to the human-verify step in Plan 11-08, per this plan's own `<verification>` section — a grep/unit-test suite cannot make that visual judgement.
- No blockers identified for 11-08.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-13*

## Self-Check: PASSED

All 5 created/modified source files and 2 planning artifacts confirmed present on disk; all 5 commits (d00b36d, fc05cf5, 7a783c6, 939a231, 35bad87) confirmed present in git log.
