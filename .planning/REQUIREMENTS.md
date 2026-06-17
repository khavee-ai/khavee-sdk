# Requirements: Khavee Generic Voice Pipeline

**Defined:** 2026-06-17
**Core Value:** A developer can assemble a full voice pipeline (STT + LLM + TTS, with tool-calling) from independently swappable vendor adapters — without being locked into OpenAI for every stage.

## v1 Requirements

### Core Interfaces & Tool-Calling

- [ ] **CORE-01**: SDK exposes VADProvider, STTProvider, LLMProvider, and TTSProvider interfaces in `@khaveeai/core` that any vendor adapter can implement
- [ ] **CORE-02**: Each provider interface declares capability flags (e.g. `supportsStreaming`) so the orchestrator and consumers can branch correctly without redesigning the interface later
- [ ] **CORE-03**: Developer can register a tool with a plain object `{name, description, parameters, handler}` — no schema library (Zod, decorators) required
- [ ] **CORE-04**: SDK normalizes tool-call results to one shape (`{success, message}`) regardless of which LLM vendor produced the call
- [ ] **CORE-05**: Tool-execution logic is defined once in `@khaveeai/core` and reused by both the new generic pipeline and existing realtime providers, removing the current byte-for-byte `ToolExecutor.ts` duplication
- [ ] **CORE-06**: The LLMProvider tool-calling interface avoids encoding OpenAI-specific field names (e.g. `tool_call_id`) so a future non-OpenAI LLM vendor adapter can implement it without an interface redesign

### Generic Pipeline Orchestrator

- [ ] **ORCH-01**: Developer can construct a working voice pipeline by passing `{vad, stt, llm, tts, tools}` to a single generic orchestrator class
- [ ] **ORCH-02**: The generic orchestrator implements the existing `RealtimeProvider` interface, so no changes are required in `@khaveeai/react` to use it
- [ ] **ORCH-03**: User's in-progress speech cancels in-flight LLM/TTS work (barge-in/interruption) via an `AbortSignal`-style hook on the active providers
- [ ] **ORCH-04**: The VAD-to-mic-reopen cooldown timing is a configurable value, not a hardcoded constant, so it can be tuned per TTS vendor's audio characteristics
- [ ] **ORCH-05**: The orchestrator normalizes all provider errors to `Error` instances and forwards them via callback without crashing the active session

### Python Backend Services

- [ ] **BACK-01**: `thonburian-stt` service accepts a posted audio utterance and returns Thai transcription text using `biodatlab/whisper-th-large-v3-combined` (or base variant)
- [ ] **BACK-02**: `thonburian-stt` detects and rejects/flags hallucinated transcriptions on short or silent audio segments (silence-trimming + repetition-ratio check), rather than always returning the model's raw output as valid speech
- [ ] **BACK-03**: `jai-tts` service accepts posted Thai text and returns synthesized WAV audio using the JaiTTS-F5TTS voice-cloning model
- [ ] **BACK-04**: `jai-tts` ships with a validated default Thai reference voice sample so a caller can synthesize speech by passing text alone, without supplying their own reference audio
- [ ] **BACK-05**: Both backend services load their model once at startup and gate concurrent inference requests (e.g. a semaphore) to avoid out-of-memory crashes under concurrent load

### Vendor Adapters & Demo

- [ ] **ADPT-01**: `ThonburianSTTProvider` implements `STTProvider` by calling the `thonburian-stt` service over HTTP, posting whole VAD-segmented utterances
- [ ] **ADPT-02**: `JaiTTSProvider` implements `TTSProvider` by calling the `jai-tts` service over HTTP and returning playable WAV audio
- [ ] **ADPT-03**: The audio wire format between the SDK and each backend service (sample rate, encoding) is explicitly documented and covered by a round-trip test
- [ ] **ADPT-04**: A working end-to-end demo runs a full voice pipeline using Thonburian STT + an LLM + JaiTTS TTS, including at least one registered tool call, proving STT and TTS can come from different non-OpenAI vendors simultaneously
- [ ] **ADPT-05**: Documentation/example shows a beginner how to implement a custom STT or TTS vendor adapter and register a tool, using only the patterns established in this milestone

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Vendor Expansion

- **VEND-01**: Real AWS Bedrock STT provider adapter
- **VEND-02**: Real Google Gemini TTS provider adapter
- **VEND-03**: True incremental/partial streaming STT and TTS for vendors that support it

### SDK Cleanup

- **CLEAN-01**: Migrate `openai-stt-tts` onto the new generic provider interfaces
- **CLEAN-02**: Token-budget-aware (tiktoken-style) conversation history trimming
- **CLEAN-03**: Reconcile the orphaned legacy `LLMProvider`/`TTSProvider` types in `packages/core/src/types/mock.ts`

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Refactoring `openai-stt-tts` onto the new interfaces | Left untouched this milestone — it's the only tested provider; avoid regression risk while the new abstraction is unproven |
| Real AWS Bedrock and Google Gemini adapters | Only illustrative of "any vendor" this milestone; interfaces must support them later, but no adapters are built now |
| `openai-realtime`'s full-duplex WebRTC provider | Separate architectural concern (single full-duplex session, no discrete STT/LLM/TTS stages) — not modified |
| True streaming/partial transcription or synthesis | Neither Thonburian Whisper nor JaiTTS support it natively — would force fake streaming with no latency benefit |
| Resolving the empty `packages/providers/azure` placeholder | Unrelated pre-existing debt, not part of this milestone |
| Zod or other schema-library-based tool parameter validation | Violates the beginner-DX constraint — plain objects only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| CORE-05 | Phase 1 | Pending |
| CORE-06 | Phase 1 | Pending |
| ORCH-01 | Phase 2 | Pending |
| ORCH-02 | Phase 2 | Pending |
| ORCH-03 | Phase 2 | Pending |
| ORCH-04 | Phase 2 | Pending |
| ORCH-05 | Phase 2 | Pending |
| BACK-01 | Phase 3 | Pending |
| BACK-02 | Phase 3 | Pending |
| BACK-03 | Phase 3 | Pending |
| BACK-04 | Phase 3 | Pending |
| BACK-05 | Phase 3 | Pending |
| ADPT-01 | Phase 4 | Pending |
| ADPT-02 | Phase 4 | Pending |
| ADPT-03 | Phase 4 | Pending |
| ADPT-04 | Phase 5 | Pending |
| ADPT-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-17*
*Last updated: 2026-06-17 after roadmap creation*
