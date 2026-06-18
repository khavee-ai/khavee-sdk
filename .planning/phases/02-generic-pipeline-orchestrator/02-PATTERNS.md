# Phase 2: Generic Pipeline Orchestrator - Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 14 (1 modified core interface file + 1 modified compatibility export file + 12 new files)
**Analogs found:** 14 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `packages/core/src/types/pipeline.ts` (MODIFIED — add `signal?: AbortSignal`) | config/interface | request-response | itself (Phase 1 deliverable, additive edit only) | exact (self-edit) |
| `packages/providers/openai-stt-tts/src/index.ts` (MODIFIED — additive exports) | config (barrel) | n/a | itself (additive edit only) | exact (self-edit) |
| `packages/providers/generic-stt-tts/package.json` | config | n/a | `packages/providers/openai-stt-tts/package.json` | exact |
| `packages/providers/generic-stt-tts/tsconfig.json` | config | n/a | `packages/providers/openai-stt-tts/tsconfig.json` | exact |
| `packages/providers/generic-stt-tts/vitest.config.ts` | config | n/a | `packages/providers/openai-stt-tts/vitest.config.ts` | exact |
| `packages/providers/generic-stt-tts/src/index.ts` | config (barrel) | n/a | `packages/providers/openai-stt-tts/src/index.ts` | exact |
| `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` | controller (orchestrator/provider) | event-driven + request-response | `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` | exact |
| `packages/providers/generic-stt-tts/src/adapters/OpenAIVADAdapter.ts` | service (adapter) | event-driven | `packages/providers/openai-stt-tts/src/AudioRecorder.ts` | exact (near-direct wrap) |
| `packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts` | service (adapter) | request-response | `packages/providers/openai-stt-tts/src/STTClient.ts` | exact |
| `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts` | service (adapter) | request-response | `packages/providers/openai-stt-tts/src/ChatClient.ts` (structure) + `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` (`configureSession`/`handleToolCall`, tool-shape mapping + signal/tool-calling additions) | role-match (ChatClient has no tool-calling/signal precedent — see Pitfall 1 below) |
| `packages/providers/generic-stt-tts/src/adapters/OpenAITTSAdapter.ts` | service (adapter) | request-response + streaming (audio playback) | `packages/providers/openai-stt-tts/src/TTSPlayer.ts` | exact (adds `signal` passthrough) |
| `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` | test | n/a | `packages/providers/openai-stt-tts/src/__tests__/OpenAISTTTTSProvider.test.ts` | exact |
| `packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts` | test | n/a | `packages/core/src/__tests__/ToolExecutor.test.ts` (interface-conformance style) + `packages/providers/openai-stt-tts/src/__tests__/OpenAISTTTTSProvider.test.ts` (fake-deps style) | role-match |
| `packages/providers/generic-stt-tts/src/__tests__/OpenAITTSAdapter.test.ts` / `OpenAISTTAdapter.test.ts` | test | n/a | `packages/providers/openai-stt-tts/src/__tests__/OpenAISTTTTSProvider.test.ts` (fake-deps/vi.fn() style) | role-match |

## Pattern Assignments

### `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` (controller, event-driven + request-response)

**Analog:** `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` (full file is the template — 515 lines, structurally port nearly the whole class)

**Imports pattern** (lines 1-23):
```typescript
import {
  RealtimeProvider,
  RealtimeConfig,
  RealtimeTool,
  UsageReport,
  Conversation,
  ChatStatus,
  MouthState,
  PhonemeData,
} from "@khaveeai/core";
import { RealtimeMessage } from "@khaveeai/core";
import { ToolExecutor } from "@khaveeai/core";
import { AudioRecorder } from "./AudioRecorder";
import { STTClient } from "./STTClient";
import { ChatClient } from "./ChatClient";
import { TTSPlayer } from "./TTSPlayer";
```
For `GenericPipelineProvider`, swap the four concrete-class imports for the four Phase 1 interface imports from `@khaveeai/core` (`VADProvider, STTProvider, LLMProvider, TTSProvider, Tool`), keep everything else identical:
```typescript
import {
  RealtimeProvider,
  RealtimeConfig,
  UsageReport,
  Conversation,
  ChatStatus,
  MouthState,
  PhonemeData,
  RealtimeMessage,
  ToolExecutor,
  VADProvider,
  STTProvider,
  LLMProvider,
  TTSProvider,
  Tool,
} from "@khaveeai/core";
```

**Config-extends-RealtimeConfig pattern** (lines 25-58):
```typescript
export interface OpenAISTTTTSConfig extends RealtimeConfig {
  sttModel?: string;
  ttsModel?: string;
  sttProxyEndpoint?: string;
  ttsProxyEndpoint?: string;
  chatProxyEndpoint?: string;
  silenceThresholdMs?: number;
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  baseAssetPath?: string;
  onnxWASMBasePath?: string;
  ttsInstructions?: string;
}

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ProviderDeps = {
  audioRecorder?: AudioRecorder;
  sttClient?: STTClient;
  chatClient?: ChatClient;
  ttsPlayer?: TTSPlayer;
};
```
For `GenericPipelineConfig`, this becomes (per CONTEXT.md Claude's Discretion + RESEARCH Pattern 1):
```typescript
export interface GenericPipelineConfig extends RealtimeConfig {
  vad: VADProvider;
  stt: STTProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  tools?: Tool[];   // narrows/shadows RealtimeConfig.tools?: RealtimeTool[] — verify TS allows this narrowing or rename field (see RESEARCH Pattern 1 note + Anti-Patterns: Tool vs RealtimeTool NOT structurally identical)
  /** VAD-to-mic-reopen cooldown (ms) after TTS playback ends. Default: 500 (D-08). */
  micReopenCooldownMs?: number;
}
```

**Constructor pattern** (lines 118-147):
```typescript
constructor(config: OpenAISTTTTSConfig, deps?: ProviderDeps) {
  this.config = {
    sttModel: "gpt-4o-mini-transcribe",
    ttsModel: "gpt-4o-mini-tts",
    voice: "alloy",
    speed: 1.0,
    ...config,
  };

  this.toolExecutor = new ToolExecutor();

  this.audioRecorder = deps?.audioRecorder ?? new AudioRecorder();
  this.sttClient = deps?.sttClient ?? new STTClient();
  this.chatClient = deps?.chatClient ?? new ChatClient();
  this.ttsPlayer = deps?.ttsPlayer ?? new TTSPlayer();

  if (this.config.tools) {
    this.config.tools.forEach((tool) => this.registerFunction(tool));
  }

  if (this.config.instructions) {
    this.messages.push({ role: "system", content: this.config.instructions });
  }
}
```
For `GenericPipelineProvider`, the constructor takes the four injected interfaces directly off `config` (no DI seam needed — the interfaces themselves ARE the seam, per CONTEXT.md/RESEARCH Pattern 1):
```typescript
constructor(config: GenericPipelineConfig) {
  this.config = { micReopenCooldownMs: 500, ...config };
  this.vad = config.vad;
  this.stt = config.stt;
  this.llm = config.llm;
  this.tts = config.tts;
  this.toolExecutor = new ToolExecutor();
  config.tools?.forEach((t) => this.toolExecutor.register(t.name, t.execute));
  if (this.config.instructions) {
    this.messages.push({ role: "system", content: this.config.instructions });
  }
}
```

**Lifecycle pattern — connect()** (lines 236-286): copy almost verbatim, but wire `this.vad.connect()`/`onSpeechStart`/`onUtteranceReady`/`onError` instead of `audioRecorder`:
```typescript
async connect(): Promise<void> {
  try {
    this.setChatStatus("starting");
    this.sessionId = crypto.randomUUID();
    this.audioOutputContext = new AudioContext();

    this.vad.onSpeechStart = () => {
      if (!this.activeTurnController && this.micEnabled) {
        this.setChatStatus("listening");
      }
    };
    this.vad.onUtteranceReady = (wav: Blob) => {
      if (this.micEnabled) {
        void this.runTurn(wav);
      }
    };
    this.vad.onError = (error: Error) => {
      this.onError?.(error);
      this.setChatStatus("ready");
    };

    await this.vad.connect();

    this.isConnected = true;
    this.micEnabled = true;
    this.setChatStatus("ready");
    this.onConnect?.();
  } catch (error) {
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
    this.setChatStatus("stopped");
    await this.disconnect();
  }
}
```
Note: `_isTurnActive` boolean is replaced by `activeTurnController !== null` check (D-03) — see Pattern 3 below for the full barge-in rewrite of `runTurn`/`runTurnFromText`.

**disconnect() pattern** (lines 301-329) — copy near-verbatim, swap `audioRecorder.disconnect()` → `vad.disconnect()`, `ttsPlayer.cancel()` → abort `activeTurnController` (TTSProvider has no `cancel()` of its own; cancellation is solely via `signal`):
```typescript
async disconnect(): Promise<void> {
  this.isConnected = false;
  this.activeTurnController?.abort();
  this.activeTurnController = null;
  await this.vad.disconnect();
  if (this.audioOutputContext && this.audioOutputContext.state !== "closed") {
    await this.audioOutputContext.close();
  }
  this.audioOutputContext = null;
  this.audioOutputAnalyser = null;
  this.sessionId = null;
  this.micEnabled = false;
  this.currentVolume = 0;
  this.conversation = [];
  const systemMessage = this.messages.find((m) => m.role === "system");
  this.messages = systemMessage ? [systemMessage] : [];
  this.setChatStatus("stopped");
  this.onDisconnect?.();
}
```

**setChatStatus/trimHistory helpers** (lines 489-514) — copy verbatim, no changes needed:
```typescript
protected setChatStatus(status: ChatStatus): void {
  if (this.chatStatus !== status) {
    this.chatStatus = status;
    this.onChatStatusChange?.(status);
  }
}

protected trimHistory(maxTurns = 10): void {
  const systemMessages = this.messages.filter((m) => m.role === "system");
  const nonSystem = this.messages.filter((m) => m.role !== "system");
  const maxNonSystem = maxTurns * 2;
  const trimmed = nonSystem.slice(-maxNonSystem);
  this.messages = [...systemMessages, ...trimmed];
}
```

**Cooldown generalization pattern (D-08, ORCH-04)** — RESEARCH's own worked example, already the exact diff to apply at both call sites in the new `runTurnFromText` (success path + catch path):
```typescript
// BEFORE (OpenAISTTTTSProvider.ts:472-474, 477-479 — hardcoded twice):
await this.audioRecorder.resume();
this.micEnabled = true;
await new Promise<void>((resolve) => setTimeout(resolve, 500));

// AFTER (GenericPipelineProvider — config-driven):
await this.vad.resume();
this.micEnabled = true;
await new Promise<void>((resolve) =>
  setTimeout(resolve, this.config.micReopenCooldownMs ?? 500)
);
```
Recommended: factor into a private `resumeWithCooldown()` helper since both call sites need it (RESEARCH explicitly recommends this).

**Error handling pattern** (lines 281-285, 375-380, 476-482) — apply at every new await boundary, with the additional `controller.signal.aborted` superseded-turn check (D-02/D-03):
```typescript
try {
  // ... awaited provider call (vad.connect / stt.transcribe / llm.complete / tts.speak / toolExecutor.execute)
} catch (error) {
  if (controller.signal.aborted) return; // superseded by barge-in — not a real error
  this.onError?.(error instanceof Error ? error : new Error(String(error)));
  this.setChatStatus("ready");
}
```

---

### Barge-in rewrite — `runTurn`/`runTurnFromText` (D-03, full interruption, NOT the `_isTurnActive` drop pattern)

**Analog (what NOT to copy forward):** `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:355-381` — the `if (this._isTurnActive) return;` early-return guard. D-03 explicitly reverses this.

**Secondary analog (partial precedent, still insufficient alone):** `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:359-363` (`interrupt()`) — only cancels, does not auto-restart with new content.

**New pattern to implement** (from RESEARCH Pattern 3, already a complete worked example):
```typescript
private activeTurnController: AbortController | null = null;

private async runTurn(wav: Blob): Promise<void> {
  // Full interruption, not drop (D-03): abort any active turn first, then proceed.
  if (this.activeTurnController) {
    this.activeTurnController.abort();
  }
  const controller = new AbortController();
  this.activeTurnController = controller;
  try {
    this.setChatStatus("thinking");
    const sttResult = await this.stt.transcribe(wav, { language: this.config.language });
    if (!sttResult.text || !sttResult.text.trim() || sttResult.rejected) {
      this.setChatStatus("ready");
      return;
    }
    await this.runTurnFromText(sttResult.text, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return; // superseded — not a real error
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
    this.setChatStatus("ready");
  } finally {
    if (this.activeTurnController === controller) {
      this.activeTurnController = null;
    }
  }
}
```
Critical: must check `controller.signal.aborted` (or `controller === this.activeTurnController`) before ANY side effect after an `await` boundary (mutating `conversation`, calling `setChatStatus`, pushing to `messages`) — see RESEARCH Pitfall 3 (best-effort cancellation means superseded work may still resolve).

---

### Multi-round tool-calling loop (D-04/D-05) — replaces single `chatClient.complete()` call

**Analog (what's being replaced):** `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:404-411` (single `await this.chatClient.complete(...)` call, no looping).

**Precedent for single-round tool dispatch (extend into a loop):** `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:577-606` (`handleToolCall`):
```typescript
private async handleToolCall(msg: any): Promise<void> {
  this.setChatStatus("thinking");
  try {
    const args = JSON.parse(msg.arguments);
    const result = await this.toolExecutor.execute(msg.name, args);
    this.onToolCall?.(msg.name, args, result);
    // ... sends function_call_output back over the data channel, then response.create
  } catch (error) {
    console.error("Tool execution error:", error);
    this.onError?.(error as Error);
  }
}
```
Note the `this.onToolCall?.(msg.name, args, result)` callback firing pattern — reuse this exact call shape (`onToolCall?.(name, args, result)`) inside the new loop's per-call dispatch.

**New bounded loop pattern to implement** (RESEARCH Pattern 4, complete worked example):
```typescript
const MAX_TOOL_ROUNDS = 5; // D-05

let round = 0;
let result: LLMCompletionResult;
while (true) {
  result = await this.llm.complete({
    messages: this.messages,
    tools: this.config.tools,
    signal: controller.signal,
  });

  if (result.toolCalls.length === 0) break; // final text reply (D-04 terminal condition)

  round++;
  if (round > MAX_TOOL_ROUNDS) {
    throw new Error(`Tool-calling loop exceeded ${MAX_TOOL_ROUNDS} rounds`); // D-05 error path
  }

  for (const call of result.toolCalls) {
    const toolResult = await this.toolExecutor.execute(call.name, call.args);
    this.onToolCall?.(call.name, call.args, toolResult);
    // Tool-result-to-history encoding convention — pick ONE and document it
    // (RESEARCH Open Question 2 / Pitfall 2 — no role:"tool" in the vendor-neutral type):
    this.messages.push({
      role: "user",
      content: `Tool ${call.name} result: ${JSON.stringify(toolResult)}`,
    });
  }
}
// result.text is now the final assistant reply.
```
`ToolExecutor.execute()` signature to call directly (no reimplementation, D-04 — already promoted to `@khaveeai/core`):
```typescript
// packages/core/src/types/tools.ts:73-91
async execute(name: string, args: any): Promise<ToolResult> {
  const fn = this.functions.get(name);
  if (!fn) {
    return { success: false, message: `Function '${name}' not found` };
  }
  try {
    return await fn(args);
  } catch (error) {
    return {
      success: false,
      message: `Error executing function: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
```

---

### `packages/providers/generic-stt-tts/src/adapters/OpenAIVADAdapter.ts` (service/adapter, event-driven)

**Analog:** `packages/providers/openai-stt-tts/src/AudioRecorder.ts` (full file, 137 lines — near-direct wrap per RESEARCH "Don't Hand-Roll")

**Class shape to wrap** (lines 44-135):
```typescript
class AudioRecorder {
  public onSpeechStart?: () => void;
  public onUtteranceReady?: (wav: Blob) => void;
  public onError?: (error: Error) => void;
  private vad: MicVAD | null = null;

  async connect(config: AudioRecorderConfig): Promise<void> { /* MicVAD.new() + start() */ }
  async disconnect(): Promise<void> { /* vad.destroy() */ }
  async pause(): Promise<void> { /* vad.pause() */ }
  async resume(): Promise<void> { /* vad.start() */ }
  isListening(): boolean { return this.vad !== null; }
}
```
This shape (event fields + connect/disconnect/pause/resume/isListening) maps 1:1 onto `VADProvider` (`packages/core/src/types/pipeline.ts` lines ~117-134) — the adapter is essentially a pass-through constructor wrapping an `AudioRecorder` instance, forwarding all 5 methods and 3 event fields unchanged. Construct `AudioRecorder`'s config (`baseAssetPath`, `onnxWASMBasePath`, `silenceThresholdMs`, `positiveSpeechThreshold`, `negativeSpeechThreshold`) from the adapter's own constructor args since `VADProvider.connect()` takes no arguments (unlike `AudioRecorder.connect(config)`).

**MAX_WAV_BYTES guard to preserve** (lines 23-25, 76-80) — do not drop this pitfall-hardened behavior:
```typescript
const MAX_WAV_BYTES = 24_000_000;
// ...
if (wav.size > MAX_WAV_BYTES) {
  this.onError?.(new Error("Recording too large"));
  return;
}
```

---

### `packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts` (service/adapter, request-response)

**Analog:** `packages/providers/openai-stt-tts/src/STTClient.ts` (full file, 87 lines)

**Method to wrap** (lines 35-84):
```typescript
async transcribe(
  wavBlob: Blob,
  endpoint: string,
  authToken: string,
  language?: string,
): Promise<string> {
  const form = new FormData();
  form.append("audio", wavBlob, "utterance.wav");
  if (language) form.append("language", language);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`STT proxy error: ${res.status} ${body}`);
  }
  // ... parses { transcript } or { data: { transcript } }, throws if missing
  return transcript;
}
```
`STTProvider.transcribe(audio, opts?)` (`pipeline.ts`) returns `STTResult { text, rejected? }`, not a bare string — the adapter's `transcribe()` must wrap `STTClient.transcribe()`'s string return in `{ text: transcript }` (no `rejected` heuristic exists in `STTClient` today, so omit the field — per `STTResult.rejected`'s doc comment, vendors that never reject simply omit it). Also set `readonly supportsStreaming = false` and `readonly supportsRejection = false` on the adapter class (capability flags required by the interface).

**Error pattern to preserve verbatim** (line 61):
```typescript
throw new Error(`STT proxy error: ${res.status} ${body}`);
```

---

### `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts` (service/adapter, request-response)

**Analog (structure/auth/error pattern):** `packages/providers/openai-stt-tts/src/ChatClient.ts` (full file, 98 lines)
**Analog (tool-shape mapping + signal precedent):** `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:382-432` (`configureSession`'s tool-parameter mapping) and `:577-606` (`handleToolCall`)

**CRITICAL FINDING (carried forward from RESEARCH, do not silently assume otherwise):** `ChatClient.complete()` has **zero tool-calling support** — it POSTs only `{messages, model, temperature}` and returns `{text, usage}` with no `tools` field sent and no `tool_calls` field parsed back. A thin wrapper that just reshapes `ChatClient`'s response is **not viable**. RESEARCH's recommendation (Open Question 1): the adapter should bypass `ChatClient` and issue its own `fetch()` directly against the same `chatProxyEndpoint`, since this keeps `openai-stt-tts` literally unmodified.

**Auth + fetch pattern to reuse from `ChatClient.complete()`** (lines 67-81, do NOT delegate to this method, but copy its shape into the adapter's own independent fetch call):
```typescript
const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  },
  body: JSON.stringify({ messages, model, temperature /* + tools, signal */ }),
});
if (!res.ok) {
  const body = await res.text();
  throw new Error(`Chat proxy error: ${res.status} ${body}`);
}
```
Add `signal: args.signal` to the `fetch()` call's options (D-01) and a `tools` field mapped to OpenAI's function-calling JSON shape in the request body, then parse `tool_calls` out of the response into `ToolCall[]` (`{id, name, args}` per `pipeline.ts`'s doc-comment mapping table at the top of the file).

**Tool-parameter mapping pattern to reference** (lines 388-416 of `OpenAIRealtimeProvider.ts`, shown above in full) — note this maps FROM `RealtimeTool.parameters` (per-property `required?: boolean`), but the new adapter maps FROM `Tool.parameters` (`pipeline.ts`/`tools.ts`'s top-level `required?: string[]` shape) which is already closer to OpenAI's wire format (top-level `required` array) — less reshaping needed than `OpenAIRealtimeProvider`'s version, just pass `tool.parameters` through near-directly since `Tool.parameters` already has `{type: "object", properties, required?: string[]}`.

**Result type to satisfy:** `LLMCompletionResult { text?: string; toolCalls: ToolCall[] }` (`pipeline.ts`) — note `toolCalls` is NOT optional (always an array, possibly empty), unlike `ChatClient.complete()`'s `usage` which IS optional.

**Tool-result-to-history round-trip convention (Pitfall 2):** the orchestrator pushes tool results into `this.messages` using the convention chosen in the orchestrator's loop (e.g. `{role: "user", content: "Tool <name> result: <json>"}`); `OpenAILLMAdapter.complete()` must parse that same convention back out when constructing its OpenAI request body, mapping it to OpenAI's actual `{role: "tool", tool_call_id, content}` wire shape. Document this mapping inline with a comment since it is new design surface not specified by either Phase 1 or CONTEXT.md — pick a parseable convention (e.g. a recognizable prefix string, or carry the `ToolCall.id` inside the content string) so the adapter can reconstruct `tool_call_id`.

---

### `packages/providers/generic-stt-tts/src/adapters/OpenAITTSAdapter.ts` (service/adapter, request-response + streaming playback)

**Analog:** `packages/providers/openai-stt-tts/src/TTSPlayer.ts` (full file, 156 lines)

**`speak()` method to wrap nearly verbatim** (lines 55-135):
```typescript
async speak(
  text: string,
  config: SpeakConfig,
  audioContext: AudioContext,
  onAudioData: (analyser: AnalyserNode, ctx: AudioContext) => void
): Promise<void> {
  this.abortController = new AbortController();
  let res: Response;
  try {
    res = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.authToken}` },
      body: JSON.stringify({ text, voice: config.voice, speed: config.speed, model: config.model, ...(config.instructions ? { ttsInstructions: config.instructions } : {}) }),
      signal: this.abortController.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    throw err;
  }
  if (!res.ok) throw new Error(`TTS proxy error: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  this.source = source;
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  source.connect(audioContext.destination);
  await audioContext.resume();
  if (audioContext.state === "running") onAudioData(analyser, audioContext);
  source.start();
  return new Promise<void>((resolve) => { source.onended = () => { this.source = null; resolve(); }; });
}

cancel(): void {
  this.abortController?.abort();
  this.abortController = null;
  try { this.source?.stop(); } catch { /* already ended — ignore */ }
  this.source = null;
}
```
`TTSProvider.speak(text, opts)` (`pipeline.ts`) takes a single `opts` object (`{audioContext, onAudioData?, voice?, speed?, signal?}`) rather than `TTSPlayer`'s 4 positional args — the adapter's `speak()` reshapes the call into the positional form `TTSPlayer.speak()` expects, AND (D-01) must accept `opts.signal` and use it INSTEAD OF (or merged with) `TTSPlayer`'s internally-created `this.abortController`. Since `TTSPlayer.speak()` creates its own internal `AbortController` and does not accept an external signal, the adapter has two choices: (a) call `TTSPlayer.cancel()` when `opts.signal` fires an abort event (`signal.addEventListener('abort', () => this.player.cancel())`), or (b) bypass `TTSPlayer.speak()`'s own fetch and pass `opts.signal` directly into a reimplemented fetch call. RESEARCH leans toward preserving `TTSPlayer` as-is and using approach (a) — listen for the external signal's abort event and forward to `TTSPlayer.cancel()` — since `TTSPlayer` is pitfall-hardened code that should not be duplicated (D-06 "Don't Hand-Roll").

**AbortError swallow pattern to preserve** (lines 82-88) — critical pitfall-hardened behavior, do not lose this:
```typescript
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    return;
  }
  throw err;
}
```

**AudioContext lifecycle guard to preserve** (relevant when the orchestrator owns the `AudioContext`, not the adapter — see `GenericPipelineProvider`'s `disconnect()` above):
```typescript
if (this.audioOutputContext && this.audioOutputContext.state !== "closed") {
  await this.audioOutputContext.close();
}
```

---

### `packages/providers/openai-stt-tts/src/index.ts` (MODIFIED — additive exports only, Pitfall 4)

**Analog:** itself, current state:
```typescript
export { OpenAISTTTTSProvider } from "./OpenAISTTTTSProvider";
export type { OpenAISTTTTSConfig } from "./OpenAISTTTTSProvider";
export { ToolExecutor } from "@khaveeai/core";
```
Add (additive only, no existing line removed/changed):
```typescript
export { AudioRecorder } from "./AudioRecorder";
export { STTClient } from "./STTClient";
export { ChatClient } from "./ChatClient";
export type { ChatMessage, ChatUsage, ChatResult } from "./ChatClient";
export { TTSPlayer } from "./TTSPlayer";
```
Flagged per RESEARCH Open Question 3 / Pitfall 4 — this is a file diff inside the nominally "untouched" `openai-stt-tts` package; confirmed by CONTEXT.md/RESEARCH as the only viable path (vs. duplicating the 4 classes or using a banned relative cross-package import) and treated as in-bounds since it changes zero behavior.

---

## Shared Patterns

### Error normalization
**Source:** `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:281-285, 375-380, 476-482`
**Apply to:** `GenericPipelineProvider` (every await boundary), all 4 adapter classes
```typescript
this.onError?.(error instanceof Error ? error : new Error(String(error)));
```
Extended this phase with a barge-in-aware variant (apply only inside `GenericPipelineProvider`'s turn methods, not inside the adapters themselves):
```typescript
if (controller.signal.aborted) return; // superseded — not a real error
this.onError?.(error instanceof Error ? error : new Error(String(error)));
```

### setChatStatus (change-detection guard)
**Source:** `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:489-494`
**Apply to:** `GenericPipelineProvider`
```typescript
protected setChatStatus(status: ChatStatus): void {
  if (this.chatStatus !== status) {
    this.chatStatus = status;
    this.onChatStatusChange?.(status);
  }
}
```

### AudioContext lifecycle guard (RESEARCH Pitfall 1/5)
**Source:** `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:311` (and inline comment at :230-244)
**Apply to:** `GenericPipelineProvider.disconnect()`
```typescript
if (this.audioOutputContext && this.audioOutputContext.state !== "closed") {
  await this.audioOutputContext.close();
}
```

### Tool dispatch via ToolExecutor (no reimplementation, D-04)
**Source:** `packages/core/src/types/tools.ts:73-91` (already promoted to `@khaveeai/core`)
**Apply to:** `GenericPipelineProvider`'s tool-calling loop
```typescript
const toolResult = await this.toolExecutor.execute(call.name, call.args);
this.onToolCall?.(call.name, call.args, toolResult);
```

### Backend-proxy auth header pattern (no API key in browser)
**Source:** `packages/providers/openai-stt-tts/src/STTClient.ts:51-57`, `ChatClient.ts:70-77`, `TTSPlayer.ts:67-81`
**Apply to:** All 3 HTTP-calling adapters (`OpenAISTTAdapter`, `OpenAILLMAdapter`, `OpenAITTSAdapter`)
```typescript
headers: {
  "Content-Type": "application/json", // omit for multipart/FormData (STT)
  Authorization: `Bearer ${authToken}`,
},
```

### Package scaffolding (package.json / tsconfig.json / vitest.config.ts)
**Source:** `packages/providers/openai-stt-tts/{package.json,tsconfig.json,vitest.config.ts}`
**Apply to:** All 3 new `packages/providers/generic-stt-tts/*` config files — copy verbatim except `name` (`@khaveeai/providers-generic-stt-tts`), `description`, and remove the `@ricky0123/vad-web`/`openai` direct dependencies (those now live behind the adapters/`openai-stt-tts`, not duplicated as direct deps — confirm with planner whether `@khaveeai/providers-openai-stt-tts` becomes a new `workspace:*` dependency of this package for the additive exports in Pitfall 4 above).

## No Analog Found

None — every file in this phase's scope has at least a role-match analog. The one file with a partial/imperfect match is `OpenAILLMAdapter.ts` (no existing class has both backend-proxy auth AND tool-calling AND signal-threading together — `ChatClient.ts` has the auth/proxy shape but no tool-calling, `OpenAIRealtimeProvider.ts` has the tool-shape mapping but a completely different transport, WebRTC data channel, not fetch). This is flagged above under that file's Pattern Assignment with the explicit recommendation to combine both analogs' relevant fragments rather than treat either as a complete template.

## Metadata

**Analog search scope:** `packages/core/src/types/{pipeline,tools,realtime,providers,conversation,audio}.ts`, `packages/providers/openai-stt-tts/src/**`, `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`, `packages/core/src/__tests__/ToolExecutor.test.ts`
**Files scanned:** 14 read directly (full or targeted-range) + 2 directory listings (`packages/core/src/types/`, `packages/providers/openai-stt-tts/src/__tests__/`)
**Pattern extraction date:** 2026-06-18
