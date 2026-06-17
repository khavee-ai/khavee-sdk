# Architecture Research

**Domain:** Composable voice AI pipeline (STT/LLM/TTS orchestration), pipecat-style, for a TypeScript SDK calling sibling Python HTTP inference services
**Researched:** 2026-06-17
**Confidence:** HIGH (pipecat core abstractions, verified via official docs + source) / MEDIUM (HTTP integration patterns, verified via general Node/FastAPI best practices, not pipecat-specific since pipecat itself is WebSocket/streaming-first)

## Standard Architecture

### System Overview

Pipecat's actual architecture is more granular than "4 swappable classes." It separates **transport/turn-detection** from **pipeline stage processors**, and separates **pipeline composition** from **pipeline execution lifecycle**. This is the key structural insight for khavee-sdk's `generic-stt-tts` package:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Orchestration Layer                                │
│  PipelineRunner (process lifecycle: signals, cleanup)                      │
│  PipelineTask  (frame queueing, cancellation, event handlers)              │
└───────────────────────────────┬────────────────────────────────────────────┘
                                 │ runs
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         Pipeline (composition)                             │
│  Linked list of FrameProcessors; each .link()s to next, exposes .next/.prev│
│                                                                              │
│  [VAD/turn-detect] → [STTProcessor] → [ContextAggregator(user)]            │
│       → [LLMProcessor] → [ContextAggregator(assistant)] → [TTSProcessor]   │
└───────────┬───────────────┬────────────────┬────────────────┬─────────────┘
            │ implements     │ implements      │ implements      │ implements
            ▼                 ▼                ▼                ▼
   ┌────────────────┐ ┌───────────────┐ ┌────────────────┐ ┌────────────────┐
   │ VADAnalyzer     │ │ STTService    │ │ LLMService     │ │ TTSService     │
   │ (plugged into   │ │ run_stt()     │ │ run_llm() +    │ │ run_tts()      │
   │ transport/      │ │ audio frame → │ │ register_      │ │ text frame →   │
   │ aggregator, not │ │ text frame    │ │ function()     │ │ audio frame    │
   │ a pipeline stage)│ │               │ │                │ │                │
   └────────────────┘ └───────────────┘ └────────────────┘ └────────────────┘
```

**Critical insight (HIGH confidence, verified against official docs):** VAD is **not** a peer pipeline stage alongside STT/LLM/TTS in pipecat. `SileroVADAnalyzer` is a plugin passed into `LLMUserAggregatorParams`/transport input, used purely for turn-taking and interruption-trigger detection. It does not transform Frame → Frame the way STTService/LLMService/TTSService do. This matters directly for khavee-sdk: `VADProvider` is correctly a *peer interface* in your design (since you POST whole VAD-segmented utterances, VAD's job — turn boundary detection — is load-bearing, not cosmetic), but it should **not** be designed as "just another pipeline stage with the same shape as STT/LLM/TTS." It has a fundamentally different contract: it doesn't transform content, it segments a continuous stream into discrete units and fires lifecycle events (speech-start, utterance-ready). Your existing `AudioRecorder.ts` already gets this right — it's an event emitter (`onSpeechStart`, `onUtteranceReady`, `onError`), not a `transform(input): output` function. Preserve that shape as `VADProvider`, don't force it into the same `process(input): Promise<output>` shape as STT/LLM/TTS.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `FrameProcessor` (pipecat) | Single-purpose transform with a uniform `process_frame(frame, direction)` method; pushes frames downstream/upstream rather than returning values | Base class every service/aggregator extends |
| `Pipeline` (pipecat) | Links processors into a chain (`.link()`), nothing more — composition only, no execution | Built once per session from an array |
| `PipelineTask` (pipecat) | Owns frame queue, cancellation, interruption propagation, event handlers (`on_error`, etc.) | One per active conversation/session |
| `PipelineRunner` (pipecat) | Process-level lifecycle: signal handling (SIGINT/SIGTERM), GC, calls `task.run()` | One per process, not per session |
| `STTService`/`LLMService`/`TTSService` (pipecat) | Vendor-specific `run_stt`/`run_llm`/`run_tts` implementations; everything else (frame plumbing, settings, audio buffering) is shared in the base class | Subclass per vendor |
| `VADAnalyzer` (pipecat) | Turn-boundary/interruption detection; plugged into transport or context aggregator, not a chained stage | `SileroVADAnalyzer`, WebRTC VAD |
| Context aggregator (pipecat) | Accumulates conversation history (user turn / assistant turn) as a frame processor, decoupled from the LLM service itself | `LLMContextAggregatorPair` |

This decomposition is more granular than khavee-sdk needs for a turn-based (not full-duplex streaming) pipeline — pipecat's frame/queue/direction machinery exists to support continuous bidirectional audio streams with mid-utterance interruption. khavee-sdk's actual transport reality (VAD-segmented utterance → whole-blob POST → whole-response) is closer to pipecat's *conceptual* service boundaries (`STTService`, `LLMService`, `TTSService` as the vendor-swappable unit) without needing the full `Frame`/`FrameProcessor`/`FrameDirection` queueing machinery. Adopt the **boundary philosophy**, not the **literal frame-passing mechanism**.

## Recommended Project Structure

```
packages/
├── core/src/
│   ├── types/
│   │   ├── pipeline.ts          # NEW: VADProvider, STTProvider, LLMProvider, TTSProvider interfaces
│   │   ├── tools.ts             # NEW (or extend existing): Tool = {name, description, parameters, handler}
│   │   └── realtime.ts          # UNCHANGED: RealtimeProvider stays the outer contract both
│   │                             #   OpenAISTTTTSProvider and the new generic pipeline provider implement
│   └── pipeline/
│       ├── ToolExecutor.ts       # PROMOTED from openai-stt-tts/openai-realtime (dedup target)
│       └── PipelineOrchestrator.ts  # NEW: generic turn orchestration, vendor-agnostic
└── providers/
    ├── generic-stt-tts/src/      # NEW package — the focus of this milestone
    │   ├── GenericSTTTTSProvider.ts   # implements RealtimeProvider; composes {vad, stt, llm, tts}
    │   ├── index.ts
    │   └── __tests__/
    ├── thonburian-stt/src/       # NEW: STTProvider adapter calling thonburian-stt service over HTTP
    │   ├── ThonburianSTTProvider.ts
    │   └── index.ts
    ├── jai-tts/src/               # NEW: TTSProvider adapter calling jai-tts service over HTTP
    │   ├── JaiTTSProvider.ts
    │   └── index.ts
    └── openai-stt-tts/             # UNTOUCHED this milestone
```

### Structure Rationale

- **Interfaces live in `@khaveeai/core`, not in `generic-stt-tts`:** Any future vendor adapter (Bedrock STT, Gemini TTS, a different LLM) must depend only on `@khaveeai/core`, never on `generic-stt-tts`, mirroring the existing convention ("provider packages depend only on `@khaveeai/core`, never on each other"). If `VADProvider`/`STTProvider`/`LLMProvider`/`TTSProvider` lived inside `generic-stt-tts`, every vendor adapter package would need to depend on the orchestrator package just to get the types — backwards dependency direction.
- **The orchestrator (turn-loop logic) is generic and vendor-agnostic — it belongs in `@khaveeai/core` or its own provider package, not duplicated per vendor combination:** This is the direct generalization of `OpenAISTTTTSProvider`'s `runTurn`/`runTurnFromText`. One orchestrator class, constructed with `{ vad, stt, llm, tts }` instances, replaces N hand-written monolithic provider classes (one per vendor combination).
- **`thonburian-stt`/`jai-tts` adapter packages are thin:** Each contains only an HTTP client implementing one interface (`STTProvider` or `TTSProvider`) — no orchestration logic, no VAD, no tool-calling. This matches the "small vendor-specific stage classes per new package" pattern your own STRUCTURE.md already recommends.
- **`ToolExecutor` promotion to `packages/core/src/pipeline/`** rather than `types/`: it's executable logic (a registry + dispatch), not a type — keep the types/logic split that already exists (`types/` vs `client/` vs `tools/`).

## Architectural Patterns

### Pattern 1: Interface-per-stage with uniform async method signature, NOT frame/queue machinery

**What:** Define `STTProvider`, `LLMProvider`, `TTSProvider` as plain async-method interfaces (`transcribe(audio): Promise<Transcript>`, `complete(messages, tools): Promise<CompletionResult>`, `speak(text): Promise<AudioResult>`). Define `VADProvider` separately as an event-emitter interface (`start()`, `stop()`, `onSpeechStart`, `onUtteranceReady(blob)`, `onError`), matching what `AudioRecorder.ts` already does.

**When to use:** When the transport reality is "buffer a complete utterance, send it whole, get a complete response back" — i.e. exactly this project's HTTP-chunked reality, not pipecat's continuous-frame-stream reality.

**Trade-offs:** Loses pipecat's ability to interrupt mid-TTS-token-stream or mid-transcription (not needed here — neither Whisper nor F5-TTS streams partial results). Gains massive simplicity: no frame queue, no direction enum, no cancellation-of-partial-frame logic. This is the right trade for the stated "no true streaming ASR/TTS" constraint.

**Example:**
```typescript
// packages/core/src/types/pipeline.ts
export interface STTProvider {
  transcribe(audio: Blob, opts?: { language?: string }): Promise<{ text: string }>;
}

export interface LLMProvider {
  complete(
    messages: ChatMessage[],
    tools?: Tool[],
  ): Promise<{ text: string; toolCalls?: ToolCall[]; usage?: UsageReport }>;
}

export interface TTSProvider {
  speak(text: string, opts?: { voice?: string }): Promise<{ audio: ArrayBuffer; mimeType: string }>;
}

export interface VADProvider {
  start(): Promise<void>;
  stop(): void;
  onSpeechStart?: () => void;
  onUtteranceReady?: (audio: Blob) => void;
  onError?: (error: Error) => void;
}
```

### Pattern 2: Generic orchestrator composed from stage instances (the pipecat `Pipeline` analog)

**What:** One class (`GenericSTTTTSProvider` or a `PipelineOrchestrator` in core) takes `{ vad, stt, llm, tts, tools }` in its constructor and implements the turn loop generically: `vad.onUtteranceReady` → `stt.transcribe()` → append to history → `llm.complete()` (loop while `toolCalls` present, dispatching through `ToolExecutor`) → `tts.speak()` → play. This directly mirrors pipecat's `Pipeline([stt, context_aggregator, llm, tts])` composition, minus the frame queue.

**When to use:** Always, for this package — it's the entire point of the milestone (replacing N monolithic provider classes with 1 orchestrator + N small stage adapters).

**Trade-offs:** The orchestrator must still implement the full `RealtimeProvider` interface (connect/disconnect, mic control, events, `getAudioAnalyser()`) since that's the seam `@khaveeai/react`'s `useRealtime` depends on — so it isn't *purely* generic plumbing, it also owns the turn-state machine, history trimming, and mic-cooldown logic currently embedded in `OpenAISTTTTSProvider`. Lift that logic largely verbatim; only the `new AudioRecorder()`/`new STTClient()`/`new ChatClient()`/`new TTSPlayer()` constructor lines become constructor parameters.

**Example:**
```typescript
export class GenericSTTTTSProvider implements RealtimeProvider {
  constructor(private deps: {
    vad: VADProvider;
    stt: STTProvider;
    llm: LLMProvider;
    tts: TTSProvider;
    tools?: Tool[];
  }, private config: GenericSTTTTSConfig) {}

  async connect() {
    this.deps.vad.onUtteranceReady = (wav) => this.runTurn(wav);
    await this.deps.vad.start();
  }

  private async runTurn(wav: Blob) {
    const { text } = await this.deps.stt.transcribe(wav, { language: this.config.language });
    await this.runTurnFromText(text);
  }
  // runTurnFromText: same shape as OpenAISTTTTSProvider's, but calls
  // this.deps.llm.complete(...) / this.deps.tts.speak(...) instead of concrete clients
}
```

### Pattern 3: Tool-calling as a core LLMProvider capability with provider-agnostic schema

**What:** `Tool = { name, description, parameters: JSONSchema, handler: (args) => Promise<unknown> }` lives in `@khaveeai/core`. Every `LLMProvider.complete()` accepts `tools?: Tool[]` and returns `toolCalls?: ToolCall[]` in a normalized shape; a shared `ToolExecutor` (promoted from the duplicated files) dispatches `toolCalls` to `handler`s and the orchestrator feeds results back into `messages` before calling `complete()` again.

**When to use:** Always — this matches pipecat's `FunctionSchema` (verified, HIGH confidence: pipecat's own `FunctionSchema` is `{name, description, properties, required, handler}`, essentially identical to the project's stated plain-object design) and is the standard shape every vendor's function-calling API (OpenAI, Anthropic, Gemini, Bedrock) already converges on — JSON Schema `properties`/`required` is the lowest common denominator.

**Trade-offs:** None significant — this is the de facto industry-standard shape; building a different one would only hurt vendor portability.

```typescript
export interface Tool {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}
```

## Data Flow

### Request Flow (turn-based, HTTP-chunked)

```
[User speaks]
    ↓ (continuous mic stream)
[VADProvider: AudioRecorder] --onUtteranceReady(wav: Blob)--→ [Orchestrator.runTurn]
    ↓
[STTProvider.transcribe(wav)] --HTTP POST multipart/form-data--→ [thonburian-stt service]
    ↓ {text}
[Orchestrator: append user turn to history]
    ↓
[LLMProvider.complete(messages, tools)] --HTTP POST JSON--→ [vendor LLM API]
    ↓ {text, toolCalls?}
[if toolCalls: ToolExecutor.dispatch → handler() → append tool result → complete() again]
    ↓ {text: final}
[Orchestrator: append assistant turn to history, fire onUsageReport]
    ↓
[TTSProvider.speak(text)] --HTTP POST JSON--→ [jai-tts service]
    ↓ {audio: ArrayBuffer, mimeType}
[Orchestrator: decode via Web Audio API, play through AnalyserNode (lipsync) + destination]
    ↓
[onAudioData fires → chatStatus: "speaking"] → playback ends → mic resumes after cooldown
```

### State Management

State management is unchanged from the existing pattern — no new central store needed:

```
[Orchestrator instance: conversation[], messages[], chatStatus, _isTurnActive]
    ↓ (event callbacks: onMessage, onChatStatusChange, onAudioData, onError, onUsageReport)
[useRealtime hook] ←→ [React state] → [VRMAvatar / UI]
```

### Key Data Flows

1. **Audio in (browser → Python service):** `VADProvider` produces a WAV `Blob` in-browser. `STTProvider` adapter (e.g. `ThonburianSTTProvider`) POSTs it as `multipart/form-data` (matches existing `STTClient.ts` convention) to the Python service's `/transcribe`-style endpoint, receives `{ text: string }` JSON back.
2. **Text in/out (browser ↔ vendor LLM):** Unchanged shape from `ChatClient.ts` — JSON in, JSON out, just behind the new `LLMProvider` interface instead of a concrete class.
3. **Text in, audio out (browser → Python service):** `TTSProvider` adapter (e.g. `JaiTTSProvider`) POSTs `{ text: string, voice?: string }` JSON to the Python service's `/synthesize`-style endpoint, receives a binary audio response (`audio/wav`) back, decoded via Web Audio API exactly as `TTSPlayer.ts` already does.
4. **Tool calls (in-process, no network beyond the LLM call itself):** `LLMProvider.complete()` returns `toolCalls`; `ToolExecutor` looks up registered `handler`s and invokes them locally (or they may themselves make HTTP calls — that's the tool author's concern, not the pipeline's).

## Cross-Language HTTP Integration (TypeScript SDK ↔ Python services)

This is not a pipecat pattern (pipecat is Python-native end-to-end and typically uses WebSocket streaming to vendor APIs) — these recommendations come from general Node↔FastAPI HTTP integration practice, MEDIUM confidence, cross-checked against multiple sources.

### Request/response shape

- **STT (`thonburian-stt`):** `POST /transcribe`, `Content-Type: multipart/form-data` with a single `file` field (WAV bytes) — this matches the existing `STTClient.ts` convention exactly, so `ThonburianSTTProvider` can reuse the same request-building code path. Response: `{ "text": "...", "language"?: "th" }` JSON, `200 OK`. FastAPI side: `UploadFile` parameter, `transformers.pipeline(..., chunk_length_s=...)` for long audio, returns `JSONResponse`.
- **TTS (`jai-tts`):** `POST /synthesize`, `Content-Type: application/json` body `{ "text": "...", "voice"?: "default" }` (omit reference-audio/reference-text from the public HTTP contract — bake the bundled default Thai voice into the service so the SDK-facing contract stays "text in, audio out" simple, per the beginner-DX constraint). Response: raw `audio/wav` bytes with `Content-Type: audio/wav`, or alternatively base64-encoded JSON if the consuming app's infra makes binary responses awkward — prefer raw binary (`FileResponse`/`StreamingResponse` in FastAPI) since `TTSPlayer.ts` already expects to `fetch()` and `arrayBuffer()` a binary body, avoiding a base64 decode step.
- **Audio encoding:** WAV (PCM) both directions — already the format `AudioRecorder.ts` produces and `TTSPlayer.ts` consumes; no new codec work needed. Whisper and F5-TTS both natively operate on PCM/WAV, so no transcoding is needed at either Python service boundary.

### Error propagation

- Python services should return structured JSON error bodies even on failure (`{ "error": "...", "detail": "..." }`) with appropriate HTTP status codes (422 for bad input, 500 for model/inference failure, 503 if model still loading) rather than raw FastAPI tracebacks — easy to do via a FastAPI exception handler.
- TypeScript adapters should follow the existing `STTClient.ts`/`ChatClient.ts` convention: check `res.ok`, throw a plain `Error` with status code + body text baked into the message. Do not introduce a typed error hierarchy in this milestone — it would be inconsistent with the rest of the codebase's "plain Error, normalized at the provider boundary" pattern (verified in `.planning/codebase/ARCHITECTURE.md`'s Error Handling section).
- The orchestrator's existing try/catch-at-lifecycle-boundary pattern (normalize to `Error`, forward via `onError?.()`, reset `chatStatus` to a safe state in `finally`) needs no redesign — it already treats STT/LLM/TTS calls as "any of these can throw," which is exactly what HTTP-backed Python services will do (network failure, timeout, 500, malformed response).

### Timeouts

- Use `AbortSignal.timeout(ms)` (native, no extra dependency) per-call in each adapter, with stage-appropriate defaults: STT (Whisper inference on a VAD-segmented utterance, typically a few seconds of audio) ~15-30s; TTS (F5-TTS zero-shot cloning is comparatively slow) ~30-60s. Make both configurable in each provider's config type, since cold-start/model-loading on first request will be much slower than steady-state — consider a longer timeout specifically for a service's first call after startup, or have the Python service expose a `/health` or warm-up endpoint the demo app can ping before allowing user interaction.
- Distinguish abort-due-to-timeout from abort-due-to-deliberate-cancel (the orchestrator's existing `cancel()`/interrupt path) the same way `TTSPlayer.speak()` already does for its own `AbortError` — re-use that pattern rather than inventing a new one, since the LLM/STT/TTS provider adapters now have the same "this fetch might be deliberately aborted by the user interrupting" requirement that `TTSPlayer` already solved.

### What pipecat does differently here (and why khavee-sdk shouldn't copy it)

Pipecat's vendor integrations (Deepgram, Cartesia, ElevenLabs, etc.) are predominantly WebSocket-based for true streaming partial results, with documented reconnection/backoff logic for idle timeouts and dropped connections (verified: GitHub issues #1818, #3699 describe exactly this complexity). Since neither `thonburian-stt` nor `jai-tts` support incremental streaming, none of that reconnection/backoff machinery is needed — request/response HTTP with a sane timeout and a thrown `Error` is the entire error-handling surface required. Resist the temptation to over-build retry/reconnect logic modeled on pipecat's WebSocket services; it solves a problem this project doesn't have.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single demo/dev usage | Current design is sufficient: one orchestrator instance per browser session, Python services run as single-process FastAPI apps with the model loaded in memory at startup. |
| Multiple concurrent users hitting shared Python services | Both Whisper and F5-TTS inference are GPU/CPU-bound and not trivially concurrent per-process — the bottleneck is the Python service, not the TypeScript SDK. Add a request queue or run multiple worker processes behind a load balancer in `thonburian-stt`/`jai-tts` (out of scope for this milestone, but the HTTP contract being stateless/whole-utterance-in-whole-response-out makes horizontal scaling of the Python services straightforward later). |
| High call volume needing partial/streaming responses | Would require swapping the underlying models (e.g. a streaming-capable Whisper variant, or a TTS model with chunked synthesis) — explicitly out of scope per PROJECT.md; the interfaces (`transcribe(): Promise<Transcript>`, `speak(): Promise<AudioResult>`) would need to become async generators/streams at that point, a breaking interface change, not a config change. |

### Scaling Priorities

1. **First bottleneck:** Python service inference latency (especially `jai-tts`'s F5-TTS zero-shot cloning, generally slower than STT). Mitigate with a `/health`/warm-up endpoint and clear timeout configuration, not architecture changes.
2. **Second bottleneck:** Browser-side `AudioContext`/Web Audio decode of larger TTS responses — already handled by the existing `TTSPlayer.ts` pattern, no new work needed.

## Anti-Patterns

### Anti-Pattern 1: Forcing VADProvider into the same request/response shape as STT/LLM/TTS

**What people do:** Define `VADProvider` as `process(audioChunk): Promise<VADResult>` to look symmetrical with the other three interfaces.

**Why it's wrong:** VAD's job is continuous stream segmentation with lifecycle events (speech-start, utterance-ready, silence), not a single request/response transform. Pipecat itself treats VAD as a plugin into the transport/aggregator layer, not a peer `*Service`. Forcing a `process()` shape would require the orchestrator to poll or chunk audio unnaturally, and would diverge from the already-working `AudioRecorder.ts` event-emitter design.

**Do this instead:** Keep `VADProvider` as an event-emitter/lifecycle interface (`start()`, `stop()`, `onUtteranceReady`), matching `AudioRecorder.ts`'s existing shape almost exactly — just extract its public surface into a `@khaveeai/core` interface.

### Anti-Pattern 2: Building pipecat's full Frame/FrameDirection/queue machinery for a turn-based, non-streaming pipeline

**What people do:** See "frame processor" and "pipeline" in pipecat's docs and conclude the generalized provider needs a `Frame` class hierarchy, a `FrameDirection` enum, and per-processor input/output queues.

**Why it's wrong:** That machinery exists in pipecat to support continuous bidirectional frame flow with mid-stream interruption across many concurrent processors. khavee-sdk's actual transport reality — VAD-segmented whole utterances POSTed to HTTP endpoints that return whole responses — has no mid-stream frames to interrupt. Building frame/queue infrastructure for this would be substantial unnecessary complexity with no corresponding capability gained (Whisper and F5-TTS don't emit partial results to interrupt mid-stream anyway).

**Do this instead:** Adopt pipecat's *boundary philosophy* (one swappable interface per pipeline stage, generic orchestrator composes them) without its *frame-passing mechanism*. Plain async methods (`transcribe`, `complete`, `speak`) returning complete results are sufficient and match the project's actual constraints.

### Anti-Pattern 3: Flat config inheritance across all four interfaces

**What people do:** One `GenericSTTTTSConfig extends RealtimeConfig` with ~20 flattened fields (`sttEndpoint`, `sttModel`, `ttsEndpoint`, `ttsVoice`, `vadThreshold`, ...), exactly the existing `OpenAISTTTTSConfig` anti-pattern already flagged in `.planning/codebase/ARCHITECTURE.md`.

**Why it's wrong:** Each new vendor combination grows the flat type further; a non-VAD STT vendor has no use for VAD fields, a non-streaming TTS vendor has no use for streaming fields — there's no way to express "this STT implementation's config" independently of "this TTS implementation's config" when they need genuinely different shapes (e.g. `ThonburianSTTConfig` needs `{ endpoint, language }`, `JaiTTSConfig` needs `{ endpoint, voice, timeoutMs }`).

**Do this instead:** Compose, don't flatten — each `*Provider` implementation owns its own config type, constructed independently and passed into the orchestrator as already-instantiated objects: `new GenericSTTTTSProvider({ vad: new AudioRecorder(vadConfig), stt: new ThonburianSTTProvider(sttConfig), llm: ..., tts: ... }, orchestratorConfig)`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| `thonburian-stt` (Python/FastAPI, Whisper) | `POST /transcribe`, multipart WAV in, JSON `{text}` out | Cold-start model load is slow; expose a warm-up/health endpoint. Whisper's `chunk_length_s` handles longer utterances but VAD segmentation should keep utterances short already. |
| `jai-tts` (Python/FastAPI, F5-TTS) | `POST /synthesize`, JSON `{text}` in, binary `audio/wav` out | Bundle the default reference voice server-side so the public HTTP contract stays simple (text in, audio out) even though the underlying model requires reference audio + reference text for zero-shot cloning. Synthesis latency likely the slowest link in the pipeline — needs the most generous timeout. |
| Vendor LLM APIs (OpenAI, future Bedrock/Gemini) | JSON request/response via `LLMProvider.complete()`, same shape as existing `ChatClient.ts` | Tool-calling schema must normalize to the lowest-common-denominator JSON Schema shape (matches pipecat's `FunctionSchema`) so future Bedrock/Gemini adapters need no interface changes, only translation inside their own `complete()` implementation. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `GenericSTTTTSProvider` ↔ `VADProvider`/`STTProvider`/`LLMProvider`/`TTSProvider` | Direct method calls + event callbacks, constructor-injected | This is the seam being generalized this milestone; orchestrator never imports a concrete vendor class. |
| `GenericSTTTTSProvider` ↔ `@khaveeai/react`'s `useRealtime` | Implements `RealtimeProvider` unchanged | No changes needed downstream in `@khaveeai/react` — the new orchestrator is just another `RealtimeProvider` implementation, same as `OpenAISTTTTSProvider` and `OpenAIRealtimeProvider` today. |
| `ThonburianSTTProvider`/`JaiTTSProvider` ↔ Python services | HTTP fetch with `AbortSignal.timeout()`, JSON/multipart/binary per above | No shared client library between TS and Python; plain HTTP contract is the only coupling, by design (stated language-boundary constraint). |
| `LLMProvider.complete()` ↔ `ToolExecutor` | Orchestrator mediates: gets `toolCalls` from `complete()`, calls `ToolExecutor.dispatch()`, feeds results back into next `complete()` call | `ToolExecutor` itself has no dependency on any specific `LLMProvider` implementation — it only needs the normalized `ToolCall`/`Tool` shapes from `@khaveeai/core`. |

## Suggested Build Order

Given the dependency graph above, the natural build order is:

1. **Core interfaces first** (`@khaveeai/core`: `VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`, `Tool`, `ToolCall` types) — everything else depends on these, nothing depends on the orchestrator or adapters yet.
2. **`ToolExecutor` promotion/dedup** into `@khaveeai/core`, adapted to the new `LLMProvider`-normalized `ToolCall` shape — independent of the orchestrator, can be done in parallel with step 1, needed before step 3's tool-calling loop.
3. **Generic orchestrator** (`GenericSTTTTSProvider` in the new `generic-stt-tts` package) — depends on step 1's interfaces and step 2's `ToolExecutor`. Can initially be built/tested against the *existing* OpenAI-backed concrete helper classes adapted to the new interfaces (reuse `STTClient`/`ChatClient`/`TTSPlayer` logic as the first interface implementations) before any new Python service exists — this de-risks the orchestrator independent of the Python services being ready.
4. **Python services** (`thonburian-stt`, `jai-tts`) — independent of the TypeScript work entirely; can be built in parallel with steps 1-3 once the HTTP contract (request/response shape above) is agreed.
5. **`ThonburianSTTProvider`/`JaiTTSProvider` adapters** — depend on step 1's interfaces (`STTProvider`/`TTSProvider`) and step 4's services being reachable; thin HTTP clients, the simplest layer in the whole milestone.
6. **End-to-end demo wiring** — depends on everything above; first real proof that mixed-vendor (Thonburian STT + any LLM + JaiTTS) composition works through the generic orchestrator.

This ordering lets steps 1-3 (all TypeScript, all in this repo) proceed without waiting on the Python services, and lets step 4 (Python, separate repos) proceed in parallel without waiting on the TypeScript work — they only need to agree on the HTTP contract up front.

## Sources

- [Pipeline & Frame Processing — Pipecat official docs](https://docs.pipecat.ai/guides/learn/pipeline) — HIGH confidence, official docs
- [pipecat/src/pipecat/processors/frame_processor.py — GitHub source](https://github.com/pipecat-ai/pipecat/blob/main/src/pipecat/processors/frame_processor.py) — HIGH confidence, primary source
- [PipelineTask — Pipecat docs](https://docs.pipecat.ai/server/pipeline/pipeline-task) — HIGH confidence, official docs
- [pipecat/src/pipecat/pipeline/runner.py — GitHub source](https://github.com/pipecat-ai/pipecat/blob/main/src/pipecat/pipeline/runner.py) — HIGH confidence, primary source
- [Function Calling — Pipecat docs](https://docs.pipecat.ai/pipecat/learn/function-calling) — HIGH confidence, official docs, directly validates the project's planned `{name, description, parameters, handler}` tool shape
- [SileroVADAnalyzer — Pipecat docs](https://docs.pipecat.ai/server/utilities/audio/silero-vad-analyzer) — HIGH confidence, official docs, confirms VAD is transport/aggregator-level, not a peer pipeline stage
- [stt_service / tts_service / llm_service — pipecat-ai reference docs](https://reference-server.pipecat.ai/en/stable/api/pipecat.services.html) — MEDIUM-HIGH confidence, official reference docs
- GitHub issues #1818 (CartesiaTTSService idle timeout), #3699 (SarvamSTTService WebSocket reconnection), #2876 (ErrorFrame on init failure) — MEDIUM confidence, real-world issue reports illustrating WebSocket-specific complexity not applicable to khavee-sdk's HTTP-based design
- General Node.js `AbortController`/`AbortSignal.timeout()` and FastAPI `UploadFile`/`StreamingResponse` best practices — MEDIUM confidence, multiple cross-checked sources, not pipecat-specific
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/PROJECT.md` — existing codebase analysis, ground truth for current state

---
*Architecture research for: composable voice AI pipeline (pipecat-style STT/LLM/TTS provider generalization)*
*Researched: 2026-06-17*
