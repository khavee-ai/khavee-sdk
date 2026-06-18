---
phase: 02-generic-pipeline-orchestrator
plan: 07
subsystem: api
tags: [tool-calling, trimHistory, openai-adapter, regression-tests, generic-stt-tts]

# Dependency graph
requires:
  - phase: 02-generic-pipeline-orchestrator
    provides: GenericPipelineProvider's CR-03 assistant/tool_calls marker-pair convention (02-06) and the GAP-02-05 pipelineToolList wiring it builds on
provides:
  - Marker-pair-aware trimHistory() that never strands a [tool_result ...] message without its [assistant_tool_calls] predecessor across the trim boundary
  - Role-gated, try/catch-wrapped mapMessage() in OpenAILLMAdapter that cannot be crashed by user/STT text starting with a marker prefix
  - Two non-vacuous regression tests (WR-05, WR-06) demonstrated to fail against the unfixed code and pass against the fix
affects: [02-generic-pipeline-orchestrator, future phases touching GenericPipelineProvider or OpenAILLMAdapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Marker-pair-aware history trimming: shift the flat tail-slice's start boundary backward via a startsWith-based backward walk so an [assistant_tool_calls] head is never separated from its [tool_result ...] group"
    - "Role-gated marker parsing in adapters: gate regex/JSON.parse branches on the message's role before testing content, with try/catch fallback to plain passthrough for malformed payloads"

key-files:
  created: []
  modified:
    - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
    - packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts
    - packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts
    - packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts

key-decisions:
  - "Marker detection in trimHistory() uses simple String.prototype.startsWith checks on .content against the literal prefixes, not the adapter's regex — keeps the orchestrator free of adapter coupling per the plan's explicit instruction"
  - "Chose the 'extend backward to include the predecessor' fix shape (02-REVIEW.md fix #1) over dropping orphaned tool-results, so no tool-call/result information is lost across a trim"
  - "WR-05 test uses a deliberately nonuniform cadence (3-call first turn, then 1-call turns) — required because a uniform 4-message-per-turn cadence always lands the flat cut on a turn boundary and can never reproduce the bug"

requirements-completed: [ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05]

# Metrics
duration: 32min
completed: 2026-06-19
---

# Phase 02 Plan 07: WR-05/WR-06 Gap Closure Summary

**Marker-pair-aware trimHistory() and role-gated mapMessage() close two warning-tier defects that could reintroduce CR-03's HTTP-400 across long tool-calling sessions or crash a turn on ordinary user text.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-06-18T20:26:01Z (UTC; reported as a 03:2x local timestamp during execution)
- **Completed:** 2026-06-19
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- WR-05 closed: `trimHistory()` in `GenericPipelineProvider.ts` now shifts its slice-start boundary backward when the flat tail-cut would strand a `[tool_result ...]` message without its `[assistant_tool_calls]` predecessor, so long tool-calling sessions never reintroduce CR-03's HTTP-400 protocol violation via the trim path.
- WR-06 closed: `OpenAILLMAdapter.mapMessage()` now gates the `ASSISTANT_TOOL_CALLS_PATTERN` branch on `message.role === "assistant"` (with the `JSON.parse` wrapped in try/catch) and the `TOOL_RESULT_PATTERN` branch on `message.role === "user"`, so ordinary user/STT text starting with a marker prefix passes through as plain content instead of throwing a `SyntaxError` mid-turn.
- Two non-vacuous regression tests added (append-only, no existing test touched): a nonuniform-cadence WR-05 test that is demonstrated to fail against the original flat-slice code and pass against the fix, and a WR-06 test asserting the role-gated passthrough behavior for both a `user`-role marker collision and a malformed `assistant`-role marker payload.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix WR-05 (marker-pair-aware trimHistory) and WR-06 (role-gated, try/catch mapMessage)** - `271a7a8` (fix)
2. **Task 2: Regression tests — trimHistory never strands a tool-result (WR-05) and user-role marker text passes through without throwing (WR-06)** - `10b2fd5` (test)

**Plan metadata:** (this commit, captured after final commit below)

## Files Created/Modified

- `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` — `trimHistory()` rewritten to compute the flat slice start, then walk it backward while `nonSystem[start]` is a `[tool_result ...]`-prefixed message, pulling the `[assistant_tool_calls]` group head (and any earlier contiguous tool-results) back into the kept window. Doc comment updated to describe the WR-05 behavior and the bounded-overshoot caveat.
- `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts` — `mapMessage()` rewritten so the tool-result branch is wrapped in `if (message.role === "user")` and the assistant/tool_calls branch in `if (message.role === "assistant")` with its `JSON.parse` wrapped in `try { ... } catch { /* fall through */ }`. Doc comment updated to describe the WR-06 role gates and fallback.
- `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` — appended a `describe("WR-05: ...")` block with a single test driving an 8-turn session (turn 1 fires 3 tool calls = 6 messages, turns 2-8 fire 1 tool call = 4 messages each), capturing a shallow copy of `args.messages` on every `complete()` call, and asserting a group-aware invariant (no `[tool_result ...]` run's first member lacks an immediately-preceding `[assistant_tool_calls]` head) across every captured array.
- `packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts` — appended two tests: one asserting a `role:"user"` message starting with `[assistant_tool_calls]` resolves without throwing and passes through verbatim in the request body, and one asserting a `role:"assistant"` message with a malformed `[assistant_tool_calls]` payload also passes through via the try/catch fallback.

## Decisions Made

- Detect markers in `trimHistory()` via plain `String.prototype.startsWith` on `.content`, not by importing/duplicating the adapter's regex — keeps the orchestrator vendor-agnostic per the plan's explicit constraint.
- Chose the "extend slice backward to keep pairs" fix shape from 02-REVIEW.md fix #1 (rather than dropping orphaned tool-results), so a marker group straddling the trim boundary is preserved in full rather than partially discarded. This means the kept window can slightly exceed `maxNonSystem` (bounded by one group's size) — documented inline and in the trimHistory doc comment.
- Used a deliberately nonuniform tool-calling cadence in the WR-05 test (first turn fires 3 tool calls = 6 messages, every later turn fires 1 = 4 messages) because a uniform 4-per-turn cadence makes the flat cut `start = max(0, len - 20)` always a multiple of 4, which always lands on a clean turn boundary and can never reproduce the bug — this was the load-bearing design constraint called out in the plan to avoid a vacuous regression test.

## Deviations from Plan

None - plan executed exactly as written. Both fixes match the suggested shapes in 02-REVIEW.md verbatim in intent, and both regression tests follow the plan's prescribed cadence/assertion design exactly.

## Non-Vacuity Verification (required by plan)

Per the plan's explicit instruction, the WR-05 test's fail-against-flat/pass-against-fix transition was demonstrated directly (not just reasoned about):

1. Temporarily disabled the marker-pair backward-walk in `trimHistory()` (reverted to the original flat `nonSystem.slice(-maxNonSystem)`).
2. Ran `pnpm --filter @khaveeai/providers-generic-stt-tts test --run -t "WR-05"` — the test **FAILED** with `AssertionError: expected 0 to be greater than 0` at the `expect(groupStart).toBeGreaterThan(0)` line — exactly the predicted failure mode (turn 5's trim strands group 1's first tool-result `c1a`, `groupStart` walks back to 0 with no preceding `[assistant_tool_calls]` marker in range).
3. Restored the Task 1 fix (file content matched the committed version byte-for-byte via `git diff` showing no changes) and re-ran the same filtered test — it **PASSED**.
4. Ran the full suite again afterward — all 36 tests green (33 prior + 1 WR-05 + 2 WR-06).

This confirms the WR-05 test is non-vacuous: it genuinely discriminates between the buggy and fixed `trimHistory()` implementations.

## Issues Encountered

- The worktree's `node_modules` for `packages/providers/generic-stt-tts` (and several other packages) were missing at the start of execution (only `dist/` and an empty `node_modules/` listing showed as untracked in git status). Ran `pnpm install` at the repo root to relink the workspace, then built `@khaveeai/core` and `@khaveeai/providers-openai-stt-tts` (the generic-stt-tts package's build/type dependencies) before building/testing `generic-stt-tts` itself. This is environment setup, not a code deviation — no source files were affected and the `pnpm install` lockfile-only changes are not part of this plan's diff.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WR-05 and WR-06 are closed. WR-02 (`resumeWithCooldown` unconditional call), WR-03 (`isConnected` guard), WR-04 (unused `react` peerDependency), and IN-03 remain carried-forward findings, untouched per scope guard.
- `pnpm --filter @khaveeai/providers-generic-stt-tts build` exits 0; `pnpm --filter @khaveeai/providers-generic-stt-tts test --run` is 36/36 green; `pnpm --filter @khaveeai/providers-openai-stt-tts test --run` remains 13/13 green (compatibility constraint upheld).
- No blockers for closing out Phase 02 or proceeding to the next milestone phase.

---
*Phase: 02-generic-pipeline-orchestrator*
*Completed: 2026-06-19*
