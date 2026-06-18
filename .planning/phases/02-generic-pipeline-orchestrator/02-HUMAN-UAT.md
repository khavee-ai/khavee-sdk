---
status: diagnosed
phase: 02-generic-pipeline-orchestrator
source: [02-VERIFICATION.md]
started: 2026-06-18T00:00:00Z
updated: 2026-06-18T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. registerFunction() silent no-op — scope/priority decision needed

expected: `registerFunction()` (`packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:156-158`) registers a tool with the internal `ToolExecutor` so it *can* be executed, but never appends it to `this.config.pipelineTools` — the array actually sent to the LLM on every `complete()` call (line 435). A tool registered post-construction via this public `RealtimeProvider` API (reachable through `@khaveeai/react`'s `useRealtime` hook) can therefore never be invoked by the LLM — a silent no-op with zero test coverage. Flagged as a new Critical finding in the latest `02-REVIEW.md` re-review pass. Not named in any of Phase 2's plan must_haves, so it does not block this phase's documented goal as literally scoped — but it is a real, user-reachable defect. Decision needed: open a follow-up gap-closure plan now, or defer/backlog it.
result: issue reported — user elected to fix via gap-closure plan rather than defer
status: failed

## Summary

total: 1
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- id: GAP-02-05
  status: failed
  description: "registerFunction() registers a tool with the internal ToolExecutor but never appends it to this.config.pipelineTools, so a tool registered post-construction via the public RealtimeProvider API can never be invoked by the LLM."
  source: 02-REVIEW.md (new Critical finding), 02-VERIFICATION.md (human_needed item)
  next: "/gsd:plan-phase 02 --gaps"
