# Phase 1: Core Interfaces & Tool-Calling - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

`@khaveeai/core` gains a fixed, vendor-neutral contract: `VADProvider`, `STTProvider`, `LLMProvider`, and `TTSProvider` interfaces (each with capability flags), a new JSON-Schema-style `Tool` type plus `addTool()`-style registration, and a single promoted `ToolExecutor` that replaces the two byte-for-byte duplicates in `openai-stt-tts` and `openai-realtime`. No orchestrator, no real vendor adapters, and no changes to `openai-stt-tts`'s behavior — this phase only fixes the contract that every later phase builds against.

</domain>

<decisions>
## Implementation Decisions

### Tool field naming
- **D-01:** The new `Tool` type's execution field stays named `execute` (not `handler`). This matches the existing `RealtimeTool` (`packages/core/src/types/realtime.ts`) and the `ToolExecutor`/`registerFunction` code being promoted from `openai-stt-tts` and `openai-realtime` — zero churn on working code. REQUIREMENTS.md CORE-03's "`handler`" wording is descriptive of the *shape* (plain object + callback), not a literal field-name requirement.

### Tool parameter schema shape
- **D-02:** The new core `Tool` type is a **new type**, separate from `RealtimeTool` (which stays untouched per the compatibility constraint). `Tool.parameters` uses JSON-Schema-style shape (`{type: "object", properties: {...}, required: [...]}`) instead of `RealtimeTool`'s flat custom map (`{[key]: {type, required, enum, description}}`). This matches what OpenAI/Anthropic/Gemini tool-calling APIs actually expect, so no per-vendor parameter transform is needed and the Phase 1 success-criterion-5 sketch (Anthropic/Gemini mapping) has a direct target shape.
- **D-03:** The promoted core `ToolExecutor` is typed against a **minimal shared shape** — `{name: string, execute: (args) => Promise<{success, message}>}` — not against `RealtimeTool` or `Tool` specifically. `ToolExecutor` never reads `parameters` (confirmed by reading both existing `ToolExecutor.ts` files — `register`/`execute` only touch `name` and the execute function), so one executor implementation works unmodified for both the old `RealtimeTool`-based packages and the new `Tool`-based code. No generic/parameterized executor needed.

### Multi-tool-call support
- **D-04:** `LLMProvider`'s completion result type carries `toolCalls: ToolCall[]` (zero or more), not a single optional tool call. Today's actual OpenAI Realtime behavior (`OpenAIRealtimeProvider.handleToolCall`, one `function_call_arguments.done` event at a time) is the `length === 1` case of this shape — no information is lost. This directly satisfies CORE-06 and gives the success-criterion-5 sketch (Anthropic/Gemini-shaped multi-tool-call round trip) a real target without a future interface redesign.
- **D-05:** Each `ToolCall`'s correlation identifier (used to send the tool's result back to the LLM in the next turn — OpenAI calls this `call_id`/`tool_call_id`) is named **`id`** on the vendor-neutral type, per CORE-06's explicit instruction to avoid OpenAI-specific field names. Each `LLMProvider` implementation is responsible for mapping its vendor's own field (OpenAI's `tool_call_id`, Anthropic's `id` on a `tool_use` block, Gemini's index-based correlation, etc.) to/from this single `id` string.

### STTProvider return shape
- **D-06:** `STTProvider.transcribe()` returns a result object (e.g. `{text: string, rejected?: boolean}`), not a plain `string`. This lets Phase 4's `ThonburianSTTProvider` surface BACK-02's hallucination/no-speech rejection signal through the standard interface with no Phase 1 interface redesign later. Vendors that never reject (e.g. a hypothetical future OpenAI-Whisper-backed `STTProvider`) simply never set `rejected`. Input stays a `Blob` (WAV) — matches the existing `AudioRecorder.onUtteranceReady(wav: Blob)` / `STTClient.transcribe(wavBlob: Blob, ...)` pattern already used in the browser SDK; not in question, no vendor sends audio any other way today.

### Claude's Discretion
- Exact names and presence of capability flags per interface (e.g. `supportsStreaming`, `supportsToolCalling`) beyond what's needed to satisfy CORE-02 — researcher/planner should derive these from the two real vendors' actual capabilities (Thonburian STT and JaiTTS TTS are both whole-utterance, non-streaming; this should be reflected in the flags' defaults/usage, not contradicted).
- Exact shape of `VADProvider` (not discussed — no gray area surfaced; existing `AudioRecorder` is the closest analog and should inform it).
- Where the new `Tool`/`ToolCall`/`LLMProvider` types physically live within `packages/core/src/types/` (new file vs. extending an existing one) — follow existing per-domain file naming convention (`realtime.ts`, `audio.ts`, `conversation.ts`, etc.).
- The unit test required by success criterion 3 (tool-call results normalized to `{success, message}` across two differently-shaped mock vendor responses) — test structure and mock vendor shapes are implementation detail.
- How exactly the "written sketch" for success criterion 5 is delivered (code comment vs. design note doc) — both are acceptable per ROADMAP.md wording.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level scope and decisions
- `.planning/PROJECT.md` — Core value, requirements (validated/active/out-of-scope), and milestone-wide key decisions (e.g. streaming-chunked HTTP protocol, no-Zod tool-calling)
- `.planning/REQUIREMENTS.md` — Full CORE-01..06 requirement text and v1/v2 scope split
- `.planning/ROADMAP.md` — Phase 1 goal and success criteria (the five numbered criteria this phase must satisfy)
- `.planning/STATE.md` — Accumulated decisions and the Phase 1 blocker note: "Must avoid baking OpenAI-shaped assumptions into 'generic' interfaces... written Anthropic/Gemini sketch required before phase is done"

### Codebase patterns to promote/respect
- `packages/core/src/types/realtime.ts` — `RealtimeTool`, `RealtimeProvider`, `RealtimeEvents` (the existing interface seam; `RealtimeTool` must NOT be modified — compatibility constraint)
- `packages/providers/openai-stt-tts/src/ToolExecutor.ts` and `packages/providers/openai-realtime/src/ToolExecutor.ts` — the byte-for-byte duplicate to promote into core (confirmed identical; only touches `name` + `execute`, never `parameters`)
- `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` (`handleToolCall`, lines ~577-602) — the real single-tool-call round trip (`call_id`, `arguments` JSON string, `function_call_output`) that the new vendor-neutral `ToolCall`/`id` design must remain compatible with via adapter-side mapping
- `packages/providers/openai-stt-tts/src/ChatClient.ts` — confirms the turn-based pipeline's existing `ChatClient.complete()` has NO tool-calling support today (plain text in/out); the new `LLMProvider` is a clean-slate design, not a retrofit of `ChatClient`
- `packages/core/src/types/mock.ts` — the orphaned legacy `LLMProvider`/`TTSProvider` types; explicitly NOT the same as the new interfaces being designed here (out of scope this milestone per CLEAN-03 in REQUIREMENTS.md v2)
- `.planning/codebase/CONCERNS.md` — broader tech-debt context (not Phase-1-specific beyond the ToolExecutor duplication already covered above)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `RealtimeTool` (`packages/core/src/types/realtime.ts`) — already returns `{success, message}` from `execute()`, matching CORE-04's normalized result shape; the new `Tool`/`ToolCall` design extends this pattern rather than inventing a new result shape.
- `ToolExecutor` (duplicated) — direct lift-and-shift candidate into `packages/core`; logic doesn't need to change, only its location and the minimal type it's typed against (D-03).

### Established Patterns
- Per-domain type files under `packages/core/src/types/*.ts` (`realtime.ts`, `audio.ts`, `conversation.ts`, `providers.ts`, `mock.ts`) — new interfaces should follow this file-per-domain convention.
- Existing `Provider` marker interface (`packages/core/src/types/providers.ts`) is currently unused by any concrete class — worth checking whether `VADProvider`/`STTProvider`/`LLMProvider`/`TTSProvider` should extend it for a shared `{name, version}` shape, or whether that's dead weight to ignore.
- All current SDK code is browser-only (`AudioContext`, `Blob`, `RTCPeerConnection`) — the new interfaces should not assume Node.js APIs.

### Integration Points
- `packages/react` (`useRealtime`, `KhaveeProvider`) depends only on `RealtimeProvider`, never on the helper classes directly — Phase 1's new interfaces have no React-layer integration to worry about yet (that's Phase 2's orchestrator).
- Phase 2's orchestrator will consume `{vad, stt, llm, tts, tools}` built from these interfaces — Phase 1's design choices (especially D-02 through D-05) are the direct dependency surface for Phase 2 and Phase 4 (vendor adapters).

</code_context>

<specifics>
## Specific Ideas

No UI/visual specifics — this is a pure TypeScript interface-design phase. The concrete "specifics" are the field-level decisions captured above (D-01 through D-06), since those are exactly the details a beginner-facing, vendor-neutral contract lives or dies by.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Reconciling the legacy `LLMProvider`/`TTSProvider` in `mock.ts` and real Bedrock/Gemini adapters are already tracked as v2/out-of-scope in REQUIREMENTS.md and PROJECT.md, not new deferrals from this discussion.)

</deferred>

---

*Phase: 1-Core Interfaces & Tool-Calling*
*Context gathered: 2026-06-18*
