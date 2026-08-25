# Phase 14: xAI Realtime Provider — Research

**Date:** 2026-08-25

## xAI Realtime API Summary

### Transport
- **WebSocket only** (NOT WebRTC)
- Endpoint: `wss://api.x.ai/v1/realtime?model=grok-voice-latest`
- Audio sent/received as base64 PCM in JSON messages (or binary frames with `transport: "binary"`)

### Authentication
- **Ephemeral tokens** (browser): `POST https://api.x.ai/v1/realtime/client_secrets` → short-lived token passed as WebSocket subprotocol `["xai-client-secret." + token]`
- **API key** (server): `Authorization: Bearer <key>` header on WebSocket upgrade

### Models
| Model | Cost |
|-------|------|
| `grok-voice-latest` (alias) | → grok-voice-think-fast-2.0 |
| `grok-voice-think-fast-2.0` | $0.08/min |

### Audio Format
- PCM16, 24kHz, mono (default)
- Also supports: opus, pcmu, pcma
- Configurable in `session.update`

### Event Schema (95% compatible with OpenAI)

**Client → Server (identical names):**
- `session.update` ✓
- `input_audio_buffer.append` ✓
- `input_audio_buffer.commit` ✓
- `input_audio_buffer.clear` ✓
- `conversation.item.create` ✓
- `response.create` ✓
- `response.cancel` ✓

**Server → Client (mostly identical):**
- `session.created` / `session.updated` ✓
- `input_audio_buffer.speech_started` / `speech_stopped` ✓
- `response.created` / `response.done` ✓
- `response.output_audio.delta` ✓ (check if OpenAI uses `response.audio.delta`)
- `response.function_call_arguments.done` ✓
- `conversation.item.input_audio_transcription.updated` ✗ (OpenAI: `.delta` — cumulative vs incremental)

**xAI-only features:**
- `force_message` — inject text without creating conversation item
- `resumption` — reconnect with `?conversation_id=<id>` (30min TTL)
- `replace` — pronunciation map
- Per-response `instructions` override
- `reasoning.effort` per response
- Built-in tools: `web_search`, `x_search`, `file_search`, `mcp`

### Key Differences from OpenAI

| Aspect | OpenAI | xAI |
|--------|--------|-----|
| Transport | WebRTC (RTCPeerConnection + SDP) | WebSocket |
| Audio delivery | Native WebRTC media track | Base64 in JSON or binary frames |
| Auth endpoint | `/v1/realtime/sessions` | `/v1/realtime/client_secrets` |
| Transcription events | `.delta` (incremental) | `.updated` (cumulative) |
| VAD extras | — | `idle_timeout_ms` (re-engage) |

## Lip-Sync Parity Requirements

From exploring `OpenAIRealtimeProvider`:

1. **AnalyserNode**: fftSize=2048, smoothingTimeConstant=0.6
2. **Audio routing**: MediaStreamSource → AnalyserNode (NOT connected to destination — analysis only; playback via separate HTMLAudioElement)
3. **getAudioAnalyser()**: returns `{ analyser: AnalyserNode, audioContext: AudioContext } | null`
4. **onAudioData**: fires ONCE with `(analyser, audioContext)` when remote audio track arrives
5. **chatStatus**: transitions drive lip-sync start/stop in React layer:
   - "speaking" → start lip-sync analysis
   - anything else → reset mouth expressions to zero

For the WebSocket provider, the approach differs slightly:
- No MediaStream (audio is base64 PCM chunks, not a WebRTC track)
- Instead: decoded PCM → AudioBufferSourceNode → GainNode → AnalyserNode + destination
- Streaming playback via scheduled AudioBufferSourceNodes with precise timing
- Same AnalyserNode settings ensure MFCC/DTW phoneme detection works identically

## Architecture Decision

**New standalone provider** — cannot reuse OpenAIRealtimeProvider because:
1. It's built entirely around RTCPeerConnection/SDP/media tracks
2. Audio arrives via WebRTC media track → HTMLAudioElement
3. Mic audio sent via RTCRtpSender.replaceTrack()
4. None of these concepts exist in a WebSocket transport

**Shared patterns that can be replicated:**
- Session configuration shape (session.update payload)
- Tool registration and execution flow
- Conversation state management
- Event handling (most names/schemas identical)
- RealtimeProvider interface satisfaction
