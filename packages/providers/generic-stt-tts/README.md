# @khaveeai/providers-generic-stt-tts

A composable, pipecat-style `RealtimeProvider` for the Khavee AI SDK. Instead of hardcoding one vendor for the whole voice pipeline, `GenericPipelineProvider` takes independently swappable VAD, STT, LLM, and TTS implementations and runs the turn lifecycle (barge-in, multi-round tool-calling, cooldown) generically.

This package ships four OpenAI-backed adapters (`OpenAIVADAdapter`, `OpenAISTTAdapter`, `OpenAILLMAdapter`, `OpenAITTSAdapter`) as both a working OpenAI pipeline and the template for adapting other vendors.

## Install

```
pnpm add @khaveeai/providers-generic-stt-tts
```

## Usage

```typescript
import {
  GenericPipelineProvider,
  OpenAIVADAdapter,
  OpenAISTTAdapter,
  OpenAILLMAdapter,
  OpenAITTSAdapter,
} from '@khaveeai/providers-generic-stt-tts';

const provider = new GenericPipelineProvider({
  vad: new OpenAIVADAdapter(),
  stt: new OpenAISTTAdapter({
    endpoint: 'https://your-api.example.com/api/v1/chat/stt',
    authToken: 'your-jwt',
  }),
  llm: new OpenAILLMAdapter({
    endpoint: 'https://your-api.example.com/api/v1/chat/completions',
    authToken: 'your-jwt',
  }),
  tts: new OpenAITTSAdapter({
    endpoint: 'https://your-api.example.com/api/v1/chat/tts',
    authToken: 'your-jwt',
  }),
  pipelineTools: [],
});

await provider.connect();
```

Swap any of `vad`/`stt`/`llm`/`tts` for an adapter targeting a different vendor — the provider doesn't change.

## Vendor-neutral interfaces

Adapters implement the interfaces defined in `@khaveeai/core`: `VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`. Building a new vendor adapter means implementing one of these interfaces, not subclassing this package.
