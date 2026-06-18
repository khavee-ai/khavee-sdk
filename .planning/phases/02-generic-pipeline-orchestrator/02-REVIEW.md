---
phase: 02-generic-pipeline-orchestrator
reviewed: 2026-06-19T00:00:00Z
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
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

This review covers the full current state of phase 02 (generic-pipeline-orchestrator) — the vendor-neutral `VADProvider`/`STTProvider`/`LLMProvider`/`TTSProvider` interfaces in `@khaveeai/core` (`packages/core/src/types/pipeline.ts`), the `GenericPipelineProvider` orchestrator, the four OpenAI adapters that compose into it, and the additive re-exports added to `openai-stt-tts/src/index.ts` to support them — not just the WR-05/WR-06 delta from gap-closure plan 02-07.

I re-verified both previously-reported Warnings from the prior review (`WR-05`: `trimHistory()` marker-pair stranding, `WR-06`: `ASSISTANT_TOOL_CALLS_PATTERN` missing a role gate) directly against the current source and confirmed both are now correctly fixed: `trimHistory()` (`GenericPipelineProvider.ts:648-671`) walks the cut boundary backward while the message at `start` is a `[tool_result ...]` entry, and `mapMessage()` (`OpenAILLMAdapter.ts:176-209`) gates both the tool-result and assistant/tool-calls marker branches on `message.role` before running the regex/JSON.parse, with the assistant branch additionally wrapped in try/catch. Ran the full test suite (36/36 passing across 4 test files, including the WR-05/WR-06 regression tests) and a clean `tsc --noEmit` build — no compile errors.

While re-tracing the rest of the orchestrator end to end I found one new logic defect in the turn error-recovery path (the catch block in `runTurnFromText` unconditionally resumes the VAD and pays the mic-reopen cooldown even on errors that occurred before the VAD was ever paused for that turn), plus a handful of lower-severity quality issues. No new Critical-severity findings.

## Warnings

### WR-07: `runTurnFromText`'s catch block unconditionally calls `resumeWithCooldown()`, resuming a VAD that was never paused and imposing an unjustified cooldown delay on pre-TTS failures

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:591-596`
**Issue:** `vad.pause()` is only called once, at step 5 of the happy path (`:567`), immediately before TTS playback. If the turn fails earlier — e.g. `this.llm.complete()` rejects (network error, proxy 5xx, a non-`AbortError` from the tool-calling loop, the `MAX_TOOL_ROUNDS` overflow throw) — execution never reaches `vad.pause()`, yet the `catch` block at `:591-596` still unconditionally calls `await this.resumeWithCooldown()` before reporting the error and setting status back to `"ready"`. `resumeWithCooldown()` (`:605-611`) calls `vad.resume()` (resuming a VAD provider that was never paused for this turn — a no-op for the bundled `AudioRecorder`/`MicVAD` wrapper, but not guaranteed to be a no-op for an arbitrary third-party `VADProvider` implementation, since `VADProvider.resume()`'s contract says only "resume speech detection after a pause()") and then unconditionally `await`s the full `micReopenCooldownMs` (default 500ms, or whatever the consumer configured) timer before the turn's `onError`/`setChatStatus("ready")` fire. The practical effect: every LLM-call failure pays a mandatory cooldown delay it has no reason to pay, and on a custom `VADProvider` that asserts pause/resume call-count invariants (or treats an unpaired `resume()` as a state-machine violation) this could throw or behave incorrectly.
**Fix:** Track whether this turn actually paused the VAD before reaching the catch block, and only resume/cooldown when it did:
```typescript
private async runTurnFromText(text: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  let vadPaused = false;
  try {
    // ...
    await this.vad.pause();
    vadPaused = true;
    this.micEnabled = false;
    // ... tts.speak() ...
    await this.resumeWithCooldown();
    vadPaused = false;
    this.setChatStatus("ready");
  } catch (error) {
    if (signal?.aborted) return;
    if (vadPaused) {
      await this.resumeWithCooldown();
    }
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
    this.setChatStatus("ready");
  }
}
```

### WR-08: `connect()` wires `vad.onUtteranceReady`/`onSpeechStart` and calls `vad.connect()` before `this.micEnabled` is set to `true`, silently dropping an utterance spoken during the connect handshake

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:291-335`
**Issue:** `this.vad.onUtteranceReady` (`:311-317`) only forwards to `runTurn()` when `this.micEnabled` is `true`, but `this.micEnabled` is not set to `true` until line 327 — after `await this.vad.connect()` (`:324`) has already resolved. For the bundled `OpenAIVADAdapter`/`AudioRecorder`, `connect()` resolves only after `MicVAD.start()` has completed, meaning the VAD is actively listening for the entire window between `vad.connect()` starting and `micEnabled = true` executing. Any utterance completed in that window fires `onUtteranceReady` with `this.micEnabled` still `false`, and the blob is silently discarded with no `onError`/log — the user's first utterance (if spoken immediately upon connecting) can be dropped with no feedback. This mirrors a structurally identical ordering in `OpenAISTTTTSProvider.connect()`, so it is not a new defect class introduced by this phase, but the generic orchestrator's `VADProvider.connect()` contract documents "begin listening... and start emitting events" with no guidance to implementers about when callbacks become active relative to the returned promise, so the race is real and currently undocumented here.
**Fix:** Set `this.micEnabled = true` before calling `await this.vad.connect()` (or wire the callbacks last, after the mic-enabled flag is already true), e.g.:
```typescript
this.micEnabled = true;
await this.vad.connect();
this.isConnected = true;
this.setChatStatus("ready");
this.onConnect?.();
```

## Info

### IN-05: `generic-stt-tts/package.json` declares an unused `react` peer dependency

**File:** `packages/providers/generic-stt-tts/package.json:39-41`
**Issue:** The package declares `"peerDependencies": { "react": "^18.0.0 || ^19.0.0" }`, but nothing in `packages/providers/generic-stt-tts/src/**` imports `react` or any `react`-adjacent API — `GenericPipelineProvider` and all four adapters are plain TypeScript classes with no JSX/hooks. This appears to be boilerplate copied from `packages/providers/openai-stt-tts/package.json`, which carries the same peer dependency for reasons specific to that package's consumers. An unused peer dependency forces every consumer of `@khaveeai/providers-generic-stt-tts` to satisfy a constraint the package never actually needs, and (per CLAUDE.md's "Vendor neutrality"/DX framing) adds friction for non-React consumers of this otherwise framework-agnostic orchestrator.
**Fix:** Remove the `peerDependencies` block entirely, or, if it is intentionally future-proofing for an eventual `@khaveeai/react` integration, add a one-line comment explaining why it's present despite no current React usage.

### IN-06: `OpenAILLMAdapter.complete()` always sends `temperature` in the request body, even when the constructor config omitted it

**File:** `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts:92, 98, 108-113`
**Issue:** `this.temperature` is typed `number | undefined` and assigned directly from `config.temperature` with no default. The request body always includes the `temperature` key (`body.temperature = this.temperature`), so when a caller constructs `OpenAILLMAdapter` without a `temperature`, the outgoing JSON body still contains `"temperature":null`-equivalent via `JSON.stringify` (in practice `JSON.stringify` drops keys whose value is `undefined`, so this is benign for the wire payload today) — but the field's presence/absence is implicit and easy to break: if a future refactor changes `this.temperature` to default to `0` instead of leaving it `undefined`, every request silently starts pinning `temperature: 0` instead of letting the backend's own default apply, with no test asserting the omit-when-absent behavior the way the sibling `tools` field is explicitly tested (`OpenAILLMAdapter.test.ts:42-54`).
**Fix:** Add a test mirroring the existing "does NOT include a tools field... when no tools are supplied" case for `temperature`, and/or make the omission explicit in the body-building code:
```typescript
const body: Record<string, unknown> = {
  messages: messages.map(mapMessage),
  model: this.model,
  ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
  ...(tools && tools.length > 0 ? { tools: tools.map(mapTool) } : {}),
};
```

### IN-07: `realtimeToolToTool()` always includes the `enum` key on a property descriptor even when `descriptor.enum` is `undefined`

**File:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts:197-222`
**Issue:** `properties[key] = { type: descriptor.type, description: descriptor.description, enum: descriptor.enum }` unconditionally sets `enum`, `description`, etc. to whatever the source `RealtimeTool.parameters[key]` had — including `undefined` when the legacy `RealtimeTool` descriptor never declared an `enum`/`description`. This produces a converted `Tool["parameters"]["properties"][key]` object where `Object.keys(...)` includes `"enum"`/`"description"` with value `undefined`, which differs structurally (though not semantically, for most consumers) from a `Tool` built directly with those keys omitted — `mapTool()` in `OpenAILLMAdapter.ts` then serializes this into the OpenAI wire payload via `JSON.stringify`, where `undefined` values are dropped, so the wire-level behavior is currently correct. The risk is purely for any future adapter that inspects `Object.keys()`/`hasOwnProperty` on a converted property descriptor (e.g. a non-OpenAI vendor adapter using `"enum" in properties[key]` as a presence check) — it would see a false positive.
**Fix:** Only include `enum`/`description` when actually present on the source descriptor:
```typescript
properties[key] = {
  type: descriptor.type,
  ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
  ...(descriptor.enum !== undefined ? { enum: descriptor.enum } : {}),
};
```

---

_Reviewed: 2026-06-19T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
