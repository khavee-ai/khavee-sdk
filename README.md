# Khavee SDK

A TypeScript toolkit for building voice-driven 3D avatars (VRM or GLB) in React, with a vendor-neutral voice pipeline: **VAD → Speech-to-Text → LLM → Text-to-Speech**, each stage independently swappable.

You can either drop in a single pre-built, OpenAI-only `RealtimeProvider`, or compose your own pipeline from any mix of vendors — including non-OpenAI STT/TTS services — using the same React components either way.

This repo is a pnpm monorepo containing the SDK packages plus a Next.js demo app you can run locally to see everything working.

## Packages

| Package | What it is |
|---|---|
| [`@khaveeai/core`](packages/core) | Shared TypeScript interfaces every other package implements. No React, no UI. Start here to understand the contracts. |
| [`@khaveeai/react`](packages/react) | `KhaveeProvider`, `VRMAvatar`, `GLBAvatar`, `useRealtime()` — renders and animates the avatar, automatically, from whatever `RealtimeProvider` you give it. |
| [`@khaveeai/providers-generic-stt-tts`](packages/providers/generic-stt-tts) | **The flagship "swap any vendor" package.** `GenericPipelineProvider` composes a VAD + STT + LLM + TTS adapter — mix OpenAI with non-OpenAI vendors freely. |
| [`@khaveeai/providers-openai-realtime`](packages/providers/openai-realtime) | Full-duplex WebRTC connection directly to OpenAI's Realtime API. One continuous session — no separate STT/LLM/TTS stages, OpenAI-only by design. |
| [`@khaveeai/providers-openai-stt-tts`](packages/providers/openai-stt-tts) | Turn-based VAD→STT→Chat→TTS pipeline, hardcoded to OpenAI. The OpenAI-only precursor to `generic-stt-tts` — kept as-is for existing consumers. |
| [`@khaveeai/providers-mock`](packages/providers/mock) | `MockLLM`/`MockTTS` — canned responses for offline testing. Implements an older, separate interface; doesn't plug into the avatar pipeline directly (see its README). |
| [`@khaveeai/providers-pgvector`](packages/providers/pgvector) | Vector-store provider backed by Postgres + pgvector, for RAG. |
| [`@khaveeai/providers-rag`](packages/providers/rag) | Composes a vector store + an LLM into retrieval-augmented generation, exposes a tool-calling-ready `createRAGTool()`. |

The WordPress plugin (and its `wp-bundle` embed package) has moved to its own repo: [`khavee-ai/khavee-wp-plugin`](https://github.com/khavee-ai/khavee-wp-plugin).

Each package's own README has the full API reference, config options, and gotchas — this file is the map and the fastest path to a working "hello world."

## Install

This is a pnpm workspace.

```bash
git clone <this repo>
cd khavee-sdk
pnpm install
pnpm run build:packages   # builds packages/core, packages/react, packages/providers/*
```

If you're consuming the SDK from a separate app (not this monorepo), install only what you need:

```bash
npm install @khaveeai/core @khaveeai/react three @react-three/fiber @react-three/drei
# plus whichever provider package(s) you're using, e.g.:
npm install @khaveeai/providers-generic-stt-tts
```

`@khaveeai/react` renders 3D with `three`/`@react-three/fiber`/`@react-three/drei` — these are peer dependencies you provide yourself.

## Two ways to build a voice pipeline

**1. A single pre-built provider** — fastest to start, locked to OpenAI:

- `OpenAIRealtimeProvider` (`@khaveeai/providers-openai-realtime`) — full-duplex WebRTC, lowest latency, no separate pipeline stages.
- `OpenAISTTTTSProvider` (`@khaveeai/providers-openai-stt-tts`) — turn-based, also OpenAI-only.

**2. Compose your own pipeline** — use this if you want anything other than 100% OpenAI:

- `GenericPipelineProvider` (`@khaveeai/providers-generic-stt-tts`) takes a `{ vad, stt, llm, tts }` config, where each one is any class implementing the matching interface from `@khaveeai/core` (`VADProvider` / `STTProvider` / `LLMProvider` / `TTSProvider`). Ready-made OpenAI-backed adapters ship in the same package, but you can write your own adapter for any vendor — see [`packages/providers/generic-stt-tts/README.md`](packages/providers/generic-stt-tts/README.md) for the exact interface shapes and a from-scratch adapter example.

Both approaches implement the same `RealtimeProvider` interface, so `@khaveeai/react`'s components and hooks work identically either way — you can switch pipelines later without touching your UI code.

## Quick start

```tsx
import { Canvas } from '@react-three/fiber';
import { KhaveeProvider, VRMAvatar, useRealtime } from '@khaveeai/react';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';

const provider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: '/api/negotiate', // your backend route, holds the real API key
  voice: 'shimmer',
  instructions: 'You are a friendly AI assistant.',
});

function Chat() {
  const { connect, disconnect, isConnected, conversation, sendMessage } = useRealtime();
  return (
    <div>
      <button onClick={isConnected ? disconnect : connect}>
        {isConnected ? 'Disconnect' : 'Connect'}
      </button>
      {conversation.map((m) => <p key={m.id}>{m.role}: {m.text}</p>)}
    </div>
  );
}

export default function App() {
  return (
    <KhaveeProvider config={{ realtime: provider }}>
      <Canvas camera={{ position: [0, 1.5, 3] }}>
        <ambientLight intensity={0.5} />
        <VRMAvatar src="/models/your-avatar.vrm" />
      </Canvas>
      <Chat />
    </KhaveeProvider>
  );
}
```

`VRMAvatar` automatically lip-syncs, blinks, and plays talking animations while the AI speaks — none of that is wired up manually. Swap `provider` for a `GenericPipelineProvider` and this code doesn't change.

Never embed a real API key directly in browser code (`apiKey` config fields exist for local dev only) — route through a backend proxy endpoint that holds the secret server-side, as shown above.

## See a real cross-vendor pipeline running

`src/app/generic-demo/page.tsx` in this repo is a complete working example that mixes vendors in one pipeline: OpenAI for VAD and the LLM, plus two custom HTTP adapters — `ThonburianSTTAdapter` (a local Thai Whisper STT service) and `JaiTTSAdapter` (a local Thai voice-cloning TTS service) — both implementing the plain `STTProvider`/`TTSProvider` interfaces from `@khaveeai/core` in well under 100 lines each. See `src/app/generic-demo/README.md` for how to run the two local backend services and try it yourself.

## Avatar rendering: VRM vs GLB

- `VRMAvatar` (`.vrm` files) — drives standard VRM mouth blendshapes (`aa`/`ih`/`ou`/`ee`/`oh`) directly from phoneme detection on the TTS audio, for real lip-sync.
- `GLBAvatar` (`.glb`/`.gltf` files) — most GLB exports don't have standard mouth blendshapes, so instead it switches between animation clips named with `talk`/`gesture`/`speak` while the AI is speaking. Different mechanism, same automatic behavior.

Both live in `@khaveeai/react` — see its README for full props and the `useRealtime()`/`useVRMExpressions()` hooks.

## Tool-calling (function calling)

Tools are plain JavaScript objects — no schema library required:

```ts
provider.registerFunction({
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: { city: { type: 'string', required: true } },
  execute: async ({ city }) => ({ success: true, message: `Sunny in ${city}` }),
});
```

This works the same way across `OpenAIRealtimeProvider`, `OpenAISTTTTSProvider`, and `GenericPipelineProvider`.

## Known issues

- **`@khaveeai/providers-openai-realtime`'s proxy contract.** The provider's `connect()` expects a proxy endpoint that returns an ephemeral session token; the example negotiate route in this repo (`src/app/api/negotiate/route.ts`) predates that contract and returns a different shape. If you copy the demo route as-is, verify it against the provider's actual `connect()` implementation first.

## Development

```bash
pnpm install
pnpm run dev            # Next.js demo app at localhost:3000
pnpm run dev:packages   # watch-build all SDK packages
pnpm run build:packages
pnpm run lint
```
