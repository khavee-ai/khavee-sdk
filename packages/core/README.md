# @khaveeai/core

[![npm version](https://img.shields.io/npm/v/@khaveeai/core.svg)](https://www.npmjs.com/package/@khaveeai/core)
[![license](https://img.shields.io/npm/l/@khaveeai/core.svg)](../../LICENSE)

The shared TypeScript types package for the Khavee SDK. **No React, no UI, no vendor-specific code** — just the interfaces every voice-pipeline piece (VAD, STT, LLM, TTS) must follow, so any vendor can be swapped in without changing your app code.

Think of it as a set of contracts: a TypeScript `interface` listing the methods a class must have. As long as a provider implements the right interface, the rest of the SDK doesn't care which vendor is behind it.

## Install

```bash
npm install @khaveeai/core
```

## Contents

- [The four pipeline-stage interfaces](#the-four-pipeline-stage-interfaces)
- [RealtimeProvider](#realtimeprovider)
- [Tool-calling](#tool-calling)
- [Avatar tools: emotion and gestures](#avatar-tools-emotion-and-gestures)
- [KhaveeClient](#khaveeclient)
- [Notes](#notes)

## The four pipeline-stage interfaces

Defined in `src/types/pipeline.ts`. Split a voice pipeline into independently swappable stages: **listen → transcribe → reply → speak.**

| Interface | Job | Key method |
|---|---|---|
| `VADProvider` | Detect speech start/stop, hand back recorded audio | `connect()` / `pause()` / `resume()` |
| `STTProvider` | Transcribe an audio blob to text | `transcribe(audio, opts?)` |
| `LLMProvider` | Get a completion, optionally with tool calls | `complete({ messages, tools?, signal? })` |
| `TTSProvider` | Synthesize and play speech | `speak(text, opts)` |

```typescript
interface VADProvider extends Provider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  isListening(): boolean;
  onSpeechStart?: () => void;
  onUtteranceReady?: (wav: Blob) => void;
  onError?: (error: Error) => void;
}

interface STTProvider extends Provider {
  readonly supportsStreaming: boolean;
  readonly supportsRejection: boolean;
  transcribe(audio: Blob, opts?: { language?: string }): Promise<STTResult>;
}

interface LLMProvider extends Provider {
  readonly supportsToolCalling: boolean;
  readonly supportsStreaming: boolean;
  complete(args: {
    messages: Array<{ role: string; content: string }>;
    tools?: Tool[];
    signal?: AbortSignal;
  }): Promise<LLMCompletionResult>;
}

interface TTSProvider extends Provider {
  readonly supportsStreaming: boolean;
  speak(
    text: string,
    opts: {
      audioContext: AudioContext;
      onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;
      voice?: string;
      speed?: number;
      signal?: AbortSignal;
      onViseme?: (viseme: PhonemeData) => void;
    }
  ): Promise<void>;
}
```

**Viseme timing.** If your TTS vendor returns word, phoneme or viseme timing, convert it to `PhonemeData` and call `onViseme` — `@khaveeai/react` then drives the avatar's mouth from the real speech timeline instead of guessing from the audio:

```typescript
interface PhonemeData {
  phoneme: "aa" | "ih" | "ou" | "ee" | "oh" | "sil";
  intensity: number;              // 0-1
  timestamp: number;              // absolute, performance.now()-based
  duration?: number;
  source?: "timing" | "audio-analysis"; // set "timing" for vendor timing data
  wordBoundary?: boolean;         // true on the first viseme of a word
}
```

Vendors without timing (e.g. OpenAI TTS) simply never call it, and the avatar falls back to audio analysis.

**Capability flags** (`supportsStreaming`, `supportsRejection`, `supportsToolCalling`) let you check what a provider can do *without* calling it:

```typescript
if (sttProvider.supportsRejection) {
  // safe to check result.rejected after transcribe()
}
```

Only OpenAI-backed implementations ship today (`@khaveeai/providers-openai-stt-tts` and friends). The interfaces are designed to support Anthropic/Gemini/Bedrock adapters later without a redesign — but no such adapter exists in this repo yet.

## RealtimeProvider

`RealtimeProvider` (`src/types/realtime.ts`) is the one interface `@khaveeai/react`'s `KhaveeProvider`/`useRealtime` actually depend on. Any class implementing it — `OpenAIRealtimeProvider`, `OpenAISTTTTSProvider`, `GenericPipelineProvider` — is a drop-in replacement for any other.

```typescript
interface RealtimeProvider extends RealtimeEvents {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(text: string): Promise<void>;
  interrupt(): void;
  registerFunction(tool: RealtimeTool): void;

  isConnected: boolean;
  chatStatus: ChatStatus; // 'ready' | 'speaking' | 'listening' | 'thinking' | 'stopped' | 'starting'
  conversation: Conversation[];
  currentVolume: number;

  getAudioAnalyser(): { analyser: AnalyserNode; audioContext: AudioContext } | null;
  toggleMicrophone(): boolean;
  enableMicrophone(): void;
  disableMicrophone(): void;
  isMicrophoneEnabled(): boolean;
}
```

`RealtimeEvents`, the base it extends, is a set of optional callbacks: `onConnect`, `onDisconnect`, `onError`, `onMessage`, `onConversationUpdate`, `onChatStatusChange`, `onAudioStart`/`onAudioEnd`, `onVolumeChange`, `onMouthStateChange`, `onPhonemeDetected`, `onToolCall`, `onUsageReport`.

It's intentionally a bigger interface than the four stages above — it's what the React layer needs from whatever provider is active (connection lifecycle + messaging + mic control + audio analysis in one contract). The four stage interfaces are the lower-level pieces a `RealtimeProvider` can be composed from internally.

## Tool-calling

The LLM can call functions in your app ("look up this order"). Tools in `src/types/tools.ts` are **plain JavaScript objects** — no Zod, no schema library.

```typescript
const getWeather: Tool = {
  name: "get_weather",
  description: "Get the current weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string", description: "City name" } },
    required: ["city"],
  },
  execute: async (args) => ({ success: true, message: `It's sunny in ${args.city}` }),
};
```

`ToolExecutor` dispatches by name and never throws — a missing tool or a thrown `execute()` both come back as `{ success: false, message }`:

```typescript
import { ToolExecutor } from "@khaveeai/core";

const executor = new ToolExecutor();
executor.register("get_weather", getWeather.execute);
const result = await executor.execute("get_weather", { city: "Bangkok" });
```

## Avatar tools: emotion and gestures

Ready-made tools that let the LLM drive the avatar's face. Pair them with `@khaveeai/react`'s `setEmotionHint` / `setGestureHint`.

**Emotion — zero config.** `createEmotionTool(setEmotionHint)` returns a fully wired `set_emotion` tool: validation and `execute` are built in. Append `emotionSystemPrompt` to your instructions so the model calls it once per turn, before speaking.

```typescript
import { createEmotionTool, emotionSystemPrompt } from "@khaveeai/core";

const provider = new OpenAIRealtimeProvider({
  instructions: myInstructions + "\n\n" + emotionSystemPrompt,
});

// inside a component under KhaveeProvider:
const { setEmotionHint } = useKhavee();
provider.registerFunction(createEmotionTool(setEmotionHint).tool);
```

- Emotions: `EMOTION_NAMES` = `happy`, `sad`, `angry`, `surprised`, `neutral`, `thinking` (type `EmotionName`).
- Intensity is clamped to 0–1; a missing or malformed value uses `DEFAULT_EMOTION_INTENSITY` (`0.7`).
- An unknown emotion name is rejected and never reaches your setter.

If your provider takes tools at construction instead, pass the tool there with a setter that forwards to `setEmotionHint` once your component mounts.

**Gestures.** `toolGesture` is the matching `set_gesture` definition (`"nod"`, `"shake"`, or `"none"` for no gesture) — supply the `execute`:

```typescript
import { toolGesture } from "@khaveeai/core";

provider.registerFunction({
  ...toolGesture,
  execute: async (args) => {
    setGestureHint(args?.gesture ?? null);
    return { success: true, message: `gesture: ${args?.gesture}` };
  },
});
```

## KhaveeClient

A small `axios`-based HTTP client for Khavee's hosted platform API (project preview data, etc.) — a separate concern from the pipeline interfaces above. Most SDK usage doesn't need it.

```typescript
import { createKhaveeClient } from "@khaveeai/core";

const client = createKhaveeClient({ apiKey: "your-api-key" });
const preview = await client.getProjectPreview();
```

Supports API key (`X-API-Key`) or JWT (`Authorization: Bearer`) auth, plus `get`/`post`/`put`/`delete` and `getProjectPreview()`/`getProjectById(id)`.

## Notes

- **Legacy interfaces.** `src/types/mock.ts` defines an older, smaller pair — `LegacyLLMProvider` (`streamChat`) and `LegacyTTSProvider` (`speak`) — predating `RealtimeProvider`. Only `@khaveeai/providers-mock` implements them today. `KhaveeProvider` accepts a `config.llm`/`config.tts` of this shape for typing only — its actual pipeline runs on `config.realtime` (a `RealtimeProvider`), not these.
- **`toolAnimate`** is a `trigger_animation` tool definition with no `execute` — supply one that calls `@khaveeai/react`'s `useAnimations().animate(name)`.

## License

MIT
