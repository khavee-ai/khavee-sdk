<!-- refreshed: 2026-06-17 -->
# Architecture

**Analysis Date:** 2026-06-17

## System Overview

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                          React Integration Layer                          │
│  `packages/react/src`                                                      │
│  KhaveeProvider (context) · VRMAvatar/GLBAvatar (3D render) · useRealtime  │
└───────────────────────────────┬─────────────────────────────────────────--┘
                                 │ holds a single `RealtimeProvider` instance
                                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                       Provider Contract (abstraction)                      │
│  `packages/core/src/types/providers.ts`                                    │
│  `packages/core/src/types/realtime.ts`                                     │
│  interface RealtimeProvider extends RealtimeEvents                         │
│  interface LLMProvider / TTSProvider (legacy, non-realtime path)           │
└───────────────┬───────────────────────────────┬───────────────────────────┘
                │ implements                     │ implements
                ▼                                 ▼
┌──────────────────────────────────┐  ┌──────────────────────────────────────┐
│ OpenAIRealtimeProvider            │  │ OpenAISTTTTSProvider                  │
│ `packages/providers/              │  │ `packages/providers/                  │
│   openai-realtime/src/            │  │   openai-stt-tts/src/                 │
│   OpenAIRealtimeProvider.ts`      │  │   OpenAISTTTTSProvider.ts`            │
│                                    │  │                                        │
│ WebRTC peer connection to          │  │ Orchestrates 4 internal helpers       │
│ OpenAI Realtime API (single        │  │ in a turn-based pipeline:             │
│ vendor-owned voice loop)           │  │  AudioRecorder → STTClient →          │
│                                    │  │  ChatClient → TTSPlayer               │
└──────────────────────────────────┘  └───────────┬──────────────┬─────────────┘
                                                    │              │
                                     ┌──────────────┘              └───────────┐
                                     ▼                                         ▼
                       ┌─────────────────────────────┐      ┌──────────────────────────────┐
                       │ AudioRecorder (VAD)          │      │ STTClient / ChatClient /      │
                       │ `AudioRecorder.ts`            │      │ TTSPlayer                     │
                       │ wraps @ricky0123/vad-web      │      │ `STTClient.ts` `ChatClient.ts`│
                       │ MicVAD; produces WAV blobs    │      │ `TTSPlayer.ts`                │
                       └─────────────────────────────┘      │ fetch() calls to backend       │
                                                              │ proxy endpoints (Whisper,      │
                                                              │ Chat Completions, TTS)         │
                                                              └────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `RealtimeProvider` interface | Single contract every voice/chat backend must implement (connect/disconnect, messaging, mic control, audio analyser, events) | `packages/core/src/types/realtime.ts` |
| `RealtimeEvents` interface | Event callback surface (onConnect, onMessage, onChatStatusChange, onAudioData, etc.) mixed into `RealtimeProvider` | `packages/core/src/types/realtime.ts` |
| `Provider` (base marker interface) | Minimal `{ name, version }` shape; not actually used by any current provider class | `packages/core/src/types/providers.ts` |
| `LLMProvider` / `TTSProvider` | Legacy non-realtime text-streaming / speak contracts, predate `RealtimeProvider`; only consumed by `KhaveeConfig.llm` / `.tts` and the mock/openai LLM packages | `packages/core/src/types/mock.ts` |
| `OpenAIRealtimeProvider` | Full-duplex WebRTC voice pipeline; talks directly to OpenAI's Realtime API (or via ephemeral-token proxy); owns peer connection, data channel, mic stream, audio element | `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` |
| `OpenAISTTTTSProvider` | Turn-based "VAD → STT → Chat → TTS" pipeline implementing the same `RealtimeProvider` interface but composed from 4 swappable helper classes | `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` |
| `AudioRecorder` | Wraps MicVAD; emits `onSpeechStart` / `onUtteranceReady(wav: Blob)` / `onError`; not exported from the package's public API | `packages/providers/openai-stt-tts/src/AudioRecorder.ts` |
| `STTClient` | POSTs a WAV blob (multipart/form-data) to a backend Whisper proxy, returns transcript string; not exported publicly | `packages/providers/openai-stt-tts/src/STTClient.ts` |
| `ChatClient` | POSTs `{messages, model, temperature}` JSON to a Chat Completions proxy, returns `{text, usage}`; not exported publicly | `packages/providers/openai-stt-tts/src/ChatClient.ts` |
| `TTSPlayer` | POSTs text to a TTS proxy, decodes audio via Web Audio API, plays through a dual-path `AudioBufferSourceNode` (analyser + destination) for lip-sync; not exported publicly | `packages/providers/openai-stt-tts/src/TTSPlayer.ts` |
| `ToolExecutor` (×2, duplicated) | Registry mapping tool name → `execute` fn; identical implementation exists separately in both `openai-realtime` and `openai-stt-tts` packages | `packages/providers/openai-realtime/src/ToolExecutor.ts`, `packages/providers/openai-stt-tts/src/ToolExecutor.ts` |
| `KhaveeProvider` | React context holding exactly one `RealtimeProvider` instance plus VRM/animation/expression state; the SDK has no concept of multiple simultaneous providers | `packages/react/src/KhaveeProvider.tsx` |
| `useRealtime` | The single hook that wires a `RealtimeProvider`'s callbacks into React state, and also contains a large embedded MFCC/DTW phoneme-detection class (`RealtimeAudioAnalyzer`) used for lip-sync | `packages/react/src/hooks/useRealtime.ts` |
| `VRMAvatar` / `GLBAvatar` | Render layer; consumes `chatStatus` from `KhaveeProvider` context to trigger talking animations | `packages/react/src/VRMAvatar.tsx`, `packages/react/src/GLBAvatar.tsx` |
| Example app (`src/app/openai/page.tsx`) | Only wires `OpenAIRealtimeProvider`; there is currently **no example wiring `OpenAISTTTTSProvider`** in the Next.js demo app — it is only exercised by its own unit tests | `src/app/openai/page.tsx`, `packages/providers/openai-stt-tts/src/__tests__/` |

## Pattern Overview

**Overall:** Strategy / Adapter pattern around a single fat interface (`RealtimeProvider`). Each "provider" package is a self-contained adapter that implements the entire conversational loop (capture → transcribe → think → speak) internally, rather than the SDK composing separately-pluggable STT/LLM/TTS stages.

**Key Characteristics:**
- One interface (`RealtimeProvider`) is the only seam the rest of the SDK (React layer) depends on. Anything implementing it is fully interchangeable from `KhaveeProvider`'s point of view.
- Internally, `OpenAISTTTTSProvider` already decomposes its pipeline into 4 single-purpose helper classes (`AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer`) — this is the natural seam to generalize into independent STT/LLM/TTS provider interfaces (pipecat-style), but today those helpers are concrete, OpenAI-specific classes, not interfaces.
- A constructor-level dependency-injection seam already exists for testing (`ProviderDeps` in `OpenAISTTTTSProvider.ts`), proving the helpers can already be swapped — they are just not yet typed as abstract contracts.
- `OpenAIRealtimeProvider` does NOT decompose into stages at all — it is a single ~800-line class because OpenAI's Realtime API is one full-duplex WebRTC session (no separate STT/LLM/TTS calls to make).
- There is no pipeline/transport orchestration layer comparable to pipecat's `Pipeline`/`FrameProcessor` — each provider class is both the orchestrator and the implementation.
- Tool/function-calling logic (`ToolExecutor`) is duplicated verbatim across provider packages instead of living in `@khaveeai/core`.
- Audio/lip-sync analysis is split awkwardly: `TTSPlayer` and `OpenAIRealtimeProvider` each independently create an `AnalyserNode` with identical settings (`fftSize=2048`, `smoothingTimeConstant=0.6`), and `useRealtime.ts` contains a large client-side MFCC/DTW phoneme classifier that operates on whatever analyser the active provider exposes via `getAudioAnalyser()`.

## Layers

**Core types (`@khaveeai/core`):**
- Purpose: Define every cross-package contract — `RealtimeProvider`, `RealtimeConfig`, `RealtimeEvents`, `RealtimeTool`, `Conversation`/`ChatStatus`, `MouthState`/`PhonemeData`/`AudioConfig`, plus a small HTTP client (`KhaveeClient`) and an `animate` tool factory.
- Location: `packages/core/src`
- Contains: Pure TypeScript interfaces/types (`src/types/*.ts`), one concrete utility class (`KhaveeClient` in `src/client/khavee-client.ts`), and one tool-factory helper (`src/tools/animate.ts`).
- Depends on: Nothing internal (depends on `axios`, `three`/`@pixiv/three-vrm` only for VRM-adjacent types).
- Used by: Every provider package and `@khaveeai/react`.

**Provider packages (`packages/providers/*`):**
- Purpose: Each package is a swappable implementation of `RealtimeProvider` (or, for non-realtime ones, `LLMProvider`/vector-store-style interfaces).
- Location: `packages/providers/{openai-realtime,openai-stt-tts,openai,mock,azure,pgvector,qdrant,rag}`
- Contains: One main class per package implementing a core interface, plus package-private helper classes not exported from `index.ts`.
- Depends on: `@khaveeai/core` types only (no dependency on `@khaveeai/react` or other provider packages).
- Used by: Application code (e.g. `src/app/openai/page.tsx`) and `@khaveeai/react` (structurally, via the interface — `@khaveeai/react` never imports a concrete provider package directly).

**React integration (`@khaveeai/react`):**
- Purpose: Bridge a `RealtimeProvider` instance into React state/hooks, render the VRM/GLB avatar, and drive lip-sync animation from whatever `AnalyserNode` the active provider exposes.
- Location: `packages/react/src`
- Contains: `KhaveeProvider.tsx` (context), `VRMAvatar.tsx`/`GLBAvatar.tsx` (3D rendering + animation), `hooks/useRealtime.ts` (event wiring + embedded phoneme analyzer), `hooks/useAudioLipSync.ts`.
- Depends on: `@khaveeai/core` types, `three`/`@pixiv/three-vrm`/`@react-three/fiber`, `meyda` (MFCC feature extraction).
- Used by: Application code (`src/app/*`) and the WordPress plugin (`wordpress-plugin/src`).

**Application/demo layer:**
- Purpose: Next.js app demonstrating SDK usage (`src/app`), plus a WordPress embed (`wordpress-plugin`).
- Location: `src/app`, `wordpress-plugin`
- Contains: Page components that instantiate one provider, wrap it in `KhaveeProvider`, and render `VRMAvatar`/`GLBAvatar` plus chat UI.
- Depends on: `@khaveeai/react`, `@khaveeai/providers-*`, `@khaveeai/core`.
- Used by: End users / nothing internal depends on this layer.

## Data Flow

### OpenAIRealtimeProvider path (full-duplex WebRTC)

1. App calls `connect()` (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:93`) → requests mic via `getUserMedia`, creates `RTCPeerConnection` + data channel, optionally fetches an ephemeral token from `proxyEndpoint`, sends SDP offer directly to `https://api.openai.com/v1/realtime/calls`.
2. OpenAI streams back JSON events over the WebRTC data channel; `handleDataChannelMessage` (`OpenAIRealtimeProvider.ts:437`) is a giant switch over event types (`input_audio_buffer.speech_started`, `response.output_audio_transcript.delta`, `response.function_call_arguments.done`, etc.) that mutates `conversation`/`chatStatus` and fires the matching `RealtimeEvents` callback.
3. Inbound audio track triggers `setupAudioOutputAnalysis` (`OpenAIRealtimeProvider.ts:696`), which plays audio via an `HTMLAudioElement` and simultaneously creates an `AnalyserNode` fed to `onAudioData` for lip-sync.
4. `useRealtime` (`packages/react/src/hooks/useRealtime.ts`) subscribes to all of the above callbacks and republishes them as React state; its internal `RealtimeAudioAnalyzer` consumes the analyser via `onAudioData` to drive phoneme detection → `setMultipleExpressions` on the VRM.

### OpenAISTTTTSProvider path (turn-based VAD → STT → Chat → TTS)

1. App calls `connect()` (`OpenAISTTTTSProvider.ts:236`) → generates a session ID, creates a fresh `AudioContext`, wires `AudioRecorder` callbacks, starts VAD.
2. `AudioRecorder` (wrapping `MicVAD`) fires `onUtteranceReady(wav: Blob)` when the user stops talking → provider calls private `runTurn(wav)` (`OpenAISTTTTSProvider.ts:355`).
3. `runTurn` sets status `"thinking"`, calls `STTClient.transcribe(wav, sttProxyEndpoint, authToken, language)` (`STTClient.ts:35`) to get a transcript, then delegates to `runTurnFromText`.
4. `runTurnFromText` (`OpenAISTTTTSProvider.ts:389`) is the shared core also used by `sendMessage()` (text-only path, skips STT): appends the user turn to `conversation`/`messages`, calls `ChatClient.complete(...)` (`ChatClient.ts:67`) against `chatProxyEndpoint`, fires `onUsageReport`, appends the assistant turn, calls `trimHistory()`, pauses the mic, then calls `TTSPlayer.speak(...)` (`TTSPlayer.ts:55`) against `ttsProxyEndpoint`.
5. `TTSPlayer.speak` fetches audio, decodes it, builds a dual-path `AudioBufferSourceNode` (→ `AnalyserNode` for lip-sync, → `audioContext.destination` for playback), and only fires the `onAudioData` callback (which flips `chatStatus` to `"speaking"`) once `audioContext.resume()` resolves and the context is `"running"`.
6. After playback ends, the mic is resumed with a 500ms cooldown (to discard TTS echo picked up by VAD) before `chatStatus` returns to `"ready"`.

**State Management:**
- All conversational state (`conversation`, `chatStatus`, `isConnected`, `currentVolume`) lives as plain mutable fields on the concrete provider instance — there is no central store. `useRealtime` polls/mirrors this state into React via callbacks plus a 100ms `setInterval` fallback sync (`useRealtime.ts:107`).
- Conversation history sent to the LLM (`messages: ChatMessage[]`) is a provider-private field, separate from the public-facing `conversation: Conversation[]` array consumed by the UI; `trimHistory()` only trims the former.

## Key Abstractions

**`RealtimeProvider` (core seam):**
- Purpose: The only contract the React layer depends on; represents "a thing that can connect, accept text/voice turns, and emit conversation/audio/status events."
- Examples: `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`, `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`
- Pattern: Fat interface mixing connection lifecycle, messaging, mic control, audio analysis, and ~10 optional event callbacks (`RealtimeEvents`) into one type. Any new provider (e.g. a different STT/TTS vendor) must implement the entire surface even if most of it is irrelevant to that vendor's transport.

**Pipeline helper classes (provider-private, only in `openai-stt-tts`):**
- Purpose: Single-responsibility units for one pipeline stage (mic capture+VAD, STT call, LLM call, TTS call+playback).
- Examples: `AudioRecorder.ts`, `STTClient.ts`, `ChatClient.ts`, `TTSPlayer.ts` (all in `packages/providers/openai-stt-tts/src/`)
- Pattern: Concrete classes, not interfaces. Each is instantiated directly in the provider constructor (`new AudioRecorder()`, etc.) with an injectable override via the `ProviderDeps` type for unit tests only — there is no public `STTProvider`/`TTSProvider`/`VADProvider` interface in `@khaveeai/core` that a different vendor's helper could implement and be swapped in. **This is the primary generalization point**: promoting these to core interfaces (e.g. `STTProvider.transcribe(audio): Promise<string>`, `TTSProvider.speak(text, opts): Promise<AudioResult>`) and having `OpenAISTTTTSProvider`-equivalent become a generic "pipeline provider" that takes STT/LLM/TTS implementations as constructor args is the direct analog to pipecat's `FrameProcessor` composition.

**`ToolExecutor` (duplicated, not shared):**
- Purpose: Name → async function registry for OpenAI function-calling.
- Examples: `packages/providers/openai-realtime/src/ToolExecutor.ts`, `packages/providers/openai-stt-tts/src/ToolExecutor.ts`
- Pattern: Byte-for-byte duplicate implementations. Should live once in `@khaveeai/core` and be imported by every provider.

**Legacy `LLMProvider` / `TTSProvider` (separate, parallel abstraction):**
- Purpose: Predates `RealtimeProvider`; a simpler "streamChat" / "speak" contract used by `KhaveeConfig.llm`/`.tts` and the `mock` / `openai` (non-realtime) packages.
- Examples: `packages/core/src/types/mock.ts`, `packages/providers/mock/src/index.ts` (`MockLLM`, `MockTTS`), `packages/providers/openai/src/index.ts` (`LLMOpenAI`)
- Pattern: This is a second, smaller, unrelated abstraction layer — it is NOT used by `KhaveeProvider`'s `realtimeProvider` state and is not wired into `useRealtime`. Any STT/TTS generalization effort needs to decide whether to retire this legacy path or fold it into the new pipeline-stage interfaces, since today it is dead weight alongside `RealtimeProvider`.

**Provider configuration (`RealtimeConfig` / `OpenAISTTTTSConfig`):**
- Purpose: Single config object passed to a provider constructor; `OpenAISTTTTSConfig extends RealtimeConfig` and bolts on STT/TTS-specific fields (`sttModel`, `ttsProxyEndpoint`, `silenceThresholdMs`, VAD thresholds, etc.) directly onto one flat interface.
- Examples: `packages/core/src/types/realtime.ts` (`RealtimeConfig`), `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:29` (`OpenAISTTTTSConfig`)
- Pattern: Config inheritance/flattening rather than composition — a generalized SDK would likely need per-stage config objects (`sttConfig`, `llmConfig`, `ttsConfig`) instead of one ever-growing flat interface.

## Entry Points

**Provider package entry (`index.ts` per package):**
- Location: e.g. `packages/providers/openai-stt-tts/src/index.ts`, `packages/providers/openai-realtime/src/index.ts`
- Triggers: `import { XProvider } from '@khaveeai/providers-x'` in app code.
- Responsibilities: Re-export only the public surface — the main provider class, its config type, and (inconsistently) `ToolExecutor`. Internal helper classes (`AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer`) are intentionally NOT exported.

**`KhaveeProvider` (React entry point):**
- Location: `packages/react/src/KhaveeProvider.tsx`
- Triggers: Wrapping the app's component tree; receives `config.realtime` (a `RealtimeProvider` instance constructed by app code).
- Responsibilities: Hold the single active provider in context, mirror its `chatStatus`, hold VRM/expression/animation state independent of any provider.

**`useRealtime()` (React hook entry point):**
- Location: `packages/react/src/hooks/useRealtime.ts`
- Triggers: Called from any component needing chat state/actions (`connect`, `disconnect`, `sendMessage`, `interrupt`, mic toggles).
- Responsibilities: Subscribe to the active provider's event callbacks, mirror them into React state, own the lip-sync `RealtimeAudioAnalyzer` lifecycle.

**Next.js demo app pages:**
- Location: `src/app/openai/page.tsx`, `src/app/glb/page.tsx`, `src/app/pgvector/page.tsx`, `src/app/rag-realtime/page.tsx`
- Triggers: Direct navigation in the demo app.
- Responsibilities: Construct one concrete provider, wrap in `KhaveeProvider`, render `VRMAvatar`/`GLBAvatar` + chat UI. `src/app/api/negotiate/route.ts` is the backend proxy endpoint the realtime provider's `useProxy` mode (or direct SDP relay) calls into.

## Architectural Constraints

- **Threading:** Single-threaded browser/event-loop model throughout; no workers. Audio processing (`AudioContext`, `AnalyserNode`, MicVAD's audio worklet) runs in the browser's audio thread/worklet under the hood but is not something this codebase manages explicitly beyond `AudioContext` lifecycle.
- **Global state:** None at module scope — all state is instance-scoped on provider classes or React context state. No singletons observed in `packages/core` or `packages/providers`.
- **One active provider at a time:** `KhaveeProvider`/`useRealtime` are hard-wired to a single `RealtimeProvider` instance (`config.realtime`). There is no concept of running STT from one vendor and TTS from another simultaneously without writing an entirely new monolithic provider class that internally composes them (as `OpenAISTTTTSProvider` does today for one vendor).
- **Browser-only APIs:** `AudioContext`, `AnalyserNode`, `MediaStream`, `RTCPeerConnection`, `crypto.randomUUID()` are used directly with no Node.js fallback — both realtime providers assume a browser runtime (`"use client"` boundary in React package files).
- **Backend proxy assumption:** `OpenAISTTTTSProvider` assumes a backend exists at `sttProxyEndpoint`/`chatProxyEndpoint`/`ttsProxyEndpoint` that holds the real OpenAI API key — the provider never embeds an API key for its proxied calls (`resolveAuthToken()` just returns `config.apiKey` for direct dev use, expected to be overridden when `useProxy` support is added). Any new provider should follow the same "no secret in the browser" pattern.
- **Static asset dependency:** `AudioRecorder` requires `@ricky0123/vad-web`'s ONNX/WASM assets to be served from the consuming app's `public/` directory (`baseAssetPath`/`onnxWASMBasePath`) — this is an external file-serving constraint, not just a code dependency.

## Anti-Patterns

### Monolithic provider classes instead of composed pipeline stages

**What happens:** `OpenAISTTTTSProvider` and `OpenAIRealtimeProvider` each implement the *entire* `RealtimeProvider` interface as one class, internally hard-coding which vendor's STT/LLM/TTS implementation it uses (`new AudioRecorder()`, `new STTClient()`, `new ChatClient()`, `new TTSPlayer()` instantiated directly in the constructor body).

**Why it's wrong:** Adding a new STT or TTS vendor requires writing/copy-pasting an entire new provider class (turn orchestration, history trimming, mic cooldown logic, status transitions) even though only one pipeline stage actually differs. There is no way to mix "vendor A's STT + vendor B's TTS" without a new hand-written class.

**Do this instead:** Promote `AudioRecorder`/`STTClient`/`ChatClient`/`TTSPlayer` from concrete classes to interfaces in `@khaveeai/core` (e.g. `VADProvider`, `STTProvider`, `LLMProvider` (redefined), `TTSProvider` (redefined)) and make the turn-orchestration logic in `runTurn`/`runTurnFromText` generic over those interfaces — i.e. a single `PipelineRealtimeProvider` class in `@khaveeai/core` or a new `packages/providers/pipeline` package, constructed with `{ vad, stt, llm, tts }` implementations. This mirrors pipecat's separation of `Pipeline` (orchestration) from swappable `*Service` processors.

### Duplicated `ToolExecutor` implementation

**What happens:** `packages/providers/openai-realtime/src/ToolExecutor.ts` and `packages/providers/openai-stt-tts/src/ToolExecutor.ts` are identical files.

**Why it's wrong:** Any bug fix or feature (e.g. timeout handling, structured error codes) must be applied twice and will drift over time.

**Do this instead:** Move `ToolExecutor` into `@khaveeai/core` (alongside `RealtimeTool`) and have every provider package import it from there.

### Two parallel, unrelated provider abstractions (`RealtimeProvider` vs `LLMProvider`/`TTSProvider`)

**What happens:** `KhaveeConfig` accepts both `realtime?: RealtimeProvider` and `llm?: LLMProvider` / `tts?: TTSProvider`, but `KhaveeProvider.tsx` and `useRealtime.ts` only ever read `config.realtime`. The `llm`/`tts` fields and the `mock`/`openai` (non-realtime) packages implementing them are not wired into any current React hook.

**Why it's wrong:** Anyone generalizing STT/TTS support will naturally look at `LLMProvider`/`TTSProvider` first (the names match) and be misled — they are an orphaned earlier design, not the active extension point.

**Do this instead:** Either delete `LLMProvider`/`TTSProvider`/`KhaveeConfig.llm`/`.tts` and the packages that only implement them, or explicitly fold them into the new per-stage interfaces created when generalizing `OpenAISTTTTSProvider`'s pipeline (so there is exactly one "TTS contract" in the codebase, not two).

### Config inheritance instead of per-stage config composition

**What happens:** `OpenAISTTTTSConfig extends RealtimeConfig` and adds ~10 more flat fields (`sttModel`, `ttsModel`, `sttProxyEndpoint`, `silenceThresholdMs`, `positiveSpeechThreshold`, ...) directly onto the inherited shape.

**Why it's wrong:** Every new vendor/stage combination adds more fields to one ever-growing flat config type; there is no way to express "this STT implementation's config" independently of "this TTS implementation's config" when they need different shapes (e.g. a non-VAD-based STT vendor has no use for `silenceThresholdMs`).

**Do this instead:** When generalizing, give each pipeline-stage interface its own config type (`STTConfig`, `TTSConfig`, `LLMConfig`) and have the umbrella config become `{ vad: VADConfig, stt: STTConfig, llm: LLMConfig, tts: TTSConfig, tools, instructions, ... }` composition rather than flat inheritance.

## Error Handling

**Strategy:** Try/catch at the boundary of every async lifecycle method (`connect`, `runTurn`, `runTurnFromText`), normalizing thrown values to `Error` instances and forwarding them through the optional `onError?: (error: Error) => void` callback rather than re-throwing to the caller. `chatStatus` is always reset to a safe state (`"ready"` or `"stopped"`) in the catch/finally block so the UI never gets stuck.

**Patterns:**
- `error instanceof Error ? error : new Error(String(error))` normalization appears in both provider classes before calling `onError?.()`.
- `TTSPlayer.speak()` distinguishes a deliberate `AbortError` (from `cancel()`) from a real failure — abort is swallowed silently, everything else is re-thrown to the caller (`OpenAISTTTTSProvider.runTurnFromText`'s catch block).
- A boolean re-entrancy guard (`_isTurnActive`) in `OpenAISTTTTSProvider` prevents overlapping `runTurn()` calls caused by VAD double-firing; cleared in a `finally` block.
- HTTP helper classes (`STTClient`, `ChatClient`) throw plain `Error` with the proxy's status code and response body text baked into the message rather than a typed error hierarchy.

## Cross-Cutting Concerns

**Logging:** Plain `console.log`/`console.error`/`console.warn` calls scattered through provider and hook code (no structured logger, no log levels, no centralized sink). Heaviest in `OpenAIRealtimeProvider` (session/tool-call/error logs) and `useRealtime.ts`'s `RealtimeAudioAnalyzer`.

**Validation:** Minimal and ad hoc — e.g. `AudioRecorder` rejects WAV blobs over `MAX_WAV_BYTES` (24MB) before any network call; `STTClient`/`ChatClient` check `res.ok` and required response fields exist before returning. No shared schema validation (no zod/io-ts) anywhere in the SDK packages.

**Authentication:** Two patterns coexist: (1) direct API key passed in `RealtimeConfig.apiKey` for local/dev use (sent as a `Bearer` header directly to OpenAI by `OpenAIRealtimeProvider`), and (2) backend-proxy pattern where the SDK calls the consuming app's own endpoint (`proxyEndpoint`/`sttProxyEndpoint`/`chatProxyEndpoint`/`ttsProxyEndpoint`) which holds the real secret server-side. `resolveAuthToken()` in `OpenAISTTTTSProvider` is the seam intended to later support JWT-based proxy auth without changing call sites.

---

*Architecture analysis: 2026-06-17*
