---
phase: 11-idle-transition-talking-states
plan: 08
subsystem: animation
tags: [verification, checkpoint, human-uat, gap-closure]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: "11-07 gap-closure fixes: memoized getAction/getRoot accessors, dropped getAction from crossfade-trigger effect deps, eased settleScale via easeInOutCubic over SETTLE_RAMP_SECONDS, expressionDrift retargeted to relaxed/happy with lastWritten ownership tracking"
provides:
  - "Objective invariant + fix-landed gate results (all 7 gates passed)"
  - "Full react test suite result (67/67 passing, including expressionDrift.test.ts)"
  - "Human per-state re-verification results: 5 of 7 behaviors now pass, IDLE-02 still fails, TALK-02 unconfirmed"
  - "New unreported bug surfaced: first-load 'spins weird' avatar motion during initial mount/pose-init"
affects: [phase-11-gap-closure]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: []

key-decisions:
  - "Task 1 gate verification and test run performed with no code changes (verification-only plan, files_modified: [] in frontmatter)"
  - "Ran pnpm install --frozen-lockfile to populate a fresh worktree's missing node_modules (Rule 3 blocking-issue fix, not a new package addition — installed strictly from the already-committed lockfile)"
  - "Started a dedicated dev server on port 3002 from within this worktree (not the main repo's own dev server on port 3000) so the human verified this worktree's exact code, not a possibly-stale main-repo checkout"

patterns-established: []

requirements-completed: [IDLE-01, TRANS-01, TRANS-02, TALK-01, PERF-01]

# Metrics
duration: ~35min
completed: 2026-07-16
status: gaps_found
---

# Phase 11 Plan 08: Gap-Closure Re-Verification Summary — PARTIAL PASS, GAPS REMAIN

**Task 1 (objective + fix-landed gates, full test suite) passed cleanly — all 11-07 fixes confirmed landed in code. Task 2 (human per-state re-verification) found 5 of 7 behaviors now passing (including 3 of the 4 previously-failing ones: TRANS-01, TRANS-02, TALK-01), but IDLE-02 (VRM expression drift) still fails and TALK-02 (audio-reactive amplitude) is unconfirmed rather than a clean pass. A new, previously-untracked bug was also surfaced: strange/spinning avatar motion on first load. Phase 11 gap closure is NOT complete.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-16T06:25:00Z (approx)
- **Completed:** 2026-07-16T07:00:00Z (approx)
- **Tasks:** 2 (1 auto, 1 checkpoint)
- **Files modified:** 0 (verification-only plan)

## Accomplishments
- Confirmed all 3 objective invariant gates from 11-06 still hold after 11-07's changes (timer-free, additive-not-overwrite, internal-only)
- Confirmed all 4 fix-landed gates prove 11-07's code changes are actually present (deps change, eased settle ramp, drift ownership + candidate list, memoized accessors)
- Confirmed full `@khaveeai/react` test suite green: 67/67 tests across 7 suites, including the new `expressionDrift.test.ts`
- Human re-verification confirmed TRANS-01, TRANS-02, and TALK-01 — the three most severe previously-failing behaviors ("snaps, not smooth" and talk-variant snap-back/jitter) — are now fixed
- Surfaced a concrete remaining gap (IDLE-02 still not visibly working) and an unconfirmed item (TALK-02) with enough detail for a targeted follow-up gap-closure plan
- Surfaced a new, previously-untracked first-load motion bug for future root-causing

## Task Commits

This plan is verification-only (`files_modified: []`); Task 1 produced no code changes to commit. `pnpm install --frozen-lockfile` regenerated `node_modules` (gitignored, not committed) with no lockfile diff.

1. **Task 1: Objective invariant + fix-landed gates and full test suite** — no commit (no files changed; results recorded below)
2. **Task 2: Per-state human re-verification checkpoint** — no commit (verification-only; results recorded below)

**Plan metadata:** committed with this SUMMARY.md

## Task 1: Objective Invariant + Fix-Landed Gates — ALL PASSED

| Gate | Result |
|------|--------|
| 1. No `setInterval`/`setTimeout` in `packages/react/src/animation/` | PASS — 0 matches across all files |
| 2. `breathing.ts`/`sway.ts` additive-not-overwrite (0 `.quaternion.set(`, ≥1 `.multiply(`) | PASS — breathing: 0 set / 3 multiply; sway: 0 set / 2 multiply |
| 3. Internal-only convention (`breathing\|sway\|expressionDrift\|talkCycle\|audioAmplitude` not in `index.ts`) | PASS — 0 matches |
| 4. `getAction` dropped from crossfade-trigger effect deps (`targetName, getAction, chatStatus` no longer appears) | PASS — 0 matches of old dep-array string |
| 5. `SETTLE_RAMP_SECONDS` (≥2) + `easeInOutCubic` present in `AnimationStateEngine.ts` | PASS — 3 matches each |
| 6. `lastWritten` (≥1) + `"relaxed"` candidate in `expressionDrift.ts` | PASS — 8 and 4 matches |
| 7. `useCallback` appears in both `VRMAvatar.tsx` and `GLBAvatar.tsx` | PASS — 3 matches each |
| `pnpm --filter @khaveeai/react test` | PASS — 7 test files, 67/67 tests passing, including `expressionDrift.test.ts` |

All gates passed exactly as required; the plan proceeded to the human checkpoint per its own gating rule ("if ANY gate fails, stop and report before presenting the human checkpoint").

## Task 2: Human Per-State Re-Verification — 5/7 PASS, GAPS REMAIN

Verified live against a dev server started from this worktree (port 3002, distinct from the main repo checkout's own dev server on port 3000) on `/openai-avatar-test` (VRM) and `/glb-avatar-test` (GLB).

Recorded verbatim from the human's checkpoint response:

| # | Requirement | 11-06 Result | 11-08 Result | Notes |
|---|-------------|---------------|---------------|-------|
| 1 | IDLE-01 | Not reported failing (unchallenged) | **approved** | Breathing/sway re-confirmed after 11-07 changed the shared `update()` settle path |
| 2 | IDLE-02 | **FAIL** | **FAIL (still failing)** | "I see no expression changes." Still not visibly working on VRM. |
| 3 | TRANS-01 | **FAIL** | **approved** | Start-of-session transition now smooth |
| 4 | TRANS-02 | **FAIL** | **approved** | End-of-session settle now smooth |
| 5 | TALK-01 | **FAIL** | **approved** | Talk-cycle no longer snaps/jitters/snaps back |
| 6 | TALK-02 | Not reported failing (unchallenged) | **"maybe pass" — unconfirmed** | Uncertain/not a clean pass; treated as unconfirmed, not approved |
| 7 | PERF-01 | Not reported failing (unchallenged) | **approved** | Bounded composition confirmed |

**Overall checkpoint result: NOT a full "approved."** Per the human's explicit instruction, IDLE-02 is recorded as a remaining failing behavior and TALK-02 as unconfirmed (not passing) — neither is marked complete in this plan's requirements.

### New observation (not one of the tracked 7 requirements)

On first load, the avatar "moves strangely... spins weird." This was not part of the original wayfinder verification checklist and is not one of Phase 11's tracked requirements. It is flagged here as a new follow-up item, not fixed in this plan (verification-only). It plausibly belongs to the same effect/init-timing bug class that 11-07 just fixed (unstable accessor identity re-firing the crossfade-trigger effect, or an unguarded first-mount transition before any settle/floor logic applies) and is worth root-causing in a future gap-closure plan.

## Files Created/Modified

None. This is a verification-only plan; no source files were modified.

## Decisions Made

- Ran `pnpm install --frozen-lockfile` to populate this worktree's missing `node_modules` before running the test suite — a fresh worktree checkout has no `node_modules` by default; installing strictly from the already-committed lockfile (no version changes, no new packages) is a Rule 3 blocking-issue fix, not a package addition requiring a legitimacy checkpoint.
- Started a dedicated dev server on port 3002 from inside this worktree rather than reusing the main repo's own dev server already running on port 3000 — confirmed via `diff` that the relevant source files (`AnimationStateEngine.ts`, `expressionDrift.ts`, `VRMAvatar.tsx`) were byte-identical between the two checkouts at verification time, but used the worktree-local server anyway to guarantee the human was looking at this worktree's exact code rather than depending on that coincidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing node_modules in fresh worktree**
- **Found during:** Task 1 (running `pnpm --filter @khaveeai/react test`)
- **Issue:** `vitest: command not found` — this worktree had no `node_modules` installed, blocking the required test-suite gate
- **Fix:** Ran `pnpm install --frozen-lockfile` (installs exactly what the committed `pnpm-lock.yaml` specifies; no new packages, no lockfile changes)
- **Files modified:** none tracked (`node_modules/` is gitignored; `pnpm-lock.yaml` unchanged after install)
- **Verification:** `pnpm --filter @khaveeai/react test` then ran successfully, 67/67 passing
- **Committed in:** N/A (no tracked file changes)

**2. [Rule 3 - Blocking] Added dev-server startup before the human-verify checkpoint**
- **Found during:** preparing Task 2's checkpoint
- **Issue:** Plan's checkpoint instructs the human to run `pnpm dev`, but per the automation-first checkpoint protocol the executor should ensure the verification environment is ready beforehand rather than asking the human to run CLI commands; additionally port 3000 was already occupied by the main repo's own dev server (different checkout), and port 3001 by an unrelated `khavee-app` process
- **Fix:** Started `next dev --turbopack --port 3002` from within this worktree in the background, confirmed both `/openai-avatar-test` and `/glb-avatar-test` compiled and returned 200 before presenting the checkpoint; stopped the server after the human's verification response was received
- **Files modified:** none
- **Verification:** `curl` 200 responses on both routes prior to presenting the checkpoint
- **Committed in:** N/A (no tracked file changes)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking-issue fixes required to complete verification, no scope creep, no source code touched)
**Impact on plan:** Both fixes were required purely to execute the verification plan itself (populate deps, serve the correct code to the human) — no functional/behavioral code was changed by this plan.

## Issues Encountered

- IDLE-02 (VRM expression drift) remains a failing behavior despite 11-07's fix (retargeting `DRIFT_CANDIDATES` to `relaxed`/`happy` and adding `lastWritten` ownership tracking) — the human reports "I see no expression changes." Root cause not re-diagnosed in this plan (verification-only); needs a fresh gap-closure investigation. Possible directions for the next pass: re-verify at runtime which expression names `male.vrm`/`blue-female.vrm` actually expose (the objective gates only confirm the code *references* `"relaxed"`, not that the loaded VRM model has an expression by that name), check whether `expressionDrift`'s per-frame write amplitude is large enough to be visually perceptible, or check whether something else in the render/composition pipeline is overwriting the drift's output before it reaches the model.
- TALK-02 (audio-reactive amplitude) reported as "maybe pass" — not a clean confirmation. Needs a more decisive re-check in the next pass (e.g. side-by-side loud/quiet comparison with clearer visual cues) rather than being carried forward as ambiguous.
- New, previously-untracked bug: avatar "spins weird" on first load. Not one of Phase 11's 7 tracked requirements or the wayfinder checklist; not root-caused or fixed in this plan. Flagged for a future gap-closure plan, plausibly related to the same effect re-fire / init-timing bug class 11-07 addressed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Phase 11 gap closure is NOT complete.** Remaining work before Phase 11 can be marked done:

1. **IDLE-02** (VRM expression drift still not visible) — needs a new root-cause investigation and fix, then re-verification.
2. **TALK-02** (audio-reactive amplitude — "maybe pass") — needs a more decisive re-check, not necessarily a code fix (may already work; verification method itself may need to be clearer).
3. **New first-load spin bug** (untracked, not one of the 7 requirements) — needs root-causing; recommend triaging into a GitHub issue or a new gap-closure plan task, not silently absorbed into IDLE-02/TALK-02 scope.

Recommended path: `/gsd:plan-phase 11 --gaps` to generate a further gap-closure plan targeting IDLE-02, TALK-02 re-confirmation, and the new first-load bug, followed by another human-verify checkpoint re-run.

Confirmed passing and safe to treat as done (not requiring further gap-closure attention): IDLE-01, TRANS-01, TRANS-02, TALK-01, PERF-01.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-16*
