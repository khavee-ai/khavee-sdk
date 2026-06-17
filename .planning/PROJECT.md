# Khavee Generic Voice Pipeline

## What This Is

khavee-sdk currently ships an `openai-stt-tts` provider that hardcodes the STT → LLM → TTS voice pipeline to OpenAI's APIs. This project adds a new `generic-stt-tts` provider package that decomposes the pipeline into swappable interfaces (VAD, STT, LLM/completion with tool-calling, TTS) — pipecat-style — so any vendor can be plugged into any stage. Two new lightweight backend services (Thonburian Whisper STT, JaiTTS voice-cloning TTS) are built to prove the abstraction end-to-end with real non-OpenAI vendors.

## Core Value

A developer can assemble a full voice pipeline (STT + LLM + TTS, with tool-calling) from independently swappable vendor adapters — without being locked into OpenAI for every stage.

## Requirements

### Validated

- ✓ STT → LLM completion → TTS pipeline pattern works end-to-end — existing (`openai-stt-tts`)
- ✓ VAD-based audio segmentation into utterances — existing (`AudioRecorder.ts`)
- ✓ Tool/function-calling execution loop — existing (`ToolExecutor.ts`, duplicated across `openai-stt-tts` and `openai-realtime`)
- ✓ React hook integration for realtime voice UI (lipsync, status) — existing (`packages/react`)

### Active

- [ ] Define core provider interfaces: STTProvider, TTSProvider, VADProvider, and an LLMProvider with tool-calling support
- [ ] Build a generic pipeline orchestrator that composes any combination of these interfaces (pipecat-style)
- [ ] Beginner-friendly tool-calling API: plain object `{ name, description, parameters, handler }`, registered via a simple `addTool()`-style call
- [ ] Promote/dedupe the existing `ToolExecutor` into `packages/core`, adapted to the new generic LLMProvider interface
- [ ] New `packages/providers/generic-stt-tts` package implementing the orchestrator + interfaces
- [ ] New `thonburian-stt` backend service: Python server wrapping `biodatlab/whisper-th-large-v3-combined` (Thonburian Whisper v3), simple HTTP endpoint, audio in → Thai text out
- [ ] New `jai-tts` backend service: Python server wrapping `JTS-AI/JaiTTS-F5TTS` via F5-TTS's FlowTTSPipeline, bundled default Thai reference voice, simple HTTP endpoint, text in → WAV audio out
- [ ] khavee-sdk adapter classes (e.g. ThonburianSTTProvider, JaiTTSProvider) implementing the new interfaces, talking to these two services over streaming-chunked HTTP
- [ ] End-to-end demo: generic-stt-tts pipeline using Thonburian STT + an LLM + JaiTTS, proving STT/TTS can come from different, non-OpenAI, mixed vendors with tool-calling working
- [ ] Documentation/examples showing how a beginner wires up a custom STT/TTS vendor and registers a tool

### Out of Scope

- Refactoring `openai-stt-tts` onto the new interfaces — left untouched this milestone, may migrate later
- Real AWS Bedrock STT and Google Gemini TTS adapters — only used as illustrative examples; interfaces must support them later but no adapters are built now
- `openai-realtime`'s full-duplex WebRTC provider — separate concern, not modified
- True streaming (partial/incremental) transcription or synthesis — neither Thonburian Whisper nor JaiTTS support it natively; utterances are VAD-segmented and sent whole over HTTP
- Resolving the empty `packages/providers/azure` placeholder — unrelated pre-existing debt

## Context

- khavee-sdk is a pnpm monorepo: Next.js 15 demo app + `@khaveeai/core`, `@khaveeai/react`, and provider packages under `packages/providers/`.
- The existing `openai-stt-tts` provider (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`) already decomposes its pipeline into 4 concrete classes — `AudioRecorder` (VAD), `STTClient`, `ChatClient` (LLM), `TTSPlayer` — wired together in the constructor with a `ProviderDeps` injection seam currently only used by tests. This is the natural pattern to generalize into interfaces.
- The single seam the rest of the SDK depends on today is `RealtimeProvider` in `packages/core/src/types/realtime.ts`.
- `ToolExecutor.ts` is duplicated byte-for-byte between `openai-stt-tts` and `openai-realtime` (flagged in `.planning/codebase/CONCERNS.md`) — dedup target during this work.
- An orphaned legacy `LLMProvider`/`TTSProvider` abstraction already exists in `packages/core/src/types/mock.ts`, unrelated to `RealtimeProvider` and not wired into any current hook — should not be confused with the new interfaces being designed here; may need cleanup or reconciliation.
- `thonburian-stt` and `jai-tts` are currently empty sibling directories (`/Users/whitemalt/Documents/thonburian-stt`, `/Users/whitemalt/Documents/jai-tts`) — greenfield Python services to scaffold from scratch.
- Thonburian Whisper: `biodatlab/whisper-th-large-v3-combined` on Hugging Face, run via `transformers.pipeline("automatic-speech-recognition", ...)`, supports `chunk_length_s` for longer audio, Apache 2.0.
- JaiTTS: the GitHub repo (`JTS-AI-Team/JaiTTS`) is benchmark/eval code only — no deployable server. The actual model is `JTS-AI/JaiTTS-F5TTS` on Hugging Face, an F5-TTS-based Thai voice-cloning model with a custom XLM-R duration predictor, run via a `FlowTTSPipeline` from a "ThonburianTTS" inference repo (needs `torch`, `cached-path`, `librosa`, `transformers`, `f5-tts`, ffmpeg). Requires reference audio + reference text + generation text (zero-shot cloning) — needs a bundled default Thai voice sample for simple text-in/audio-out usage. Apache 2.0.
- Communication protocol decided: streaming-chunked HTTP — SDK buffers VAD-segmented utterances and POSTs each one to the backend service, rather than persistent WebSocket streaming (neither model supports true incremental/partial streaming).

## Constraints

- **Compatibility**: Must not break the existing `openai-stt-tts` provider or its consumers — it stays as-is, untouched, this milestone
- **Language boundary**: `thonburian-stt` and `jai-tts` are Python ML services; khavee-sdk is TypeScript — integration is over HTTP, not in-process bindings
- **Beginner DX**: Tool-calling API must be usable by a beginner with no extra schema library — plain JS objects only
- **Vendor neutrality**: Core interfaces (STTProvider, TTSProvider, VADProvider, LLMProvider) must be vendor-agnostic enough to support future Bedrock/Gemini adapters without redesign, even though those adapters aren't built now

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| New `generic-stt-tts` package instead of refactoring `openai-stt-tts` | Avoids risking the existing, working OpenAI provider; proves abstraction in isolation first | — Pending |
| Tool-calling: plain object + handler (no Zod/decorators) | Matches JSON-schema shape every LLM vendor's tool-calling API already expects; zero added dependency; simplest for beginners | — Pending |
| Tool-calling is a core LLMProvider capability, not per-provider opt-in | Bedrock/Gemini providers built later just implement it instead of needing a retrofit | — Pending |
| Promote/dedupe existing `ToolExecutor.ts` into `packages/core` | Already duplicated byte-for-byte across two packages (flagged in CONCERNS.md); reuse over rewrite | — Pending |
| STT/TTS backend protocol: streaming-chunked HTTP, not WebSocket | Neither Whisper nor F5-TTS-based JaiTTS support true incremental/partial transcription or synthesis — utterance-at-a-time HTTP matches reality | — Pending |
| Bedrock and Gemini adapters out of scope this milestone | They were illustrative of "any vendor" — Thonburian + JaiTTS are the real proof vendors; interface design alone must keep the door open | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-17 after initialization*
