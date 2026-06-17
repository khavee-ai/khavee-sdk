# Phase 1: Core Interfaces & Tool-Calling - Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 8 (4 new, 2 modified, 2 deleted, plus 2 import-site updates)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `packages/core/src/types/tools.ts` (NEW) | model/type-contract | transform (no runtime data flow — type + lift-shifted class) | `packages/providers/openai-stt-tts/src/ToolExecutor.ts` (for the class) + `packages/core/src/types/realtime.ts` (for the `RealtimeTool`/result-shape pattern) | exact (class), role-match (types) |
| `packages/core/src/types/pipeline.ts` (NEW) | model/type-contract | CRUD-shaped contracts (connect/transcribe/complete/speak) | `packages/core/src/types/realtime.ts` (`RealtimeProvider`, `RealtimeConfig`) + `packages/providers/openai-stt-tts/src/{AudioRecorder,STTClient,ChatClient,TTSPlayer}.ts` (concrete stage implementations to generalize) | role-match |
| `packages/core/src/types/mock.ts` (MODIFIED — rename collision fix) | model/type-contract | request-response | itself (pre-existing file, modify in place) | exact |
| `packages/core/src/types/index.ts` (MODIFIED — barrel) | config/barrel | — | itself (pre-existing file, modify in place) | exact |
| `packages/providers/openai-stt-tts/src/ToolExecutor.ts` (DELETE) | utility | event-driven (dispatch/registry) | superseded by promoted `packages/core/src/types/tools.ts` | exact (source of truth) |
| `packages/providers/openai-realtime/src/ToolExecutor.ts` (DELETE) | utility | event-driven (dispatch/registry) | superseded by promoted `packages/core/src/types/tools.ts` | exact (source of truth, byte-for-byte identical to the other) |
| `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` (MODIFIED — import-only) | controller/provider | request-response | itself — only the `import { ToolExecutor } from "./ToolExecutor"` line changes to `from "@khaveeai/core"` | exact |
| `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` (MODIFIED — import-only) | controller/provider | event-driven (WebRTC data channel) | itself — only the `import { ToolExecutor } from "./ToolExecutor"` line changes to `from "@khaveeai/core"`; `handleToolCall` (lines 577-604) stays unchanged | exact |
| `packages/core/src/__tests__/ToolExecutor.test.ts` (NEW, test) | test | request-response (unit) | `packages/providers/openai-stt-tts/src/__tests__/ChatClient.test.ts` (test file structure/conventions) | role-match |
| `packages/core/vitest.config.ts` (NEW, config) | config | — | `packages/providers/openai-stt-tts/vitest.config.ts` | exact |
| `packages/core/package.json` (MODIFIED — add vitest deps + test script) | config | — | `packages/providers/openai-stt-tts/package.json` | exact |

## Pattern Assignments

### `packages/core/src/types/tools.ts` (NEW — model/type-contract)

**Analogs:** `packages/providers/openai-stt-tts/src/ToolExecutor.ts` (class to lift-and-shift) and `packages/core/src/types/realtime.ts` (existing `RealtimeTool` shape to mirror, not modify)

**Why this analog:** Both `packages/providers/openai-stt-tts/src/ToolExecutor.ts` and `packages/providers/openai-realtime/src/ToolExecutor.ts` are confirmed byte-for-byte identical. This is a direct lift-and-shift, not a reimplementation — copy the class body verbatim, only change what it's typed against.

**Current import to REMOVE during promotion** (`packages/providers/openai-stt-tts/src/ToolExecutor.ts:5`):
```typescript
import { RealtimeTool } from '@khaveeai/core';
```
Per RESEARCH.md Pitfall 2, this import must NOT be preserved in the promoted file — it would create a self-import inside `@khaveeai/core` itself. Replace the type parameter with a local minimal type (`ExecutableTool`, per D-03).

**Core class body to lift verbatim** (`packages/providers/openai-stt-tts/src/ToolExecutor.ts:7-47`, identical in `packages/providers/openai-realtime/src/ToolExecutor.ts:7-47`):
```typescript
export class ToolExecutor {
  private functions: Map<string, RealtimeTool['execute']> = new Map();

  register(name: string, fn: RealtimeTool['execute']): void {
    this.functions.set(name, fn);
  }

  async execute(name: string, args: any): Promise<{ success: boolean; message: string }> {
    const fn = this.functions.get(name);

    if (!fn) {
      return { success: false, message: `Function '${name}' not found` };
    }

    try {
      return await fn(args);
    } catch (error) {
      console.error(`Error executing function '${name}':`, error);
      return {
        success: false,
        message: `Error executing function: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  getRegisteredFunctions(): string[] {
    return Array.from(this.functions.keys());
  }
}
```
Replace every `RealtimeTool['execute']` with the new local `ExecutableTool['execute']` type (D-03):
```typescript
export type ExecutableTool = {
  name: string;
  execute: (args: any) => Promise<ToolResult>;
};
```

**Existing result-shape pattern to mirror** (`packages/core/src/types/realtime.ts:18-21`, the `execute` field on `RealtimeTool` — DO NOT MODIFY this file, only mirror its shape in the new type):
```typescript
execute: (args: any) => Promise<{
  success: boolean;
  message: string;
}>;
```
This becomes the new `ToolResult` interface:
```typescript
export interface ToolResult {
  success: boolean;
  message: string;
}
```

**New `Tool` type** — field name `execute` preserved per D-01 (zero churn vs. `RealtimeTool`), but `parameters` uses JSON-Schema shape per D-02 (diverges from `RealtimeTool.parameters`'s flat map at `realtime.ts:10-17`):
```typescript
export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: "string" | "number" | "boolean" | "array" | "object";
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  execute: (args: any) => Promise<ToolResult>;
}
```

**Error handling pattern** (copied unchanged from the existing `ToolExecutor.execute()`, both source files): wraps every registered fn call in try/catch, never throws past its own boundary, returns `{success: false, message}` on both "not found" and runtime-error paths. This matches CLAUDE.md's documented error-handling convention for async lifecycle methods (normalize unknown `catch` values via `error instanceof Error ? error.message : 'Unknown error'`).

---

### `packages/core/src/types/pipeline.ts` (NEW — model/type-contract)

**Analogs:**
- `packages/core/src/types/realtime.ts` (`RealtimeProvider`, `RealtimeConfig` — interface shape conventions: readonly capability-style fields, optional config fields, JSDoc on every field)
- `packages/providers/openai-stt-tts/src/AudioRecorder.ts` (closest existing analog for `VADProvider` — confirmed by CONTEXT.md's explicit discretion note)
- `packages/providers/openai-stt-tts/src/STTClient.ts` (closest existing analog for `STTProvider`)
- `packages/providers/openai-stt-tts/src/ChatClient.ts` (closest existing analog for `LLMProvider`, though research confirms it has NO tool-calling support today — clean-slate design, not retrofit)
- `packages/providers/openai-stt-tts/src/TTSPlayer.ts` (closest existing analog for `TTSProvider`)
- `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:577-604` (`handleToolCall` — the real single-tool-call round trip that `ToolCall`/`id` must remain adapter-compatible with)

**Why these analogs:** `RealtimeProvider` is the only existing fat-interface pattern in the codebase for "vendor-swappable contract with event callbacks." The four helper classes (`AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer`) are today concrete OpenAI-specific classes — CLAUDE.md explicitly calls this out as "the primary generalization point" for this milestone. Read each to extract the exact async method signatures and input/output shapes the new interfaces must generalize.

**JSDoc + readonly capability-flag style to copy** (`packages/core/src/types/realtime.ts` field-doc convention, e.g. line 86):
```typescript
/** Fired after each OpenAI response.done event with the token breakdown. */
onUsageReport?: (usage: UsageReport) => void;
```
Apply the same single-line `/** ... */` doc style above each capability flag, documenting units/defaults exactly like CLAUDE.md's documented convention: `/** Duration of silence (ms) before ending a speech turn. Default: 1500 */`.

**`VADProvider` — generalize from `AudioRecorder`** (`packages/providers/openai-stt-tts/src/AudioRecorder.ts:44-135`):
Concrete async lifecycle to abstract:
```typescript
async connect(config: AudioRecorderConfig): Promise<void> { ... }
async disconnect(): Promise<void> { ... }
async pause(): Promise<void> { ... }
async resume(): Promise<void> { ... }
isListening(): boolean { ... }
```
Event-callback fields to generalize:
```typescript
public onSpeechStart?: () => void;
public onUtteranceReady?: (wav: Blob) => void;
public onError?: (error: Error) => void;
```
`VADProvider` should expose this same connect/disconnect/pause/resume + event-callback shape as an interface. Both real vendors this milestone (Thonburian STT, JaiTTS) are whole-utterance, non-streaming — so a `supportsStreaming: boolean` flag (default false, per CONTEXT.md Claude's-discretion note) belongs on `STTProvider`/`TTSProvider`, not necessarily `VADProvider` itself (VAD is inherently event-driven, not a streaming-vs-batch distinction).

**`STTProvider` — generalize from `STTClient`** (`packages/providers/openai-stt-tts/src/STTClient.ts:35-84`):
```typescript
async transcribe(
  wavBlob: Blob,
  endpoint: string,
  authToken: string,
  language?: string,
): Promise<string>
```
D-06 changes the return type from plain `string` to a result object. New interface method signature:
```typescript
transcribe(audio: Blob, opts?: { language?: string }): Promise<STTResult>;

export interface STTResult {
  text: string;
  /** Present and true when the vendor's own heuristics flag this transcript
   *  as likely hallucinated/silent. Vendors that never reject simply omit this field. */
  rejected?: boolean;
}
```
Note the existing dual-shape JSON tolerance pattern in `STTClient.transcribe()` (lines 64-77, accepting both `{transcript}` and `{data: {transcript}}`) — this is an HTTP-proxy-client concern, not something the new `STTProvider` *interface* needs to encode; it stays inside whatever concrete adapter implements the interface later (Phase 4).

**`LLMProvider` — generalize from `ChatClient`, clean-slate per research** (`packages/providers/openai-stt-tts/src/ChatClient.ts:66-98`):
```typescript
async complete(args: CompleteArgs): Promise<ChatResult>
// ChatResult = { text: string; usage?: ChatUsage }
```
`ChatClient` has zero tool-calling support today. The new `LLMProvider.complete()` must add `toolCalls: ToolCall[]` (D-04, zero-or-more) to the result shape — this is net-new, not present in any existing analog:
```typescript
export interface LLMCompletionResult {
  text?: string;
  toolCalls: ToolCall[];
}

export interface ToolCall {
  /** Vendor-neutral correlation id. Maps from OpenAI's tool_calls[].id /
   *  Realtime API's call_id, Anthropic's tool_use.id, or Gemini's functionCall.id. */
  id: string;
  name: string;
  args: Record<string, any>;
}
```

**The real single-tool-call round trip this design must stay adapter-compatible with** (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:577-604`):
```typescript
private async handleToolCall(msg: any): Promise<void> {
  this.setChatStatus("thinking");
  try {
    const args = JSON.parse(msg.arguments);
    const result = await this.toolExecutor.execute(msg.name, args);
    this.onToolCall?.(msg.name, args, result);

    const response = {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: msg.call_id,           // <-- OpenAI-specific field name (CORE-06 violation if copied verbatim)
        output: JSON.stringify(result),
      },
    };
    this.dataChannel?.send(JSON.stringify(response));
    this.dataChannel?.send(JSON.stringify({ type: "response.create" }));
  } catch (error) {
    console.error("Tool execution error:", error);
    this.onError?.(error as Error);
  }
}
```
This is the `length === 1` case of the new `toolCalls: ToolCall[]` array (D-04) — `msg.call_id` maps to the new neutral `ToolCall.id` (D-05). No code in this file changes this phase; this is reference-only for verifying the new type's adapter compatibility.

**`TTSProvider` — generalize from `TTSPlayer`** (`packages/providers/openai-stt-tts/src/TTSPlayer.ts:34-80+`):
```typescript
async speak(
  text: string,
  config: SpeakConfig,
  audioContext: AudioContext,
  onAudioData: (analyser: AnalyserNode, ctx: AudioContext) => void
): Promise<void>
```
Note `TTSPlayer` is tightly coupled to the browser Web Audio API (`AudioContext`, `AnalyserNode`) for lip-sync — per CLAUDE.md's "Browser-only APIs" architectural constraint, the new `TTSProvider` interface should keep this coupling (it's not a Node.js-targeted interface), but the abstract method signature should generalize past one vendor's specific `SpeakConfig` shape (voice/speed/model/instructions are all OpenAI-flavored fields). Both real vendors this milestone (JaiTTS) are non-streaming/whole-utterance — reflect via a `supportsStreaming: false` capability flag default, per CONTEXT.md's discretion note.

---

### `packages/core/src/types/mock.ts` (MODIFIED — naming-collision fix)

**Analog:** itself (in-place rename, no external analog needed — this is a mechanical fix)

**Current content in full** (`packages/core/src/types/mock.ts:1-16`):
```typescript
// Core types and interfaces

export interface LLMProvider {
  streamChat(params: { messages: { role: string; content: string }[] }): AsyncIterable<{ type: string; delta: string }>;
}

export interface TTSProvider {
  speak(params: { text: string; voice?: string }): Promise<void>;
}

export interface KhaveeConfig {
  llm?: LLMProvider;
  tts?: TTSProvider;
  realtime?: import('./realtime').RealtimeProvider; // New realtime provider
  tools?: any[];
}
```

**Required change (RESEARCH.md Pitfall 1, recommended resolution = Option 1):** Rename the legacy `LLMProvider`/`TTSProvider` exports (e.g. to `LegacyLLMProvider`/`LegacyTTSProvider`) so the new pipeline-stage `LLMProvider`/`TTSProvider` interfaces in `pipeline.ts` can use the bare names without a duplicate-export barrel collision.

**Confirmed consumers that need updating in lockstep with the rename** (found via grep, read above):
- `packages/providers/mock/src/index.ts:1,3,54` — `import { LLMProvider, TTSProvider } from '@khaveeai/core'; export class MockLLM implements LLMProvider {...} export class MockTTS implements TTSProvider {...}`
- `packages/providers/openai/src/index.ts:2,11` — `import { LLMProvider } from '@khaveeai/core'; export class LLMOpenAI implements LLMProvider {...}`

Both of these import sites must update their import to the renamed legacy type (NOT the new pipeline-stage type) to keep their existing behavior unchanged — this is a pure rename, zero behavior change, per RESEARCH.md's explicit characterization ("a rename-only change... is a much smaller touch than 'reconciliation'").

---

### `packages/core/src/types/index.ts` (MODIFIED — barrel)

**Analog:** itself

**Current content in full** (`packages/core/src/types/index.ts:1-7`):
```typescript
// Core SDK Types and Interfaces
export * from './realtime';
export * from './providers';
export * from './conversation';
export * from './audio';
export * from './mock';
export * from './project';
```

**Required change:** Add `export * from './tools';` and `export * from './pipeline';` to this barrel. Since `mock.ts`'s collision is resolved at the source (renamed legacy types per the change above), the blanket `export *` pattern can stay unchanged — no named re-export workaround needed if Option 1 (rename at definition) is used.

---

### `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` (MODIFIED — import path only)

**Analog:** itself

**Current import** (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:19`):
```typescript
import { ToolExecutor } from "./ToolExecutor";
```
**Required change:** `import { ToolExecutor } from "@khaveeai/core";` — matches the project's documented import convention (CLAUDE.md "Import Organization": "Packages never import across sibling packages via relative `../../` paths — always via the `@khaveeai/*` package name"). No other line in this file changes; `this.toolExecutor = new ToolExecutor();` at line 129 stays identical since the class's public API (`register`, `execute`, `getRegisteredFunctions`) is unchanged by the promotion.

---

### `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` (MODIFIED — import path only)

**Analog:** itself

**Current import** (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:15`):
```typescript
import { ToolExecutor } from "./ToolExecutor";
```
**Required change:** `import { ToolExecutor } from "@khaveeai/core";` — same as above. `handleToolCall` (lines 577-604) and `this.toolExecutor = new ToolExecutor();` (line 82) stay byte-identical.

---

### `packages/providers/openai-stt-tts/src/index.ts` and `packages/providers/openai-realtime/src/index.ts` (MODIFIED — remove local re-export)

Both currently re-export their local `ToolExecutor`:
```typescript
// packages/providers/openai-stt-tts/src/index.ts:3
export { ToolExecutor } from "./ToolExecutor";
// packages/providers/openai-realtime/src/index.ts:2
export { ToolExecutor } from './ToolExecutor';
```
After deleting each package's local `ToolExecutor.ts`, these lines must be removed (consumers should import `ToolExecutor` from `@khaveeai/core` directly going forward) — or, if backward-compat re-export is desired, changed to `export { ToolExecutor } from "@khaveeai/core";`. Planner's discretion; RESEARCH.md's diagram shows both packages "deletes its local copy" and importing the promoted version, implying the cleaner removal.

---

### `packages/core/src/__tests__/ToolExecutor.test.ts` (NEW — test)

**Analog:** `packages/providers/openai-stt-tts/src/__tests__/ChatClient.test.ts`

**Test file structure to copy** (`packages/providers/openai-stt-tts/src/__tests__/ChatClient.test.ts:1-17`):
```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { ChatClient } from "../ChatClient";

const ENDPOINT = "https://api.example.com/api/v1/chat/completions";
const AUTH_TOKEN = "test-jwt-token";
const MESSAGES = [
  { role: "system" as const, content: "You are a helpful assistant." },
  { role: "user" as const, content: "Hello!" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

// ── SDK-05: ChatClient.complete() unit tests ────────────────────────────────

describe("ChatClient.complete", () => {
  it("posts to chatProxyEndpoint with correct headers and returns { text, usage } from top-level shape", async () => {
    ...
  });
});
```
Apply the same conventions for the new test: top-of-file `describe` block, a section-divider comment referencing the relevant requirement ID (`CORE-04`), SCREAMING_SNAKE_CASE module-level fixtures for mock data, `afterEach(() => vi.restoreAllMocks())`. Per CONTEXT.md's Claude's-discretion note, the test must normalize tool-call results to `{success, message}` across two differently-shaped mock vendor responses (e.g. one mock tool that throws, one that returns successfully) — this directly exercises `ToolExecutor.execute()`'s try/catch normalization path shown in the Pattern Assignments section above.

---

### `packages/core/vitest.config.ts` (NEW — config)

**Analog:** `packages/providers/openai-stt-tts/vitest.config.ts` (copy verbatim — no `@khaveeai/core`-specific differences needed)

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  css: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
    },
  },
});
```

---

### `packages/core/package.json` (MODIFIED — add vitest + test script)

**Analog:** `packages/providers/openai-stt-tts/package.json` (devDependencies block + `"test"` script entry)

**Required additions to `packages/core/package.json`'s `scripts` and `devDependencies`** (per RESEARCH.md Pitfall 4 — `@khaveeai/core` currently has zero test infra, no `test` script, confirmed by reading the file in full above):
```json
"scripts": {
  "build": "tsc",
  "dev": "tsc --watch",
  "clean": "rm -rf dist",
  "test": "vitest run"
},
"devDependencies": {
  "@types/three": "^0.180.0",
  "typescript": "^5",
  "vitest": "^2.0.0",
  "@vitest/coverage-v8": "^2.0.0"
}
```
Pin `^2.0.0` to match `openai-stt-tts`'s existing pin for monorepo consistency (RESEARCH.md Standard Stack recommendation), not the npm-registry latest (`4.1.9`).

---

## Shared Patterns

### Error normalization (`instanceof Error` check)
**Source:** `packages/providers/openai-stt-tts/src/AudioRecorder.ts:94` and CLAUDE.md's documented convention
**Apply to:** Any new code in `tools.ts`/`pipeline.ts` that catches unknown errors (the promoted `ToolExecutor.execute()` already does this correctly — preserve verbatim, do not "improve" it)
```typescript
this.onError?.(error instanceof Error ? error : new Error(String(error)));
```

### `{success, message}` result normalization
**Source:** `packages/core/src/types/realtime.ts:18-21` (`RealtimeTool.execute`'s return type) and `packages/providers/openai-stt-tts/src/ToolExecutor.ts:20-39` (`ToolExecutor.execute`'s implementation)
**Apply to:** `ToolResult` interface in the new `tools.ts`, and any mock vendor shapes used in the success-criterion-3 unit test — this is the single shape every tool-call result, regardless of vendor, must normalize to (CORE-04).

### Per-domain type file convention
**Source:** `packages/core/src/types/{realtime,providers,conversation,audio,mock,project,qdrant}.ts`
**Apply to:** New files `tools.ts` and `pipeline.ts` — one cohesive domain per file, barrel-exported via `index.ts`'s `export * from './X'` pattern, no nested subdirectories.

### Field-level JSDoc convention (units, defaults, vendor-mapping notes)
**Source:** `packages/core/src/types/realtime.ts:40` (`/** Duration of silence (ms) before ending a speech turn. Default: 1500 */` — paraphrased per CLAUDE.md, exact line is `instructions?: string;` context but the convention is documented in CLAUDE.md verbatim) and line 86 (`/** Fired after each OpenAI response.done event with the token breakdown. */`)
**Apply to:** Every capability flag (`supportsStreaming`, `supportsRejection`, etc.) and every field on `ToolCall`/`STTResult`/`LLMCompletionResult` — document vendor-mapping intent inline, exactly as the Pattern 4 sketch in RESEARCH.md already does for `ToolCall.id`.

### `@khaveeai/*` package-name imports, never relative cross-package paths
**Source:** CLAUDE.md "Import Organization" section; confirmed in both `ToolExecutor.ts` files (`import { RealtimeTool } from '@khaveeai/core';`)
**Apply to:** The two import-path fixes in `OpenAISTTTTSProvider.ts` and `OpenAIRealtimeProvider.ts` (changing `from "./ToolExecutor"` to `from "@khaveeai/core"`).

## No Analog Found

None. All files in scope for this phase have at least a role-match or exact analog in the existing codebase — this phase is explicitly designed (per CONTEXT.md and RESEARCH.md) to generalize patterns that already exist concretely in `openai-stt-tts`/`openai-realtime`, not to invent new ones from scratch.

## Metadata

**Analog search scope:** `packages/core/src/types/*.ts`, `packages/providers/openai-stt-tts/src/*.ts` (+ `__tests__/`), `packages/providers/openai-realtime/src/*.ts`, `packages/providers/mock/src/index.ts`, `packages/providers/openai/src/index.ts`
**Files scanned:** 17 (read or grepped directly this session)
**Pattern extraction date:** 2026-06-18
