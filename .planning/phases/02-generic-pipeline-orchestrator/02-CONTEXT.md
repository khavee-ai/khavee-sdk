# Phase 2: Generic Pipeline Orchestrator - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

A new `GenericPipelineProvider` class (new package: `packages/providers/generic-stt-tts`) that implements `RealtimeProvider` by composing Phase 1's `{VADProvider, STTProvider, LLMProvider, TTSProvider}` interfaces plus plain-object `Tool`s, passed in via a single constructor config — pipecat-style. It must run unmodified through `@khaveeai/react`'s existing `useRealtime` hook (no React-layer changes). Verification uses adapter classes that wrap the existing OpenAI helper classes (`STTClient`, `ChatClient`, `TTSPlayer`) so they conform to the new interfaces — these adapters ship as real code in the new package, not throwaway test fixtures. No real non-OpenAI vendor adapters (Thonburian, JaiTTS) and no Bedrock/Gemini adapters this phase — those are Phase 3/4 and out-of-scope respectively. `openai-stt-tts` itself stays untouched.

</domain>

<decisions>
## Implementation Decisions

### Barge-in / cancellation (ORCH-03)
- **D-01:** `LLMProvider.complete()` and `TTSProvider.speak()` (`packages/core/src/types/pipeline.ts`) get an optional `signal?: AbortSignal` parameter added. This is a deliberate extension of the already-"Validated" Phase 1 interfaces — accepted because real cancellation (e.g. aborting an in-flight `fetch`) is otherwise impossible to express. The param is optional and best-effort (D-02), so this is additive and does not break Phase 1's existing contract or any current implementation.
- **D-02:** `signal` is **optional, best-effort** — not required on every implementation. Providers that read it (the new OpenAI stand-in adapters built this phase) get real cancellation; providers that ignore it keep running in the background, but the orchestrator discards their result once a newer turn has superseded them. No existing or future provider is broken by the new param.
- **D-03:** Barge-in is **full interruption, not cancel-and-idle**: when new speech arrives mid-turn, the orchestrator aborts the in-flight LLM/TTS work (via the `signal`) AND immediately starts a new turn using the utterance that triggered the barge-in — it is not dropped. This differs from today's `OpenAISTTTTSProvider` behavior, which silently drops new VAD utterances while `_isTurnActive` is true (`OpenAISTTTTSProvider.ts:356`).

### Tool-calling loop
- **D-04:** The orchestrator runs a **multi-round tool-calling loop**: call LLM → if `toolCalls.length > 0`, execute each via the core `ToolExecutor` (`@khaveeai/core`), append results to the message history, call the LLM again → repeat until a completion returns zero tool calls (final text) or the iteration cap is hit.
- **D-05:** Max-iterations cap is **5 rounds**. If hit without a final non-tool-call response, the orchestrator treats it as an error path (normalized via D-08) rather than looping forever — prevents runaway agentic loops / cost blowups.

### Adapter package & verification (ORCH-02, success criterion 2)
- **D-06:** Adapter classes wrapping the existing OpenAI helpers (`STTClient`, `ChatClient`, `TTSPlayer` from `openai-stt-tts`) to conform to `STTProvider`/`LLMProvider`/`TTSProvider` live in the **new `packages/providers/generic-stt-tts` package** as real, shippable code — not test-only fixtures. This matches PROJECT.md's plan for this package and means Phase 3/4's Thonburian/JaiTTS adapters land as siblings in the same package, and the OpenAI-backed ones double as a real usable provider rather than throwaway scaffolding. `openai-stt-tts` itself is not modified — these adapters wrap its exported pieces from the new package, one-directionally.

### Naming
- **D-07:** The orchestrator class is named `GenericPipelineProvider` (not `PipelineOrchestrator`) — matches the existing `<Vendor><Stage>Provider` naming convention (`OpenAISTTTTSProvider`, `OpenAIRealtimeProvider`) while signaling it's the generic, composable one.

### Cooldown config (ORCH-04)
- **D-08:** The VAD-to-mic-reopen cooldown becomes a config field named `micReopenCooldownMs`, default `500` — matches the existing camelCase + `Ms`-suffix convention (`silenceThresholdMs`) and preserves today's proven 500ms default (`OpenAISTTTTSProvider.ts:474,479`) so behavior doesn't change unless a future vendor adapter explicitly overrides it.

### Claude's Discretion
- Exact shape/naming of the orchestrator's constructor config object (e.g. `GenericPipelineConfig extends RealtimeConfig`) beyond requiring `{vad, stt, llm, tts, tools?}` plus `micReopenCooldownMs` — follow the existing `OpenAISTTTTSConfig extends RealtimeConfig` pattern.
- Error normalization mechanics for ORCH-05 — follow the established `error instanceof Error ? error : new Error(String(error))` pattern already used throughout the codebase (CLAUDE.md Error Handling conventions); no new pattern needed.
- Whether/how the tool-calling loop's per-round message history accumulation reuses `OpenAISTTTTSProvider`'s `trimHistory()` pattern — planner's call based on what's cleanest for the new class.
- Internal wiring details for VAD events (`onSpeechStart`/`onUtteranceReady`/`onError`) — `AudioRecorder`'s existing event shape (already matching `VADProvider`) is the direct analog; no open question here.
- Whether the 5-iteration-cap error is surfaced as a distinct `Error` message (e.g. "tool loop exceeded N rounds") vs. a generic one — planner's call, just must go through the same `onError` normalization as everything else.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level scope and decisions
- `.planning/PROJECT.md` — Core value, requirements (validated/active/out-of-scope), milestone-wide decisions (new package instead of refactor, no-Zod tool-calling, streaming-chunked HTTP)
- `.planning/REQUIREMENTS.md` — Full ORCH-01..05 requirement text
- `.planning/ROADMAP.md` — Phase 2 goal and the five numbered success criteria this phase must satisfy
- `.planning/STATE.md` — Accumulated decisions; note the Phase 5 blocker that the 500ms cooldown default "cannot be validated against JaiTTS until that service exists" — D-08's default must stay easily overridable for that future retest

### Phase 1 deliverables (the contract this phase builds against)
- `packages/core/src/types/pipeline.ts` — `VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`, `ToolCall`, `LLMCompletionResult`, `STTResult` — the exact interfaces to compose; D-01 modifies `LLMProvider.complete()` and `TTSProvider.speak()` signatures here
- `packages/core/src/types/tools.ts` — `Tool`, `ToolResult`, `ExecutableTool`, and the promoted `ToolExecutor` class — use this executor directly for the tool-calling loop (D-04), do not reimplement
- `packages/core/src/types/realtime.ts` — `RealtimeProvider`, `RealtimeConfig`, `RealtimeEvents`, `RealtimeTool` — the interface `GenericPipelineProvider` must implement; `RealtimeTool` stays untouched (compatibility constraint)
- `.planning/phases/01-core-interfaces-tool-calling/01-CONTEXT.md` — Phase 1's decisions (D-01 through D-06) on tool field naming, `ToolCall.id` vendor-neutral correlation, `STTResult.rejected`, etc. — informs how the orchestrator consumes these types correctly

### Codebase patterns to generalize/respect
- `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` — the direct analog to generalize: turn lifecycle (`connect`/`disconnect`/`runTurn`/`runTurnFromText`), the hardcoded 500ms cooldown at lines 474 and 479 (D-08's target), the `_isTurnActive` guard that currently *drops* concurrent utterances instead of cancelling (D-03 changes this behavior), error normalization pattern (`error instanceof Error ? error : new Error(String(error))`), `setChatStatus`/`trimHistory` helper patterns
- `packages/providers/openai-stt-tts/src/{AudioRecorder,STTClient,ChatClient,TTSPlayer}.ts` — the concrete OpenAI helper classes that D-06's adapters wrap; do not modify these files (compatibility constraint — `openai-stt-tts` stays as-is)
- `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` (`interrupt()`, `handleToolCall()`) — existing barge-in (`interrupt()`) and single-tool-call-round patterns to reference, though D-03/D-04 go further (full barge-in restart, multi-round loop) than this file currently does
- `.planning/codebase/CONCERNS.md` — broader tech-debt context (duplicated `ToolExecutor` already resolved in Phase 1; not newly relevant here beyond background)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ToolExecutor` (`@khaveeai/core`, from `packages/core/src/types/tools.ts`) — use directly for the tool-calling loop dispatch; already handles not-found/throw normalization to `{success, message}`
- `AudioRecorder` (`packages/providers/openai-stt-tts/src/AudioRecorder.ts`) — its `onSpeechStart`/`onUtteranceReady`/`onError` event shape already matches `VADProvider`'s callback shape closely; a thin adapter (or near-direct reuse) wires it in
- `STTClient`, `ChatClient`, `TTSPlayer` — the three classes D-06's adapters wrap to produce `STTProvider`/`LLMProvider`/`TTSProvider` stand-ins

### Established Patterns
- `error instanceof Error ? error : new Error(String(error))` normalization before any `onError?.()` call — apply this for ORCH-05
- `setChatStatus()` — only fires `onChatStatusChange` when the value actually changes; reuse this pattern
- AudioContext lifecycle guard (`state !== "closed"` before `close()`) — relevant if the orchestrator manages its own AudioContext for TTS playback like `OpenAISTTTTSProvider` does

### Integration Points
- `packages/react`'s `useRealtime`/`KhaveeProvider` depend only on the `RealtimeProvider` interface — `GenericPipelineProvider` must satisfy that interface exactly with no react-layer changes (ORCH-02's explicit success criterion)
- Phase 3/4 (Thonburian STT, JaiTTS) will construct `GenericPipelineProvider` instances using their own `STTProvider`/`TTSProvider` adapters in place of this phase's OpenAI stand-ins — Phase 2's constructor shape and adapter package location are the direct dependency surface for those phases

</code_context>

<specifics>
## Specific Ideas

No UI/visual specifics — this is a pure TypeScript orchestration phase. The concrete specifics are the field-level and behavioral decisions captured above (D-01 through D-08), since those define exactly how cancellation, tool looping, and configurability work.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Real Thonburian/JaiTTS adapters and Bedrock/Gemini adapters are already tracked as Phase 3/4 and out-of-scope respectively in PROJECT.md/REQUIREMENTS.md, not new deferrals from this discussion.)

</deferred>

---

*Phase: 2-Generic Pipeline Orchestrator*
*Context gathered: 2026-06-18*
