---
phase: 02-generic-pipeline-orchestrator
plan: 05
subsystem: api
tags: [tool-calling, generic-stt-tts, registerFunction, gap-closure]

# Dependency graph
requires:
  - phase: 02-generic-pipeline-orchestrator
    provides: GenericPipelineProvider with constructor-time pipelineTools tool-calling (02-04)
provides:
  - registerFunction() now offers post-construction tools to the LLM (visibility half), not just the ToolExecutor (dispatch half)
  - RealtimeTool→Tool conversion adapter (private realtimeToolToTool helper) closing the documented structural-incompatibility gap
  - Idempotent-by-name registerFunction() for the LLM-visibility list, mirroring ToolExecutor.register's overwrite-by-name dispatch semantics
affects: [02-generic-pipeline-orchestrator, future-bedrock-gemini-adapters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runtime-mutable tool list (pipelineToolList) seeded from constructor config, mutated by post-construction registration APIs, read by the LLM call site — keeps visibility and dispatch halves of a tool-calling contract in sync"
    - "Filter-then-push dedupe-by-name on a plain array mirrors Map-based overwrite-by-name semantics when an array (ordered, vendor-schema-shaped) is required instead of a Map"

key-files:
  created: []
  modified:
    - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
    - packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts

key-decisions:
  - "Conversion (RealtimeTool -> Tool), not type unification — the two parameter shapes are structurally incompatible per the pre-existing GenericPipelineConfig doc comment; tsc already rejects unification, confirmed unchanged by this fix"
  - "Idempotent-by-name via filter-then-push on the array, not a Map -- pipelineToolList must stay an ordered Tool[] (the exact shape llm.complete() expects), so the dedupe technique differs from ToolExecutor's Map-based registry while producing equivalent overwrite-by-name behavior"

patterns-established:
  - "When a public registration API has separate dispatch and visibility halves (a registry plus a schema-list offered downstream), both halves must be updated in lockstep and tested independently — the bug here was a partial update (dispatch only) that compiled and ran without errors yet was a complete behavioral no-op"

requirements-completed: [ORCH-01]

# Metrics
duration: 4min
completed: 2026-06-18
---

# Phase 02 Plan 05: GAP-02-05 Closure — registerFunction() LLM Visibility Summary

**registerFunction() now appends a RealtimeTool-to-Tool-converted entry to a runtime-mutable `pipelineToolList` that `runTurnFromText` offers the LLM, closing the silent no-op where post-construction tools were dispatchable but never invokable.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-18T12:11:06Z
- **Completed:** 2026-06-18T12:15:31Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Closed GAP-02-05: a tool registered post-construction via the public `registerFunction()` API (reachable through `@khaveeai/react`'s `useRealtime` hook) is now both OFFERED to the LLM and EXECUTABLE by it
- Added a private `realtimeToolToTool` adapter converting the legacy per-property `required: boolean` map shape into the vendor-neutral top-level `required: string[]` array shape, resolving the documented structural incompatibility without widening/narrowing either type
- Made `registerFunction()` idempotent-by-name for the LLM-visibility list (filter-then-push), mirroring `ToolExecutor.register`'s pre-existing Map-based overwrite-by-name dispatch semantics — a realistic concern since `useRealtime` exposes `registerFunction` as a plain `useCallback` with no internal guard against repeated invocation
- Added 3 regression tests locking the fix: visibility + conversion-shape correctness, dedupe-by-name, and combined constructor-time + post-construction tool offering

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix GAP-02-05 — registerFunction() offers post-construction tools to the LLM via a converted runtime tool list** - `4ea68df` (fix)
2. **Task 2: Regression test — a tool registered via registerFunction() appears in the tools sent to the LLM** - `ad29e42` (test)

_Note: tdd="true" was specified on both tasks; in practice the fix (Task 1) was implemented and verified against the existing 28-test suite first, then the regression test (Task 2) was added and confirmed structurally incapable of passing against the pre-fix commit (HEAD~1) by inspecting that registerFunction's old body had no visibility-half logic at all._

## Files Created/Modified
- `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` — added `pipelineToolList: Tool[]` private field seeded from `config.pipelineTools`; added `realtimeToolToTool()` private conversion adapter; rewrote `registerFunction()` to update both the dispatch half (`toolExecutor.register`, unchanged) and the visibility half (filter-then-push onto `pipelineToolList`); changed `runTurnFromText`'s `llm.complete({ tools })` call to read `this.pipelineToolList` instead of `this.config.pipelineTools`
- `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` — added `describe("GAP-02-05: ...")` with 3 tests: conversion-shape + visibility assertion, idempotent-by-name dedupe assertion, combined constructor-time + post-construction list assertion

## Decisions Made
- Kept the conversion as a dedicated private method (`realtimeToolToTool`) rather than inlining it in `registerFunction`, matching the project's pattern of small, named, single-purpose private helpers (e.g. `setChatStatus`, `trimHistory`, `resolveAuthToken`)
- Used `required.length > 0 ? { required } : {}` spread to omit an empty `required` field entirely rather than emitting `required: []`, avoiding an extra empty array key in the schema sent to vendor LLM APIs (matches the plan's "omit/empty-array if none" acceptance with omission as the cleaner choice)

## Deviations from Plan

None — plan executed exactly as written (all 5 surgical edits applied as specified; no architectural changes; no scope creep into CR-01/CR-02 or the carried-forward Info/Warning findings).

One environment-setup step was required that the plan did not call out: the worktree had no `node_modules` and no built `dist/` output for `@khaveeai/core` and `@khaveeai/providers-openai-stt-tts` (workspace build-order dependency — `generic-stt-tts` imports type declarations from both at build time). Ran `pnpm install --frozen-lockfile` and built those two packages first before `generic-stt-tts`'s own build/test commands worked. This is standard worktree bootstrapping, not a code change, and is not tracked as a Rule 1-4 deviation since it touched no plan-scoped files.

## Issues Encountered
- Initial verification commands were run with a `cd /Users/whitemalt/Documents/khavee-sdk &&` prefix that moved the Bash tool's cwd out of the worktree into the main repo, causing grep checks to read the main-repo copy of the file (pre-edit) instead of the worktree copy. Detected immediately via the cwd-drift mismatch between Read-tool-confirmed edits and grep output, corrected by running all subsequent Bash commands without that `cd` prefix (each Bash call's cwd resets to the worktree root). No incorrect commits resulted — this was caught before any commit was made.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- GAP-02-05 is the last tracked gap from Phase 02's UAT/code-review cycle; the gap-closure plan is complete
- All 31 tests in `@khaveeai/providers-generic-stt-tts` pass (28 prior + 3 new); `@khaveeai/providers-openai-stt-tts` remains untouched at 13/13
- No blockers for milestone completion from this plan

---
*Phase: 02-generic-pipeline-orchestrator*
*Completed: 2026-06-18*

## Self-Check: PASSED

- FOUND: packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
- FOUND: packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts
- FOUND: .planning/phases/02-generic-pipeline-orchestrator/02-05-SUMMARY.md
- FOUND commit: 4ea68df (Task 1)
- FOUND commit: ad29e42 (Task 2)
- FOUND commit: d4a5b07 (docs: summary)
