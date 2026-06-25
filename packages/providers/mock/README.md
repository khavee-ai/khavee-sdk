# @khaveeai/providers-mock

[![npm version](https://img.shields.io/npm/v/@khaveeai/providers-mock.svg)](https://www.npmjs.com/package/@khaveeai/providers-mock)
[![license](https://img.shields.io/npm/l/@khaveeai/providers-mock.svg)](../../../LICENSE)

Canned, randomized `MockLLM`/`MockTTS` classes for exercising chat/animation-trigger logic locally — no API keys, no network calls, no cost.

## Install

```bash
npm install @khaveeai/providers-mock
```

## What this is

- **`MockLLM`** implements `LegacyLLMProvider`'s `streamChat({messages}) => AsyncIterable<{type, delta}>`. It matches the last message against a fixed set of keywords (`hello`, `dance`, `sad`, `happy`, `angry`, `think`, `yes`, `no`, ...) or falls back to one of 8 canned responses, then yields it character-by-character with a randomized 20–80ms delay to simulate typing.
- **`MockTTS`** implements `LegacyTTSProvider`'s `speak({text, voice?}) => Promise<void>`. It does **not** play audio — it logs to console and `await`s a fake duration (capped at 8s) computed from word count.

> ⚠️ **This does not plug into the avatar/voice pipeline.** `LegacyLLMProvider`/`LegacyTTSProvider` are an older interface pair, separate from `RealtimeProvider` — the interface `KhaveeProvider`/`useRealtime` actually consume to drive the avatar. `KhaveeConfig` does have optional `llm`/`tts` fields typed for these, so `<KhaveeProvider config={{ llm: new MockLLM(), tts: new MockTTS() }}>` compiles — but nothing reads `config.llm`/`config.tts` anywhere in `@khaveeai/react`. No chat status, no lip-sync, no avatar reaction.

## What it's actually useful for

Standalone testing of chat/animation-trigger logic, independent of the avatar:

- Unit-test that `streamChat` yields the expected `*trigger_animation: name*` marker for a given keyword.
- Sanity-check your own trigger-parsing logic before wiring a real LLM.
- Preview what a "typing" delta stream looks like, with zero LLM cost.

Triggers like `*trigger_animation: wave_small*` are plain text in the canned responses — parse them yourself (e.g. `text.match(/\*trigger_animation:\s*(\w+)\*/)`); `MockLLM`/`MockTTS` don't act on them.

## Usage

```ts
import { MockLLM, MockTTS } from "@khaveeai/providers-mock";

const llm = new MockLLM();
let response = "";
for await (const chunk of llm.streamChat({ messages: [{ role: "user", content: "hello there" }] })) {
  if (chunk.type === "text") response += chunk.delta;
}
console.log(response);
// => "Hello there! Nice to meet you! *trigger_animation: wave_small* 👋"

const tts = new MockTTS();
await tts.speak({ text: response, voice: "mock-voice" }); // logs + waits, plays nothing
```

## Want the real avatar + lip-sync pipeline without API keys?

`MockLLM`/`MockTTS` aren't the path for that. Either write a minimal class implementing `RealtimeProvider` directly, or use `@khaveeai/providers-generic-stt-tts`'s `GenericPipelineProvider` with your own stub VAD/STT/LLM/TTS adapters — either gives `KhaveeProvider` a real `RealtimeProvider` to drive the avatar end-to-end.

## License

MIT
