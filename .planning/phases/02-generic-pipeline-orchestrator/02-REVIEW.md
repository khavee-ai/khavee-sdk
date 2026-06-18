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
  info: 2
  total: 7
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

This is a re-review of the full phase-02 file scope after gap-closure plan 02-04, which targeted the two concurrency BLOCKERs (CR-01, CR-02) found in the prior review pass: (1) `runTurnFromText` mutating shared `conversation`/`messages` state before checking an already-aborted signal, and (2) `sendMessage()` racing a concurrent VAD turn instead of owning its own `AbortController`.

**Both CR-01 and CR-02 are confirmed resolved.** `runTurnFromText` now checks `signal?.aborted` immediately on entry (`GenericPipelineProvider.ts:414`) before any state mutation, `runTurn` re-checks the signal after `stt.transcribe()` resolves and before calling into `runTurnFromText` (`GenericPipelineProvider.ts:384`), and `sendMessage()` now creates and owns its own `AbortController` exactly like `runTurn()` does, aborting any prior turn and registering itself as `activeTurnController` (`GenericPipelineProvider.ts:335-348`). The two new regression tests (`CR-01`, `CR-02` describe blocks in `GenericPipelineProvider.test.ts`) exercise exactly these races and pass. Full test suite: 28/28 passing. `tsc --noEmit` is clean.

During this pass I found one new BLOCKER not covered by the prior review: `registerFunction()` — part of the public `RealtimeProvider` interface — registers a tool with the internal `ToolExecutor` (so it can be *executed* if called) but never adds it to `this.config.pipelineTools`, which is the array actually sent to the LLM on every `complete()` call. A tool registered post-construction via `registerFunction()` is therefore never offered to the LLM and can never be invoked in practice — the public API silently no-ops. I also confirmed two Warnings from the prior review (`WR-01` tool-name whitespace parsing, `WR-03` unconditional cooldown on error) remain unaddressed (expected — out of scope for the CR-01/CR-02 gap-closure plan), and found one new Warning around missing `isConnected` guards allowing pre-`connect()` calls to leak an untracked `AudioContext`.

## Critical Issues

### CR-01: `registerFunction()` registers a tool with the executor but never makes it visible to the LLM, silently breaking the public tool-registration API

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:156-158`
**Issue:** `registerFunction(tool: RealtimeTool): void` is part of the `RealtimeProvider` interface contract (`packages/core/src/types/realtime.ts:103`) and is the documented way to register a tool/function after construction (as opposed to passing it in the constructor config). Its implementation is:
```typescript
registerFunction(tool: RealtimeTool): void {
  this.toolExecutor.register(tool.name, tool.execute);
}
```
This only updates `this.toolExecutor`'s internal dispatch map. But the tool list actually sent to the LLM on every turn comes from `this.config.pipelineTools`, read fresh on each `llm.complete()` call:
```typescript
result = await this.llm.complete({
  messages: this.messages,
  tools: this.config.pipelineTools,   // GenericPipelineProvider.ts:435
  signal,
});
```
`registerFunction()` never appends to `this.config.pipelineTools`. The result: a tool registered via `registerFunction()` post-construction is dispatchable by name if the LLM happens to call it, but the LLM is never told the tool exists (it's not in the `tools` array passed to `complete()`), so no compliant LLM vendor will ever emit a `tool_calls` entry for it. The public API silently does nothing useful. This is not covered by any test — `GenericPipelineProvider.test.ts` never calls `registerFunction()`.

This differs from `OpenAISTTTTSProvider`, where tool definitions are pushed once into the Realtime API's session config at connect-time via the same code path used by the constructor (`this.config.tools.forEach((tool) => this.registerFunction(tool))` plus a single upstream `tools` session field), not re-sent fresh from a config array on every completion call — so the equivalent gap doesn't manifest there in the same way.

**Fix:** Make `registerFunction()` also add the tool to the array actually sent to the LLM:
```typescript
private pipelineTools: Tool[] = [];

constructor(config: GenericPipelineConfig) {
  // ...
  this.pipelineTools = [...(config.pipelineTools ?? [])];
  this.pipelineTools.forEach((tool) => this.toolExecutor.register(tool.name, tool.execute));
}

registerFunction(tool: RealtimeTool): void {
  this.toolExecutor.register(tool.name, tool.execute);
  this.pipelineTools.push(tool as unknown as Tool); // or a proper RealtimeTool->Tool mapper
}

// in runTurnFromText:
result = await this.llm.complete({
  messages: this.messages,
  tools: this.pipelineTools,
  signal,
});
```
Note `RealtimeTool` and `Tool` have different `parameters` shapes (per the doc comment at `GenericPipelineConfig:38-47`), so a real fix needs an explicit mapping between the two rather than an `as unknown as Tool` cast — flagging the cast above only as a placeholder for the actual fix shape.

## Warnings

### WR-01 (carried forward, unaddressed): Tool-result history marker fails to parse when an LLM-returned tool name contains whitespace

**File:** `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts:29,146-153`
**Issue:** `TOOL_RESULT_PATTERN = /^\[tool_result id=(\S+) name=(\S+)\]\s*([\s\S]*)$/` requires `name` to be `\S+` (no whitespace). `call.name` is sourced directly from the vendor's `tc.function.name` with no validation. If an LLM returns/hallucinates a tool name containing whitespace, the regex fails to match, `mapMessage()` falls through to the default branch, and the tool result is sent back as a plain `user` message instead of `{ role: "tool", tool_call_id, content }` — most Chat-Completions-compatible backends will then reject the next request with an opaque 400. Confirmed still present, unchanged from the prior review; out of scope for the CR-01/CR-02 gap-closure plan that just ran.
**Fix:** Encode `id`/`name` (e.g. `encodeURIComponent`) when building the marker in `GenericPipelineProvider.ts:461`, and decode accordingly in `mapMessage()`.

### WR-02 (carried forward, unaddressed): `runTurnFromText`'s catch block unconditionally calls `resumeWithCooldown()` even when the mic/VAD was never paused

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:510-515`
**Issue:** The success path pauses VAD only at step 5 (`GenericPipelineProvider.ts:486-487`), right before TTS playback. If an error occurs earlier (e.g. the LLM call, or a tool execution failure before that point), VAD was never paused, yet the `catch` block unconditionally calls `await this.resumeWithCooldown()` — resuming an already-running VAD and paying the full `micReopenCooldownMs` delay (default 500ms) before the error reaches `onError`/`chatStatus: "ready"`, for an error that had nothing to do with mic state. Confirmed still present.
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

### WR-03 (new): No `isConnected` guard lets `sendMessage()`/turns run before `connect()`, leaking an untracked `AudioContext`

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:107,490`
**Issue:** `sendMessage()`, `runTurn()`, and `runTurnFromText()` never check `this.isConnected`. If a consumer calls `sendMessage()` (or a VAD utterance somehow fires) before `connect()` has run, `this.audioOutputContext` is still `null`, and step 5's TTS call falls back to a throwaway context:
```typescript
await this.tts.speak(replyText, {
  audioContext: this.audioOutputContext ?? new AudioContext(), // GenericPipelineProvider.ts:490
  ...
});
```
This freshly-created `AudioContext` is never assigned to `this.audioOutputContext`, so: (1) it is never closed by `disconnect()` (a real leaked browser audio resource), and (2) `getAudioAnalyser()`'s pairing check (`this.audioOutputAnalyser && this.audioOutputContext`) will return `null` even though `this.audioOutputAnalyser` does get set from the orphaned context's `onAudioData` callback — `audioOutputContext` stays `null` — so a consumer asking for the analyser while audio is actually playing gets nothing.
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
**Issue:** `peerDependencies: { "react": "^18.0.0 || ^19.0.0" }` was copied from `openai-stt-tts`'s `package.json`, but this package has no React import anywhere in `src/`. This forces every consumer to satisfy an npm peer-dependency requirement for a framework the package never uses.
**Fix:** Remove the `peerDependencies` block, or only add it back if/when a React-specific entry point is added.

## Info

### IN-01: `Tool.parameters`/`RealtimeTool.parameters` incompatibility forced a config field rename (`pipelineTools` vs `tools`) — silent-ignore risk for migrating consumers

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:38-58`
**Issue:** Not a bug — well-documented in the doc comment. `GenericPipelineConfig extends RealtimeConfig`, which still has `tools?: RealtimeTool[]` as a valid, type-checked optional field. A consumer migrating from `OpenAISTTTTSConfig`/`OpenAIRealtimeConfig` (which use `tools`) and setting `config.tools = [...]` on a `GenericPipelineConfig` will have it silently ignored — TypeScript won't catch it since `tools` is legitimately inherited, just never read.
**Fix:** Consider `tools?: never` on `GenericPipelineConfig` to turn this into a compile-time error, or a constructor-time runtime warning when `config.tools` is set but `config.pipelineTools` is not.

### IN-02: `ProxyResponseFlat.data?: undefined` is a discriminant-only field that reads like a real optional field

**File:** `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts:53-61`
**Issue:** `ProxyResponseFlat` declares `data?: undefined;` solely to make `json.data !== undefined ? json.data : json` type-narrow correctly against `ProxyResponseWrapped`. Functionally correct but reads ambiguously to a future maintainer.
**Fix:** Add an inline comment: `/** Always undefined on the flat shape — exists only to discriminate from ProxyResponseWrapped. */`

---

_Reviewed: 2026-06-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
