# @khaveeai/providers-openai-stt-tts

OpenAI STT/TTS pipeline provider for the Khavee AI SDK — a drop-in RealtimeProvider that uses VAD + Whisper STT + Chat Completions + OpenAI TTS through backend proxies.

## Install

```
pnpm add @khaveeai/providers-openai-stt-tts
```

## Usage

```typescript
import { OpenAISTTTTSProvider } from '@khaveeai/providers-openai-stt-tts';

const provider = new OpenAISTTTTSProvider({
  useProxy: true,
  sttProxyEndpoint: 'https://your-api.example.com/api/v1/chat/stt',
  chatProxyEndpoint: 'https://your-api.example.com/api/v1/chat/completions',
  ttsProxyEndpoint: 'https://your-api.example.com/api/v1/chat/tts',
});

await provider.connect();
```
