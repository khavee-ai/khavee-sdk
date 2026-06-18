---
phase: 02-generic-pipeline-orchestrator
plan: 06
subsystem: api
tags: [tool-calling, openai, llm-adapter, vitest, gap-closure]

# Dependency graph
requires:
  - phase: 02-generic-pipeline-orchestrator (plans 01-05)
    provides: GenericPipelineProvider orchestrator, OpenAILLMAdapter, bounded multi-round tool-calling loop (D-04/D-05), GAP-02-05 pipelineToolList/registerFunction fix, CR-01/CR-02 abort guards
provides:
  - "CR-03 fix: GenericPipelineProvider pushes an [assistant_tool_calls] <json> marker into history before executing tools each round, recording the LLM's own assistant/tool_calls turn"
  - "OpenAILLMAdapter third mapMessage() branch re-emitting the marker as OpenAI's { role: 'assistant', content: null, tool_calls: [...] } wire shape"
  - "Regression test proving round-2 complete() call carries the assistant predecessor immediately before the matching tool-result"
  - "Adapter unit test proving the marker renders to a backend-valid request body wire shape"
affects: [phase-05-demo, generic-stt-tts-package]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vendor-neutral history marker convention extended: [assistant_tool_calls] <json> rides on a role:assistant ChatMessage { role; content }, mirroring the existing [tool_result id=<id> name=<name>] convention — no new field added to the core ChatMessage/InputMessage type (CORE-06)"

key-files:
  created: []
  modified:
    - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
    - packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts
    - packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts
    - packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts

key-decisions:
  - "Followed the EXACT precedent of the existing [tool_result ...] marker rather than adding a vendor-specific field to ChatMessage — keeps CORE-06's vendor-neutral core-type rule intact"
  - "Assistant marker push placed inside the abort-guarded region (after the line-505 signal?.aborted check, before the per-call tool execution loop) so an aborted turn never mutates this.messages"

patterns-established:
  - "Third mapMessage() branch ADDED beside TOOL_RESULT_PATTERN without reordering or altering the existing two branches — disjoint marker prefixes ([assistant_tool_calls] vs [tool_result ) keep branch order irrelevant for correctness"

requirements-completed: [ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05]

# Metrics
duration: 25min
completed: 2026-06-18
---

# Phase 02 Plan 06: CR-03 Gap Closure Summary

**Fixed HTTP-400-on-round-2 in multi-round tool-calling by recording the LLM's own assistant/tool_calls turn into history before executing tools, closing the single actionable gap (CR-03) from 02-VERIFICATION.md.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-06-18T15:30:00Z
- **Completed:** 2026-06-18T15:56:00Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- `GenericPipelineProvider.runTurnFromText`'s bounded tool-calling loop now pushes a `{ role: "assistant", content: "[assistant_tool_calls] <json>" }` marker into `this.messages` immediately after a round's tool calls are received and BEFORE the tools are executed / `[tool_result ...]` markers are pushed — closing the gap where round 2+ of any real multi-round tool-calling conversation was missing the assistant predecessor every OpenAI-compatible backend requires before a `role:"tool"` message.
- `OpenAILLMAdapter.mapMessage()` gained a third branch (`ASSISTANT_TOOL_CALLS_PATTERN`) that recognizes the new marker and re-emits OpenAI's actual wire shape `{ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments } }] }`, re-`JSON.stringify`-ing each tool call's `args` into the `arguments` JSON-string field OpenAI requires.
- Two new regression tests lock the fix closed: an orchestrator-level test that captures `args.messages` per `complete()` call (unlike the prior D-04/D-05 fake LLM, which ignored `args.messages` entirely — the exact blind spot that let CR-03 ship) and asserts the round-2 message array carries the assistant marker immediately before the matching tool-result; and an adapter-level test asserting the marker renders to a backend-valid request body.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix CR-03 — push the assistant/tool_calls marker into history before tool execution, and map it to OpenAI wire shape in the adapter** - `e882233` (fix)
2. **Task 2: Regression tests — round-2 message history carries the assistant/tool_calls predecessor (orchestrator) and renders to the OpenAI wire shape (adapter)** - `ef8a2ab` (test)

**Plan metadata:** (this commit, made by the orchestrator after merge)

## Files Created/Modified

- `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` - Inserts the `[assistant_tool_calls] <json>` marker push between the `MAX_TOOL_ROUNDS` guard and the per-call tool execution loop, tagged `(CR-03)`
- `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts` - Adds `ASSISTANT_TOOL_CALLS_PATTERN` regex, widens `OutgoingMessage` union with the assistant/tool_calls wire shape, adds the third `mapMessage()` branch, extends the file-header doc comment
- `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` - Adds `describe("CR-03: ...")` regression test inspecting round-2 `args.messages`
- `packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts` - Adds adapter unit test asserting the marker maps to the OpenAI wire shape with `arguments` as a JSON string

## Decisions Made

- Extended the existing tool-result marker precedent (content-string convention on a vendor-neutral `{ role; content }` message) instead of adding a new field to `ChatMessage`/`InputMessage` — preserves CORE-06's "no vendor-specific shape on core types" rule.
- Placed the new push inside the already-abort-guarded region of the loop (after the line-505 `signal?.aborted` check) so a superseded/aborted turn never mutates `this.messages` — consistent with the existing CR-01/CR-02 abort-guard pattern in this file.

## Deviations from Plan

None - plan executed exactly as written. The only operational addition was running `pnpm install` and building `@khaveeai/core` + `@khaveeai/providers-openai-stt-tts` inside the worktree (which had no `node_modules`/`dist` from a fresh worktree checkout) so that `tsc`/`vitest` could resolve workspace package types — this is build-environment setup, not a deviation from the plan's code changes, and no new dependency was added (lockfile-respecting `--frozen-lockfile` install only).

## Issues Encountered

- The worktree had no `node_modules` and no `dist/` output for `@khaveeai/core`/`@khaveeai/providers-openai-stt-tts`, causing the first build/test attempt to fail with `Cannot find module '@khaveeai/providers-openai-stt-tts'`. Resolved by running `pnpm install --frozen-lockfile` (workspace dependencies only, no new package) and building the two upstream workspace packages before re-running the `generic-stt-tts` build/test commands. An incidental side effect — `pnpm install` touched 7 pre-existing tracked symlinks under `packages/providers/qdrant/node_modules/.bin/` — was reverted via targeted `git checkout --` on those specific files (out of scope for this task, left as found).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-03 closed: ORCH-01's multi-round tool-calling contract is now correct against a real OpenAI-compatible vendor backend — round 2+ requests carry the required assistant→tool message ordering.
- Phase 5's planned demo (which requires at least one round-2 `complete()` call for any tool call) is no longer blocked by this defect.
- `pnpm --filter @khaveeai/providers-generic-stt-tts test --run`: 33/33 passing (31 prior + 2 new). `pnpm --filter @khaveeai/providers-openai-stt-tts test --run`: 13/13 passing (compatibility constraint upheld — existing provider untouched).
- WR-01..WR-04 and IN-03 (carried-forward Info findings from 02-VERIFICATION.md) remain untouched, as scoped — out of this gap's scope, no action needed.
- 02-VERIFICATION.md's `deferred:` block is now empty of actionable gaps; phase 02 can proceed to a final verification pass.

## Self-Check: PASSED

- FOUND: packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts (contains `assistant_tool_calls`, count 1)
- FOUND: packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts (contains `ASSISTANT_TOOL_CALLS_PATTERN`, count 2)
- FOUND: packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts (contains `CR-03`, count 2)
- FOUND: packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts (contains `assistant_tool_calls`, count 2)
- FOUND: commit e882233 (fix task) in `git log --oneline`
- FOUND: commit ef8a2ab (test task) in `git log --oneline`

---

*Phase: 02-generic-pipeline-orchestrator*
*Completed: 2026-06-18*
