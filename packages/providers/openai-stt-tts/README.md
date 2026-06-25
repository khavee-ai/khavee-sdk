# @khaveeai/providers-openai-stt-tts

[![npm version](https://img.shields.io/npm/v/@khaveeai/providers-openai-stt-tts.svg)](https://www.npmjs.com/package/@khaveeai/providers-openai-stt-tts)
[![license](https://img.shields.io/npm/l/@khaveeai/providers-openai-stt-tts.svg)](../../../LICENSE)

A turn-based voice pipeline provider implementing `RealtimeProvider` from `@khaveeai/core`, hardcoded to OpenAI: Whisper for STT, Chat Completions for the LLM turn, OpenAI TTS for the reply.

## What this is

`VAD detects utterance → Whisper proxy → Chat proxy → TTS proxy → playback`, all inside one `OpenAISTTTTSProvider` class. Hand it to `KhaveeProvider` as `config.realtime`.

The returned audio is decoded and played via the Web Audio API, with an `AnalyserNode` exposed for lip-sync (driving a VRM avatar's mouth).

## Why a backend proxy

This provider never embeds your OpenAI API key in the browser. Instead of calling OpenAI directly, every network call goes to a backend endpoint you control:

- `sttProxyEndpoint` — receives the WAV blob (multipart/form-data) and must respond with `{ transcript: string }` or `{ data: { transcript: string } }`. Your backend forwards the audio to Whisper using your real API key.
- `chatProxyEndpoint` — receives `{ messages, model, temperature }` as JSON and must respond with `{ text, usage }` or `{ data: { text, usage } }`. Your backend forwards this to Chat Completions.
- `ttsProxyEndpoint` — receives `{ text, voice, speed, model, ttsInstructions? }` as JSON and must respond with raw audio bytes. Your backend forwards this to the OpenAI TTS API and streams the audio back.

Every request to these three endpoints carries an `Authorization: Bearer <token>` header. The token comes from `config.apiKey` by default (`resolveAuthToken()` simply returns `this.config.apiKey ?? ""`) — there is currently no built-in token-exchange flow, so for production use you are expected to put your own auth in front of these proxy endpoints.

## Quick start

```bash
pnpm add @khaveeai/providers-openai-stt-tts @khaveeai/core @khaveeai/react
```

```tsx
import { OpenAISTTTTSProvider } from "@khaveeai/providers-openai-stt-tts";
import { KhaveeProvider } from "@khaveeai/react";

const provider = new OpenAISTTTTSProvider({
  sttProxyEndpoint: "https://your-backend.example.com/api/stt",
  chatProxyEndpoint: "https://your-backend.example.com/api/chat",
  ttsProxyEndpoint: "https://your-backend.example.com/api/tts",
  apiKey: "your-backend-issued-token", // sent as the Bearer token to all three proxies
  instructions: "You are a friendly voice assistant.",
});

function App() {
  return (
    <KhaveeProvider config={{ realtime: provider }}>
      {/* your chat UI / avatar components */}
    </KhaveeProvider>
  );
}
```

Once mounted, calling `connect()` (typically via the `useRealtime()` hook from `@khaveeai/react`) starts the microphone and VAD. Speaking and pausing triggers a full STT → Chat → TTS turn automatically. You can also call `sendMessage(text)` to skip STT and send text directly (still goes through Chat → TTS).

## Config reference

`OpenAISTTTTSConfig` extends `RealtimeConfig` (from `@khaveeai/core`). All fields are optional unless noted.

### Fields from `RealtimeConfig` (base)

| Field | Type | Default | Notes |
|---|---|---|---|
| `apiKey` | `string` | `""` | Used as the Bearer token sent to all three proxy endpoints. |
| `model` | `string` | — | Chat Completions model name, forwarded to `chatProxyEndpoint`. |
| `voice` | `"alloy" \| "ash" \| "ballad" \| "coral" \| "echo" \| "sage" \| "shimmer" \| "verse" \| "marin" \| "cedar"` | `"alloy"` | TTS voice, forwarded to `ttsProxyEndpoint`. |
| `instructions` | `string` | — | System prompt; seeded into the internal chat history on construction. |
| `temperature` | `number` | — | Forwarded to `chatProxyEndpoint`. |
| `tools` | `RealtimeTool[]` | — | Tools to auto-register at construction time (see Tool-calling below). |
| `turnServers` | `RTCIceServer[]` | — | Not used by this provider (no WebRTC) — present only because it's part of the shared base config. |
| `speed` | `number` | `1.0` | TTS playback speed, forwarded to `ttsProxyEndpoint`. |
| `enableLipSync` | `boolean` | — | Not read directly by this class — lip-sync is driven by whatever consumes `getAudioAnalyser()`/`onAudioData`. |
| `language` | `string` | — | BCP-47 code forwarded to the STT proxy. |
| `useProxy` | `boolean` | — | Declared on the base config; this provider does not currently branch on it. |
| `proxyEndpoint` | `string` | — | Used by the ephemeral-token flow on other providers; not read by this class. |

### Fields specific to `OpenAISTTTTSConfig`

| Field | Type | Default | Notes |
|---|---|---|---|
| `sttModel` | `string` | `"gpt-4o-mini-transcribe"` | Not currently forwarded to the STT proxy call itself — set on `config` for future use/your own proxy logic. |
| `ttsModel` | `string` | `"gpt-4o-mini-tts"` | Forwarded to `ttsProxyEndpoint` as `model`. |
| `sttProxyEndpoint` | `string` | `""` | Backend URL for Whisper STT requests. |
| `ttsProxyEndpoint` | `string` | `""` | Backend URL for TTS requests. |
| `chatProxyEndpoint` | `string` | `""` | Backend URL for Chat Completions requests. |
| `silenceThresholdMs` | `number` | `1400` | Passed to MicVAD as `redemptionMs` — how long silence must persist before an utterance is considered finished. |
| `positiveSpeechThreshold` | `number` | `0.5` | MicVAD threshold (0–1) for detecting speech start. |
| `negativeSpeechThreshold` | `number` | `0.35` | MicVAD threshold (0–1) for detecting speech end. |
| `baseAssetPath` | `string` | `"/"` | Base URL MicVAD fetches its worklet/model files from. Must point at a path that serves `@ricky0123/vad-web`'s static assets (worklet JS, Silero ONNX model, onnxruntime WASM) — typically your app's `public/` directory. |
| `onnxWASMBasePath` | `string` | `"/"` | Override path for onnxruntime-web's `.wasm` files specifically. |
| `ttsInstructions` | `string` | — | Style/tone instruction string, forwarded to the TTS proxy as `ttsInstructions` (supported by `gpt-4o-mini-tts`). |

Note: the constructor only applies defaults for `sttModel`, `ttsModel`, `voice` (`"alloy"`), and `speed` (`1.0`) at the top level. The VAD-related defaults (`silenceThresholdMs`, `positiveSpeechThreshold`, `negativeSpeechThreshold`, asset paths) are applied later, inside `AudioRecorder.connect()`, not in the provider's constructor.

## Tool-calling

Register tools as plain JavaScript objects — no schema library required. Either pass them in `config.tools` at construction time, or call `registerFunction()` directly:

```typescript
provider.registerFunction({
  name: "getWeather",
  description: "Get the current weather for a city",
  parameters: {
    city: { type: "string", required: true, description: "City name" },
  },
  execute: async (args) => {
    // your tool logic here
    return { success: true, message: `It's sunny in ${args.city}` };
  },
});
```

This matches the `RealtimeTool` shape from `@khaveeai/core`. Internally, `registerFunction()` delegates to a `ToolExecutor` instance (also re-exported from this package, originally implemented here and later promoted into `@khaveeai/core`).

## Scope: OpenAI-only by design

This provider is intentionally locked to OpenAI for every pipeline stage (VAD via `@ricky0123/vad-web` + Whisper STT + Chat Completions + OpenAI TTS) and is not designed to have individual stages swapped out. It stays as-is for this milestone — it is not the place to plug in a different STT or TTS vendor.

If you want to mix vendors — for example, a different Whisper-compatible STT service, or a custom voice-cloning TTS — use `@khaveeai/providers-generic-stt-tts` instead. Its `GenericPipelineProvider` composes independently swappable `VADProvider`, `STTProvider`, `LLMProvider`, and `TTSProvider` implementations, so each pipeline stage can come from a different vendor.

## Advanced: reusable internal helpers

The pipeline's internal building blocks are also exported from this package for advanced composition or reuse:

- `AudioRecorder` — wraps `@ricky0123/vad-web`'s `MicVAD` to emit `onSpeechStart` / `onUtteranceReady(wav: Blob)` / `onError`.
- `STTClient` — posts a WAV blob to a Whisper-style proxy endpoint and resolves a transcript string.
- `ChatClient` — posts a `{ messages, model, temperature }` payload to a Chat Completions-style proxy and resolves `{ text, usage }`. Its `ChatMessage`, `ChatUsage`, and `ChatResult` types are also exported.
- `TTSPlayer` — posts text to a TTS proxy, decodes the returned audio via the Web Audio API, and plays it back through a dual-path `AudioBufferSourceNode` (one path to an `AnalyserNode` for lip-sync, one to `audioContext.destination` for audible output).

These were originally private implementation details of `OpenAISTTTTSProvider` and are now exported so they can be reused when building custom pipelines (for example, as a reference implementation for `@khaveeai/providers-generic-stt-tts` adapters). They are not required for typical usage — `OpenAISTTTTSProvider` already wires them together for you.
