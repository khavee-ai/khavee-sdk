---
phase: 02-generic-pipeline-orchestrator
reviewed: 2026-06-18T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
  - packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts
  - packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts
  - packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

This review is scoped to gap-closure plan 02-06, which fixes the previously-reported Critical finding CR-03 (multi-round tool-calling loop never recorded the assistant's own `tool_calls` turn into history, breaking real OpenAI-compatible backends on round 2+). I re-verified the fix directly against the diff (`e882233`), traced the marker round-trip end to end, ran the full test suite (33/33 passing, including the two new CR-03 regression tests), and ran `tsc` (clean build).

**CR-03 is correctly and completely fixed.** `runTurnFromText` now pushes a `{ role: "assistant", content: "[assistant_tool_calls] <json>" }` marker into `this.messages` immediately after a round's `toolCalls.length > 0` check and before executing any tool, in the correct position (preceding the round's `[tool_result ...]` entries). `OpenAILLMAdapter.mapMessage()` gained a third branch (`ASSISTANT_TOOL_CALLS_PATTERN`) that recognizes this marker and re-emits OpenAI's exact `{ role: "assistant", content: null, tool_calls: [...] }` wire shape, restoring the assistant→tool message-ordering invariant OpenAI-compatible backends require. The new regression test (`CR-03: multi-round tool-calling preserves the assistant/tool_calls predecessor in history`) captures a shallow copy of `args.messages` per `complete()` call — correctly avoiding the live-reference pitfall that would have hidden a regression — and asserts the round-2 request carries the assistant marker immediately before its matching tool-result entry. `OpenAILLMAdapter.test.ts` independently verifies the marker-to-wire-shape mapping in isolation. The fix is surgical: no unrelated code was touched, and it matches the prior review's suggested fix almost verbatim.

While re-tracing the fix I found two new issues introduced or made materially worse by this change (both Warning-tier, not Critical — neither breaks the documented happy path the regression tests cover) and one Info-tier note. Both warnings stem from the same root cause: the marker-based protocol convention has no message-role gate and no length-aware history trimming, so the new `[assistant_tool_calls]` marker is exposed to the same two classes of fragility the carried-forward `WR-01` (tool-result marker, unaddressed, out of this plan's scope) already documented for `[tool_result ...]` — except one of them (history trimming splitting a marker pair) is a new failure mode this fix introduces, since before CR-03 there was no assistant-role marker for `trimHistory()`'s blind tail-slice to ever strand.

## Warnings

### WR-05 (new): `trimHistory()`'s blind tail-slice can strand a `[tool_result ...]` message without its preceding `[assistant_tool_calls]` marker, reintroducing CR-03's protocol violation across turns

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:634-642` (interacting with the new marker push at `:524-527`)
**Issue:** `trimHistory(maxTurns = 10)` keeps only the last `maxTurns * 2` (= 20) non-system messages, computed by a flat `nonSystem.slice(-maxNonSystem)` with no awareness of the new `[assistant_tool_calls]`/`[tool_result ...]` marker pairing CR-03 just introduced. A single turn with tool calls can now push well more than 2 messages into history: 1 user message, then for each of up to `MAX_TOOL_ROUNDS` (5) rounds, 1 `[assistant_tool_calls]` marker + N `[tool_result ...]` entries (N = number of tool calls in that round), plus a final assistant reply. Once cumulative history across turns exceeds 20 non-system messages, `trimHistory()`'s tail-slice can cut directly between a previous turn's `[assistant_tool_calls]` marker and its immediately-following `[tool_result ...]` entries (or vice versa, stranding a lone `[tool_result ...]` with no preceding marker at all). `OpenAILLMAdapter.mapMessage()` maps each message independently with no cross-message ordering validation, so a stranded `role: "tool"` message with no preceding `assistant`/`tool_calls` message is sent to the backend exactly as CR-03 originally described — the backend rejects it with HTTP 400. This is the same defect class CR-03 just fixed, now reachable via history trimming instead of a missing push, and is not covered by any test (the existing `D-04/D-05` and `CR-03` tests only exercise tool-calling within a single turn, never across `trimHistory()`'s 20-message boundary).
**Fix:** Make `trimHistory()` marker-pair-aware — when slicing, if the message immediately after the cut point is a `[tool_result ...]`-marked message, extend the slice backward to include its preceding `[assistant_tool_calls]` marker (and vice versa: if the first kept message is itself an `[assistant_tool_calls]` marker with no following tool-result in the kept slice, either keep its tool-results too or drop the orphaned marker). Alternatively, treat a full tool-calling round group (1 assistant marker + its N tool-results) as a single atomic unit when computing `maxTurns`, e.g. by tagging each pushed marker/result with a shared turn-sequence id and trimming by whole turns rather than raw message count.

### WR-06 (new): `ASSISTANT_TOOL_CALLS_PATTERN` matches on `message.content` alone with no `message.role` gate, so a `role:"user"` message starting with the literal marker text is misclassified and crashes the turn via an uncaught `JSON.parse`

**File:** `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts:172-186`
**Issue:** `mapMessage()`'s new branch tests `ASSISTANT_TOOL_CALLS_PATTERN.exec(message.content)` without first checking `message.role === "assistant"`. If a user ever types (or an STT transcript happens to contain) text beginning with `[assistant_tool_calls]` — e.g. `"[assistant_tool_calls] please call the weather tool for me"` as a literal user utterance — the regex matches, `mapMessage()` takes the assistant branch, and attempts `JSON.parse(assistantToolCallsMatch[1])` on `"please call the weather tool for me"`, which throws `SyntaxError: Unexpected token ... is not valid JSON`. This throw happens synchronously inside `messages.map(mapMessage)` in `complete()` (no try/catch around the map), surfaces as a rejected promise from `adapter.complete()`, and propagates up to `runTurnFromText`'s catch block — so it does not crash the process, but it does abort an entirely legitimate user turn with a confusing JSON-syntax `onError`, with no indication to the end user or developer that the cause was an accidental marker-text collision rather than a real backend/network failure. (Same root-cause class as the carried-forward `WR-01` for `TOOL_RESULT_PATTERN`, but newly applicable to this second marker, and demonstrated here to be concretely triggerable by ordinary user input rather than only an LLM-hallucinated tool name.)
**Fix:** Gate both marker checks on `message.role` before testing the regex, e.g.:
```typescript
function mapMessage(message: InputMessage): OutgoingMessage {
  if (message.role === "user") {
    const toolResultMatch = TOOL_RESULT_PATTERN.exec(message.content);
    if (toolResultMatch) {
      const [, id, , content] = toolResultMatch;
      return { role: "tool", tool_call_id: id, content };
    }
  }

  if (message.role === "assistant") {
    const assistantToolCallsMatch = ASSISTANT_TOOL_CALLS_PATTERN.exec(message.content);
    if (assistantToolCallsMatch) {
      try {
        const parsed: Array<{ id: string; name: string; args: Record<string, any> }> = JSON.parse(
          assistantToolCallsMatch[1],
        );
        return {
          role: "assistant",
          content: null,
          tool_calls: parsed.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      } catch {
        // Malformed marker payload — fall through to passthrough rather than crashing the turn.
      }
    }
  }

  return { role: message.role, content: message.content };
}
```
This both narrows the collision surface (a `role:"assistant"` message containing literal marker-like text from a real LLM reply is still technically possible but far less likely than a `role:"user"` message) and prevents an unparseable match from throwing past the function.

## Info

### IN-04 (new): No regression test exercises `trimHistory()` together with the new tool-calling markers

**File:** `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts`
**Issue:** The new `CR-03` test (`:435-482`) only verifies marker ordering within a single turn's two `complete()` calls; it never drives enough turns/rounds to exercise `trimHistory()`'s 20-message tail-slice in combination with the new markers, so `WR-05` above has no test coverage either confirming or denying the failure mode.
**Fix:** Add a test that runs enough multi-tool-call turns (or a single turn with several rounds each containing multiple tool calls) to push `this.messages` past the `maxTurns * 2` trim threshold, then assert that every `[tool_result ...]`-marked message remaining in `this.messages` after `trimHistory()` runs is immediately preceded by an `[assistant_tool_calls]`-marked message (or is otherwise excluded entirely), to lock in whichever fix is chosen for WR-05.

---

_Reviewed: 2026-06-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
