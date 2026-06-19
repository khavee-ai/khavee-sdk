# Phase 3: Python Backend Services - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Two standalone, demo-simple FastAPI services in sibling repos outside khavee-sdk: `thonburian-stt` (`/Users/whitemalt/Documents/thonburian-stt`, audio in → Thai text out, via `biodatlab/whisper-th-large-v3-combined`) and `jai-tts` (`/Users/whitemalt/Documents/jai-tts`, Thai text in → WAV audio out, via the `JTS-AI/JaiTTS-F5TTS` voice-cloning model through a `FlowTTSPipeline`/"ThonburianTTS" inference repo). Both load their model once at startup. No khavee-sdk TypeScript code changes this phase — adapter classes (`ThonburianSTTProvider`, `JaiTTSProvider`) are Phase 4. Purpose is explicitly to prove the SDK's generic pipeline orchestrator works against real non-OpenAI vendors, not to ship production-hardened ML infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Robustness scope (descopes BACK-02 and BACK-05 from this phase)
- **D-01:** BACK-02 (hallucination rejection via silence-trim + repetition-ratio check) and BACK-05 (concurrency gating via semaphore) are **explicitly skipped** for this phase. User's call: this is a demo to prove the SDK abstraction works end-to-end, not a production-hardening exercise — added complexity (threshold tuning, semaphore sizing/queueing behavior) isn't worth it at this stage. `thonburian-stt` returns whatever the model produces, including on silent/short clips; both services have no built-in protection against simultaneous requests. **REQUIREMENTS.md must be updated** to mark BACK-02 and BACK-05 as deferred (not deleted) so the Phase 3 verifier doesn't fail for not implementing them, and so traceability stays honest about what's actually built.
- **Rationale:** explicit user tradeoff, not an oversight — revisit if/when this moves beyond demo use.

### API contract shape (previews, doesn't replace, Phase 4's wire-format pinning)
- **D-02:** `thonburian-stt` exposes `POST /transcribe` accepting a `multipart/form-data` file upload (raw WAV audio), returning `{"text": string}` JSON.
- **D-03:** `jai-tts` exposes `POST /synthesize` accepting `{"text": string}` JSON, returning raw `audio/wav` bytes directly in the response body (no base64, no JSON envelope around the audio).
- **Rationale:** simplest possible shape — matches what curl/Postman do by default, and is close to what `openai-stt-tts`'s `STTClient`/`TTSPlayer` already expect from their proxy endpoints. Phase 4 is responsible for formally pinning sample rate/encoding/channels with a round-trip test; this phase just needs *a* working format, reasonably chosen.

### Default reference voice (BACK-04)
- **D-04:** Source a permissively-licensed public Thai speech sample (e.g. from Common Voice Thai or an equivalent CC/public-domain dataset) to bundle as `jai-tts`'s default reference voice + reference text, rather than recording one ourselves.
- **Open for planner/executor:** exact dataset/clip selection, license file to include, and how the clip + transcript are packaged into the service (e.g. `assets/default_voice.wav` + `assets/default_voice.txt`).

### Runtime & deployment
- **D-05:** Both services run via plain `venv` + `uvicorn` — no Docker, no docker-compose. Each gets its own dependency manifest (`requirements.txt` or `pyproject.toml`).
- **D-06:** Both services auto-detect GPU at startup (`torch.cuda.is_available()` / Apple MPS check) and fall back to CPU — not hardcoded to CPU-only. Whisper-large and F5-TTS are both slow on CPU; auto-detection means the demo benefits from whatever hardware it runs on without code changes.

### Claude's Discretion
- Exact FastAPI app structure (single `main.py` vs `app/` package layout) — keep it simple given the demo framing; planner's call.
- Health-check endpoint, logging setup, port number conventions — not discussed, follow whatever's simplest/idiomatic for a small FastAPI service.
- Whether `thonburian-stt` and `jai-tts` share any project scaffolding/conventions between them (they're independent sibling repos, no shared package) — planner's call, but no shared abstraction is required.
- Error handling for malformed input (non-audio file, empty text) — not discussed in depth; follow FastAPI's standard validation/HTTP error conventions, no custom error envelope needed given D-01's descoped robustness.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level scope and decisions
- `.planning/PROJECT.md` — Core value, milestone-wide decisions (streaming-chunked HTTP protocol, model selections, dependency notes for the TTS inference repo)
- `.planning/REQUIREMENTS.md` — BACK-01..05 full text; **BACK-02 and BACK-05 status must be updated to reflect D-01's descoping decision**
- `.planning/ROADMAP.md` — Phase 3 goal and the five numbered success criteria (note: success criteria 2 and 5 correspond to the now-descoped BACK-02/BACK-05 and should be read as superseded by D-01 for this phase)
- `.planning/STATE.md` — Blockers/Concerns section already flags: sibling-path absolute-path requirement, and that the TTS inference repo's exact dependency pins are unknown until scaffolding is attempted

### Phase 2 deliverables (the consumer this phase's services must eventually plug into — Phase 4, not this phase)
- `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` — the orchestrator Phase 4's `ThonburianSTTProvider`/`JaiTTSProvider` adapters will plug into; not touched this phase but useful context for why the API shape (D-02/D-03) should stay simple and HTTP-adapter-friendly
- `.planning/phases/02-generic-pipeline-orchestrator/02-CONTEXT.md` — D-06's note that Phase 3/4 adapters are constructed in place of the OpenAI stand-ins, confirming this phase's services are the real target those adapters will wrap

### External model/library references (from PROJECT.md research, not yet independently re-verified)
- `biodatlab/whisper-th-large-v3-combined` (Hugging Face) — Thai Whisper ASR model, run via `transformers.pipeline("automatic-speech-recognition", ...)`, supports `chunk_length_s`, Apache 2.0
- `JTS-AI/JaiTTS-F5TTS` (Hugging Face) — F5-TTS-based Thai voice-cloning model with custom XLM-R duration predictor; requires a `FlowTTSPipeline` from a separate "ThonburianTTS" inference repo (deps: `torch`, `cached-path`, `librosa`, `transformers`, `f5-tts`, ffmpeg); zero-shot cloning needs reference audio + reference text + generation text

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
None within khavee-sdk — these are greenfield Python services in separate repos with no existing code (`ls` on both target directories returns empty).

### Established Patterns
- N/A for this phase's actual deliverable (Python/FastAPI, not TypeScript) — no khavee-sdk conventions apply to the service implementations themselves.

### Integration Points
- None yet — this phase produces standalone HTTP services with no caller. Phase 4 is where khavee-sdk's adapter classes become the first real callers, using D-02/D-03's API shape.

</code_context>

<specifics>
## Specific Ideas

- Multipart upload / raw WAV response, not JSON+base64 — explicit simplicity choice (D-02/D-03).
- GPU/MPS auto-detection with CPU fallback, not hardcoded CPU (D-06) — because the demo should be fast wherever it happens to run.
- No Docker — plain venv + uvicorn (D-05), fastest to iterate during scaffolding.

</specifics>

<deferred>
## Deferred Ideas

- **Hallucination rejection (BACK-02)** — descoped for this phase per D-01, not deleted. Revisit if this moves past demo use.
- **Concurrency gating (BACK-05)** — descoped for this phase per D-01, not deleted. Revisit if this moves past demo use.
- **Dockerization** — user chose plain venv+uvicorn for now; containerizing later (e.g. before any real deployment) is a reasonable future step, not in scope here.
- **Dataset-grade reference-voice provenance** (e.g. multiple voice options, attribution pipeline) — D-04 just needs one working default; broader voice-selection UX is out of scope.

</deferred>

---

*Phase: 3-Python Backend Services*
*Context gathered: 2026-06-19*
