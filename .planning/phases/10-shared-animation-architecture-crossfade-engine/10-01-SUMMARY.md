---
phase: 10-shared-animation-architecture-crossfade-engine
plan: 01
subsystem: animation
tags: [three.js, vitest, vrm, crossfade, animation-mixer, react]

# Dependency graph
requires: []
provides:
  - "packages/react/src/animation/crossfade.ts: easeInOutCubic, computePoseGapAngle, poseGapToDuration, BlendState, beginCrossfade, stepCrossfade"
  - "packages/react/src/animation/types.ts: AvatarFormatAdapter interface (getMixer/getBoneNode/getExpressionManager)"
  - "vitest test runner in packages/react (first time), with a PostCSS-conflict workaround other packages/react vitest consumers will need too"
affects: [10-02, 10-03, phase-11-procedural-motion, phase-13-public-api]

# Tech tracking
tech-stack:
  added: ["vitest ^2.0.0", "@vitest/coverage-v8 ^2.0.0 (packages/react devDependencies)"]
  patterns:
    - "Internal-only animation/ module under packages/react/src, never exported from index.ts (matches AudioRecorder/STTClient convention)"
    - "Format-adapter interface (AvatarFormatAdapter) decouples shared animation logic from VRM/GLB-specific types"
    - "Manual setEffectiveWeight per-frame crossfade ramp (BlendState) instead of THREE's built-in fadeIn/fadeOut"
    - "vitest.config.ts must set css.postcss.plugins=[] in any packages/react vitest config to avoid inheriting the Next.js app's broken root PostCSS config"

key-files:
  created:
    - packages/react/vitest.config.ts
    - packages/react/src/animation/types.ts
    - packages/react/src/animation/crossfade.ts
    - packages/react/src/animation/crossfade.test.ts
  modified:
    - packages/react/package.json

key-decisions:
  - "Ported crossfade.ts verbatim from wayfinder/5-crossfade-prototype commit 6d0b9d7 per D-02, renaming the prototype's misleadingly-named avgAngle to maxAngle"
  - "poseGapToDuration accepts an optional floorSeconds parameter, unused this phase, as a forward-compat hook for Phase 11's TRANS-01/02 minimum-duration floors"
  - "vitest.config.ts short-circuits PostCSS resolution (css.postcss.plugins=[]) rather than fixing the repo root's postcss.config.mjs, since packages/react has no CSS to process and the root config drives the separate Next.js app"

requirements-completed: [XFADE-01, ANIM-01]

# Metrics
duration: 16min
completed: 2026-07-12
---

# Phase 10 Plan 01: Shared Animation Architecture & Crossfade Engine Foundation Summary

**Ported the pose-gap-adaptive eased crossfade engine (max-not-average per-bone quaternion angle, 0.3-0.9s adaptive duration, easeInOutCubic ramp) as pure unit-tested functions, plus the AvatarFormatAdapter interface, and stood up vitest in packages/react for the first time.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-07-12T14:08:11+07:00 (first task commit)
- **Completed:** 2026-07-12T14:14:32+07:00
- **Tasks:** 2 completed (Task 2 was TDD: RED + GREEN commits)
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `packages/react` now has a working vitest runner (`pnpm --filter @khaveeai/react test`), the first test infrastructure in this package
- `AvatarFormatAdapter` interface (`getMixer`, `getBoneNode`, `getExpressionManager`) defined — the seam `VRMAvatar`/`GLBAvatar` will implement in 10-02/10-03 so the shared animation module never imports format-specific types
- Crossfade engine ported verbatim from the validated `wayfinder/5-crossfade-prototype` (commit `6d0b9d7`): `easeInOutCubic`, `computePoseGapAngle` (proven max-not-average via test), `poseGapToDuration` (0.3-0.9s adaptive, optional `floorSeconds`), `BlendState`, `beginCrossfade`/`stepCrossfade`
- 15 passing unit tests, including the phase's single highest-signal assertion: a two-bone synthetic scene where one bone differs by ~0.05rad and another by ~1.98rad — the engine returns ~1.98 (the max), not ~1.02 (the mean)

## Task Commits

Each task was committed atomically:

1. **Task 1: Stand up vitest in packages/react and define the format-adapter interface** - `964cd09` (feat)
2. **Task 2 (RED): Add failing tests for crossfade engine** - `219cf27` (test)
3. **Task 2 (GREEN): Port the crossfade engine** - `a421639` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/react/vitest.config.ts` - vitest config (node env, `src/**/*.test.ts`, v8 coverage) with a PostCSS short-circuit fix
- `packages/react/package.json` - added `"test": "vitest run"` script and `vitest`/`@vitest/coverage-v8` `^2.0.0` devDependencies
- `packages/react/src/animation/types.ts` - `AvatarFormatAdapter` interface, internal-only (not in `index.ts`)
- `packages/react/src/animation/crossfade.ts` - `easeInOutCubic`, `computePoseGapAngle`, `poseGapToDuration`, `BlendState`, `beginCrossfade`, `stepCrossfade`
- `packages/react/src/animation/crossfade.test.ts` - 15 unit tests covering easing endpoints/monotonicity, duration mapping + floor, max-not-average pose-gap, non-quaternion/absent-bone track skipping, and begin/step blend-state ramp behavior

## Decisions Made
- Ported the prototype exactly per D-02 rather than re-deriving the formula, including renaming the prototype's misleadingly-named `avgAngle` variable to `maxAngle` so a later "simplification" doesn't accidentally regress to averaging
- Kept `floorSeconds` optional and unused-by-default on `poseGapToDuration`/`beginCrossfade`, per the RESEARCH.md-resolved open question, so Phase 11 can wire in TRANS-01/02's minimum-duration floors without changing call sites
- Chose `AvatarFormatAdapter` as a nominal TypeScript `interface` (not a duck-typed object shape) for clearer JSDoc-documented public contract, per RESEARCH.md's discretionary recommendation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed PostCSS config conflict blocking vitest from running in packages/react**
- **Found during:** Task 2 (running `pnpm --filter @khaveeai/react test` for the RED phase)
- **Issue:** Vite's dependency optimizer walks up from `packages/react` looking for a PostCSS config and finds the repo root's `postcss.config.mjs`, which declares `plugins: ["@tailwindcss/postcss"]` (Tailwind-CLI string convention). Vite's own `postcss-load-config` rejects this shape ("Invalid PostCSS Plugin found at: plugins[0]"), failing before any test file loads — this affected `vitest run` for *any* test in `packages/react`, not just the new crossfade tests, and would have blocked Task 1's `vitest.config.ts` from ever actually running tests.
- **Fix:** Added `css: { postcss: { plugins: [] } }` to `packages/react/vitest.config.ts` to short-circuit PostCSS resolution — `packages/react` has no CSS to process, so this has no functional downside and avoids touching the root config that the separate Next.js app depends on.
- **Files modified:** `packages/react/vitest.config.ts`
- **Verification:** `pnpm --filter @khaveeai/react test` now runs and reports its actual test results (RED: module-not-found for `crossfade.ts`; GREEN: 15/15 passing) instead of failing at config-load time.
- **Committed in:** `219cf27` (part of the Task 2 RED commit, since it was discovered while verifying that commit's test failure state)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for the plan's own verification command (`pnpm --filter @khaveeai/react test`) to be runnable at all. No scope creep — no other packages/react config or Next.js app behavior was touched.

## Issues Encountered
None beyond the PostCSS deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `AvatarFormatAdapter` and the crossfade engine are ready for 10-02 (state layer/`AnimationStateEngine.ts`) and 10-03 (`VRMAvatar.tsx`/`GLBAvatar.tsx` wiring) to consume
- Any future `packages/react` vitest config must include the same `css.postcss.plugins=[]` short-circuit until the repo root's `postcss.config.mjs` is fixed to use Vite-compatible plugin instances instead of Tailwind-CLI string names (out of scope for this plan; flagged here for awareness, not filed as a separate blocker since it doesn't affect the Next.js app itself)
- `packages/react/src/index.ts` remains unchanged — the animation module stays internal-only as required by ANIM-01/ticket #8

---
*Phase: 10-shared-animation-architecture-crossfade-engine*
*Completed: 2026-07-12*
