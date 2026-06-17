# Phase 1: Core Interfaces & Tool-Calling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 1-Core Interfaces & Tool-Calling
**Areas discussed:** Tool field naming, Tool parameter schema shape, Multi-tool-call support, STTProvider return shape

---

## Tool field naming

| Option | Description | Selected |
|--------|-------------|----------|
| Keep `execute` (Recommended) | Zero churn on the type being promoted from packages/core/src/types/realtime.ts — RealtimeTool, ToolExecutor, and both existing packages already use this field name. REQUIREMENTS.md wording was illustrative, not a literal API contract. | ✓ |
| Rename to `handler` | Matches REQUIREMENTS.md CORE-03 literally. Requires updating RealtimeTool's type or introducing a new Tool type with a field-name shim, plus touching ToolExecutor's generic signature. | |
| You decide | Let the planner/researcher pick based on what minimizes churn while satisfying CORE-03. | |

**User's choice:** Keep `execute`
**Notes:** None.

---

## Tool parameter schema shape

| Option | Description | Selected |
|--------|-------------|----------|
| JSON-Schema-style (Recommended) | Matches the wire format every real LLM vendor's tool-calling API expects — no per-vendor parameter transform needed later. RealtimeTool stays untouched; this is a NEW type used only by the new LLMProvider interface. | ✓ |
| Keep flat custom map | Mirrors RealtimeTool exactly — one shared Tool shape across old and new code, less new type surface. Each vendor adapter would still need to transform this into JSON Schema internally. | |
| You decide | Let the planner pick based on what's simplest to implement correctly in Phase 1. | |

**User's choice:** JSON-Schema-style (Recommended)
**Notes:** New `Tool` type is distinct from `RealtimeTool`.

**Follow-up:** Given the two tool shapes now differ, what should the promoted core ToolExecutor be typed against?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal shared shape (Recommended) | ToolExecutor only ever calls register(name, executeFn) and execute(name, args) — never touches `parameters`. Type it against `{name: string, execute: (args) => Promise<{success,message}>}` so it works unmodified for both RealtimeTool and the new Tool type. | ✓ |
| Two separate adapters | Keep ToolExecutor generic/parameterized over a type argument, with old packages instantiating ToolExecutor<RealtimeTool> and new code instantiating ToolExecutor<Tool>. | |
| You decide | Let the planner choose the simplest typing that satisfies CORE-05. | |

**User's choice:** Minimal shared shape (Recommended)
**Notes:** Confirmed by reading both existing ToolExecutor.ts files — neither touches `parameters`.

---

## Multi-tool-call support

| Option | Description | Selected |
|--------|-------------|----------|
| Array of tool calls (Recommended) | toolCalls: ToolCall[] on the completion result, where ToolCall is {id, name, arguments}. Empty array = no tool call. Satisfies CORE-06 and the success criterion 5 sketch. | ✓ |
| Single optional tool call | toolCall?: ToolCall on the result, matching today's actual single-function-call behavior exactly. | |
| You decide | Let the planner pick based on what's simplest while still passing the success-criterion-5 sketch. | |

**User's choice:** Array of tool calls (Recommended)
**Notes:** Today's OpenAI Realtime behavior is the length === 1 case of this shape — no information lost.

**Follow-up:** What should the neutral per-call identifier field be named (avoiding OpenAI's tool_call_id per CORE-06)?

| Option | Description | Selected |
|--------|-------------|----------|
| `id` (Recommended) | Generic, vendor-neutral. The vendor-specific adapter maps its own field (tool_call_id, id, functionCall name+index, etc.) to/from this single `id` string. | ✓ |
| `callId` | Slightly more explicit about purpose than bare `id`, still vendor-neutral. | |
| You decide | Let the planner pick the field name. | |

**User's choice:** `id` (Recommended)
**Notes:** None.

---

## STTProvider return shape

| Option | Description | Selected |
|--------|-------------|----------|
| Result object now (Recommended) | transcribe() returns {text: string, rejected?: boolean} (or similar). Phase 4's ThonburianSTTProvider can surface BACK-02's rejection signal through the standard interface with no Phase-1 interface change needed later. | ✓ |
| Plain string now | transcribe() returns Promise<string>. Simpler today, but Phase 4 would need to throw/special-case on rejection (lossy), or the interface gets revisited then. | |
| You decide | Let the planner pick based on what's simplest while still satisfying Phase 1's "no later redesign" goal. | |

**User's choice:** Result object now (Recommended)
**Notes:** Input stays a Blob (WAV) — matches existing AudioRecorder/STTClient pattern, not a gray area.

---

## Claude's Discretion

- Exact capability flags per interface beyond what CORE-02 requires (e.g. `supportsStreaming`) — derive from Thonburian STT / JaiTTS's actual (non-streaming, whole-utterance) capabilities.
- `VADProvider`'s exact shape — no gray area surfaced; use existing `AudioRecorder` as the closest analog.
- File location for new types within `packages/core/src/types/` — follow existing per-domain convention.
- Unit test structure for CORE-04 (two differently-shaped mock vendor responses normalizing to `{success, message}`).
- Delivery form of the success-criterion-5 written sketch (code comment vs. design note doc) — both acceptable per ROADMAP.md.

## Deferred Ideas

None — discussion stayed within phase scope. Legacy `mock.ts` `LLMProvider`/`TTSProvider` reconciliation and real Bedrock/Gemini adapters were already tracked as v2/out-of-scope before this discussion (not new deferrals).
