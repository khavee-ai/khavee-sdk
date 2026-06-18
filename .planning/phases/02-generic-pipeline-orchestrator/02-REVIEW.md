---
phase: 02-generic-pipeline-orchestrator
reviewed: 2026-06-18T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - packages/core/src/types/pipeline.ts
  - packages/providers/generic-stt-tts/package.json
  - packages/providers/generic-stt-tts/postcss.config.mjs
  - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
  - packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts
  - packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts
  - packages/providers/generic-stt-tts/src/__tests__/OpenAISTTAdapter.test.ts
  - packages/providers/generic-stt-tts/src/__tests__/OpenAITTSAdapter.test.ts
  - packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts
  - packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts
  - packages/providers/generic-stt-tts/src/adapters/OpenAITTSAdapter.ts
  - packages/providers/generic-stt-tts/src/adapters/OpenAIVADAdapter.ts
  - packages/providers/generic-stt-tts/src/index.ts
  - packages/providers/generic-stt-tts/tsconfig.json
  - packages/providers/generic-stt-tts/vitest.config.ts
  - packages/providers/openai-stt-tts/src/index.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

This is a fresh full-scope re-review after gap-closure plan 02-05 (GAP-02-05: `registerFunction()` not offering post-construction tools to the LLM). The two earlier BLOCKERs (CR-01/CR-02, fixed in 02-04) remain confirmed resolved, and **GAP-02-05's fix is correct and complete**: `registerFunction()` now updates both the dispatch half (`ToolExecutor.register`, unchanged) and the visibility half (`pipelineToolList`, new), the `RealtimeTool`→`Tool` conversion (`realtimeToolToTool`) correctly strips the per-property `required` boolean and emits a top-level `required: string[]`, the filter-then-push dedupe is genuinely idempotent-by-name, and `runTurnFromText` reads the combined runtime list instead of the construction-time-only `config.pipelineTools`. All 31 tests pass (`pnpm --filter @khaveeai/providers-generic-stt-tts test --run`) and the package builds clean (`tsc`). The diff matches the 02-05 plan's five surgical edits exactly — no scope creep.

During this fresh full pass I found **one new BLOCKER not previously flagged**: the multi-round tool-calling loop in `GenericPipelineProvider.runTurnFromText` never appends the LLM's own `assistant`-role message (the one carrying `tool_calls`) into the conversation history before pushing the tool-result message for the next round. Against a real OpenAI-compatible Chat Completions backend this is a protocol violation — a `role: "tool"` message must immediately follow an `assistant` message bearing the matching `tool_calls` entry, and a request that violates this ordering is rejected with a 400. This defect is invisible to the current test suite because the fake LLM mocks used by `GenericPipelineProvider.test.ts` never inspect `args.messages`, so a round-2+ tool-calling turn is never actually validated against realistic message-history shape.

The four carried-forward Warnings from the prior review (`WR-01` tool-name-whitespace regex, `WR-02` unconditional `resumeWithCooldown()` on error, `WR-03` missing `isConnected` guard / orphaned `AudioContext`, `WR-04` unused `react` peerDependency) remain unaddressed — confirmed still present at their respective locations, explicitly out of scope for the 02-05 gap-closure plan, carried forward here for visibility. One new Info-level finding was found: the additive `openai-stt-tts/src/index.ts` exports of `STTClient`/`AudioRecorder`/`TTSPlayer` now contradict those files' own "NOT exported from index.ts" header comments.

## Critical Issues

### CR-03 (new): Multi-round tool-calling loop never records the assistant's `tool_calls` message into history, breaking real OpenAI-compatible backends on round 2+

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:493-530`
**Issue:** In the bounded tool-calling loop, each round calls `this.llm.complete({ messages: this.messages, tools: this.pipelineToolList, signal })`, gets back `result.toolCalls`, executes them, and pushes only the tool-result as a `role: "user"` message encoded with the `[tool_result id=... name=...]` marker:
```typescript
this.messages.push({
  role: "user",
  content: `[tool_result id=${call.id} name=${call.name}] ${toolResult.message}`,
});
```
The assistant's own turn — the message that actually contained the `tool_calls` array the LLM emitted — is never pushed into `this.messages` at all. `OpenAILLMAdapter.mapMessage()` only ever maps `InputMessage` (`{role, content}`) entries; it has no path to emit `{ role: "assistant", tool_calls: [...] }` because the orchestrator never gives it one to map.

OpenAI's Chat Completions API (and every OpenAI-compatible backend) requires that a `role: "tool"` message be immediately preceded in the message array by the `assistant` message containing the matching `tool_calls` entry (matched by `tool_call_id`). Sending a `role: "tool"` message with no preceding `assistant`/`tool_calls` message is rejected by the API with a 400 error. Concretely: round 1 returns `toolCalls`, the orchestrator executes them and appends only a `user`-role tool-result message, then round 2's `llm.complete()` call sends `[..., {role:"user", content:"original question"}, {role:"tool", tool_call_id:"...", content:"..."}]` — with the load-bearing `assistant`/`tool_calls` message missing — guaranteeing a backend-side rejection on any second round of any real tool-calling conversation.

This is invisible to `GenericPipelineProvider.test.ts`'s "D-04/D-05: bounded multi-round tool-calling loop" tests because the fake LLM (`complete: vi.fn().mockImplementation(async () => {...})`) ignores `args.messages` entirely — it never asserts on message shape, so the missing assistant-history entry is never caught. It is also invisible to `OpenAILLMAdapter.test.ts` because that suite only exercises single round-trip message mapping, not the orchestrator's cross-round history construction.

**Fix:** Push the assistant's tool-call-bearing turn into history before executing tools, using the same Phase-2-local marker convention (or a richer marker carrying the full `tool_calls` array) so `OpenAILLMAdapter` can re-emit it as `{ role: "assistant", tool_calls: [...] }`:
```typescript
// After receiving `result` with result.toolCalls.length > 0, before executing:
this.messages.push({
  role: "assistant",
  content: `[assistant_tool_calls] ${JSON.stringify(result.toolCalls)}`,
});

for (const call of result.toolCalls) {
  const toolResult = await this.toolExecutor.execute(call.name, call.args);
  // ... existing tool-result push ...
}
```
And in `OpenAILLMAdapter.mapMessage()`, recognize the new marker and re-emit it as OpenAI's actual shape:
```typescript
const ASSISTANT_TOOL_CALLS_PATTERN = /^\[assistant_tool_calls\]\s*([\s\S]*)$/;
// ...
const assistantMatch = ASSISTANT_TOOL_CALLS_PATTERN.exec(message.content);
if (assistantMatch) {
  const toolCalls = JSON.parse(assistantMatch[1]) as ToolCall[];
  return {
    role: "assistant",
    content: null,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
    })),
  };
}
```
Add a regression test that asserts, after a round-2 tool call, the `messages` array captured from the second `llm.complete()` call contains an `assistant`-role entry referencing the round-1 tool call id, immediately followed by the matching `tool`-role entry — the exact ordering real OpenAI-compatible backends require.

## Warnings

### WR-01 (carried forward, unaddressed): Tool-result history marker fails to parse when an LLM-returned tool name contains whitespace

**File:** `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts:29,146-153`
**Issue:** `TOOL_RESULT_PATTERN = /^\[tool_result id=(\S+) name=(\S+)\]\s*([\s\S]*)$/` requires `name` to be `\S+` (no whitespace). `call.name` is sourced directly from the vendor's `tc.function.name` with no validation. If an LLM returns/hallucinates a tool name containing whitespace, the regex fails to match, `mapMessage()` falls through to the default branch, and the tool result is sent back as a plain `user` message instead of `{ role: "tool", tool_call_id, content }` — most Chat-Completions-compatible backends will then reject the next request with an opaque 400. Confirmed still present, unchanged from the prior review and the 02-05 gap-closure pass (explicitly out of that plan's scope).
**Fix:** Encode `id`/`name` (e.g. `encodeURIComponent`) when building the marker in `GenericPipelineProvider.ts`, and decode accordingly in `mapMessage()`.

### WR-02 (carried forward, unaddressed): `runTurnFromText`'s catch block unconditionally calls `resumeWithCooldown()` even when the mic/VAD was never paused

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:552-553,576-580`
**Issue:** The success path pauses VAD only at step 5 (`await this.vad.pause(); this.micEnabled = false;`), right before TTS playback. If an error occurs earlier (e.g. the LLM call, a tool execution failure, or the `MAX_TOOL_ROUNDS` throw — all of which happen before step 5), VAD was never paused, yet the `catch` block unconditionally calls `await this.resumeWithCooldown()` — resuming an already-running VAD and paying the full `micReopenCooldownMs` delay (default 500ms) before the error reaches `onError`/`chatStatus: "ready"`, for an error that had nothing to do with mic state. Confirmed still present.
**Fix:** Track whether the mic was actually paused this turn and only resume/cooldown if so:
```typescript
let micWasPaused = false;
// ...
await this.vad.pause();
this.micEnabled = false;
micWasPaused = true;
// ...
} catch (error) {
  if (signal?.aborted) return;
  if (micWasPaused) await this.resumeWithCooldown();
  this.onError?.(error instanceof Error ? error : new Error(String(error)));
  this.setChatStatus("ready");
}
```

### WR-03 (carried forward, unaddressed): No `isConnected` guard lets `sendMessage()`/turns run before `connect()`, leaking an untracked `AudioContext`

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:399-412,556`
**Issue:** `sendMessage()`, `runTurn()`, and `runTurnFromText()` never check `this.isConnected`. If a consumer calls `sendMessage()` (or a VAD utterance somehow fires) before `connect()` has run, `this.audioOutputContext` is still `null`, and step 5's TTS call falls back to a throwaway context:
```typescript
audioContext: this.audioOutputContext ?? new AudioContext(), // GenericPipelineProvider.ts:556
```
This freshly-created `AudioContext` is never assigned to `this.audioOutputContext`, so: (1) it is never closed by `disconnect()` (a real leaked browser audio resource), and (2) `getAudioAnalyser()`'s pairing check (`this.audioOutputAnalyser && this.audioOutputContext`) will return `null` even though `this.audioOutputAnalyser` does get set from the orphaned context's `onAudioData` callback — `audioOutputContext` stays `null` — so a consumer asking for the analyser while audio is actually playing gets nothing. Confirmed still present; not in the 02-05 gap-closure plan's scope.
**Fix:** Guard turn entry points with an early return/throw when not connected, mirroring the rest of the codebase's "no side effect before connect" conventions:
```typescript
async sendMessage(text: string): Promise<void> {
  if (!this.isConnected) {
    this.onError?.(new Error("sendMessage() called before connect()"));
    return;
  }
  // ...
}
```

### WR-04 (carried forward, unaddressed): `package.json` declares an unused `react` peerDependency

**File:** `packages/providers/generic-stt-tts/package.json:39-41`
**Issue:** `peerDependencies: { "react": "^18.0.0 || ^19.0.0" }` was copied from `openai-stt-tts`'s `package.json`, but this package has no React import anywhere in `src/`. This forces every consumer to satisfy an npm peer-dependency requirement for a framework the package never uses. Confirmed still present.
**Fix:** Remove the `peerDependencies` block, or only add it back if/when a React-specific entry point is added.

## Info

### IN-01 (carried forward): `Tool.parameters`/`RealtimeTool.parameters` incompatibility forced a config field rename (`pipelineTools` vs `tools`) — silent-ignore risk for migrating consumers

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:38-61`
**Issue:** Not a bug — well-documented in the doc comment. `GenericPipelineConfig extends RealtimeConfig`, which still has `tools?: RealtimeTool[]` as a valid, type-checked optional field. A consumer migrating from `OpenAISTTTTSConfig`/`OpenAIRealtimeConfig` (which use `tools`) and setting `config.tools = [...]` on a `GenericPipelineConfig` will have it silently ignored — TypeScript won't catch it since `tools` is legitimately inherited, just never read.
**Fix:** Consider `tools?: never` on `GenericPipelineConfig` to turn this into a compile-time error, or a constructor-time runtime warning when `config.tools` is set but `config.pipelineTools` is not.

### IN-02 (carried forward): `ProxyResponseFlat.data?: undefined` is a discriminant-only field that reads like a real optional field

**File:** `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts:53-61`
**Issue:** `ProxyResponseFlat` declares `data?: undefined;` solely to make `json.data !== undefined ? json.data : json` type-narrow correctly against `ProxyResponseWrapped`. Functionally correct but reads ambiguously to a future maintainer.
**Fix:** Add an inline comment: `/** Always undefined on the flat shape — exists only to discriminate from ProxyResponseWrapped. */`

### IN-03 (new): Newly-exported `STTClient`/`AudioRecorder`/`TTSPlayer` still carry stale "NOT exported from index.ts" header comments

**File:** `packages/providers/openai-stt-tts/src/STTClient.ts:4,21`, `packages/providers/openai-stt-tts/src/AudioRecorder.ts:4,42`, `packages/providers/openai-stt-tts/src/TTSPlayer.ts:2-3`
**Issue:** `openai-stt-tts/src/index.ts` was changed (additively, D-06) to export `AudioRecorder`, `STTClient`, `ChatClient`, and `TTSPlayer` so `@khaveeai/providers-generic-stt-tts`'s adapters can wrap them. Each of those classes' own file-header doc comments still assert the opposite: "This is an internal helper class and is NOT exported from index.ts." This is now factually wrong and will mislead a future maintainer reading the class file in isolation (e.g. believing it is safe to make a breaking change to the class's public surface without a semver-major bump, since "nothing external depends on it").
**Fix:** Update the header comments in `STTClient.ts`, `AudioRecorder.ts`, and `TTSPlayer.ts` to reflect that they are now part of the package's public surface (re-exported for `@khaveeai/providers-generic-stt-tts` adapter use), e.g. replace "NOT exported from index.ts" with "Exported from index.ts for use by `@khaveeai/providers-generic-stt-tts` adapters (D-06) — treat its public methods as part of this package's stable API surface."

---

_Reviewed: 2026-06-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
