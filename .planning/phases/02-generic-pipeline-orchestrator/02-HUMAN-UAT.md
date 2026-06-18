---
status: diagnosed
phase: 02-generic-pipeline-orchestrator
source: [02-VERIFICATION.md]
started: 2026-06-18T00:00:00Z
updated: 2026-06-19T04:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. registerFunction() silent no-op — scope/priority decision needed

expected: `registerFunction()` (`packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:156-158`) registers a tool with the internal `ToolExecutor` so it *can* be executed, but never appends it to `this.config.pipelineTools` — the array actually sent to the LLM on every `complete()` call (line 435). A tool registered post-construction via this public `RealtimeProvider` API (reachable through `@khaveeai/react`'s `useRealtime` hook) can therefore never be invoked by the LLM — a silent no-op with zero test coverage. Flagged as a new Critical finding in the latest `02-REVIEW.md` re-review pass. Not named in any of Phase 2's plan must_haves, so it does not block this phase's documented goal as literally scoped — but it is a real, user-reachable defect. Decision needed: open a follow-up gap-closure plan now, or defer/backlog it.
result: resolved by gap-closure plan 02-05 (registerFunction() now appends to pipelineToolList; confirmed by 02-05-SUMMARY.md and re-verified unregressed in 02-VERIFICATION.md's latest pass)
status: resolved

### 2. WR-05: trimHistory() can strand a tool-result marker without its assistant predecessor

expected: Decide whether to fix now (make `trimHistory()` marker-pair-aware, or trim by whole tool-calling-round units) or accept/backlog as a known limitation for long-running sessions with heavy tool use. `trimHistory()`'s flat tail-slice (`GenericPipelineProvider.ts:634-642`) has no awareness of the new `[assistant_tool_calls]`/`[tool_result ...]` marker pairing — once accumulated non-system history exceeds the 20-message trim threshold across multiple tool-calling turns in one session, the slice can strand a `[tool_result ...]` message without its preceding marker, reintroducing CR-03's exact HTTP-400 failure mode via a different path. No test currently exercises this path. Flagged as a new Warning-tier finding in the fresh `02-REVIEW.md` pass scoped to plan 02-06's changes, and independently confirmed by the verifier reading `trimHistory()` directly.
result: resolved by gap-closure plan 02-07 (trimHistory() now walks the slice-start boundary backward while nonSystem[start] is a "[tool_result " message, pulling the [assistant_tool_calls] head back into the kept window; confirmed by direct read of GenericPipelineProvider.ts:648-671, by the non-vacuous WR-05 regression test, and independently re-verified by this verifier reverting the fix to the flat slice and confirming the test fails with `expected 0 to be greater than 0` exactly as predicted, then restoring the fix and confirming it passes — 36/36 tests green)
status: resolved

### 3. WR-06: OpenAILLMAdapter mapMessage() crashes on user text starting with the marker prefix

expected: Decide whether to fix now (add a `message.role === "assistant"` gate + try/catch fallback to the new `ASSISTANT_TOOL_CALLS_PATTERN` branch, mirroring the suggested fix in `02-REVIEW.md`) or accept the residual risk, consistent with the already-accepted/carried-forward WR-01 (same defect class on the pre-existing `[tool_result ...]` marker, deferred across 4+ prior verification rounds as Info-tier). The new `ASSISTANT_TOOL_CALLS_PATTERN` branch in `mapMessage()` has no `message.role === "assistant"` gate, so a `role:"user"` message whose content literally starts with `"[assistant_tool_calls]"` (e.g. ordinary user/STT text) is misrouted into `JSON.parse` and throws synchronously, aborting the turn with a confusing JSON-syntax error. The verifier independently reproduced this crash in an isolated Node script outside the test suite: `mapMessage({role:"user", content:"[assistant_tool_calls] please call the weather tool for me"})` throws `SyntaxError: Unexpected token 'p', "please cal"... is not valid JSON` — confirming this is real and currently reachable, not hypothetical.
result: resolved by gap-closure plan 02-07 (mapMessage() now gates the ASSISTANT_TOOL_CALLS_PATTERN branch on message.role === "assistant" with the JSON.parse wrapped in try/catch, and gates the sibling TOOL_RESULT_PATTERN branch on message.role === "user"; confirmed by direct read of OpenAILLMAdapter.ts:176-209, by two non-vacuous WR-06 regression tests (user-role marker passthrough + malformed assistant-role payload passthrough), and independently re-verified by this verifier reverting the role gates and confirming both tests fail with the exact predicted `SyntaxError`, then restoring the fix and confirming both pass — 36/36 tests green)
status: resolved

## Summary

total: 3
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 0
resolved: 3

## Gaps

- id: GAP-02-05
  status: resolved
  description: "registerFunction() registers a tool with the internal ToolExecutor but never appends it to this.config.pipelineTools, so a tool registered post-construction via the public RealtimeProvider API can never be invoked by the LLM."
  source: 02-REVIEW.md (new Critical finding), 02-VERIFICATION.md (human_needed item)
  resolved_by: "02-05-PLAN.md / 02-05-SUMMARY.md"
- id: WR-05
  status: resolved
  description: "trimHistory()'s flat tail-slice can strand a [tool_result ...] message without its preceding [assistant_tool_calls] marker once accumulated non-system history exceeds the 20-message trim threshold across multiple tool-calling turns."
  source: 02-REVIEW.md (Warning, post-02-06 re-review), 02-VERIFICATION.md (human_needed item)
  resolved_by: "02-07-PLAN.md / 02-07-SUMMARY.md"
- id: WR-06
  status: resolved
  description: "OpenAILLMAdapter.mapMessage()'s ASSISTANT_TOOL_CALLS_PATTERN branch has no role===\"assistant\" gate, so user-authored text starting with the literal \"[assistant_tool_calls]\" string crashes via uncaught JSON.parse."
  source: 02-REVIEW.md (Warning, post-02-06 re-review), 02-VERIFICATION.md (human_needed item)
  resolved_by: "02-07-PLAN.md / 02-07-SUMMARY.md"
- id: WR-07
  status: new
  description: "runTurnFromText's catch block unconditionally calls resumeWithCooldown(), resuming a VAD that was never paused and imposing an unjustified cooldown delay on pre-TTS failures (e.g. llm.complete() rejecting before vad.pause() is ever reached)."
  source: 02-REVIEW.md (Warning, fresh full-phase re-review committed b8b91c2)
  next: "Decision needed — fix now via a new gap-closure plan, or accept/backlog. Not previously deferred; newly discovered in this review pass. Does not block phase completion."
- id: WR-08
  status: new
  description: "connect() wires vad.onUtteranceReady/onSpeechStart and calls vad.connect() before this.micEnabled is set to true, silently dropping an utterance spoken during the connect handshake."
  source: 02-REVIEW.md (Warning, fresh full-phase re-review committed b8b91c2)
  next: "Decision needed — fix now via a new gap-closure plan, or accept/backlog. Not previously deferred; newly discovered in this review pass. Does not block phase completion."
