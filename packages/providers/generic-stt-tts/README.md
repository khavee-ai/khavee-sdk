# @khaveeai/providers-generic-stt-tts

A **vendor-agnostic voice pipeline** for the Khavee AI SDK. Instead of hardcoding one provider for every stage of a voice conversation, `GenericPipelineProvider` lets you plug in independent implementations for each stage — VAD, STT, LLM, TTS — and mix vendors freely:

```
Mic audio ──▶ VAD ──▶ STT ──▶ LLM (+ tools) ──▶ TTS ──▶ Speaker audio
            (any vendor)  (any vendor)  (any vendor)  (any vendor)
```

For example, you could run **Thai Whisper STT** + **OpenAI GPT-4o** + **a Thai voice-cloning TTS** — three different vendors, one pipeline, zero glue code beyond four small adapter classes. `GenericPipelineProvider` itself never talks to a vendor directly; it only knows about the four interfaces below.

This package also ships a complete set of **OpenAI adapters** (`OpenAIVADAdapter`, `OpenAISTTAdapter`, `OpenAILLMAdapter`, `OpenAITTSAdapter`) — both as a ready-to-use OpenAI pipeline, and as a template for writing your own adapter for any other vendor.

---

## Table of Contents

- [Why this exists](#why-this-exists)
- [Install](#install)
- [Quick start (all-OpenAI pipeline)](#quick-start-all-openai-pipeline)
- [Mixing vendors](#mixing-vendors)
- [The four pipeline interfaces](#the-four-pipeline-interfaces)
- [Writing your own adapter](#writing-your-own-adapter)
- [Tool calling (function calling)](#tool-calling-function-calling)
- [Configuration reference](#configuration-reference)
- [Events &amp; state](#events--state)
- [Turn lifecycle &amp; barge-in](#turn-lifecycle--barge-in)
- [Error handling](#error-handling)
- [Common gotchas](#common-gotchas)
- [Testing](#testing)
- [Real working example](#real-working-example)

---

## Why this exists

The SDK's original provider (`@khaveeai/providers-openai-stt-tts`) hardcodes OpenAI at every stage of the voice pipeline. That's fine until you need:

- A cheaper or regional STT/TTS vendor
- A non-English language a particular vendor handles better (e.g. a dedicated Thai TTS model)
- To swap just the LLM while keeping your STT/TTS, or vice versa
- To self-host one stage (e.g. your own Whisper deployment) while using a hosted API for another

`GenericPipelineProvider` solves this by depending only on four **vendor-neutral interfaces** (defined in `@khaveeai/core`), never on a concrete vendor SDK. Any class that implements one of these interfaces can be dropped into the pipeline — the orchestration logic (turn-taking, barge-in, tool-calling, history trimming) is identical no matter which vendors you choose.

## Install

```bash
pnpm add @khaveeai/providers-generic-stt-tts @khaveeai/core
```

## Quick start (all-OpenAI pipeline)

The fastest way to get a working pipeline is to use the four bundled OpenAI adapters. Each one talks to a **backend proxy you control** (never directly to OpenAI from the browser) — see [Common gotchas](#common-gotchas) for why.

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
    model: 'gpt-4o-mini',
  }),
  tts: new OpenAITTSAdapter({
    endpoint: 'https://your-backend.example.com/api/tts',
    authToken: 'your-jwt-or-session-token',
  }),
});

await provider.connect(); // requests mic permission, starts listening
```

Once connected, `provider` behaves like any other `RealtimeProvider` in the SDK — pass it straight into `KhaveeProvider` (`@khaveeai/react`) and use `useRealtime()` as usual. Nothing downstream needs to know which vendors are behind it.

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

## Mixing vendors

This is the whole point of the package. Swap any one stage without touching the others or the provider itself:

```typescript
import { GenericPipelineProvider, OpenAILLMAdapter } from '@khaveeai/providers-generic-stt-tts';
import { ThonburianSTTAdapter } from './adapters/ThonburianSTTAdapter'; // your own STTProvider
import { JaiTTSAdapter } from './adapters/JaiTTSAdapter';               // your own TTSProvider

const provider = new GenericPipelineProvider({
  vad: new OpenAIVADAdapter(),               // mic capture — OpenAI's MicVAD wrapper
  stt: new ThonburianSTTAdapter(),           // Thai Whisper, your own vendor
  llm: new OpenAILLMAdapter({ /* ... */ }),  // GPT-4o-mini for the reasoning stage
  tts: new JaiTTSAdapter(),                  // Thai voice-cloning TTS, your own vendor
});
```

`GenericPipelineProvider` never imports a vendor SDK — it only calls methods declared on `VADProvider` / `STTProvider` / `LLMProvider` / `TTSProvider`. As far as it's concerned, all four adapters above are interchangeable.

## The four pipeline interfaces

All four interfaces live in `@khaveeai/core` (`packages/core/src/types/pipeline.ts`). Implement one of them to support a new vendor — you never need to touch `GenericPipelineProvider` itself.

### `VADProvider` — Voice Activity Detection

Detects when the user starts/stops speaking and produces a WAV blob per utterance.

| Member | Description |
|---|---|
| `connect()` | Start listening (request mic permission, begin detection). |
| `disconnect()` | Stop listening and release the microphone. |
| `pause()` / `resume()` | Temporarily stop/resume detection without releasing the mic (used during TTS playback). |
| `isListening()` | Whether the provider is actively listening. |
| `onSpeechStart?` | Fired when speech begins. |
| `onUtteranceReady?(wav: Blob)` | Fired with a WAV blob when an utterance ends — this triggers STT. |
| `onError?(error: Error)` | Fired on a non-recoverable error (e.g. mic permission denied). |

### `STTProvider` — Speech-to-Text

Transcribes one WAV blob into text.

| Member | Description |
|---|---|
| `supportsStreaming: boolean` | Whether this vendor can stream partial transcripts (most whole-utterance vendors: `false`). |
| `supportsRejection: boolean` | Whether this vendor can flag a transcript as likely hallucinated/silence. |
| `transcribe(audio, opts?)` | Returns `{ text: string, rejected?: boolean }`. |

### `LLMProvider` — completion + tool calling

Sends the conversation history (and optional tools) to an LLM and gets back text and/or tool calls.

| Member | Description |
|---|---|
| `supportsToolCalling: boolean` | Whether this vendor's completion API supports function calling. |
| `supportsStreaming: boolean` | Whether this vendor can stream partial tokens. |
| `complete({ messages, tools?, signal? })` | Returns `{ text?: string, toolCalls: ToolCall[] }`. `toolCalls` is always an array — empty means a plain text reply. |

`ToolCall` is `{ id: string, name: string, args: Record<string, any> }` — every vendor's own tool-calling wire shape (OpenAI, Anthropic, Gemini, ...) gets mapped onto this one shape by the adapter. See the doc comments in `pipeline.ts` for the exact mapping per vendor.

### `TTSProvider` — Text-to-Speech

Synthesizes and plays audio for a piece of text through the Web Audio API.

| Member | Description |
|---|---|
| `supportsStreaming: boolean` | Whether this vendor can stream synthesized audio incrementally. |
| `speak(text, opts)` | Synthesizes and plays `text`. `opts.audioContext` is the `AudioContext` to play through; `opts.onAudioData?(analyser, ctx)` is called once playback starts, for lip-sync. |

> **Note:** `TTSProvider` is intentionally coupled to the browser's Web Audio API (`AudioContext`/`AnalyserNode`) — this package targets browser environments, not Node.js.

## Writing your own adapter

> This section is written for beginners. If you've never written an "adapter" before: it's just a small class with a fixed set of method names, so `GenericPipelineProvider` knows how to call it the same way no matter which vendor it talks to. You're not modifying the SDK — you're handing it a class that follows the contract it expects.

Every adapter follows the same recipe, no matter which stage it's for:

1. `import` the interface you're implementing (`STTProvider`, `LLMProvider`, `TTSProvider`, or `VADProvider`) from `@khaveeai/core`.
2. `class MyAdapter implements <Interface>` — TypeScript will now tell you exactly which methods/fields you're missing.
3. Inside the one required method, call your vendor's API (usually with `fetch`) and reshape its response into the exact return type the interface expects.
4. Done — pass `new MyAdapter()` into `GenericPipelineProvider`'s config and it just works.

A minimal adapter is usually 20–50 lines. Below is a full, runnable-shaped example for **each** of the four stages, using a made-up vendor each time so you can see the pattern clearly. Swap the `fetch()` URL and request/response shape for your real vendor's API and you're done.

### Example 1 — STT adapter (speech → text)

**The contract:** you receive a `Blob` of recorded audio (a WAV file) and must return `{ text: string, rejected?: boolean }`.

```typescript
import { STTProvider, STTResult } from '@khaveeai/core';

export class MySTTAdapter implements STTProvider {
  // A short, unique name for this adapter — used for logging/debugging only.
  readonly name = 'my-stt';

  // Does this vendor support sending back partial transcripts as it goes?
  // Most "send one file, get one transcript" vendors are false.
  readonly supportsStreaming = false;

  // Can this vendor tell us "I think this was silence/noise, not real speech"?
  // If your vendor never does this, leave it false.
  readonly supportsRejection = false;

  constructor(private endpoint: string) {}

  async transcribe(audio: Blob, opts?: { language?: string }): Promise<STTResult> {
    // Audio always arrives as a WAV Blob — send it as multipart/form-data,
    // which is what most STT APIs (including OpenAI's Whisper) expect.
    const formData = new FormData();
    formData.append('file', audio, 'utterance.wav');
    if (opts?.language) formData.append('language', opts.language);

    const res = await fetch(this.endpoint, { method: 'POST', body: formData });
    if (!res.ok) {
      throw new Error(`STT error: ${res.status} ${await res.text()}`);
    }

    const json = await res.json(); // e.g. { text: "hello there" }

    // This is the only real "translation" work an adapter does: take
    // whatever shape your vendor returns and map it onto STTResult.
    return { text: json.text };
  }
}
```

### Example 2 — LLM adapter (completion, with tool calling)

**The contract:** you receive `{ messages, tools?, signal? }` and must return `{ text?: string, toolCalls: ToolCall[] }`. `toolCalls` must always be an array — use an empty array `[]` when the model just replied with text and didn't call anything.

```typescript
import { LLMProvider, LLMCompletionResult, Tool } from '@khaveeai/core';

export class MyLLMAdapter implements LLMProvider {
  readonly name = 'my-llm';

  // Can this vendor's API call functions/tools at all?
  readonly supportsToolCalling = true;

  // Can it stream tokens back as they're generated? (Not used by
  // GenericPipelineProvider today, but adapters declare it for future use.)
  readonly supportsStreaming = false;

  constructor(private endpoint: string, private model = 'my-default-model') {}

  async complete(args: {
    messages: Array<{ role: string; content: string }>;
    tools?: Tool[];
    signal?: AbortSignal;
  }): Promise<LLMCompletionResult> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: args.messages,
        // Only send a "tools" field at all if there are tools to offer —
        // many vendors error out on an empty tools array.
        ...(args.tools && args.tools.length > 0 ? { tools: args.tools } : {}),
      }),
      signal: args.signal,
    });
    if (!res.ok) {
      throw new Error(`Chat error: ${res.status} ${await res.text()}`);
    }

    const json = await res.json();
    // Imagine your vendor replies with: { reply: "hi!", calls: [...] }
    // Map that vendor-specific shape onto the neutral ToolCall[] shape:
    const toolCalls = (json.calls ?? []).map((c: any) => ({
      id: c.id,
      name: c.functionName,
      args: c.functionArgs, // already a parsed object, not a JSON string
    }));

    return { text: json.reply, toolCalls };
  }
}
```

> **Beginner tip:** the trickiest part of an LLM adapter is almost always mapping your vendor's tool-call shape onto `{ id, name, args }`. Every major vendor (OpenAI, Anthropic, Gemini) calls these fields something slightly different — check your vendor's docs for "function calling" or "tool use" and look for whatever field acts as a unique ID for each call.

### Example 3 — TTS adapter (text → speech)

**The contract:** you receive text and an `AudioContext` to play through, and must actually start audio playing — there's no return value, just the side effect of sound coming out of the speakers.

```typescript
import { TTSProvider } from '@khaveeai/core';

export class MyTTSAdapter implements TTSProvider {
  readonly name = 'my-tts';
  readonly supportsStreaming = false;

  constructor(private endpoint: string) {}

  async speak(
    text: string,
    opts: {
      audioContext: AudioContext;
      onAudioData?: (analyser: AnalyserNode, ctx: AudioContext) => void;
      voice?: string;
      speed?: number;
      signal?: AbortSignal;
    }
  ): Promise<void> {
    // If the turn was already cancelled (e.g. user interrupted) before we
    // even started, don't bother making the network call at all.
    if (opts.signal?.aborted) return;

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: opts.voice }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`TTS error: ${res.status} ${await res.text()}`);

    // Most TTS APIs return raw audio bytes (a WAV/MP3 file) in the response
    // body. decodeAudioData() turns those bytes into something Web Audio
    // can actually play.
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await opts.audioContext.decodeAudioData(arrayBuffer);

    // Wire up: source -> analyser -> speakers. The analyser node is what
    // lets the SDK do lip-sync / volume visualization while audio plays.
    const source = opts.audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const analyser = opts.audioContext.createAnalyser();
    source.connect(analyser);
    analyser.connect(opts.audioContext.destination);

    // Tell the caller "audio is starting now, here's the analyser" so it
    // can drive lip-sync animation.
    opts.onAudioData?.(analyser, opts.audioContext);

    // speak() should not resolve until the audio has actually finished
    // playing — GenericPipelineProvider awaits this before moving on.
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
      source.start();
    });
  }
}
```

### Example 4 — VAD adapter (detecting when someone is speaking)

VAD is the one stage you'll rarely write completely from scratch, because "detect speech in raw microphone audio" is a non-trivial ML problem on its own — almost every real implementation wraps an existing library (this package's own `OpenAIVADAdapter` wraps `@ricky0123/vad-web`, a browser speech-detection library, via a helper class called `AudioRecorder`).

**The contract:** `connect()` starts listening, and you fire `onSpeechStart` when the user starts talking and `onUtteranceReady(wav)` with a WAV `Blob` once they stop.

```typescript
import { VADProvider } from '@khaveeai/core';
// Imagine `SomeVadLibrary` is a third-party npm package that already does
// the actual mic-listening and speech-detection work for you.
import { SomeVadLibrary } from 'some-vad-library';

export class MyVADAdapter implements VADProvider {
  readonly name = 'my-vad';

  // These four are filled in by GenericPipelineProvider — you just need to
  // declare the fields and call them when the right thing happens.
  onSpeechStart?: () => void;
  onUtteranceReady?: (wav: Blob) => void;
  onError?: (error: Error) => void;

  private instance: SomeVadLibrary | null = null;
  private listening = false;

  async connect(): Promise<void> {
    this.instance = await SomeVadLibrary.start({
      onSpeechStart: () => this.onSpeechStart?.(),
      onSpeechEnd: (wavBlob: Blob) => this.onUtteranceReady?.(wavBlob),
    });
    this.listening = true;
  }

  async disconnect(): Promise<void> {
    await this.instance?.stop();
    this.listening = false;
  }

  async pause(): Promise<void> {
    await this.instance?.pause();
  }

  async resume(): Promise<void> {
    await this.instance?.resume();
  }

  isListening(): boolean {
    return this.listening;
  }
}
```

If your chosen library doesn't produce a WAV `Blob` directly, you'll need to encode whatever it gives you (usually a `Float32Array` of raw samples) into one — see `AudioRecorder`'s use of `@ricky0123/vad-web`'s `utils.encodeWAV()` for a real example of that step.

### Reference: the real adapters in this package

The `OpenAI*Adapter` classes in `src/adapters/` are real, working versions of all four examples above — open them side-by-side with the interface they implement if you want a second reference point with production error-handling included.

**Checklist for any new adapter:**

- [ ] Implement every required member of the interface (`supportsX` flags included — consumers branch on these without calling into the provider).
- [ ] Respect `signal` (`AbortSignal`) wherever the interface accepts one — check `signal?.aborted` before starting work, and ideally pass `signal` into your `fetch()` calls so an aborted turn actually cancels the in-flight request.
- [ ] Don't throw on cancellation — if `signal.aborted` mid-call, return quietly instead of throwing, so a barge-in doesn't surface as a fake error.
- [ ] Map your vendor's errors to `Error` instances with useful messages — `GenericPipelineProvider` forwards them to `onError` as-is.

## Tool calling (function calling)

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

// ...or register one later, e.g. once some app state is ready:
provider.registerFunction({ /* RealtimeTool shape */ });
```

When the LLM decides to call a tool, `GenericPipelineProvider` runs a bounded loop (max **5 rounds** — `MAX_TOOL_ROUNDS`) automatically:

1. Send the conversation + tool definitions to `llm.complete()`.
2. If the response includes tool calls, execute each one via the registered `execute` function.
3. Feed the results back into the conversation history and call `llm.complete()` again.
4. Repeat until the LLM returns a plain text reply (no more tool calls), then proceed to TTS.

If the loop exceeds 5 rounds, it's treated as an error and surfaced via `onError` — this guards against a misbehaving LLM/tool combination calling itself forever. `onToolCall?(name, args, result)` fires after every individual tool execution, useful for debugging or UI feedback ("calling get_weather...").

## Configuration reference

`GenericPipelineConfig` extends the SDK's standard `RealtimeConfig`, plus pipeline-specific fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `vad` | `VADProvider` | ✅ | The VAD stage implementation. |
| `stt` | `STTProvider` | ✅ | The STT stage implementation. |
| `llm` | `LLMProvider` | ✅ | The LLM stage implementation. |
| `tts` | `TTSProvider` | ✅ | The TTS stage implementation. |
| `pipelineTools` | `Tool[]` | – | Tools the LLM may call, declared at construction time. |
| `micReopenCooldownMs` | `number` | – | Delay (ms) after TTS finishes before the mic reopens. Default `500`. |
| `instructions` | `string` | – | System prompt, seeded as the first message in history. |
| `voice` | `string` | – | Default voice passed to `tts.speak()` (vendor-specific identifier). |
| `speed` | `number` | – | Default playback speed passed to `tts.speak()`. |
| `language` | `string` | – | Language hint passed to `stt.transcribe()`. |

> **Why `pipelineTools` and not `tools`?** `RealtimeConfig.tools` already exists with a different, incompatible shape (`RealtimeTool[]`, used by the SDK's older realtime providers). `pipelineTools` is a deliberately separate field so this package doesn't fight the inherited type. Use `pipelineTools` for `GenericPipelineProvider` — `tools` is unused here.

## Events & state

`GenericPipelineProvider` implements the standard `RealtimeProvider` interface, so it exposes the same state and events every other provider in the SDK does:

**State** (read directly or via `useRealtime()`):
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

**Events** (assign as plain callback properties, e.g. `provider.onError = (e) => ...`):
`onConnect`, `onDisconnect`, `onError`, `onMessage`, `onConversationUpdate`, `onChatStatusChange`, `onAudioStart`, `onAudioEnd`, `onVolumeChange`, `onMouthStateChange`, `onPhonemeDetected`, `onToolCall`, `onUsageReport`, `onAudioData`.

If you're using `@khaveeai/react`'s `useRealtime()` hook, all of this is already wired into React state for you — you generally don't need to touch these directly.

## Turn lifecycle & barge-in

A "turn" is one full round-trip: user speaks (or types) → STT (if voice) → LLM (+ tools) → TTS. Two things make this safe under real conversation conditions:

- **Full-interruption barge-in.** If the user starts speaking again while a turn is still in flight (LLM thinking, or TTS playing), the in-flight turn is **aborted immediately** and a new turn starts right away with the new utterance — it does not just get dropped or queued. This is implemented with a single `AbortController` per active turn; every stage receives the turn's `signal` and is expected to check it (see [Writing your own adapter](#writing-your-own-adapter)).
- **History trimming.** The internal message history is capped (default: last 10 turns) to avoid unbounded growth and rising token costs on long conversations. Trimming is aware of multi-round tool-calling — it never cuts a tool result away from the assistant message that requested it (which would otherwise break the next LLM call for most vendors).

## Error handling

Every async lifecycle method (`connect`, `disconnect`, `sendMessage`, the internal turn pipeline) follows the same pattern used throughout this SDK:

```typescript
try {
  // ...
} catch (error) {
  this.onError?.(error instanceof Error ? error : new Error(String(error)));
  this.setChatStatus("ready");
}
```

Errors are never thrown back at the caller for foreseeable runtime failures (network errors, vendor errors, mic permission) — they're normalized to `Error` and delivered via `onError`. A barge-in (an aborted in-flight turn) is **not** treated as an error — it's silently discarded, since it was intentionally superseded, not a failure.

## Common gotchas

These come from real integration experience wiring up non-OpenAI vendors — worth checking if your pipeline misbehaves:

- **CORS.** If your STT/TTS backend is a separate service the browser calls directly (not proxied through your Next.js/Node backend), it needs CORS headers allowing your frontend's origin. A FastAPI service, for example, needs `CORSMiddleware` explicitly added — it isn't on by default.
- **Empty LLM replies.** `GenericPipelineProvider` already skips calling `tts.speak()` when the LLM's reply text is blank (e.g. a tool-only round with no spoken text) — but if you're calling a `TTSProvider` directly outside this pipeline, don't assume every vendor handles an empty string gracefully. Some will throw or crash on it.
- **Never call a real vendor API directly from the browser with a hardcoded key.** Adapters in this package expect their `endpoint` to point at *your own backend proxy*, which holds the real API key server-side and forwards the request. Pointing an adapter's `endpoint` straight at a vendor's public API from client-side code both leaks your key in the JS bundle and usually returns a different response shape than the adapter expects (since the adapter is built against your proxy's `{ text, tool_calls }` shape, not the vendor's raw response).
- **MicVAD (`OpenAIVADAdapter`) needs static assets served from your app.** It loads `vad.worklet.bundle.min.js`, a Silero VAD `.onnx` model, and an `onnxruntime-web` `.wasm` binary at runtime from `baseAssetPath`/`onnxWASMBasePath` (default `"/"`). These files live inside the `@ricky0123/vad-web` and `onnxruntime-web` packages — copy them into your app's `public/` directory, or `OpenAIVADAdapter.connect()` will fail with a worklet-not-found error.

## Testing

```bash
pnpm --filter @khaveeai/providers-generic-stt-tts test
```

The test suite (`src/__tests__/`) covers each adapter in isolation (mocked `fetch`/underlying client) plus `GenericPipelineProvider`'s orchestration logic: multi-round tool-calling, barge-in/abort behavior, history trimming around tool-call marker pairs, and an end-to-end integration test composing all four real OpenAI adapters together.

## Real working example

See [`src/app/generic-demo`](../../../src/app/generic-demo) in this repo for a complete, running example that mixes vendors for real: **Thai Whisper STT** + **OpenAI GPT-4o-mini** (via a backend proxy route) + **Thai voice-cloning TTS**, with real microphone input through `OpenAIVADAdapter`. Its own `README.md` walks through running all three backend services together.
