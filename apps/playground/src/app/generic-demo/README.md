# Generic Pipeline Demo

This demo page proves that the `GenericPipelineProvider` works with non-OpenAI vendors by combining **Thonburian STT** (Thai Whisper) + **OpenAI LLM** + **JaiTTS** (Thai TTS) into a working voice pipeline.

## What This Demonstrates

- ✅ **Vendor-agnostic pipeline**: Each stage (VAD, STT, LLM, TTS) is a swappable adapter
- ✅ **Non-OpenAI STT**: ThonburianSTTAdapter posts to local Thai Whisper service
- ✅ **Non-OpenAI TTS**: JaiTTSAdapter receives and plays Thai audio from local service
- ✅ **Mixed-vendor pipeline**: STT and TTS come from different vendors than the LLM
- ✅ **Audio format contract**: Both directions use documented, tested wire formats

## Current Limitations

- ⚠️ **VAD is mocked**: No real microphone input - voice input not working yet
- ⚠️ **No VRM avatar**: This is a basic UI for testing adapters, not the full 3D avatar experience

## How to Run

### 1. Start the Python Services

Start both backend services in separate terminals:

```bash
# Terminal 1: Thai STT (Whisper)
cd /Users/whitemalt/Documents/thonburian-stt
uvicorn main:app --reload --port 8001

# Terminal 2: Thai TTS (JaiTTS)
cd /Users/whitemalt/Documents/jai-tts
uvicorn main:app --reload --port 8002
```

### 2. Configure OpenAI API Key

The LLM stage calls OpenAI through a server-side proxy route
(`src/app/api/generic-chat-proxy/route.ts`), so the key is never exposed to
the browser. Set it as a server-side environment variable:

```bash
export OPENAI_API_KEY=your_openai_api_key_here
```

Or create a `.env` / `.env.local` file in the khavee-sdk root:

```
OPENAI_API_KEY=sk-your-key-here
```

### 3. Start the Next.js Dev Server

```bash
cd /Users/whitemalt/Documents/khavee-sdk
npm run dev
```

### 4. Open the Demo

Navigate to: http://localhost:3000/generic-demo

## How to Test

1. **Click "Connect"** - initializes the pipeline
2. **Type a message** - sends text through LLM → TTS → audio playback
3. **Check status** - watch the status indicator change through pipeline stages
4. **Verify audio** - you should hear Thai speech from JaiTTS

## Expected Behavior

- ✅ **Text messages work**: Type Thai or English → LLM response → Thai TTS playback
- ⚠️ **Voice input doesn't work**: VAD is mocked, so mic button does nothing
- ✅ **Connection errors are clear**: If services are down, you'll see error messages in console
- ✅ **Status updates**: Watch "Status: ready → thinking → speaking → ready" cycle

## Architecture

```
User Input (Text)
    ↓
GenericPipelineProvider
    ├─ VAD (Mock) - not yet implemented
    ├─ STT (ThonburianSTTAdapter) → localhost:8001
    ├─ LLM (OpenAILLMAdapter) → GPT-4o
    └─ TTS (JaiTTSAdapter) → localhost:8002
        ↓
Audio Playback (Browser Web Audio API)
```

## Audio Wire Format

See [AUDIO_FORMAT.md](./AUDIO_FORMAT.md) for exact specifications:

- **STT direction**: 16kHz/mono/float32 WAV → thonburian-stt → JSON transcript
- **TTS direction**: Thai text → jai-tts → 24kHz/mono/int16 WAV → browser decode

## Testing

Run the round-trip test to validate audio wire formats:

```bash
vitest run src/app/generic-demo/__tests__/roundtrip-audio-contract.test.ts
```

This test validates that both services accept valid input and produce correct output formats.

## Next Steps

To make this a complete voice demo:

1. **Replace mock VAD** with real MicVAD adapter (from Phase 2)
2. **Add VRM avatar** using `@khaveeai/react` components
3. **Add lip-sync** using the phoneme analyzer from `useRealtime`
4. **Add tool-calling** to demonstrate LLM function execution
5. **Tune VAD cooldown** for natural mic-reopen timing after TTS

## Troubleshooting

### "Failed to connect to thonburian-stt"
- Make sure thonburian-stt is running at localhost:8001
- Check terminal for service startup errors

### "Failed to connect to jai-tts"
- Make sure jai-tts is running at localhost:8002
- Verify the service started successfully

### "Auth error" or "Missing API key"
- Set OPENAI_API_KEY (server-side) environment variable
- Restart the Next.js dev server after setting the key

### No audio playback
- Check browser console for Web Audio errors
- Verify jai-tts returned valid WAV (check Network tab)
- Make sure audio context is allowed (no muted tab)

## Files

- `page.tsx` - Main demo page with GenericPipelineProvider
- `adapters/ThonburianSTTAdapter.ts` - Thai Whisper STT adapter
- `adapters/JaiTTSAdapter.ts` - Thai TTS adapter
- `AUDIO_FORMAT.md` - Audio wire format documentation
- `__tests__/roundtrip-audio-contract.test.ts` - Round-trip validation test

---

**Phase:** 4 - Generic Demo Page  
**Last Updated:** 2026-06-19
