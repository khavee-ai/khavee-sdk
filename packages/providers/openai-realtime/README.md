# @khaveeai/providers-openai-realtime

[![npm version](https://img.shields.io/npm/v/@khaveeai/providers-openai-realtime.svg)](https://www.npmjs.com/package/@khaveeai/providers-openai-realtime)
[![license](https://img.shields.io/npm/l/@khaveeai/providers-openai-realtime.svg)](../../../LICENSE)

Implements `RealtimeProvider` (from `@khaveeai/core`) as a full-duplex WebRTC connection directly to OpenAI's Realtime API.

## Install

```bash
npm install @khaveeai/providers-openai-realtime @khaveeai/core @khaveeai/react
```

## What this is, and how it differs from the other providers

One persistent WebRTC connection streams mic audio to OpenAI and AI audio back, continuously. OpenAI's Realtime model handles STT + LLM + TTS internally as one black box — no separate calls, no intermediate text to intercept (only streamed transcripts over the data channel).

This differs from the turn-based providers in this monorepo (`openai-stt-tts`, `generic-stt-tts`), which run a discrete VAD → STT → LLM → TTS pipeline per turn with swappable vendor adapters at each stage.

**You cannot swap in a non-OpenAI STT/TTS vendor here** — the whole loop is OpenAI's Realtime API end to end. For mixed vendors, use `GenericPipelineProvider` from `@khaveeai/providers-generic-stt-tts` instead.

## Why use a proxy

By default you'd pass your raw OpenAI `apiKey` into the provider config — but that key would then
ship inside your client-side JavaScript bundle, where anyone can extract it from devtools. To avoid
that, the provider supports `useProxy` + `proxyEndpoint`: instead of sending your real API key to
the browser, your backend mints a short-lived (ephemeral) session token and only that token reaches
the client.

When `useProxy: true` and `proxyEndpoint` are both set, `connect()`:

1. Builds a session config object (model, instructions, voice, audio format, tools) and `POST`s it
   as `{ sessionConfig }` JSON to `proxyEndpoint`.
2. Expects the response to be JSON shaped like `{ data: { ephemeralToken: string, sessionId: string } }`
   (the provider also accepts a flatter `{ ephemeralToken, sessionId }` shape).
3. Uses that `ephemeralToken` as the `Authorization: Bearer` token when POSTing the WebRTC SDP
   offer to `https://api.openai.com/v1/realtime/calls`.

**Note on this monorepo's working example:** `src/app/openai/page.tsx` constructs the provider with
`useProxy: true, proxyEndpoint: '/api/negotiate'`, but the backend route at
`src/app/api/negotiate/route.ts` in this repo is a simpler, older-style SDP relay — it forwards the
raw SDP offer straight to `https://api.openai.com/v1/realtime?model=...` using the server's real API
key and returns the SDP answer as plain text, not the `{ ephemeralToken, sessionId }` JSON shape the
provider's proxy mode expects.
<!-- VERIFY: confirm whether src/app/api/negotiate/route.ts is intended to implement the ephemeral-token contract described above, or whether OpenAIRealtimeProvider's proxy-mode token-fetch logic needs to be reconciled with this route's simpler SDP-relay behavior -->
If you are wiring up your own proxy from scratch, implement the ephemeral-token contract described
above (steps 1–3), matching what `connect()` actually sends and expects — not the simpler SDP relay
currently checked in at that route.

## Quick start

```tsx
"use client";
import { OpenAIRealtimeProvider } from "@khaveeai/providers-openai-realtime";
import { KhaveeProvider, useRealtime } from "@khaveeai/react";

const openaiProvider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: "/api/negotiate",
  voice: "shimmer",
  instructions: "You are a helpful AI assistant. Be conversational and friendly.",
});

function OpenAIChat() {
  const { connect, disconnect, sendMessage, conversation, isConnected } = useRealtime();

  return (
    <div>
      <button onClick={connect} disabled={isConnected}>
        {isConnected ? "Connected" : "Connect"}
      </button>
      <button onClick={disconnect} disabled={!isConnected}>
        Disconnect
      </button>

      {conversation.map((msg) => (
        <div key={msg.id}>
          <strong>{msg.role}:</strong> {msg.text}
        </div>
      ))}

      <button onClick={() => sendMessage("Hello!")}>Say Hello</button>
    </div>
  );
}

export default function OpenAI() {
  return (
    <KhaveeProvider config={{ realtime: openaiProvider }}>
      <OpenAIChat />
    </KhaveeProvider>
  );
}
```

This is the same shape used by the working demo page at `src/app/openai/page.tsx` in this monorepo.
`connect()` requests microphone access, opens the WebRTC peer connection, and resolves the bearer
token (proxy or direct `apiKey`, see below) before sending the SDP offer.

## Config reference

All fields come from `RealtimeConfig` in `@khaveeai/core` (`packages/core/src/types/realtime.ts`).
Defaults below are applied in the `OpenAIRealtimeProvider` constructor
(`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`) — any field you don't pass
falls back to the listed default, except where noted as "no default."

| Field | Type | Default | Notes |
|---|---|---|---|
| `apiKey` | `string` | no default | Direct OpenAI API key. Only used if `useProxy` is not set (or `proxyEndpoint` is missing). See "Direct apiKey mode" below. |
| `model` | `string` | `"gpt-realtime-1.5"` | Passed to the proxy session config, or appended as a query param on the direct (non-proxy) calls endpoint. |
| `voice` | `"alloy" \| "ash" \| "ballad" \| "coral" \| "echo" \| "sage" \| "shimmer" \| "verse" \| "marin" \| "cedar"` | `"shimmer"` | OpenAI Realtime voice name. |
| `instructions` | `string` | `"You are a helpful AI assistant."` (proxy mode only) | System prompt. Only injected into the proxy session config — in direct mode it is not currently sent anywhere in `connect()`. |
| `greeting` | `string` | `undefined` | Fixed opening line. When set, the cold-open item sent on connect tells the model to say it word for word (in the language it is written in) instead of improvising a greeting from `instructions`. Blank counts as unset. Ignored on `connect({ skipGreeting: true })`. |
| `temperature` | `number` | `0.8` | Set on the provider instance, but **dropped** in proxy mode — OpenAI's session-create endpoint rejects a session-level `temperature` field, so it's silently omitted from `buildProxySessionConfig()` with a one-time `console.warn` if you explicitly set it. |
| `speed` | `number` | `1.4` | Speech playback speed, sent as `audio.output.speed` in the proxy session config. |
| `language` | `string` | `"en"` | Used for input transcription language in proxy mode (`audio.input.transcription.language`). |
| `tools` | `RealtimeTool[]` | `undefined` | Registered with the internal `ToolExecutor` in the constructor and included in the session's tool definitions. See "Tool-calling" below. |
| `turnServers` | `RTCIceServer[]` | `[{ urls: "stun:stun.l.google.com:19302" }]` | ICE servers for the `RTCPeerConnection`. |
| `enableLipSync` | `boolean` | n/a | Declared on `RealtimeConfig` but not read anywhere in `OpenAIRealtimeProvider.ts` — has no effect on this provider. |
| `useProxy` | `boolean` | `undefined` (falsy) | When true (and `proxyEndpoint` is set), uses the ephemeral-token proxy flow instead of a direct API key. |
| `proxyEndpoint` | `string` | no default | Your backend endpoint that mints an ephemeral token. See "Why use a proxy" above. |

## Tool-calling

`registerFunction()` and the internal `ToolExecutor` use plain JavaScript objects — no schema
library required. `ToolExecutor` itself now lives in `@khaveeai/core` and is re-exported from this
package's `src/index.ts` for backward compatibility:

```ts
export { OpenAIRealtimeProvider } from './OpenAIRealtimeProvider';
export { ToolExecutor } from '@khaveeai/core';
```

Define a tool as a `RealtimeTool` object (`name`, `description`, `parameters`, `execute`):

```ts
const weatherTool = {
  name: "get_weather",
  description: "Get current weather for a location",
  parameters: {
    location: {
      type: "string",
      description: "City name",
      required: true,
    },
  },
  execute: async (args: { location: string }) => {
    const weather = await fetchWeather(args.location);
    return {
      success: true,
      message: `The weather in ${args.location} is ${weather.description} with temperature ${weather.temp}°C`,
    };
  },
};

// Pass at construction time...
const provider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: "/api/negotiate",
  tools: [weatherTool],
});

// ...or register after the fact
provider.registerFunction(weatherTool);
```

Each tool's `parameters` is a flat map of `{ [paramName]: { type, required?, enum?, description? } }`
— the provider strips the `required` flags out and builds the `required: string[]` array expected by
OpenAI's function-calling schema for you. You never need to hand-write a JSON Schema.

When OpenAI calls a registered function, the provider parses the arguments, dispatches through
`ToolExecutor.execute(name, args)`, sends the `function_call_output` back over the data channel, and
fires your `onToolCall?.(toolName, args, result)` callback.

## Direct apiKey mode

If you don't set `useProxy`/`proxyEndpoint`, the provider falls back to using `config.apiKey`
directly as the bearer token for the WebRTC negotiation request:

```ts
const provider = new OpenAIRealtimeProvider({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY, // local dev only
  voice: "coral",
});
```

**This is for local development only.** Any environment variable prefixed `NEXT_PUBLIC_` (or
otherwise bundled into client-side code) ships inside the JavaScript sent to the browser — anyone
can open devtools and read your real OpenAI API key out of the bundle. Never use direct `apiKey`
mode in a production deployment; use `useProxy` + `proxyEndpoint` instead so the key stays on your
server.

## License

MIT — see [LICENSE](../../../LICENSE) in the repository root.
