# @khaveeai/providers-generic-stt-tts

[![npm version](https://img.shields.io/npm/v/@khaveeai/providers-generic-stt-tts.svg)](https://www.npmjs.com/package/@khaveeai/providers-generic-stt-tts)
[![license](https://img.shields.io/npm/l/@khaveeai/providers-generic-stt-tts.svg)](../../../LICENSE)

**The flagship "swap any vendor at any stage" voice pipeline in the Khavee AI SDK.**

Every other provider package in this SDK hardcodes one vendor for the whole voice pipeline. This package doesn't. `GenericPipelineProvider` builds a complete voice pipeline out of **four independently swappable pieces** — VAD, STT, LLM, TTS — each one just a small class implementing a plain interface from `@khaveeai/core`:

```
Mic audio ──▶ VAD ──▶ STT ──▶ LLM (+ tools) ──▶ TTS ──▶ Speaker audio
            (any vendor)  (any vendor)  (any vendor)  (any vendor)
```

`GenericPipelineProvider` itself never imports a vendor SDK. It only calls methods on `VADProvider` / `STTProvider` / `LLMProvider` / `TTSProvider`. This package ships four ready-made adapters that wrap OpenAI's stack — but the entire point is that you can write your own adapter class for any other vendor and pass it in, with zero changes to `GenericPipelineProvider` or anything downstream of it.

---

## Table of Contents

- [Install](#install)
- [What this is](#what-this-is)
- [Quick start (bundled OpenAI adapters)](#quick-start-bundled-openai-adapters)
- [Mixing vendors — a real example from this repo](#mixing-vendors--a-real-example-from-this-repo)
- [Writing your own adapter](#writing-your-own-adapter)
- [Tool calling](#tool-calling)
- [Barge-in / interruption](#barge-in--interruption)
- [`micReopenCooldownMs`](#micreopencooldownms)
- [Configuration reference](#configuration-reference)
- [Events & state](#events--state)
- [Testing](#testing)

---

## Install

```bash
pnpm add @khaveeai/providers-generic-stt-tts @khaveeai/core
```

## What this is

`GenericPipelineProvider` implements the SDK's standard `RealtimeProvider` interface (the same interface `OpenAIRealtimeProvider` and `OpenAISTTTTSProvider` implement) by composing four pipeline-stage interfaces, all defined in `@khaveeai/core`:

| Interface | Stage | Job |
|---|---|---|
| `VADProvider` | Voice Activity Detection | Detect when the user starts/stops speaking, hand back a WAV `Blob` per utterance |
| `STTProvider` | Speech-to-Text | Transcribe one WAV blob into text |
| `LLMProvider` | Completion (+ tools) | Send conversation history (and optional tools) to an LLM, get back text and/or tool calls |
| `TTSProvider` | Text-to-Speech | Synthesize and play audio for a piece of text through the Web Audio API |

Because `GenericPipelineProvider`'s constructor just takes `{ vad, stt, llm, tts }` typed as these four interfaces, you can hand it **any class** that implements the matching interface — including a class you write yourself. This package ships four ready-made adapters (`OpenAIVADAdapter`, `OpenAISTTAdapter`, `OpenAILLMAdapter`, `OpenAITTSAdapter`) that wrap OpenAI's APIs, both as a usable default pipeline and as a reference for writing your own.

Once constructed, `GenericPipelineProvider` behaves exactly like any other `RealtimeProvider` — pass it into `KhaveeProvider` (`@khaveeai/react`) and drive it with `useRealtime()` as usual. Nothing downstream needs to know which vendors are behind it.

## Quick start (bundled OpenAI adapters)

```typescript
import {
  GenericPipelineProvider,
  OpenAIVADAdapter,
  OpenAISTTAdapter,
  OpenAILLMAdapter,
  OpenAITTSAdapter,
} from '@khaveeai/providers-generic-stt-tts';

const provider = new GenericPipelineProvider({
  vad: new OpenAIVADAdapter(), // real mic capture via @ricky0123/vad-web
  stt: new OpenAISTTAdapter({
    endpoint: 'https://your-backend.example.com/api/stt',
    authToken: 'your-jwt-or-session-token',
  }),
  llm: new OpenAILLMAdapter({
    endpoint: 'https://your-backend.example.com/api/chat',
    authToken: 'your-jwt-or-session-token',
    model: 'gpt-4o-mini', // optional, this is the default
  }),
  tts: new OpenAITTSAdapter({
    endpoint: 'https://your-backend.example.com/api/tts',
    authToken: 'your-jwt-or-session-token',
  }),
});

await provider.connect(); // requests mic permission, starts listening
```

Each adapter talks to a **backend proxy you control**, never directly to OpenAI from the browser — `endpoint`/`authToken` point at your own server route, which holds the real OpenAI API key.

```tsx
import { KhaveeProvider, useRealtime } from '@khaveeai/react';

function App() {
  return (
    <KhaveeProvider config={{ realtime: provider }}>
      <Chat />
    </KhaveeProvider>
  );
}

function Chat() {
  const { connect, sendMessage, conversation, chatStatus } = useRealtime();
  // ...
}
```

## Mixing vendors — a real example from this repo

This is the whole point of the package. The demo app at [`src/app/generic-demo`](../../../src/app/generic-demo) wires up a pipeline that mixes **three different vendors in one pipeline**:

- VAD: `OpenAIVADAdapter` (real mic capture via `@ricky0123/vad-web`)
- STT: `ThonburianSTTAdapter` — a demo-local adapter that POSTs WAV audio to a self-hosted Thai Whisper service on `http://localhost:8001`
- LLM: `OpenAILLMAdapter` (GPT-4o-mini, via a Next.js backend proxy route)
- TTS: `JaiTTSAdapter` — a demo-local adapter that POSTs text to a self-hosted Thai voice-cloning TTS service on `http://localhost:8002`, decodes the returned WAV via the Web Audio API, and wires an `AnalyserNode` for lip-sync through the `onAudioData` callback

`ThonburianSTTAdapter` and `JaiTTSAdapter` are **not** part of this package — they live in the demo app at `src/app/generic-demo/adapters/`, written from scratch against the `STTProvider`/`TTSProvider` interfaces. `GenericPipelineProvider` doesn't know or care that they aren't OpenAI adapters:

```typescript
import { GenericPipelineProvider, OpenAILLMAdapter, OpenAIVADAdapter } from '@khaveeai/providers-generic-stt-tts';
import { ThonburianSTTAdapter } from './adapters/ThonburianSTTAdapter';
import { JaiTTSAdapter } from './adapters/JaiTTSAdapter';

const provider = new GenericPipelineProvider({
  vad: new OpenAIVADAdapter(),
  stt: new ThonburianSTTAdapter(),           // self-hosted Thai Whisper, not OpenAI
  llm: new OpenAILLMAdapter({
    endpoint: '/api/generic-chat-proxy',
    authToken: 'local-dev',
    model: 'gpt-4o-mini',
  }),
  tts: new JaiTTSAdapter(),                  // self-hosted Thai voice cloning, not OpenAI
  micReopenCooldownMs: 500,
});
```

See [`src/app/generic-demo/page.tsx`](../../../src/app/generic-demo/page.tsx) for the full running example, including the `KhaveeProvider`/`VRMAvatar`/chat UI wiring around this `provider` instance.

## Writing your own adapter

An adapter is just a small class implementing one of the four interfaces. `ThonburianSTTAdapter` (from the demo app above) is a real-world template for how small this can be — implementing `STTProvider` is one constructor and one method:

```typescript
import { STTProvider, STTResult } from "@khaveeai/core";

export class ThonburianSTTAdapter implements STTProvider {
  readonly name = "thonburian-stt";
  readonly supportsStreaming = false;
  readonly supportsRejection = false; // this vendor has no rejection heuristic

  private readonly baseUrl: string;

  constructor(config: { baseUrl?: string } = {}) {
    this.baseUrl = config.baseUrl ?? "http://localhost:8001";
  }

  async transcribe(
    audio: Blob,
    opts?: { language?: string; signal?: AbortSignal }
  ): Promise<STTResult> {
    const formData = new FormData();
    formData.append("file", audio, "utterance.wav");

    const response = await fetch(`${this.baseUrl}/transcribe`, {
      method: "POST",
      body: formData,
      signal: opts?.signal,
    });

    if (!response.ok) {
      throw new Error(`ThonburianSTT error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return { text: data.text };
  }
}
```

That's the whole contract for `STTProvider`: declare `supportsStreaming` and `supportsRejection`, implement `transcribe(audio, opts?)`, return `{ text, rejected? }`. The same shape applies to the other three interfaces — `VADProvider`, `LLMProvider`, `TTSProvider` — all defined in `packages/core/src/types/pipeline.ts`. Implement the one you need, pass an instance into `GenericPipelineProvider`'s config, and it works — no SDK changes required.

**Checklist for any new adapter:**

- Implement every required member of the interface, including the `readonly supportsX` flags — consumers branch on these without calling into the provider.
- Respect `signal` (`AbortSignal`) wherever the interface accepts one — check `signal?.aborted` and pass `signal` into your `fetch()` calls so an aborted turn actually cancels the in-flight request.
- Don't throw on cancellation — if the call was aborted, return quietly instead of throwing, so a barge-in doesn't surface as a fake error.
- Normalize errors to `Error` instances with useful messages — `GenericPipelineProvider` forwards them to `onError` as-is.

The `OpenAI*Adapter` classes in `src/adapters/` are additional real, production-hardened references — open them next to the interface they implement for a second example with full error handling.

## Tool calling

Tools are plain objects — no schema library required:

```typescript
import { Tool } from '@khaveeai/core';

const getWeather: Tool = {
  name: 'get_weather',
  description: 'Get the current weather for a city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
    },
    required: ['city'],
  },
  execute: async (args) => {
    const weather = await fetchWeather(args.city);
    return { success: true, message: `${weather.tempC}°C, ${weather.condition}` };
  },
};

const provider = new GenericPipelineProvider({
  vad, stt, llm, tts,
  pipelineTools: [getWeather], // declared at construction time
});

// ...or register one later, once some app state is ready:
provider.registerFunction({ /* RealtimeTool shape */ });
```

Use `pipelineTools` (a `Tool[]`), not `tools` — `GenericPipelineConfig` extends the SDK's `RealtimeConfig`, which already declares an incompatible `tools?: RealtimeTool[]` field. `pipelineTools` is the field `GenericPipelineProvider` actually reads.

When the LLM decides to call a tool, `GenericPipelineProvider` runs a bounded multi-round loop automatically (capped at `MAX_TOOL_ROUNDS = 5`):

1. Send the conversation + tool definitions to `llm.complete()`.
2. If the response includes tool calls (`result.toolCalls.length > 0`), execute each one via the registered `execute` function.
3. Record the LLM's tool-call turn and each tool's result back into history, then call `llm.complete()` again.
4. Repeat until the LLM returns a plain text reply (`toolCalls.length === 0`), then proceed to TTS.

If the loop exceeds 5 rounds, it throws and is surfaced via `onError` — this guards against a misbehaving LLM/tool combination calling itself forever. `onToolCall?(name, args, result)` fires after every individual tool execution.

`registerFunction(tool)` adds a tool after construction (`tool` is the `RealtimeTool` shape, not `Tool` — it gets converted internally). Registering a tool with a name that's already registered replaces it rather than duplicating it.

## Barge-in / interruption

If the user starts speaking again while a turn is still in flight (the LLM is still thinking, or TTS is still playing), `GenericPipelineProvider` aborts the in-flight turn immediately and starts a new turn right away with the new utterance — it doesn't get dropped or queued. This "just works" out of the box for both the VAD-driven path and `sendMessage()`; you don't need to do anything to get this behavior with the bundled adapters.

## `micReopenCooldownMs`

After the TTS response finishes playing, the pipeline waits `micReopenCooldownMs` (in milliseconds) before resuming the VAD and re-enabling the microphone. **Default: `500`.** This avoids the mic picking up the tail end of the AI's own speech (e.g. from speaker bleed) as a new user utterance. Set it via `GenericPipelineConfig`:

```typescript
new GenericPipelineProvider({ vad, stt, llm, tts, micReopenCooldownMs: 800 });
```

## Configuration reference

`GenericPipelineConfig` extends the SDK's `RealtimeConfig`, plus these pipeline-specific fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `vad` | `VADProvider` | yes | The VAD stage implementation. |
| `stt` | `STTProvider` | yes | The STT stage implementation. |
| `llm` | `LLMProvider` | yes | The LLM stage implementation. |
| `tts` | `TTSProvider` | yes | The TTS stage implementation. |
| `pipelineTools` | `Tool[]` | no | Tools the LLM may call, declared at construction time. |
| `micReopenCooldownMs` | `number` | no | Delay (ms) after TTS finishes before the mic reopens. Default `500`. |
| `instructions` | `string` (inherited) | no | System prompt, seeded as the first message in history. |
| `voice` | `string` (inherited) | no | Default voice passed to `tts.speak()` (vendor-specific identifier). |
| `speed` | `number` (inherited) | no | Default playback speed passed to `tts.speak()`. |
| `language` | `string` (inherited) | no | Language hint passed to `stt.transcribe()`. |

Constructor config for each bundled adapter:

| Adapter | Required fields | Optional fields |
|---|---|---|
| `OpenAIVADAdapter` | — (config object itself is optional) | `baseAssetPath` (default `"/"`), `onnxWASMBasePath` (default `"/"`), `silenceThresholdMs` (default `1400`), `positiveSpeechThreshold` (default `0.5`), `negativeSpeechThreshold` (default `0.35`) |
| `OpenAISTTAdapter` | `endpoint`, `authToken` | — |
| `OpenAILLMAdapter` | `endpoint`, `authToken` | `model` (default `"gpt-4o-mini"`), `temperature` |
| `OpenAITTSAdapter` | `endpoint`, `authToken` | `model` (default `"gpt-4o-mini-tts"`), `voice` (default `"alloy"`), `speed` (default `1.0`), `instructions` |

## Events & state

`GenericPipelineProvider` implements the standard `RealtimeProvider` interface, exposing the same state and events every other provider in this SDK does:

**State:**
- `isConnected: boolean`
- `chatStatus: "stopped" | "starting" | "ready" | "listening" | "thinking" | "speaking"`
- `conversation: Conversation[]` — full message history for UI rendering
- `currentVolume: number`

**Methods:**
- `connect()` / `disconnect()` — start/stop the session
- `sendMessage(text)` — send a text message directly, skipping STT
- `interrupt()` — cancel whatever's currently in flight (LLM call or TTS playback)
- `toggleMicrophone()` / `enableMicrophone()` / `disableMicrophone()` / `isMicrophoneEnabled()`
- `registerFunction(tool)` — add a tool after construction
- `getSessionId()` — the UUID generated at the most recent `connect()`
- `getAudioAnalyser()` — the current `{ analyser, audioContext }`, or `null` if no audio is active

**Events** (assign as plain callback properties, e.g. `provider.onError = (e) => ...`):
`onConnect`, `onDisconnect`, `onError`, `onMessage`, `onConversationUpdate`, `onChatStatusChange`, `onAudioStart`, `onAudioEnd`, `onVolumeChange`, `onMouthStateChange`, `onPhonemeDetected`, `onToolCall`, `onUsageReport`, `onAudioData`.

If you're using `@khaveeai/react`'s `useRealtime()` hook, all of this is already wired into React state for you.

## Testing

```bash
pnpm --filter @khaveeai/providers-generic-stt-tts test
```

The test suite (`src/__tests__/`) covers each adapter in isolation and `GenericPipelineProvider`'s orchestration logic: multi-round tool-calling, barge-in/abort behavior, and history trimming around tool-call marker pairs.
