# Audio Wire Format Documentation

This document specifies the exact audio wire formats used in the generic demo pipeline for both STT and TTS directions. These formats were verified against the live `thonburian-stt` and `jai-tts` services during Phase 4 development.

## Overview

The generic pipeline uses **different, direction-specific audio formats** for STT and TTS. These formats are **not symmetric** — the STT direction uses 16kHz float32 PCM, while the TTS direction uses 24kHz int16 PCM.

## STT Direction: VAD → Thonburian STT

### Input Format (to `ThonburianSTTAdapter.transcribe()`)

- **Source:** MicVAD's `encodeWAV()` (from `@ricky0123/vad-web`)
- **Sample Rate:** 16,000 Hz (16 kHz)
- **Channels:** Mono (1 channel)
- **Encoding:** 32-bit IEEE float PCM (WAV format code 3)
- **Container:** WAV blob

### Transmission

- **Method:** POST to `http://localhost:8001/transcribe`
- **Content-Type:** `multipart/form-data`
- **Field Name:** `file` (note: NOT `"audio"` — this is thonburian-stt's convention)
- **Filename:** `"utterance.wav"`
- **Timeout:** 60 seconds (via `AbortSignal.timeout()`)

### Response Format

- **Content-Type:** `application/json`
- **Schema:** `{ "text": "<Thai transcript string>" }`
- **Example:** `{ "text": "สวัสดีครับ" }`

### Notes

- Thonburian-stt does NOT support rejection heuristics — it always returns a transcription, even for silence/hallucination
- The `language` parameter is ignored — thonburian-stt always transcribes as Thai
- No authentication required (local demo service)

## TTS Direction: JaiTTS → Demo Playback

### Input Format (to `JaiTTSAdapter.speak()`)

- **Source:** Thai text string (LLM response or user input)
- **Encoding:** UTF-8 string

### Transmission

- **Method:** POST to `http://localhost:8002/synthesize`
- **Content-Type:** `application/json`
- **Body Schema:** `{ "text": "<Thai text>" }`
- **Example:** `{ "text": "สวัสดีครับ" }`
- **Timeout:** 60 seconds (via `AbortSignal.timeout()`)

### Response Format

- **Content-Type:** `audio/wav`
- **Sample Rate:** 24,000 Hz (24 kHz)
- **Channels:** Mono (1 channel)
- **Encoding:** 16-bit PCM (WAV format code 1)
- **Container:** Raw WAV bytes

### Playback Process

1. Receive raw WAV bytes as `Blob`
2. Convert to `ArrayBuffer` via `blob.arrayBuffer()`
3. Decode via `AudioContext.decodeAudioData(arrayBuffer)` → `AudioBuffer`
   - **Important:** `AudioContext.decodeAudioData()` **auto-resamples** jai-tts's 24kHz output to whatever sample rate the `AudioContext` is using (typically 44.1kHz or 48kHz in browsers)
4. Create `AudioBufferSourceNode` with decoded buffer
5. Connect dual-path: `source → analyser → destination` (for lip-sync)
6. Start playback via `source.start()`

### Notes

- JaiTTS hardcodes voice and speed server-side — `voice`/`speed` parameters are ignored
- No authentication required (local demo service)
- Playback duration varies by text length — typical Thai phrase takes 2-5 seconds

## Format Comparison

| Direction | Sample Rate | Channels | Encoding | Container |
|-----------|-------------|----------|----------|-----------|
| **STT (VAD → Thonburian)** | 16,000 Hz | Mono | 32-bit float PCM | WAV |
| **TTS (JaiTTS → Demo)** | 24,000 Hz | Mono | 16-bit PCM | WAV |

**Key Difference:** The STT direction uses **float32** encoding at **16kHz**, while the TTS direction uses **int16** encoding at **24kHz**. These formats are **not interchangeable** — each is optimized for its respective vendor's model.

## Verification

To verify these formats against the live services:

```bash
# Start both Python services
cd /Users/whitemalt/Documents/thonburian-stt && uvicorn main:app --reload --port 8001
cd /Users/whitemalt/Documents/jai-tts && uvicorn main:app --reload --port 8002

# Run round-trip test
vitest run src/app/generic-demo/__tests__/roundtrip-audio-contract.test.ts
```

See `roundtrip-audio-contract.test.ts` for automated validation of these wire formats.

---

**Document Version:** Phase 4 (Generic Demo Page)
**Last Verified:** 2026-06-19 (with live services at localhost:8001 and localhost:8002)
