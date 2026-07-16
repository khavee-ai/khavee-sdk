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
  - "Decisive human re-verification record: G1 STILL FAILS (pre-connect T-pose persists), G2 APPROVED (smooth), plus 2 new findings (Y-axis drop-on-connect, TALK-01 clip-cycle jiggle) — Phase 11 gap closure is NOT complete, a further round is required"
affects: [11-13-or-next-gap-closure-round]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: []

key-decisions:
  - "Task 1's objective gates (1-7) were run before presenting the Task 2 checkpoint, per the plan's explicit instruction not to put a checkpoint on top of a failing invariant."
  - "Task 2 checkpoint result recorded verbatim from the human's report, exactly as given, without inferring pass/fail on items not explicitly addressed (IDLE-01, IDLE-02, TRANS-01, TRANS-02, TALK-02, PERF-01 are recorded as NOT explicitly re-confirmed this round, not as pass or fail)."

patterns-established: []

requirements-completed: []  # NOT populated — checkpoint result is NOT approved; G1 still fails. See "Task 2 Checkpoint Result" below.

# Metrics
duration: ~50min (Task 1 gates/tests + environment setup + Task 2 checkpoint)
completed: 2026-07-17
---

# Phase 11 Plan 12: Fourth gap-closure re-verification — G1 STILL FAILS (pre-connect T-pose), G2 approved, 2 new findings — NOT approved, further gap closure required

**Task 1's objective gates and full test suite (80/80) all pass, confirming 11-11's code-level fix landed — but the Task 2 decisive human checkpoint found G1 (T-pose on load) still fails in the pre-connect resting state, plus two new findings (a Y-axis drop-on-connect regression and a minor TALK-01 clip-cycle jiggle). G2 (idle→talking crossfade) is confirmed smooth and approved. Phase 11 gap closure is NOT complete.**

## Performance

- **Started:** 2026-07-17 (Task 1)
- **Tasks:** 2 of 2 executed (Task 1 auto — passed; Task 2 `checkpoint:human-verify gate="blocking"` — NOT approved)
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

## Task 2 Checkpoint Result — NOT APPROVED

Human verification was performed against this worktree's dev server (`http://localhost:3002`, both `/openai-avatar-test` and `/glb-avatar-test` confirmed 200 before the checkpoint was presented). The result is recorded here verbatim/faithfully from the human's report, without inference beyond what was explicitly stated.

**Overall: NOT approved.**

1. **G1 (first-load pose): STILL FAILS.** The pre-connect T-pose persists on first load. It only resolves to a live idle pose once the human presses Connect — so 11-11's `resetToRestPoseIfNotDriven` fix did not fix the pre-connect (pre-`switchToClip`) T-pose case; whatever it did fix appears to only show up post-connect. This means the actual resting state a user sees before connecting is still unresolved, contrary to 11-11-SUMMARY's claim that G1 "fixes visible idle motion immediately (fixing G1)."

2. **NEW REGRESSION — Y-axis drop on connect:** When first connecting, the avatar visibly moves/drops downward on the Y axis ("look like it drop"). This was NOT reported in any prior round (11-09, 11-10, or 11-11's own diagnosis) and is recorded as a new, distinct finding — not folded into G1's existing description.

3. **G2 (idle→talking transition smoothness): APPROVED.** Human confirms this is now smooth — no snap/pop observed.

4. **NEW MINOR ISSUE — TALK-01 clip-cycle jiggle:** Human reports "a little jiggle" when the talk clip cycles between variants. Not described as a snap or major regression — a small jiggle — but worth recording as a new/unresolved observation since TALK-01 was previously fully passing (per 11-10-SUMMARY).

5. **Remaining regression-checklist items (IDLE-01, IDLE-02, TRANS-01, TRANS-02, TALK-02, PERF-01): NOT explicitly re-confirmed this round.** The human did not explicitly confirm or deny these beyond what's listed above. They are recorded as not re-confirmed — NOT as passing, NOT as failing.

**Most urgent items for the next gap-closure pass** (per the human's framing): G1 is still failing in its actual pre-connect resting-state form — 11-11's fix appears to only cover a post-connect/crossfade-adjacent case, not the true resting state before any `switchToClip` call has ever fired — plus the newly-observed Y-axis drop-on-connect regression. The TALK-01 jiggle is recorded as a secondary, minor finding.

## Task Commits

1. **Task 1: Fix-landed + invariant gates + full react test suite** — verification-only, no source files modified; PASSED (all 7 gates + 80/80 tests). Commit: `a98c370`.
2. **Task 2: Decisive human re-verification** — executed; result: **NOT approved**. No commit for Task 2 itself (checkpoint interaction only); this SUMMARY's final update (documenting the checkpoint result) is committed separately — see git log.

## Files Created/Modified

None (verification-only plan; `packages/react/node_modules` was reinstalled via `pnpm install --frozen-lockfile`, and a gitignored `.env` was copied into this worktree, both environment setup for running tests/dev server, not tracked file changes).

## Decisions Made

- Ran all 7 objective gates and the full test suite in Task 1 BEFORE presenting the Task 2 checkpoint, per the plan's explicit instruction ("If ANY gate fails, STOP and report before presenting the human checkpoint — do not put a checkpoint on top of a failing invariant"). All gates passed, so the checkpoint was presented as scheduled.
- Started the dev server (`next dev --turbopack --port 3002`) and confirmed both `/openai-avatar-test` and `/glb-avatar-test` return 200 in THIS worktree before presenting the checkpoint, per the automation-first protocol.
- Recorded the Task 2 checkpoint result exactly as reported by the human, without inferring pass/fail on the 6 requirement items not explicitly addressed, and without treating G2's approval or the objective gates passing as blanket approval of the whole plan.

## Deviations from Plan

None — plan executed exactly as written. `node_modules` was missing in this fresh worktree and was restored via `pnpm install --frozen-lockfile`; `.env` was copied from the root repo (both environment setup, not plan deviations).

## Issues Encountered

- `pnpm --filter @khaveeai/react test` initially failed with `vitest: command not found` because this worktree's `node_modules` had not yet been installed. Resolved by running `pnpm install --frozen-lockfile` at the repo root before re-running the test command.
- **Substantive issue (not a plan-execution issue, but the checkpoint's actual finding):** 11-11's `resetToRestPoseIfNotDriven` fix does not resolve G1 in its real-world form. The fix resets spine/chest/hips to a captured rest-pose anchor while `!shouldRunProceduralBoneWrites(currentActionRef.current)`, and `currentActionRef.current` starts `null` before any `switchToClip` call ever fires (i.e. the true pre-connect state, before `chatStatus` first resolves a target clip). The human's report that the T-pose persists until Connect is pressed, and only then resolves, is consistent with the fix's per-frame reset+breathing/sway composition only becoming visibly effective once `switchToClip` has fired at least once — meaning the very first frames (pre-connect, pre-`switchToClip`) may not be exercising `resetToRestPoseIfNotDriven`'s breathing/sway composition the way 11-11 intended, or the pre-connect render path does not call `update(delta)` at all until connect. This is a hypothesis based on rereading the code in light of the human's report — it has NOT been re-diagnosed at runtime this round, and per this plan's scope (verification-only, no code changes), no fix was attempted. It is flagged here for the next gap-closure plan to investigate empirically rather than asserted as confirmed root cause.

## User Setup Required

None — the human's checkpoint verification was the required manual step for Task 2, now complete (with a NOT-approved result).

## Next Phase Readiness

- **Phase 11 gap closure is NOT complete.** A further gap-closure plan (11-13 or similar) is required to:
  1. Root-cause and fix G1's persistent pre-connect T-pose (the actual resting state before Connect is pressed — 11-11's fix did not resolve this case).
  2. Root-cause and fix the newly-reported Y-axis drop-on-connect regression (not previously reported in any prior round).
  3. Investigate the newly-reported TALK-01 clip-cycle jiggle (minor, non-blocking per the human's framing, but should not be silently dropped).
  4. Re-confirm the 6 requirement items not explicitly re-checked this round (IDLE-01, IDLE-02, TRANS-01, TRANS-02, TALK-02, PERF-01) once G1/the Y-drop are fixed.
- G2 (idle→talking crossfade smoothness) is confirmed resolved and does not need re-verification in the next round unless a subsequent fix touches the same crossfade code path.
- Objective gates (timer-free, additive-not-overwrite, internal-only, IDLE-02/PERF-01 grep-level invariants) and the full test suite remain green at the code level — the gap is specifically in runtime/visual behavior the automated gates cannot catch, consistent with why this plan required a human checkpoint at all.
- No STATE.md/ROADMAP.md updates were made by this worktree agent per the orchestrator's instructions; the orchestrator should record this plan's NOT-approved outcome and the need for a further gap-closure round when merging this worktree's results back.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-17 (Task 1 passed; Task 2 checkpoint executed, result: NOT approved — further gap closure required)*

## Self-Check: PASSED

`.planning/phases/11-idle-transition-talking-states/11-12-SUMMARY.md` confirmed present on disk. Commit `a98c370` (Task 1 gate results) confirmed present in `git log --oneline --all`.
