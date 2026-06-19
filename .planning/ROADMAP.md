# Roadmap: Khavee Generic Voice Pipeline

## Overview

This milestone takes khavee-sdk from a single hardcoded OpenAI voice pipeline to a pipecat-style composable architecture proven against two real non-OpenAI vendors. The journey starts by fixing the contract — four vendor-neutral provider interfaces and a redesigned tool-calling system in `@khaveeai/core` — before any orchestration or vendor-specific code exists. With the contract fixed, a generic orchestrator is built and validated against adapted existing OpenAI helper logic (no new vendors needed yet). In parallel, two greenfield Python ML services (`thonburian-stt`, `jai-tts`) are scaffolded from scratch at their own sibling paths, hardened against their respective failure modes (Whisper hallucination, GPU OOM). Thin TypeScript adapter classes then bridge the two worlds over an explicitly documented, round-trip-tested HTTP audio contract. The milestone closes with the actual proof point: a working end-to-end demo mixing Thonburian STT + an LLM + JaiTTS TTS with tool-calling, plus beginner-facing documentation showing how to repeat the pattern with any other vendor.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Core Interfaces & Tool-Calling** - Define vendor-neutral VAD/STT/LLM/TTS interfaces and a redesigned, shared ToolExecutor in `@khaveeai/core` (completed 2026-06-17)
- [x] **Phase 2: Generic Pipeline Orchestrator** - Build the `{vad, stt, llm, tts, tools}`-composing orchestrator that implements `RealtimeProvider` (completed 2026-06-18)
- [x] **Phase 3: Python Backend Services** - Scaffold and harden `thonburian-stt` and `jai-tts` as standalone FastAPI services (completed 2026-06-19)
- [ ] **Phase 4: Vendor Adapters & Audio Contract** - Build thin HTTP adapter classes and pin the audio wire format with a round-trip test
- [ ] **Phase 5: End-to-End Mixed-Vendor Demo & Documentation** - Wire everything into a working mixed-vendor demo with tool-calling, plus beginner docs

## Phase Details

### Phase 1: Core Interfaces & Tool-Calling

**Goal**: `@khaveeai/core` exposes a fixed, vendor-neutral contract (four provider interfaces plus tool-calling types) that every later phase builds against without redesign
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06
**Success Criteria** (what must be TRUE):

  1. `VADProvider`, `STTProvider`, `LLMProvider`, and `TTSProvider` interfaces exist in `@khaveeai/core` and each declares capability flags (e.g. `supportsStreaming`) usable by a branching consumer
  2. A developer can register a tool by passing a plain object `{name, description, parameters, handler}` to a single `addTool()`-style call — no Zod, no decorators, no schema library import required
  3. Tool-call results are normalized to one shape (`{success, message}`) regardless of which LLM vendor produced the call, verified by a unit test exercising at least two differently-shaped mock vendor responses
  4. `ToolExecutor` exists once in `@khaveeai/core` (no byte-for-byte duplicate remains in `openai-stt-tts` or `openai-realtime`) and both existing packages compile/test green against the promoted version
  5. A written sketch (code comment or design note) demonstrates how a non-OpenAI vendor (Anthropic- or Gemini-shaped multi-tool-call round trip) maps onto the `LLMProvider` interface without needing OpenAI-specific field names like `tool_call_id`

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Promote ToolExecutor to core + Tool/ToolResult types + vitest infra + CORE-04 normalization test

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Four pipeline-stage interfaces + capability flags + vendor-neutral ToolCall + multi-vendor sketch + mock.ts collision rename
- [x] 01-03-PLAN.md — Delete duplicate ToolExecutors, repoint both providers to core, verify builds/tests green

### Phase 2: Generic Pipeline Orchestrator

**Goal**: A developer can assemble a complete voice pipeline from any combination of the Phase 1 interfaces using one orchestrator class, with no changes required in `@khaveeai/react`
**Depends on**: Phase 1
**Requirements**: ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05
**Success Criteria** (what must be TRUE):

  1. A developer can construct a working pipeline by passing `{vad, stt, llm, tts, tools}` to a single generic orchestrator class
  2. The orchestrator implements `RealtimeProvider` and runs unmodified through `@khaveeai/react`'s existing hook, verified by exercising it with adapted existing OpenAI helper classes (`STTClient`, `ChatClient`, `TTSPlayer`) as stand-in implementations
  3. Triggering new user speech mid-turn cancels in-flight LLM/TTS work via an `AbortSignal`-style hook, observable as the in-progress response stopping rather than completing
  4. The VAD-to-mic-reopen cooldown is set via a constructor/config value (not a hardcoded constant), and changing it changes observed mic-reopen timing
  5. A provider throwing or rejecting with a non-Error value (e.g. a string or vendor-specific error object) reaches the orchestrator's error callback as a normalized `Error` instance without crashing the active session

**Plans**: 7 plans
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — D-01 signal? on pipeline interfaces + additive helper-class exports from openai-stt-tts + scaffold the generic-stt-tts package

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Four OpenAI adapter classes (VAD/STT/LLM/TTS) wrapping the existing helpers, with tools+signal+tool_calls in the LLM adapter

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — GenericPipelineProvider orchestrator (barge-in, tool loop, config cooldown, error normalization) + adapter integration test + barrel exports

**Wave 4** *(gap closure — ORCH-03 BLOCKED → SATISFIED)*

- [x] 02-04-PLAN.md — Close ORCH-03 gap: fix CR-01 (abort guards in runTurnFromText + runTurn) and CR-02 (sendMessage AbortController ownership) + regression tests for stale-utterance discard and sendMessage-vs-concurrent-VAD coordination

**Wave 5** *(gap closure — GAP-02-05 registerFunction silent no-op)*

- [x] 02-05-PLAN.md — Close GAP-02-05: registerFunction() now appends a RealtimeTool→Tool-converted entry to a runtime tool list so post-construction tools are offered to the LLM (not just registered for dispatch) + regression test asserting the tool appears in the tools sent to llm.complete()

**Wave 6** *(gap closure — CR-03 multi-round tool-calling protocol violation)*

- [x] 02-06-PLAN.md — Close CR-03: tool-calling loop pushes the LLM's assistant/tool_calls turn into history (as an `[assistant_tool_calls] <json>` marker) before tool-result markers, and OpenAILLMAdapter.mapMessage() re-emits it as OpenAI's `{role:"assistant", content:null, tool_calls:[...]}` wire shape — fixing HTTP 400 on round 2+ of any real tool-calling conversation + orchestrator regression test (inspects round-2 args.messages) + adapter wire-shape unit test

**Wave 7** *(gap closure — WR-05/WR-06 marker-protocol robustness, post-02-06 code review)*

- [x] 02-07-PLAN.md — Close WR-05 + WR-06: make trimHistory() marker-pair-aware so the trim boundary never strands a `[tool_result ...]` message without its `[assistant_tool_calls]` predecessor (WR-05, reintroduces CR-03's HTTP-400 across long sessions); gate OpenAILLMAdapter.mapMessage()'s marker branches on message.role + wrap the assistant-branch JSON.parse in try/catch so ordinary user text starting with a marker prefix no longer crashes the turn (WR-06) + two regression tests

### Phase 3: Python Backend Services

**Goal**: Two standalone, production-shaped Python services exist (outside the khavee-sdk repo) that turn audio into Thai text and Thai text into audio, safely under concurrent load
**Depends on**: Nothing (independent of Phases 1-2; only needs the HTTP contract agreed, not built)
**Requirements**: BACK-01, BACK-02, BACK-03, BACK-04, BACK-05
**Success Criteria** (what must be TRUE):

  1. POSTing a Thai-speech audio utterance to `thonburian-stt` (at `/Users/whitemalt/Documents/thonburian-stt`) returns the correct Thai transcription text using `biodatlab/whisper-th-large-v3-combined` (or its base variant)
  2. POSTing a short or silent audio segment to `thonburian-stt` returns a distinguishable no-speech/rejected result rather than a hallucinated transcription treated as valid speech
  3. POSTing Thai text to `jai-tts` (at `/Users/whitemalt/Documents/jai-tts`) returns synthesized, audibly-correct WAV audio using the JaiTTS-F5TTS voice-cloning model
  4. Calling `jai-tts` with text alone (no reference audio supplied) succeeds and produces speech in the bundled default Thai reference voice
  5. Both services load their model exactly once at startup (not per-request) and reject or queue concurrent requests beyond a configured limit (e.g. semaphore) instead of crashing under concurrent load
     *(Note: the semaphore/concurrency-gating half of this criterion is descoped for Phase 3 per CONTEXT.md D-01 — only model-load-once is implemented; BACK-02 hallucination rejection is likewise deferred.)*

**Plans**: 2 plans
Plans:
**Wave 1** *(both services are independent sibling repos with zero file overlap — fully parallel)*

- [x] 03-01-PLAN.md — thonburian-stt FastAPI service: lifespan model-load-once (CUDA→MPS→CPU) + POST /transcribe (multipart→{"text"}) using biodatlab/whisper-th-large-v3-combined; BACK-01, BACK-02 (deferral documented), BACK-05 (load-once half)
- [x] 03-02-PLAN.md — jai-tts FastAPI service: flowtts git-install trust-boundary checkpoint + license-verified default Thai reference voice + FlowTTSPipeline signature verification + POST /synthesize (JSON text→raw WAV bytes); BACK-03, BACK-04, BACK-05 (load-once half)

### Phase 4: Vendor Adapters & Audio Contract

**Goal**: khavee-sdk can talk to both Python services through the Phase 1 interfaces over a pinned, tested audio wire format
**Depends on**: Phase 1, Phase 3
**Requirements**: ADPT-01, ADPT-02, ADPT-03
**Success Criteria** (what must be TRUE):

  1. `ThonburianSTTProvider` implements `STTProvider`, posts a whole VAD-segmented utterance to the `thonburian-stt` service over HTTP, and returns the transcribed text through the standard interface method
  2. `JaiTTSProvider` implements `TTSProvider`, posts text to the `jai-tts` service over HTTP, and returns audio the rest of the pipeline can play without additional conversion
  3. The audio wire format (sample rate, encoding, channels) for both directions is written down in one place (code doc comment or README section) and a round-trip test (encode → POST → decode → assert format) passes for both services

**Plans**: TBD

### Phase 5: End-to-End Mixed-Vendor Demo & Documentation

**Goal**: A real user can run one voice conversation that proves STT and TTS come from different non-OpenAI vendors simultaneously, with tool-calling working, and a beginner can repeat the pattern with their own vendor
**Depends on**: Phase 2, Phase 4
**Requirements**: ADPT-04, ADPT-05
**Success Criteria** (what must be TRUE):

  1. Running the demo executes a full voice turn — speech in via VAD, transcription via Thonburian STT, completion via an LLM, speech out via JaiTTS — and the audio played back is recognizably correct Thai speech
  2. The same demo session includes at least one registered tool that the LLM calls and whose result is reflected in the assistant's next reply
  3. The VAD-to-mic-reopen cooldown is validated (and adjusted via the Phase 2 config knob if needed) against JaiTTS's actual audio playback tail, not left at the value tuned for OpenAI's TTS
  4. Documentation/example exists showing a beginner how to implement a new custom `STTProvider` or `TTSProvider` and register a tool, using only the patterns established in Phases 1-4, with no missing steps when followed fresh

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

(Phase 2 may be planned/executed in parallel with Phase 3 once Phase 1 is complete, per research — both depend only on Phase 1, not on each other.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Interfaces & Tool-Calling | 3/3 | Complete   | 2026-06-17 |
| 2. Generic Pipeline Orchestrator | 7/7 | Complete   | 2026-06-18 |
| 3. Python Backend Services | 2/2 | Complete   | 2026-06-19 |
| 4. Vendor Adapters & Audio Contract | 0/TBD | Not started | - |
| 5. End-to-End Mixed-Vendor Demo & Documentation | 0/TBD | Not started | - |
