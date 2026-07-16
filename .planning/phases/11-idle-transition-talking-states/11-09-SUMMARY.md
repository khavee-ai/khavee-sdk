---
phase: 11-idle-transition-talking-states
plan: 09
subsystem: animation
tags: [react, three.js, vrm, expression-drift, procedural-animation, gap-closure]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: "11-07's IDLE-02 candidate/ownership fix (relaxed/happy DRIFT_CANDIDATES + lastWritten guard) and 11-08's re-verification findings (IDLE-02 still failing live, first-load spin bug surfaced)"
provides:
  - "Runtime-confirmed IDLE-02 root cause (H2: amplitude/settle-scale damping, not present-names or overwrite) plus the fix -- DEFAULT_AMPLITUDE raised 0.12 -> 0.35"
  - "First-load 'spins weird' bug root-caused and fixed -- shouldRunProceduralBoneWrites gate on breathing/sway bone writes during the near-zero-weight first-crossfade window"
  - "Off-by-default DRIFT_DEBUG dev diagnostic in expressionDrift.ts for future live cross-checking"
affects: [11-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Effective-weight gating: THREE.AnimationAction.getEffectiveWeight() read directly to gate additive procedural bone writes until a base action is meaningfully driving the skeleton, preventing compounding accumulation during near-zero-weight crossfade ramps"
    - "Headless VRM diagnostic via GLTFLoader.parse() + VRMCoreLoaderPlugin (skips MToon material/texture loading, which crashes in Node) for runtime-confirming expressionManager data without a browser/WebGL environment"

key-files:
  created: []
  modified:
    - packages/react/src/animation/expressionDrift.ts
    - packages/react/src/animation/expressionDrift.test.ts
    - packages/react/src/animation/AnimationStateEngine.ts
    - packages/react/src/animation/AnimationStateEngine.test.ts

key-decisions:
  - "blue-female.vrm (named in the plan's H1 diagnostic instructions) does not exist in this worktree -- it is an untracked-only file in the main repo checkout, never copied into this worktree, and not referenced by any app page. Substituted a second bundled, tracked VRoid model (262410318834873893.vrm) for the two-model H1 cross-check instead."
  - "Used @pixiv/three-vrm's VRMCoreLoaderPlugin (humanoid+expression+lookAt+firstPerson+meta only) instead of the full VRMLoaderPlugin for the headless H1 diagnostic -- the full plugin's MToonMaterialLoaderPlugin crashes in Node (no canvas/Image decode backend) even after polyfilling `self`; VRMCoreLoaderPlugin skips material/texture loading entirely and was sufficient since only expressionManager data was needed."
  - "DEFAULT_AMPLITUDE raised to 0.35 (from the documented ~0.25-0.45 perceptible band, Claude's Discretion per CONTEXT.md) rather than removing the stopped-state SETTLE_SCALE damping -- the plan explicitly requires retaining TRANS-02's settle-to-rest cue, so the fix targets the base amplitude, not the damping."
  - "MIN_BASE_ACTION_WEIGHT set to 0.05 for the first-load-spin guard -- easeInOutCubic reaches this weight at roughly t=0.23 of the crossfade duration, skipping the worst near-zero-weight compounding window without meaningfully delaying idle motion once the base action is actually posing the skeleton."

patterns-established:
  - "Pure exported gate function (shouldRunProceduralBoneWrites) taking a THREE.AnimationAction | null, unit-testable with a stub object exposing only getEffectiveWeight(), mirroring resolveBaseClip's pure-function testability pattern for logic embedded in an otherwise-hook-only module"

requirements-completed: [IDLE-02]

# Metrics
duration: ~20min
completed: 2026-07-16
---

# Phase 11 Plan 09: Second gap-closure pass for IDLE-02 (runtime-diagnosed amplitude fix) and first-load spin bug Summary

**Runtime-diagnosed IDLE-02's remaining invisibility as amplitude/settle-scale damping (not a repeat of 11-07's candidate/ownership fix) and raised DEFAULT_AMPLITUDE 0.12 -> 0.35; separately root-caused and fixed the untracked first-load "spins weird" bug as first-mount additive bone-write accumulation during the near-zero-weight crossfade-in window.**

## Performance

- **Duration:** ~20 min (including the runtime H1 diagnostic investigation)
- **Started:** 2026-07-16T15:04:45+07:00 (approx, prior commit)
- **Completed:** 2026-07-16T15:18:00+07:00
- **Tasks:** 2 completed (Task 1 is TDD: test -> feat, 2 commits; Task 2: 1 commit)
- **Files modified:** 4 (all modified, none created)

## Accomplishments
- Ran a mandatory headless runtime diagnostic (H1) confirming both bundled VRoid VRM models genuinely expose `relaxed`/`happy` expressions -- 11-07's candidate choice was correct, ruling out H1 as the remaining IDLE-02 cause.
- Confirmed H3 (downstream overwrite) does not occur, via reading `VRMExpressionManager.update()`'s source (`applyWeight` reads the already-set `.weight`, never resets it) and `VRMAvatar.tsx`'s frame order (`lerpExpression` only touches the empty default `expressions` map, and runs before `controller.update`).
- Confirmed H2 (amplitude/settle-scale damping) as the dominant cause: `DEFAULT_AMPLITUDE (0.12) * SETTLE_SCALE (0.15) = 0.018` peak weight in the demo page's default pre-connect `stopped` state -- objectively imperceptible.
- Raised `DEFAULT_AMPLITUDE` to 0.35, keeping 11-07's `lastWritten` ownership guard, present-name check, `MAX_ACTIVE_CANDIDATES`, `phaseOffsets`, and `DRIFT_CANDIDATES` order completely unchanged, and keeping the TRANS-02 stopped-settle damping intact (new stopped-state peak ≈0.0525, still visibly damped relative to ready's 0.35).
- Root-caused the untracked first-load "spins weird" bug: `beginCrossfade(null, toAction, ...)` ramps the first base action's effective weight from 0, so `breathing.step`/`sway.step`'s additive `multiply()` writes compound onto the previous frame's already-drifted quaternion instead of a freshly mixer-reset pose during that ramp -- non-commuting X/Z-axis rotations don't cancel, producing net drift that reads as "spinning" until the crossfade settles.
- Added `shouldRunProceduralBoneWrites(action)` gating breathing/sway/spine-clamp (`update()` steps 4-7) on the base action existing and having ramped past a 0.05 effective-weight threshold; blink and expression drift are deliberately NOT gated (scalar writes, not accumulating bone quaternions).

## Task Commits

Each task was committed atomically:

1. **Task 1: Diagnose then fix invisible VRM expression drift (IDLE-02)** (TDD) - `2730b7a` (test, RED) then `0589b5f` (fix, GREEN)
2. **Task 2: Root-cause and fix the first-load "spins weird" avatar motion** - `97b7cb2` (fix)

**Plan metadata:** committed alongside this SUMMARY (see final commit in git log)

## Files Created/Modified
- `packages/react/src/animation/expressionDrift.ts` - `DEFAULT_AMPLITUDE` raised 0.12 -> 0.35; new `PERCEPTIBLE_MIN_WEIGHT` constant; off-by-default `DRIFT_DEBUG` dev diagnostic logging present names/candidates/peak weight once per instance; extensive new header doc block recording the 11-09 H1/H2/H3 diagnosis
- `packages/react/src/animation/expressionDrift.test.ts` - two new tests: ready-state peak >= `PERCEPTIBLE_MIN_WEIGHT` (Test A), stopped-state peak strictly less than ready-state peak (Test B)
- `packages/react/src/animation/AnimationStateEngine.ts` - new `MIN_BASE_ACTION_WEIGHT` constant + exported `shouldRunProceduralBoneWrites()` pure gate function; `update()` steps 4-7 (spine-base-capture/breathing/sway/spine-clamp) wrapped in the gate; new header doc block recording the first-load-spin diagnosis
- `packages/react/src/animation/AnimationStateEngine.test.ts` - 5 new tests: 4 for `shouldRunProceduralBoneWrites` (null/near-zero/mid/full weight), 1 repro test proving breathing+sway deltas compound to a larger net spine rotation without a per-frame base-pose reset than with one

## Decisions Made
- `blue-female.vrm` (the second model the plan's H1 instructions named) does not exist anywhere in this worktree -- confirmed via `find`, it only exists at `~/Downloads/blue-female.vrm` and as an untracked file in the main repo checkout (not committed, not copied into this worktree's checkout), and no app page references it (`grep` for `blue-female` across `src/app` returned zero matches). Substituted `public/models/262410318834873893.vrm` -- a second bundled, tracked VRoid model -- for the plan's "both bundled VRoid models" two-model cross-check intent.
- The headless VRM load initially failed with `ReferenceError: self is not defined` (polyfilled via `globalThis.self = globalThis`) and then `TypeError: Cannot set properties of undefined (setting 'colorSpace')` inside `@pixiv/three-vrm`'s MToon material assignment (a genuine Node environment limitation -- no canvas/Image decode backend for texture loading). Rather than treating this as the plan's permitted "unresolvable environment error" fallback (trusting 11-07's finding without a fresh runtime check), used `VRMCoreLoaderPlugin` (humanoid+expression+lookAt+firstPerson+meta only, no materials) instead of the full `VRMLoaderPlugin`, which sidestepped the texture-loading crash entirely and produced a genuine runtime-confirmed H1 finding rather than falling back to an assumption.
- `DEFAULT_AMPLITUDE = 0.35` chosen from the plan's documented ~0.25-0.45 perceptible band (Claude's Discretion) -- a value intended to read as a clearly visible, still-subtle mild rest smile.
- `MIN_BASE_ACTION_WEIGHT = 0.05` chosen so `easeInOutCubic` opens the gate quickly (~23% into the crossfade duration) -- enough to skip the worst near-zero-weight compounding window without delaying idle motion once the crossfade is meaningfully progressed.

## Deviations from Plan

None - plan executed exactly as written, including the mandatory H1 headless diagnostic (with the documented model substitution and MToon-avoidance workaround above, both within the plan's explicit allowance for handling environment/asset constraints during diagnosis).

## Issues Encountered
- Fresh worktree had no `node_modules` -- ran `pnpm install --frozen-lockfile` before any test/diagnostic could run (Rule 3 blocking-issue fix, standard worktree setup, no version changes).
- The headless diagnostic script required two iterations to work around Node's lack of browser globals (`self`) and lack of an Image/canvas decode backend (worked around by using `VRMCoreLoaderPlugin` instead of the full `VRMLoaderPlugin`, which was the appropriate fix since only `expressionManager` data was needed, not materials). The temporary script was deleted before any commit -- `git status --short` confirmed a clean working tree before staging each task's files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both IDLE-02's runtime diagnosis (H1/H2/H3, dominant cause H2) and the first-load spin's root cause (first-mount additive-write accumulation on un-driven bones) are recorded here for 11-10's human re-verification, per this plan's explicit deferral of visual confirmation to that checkpoint.
- Full `@khaveeai/react` test suite green: 74/74 tests across 7 suites (up from 67/67 in 11-08), including both new perceptible/damped `expressionDrift` assertions and the new `AnimationStateEngine` guard + repro tests.
- `tsc --noEmit` clean in `packages/react`.
- No blockers identified for 11-10 (the next plan, which per its `depends_on: ["11-09"]` should re-run the human per-state checkpoint for IDLE-02 and the first-load spin, and decisively re-check TALK-02 per 11-08's carried-forward "maybe pass").

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 4 modified source files and this SUMMARY.md confirmed present on disk; all 4 commits (2730b7a, 0589b5f, 97b7cb2, f1b77eb) confirmed present in `git log --oneline --all`.
