---
phase: 11-idle-transition-talking-states
plan: 12
subsystem: animation
tags: [react, three.js, vrm, crossfade, procedural-animation, gap-closure, verification]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: "11-11's resetToRestPoseIfNotDriven fix for G1 (T-pose on load) and G2 (idle->talking snap), replacing 11-09's whole-block skip gate"
provides:
  - "Objective invariant + fix-landed gate confirmation that 11-11's fix is present, the 11-09 spin is not reintroduced, and the full react test suite is green (80/80 across 7 suites)"
  - "Decisive human re-verification record: G1, G2, and all 7 original Phase-11 requirements re-checked against a running dev build in this worktree"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: []

key-decisions:
  - "Task 1's objective gates (1-7) were run before presenting the Task 2 checkpoint, per the plan's explicit instruction not to put a checkpoint on top of a failing invariant."

patterns-established: []

requirements-completed: []  # populated after Task 2 human sign-off; see checkpoint section below

# Metrics
duration: (in progress — Task 1 complete, Task 2 checkpoint pending)
completed: 2026-07-17
---

# Phase 11 Plan 12: Fourth (final) gap-closure re-verification — objective gates green, human checkpoint pending

**Task 1's objective invariant + fix-landed gates all pass and the full `@khaveeai/react` test suite is green (80/80 across 7 suites), confirming 11-11's G1/G2 fix is present and the 11-09 spin is not reintroduced — proceeding to the Task 2 decisive human re-verification checkpoint.**

## Performance

- **Started:** 2026-07-17 (Task 1)
- **Tasks:** 1 of 2 completed (Task 1 auto; Task 2 is `checkpoint:human-verify gate="blocking"`)
- **Files modified:** 0 (verification-only plan, `files_modified: []` per frontmatter)

## Accomplishments — Task 1 (objective gates)

### Invariant gates (must still hold after 11-11)

1. **Timer-free:** `grep -REc "setInterval|setTimeout" packages/react/src/animation/` — every file returns `0`. **PASS.**
2. **Additive-not-overwrite:** `breathing.ts` and `sway.ts` — `.quaternion.set(` count is `0` in both; `.multiply(` count is `3` (breathing.ts) and `2` (sway.ts), both `>= 1`. **PASS.**
3. **Internal-only:** `grep -Ec "breathing|sway|expressionDrift|talkCycle|audioAmplitude" packages/react/src/index.ts` returns `0`. **PASS.**
4. **IDLE-02 intact:** `DEFAULT_AMPLITUDE *= 0.(1[3-9]|[2-9])` pattern matches in `expressionDrift.ts`; `lastWritten` and `"relaxed"` both still present. **PASS.**
5. **PERF-01 intact:** `MAX_COMBINED_SPINE_DELTA_RAD` present in `AnimationStateEngine.ts`; `breathing.step` call present (guarded, not deleted). **PASS.**

### Fix-landed gates (prove 11-11 is present)

6. **G1/G2 fix present:** `AnimationStateEngine.ts`'s file header carries a dedicated "11-11 gap closure (T-pose-on-load [G1] + idle->talking snap [G2])" block (lines 47-115) recording the disproof of 11-09's two leading hypotheses (G1-a remap-coverage gap, G1-b gate-never-opens) and G2's pose-gap-collapse lead, plus the confirmed shared mechanism (`shouldRunProceduralBoneWrites` re-closes on every `switchToClip`, not just first mount). The fix itself — `resetToRestPoseIfNotDriven` (exported, lines 241-254) and `restPoseRef` (line 394) — is present in code, and `update()`'s steps 4-7 run unconditionally every frame with a 4a/4b reset-if-not-driven sub-step (lines 523-561), matching what 11-11-SUMMARY.md records as its Task 2 fix. **PASS.**
7. **Spin NOT reintroduced:** `MIN_BASE_ACTION_WEIGHT` (line 179, value `0.05`) was NOT lowered — 11-11 left the gate's threshold unchanged and instead added the per-frame reset-to-fixed-anchor, which is the plan-pre-authorized "capture the bone's orientation at the start / restore-then-apply-additive-delta" fix strategy. `AnimationStateEngine.test.ts` contains `describe("G1 fix — visible idle motion during a persistently near-zero-weight window (11-11)"` (line 259) and a 300-frame "spin-not-reintroduced" bounded-accumulation test (line 359 area), alongside the pre-existing 11-09 first-mount compounding repro (still present and still passing). **PASS.**

### Full test suite

`pnpm --filter @khaveeai/react test` (after `pnpm install --frozen-lockfile` to restore this worktree's `node_modules`, which was absent at task start):

```
Test Files  7 passed (7)
     Tests  80 passed (80)
  Duration  493ms
```

All 7 suites green: `audioAmplitude.test.ts` (4), `expressionDrift.test.ts` (7), `talkCycle.test.ts` (9), `breathing.test.ts` (8), `crossfade.test.ts` (15), `AnimationStateEngine.test.ts` (30), `sway.test.ts` (7) = 80 total, matching 11-11-SUMMARY.md's recorded count (up from 74/74 pre-11-11). **PASS.**

**All 7 gates + full test suite pass. Proceeding to the Task 2 checkpoint (not blocked).**

## Task Commits

1. **Task 1: Fix-landed + invariant gates + full react test suite** — verification-only, no source files modified; this SUMMARY documents the gate results. Commit: (this file, committed alongside Task 1 completion — see git log).
2. **Task 2: Decisive human re-verification** — pending (`checkpoint:human-verify`, `gate="blocking"`). Awaiting human sign-off; see checkpoint section below once resumed.

## Files Created/Modified

None (verification-only plan; `packages/react/node_modules` was reinstalled via `pnpm install --frozen-lockfile` to run tests in this worktree, not a tracked file change).

## Decisions Made

- Ran all 7 objective gates and the full test suite in Task 1 BEFORE presenting the Task 2 checkpoint, per the plan's explicit instruction ("If ANY gate fails, STOP and report before presenting the human checkpoint — do not put a checkpoint on top of a failing invariant"). All gates passed, so the checkpoint is presented as scheduled.

## Deviations from Plan

None — plan executed exactly as written for Task 1. `node_modules` was missing in this fresh worktree and was restored via `pnpm install --frozen-lockfile` (environment setup, not a plan deviation) to run the required test suite.

## Issues Encountered

- `pnpm --filter @khaveeai/react test` initially failed with `vitest: command not found` because this worktree's `node_modules` had not yet been installed. Resolved by running `pnpm install --frozen-lockfile` at the repo root before re-running the test command.

## User Setup Required

None for Task 1. Task 2 requires a human to visually verify a running dev build — see checkpoint below.

## Next Phase Readiness

- Objective gates all green; Task 2's human checkpoint is the sole remaining gate before Phase 11 gap closure can be declared complete.
- This SUMMARY will be appended after Task 2 resolves with the human's decisive sign-off or a reported remaining gap.

---
*Phase: 11-idle-transition-talking-states*
*Completed: (pending Task 2)*
