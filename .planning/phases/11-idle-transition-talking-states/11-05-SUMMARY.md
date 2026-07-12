---
phase: 11-idle-transition-talking-states
plan: 05
subsystem: animation
tags: [three.js, react-three-fiber, vrm, glb, crossfade, procedural-animation]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states (waves 1-2, plans 01-04)
    provides: bone resolution (getHumanoidBoneNode), breathing/sway/expressionDrift/talkCycle/audioAmplitude modules, currentVolume on KhaveeProvider context
provides:
  - Single shared controller (useAnimationController) that composes breathing, sway, expression drift, talk-cycle, and audio-reactive amplitude in one fixed documented order
  - starting/stopped ~1.2s minimum-duration crossfade floor (TRANS-01/02)
  - stopped procedural settle cue (TRANS-02 D-01 placeholder, both formats)
  - ready and GLB-"Taking" clip-name pattern resolution
  - PERF-01 bounded combined spine-delta clamp
  - currentVolume threaded from useKhavee() into both VRMAvatar and GLBAvatar
affects: [12-gaze-attention-gestures, 13-public-api-perf-tiers-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "switchToClip(name) single-owner crossfade-trigger helper, reused by both the chatStatus effect and talk-cycle variant switches, so blend state has exactly one writer"
    - "Module-scoped scratch THREE.Quaternion pairs (never `new` per-frame) for post-composition delta clamps, always written via .copy() into two independent scratches rather than a self-referential slerpQuaternions call on a live bone quaternion"

key-files:
  created: []
  modified:
    - packages/react/src/animation/AnimationStateEngine.ts
    - packages/react/src/animation/AnimationStateEngine.test.ts
    - packages/react/src/VRMAvatar.tsx
    - packages/react/src/GLBAvatar.tsx

key-decisions:
  - "1.2s crossfade floor for starting/stopped (within the locked 1.0-1.5s range)"
  - "SETTLE_SCALE = 0.15 for the stopped procedural settle cue (D-01 placeholder, tracked in issue #17)"
  - "MAX_COMBINED_SPINE_DELTA_RAD = 0.12 rad, clamped post-composition against the frame's pre-procedural base orientation, not per-system"
  - "breathing runs before sway in the fixed composition order (arbitrary but documented, per PERF-01's 'a fixed order' requirement)"
  - "expression drift skipped entirely during stopped (facial half of the settle cue) instead of separately scaled"

patterns-established:
  - "Fixed, numbered composition order inside update(delta): crossfade ramp -> blink -> amplitude/settle scale -> spine base capture -> breathing -> sway -> spine clamp -> expression drift -> talk-cycle"

requirements-completed: [IDLE-01, IDLE-02, TRANS-01, TRANS-02, TALK-01, TALK-02, PERF-01]

# Metrics
duration: 20min
completed: 2026-07-12
---

# Phase 11 Plan 05: Wire All Phase 11 Systems Into the Shared Controller Summary

**Integrated breathing, sway, expression drift, timer-free talk-cycle variant switching, and audio-reactive amplitude into `useAnimationController`'s single `update(delta)` call, with a ~1.2s starting/stopped crossfade floor, a bounded combined spine-delta clamp, and a procedural settle cue standing in for the still-missing TRANS-02 goodbye clip.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-12
- **Tasks:** 3/3
- **Files modified:** 4

## Accomplishments
- `AnimationStateEngine.ts`'s `update(delta)` now runs every Phase 11 system in one fixed, numbered, inline-documented order every frame, on both `VRMAvatar` and `GLBAvatar`, via the single shared controller
- `starting`/`stopped` transitions get a real ~1.2s minimum-duration crossfade floor (`beginCrossfade`'s 4th arg), and `stopped` additionally reads as a distinct "settling to rest" procedural cue (damped breathing/sway/expression-drift) on both avatar formats, without depending on a dedicated goodbye clip that doesn't exist yet
- A `ready` STATUS_CLIP_PATTERN and a `taking` accommodation for `happy.glb`'s placeholder speaking clip both auto-resolve conventionally-named clips, additively (a regression test proves an app's explicit, non-matching `currentAnimation` still wins when nothing matches)
- The talk cycle now advances speaking-clip variants purely off loop-boundary + dwell detection (never a timer), and live TTS volume scales procedural amplitude only while speaking — the two systems never gate each other
- The shared spine bone's combined breathing+sway delta is clamped post-composition against a documented radian bound, with zero per-frame heap allocation (module-scoped scratch quaternions only)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire floorSeconds, ready-idle pattern, GLB speaking pattern, stopped-settle decision, currentVolume param** - `4baeeb8` (feat)
2. **Task 2: Compose all procedural steps in update(delta) with PERF-01 fixed order, bounded spine delta, and the stopped settle** - `2d1fc81` (feat)
3. **Task 3: Thread currentVolume from useKhavee() into both avatars' controller calls** - `ffc2525` (feat)

_No separate plan-metadata commit — this is a worktree/parallel-executor run; the orchestrator handles the final metadata commit after merge._

## Files Created/Modified
- `packages/react/src/animation/AnimationStateEngine.ts` - `ready`/extended `speaking` STATUS_CLIP_PATTERNS entries, stopped-settle decision documentation, floorSeconds wiring, `currentVolume` controller param, `switchToClip` single-owner crossfade helper, full `update(delta)` composition (breathing → sway → spine clamp → expression drift → talk-cycle) with `SETTLE_SCALE`/`MAX_COMBINED_SPINE_DELTA_RAD` constants and paired scratch quaternions
- `packages/react/src/animation/AnimationStateEngine.test.ts` - new tests for the `ready` pattern, the GLB "Taking" clip, and the ready-pattern precedence regression; fixed a pre-existing test whose fixture now legitimately matches the new `ready` pattern
- `packages/react/src/VRMAvatar.tsx` - `currentVolume` pulled from `useKhavee()` and passed into `useAnimationController`
- `packages/react/src/GLBAvatar.tsx` - same threading as VRMAvatar

## Decisions Made
- 1.2s crossfade floor for starting/stopped (mid-range of the locked 1.0-1.5s window)
- `SETTLE_SCALE = 0.15` and `MAX_COMBINED_SPINE_DELTA_RAD = 0.12` rad chosen within Claude's plan-granted discretion; both are documented inline with the reasoning for their magnitudes
- Breathing composes before sway in the fixed order (arbitrary choice among two valid fixed orders; PERF-01 requires *a* documented order, not a specific one) — matches the file's own read-order convention
- The spine-delta clamp uses two independent scratch quaternions (`_spineBaseScratch`, `_spineComposedScratch`) rather than `Quaternion#slerpQuaternions` called directly on the live bone, because that form would self-corrupt (`.copy(qa)` overwrites `this`, which is also the `qb` argument, before `.slerp(qb, t)` reads it)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a pre-existing test broken by the new `ready` pattern**
- **Found during:** Task 2 (running `AnimationStateEngine.test.ts` after adding the `ready` regex)
- **Issue:** The existing test `"ready: returns currentAnimation when set"` used fixture `resolveBaseClip("ready", "wave", ["idle", "wave"])`. Task 1's new `ready` pattern (`/idle|ready|rest/i`) now matches `"idle"` in that fixture, so `"idle"` correctly wins over `currentAnimation` per the new intended precedence — but the old test still asserted the old (now superseded) behavior and failed.
- **Fix:** Changed the fixture to `["custom1", "wave"]` (no clip name matches the new pattern), preserving the test's original intent — verifying the fallback-to-`currentAnimation` branch — without relying on a fixture that now legitimately triggers the new pattern-match branch. This mirrors the plan's own guidance about fixture selection for the new precedence-regression test.
- **Files modified:** `packages/react/src/animation/AnimationStateEngine.test.ts`
- **Verification:** `pnpm --filter @khaveeai/react exec vitest run src/animation/AnimationStateEngine.test.ts` — all 19 tests pass
- **Committed in:** `2d1fc81` (Task 2 commit)

**2. [Rule 3 - Blocking] Ran `pnpm install` to restore missing `node_modules`**
- **Found during:** Task 1 verification (`pnpm --filter @khaveeai/react build`)
- **Issue:** The worktree had no `node_modules` installed at all (not package-specific — the whole workspace), so `tsc` failed on unrelated `Cannot find module 'vitest'` errors across every test file, unrelated to this plan's changes.
- **Fix:** Ran `pnpm install --frozen-lockfile` (installs exactly what `pnpm-lock.yaml` already pins — no new/altered dependencies, not a package-manager "add" covered by the Rule 3 install-exclusion). Verified `pnpm-lock.yaml` and `package.json` were unchanged by `git status` after.
- **Files modified:** none (node_modules only, gitignored)
- **Verification:** `pnpm --filter @khaveeai/react build` and `pnpm --filter @khaveeai/react test` both pass after
- **Committed in:** n/a (no tracked files changed)

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 blocking environment fix)
**Impact on plan:** Both were necessary to execute and verify the plan as written. No scope creep — no plan tasks, requirements, or acceptance criteria were altered.

## Issues Encountered
None beyond the two auto-fixed items above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 11's IDLE-01/02, TRANS-01/02, TALK-01/02, and PERF-01 requirements are now fully wired end-to-end through the one shared controller both avatars consume; `pnpm --filter @khaveeai/react test` (62 tests) and `pnpm --filter @khaveeai/react build` are both green.
- `stopped`'s procedural settle is an explicit D-01 placeholder — the real dedicated goodbye clip for both formats remains tracked in GitHub issue #17 (ASSET-01) and is not blocking further Phase 11/12/13 work.
- No new public API surface was added this plan (`currentVolume` threading and the controller's internal composition are both internal-module wiring); Phase 13's public API work is unaffected.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-12*
