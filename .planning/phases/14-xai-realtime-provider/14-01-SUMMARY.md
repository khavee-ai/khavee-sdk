---
phase: "14"
plan: "01"
subsystem: "providers/xai-realtime"
tags: [xai, grok, websocket, realtime, voice, audio, provider]
dependency_graph:
  requires: ["@khaveeai/core (RealtimeProvider interface, ToolExecutor, Conversation/ChatStatus types)"]
  provides: ["@khaveeai/providers-xai-realtime (XAIRealtimeProvider, XAIRealtimeConfig)"]
  affects: ["tsconfig.json (path alias)", "pnpm-lock.yaml (workspace dependency)"]
tech_stack:
  added: ["WebSocket transport for xAI Realtime API", "AudioWorklet for PCM mic capture", "AudioBufferSourceNode scheduling for streaming playback"]
  patterns: ["Base64 PCM encoding/decoding", "Blob URL AudioWorklet registration", "Gapless audio scheduling via nextScheduledTime"]
key_files:
  created:
    - packages/providers/xai-realtime/package.json
    - packages/providers/xai-realtime/tsconfig.json
    - packages/providers/xai-realtime/.gitignore
    - packages/providers/xai-realtime/src/index.ts
    - packages/providers/xai-realtime/src/types.ts
    - packages/providers/xai-realtime/src/XAIRealtimeProvider.ts
    - packages/providers/xai-realtime/src/AudioPlaybackEngine.ts
    - packages/providers/xai-realtime/src/MicCaptureEngine.ts
    - packages/providers/xai-realtime/src/pcm-capture-processor.ts
  modified:
    - tsconfig.json
    - pnpm-lock.yaml
decisions:
  - "Used Blob URL for AudioWorklet registration instead of requiring consumers to serve a static file"
  - "Used openai-insecure-api-key subprotocol for WebSocket auth (compatible with xAI's OpenAI-compatible API)"
  - "Inlined PCM capture processor source as a string constant for portability"
metrics:
  duration: "309s"
  completed: "2026-08-25"
  tasks_completed: 9
  files_created: 9
  files_modified: 2
---

# Phase 14 Plan 01: xAI Realtime Provider — Package Scaffold + WebSocket Transport + Audio Pipeline Summary

**One-liner:** WebSocket-based xAI Realtime voice provider with streaming PCM playback, AudioWorklet mic capture, and lip-sync-identical AnalyserNode (fftSize=2048, smoothingTimeConstant=0.6)

## What Was Built

A complete `@khaveeai/providers-xai-realtime` package implementing the `RealtimeProvider` interface for xAI's WebSocket-based Realtime API (Grok voice). The provider:

1. **AudioPlaybackEngine** — Decodes base64 PCM16 chunks to Float32, schedules gapless playback via AudioBufferSourceNodes, exposes an AnalyserNode with exact parity settings for MFCC/DTW lip-sync detection.

2. **MicCaptureEngine** — Captures microphone audio via AudioWorklet processor (registered dynamically via Blob URL), converts Float32 to PCM16, base64-encodes, and emits frames for WebSocket transmission.

3. **XAIRealtimeProvider** — Full implementation of all RealtimeProvider methods:
   - `connect()` / `disconnect()` — WebSocket lifecycle with ephemeral token support
   - `sendMessage()` — Text input triggering model response
   - `interrupt()` — Barge-in via response.cancel + audio stop
   - `registerFunction()` — Tool registration with session.update propagation
   - `toggleMicrophone()` / `enableMicrophone()` / `disableMicrophone()` / `isMicrophoneEnabled()`
   - `getAudioAnalyser()` — Returns AnalyserNode+AudioContext for lip-sync
   - Full event routing for all xAI server events
   - Tool calling: argument accumulation + execution + result feedback
   - Conversation state tracking with onConversationUpdate

## Verification Results

- `tsc --noEmit -p packages/providers/xai-realtime/tsconfig.json` — passes with zero errors
- `pnpm run build` — produces all expected dist/ files (declarations + JS)
- `pnpm install` — workspace resolution succeeds
- XAIRealtimeProvider structurally satisfies RealtimeProvider (TypeScript confirms)
- AnalyserNode: fftSize=2048, smoothingTimeConstant=0.6 (verified in source)
- onAudioData fires once via `hasEmittedAudioData` guard (verified in source)
- No RTCPeerConnection/WebRTC dependencies (WebSocket-only transport)

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 5ea1a61 | feat(14-01): add @khaveeai/providers-xai-realtime package |
| 607edc3 | chore(14-01): add .gitignore for xai-realtime package |
