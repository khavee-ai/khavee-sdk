# Project Research Summary

**Project:** Khavee Generic Voice Pipeline (`generic-stt-tts` milestone)
**Domain:** Composable, pipecat-style voice AI pipeline (TypeScript SDK) + lightweight self-hosted Python ML inference services (Whisper-class Thai STT, F5-TTS-class Thai voice-cloning TTS)
**Researched:** 2026-06-17
**Confidence:** MEDIUM-HIGH

## Executive Summary

This milestone generalizes khavee-sdk's existing OpenAI-only `openai-stt-tts` provider into a pipecat-style composable pipeline: four swappable interfaces (`VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`) wired together by one generic orchestrator, proven end-to-end with two real non-OpenAI, non-English vendors — a self-hosted Thonburian Whisper STT service and a self-hosted JaiTTS (F5-TTS-based) voice-cloning TTS service. Experts in this space (pipecat, LiveKit Agents, Vocode) converge on the same boundary philosophy — one interface per pipeline stage, a generic orchestrator that composes them, tool-calling as a core LLM capability — but their frame/queue machinery exists to support continuous, mid-stream-interruptible audio that neither target vendor actually supports. The correct move, confirmed across all four research files, is to adopt pipecat's *conceptual* service boundaries while explicitly rejecting its *streaming-frame* mechanics: build "whole utterance in, whole result out" as the default contract, not a special case bolted onto a streaming-first design.

The recommended approach keeps the TypeScript side dependency-free (plain interfaces, no new runtime deps, no Zod for tool schemas — already decided in PROJECT.md and validated as differentiated versus competitors) and reuses every existing convention (`fetch()`-based HTTP clients, WAV blob production, `{role, content}` message arrays, try/catch-normalize-to-Error). The Python side is straightforward: FastAPI + Uvicorn + `transformers>=5.3.0` (critical: ignore the Thonburian model card's stale, CVE-vulnerable `4.37.2` pin) for STT, and a vendored `FlowTTSPipeline` (F5-TTS + custom XLM-R duration predictor) for TTS, both behind a simple multipart/JSON HTTP contract matching existing `STTClient.ts`/`TTSPlayer.ts` patterns.

The key risks all stem from one root cause: only one vendor (OpenAI) currently exists to validate the abstraction against, so it's easy to accidentally bake OpenAI-shaped assumptions into "generic" interfaces — on tool-calling semantics (multi-call support, result round-trip shape), on streaming assumptions, and on VAD/TTS-loopback timing constants tuned only for OpenAI's audio characteristics. A second, structurally different risk class is specific to the two self-hosted models: Whisper-family hallucination on short/silent VAD-segmented clips, and F5-TTS's extreme sensitivity to reference-voice audio quality. Both are well-documented, known failure modes with established mitigations (silence-trimming + repetition detection; reference-clip validation checklist) that must be designed in from the start, not patched on after a "looks done" demo.

## Key Findings

### Recommended Stack

**TypeScript SDK side:** No new runtime dependencies. The orchestrator, four provider interfaces, and `ToolExecutor` dedup are all plain TS, matching the existing monorepo's zero-dependency-by-default convention. Plain interfaces replace the need for any pipecat-style `Frame`/`FrameProcessor` machinery — this is an interface-design problem, not a new-tech problem.

**Python serving side:** FastAPI 0.137.x + Uvicorn 0.49.x is the unambiguous standard for wrapping ML inference as HTTP — async-native, automatic validation, native multipart/streaming-response support. `uv` is recommended for dependency management (10-100x faster than pip/Poetry for large ML wheels).

**Core technologies:**
- Plain TS interfaces + hand-rolled orchestrator — replicates pipecat's `FrameProcessor`/`STTService`/`LLMService`/`TTSService` boundary philosophy without its queue/frame-direction machinery; this project's 4 fixed stages don't need an arbitrary pipeline graph
- `@ricky0123/vad-web` (already in repo) — proven browser VAD, no reason to change
- FastAPI + Uvicorn — async-native ML-inference HTTP boundary; Flask would require manual threadpool management to avoid blocking
- `transformers>=5.3.0,<6` (pin explicitly) — the Thonburian model card's stated `4.37.2` falls inside CVE-2026-4372's RCE vulnerability window (patched in 5.3.0); no breaking API changes affect the ASR pipeline task across this jump
- `f5-tts`/vendored `FlowTTSPipeline` ("ThonburianTTS" repo) — JaiTTS's custom XLM-R duration predictor requires this specific wrapper, not the vanilla `f5_tts.infer` CLI
- `soundfile` over `librosa` for WAV I/O — avoids pulling in SciPy/numba just to read/write WAV files
- Streaming-chunked HTTP (whole-utterance POST), not WebSocket/WebRTC — neither model supports true incremental streaming, so a persistent socket would add connection-lifecycle complexity with zero latency benefit

### Expected Features

**Must have (table stakes):**
- Per-stage provider interfaces (`VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`) with one core method each
- Generic pipeline orchestrator composing any `{vad, stt, llm, tts}` combination
- Tool/function-calling as a core LLM capability, not bolted on per-vendor — plain-object `{name, description, parameters, handler}`, no Zod/decorators
- Tool result format normalized regardless of vendor (`{success, message}`, already exists in `ToolExecutor`)
- Per-stage configuration objects (compose, don't flatten — already flagged as an anti-pattern in the existing codebase)
- Barge-in/interruption support (cancel in-flight LLM/TTS work via `AbortSignal`-style hooks)
- Errors normalized to `Error` instances, forwarded via callback, never thrown to crash the session
- Explicit audio format/sample-rate contract between stages (16kHz mono PCM16 WAV in for STT, 24kHz mono PCM16 WAV out for TTS)
- Streaming-vs-chunked capability declaration per stage (simple boolean flag, cheap now, expensive to retrofit)
- Vendor-neutral conversation/message history format (`{role, content}[]`, already exists internally)

**Should have (differentiators):**
- Zero-schema-library tool registration — genuine differentiator versus LiveKit JS (requires Zod) and most TS agent frameworks
- First-class avatar/lipsync event surface preserved generically across any TTS vendor — khavee's actual product wedge; no competitor researched (pipecat/LiveKit/Vocode/Vapi) has this
- First reference implementation using fully non-Western, Thai-native vendors — proves the abstraction isn't OpenAI-shaped in disguise
- Mixed-vendor pipelines (STT vendor A + TTS vendor B + LLM vendor C) as a documented, demoed flagship use case
- Single shared `ToolExecutor` removing the current byte-for-byte duplication tech debt

**Defer (v2+):**
- True incremental/partial streaming STT/TTS — explicitly out of scope; would force fake streaming over backends that don't support it
- Real Bedrock/Gemini provider adapters — design interfaces to support them later, don't build now
- Migrating `openai-stt-tts` onto the new generic interfaces — defer until interfaces are proven across 2+ real adapters
- Token-budget-aware (tiktoken-style) history trimming — vendor-specific tokenizer differences make this deeper than this milestone's scope
- Reconciliation of the orphaned legacy `LLMProvider`/`TTSProvider` in `mock.ts` — unrelated cleanup, not this milestone's concern

### Architecture Approach

Adopt pipecat's *boundary philosophy* (one swappable interface per stage, generic orchestrator composes them) without its *frame-passing mechanism* (no `Frame`/`FrameDirection`/queue machinery — that exists to support continuous bidirectional streaming with mid-utterance interruption, which this project's whole-utterance HTTP reality doesn't need or support). Interfaces live in `@khaveeai/core` (never in `generic-stt-tts` itself) so future vendor adapters depend only on core, mirroring the existing "provider packages never depend on each other" convention.

**Major components:**
1. `VADProvider` — event-emitter interface (`start()`, `stop()`, `onUtteranceReady`), NOT a request/response transform like the other three; matches existing `AudioRecorder.ts` shape exactly. Pipecat itself treats VAD as a transport-layer plugin, not a peer pipeline stage — forcing it into the same shape as STT/LLM/TTS is a documented anti-pattern.
2. `STTProvider`/`LLMProvider`/`TTSProvider` — plain async-method interfaces (`transcribe()`, `complete()`, `speak()`) returning complete results, matching the "buffer whole utterance, POST whole, get whole response" transport reality
3. `GenericSTTTTSProvider` (orchestrator) — implements `RealtimeProvider` unchanged (no downstream changes needed in `@khaveeai/react`), takes `{vad, stt, llm, tts, tools}` as constructor args, runs the turn loop generically (mirrors `OpenAISTTTTSProvider`'s `runTurn`/`runTurnFromText` almost verbatim)
4. `ToolExecutor` (promoted to `packages/core/src/pipeline/`) — shared dispatch logic, must be redesigned (not just relocated) to avoid baking in OpenAI-specific tool-call semantics
5. `ThonburianSTTProvider`/`JaiTTSProvider` — thin HTTP client adapters, no orchestration logic, implementing one interface each

Suggested build order (from ARCHITECTURE.md): core interfaces first → `ToolExecutor` promotion (parallel) → generic orchestrator (testable against adapted existing OpenAI helper classes before Python services exist) → Python services (parallel, independent of TS work) → thin adapters → end-to-end demo wiring.

### Critical Pitfalls

1. **Designing the abstraction around OpenAI (the easy vendor), not Thonburian/JaiTTS (the hard ones)** — Build the non-streaming path and both real adapters first; verify OpenAI's streaming-capable path can be expressed as a specialization, not the template everything else gets forced into.
2. **Tool-calling abstraction silently OpenAI-shaped** — With only one real LLM vendor in scope, it's easy to promote `ToolExecutor` with cosmetic renaming only. Before finalizing, sketch (even as a comment) how Anthropic/Gemini's multi-tool-call round-trip and JSON-schema constraints (no bare `items: {}`, no top-level `$ref`) would map onto the same interface — and avoid encoding OpenAI-specific field names (`tool_call_id`) into core types.
3. **Whisper hallucination on short/silent VAD-segmented clips** — A well-documented Whisper failure mode (repeated-phrase hallucination) triggered specifically by the short, separately-cut audio segments this architecture produces by design. Must trim silence and tune/check `no_speech_threshold`/`compression_ratio_threshold` inside `thonburian-stt` itself, and return a distinguishable no-speech signal rather than always treating 200 OK as valid speech.
4. **GPU-resident models treated as stateless request handlers** — Load each model once at startup (not per-request, not per-worker), single worker per GPU, gate concurrency with an explicit semaphore (`Semaphore(1)` is an acceptable default for this milestone's demo scale) to avoid OOM crashes that take down the service for all users.
5. **VAD-loopback cooldown logic copy-pasted instead of re-validated** — The existing 500ms magic-number cooldown was tuned empirically for OpenAI's TTS audio tail. Reusing it verbatim for JaiTTS risks either insufficient (loopback recurs) or excessive (sluggish turn-taking) behavior; make it configurable and explicitly test against JaiTTS's actual playback characteristics.

## Implications for Roadmap

Based on combined research, suggested phase structure:

### Phase 1: Core Interfaces & Tool-Calling Foundation
**Rationale:** Everything else in the milestone depends on these types; no adapter or orchestrator work can meaningfully start until the contract is fixed, and Pitfall 1/Pitfall 2 are both interface-design-time decisions that are expensive to retrofit later.
**Delivers:** `VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`, `Tool`, `ToolCall` types in `@khaveeai/core`; promoted/redesigned `ToolExecutor`.
**Addresses:** Per-stage provider interfaces, plain-object tool registration, normalized tool result format, vendor-neutral message history shape (all FEATURES.md table stakes).
**Avoids:** Pitfall 1 (streaming-first bias baked into the base contract) and Pitfall 2 (OpenAI-shaped tool-calling abstraction) — both must be explicitly checked against a written second-vendor sketch (Anthropic/Gemini) before this phase is considered done, even though no real second adapter ships this milestone.

### Phase 2: Generic Pipeline Orchestrator
**Rationale:** Can be built and tested against adapted existing OpenAI helper classes (reusing `STTClient`/`ChatClient`/`TTSPlayer` logic as first interface implementations) before either Python service is ready — de-risks the orchestrator independently and lets this phase run in parallel with Phase 3.
**Delivers:** `GenericSTTTTSProvider` implementing `RealtimeProvider`, composing `{vad, stt, llm, tts, tools}`, with the turn-state machine, history trimming, and configurable (not hardcoded) mic-cooldown logic.
**Uses:** Plain interfaces + hand-rolled orchestrator (STACK.md), composed config objects not flat inheritance (ARCHITECTURE.md Anti-Pattern 3).
**Implements:** Pattern 2 (generic orchestrator composed from stage instances) and Pattern 1 (interface-per-stage, uniform async signature) from ARCHITECTURE.md.

### Phase 3: Python Backend Services (thonburian-stt, jai-tts)
**Rationale:** Entirely independent of the TypeScript work — only needs the HTTP contract agreed up front (audio format, request/response shape) — so it can proceed in parallel with Phases 1-2. This is also where the highest-severity, hardest-to-retrofit model-specific pitfalls live (hallucination, GPU OOM, reference-voice quality), so it needs dedicated, unhurried attention rather than being squeezed in alongside adapter wiring.
**Delivers:** `thonburian-stt` FastAPI service (`transformers>=5.3.0` pinned, silence-trimming + repetition-ratio rejection, model loaded once at startup, semaphore-gated concurrency) and `jai-tts` FastAPI service (vendored `FlowTTSPipeline`, validated/QA'd bundled default Thai reference voice, same startup/concurrency safeguards).
**Addresses:** Thonburian STT backend, JaiTTS backend (FEATURES.md P1 items).
**Avoids:** Pitfall 3 (Whisper hallucination on silence), Pitfall 4 (GPU OOM under concurrency), Pitfall 5 (unvalidated default reference voice quality).

### Phase 4: Vendor Adapters & Audio Contract
**Rationale:** Depends on Phase 1's interfaces and Phase 3's services being reachable; thin HTTP clients are the simplest layer in the milestone, but the audio wire-format contract must be pinned and tested explicitly here, before either side is assumed "working."
**Delivers:** `ThonburianSTTProvider`/`JaiTTSProvider` adapter classes, a documented and round-trip-tested audio format contract (16kHz mono PCM16 WAV in, 24kHz mono PCM16 WAV out).
**Addresses:** Audio format/sample-rate negotiation, streaming capability flags (FEATURES.md).
**Avoids:** Pitfall 7 (HTTP audio framing mismatches discovered only at integration time) — add an explicit round-trip fixture test, not just "200 OK" checks.

### Phase 5: End-to-End Mixed-Vendor Demo & Documentation
**Rationale:** The actual proof point of the milestone; depends on everything above. This is also where Pitfall 6 (VAD-loopback cooldown timing) surfaces concretely, since it requires JaiTTS's real audio tail characteristics to validate against.
**Delivers:** Working Thonburian STT + any LLM + JaiTTS pipeline with tool-calling, multi-turn cooldown validated against JaiTTS's actual playback, beginner-facing documentation/examples for wiring a custom vendor and registering a tool.
**Addresses:** Mixed-vendor pipelines, end-to-end demo, beginner documentation (FEATURES.md P1 items).
**Avoids:** Pitfall 6 (copy-pasted VAD-loopback timing) — explicitly budget multi-turn testing against JaiTTS, not just OpenAI.

### Phase Ordering Rationale

- Interfaces must come first because every other deliverable (orchestrator, adapters, even the Python services' HTTP contract) depends on the shape decided here — and two of the highest-cost-to-retrofit pitfalls (streaming bias, OpenAI-shaped tool-calling) are interface-design-time decisions.
- The orchestrator and the Python services can proceed in parallel (confirmed in ARCHITECTURE.md's Suggested Build Order) since the orchestrator can be validated against adapted existing OpenAI helpers while the Python services are built independently — only the HTTP contract needs early agreement.
- Adapters are deliberately a separate, later phase from the services themselves because the audio-format contract (Pitfall 7) needs to be pinned and tested as its own concern, not discovered implicitly while building the services.
- The end-to-end demo is last because it's the only phase that can actually exercise Pitfall 6 (cooldown timing against JaiTTS's real audio) and validate that the whole multi-vendor proof point holds together, not just that each piece works in isolation.

### Research Flags

Needs research during planning (`--research-phase`):
- **Phase 3 (Python backend services):** Sparse, narrowly-validated deployment patterns for these two specific models — the vendored `FlowTTSPipeline`/ThonburianTTS repo's exact dependency pins were not directly inspectable during this research (flagged MEDIUM confidence in STACK.md), and Whisper hallucination mitigation thresholds need empirical tuning, not just documentation lookup.
- **Phase 1 (tool-calling interface):** No second real LLM vendor exists yet to validate against; needs deliberate research into Anthropic/Gemini tool-calling wire formats even without building real adapters, to avoid Pitfall 2.

Phases with standard, well-documented patterns (can skip deep research-phase):
- **Phase 2 (generic orchestrator):** Direct generalization of already-working `OpenAISTTTTSProvider` logic; pattern is proven in this exact codebase already.
- **Phase 4 (adapters):** Thin HTTP clients following existing `STTClient.ts`/`TTSPlayer.ts` conventions almost exactly; well-precedented within this repo.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH (TS side) / MEDIUM-HIGH (Python side) | TS side directly extends an already-mapped codebase. Python side verified against current PyPI/official docs (FastAPI, Uvicorn, transformers versions all HIGH via direct fetch); the two specific models (Thonburian Whisper, JaiTTS's `FlowTTSPipeline`) have narrower, less-verified community deployment patterns — vendored repo's exact dependency file was not directly inspected. |
| Features | MEDIUM-HIGH | Cross-verified across pipecat, LiveKit Agents, Vocode, Vapi docs/search; no Context7 entries available for these specific frameworks, so individual claims rely on WebSearch-verified official docs/GitHub rather than a single authoritative source. |
| Architecture | HIGH (pipecat core abstractions) / MEDIUM (HTTP integration patterns) | Pipecat's `FrameProcessor`/`Pipeline`/service class hierarchy verified via official docs + GitHub source directly. Cross-language TS↔Python HTTP integration recommendations are general best practice, not pipecat-specific (pipecat itself is WebSocket/streaming-first end-to-end), so MEDIUM confidence there. |
| Pitfalls | MEDIUM-HIGH | Architecture/abstraction pitfalls verified against pipecat docs and GitHub issues; Whisper hallucination and GPU-OOM patterns verified against multiple independent community/practitioner sources; codebase-specific risks (VAD-loopback cooldown, ToolExecutor duplication) verified directly against this repo's own `CONCERNS.md`. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Vendored `FlowTTSPipeline`/ThonburianTTS repo's exact dependency pins:** Not directly inspectable during research (confirmed `FlowTTSPipeline` import path exists, but not its `requirements.txt`/`pyproject.toml`). Resolve during Phase 3 implementation by pulling the actual repo and reconciling its pins against the `f5-tts`/`torch` versions recommended here.
- **Tool schema shape — flat custom map vs. real JSON Schema:** FEATURES.md flags that khavee's current `RealtimeTool.parameters` is a custom flat map, not real JSON Schema, while PROJECT.md's stated goal implies JSON-Schema-shaped parameters. This is an open design decision (not a research gap) that must be resolved during Phase 1 before any adapter's translation logic is written.
- **F5-TTS streaming-output latency claims:** Based on one GitHub issue's discussion (MEDIUM confidence, not benchmarked), used only to confirm the already-decided "whole-utterance HTTP" choice is pragmatic — not load-bearing for any other decision, but worth a quick empirical sanity check during Phase 3.
- **Exact `torch` patch version compatibility across `transformers>=5.3.0` and `f5-tts`/vendored repo:** PyPI metadata gave a directionally-correct range (2.6+ for transformers, up to 2.8.0 for f5-tts) but not an exact validated pin — resolve empirically when scaffolding Phase 3's `requirements.txt`/`uv` lockfile.
- **VAD-loopback cooldown timing for JaiTTS specifically:** Cannot be researched in the abstract — requires empirical testing against JaiTTS's actual audio tail once the service exists (Phase 5), flagged explicitly as a "must validate, don't assume" item.

## Sources

### Primary (HIGH confidence)
- pypi.org/project/transformers, fastapi, uvicorn, f5-tts — direct PyPI version/metadata fetches
- huggingface.co/biodatlab/whisper-th-large-v3-combined model card — direct fetch
- CVE-2026-4372 coverage (penligent.ai, pluto.security, techrepublic.com, siliconangle.com) — cross-referenced, consistent
- docs.pipecat.ai (Pipeline & Frame Processing, Function Calling, SileroVADAnalyzer, Text to Speech) — official docs
- github.com/pipecat-ai/pipecat source (`frame_processor.py`, `runner.py`) — primary source read
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/codebase/CONCERNS.md`, `.planning/PROJECT.md` — existing repo ground truth, direct read

### Secondary (MEDIUM confidence)
- reference-server.pipecat.ai, deepwiki.com/pipecat-ai/pipecat, anam.ai pipecat frame-processing guide — cross-referenced across 3 sources, consistent
- docs.livekit.io, deepwiki.com/livekit/agents — LLM/STT/TTS plugin architecture
- docs.vocode.dev, github.com/vocodedev/vocode-core — component model comparison
- docs.vapi.ai (tools, custom-tools) — tool-calling wire format comparison
- dev.to (Whisper hallucination), github.com/openai/whisper#1606, arXiv 2501.11378 — Whisper hallucination root cause, multiple independent sources
- medium.com (Whisper microservice GPU OOM), jamwithai.substack.com (FastAPI concurrency mistake) — GPU-OOM/concurrency war stories
- builderai.tools (F5-TTS setup guide), arXiv 2602.00443 (RVCBench) — reference-voice quality constraints
- futuresearch.ai (LLM provider quirks) — cross-vendor tool-calling/JSON-schema differences (Gemini items.type, no top-level $ref)
- github.com/SWivid/F5-TTS issues #666, #1225 — sample rate convention, streaming latency caveat

### Tertiary (LOW confidence)
- huggingface.co/biodatlab/ThonburianTTS model card — search-result summary only, not direct page fetch (FlowTTSPipeline import path)
- "uv" 2026 ecosystem-adoption trend / Astral acquisition claim — directionally agreed across sources but not independently re-verified as a hard fact

---
*Research completed: 2026-06-17*
*Ready for roadmap: yes*
