---
phase: 11-idle-transition-talking-states
plan: 10
subsystem: animation
tags: [react, three.js, vrm, glb, verification, gap-closure]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: "11-09's IDLE-02 amplitude fix (DEFAULT_AMPLITUDE 0.12 -> 0.35) and first-load-spin fix (shouldRunProceduralBoneWrites gate)"
provides:
  - "Confirmation that 11-09's code fixes are present and all objective gates (timer-free, additive-not-overwrite, internal-only, raised amplitude, retained ownership guard, first-mount gate) pass"
  - "Full @khaveeai/react test suite green (74/74 across 7 suites) on a fresh worktree checkout"
  - "Decisive human sign-off: IDLE-02 PASS, TALK-02 PASS; first-load spin fixed but TWO NEW regressions found (T-pose stuck on load, idle->talking transition now snaps) -- plan result is NOT approved, gap_closure required"
affects: [11-11 (or next gap-closure plan)]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: []

key-decisions: []

patterns-established: []

requirements-completed: []

# Metrics
duration: ~35min (Task 1 gates/tests + Task 2 environment prep + human checkpoint)
completed: 2026-07-16
---

# Phase 11 Plan 10: Third re-verification (IDLE-02 + TALK-02 + first-load spin) Summary

**RESULT: NOT APPROVED. Task 1's automated gates and full test suite all pass, and the human checkpoint confirms IDLE-02 and TALK-02 are now genuinely fixed -- but surfaces two NEW regressions (T-pose stuck on load, idle->talking transition snaps instead of crossfading) that were not present before 11-09 and must be root-caused in a further gap-closure pass before Phase 11 can close.**

## Performance

- **Started:** 2026-07-16 (Task 1)
- **Tasks:** 2 of 2 completed (Task 2 is a blocking human-verify checkpoint; human responded NOT approved)
- **Files modified:** 0 (verification-only plan; no source changes -- this plan documents findings, it does not fix them)

## Task 1: Fix-landed gates + full react test suite

All objective invariant gates and 11-09 fix-landed gates were re-run against the current worktree checkout (`packages/react/src/animation/`):

| Gate | Check | Result |
|------|-------|--------|
| 1. Timer-free | `grep -REc "setInterval\|setTimeout" src/animation/` — every file 0 | PASS (no non-zero matches) |
| 2. Additive-not-overwrite | `breathing.ts`/`sway.ts`: 0 `.quaternion.set(` calls (excluding comments), `.multiply(` present (3 in breathing.ts, 2 in sway.ts) | PASS |
| 3. Internal-only | `grep -Ec "breathing\|sway\|expressionDrift\|talkCycle\|audioAmplitude" src/index.ts` = 0 | PASS |
| 4. DEFAULT_AMPLITUDE raised | `expressionDrift.ts`: `DEFAULT_AMPLITUDE = 0.35` (matches `0\.(1[3-9]\|[2-9])` pattern, above the old 0.12) | PASS |
| 5. 11-07 guards intact | `lastWritten` appears 9x in `expressionDrift.ts`; `"relaxed"` still present in `DRIFT_CANDIDATES` | PASS |
| 6. Spin disposition landed | `shouldRunProceduralBoneWrites(action)` exported in `AnimationStateEngine.ts`, gating `update()` steps 4-7 (spine-base-capture/breathing/sway/spine-clamp) on `currentActionRef.current`'s effective weight >= `MIN_BASE_ACTION_WEIGHT` (0.05); matches 11-09-SUMMARY's recorded fix (not a triage-only follow-up — the guard is implemented in code) | PASS |

Full test suite (fresh worktree — `node_modules` was absent, ran `pnpm install --frozen-lockfile` first, a Rule 3 blocking-issue fix matching 11-09's precedent, no package/version changes):

```
pnpm --filter @khaveeai/react test
 Test Files  7 passed (7)
      Tests  74 passed (74)
```

All 7 suites pass, including the extended `expressionDrift.test.ts` (7 tests, including the 11-09 ready-state-perceptible / stopped-state-damped assertions) and `AnimationStateEngine.test.ts` (24 tests, including the `shouldRunProceduralBoneWrites` gate tests and the breathing+sway compounding repro test). Matches the 74/74 count 11-09-SUMMARY recorded.

**No gate failed — proceeding to the Task 2 human checkpoint per the plan's stop condition ("if ANY gate fails, STOP and report before presenting the human checkpoint").**

## Files Created/Modified

None — Task 1 is verification-only (re-running gates and the test suite against code already landed in 11-09; `files_modified: []` in the plan frontmatter). This SUMMARY.md is the only file written for Task 1.

## Decisions Made

None new — Task 1 confirms 11-09's decisions (DEFAULT_AMPLITUDE=0.35, MIN_BASE_ACTION_WEIGHT=0.05) are present and correctly gated, without re-deriving them.

## Deviations from Plan

None — plan executed exactly as written for Task 1. `pnpm install --frozen-lockfile` was required (fresh worktree had no `node_modules`) but this is standard worktree setup (Rule 3 blocking-issue fix), not a deviation from the plan's intent.

## Issues Encountered

- Fresh worktree had no `node_modules` — ran `pnpm install --frozen-lockfile` before gates/tests could run. No version changes; matches the lockfile exactly.

## Task 2: Decisive human re-verification of IDLE-02 + TALK-02 + first-load spin

**Environment:** dev server started in this worktree (`next dev --turbopack --port 3002`), both `/openai-avatar-test` (VRM) and `/glb-avatar-test` (GLB) confirmed returning 200 before the checkpoint was presented. `node_modules` installed via `pnpm install --frozen-lockfile` (fresh worktree, Rule 3 blocking-issue fix, no version changes). `.env` copied from the main repo checkout (gitignored, not present in a fresh worktree).

**Human verification result: NOT APPROVED.** 2 of 4 checked items pass; 2 concrete regressions found that were NOT present before 11-09's changes.

| # | Item | Result |
|---|------|--------|
| 1 | First-load spin | **FIXED** (no weird spin) — **BUT introduces a NEW critical regression**: the avatar now stays in a T-pose on load instead of playing/holding the idle animation. Plausibly caused by 11-09's `shouldRunProceduralBoneWrites` first-mount gate — it may be blocking the base action/mixer output entirely (not just the procedural breathing/sway writes), or the base action's weight never actually ramps, leaving the skeleton at the bind pose. |
| 2 | IDLE-02 (expression drift) | **PASS** — human confirms drift is now visible in the `ready` state. |
| 3 | TALK-02 (audio-reactive amplitude) | **PASS** — human confirms sway/breathing amplitude visibly tracks loud/quiet speech. |
| 4 | Regression spot-check | **FAIL (new regression)** — the idle→talking transition now SNAPS instead of crossfading smoothly. This previously worked (TRANS-01/TALK-01 territory). Likely the same root cause as #1: the first-mount gate or its interaction with the crossfade-trigger effect in `AnimationStateEngine.ts` may be affecting the ready→speaking transition, not just first mount. |

**Overall: NOT approved.** The originally-open items (IDLE-02, TALK-02) are now genuinely resolved, and the first-load spin itself is gone — but 11-09's fix introduced two NEW regressions that block sign-off:

1. **T-pose stuck on load** — avatar never plays/holds the idle animation after the first-load spin is suppressed.
2. **Idle→talking transition snaps** — no longer crossfades smoothly, a regression in previously-passing TRANS-01/TALK-01 territory.

Both are flagged as the MOST URGENT items for the next gap-closure pass, since they are newly introduced by 11-09's `shouldRunProceduralBoneWrites` first-mount gate (and/or its interaction with the crossfade-trigger `useEffect` in `AnimationStateEngine.ts`), not just carried-forward unresolved gaps. They need root-causing (not just re-checking) before the next verification pass.

**No fix was attempted in this plan** — Task 2 is a `checkpoint:human-verify` task whose job is to record the human's decisive judgment, not to implement fixes. Root-causing and fixing these two regressions belongs to a subsequent gap-closure plan.

## Gaps Found (blocking Phase 11 close)

- **G1 (new regression, urgent):** Avatar stuck in T-pose on first load. Suspected cause: `shouldRunProceduralBoneWrites` (or the `MIN_BASE_ACTION_WEIGHT` gate it implements) may be gating more than intended — possibly affecting whether the base action's mixer output actually reaches the skeleton, not just the additive procedural breathing/sway writes it was designed to gate. `AnimationStateEngine.ts`'s `update()` steps 4-7.
- **G2 (new regression, urgent):** Idle→talking transition no longer crossfades smoothly (snaps). Suspected cause: interaction between the first-mount gate and the crossfade-trigger `useEffect` (`switchToClip`/`beginCrossfade` call site) — possibly the gate or a related 11-09 change affects the ready→speaking transition path, not just the true first-mount case.
- Both need runtime root-causing (not a blind guess) in the next gap-closure plan, per the same rigor 11-09 applied to IDLE-02's H1/H2/H3 diagnosis.

---
*Phase: 11-idle-transition-talking-states*
*Status: COMPLETE (plan executed as designed) — verification result: NOT APPROVED, gap_closure required before Phase 11 can close*

## Self-Check: PASSED

`.planning/phases/11-idle-transition-talking-states/11-10-SUMMARY.md` confirmed present on disk. Task 1 commit `42f5b44` confirmed present in `git log --oneline --all`.
