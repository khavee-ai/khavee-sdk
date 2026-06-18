---
phase: 02-generic-pipeline-orchestrator
reviewed: 2026-06-18T09:54:23Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - packages/core/src/types/pipeline.ts
  - packages/core/src/types/tools.ts
  - packages/core/src/types/index.ts
  - packages/core/src/types/mock.ts
  - packages/core/src/__tests__/ToolExecutor.test.ts
  - packages/core/package.json
  - packages/core/tsconfig.json
  - packages/core/vitest.config.ts
  - packages/providers/generic-stt-tts/package.json
  - packages/providers/generic-stt-tts/postcss.config.mjs
  - packages/providers/generic-stt-tts/tsconfig.json
  - packages/providers/generic-stt-tts/vitest.config.ts
  - packages/providers/generic-stt-tts/src/index.ts
  - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
  - packages/providers/generic-stt-tts/src/adapters/OpenAIVADAdapter.ts
  - packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts
  - packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts
  - packages/providers/generic-stt-tts/src/adapters/OpenAITTSAdapter.ts
  - packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts
  - packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts
  - packages/providers/generic-stt-tts/src/__tests__/OpenAISTTAdapter.test.ts
  - packages/providers/generic-stt-tts/src/__tests__/OpenAITTSAdapter.test.ts
  - packages/providers/mock/src/index.ts
  - packages/providers/mock/package.json
  - packages/providers/openai/src/index.ts
  - packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts
  - packages/providers/openai-realtime/src/index.ts
  - packages/providers/openai-realtime/package.json
  - packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts
  - packages/providers/openai-stt-tts/src/index.ts
  - packages/providers/openai-stt-tts/package.json
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-18T09:54:23Z
**Depth:** standard
**Files Reviewed:** 19 (plus 11 supporting/cross-cutting files inspected for compatibility)
**Status:** issues_found

## Summary

Reviewed the Phase 2 "generic pipeline orchestrator" deliverable: the four vendor-neutral pipeline-stage interfaces in `@khaveeai/core` (`VADProvider`/`STTProvider`/`LLMProvider`/`TTSProvider`), the promoted/de-duplicated `ToolExecutor`, the new `@khaveeai/providers-generic-stt-tts` package (`GenericPipelineProvider` orchestrator + four OpenAI adapters), and the cross-package edits required to support them (legacy `LLMProvider`/`TTSProvider` renamed to `LegacyLLMProvider`/`LegacyTTSProvider`, `ToolExecutor` de-duplication in `openai-realtime`/`openai-stt-tts`).

All 26 new/updated tests pass, and `tsc` builds cleanly across `@khaveeai/core`, `@khaveeai/providers-generic-stt-tts`, `@khaveeai/providers-openai-stt-tts`, `@khaveeai/providers-openai-realtime`, `@khaveeai/providers-mock`, and `@khaveeai/providers-openai`. The "must not break `openai-stt-tts`" compatibility constraint is honored — its own test suite (13 tests) still passes unchanged.

However, the orchestrator's barge-in/turn-coordination logic has two genuine correctness gaps not covered by the existing test suite: (1) a superseded (aborted) turn can still write its user utterance into shared conversation/message history before `runTurnFromText`'s first abort check fires, and (2) `sendMessage()` never creates or registers its own `AbortController`, so it can race with a concurrently-running VAD-driven turn instead of superseding it — defeating the single-active-turn invariant the rest of the orchestrator is built around. There is also a latent parsing bug in the tool-result-to-history convention when an LLM-returned tool name contains whitespace.

## Critical Issues

### CR-01: `runTurnFromText` mutates shared conversation/message state before checking the abort signal, letting a superseded turn corrupt history

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:391-404`
**Issue:** `runTurnFromText(text, signal)` is documented as guarding "every await boundary that precedes a side effect... by `signal?.aborted`" (see the doc comment at lines 380-390), but its very first action — pushing the user message onto `this.messages`, pushing a `Conversation` entry onto `this.conversation`, and firing `onConversationUpdate` — happens with **zero preceding abort check**, and the caller (`runTurn`, line 368) also does not check `controller.signal.aborted` before calling `runTurnFromText`.

Concretely: Turn A's `stt.transcribe()` is in flight when Turn B (a new VAD utterance) arrives. `runTurn` for Turn B calls `this.activeTurnController.abort()` (aborting Turn A's controller) and proceeds with its own controller. When Turn A's `stt.transcribe()` resolves afterward, Turn A's `runTurn` still calls `await this.runTurnFromText(sttResult.text, controllerA.signal)` — even though `controllerA.signal.aborted === true` at that point — and `runTurnFromText` unconditionally appends Turn A's (stale, superseded) utterance into the shared `this.messages`/`this.conversation` arrays before any abort check runs. This corrupts the LLM-visible history with an out-of-order/duplicate user turn and emits an `onConversationUpdate` for an utterance that was supposed to be discarded.

**Fix:** Check the signal immediately on entry to `runTurnFromText`, before any side effect:
```typescript
private async runTurnFromText(text: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return; // superseded before this turn even started — discard
  try {
    // 1. Append user message to history and conversation
    this.messages.push({ role: "user", content: text });
    ...
```
Also add the same guard immediately after `await this.stt.transcribe(...)` resolves in `runTurn`, before calling `runTurnFromText` (it already has the abort check for the empty-text branch at line 363, but not for the non-empty path at line 368).

### CR-02: `sendMessage()` does not create/register an `AbortController`, allowing it to race with a concurrent VAD-driven turn instead of superseding it

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:333-335`
**Issue:** Every other turn entry point (`runTurn`, driven by VAD) creates a fresh `AbortController`, aborts any prior `activeTurnController`, and registers itself as the new `activeTurnController` — that is the entire mechanism the barge-in design (D-03) relies on to guarantee only one turn mutates shared state at a time. `sendMessage()` instead does:
```typescript
async sendMessage(text: string): Promise<void> {
  await this.runTurnFromText(text, this.activeTurnController?.signal);
}
```
This has two failure modes:
1. **No turn currently active** (`activeTurnController === null`): `sendMessage()` passes `signal = undefined` and never sets `activeTurnController`. If a VAD utterance arrives while this `sendMessage()` call is still in flight, `runTurn` sees `activeTurnController === null`, does NOT abort anything, and starts a second, fully independent turn — both turns now concurrently push to `this.messages`/`this.conversation`, call `setChatStatus`, and race on `this.audioOutputContext`/mic state with no coordination at all.
2. **A turn IS currently active**: `sendMessage()` borrows that turn's signal and races on the same `AbortController` without owning it — if the in-flight VAD turn later gets superseded by yet another VAD utterance (aborting that shared controller), the `sendMessage()` call is silently cancelled too, even though nothing barged in on it directly.

Neither path is covered by the existing test suite — every `sendMessage()` test in `GenericPipelineProvider.test.ts` calls it in isolation against an idle provider.

**Fix:** Give `sendMessage()` the same turn-ownership semantics as `runTurn()`:
```typescript
async sendMessage(text: string): Promise<void> {
  if (this.activeTurnController) {
    this.activeTurnController.abort();
  }
  const controller = new AbortController();
  this.activeTurnController = controller;
  try {
    await this.runTurnFromText(text, controller.signal);
  } finally {
    if (this.activeTurnController === controller) {
      this.activeTurnController = null;
    }
  }
}
```

## Warnings

### WR-01: Tool-result history marker fails to parse when an LLM-returned tool name contains whitespace, silently breaking the tool round-trip protocol

**File:** `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts:29,146-153`
**Issue:** `TOOL_RESULT_PATTERN = /^\[tool_result id=(\S+) name=(\S+)\]\s*([\s\S]*)$/` requires both `id` and `name` to be non-whitespace (`\S+`). `call.name` (used to build the marker in `GenericPipelineProvider.runTurnFromText`, line 438: `` `[tool_result id=${call.id} name=${call.name}] ${toolResult.message}` ``) is sourced directly from the vendor's tool-call response (`tc.function.name` in `OpenAILLMAdapter.complete`) without validation against the registered tool list. If an LLM hallucinates or returns a tool name containing a space (or any whitespace), the regex fails to match entirely, `mapMessage()` falls through to the default `{ role: message.role, content: message.content }` branch, and the tool result is sent back to OpenAI as a plain `user` message instead of `{ role: "tool", tool_call_id, content }`. Most Chat Completions-compatible backends will then reject the next request (a `tool_calls` response with no matching `role: "tool"` follow-up is invalid), surfacing as an opaque "Chat proxy error: 400 ..." with no indication of the real cause.

Additionally, the regex's greedy `name=(\S+)\]` can over-match into the result content when the content does not start with whitespace and itself contains a `]` character (verified: `"[tool_result id=call_1 name=foo]bar]baz"` parses `name` as `"foo]bar"`, swallowing part of the content) — currently low-impact since `name` is discarded after capture, but indicates the pattern is not as robust as the surrounding doc comments imply.

**Fix:** Either reject/sanitize tool names containing whitespace before building the marker, or switch to a delimiter that cannot collide with tool-name characters (e.g. base64/URI-encode `id`/`name`, or use a structural prefix that doesn't rely on `\S` boundaries):
```typescript
// In GenericPipelineProvider, when building the marker:
const safeName = encodeURIComponent(call.name);
this.messages.push({
  role: "user",
  content: `[tool_result id=${call.id} name=${safeName}] ${toolResult.message}`,
});
// In OpenAILLMAdapter, decode accordingly when parsing.
```

### WR-02: `connect()` leaks the previous `AudioContext` if called twice without an intervening `disconnect()`

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:237`
**Issue:** `connect()` unconditionally does `this.audioOutputContext = new AudioContext();` without checking whether `this.audioOutputContext` already holds an open context from a prior `connect()` call. Calling `connect()` twice in a row (e.g. a consumer double-clicking a "start" button before `isConnected` flips, or a buggy reconnect path) overwrites the reference to the first `AudioContext` without ever calling `.close()` on it, leaking a real browser audio resource. This same pattern exists in `OpenAISTTTTSProvider` (pre-existing, out of this phase's scope to fix), but it was carried forward unchanged into newly-written code here rather than being hardened.
**Fix:** Guard against re-entrant `connect()` calls, or close any existing context before creating a new one:
```typescript
if (this.audioOutputContext && this.audioOutputContext.state !== "closed") {
  await this.audioOutputContext.close();
}
this.audioOutputContext = new AudioContext();
```

### WR-03: `runTurnFromText`'s catch block unconditionally calls `resumeWithCooldown()` even when the mic/VAD was never paused

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:487-492`
**Issue:** The success path pauses VAD (`await this.vad.pause(); this.micEnabled = false;`) only at step 5, right before TTS playback. If an error occurs earlier (e.g. the LLM call at step 2, or a tool execution failure), the VAD was never paused — yet the `catch` block unconditionally calls `await this.resumeWithCooldown()`, which calls `this.vad.resume()` and sets `micEnabled = true` regardless of whether `pause()` was ever called. This is a no-op in most VAD implementations (resuming an already-running VAD), but it is not guaranteed to be safe for all `VADProvider` implementations, and it always pays the full `micReopenCooldownMs` delay (default 500ms) for errors that have nothing to do with mic state — needlessly delaying the `onError` callback and the `chatStatus` reset to `"ready"`. This mirrors a pre-existing pattern in `OpenAISTTTTSProvider` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:476-482`), so it's not a regression, but it was an opportunity to fix during the port that was missed.
**Fix:** Track whether the mic was actually paused in this turn and only resume/cooldown if so:
```typescript
let micWasPaused = false;
...
await this.vad.pause();
this.micEnabled = false;
micWasPaused = true;
...
} catch (error) {
  if (signal?.aborted) return;
  if (micWasPaused) await this.resumeWithCooldown();
  this.onError?.(error instanceof Error ? error : new Error(String(error)));
  this.setChatStatus("ready");
}
```

### WR-04: `package.json` declares an unused `react` peerDependency for a package with zero React usage

**File:** `packages/providers/generic-stt-tts/package.json:39-41`
**Issue:** `peerDependencies: { "react": "^18.0.0 || ^19.0.0" }` was copied verbatim from `openai-stt-tts`'s `package.json` (per the Plan 01 summary's documented "scaffold by copying" pattern), but `@khaveeai/providers-generic-stt-tts` has no React import anywhere in `src/` (confirmed via grep — the only "react" hit in the package is a doc-comment reference to `@khaveeai/react`, not an import). This forces every consumer to satisfy an npm peer-dependency warning/install requirement for a framework this package never uses, and misleads downstream tooling (e.g. `npm ls`, dependency audit tools) about the package's actual runtime requirements.
**Fix:** Remove the unused peer dependency:
```json
// Delete the "peerDependencies" block entirely, or only keep it if/when
// a React-specific entry point is actually added to this package.
```

### WR-05: `OpenAISTTAdapter.supportsRejection = false` is structurally true but the adapter has no mechanism to ever flag `rejected`, silently dropping the capability signal STTProvider promises to consumers

**File:** `packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts:30,42-53`
**Issue:** This is correctly implemented per the interface contract (`supportsRejection: false` and `transcribe()` never sets `rejected`), so it is not a bug per se — but it means `GenericPipelineProvider.runTurn()`'s empty-or-rejected-utterance guard (`if (!sttResult.text || !sttResult.text.trim() || sttResult.rejected)`) can never short-circuit on `rejected` for this adapter, only on empty/whitespace text. Given `STTClient.transcribe()` (the wrapped class) already throws on a missing `transcript` field rather than ever signaling "this was probably silence," any hallucinated-but-non-empty Whisper transcript (a known Whisper failure mode on silence/noise) will always proceed through the full LLM+TTS pipeline. This is a capability gap inherited from `STTClient`, not introduced by the adapter, but it is worth flagging because `STTResult.rejected`'s entire purpose (per its doc comment in `pipeline.ts:96-104`) is to let vendors flag exactly this case, and the first real adapter implementing the interface opts out of it entirely with no fallback heuristic.
**Fix:** Out of scope for this phase (the underlying `STTClient` has no rejection heuristic to surface), but worth tracking as a known gap for a future Whisper-hallucination-detection enhancement to `STTClient`/`OpenAISTTAdapter`.

## Info

### IN-01: `Tool.parameters`/`RealtimeTool.parameters` structural incompatibility forced a config field rename (`pipelineTools` vs `tools`) — confirm this surfaces clearly to integrators

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:38-47`
**Issue:** Not a bug — the doc comment thoroughly explains the `tsc` rejection and the chosen fallback. Flagging only because `GenericPipelineConfig extends RealtimeConfig`, and `RealtimeConfig.tools?: RealtimeTool[]` is inherited but silently unused on this config type. A consumer migrating from `OpenAISTTTTSConfig`/`OpenAIRealtimeConfig` (which both use `tools`) to `GenericPipelineConfig` and setting `config.tools = [...]` (the natural, type-checked-looking thing to do, since `tools` is still a valid property per `RealtimeConfig`) will have their tools silently ignored — TypeScript will not catch this because `tools?: RealtimeTool[]` is a legitimate optional field on the inherited interface, it's just never read by `GenericPipelineProvider`.
**Fix:** Consider having `GenericPipelineConfig` explicitly redeclare/forbid `tools` (e.g. `tools?: never`) to turn the silent-ignore into a compile-time error for anyone using the wrong field name, or add a runtime constructor warning when `config.tools` is set but `config.pipelineTools` is not.

### IN-02: `ProxyResponseFlat.data?: undefined` is a dead/no-op field

**File:** `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts:53-61`
**Issue:** `ProxyResponseFlat` declares `data?: undefined;` purely so the discriminated-union check `json.data !== undefined ? json.data : json` type-narrows correctly against `ProxyResponseWrapped`. This works but is a slightly unusual idiom that could confuse a future maintainer reading the type in isolation (it looks like a real optional field that happens to always be `undefined`, rather than a discriminant). A short inline comment would help.
**Fix:** Add a one-line comment: `/** Always undefined on the flat shape — exists only to discriminate from ProxyResponseWrapped. */`

### IN-03: `STTResult.rejected` and the `runTurn` empty-text guard duplicate logic already present, unmodified, in `OpenAISTTTTSProvider`

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:362-366`
**Issue:** Not a defect — this is an intentional structural port per the plan's stated design ("structural port of OpenAISTTTTSProvider"). Noting only for completeness: the empty/whitespace/rejected-utterance guard is duplicated logic between `OpenAISTTTTSProvider` and `GenericPipelineProvider` with no shared helper, consistent with the broader "monolithic provider classes instead of composed pipeline stages" anti-pattern already documented in `CLAUDE.md`. No action needed for this phase; flagging as a future consolidation candidate.

---

_Reviewed: 2026-06-18T09:54:23Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
