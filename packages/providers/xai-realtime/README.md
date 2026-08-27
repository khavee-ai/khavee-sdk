# @khaveeai/providers-xai-realtime

[![npm version](https://img.shields.io/npm/v/@khaveeai/providers-xai-realtime.svg)](https://www.npmjs.com/package/@khaveeai/providers-xai-realtime)
[![license](https://img.shields.io/npm/l/@khaveeai/providers-xai-realtime.svg)](../../../LICENSE)

Implements `RealtimeProvider` (from `@khaveeai/core`) over xAI's Realtime API — Grok voice, full-duplex, across a **WebSocket**.

## Install

```bash
npm install @khaveeai/providers-xai-realtime @khaveeai/core @khaveeai/react
```

## What this is, and how it differs from the other providers

One persistent WebSocket carries base64-encoded PCM16 audio in both directions inside JSON messages. Grok handles STT + LLM + TTS internally as one black box, the same shape as `openai-realtime` — not the discrete VAD → STT → LLM → TTS pipeline of `openai-stt-tts` / `generic-stt-tts`. **You cannot swap in a different STT or TTS vendor here.** For mixed vendors, use `GenericPipelineProvider` from `@khaveeai/providers-generic-stt-tts`.

The transport is the main thing that differs from `openai-realtime`:

| | `openai-realtime` | `xai-realtime` |
|---|---|---|
| Transport | WebRTC | WebSocket |
| Audio | Handled by the peer connection | Base64 PCM16 in JSON, encoded/decoded in-process |
| Mic capture | Browser media track | `AudioWorklet` → PCM16 → base64 |
| Playback | `<audio>` element | Queued `AudioBufferSourceNode`s |
| Billing | Per token | **Per minute of audio** |

Because audio is marshalled in JS rather than by the browser's WebRTC stack, this provider owns two internal engines — `MicCaptureEngine` and `AudioPlaybackEngine`. Neither is exported; they are implementation detail.

Lip-sync parity is deliberate: `getAudioAnalyser()` returns an `AnalyserNode` configured with `fftSize=2048` and `smoothingTimeConstant=0.6`, matching `openai-realtime` exactly, so the MFCC/DTW phoneme detection in `@khaveeai/react` behaves identically across both.

## Billing — read this before you deploy

xAI bills Grok voice by **wall-clock minutes of audio**, not by tokens:

| Model | Audio | Text input |
|---|---|---|
| `grok-voice-think-fast-1.0` | $0.05/min ($3.00/hr) | $0.004/input |
| `grok-voice-think-fast-2.0` | $0.08/min ($4.80/hr) | $0.004/input |

Three consequences that differ from token-billed providers:

- **Silence costs money.** While the mic is enabled, PCM frames stream continuously so server-side VAD can detect speech onset. An idle connected session with the mic on still bills.
- **The greeting costs money.** Every `connect()` without `skipGreeting` spends a few seconds of audio.
- **`grok-voice-latest` is an alias for the pricier model.** It currently resolves to `think-fast-2.0`. Pin an explicit version so the alias cannot silently move you onto a more expensive model — this package defaults to `grok-voice-think-fast-1.0` for that reason.

`onUsageReport` fires from `response.done`, but xAI may report little or no token detail for voice sessions since it meters minutes. **Do not assume token counts reflect cost here.** If you bill your own users, meter session duration instead.

## Why use a token endpoint

Passing a raw xAI `apiKey` into the provider ships that key in your client bundle, where anyone can read it from devtools. Set `tokenEndpoint` instead: your backend mints a short-lived ephemeral token and only that reaches the browser.

When `tokenEndpoint` is set, `connect()` `POST`s to it (no request body) and expects JSON. Several response shapes are accepted:

```jsonc
{ "ephemeralToken": "...", "sessionId": "..." }        // flat
{ "data": { "ephemeralToken": "...", "sessionId": "..." } }
{ "client_secret": { "value": "..." } }                // OpenAI-style
```

`sessionId` is optional but recommended: when present it is used as the `sessionId` on `onUsageReport`, so usage lands against your own backend's session record. Without it the provider falls back to xAI's per-response event id, which your backend will not recognise.

A minimal Next.js route:

```ts
export async function POST() {
  const res = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
    }),
  });
  const body = await res.json();
  return Response.json({ ephemeralToken: body?.value });
}
```

Minting a token does **not** pin a model — the model comes from the client's `?model=` query parameter, built from the `model` config below.

## Quick start

```tsx
"use client";
import { XAIRealtimeProvider } from "@khaveeai/providers-xai-realtime";
import { KhaveeProvider, useRealtime } from "@khaveeai/react";

const xaiProvider = new XAIRealtimeProvider({
  model: "grok-voice-think-fast-1.0",
  voice: "eve",
  instructions: "You are a helpful assistant. Keep replies short.",
  tokenEndpoint: "/api/xai-token",
});

function Chat() {
  const { connect, disconnect, sendMessage, conversation, chatStatus } =
    useRealtime();
  // ...
}

export default function Page() {
  return (
    <KhaveeProvider config={{ realtime: xaiProvider }}>
      <Chat />
    </KhaveeProvider>
  );
}
```

A working example lives at `apps/playground/src/app/xai/page.tsx` in this monorepo, wired to a VRM avatar with tool-calling.

## Config reference

| Option | Type | Default | Notes |
|---|---|---|---|
| `model` | `string` | `"grok-voice-think-fast-1.0"` | Prefer an explicit version over `grok-voice-latest` — see Billing |
| `voice` | `string` | *(xAI server default)* | Lowercase xAI voice id. Omitted from `session.update` when unset. **Not** an OpenAI voice name |
| `instructions` | `string` | — | System prompt. Also gates the greeting: no instructions, no greeting |
| `tokenEndpoint` | `string` | — | Backend route that mints an ephemeral token. Strongly preferred over `apiKey` |
| `apiKey` | `string` | — | Direct mode. Server-side or local development only |
| `baseUrl` | `string` | `"wss://api.x.ai/v1/realtime"` | |
| `tools` | `RealtimeTool[]` | — | Registered at construction; see Tool-calling |
| `turnDetection` | `object` | `{ type: "server_vad" }` | `threshold`, `silence_duration_ms`, `prefix_padding_ms`, `idle_timeout_ms` |
| `inputAudioFormat` | `"pcm16" \| "opus" \| "pcmu" \| "pcma"` | `"pcm16"` | |
| `outputAudioFormat` | `"pcm16" \| "opus" \| "pcmu" \| "pcma"` | `"pcm16"` | |
| `sampleRate` | `number` | `24000` | Applied to both capture and playback |

`connect()` takes `{ skipGreeting?: boolean }`. Pass `skipGreeting: true` to connect silently — worth doing during development, since each greeting is billable audio.

### Voices

28 voices, all multilingual (25+ languages, Thai included). Ids are lowercase:

**Female** — `ara` `aurora` `carina` `celeste` `eve` `iris` `liora` `luna` `ursa`

**Male** — `altair` `atlas` `castor` `cosmo` `helios` `helix` `kepler` `leo` `lumen` `lux` `naksh` `orion` `perseus` `rex` `rigel` `sal` `sirius` `zagan` `zenith`

These share no names with OpenAI's set. Passing `"shimmer"` or `"sage"` here is not valid. Fetch the current roster with `GET https://api.x.ai/v1/tts/voices`.

## Tool-calling

Tools are plain objects — no schema library. Mark required fields with `required: true` on the property itself; the provider strips that flag and emits a proper JSON Schema `required` array.

```ts
const provider = new XAIRealtimeProvider({
  model: "grok-voice-think-fast-1.0",
  tokenEndpoint: "/api/xai-token",
  tools: [
    {
      name: "get_weather",
      description: "Get the current weather for a city",
      parameters: {
        city: { type: "string", description: "City name", required: true },
      },
      execute: async ({ city }) => ({
        success: true,
        message: `${city}: 28°C, partly cloudy`,
      }),
    },
  ],
});
```

Tools passed via `config.tools` are registered in the constructor. `registerFunction(tool)` also works after construction, and re-sends `session.update` if already connected — so tools registered from inside a React effect (to close over component state) still reach the model.

`onToolCall(name, args, result)` fires after each execution.

> If the model narrates tool syntax aloud instead of calling the tool, its declarations never reached the session. Check that the tool is actually registered rather than only described in `instructions`.

## Interrupting

Barge-in is automatic: when server VAD reports `input_audio_buffer.speech_started` while the assistant is speaking, playback stops and `response.cancel` is sent. `sendMessage()` interrupts the same way, so a typed message cuts off an in-progress reply rather than queueing behind it. `interrupt()` triggers it manually.

## Microphone

`enableMicrophone()` / `disableMicrophone()` / `toggleMicrophone()` / `isMicrophoneEnabled()`.

`disableMicrophone()` fully stops the media tracks and closes the capture `AudioContext` — the browser's recording indicator goes away, and nothing streams (so nothing bills). `enableMicrophone()` re-acquires, which means a fresh permission check.

## Direct apiKey mode

```ts
const provider = new XAIRealtimeProvider({
  apiKey: process.env.XAI_API_KEY,
  model: "grok-voice-think-fast-1.0",
  voice: "eve",
});
```

Server-side or local development only. In a browser bundle this key is readable by anyone — use `tokenEndpoint` instead.

## License

MIT
