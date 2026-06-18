---
phase: 02-generic-pipeline-orchestrator
plan: 04
subsystem: api
tags: [abort-controller, concurrency, vitest, generic-stt-tts, barge-in]

# Dependency graph
requires:
  - phase: 02-generic-pipeline-orchestrator (plan 03)
    provides: GenericPipelineProvider with VAD-driven full-interruption barge-in (D-03) and the activeTurnController field
provides:
  - "CR-01 fix: runTurnFromText() and runTurn() guard against a superseded turn mutating shared conversation/messages state"
  - "CR-02 fix: sendMessage() owns/aborts/registers/clears its own AbortController, mirroring runTurn()'s turn-ownership semantics"
  - Two regression tests locking both fixes in (CR-01 stale-utterance discard, CR-02 sendMessage-vs-VAD coordination)
affects: [02-VERIFICATION, ORCH-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Turn-ownership entry-point parity: every method that can start a turn (runTurn, sendMessage) must independently abort-prior/create-fresh/register/clear-in-finally its own AbortController — no entry point may borrow or read another's controller"
    - "Abort checks must precede the first side effect of a turn, not just precede the next async call — guard placement at the very top of the function body (before try) is required for true zero-mutation discard"

key-files:
  created: []
  modified:
    - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
    - packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts

key-decisions:
  - "Applied the exact fix snippets documented in 02-REVIEW.md CR-01/CR-02 verbatim, adapted only to the existing try-block structure of runTurnFromText"
  - "sendMessage()'s try/finally wrapper has no catch of its own — it relies on runTurnFromText's existing internal catch/onError normalization, matching how runTurn() also relies on runTurnFromText's error handling for the text path"

patterns-established:
  - "Pattern: 'abort-prior + register-fresh + finally-clear' AbortController ownership template, now implemented identically in both runTurn() and sendMessage()"

requirements-completed: [ORCH-03]

# Metrics
duration: 12min
completed: 2026-06-18
---

# Phase 2 Plan 04: ORCH-03 Gap Closure (CR-01/CR-02) Summary

**Fixed two concurrency defects in GenericPipelineProvider's barge-in mechanism (stale-turn conversation corruption and sendMessage/VAD race) and added regression tests proving both fixes, lifting ORCH-03 from BLOCKED to SATISFIED.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-18T17:18:00+07:00 (approx, branch check)
- **Completed:** 2026-06-18T17:31:21+07:00
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `runTurnFromText()` now returns immediately on an already-aborted signal, before any mutation of `this.messages`/`this.conversation` — a superseded turn can no longer corrupt conversation history (CR-01 part A)
- `runTurn()` re-checks `controller.signal.aborted` immediately after `stt.transcribe()` resolves, before proceeding into the non-empty-text `runTurnFromText` call — mirrors the existing empty-text guard (CR-01 part B)
- `sendMessage()` now owns its own `AbortController`: aborts any existing `activeTurnController`, registers a fresh one, awaits `runTurnFromText` with that signal, and clears it in a `finally` block only if it is still the active controller — identical turn-ownership semantics to `runTurn()` (CR-02)
- Two new regression tests (`CR-01`, `CR-02` describe blocks) encode the exact reproduction scenarios from 02-VERIFICATION.md; both were confirmed to fail against the pre-fix code and pass against the Task 1 fixes

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix CR-01 (abort guards in runTurnFromText + runTurn) and CR-02 (sendMessage controller ownership)** - `b458a8e` (fix)
2. **Task 2: Regression tests — CR-01 stale-utterance discard + CR-02 sendMessage-vs-concurrent-VAD coordination** - `3ee6025` (test)

_Note: this is a `tdd="true"` plan but the GREEN-fix-then-test order matches the gap-closure nature of the plan — the fixes (Task 1) implement the documented review snippets, and Task 2's regression tests were verified red-then-green against the pre-fix vs. post-fix code as part of task verification (see Issues Encountered) before being committed._

**Plan metadata:** (orchestrator will commit SUMMARY.md/REQUIREMENTS.md separately per worktree convention)

## Files Created/Modified
- `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` - Three surgical edits: runTurnFromText entry guard, runTurn post-STT abort re-check, sendMessage AbortController ownership
- `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` - Two new regression tests (`CR-01`, `CR-02` describes) appended after the existing ORCH-04 describe block

## Decisions Made
- Followed the 02-REVIEW.md documented fix snippets verbatim rather than designing alternative mitigations — this is a gap-closure plan scoped exactly to CR-01/CR-02
- Did not add a `catch` to `sendMessage()`'s new try/finally wrapper, since `runTurnFromText` already owns error normalization/`onError` dispatch internally (consistent with how `runTurn()` relies on the same mechanism for its text path)

## Deviations from Plan

None - plan executed exactly as written. All three edits in Task 1 and both regression tests in Task 2 match the plan's `<action>` specification precisely.

## Issues Encountered
- The worktree had no `node_modules` installed (fresh worktree checkout under `isolation="worktree"`). Verified the main repo's `pnpm-lock.yaml` was byte-identical to the worktree's, then created read-only symlinks from the main repo's `node_modules` (root + per-package) into the worktree purely for running `tsc`/`vitest` during verification. All symlinks were removed before the final commit — `git status --short` is clean and no symlink or generated artifact was staged or committed.
- To independently verify the two new regression tests were genuine (not tautological), the pre-fix version of `GenericPipelineProvider.ts` (from `git show HEAD~1:...`) was temporarily copied over the working file (no git operations — manual file copy only) and the test suite re-run: both `CR-01` and `CR-02` tests failed as expected against the unfixed code. The fixed file was then restored from a `/tmp` backup and confirmed identical to the committed version (`git diff` showed no changes) before proceeding.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ORCH-03 / SC3 / D-03 full barge-in is now FULLY true: a superseded turn never corrupts conversation/messages, and `sendMessage()` participates in the single-active-turn invariant
- Build clean (`pnpm --filter @khaveeai/providers-generic-stt-tts build` exits 0); 28/28 generic-stt-tts tests pass (26 prior + 2 new); 13/13 `openai-stt-tts` tests pass unchanged (compatibility constraint honored)
- WR-01..WR-05 and IN-01..IN-03 from 02-REVIEW.md remain untouched, as scoped — available for a future gap-closure or hardening plan if prioritized
- No new threat-model surface introduced beyond the two STRIDE entries (T-02-07, T-02-10) already documented in this plan's `<threat_model>` and mitigated by these fixes

---
*Phase: 02-generic-pipeline-orchestrator*
*Completed: 2026-06-18*

## Self-Check: PASSED

- FOUND: packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
- FOUND: packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts
- FOUND: .planning/phases/02-generic-pipeline-orchestrator/02-04-SUMMARY.md
- FOUND commit: b458a8e (Task 1)
- FOUND commit: 3ee6025 (Task 2)
- FOUND commit: 7d01d2e (SUMMARY)
