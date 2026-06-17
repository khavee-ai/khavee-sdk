# Stack Research

**Domain:** Composable, pipecat-style voice AI pipeline (TypeScript SDK side) + lightweight Python ML inference services (Whisper-class STT, F5-TTS-class TTS)
**Researched:** 2026-06-17
**Confidence:** HIGH (TypeScript SDK side — directly extends an already-mapped codebase) / MEDIUM-HIGH (Python serving side — verified against current PyPI/official docs, but the two specific models have narrower community-validated deployment patterns)

## Recommended Stack

### Core Technologies — TypeScript SDK side (`generic-stt-tts`)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| TypeScript | 5.x (already pinned in repo) | Interface definitions for VADProvider/STTProvider/LLMProvider/TTSProvider | Matches existing monorepo; no reason to deviate — this is an interface-design problem, not a new-tech problem. |
| Plain interfaces, no framework | n/a | The "pipeline orchestrator" itself | Pipecat's own architecture is just a base class (`FrameProcessor`) plus typed message objects (`Frame`) flowing through a linear pipeline — there is no special runtime/library required to replicate this in TS. A `PipelineProvider` class that takes `{ vad, stt, llm, tts }` constructor args and calls them in sequence *is* the pipecat pattern, ported. Confirmed via pipecat's own docs/source: `STTService`/`LLMService`/`TTSService` are concrete subclasses of one `FrameProcessor` base, each exposing a narrow async contract, with no transport-layer framework involved in that part. (MEDIUM confidence — pipecat internals partially reconstructed from docs/source excerpts, not a full read of the codebase, but consistent across 3 independent sources.) |
| `@ricky0123/vad-web` | ^0.0.30 (already in repo) | Browser VAD — becomes the concrete `VADProvider` default implementation | Already proven in this codebase (`AudioRecorder.ts`). No reason to introduce `silero-vad`-via-WASM or anything else — this library already wraps Silero VAD via ONNX Runtime Web and is the de facto standard for browser-side VAD in 2025/2026 JS voice projects (confirmed via existing STACK.md and architecture doc; this research did not need to re-verify it). |
| Native `fetch` + `AbortController` | Browser built-in | HTTP transport from STTProvider/TTSProvider implementations to backend services | Existing `STTClient`/`ChatClient`/`TTSPlayer` already use plain `fetch()` — no HTTP client library (axios, ky, ofetch) is used or needed in the browser-side provider helpers (axios is only used in `@khaveeai/core`'s `KhaveeClient` for the *hosted platform* API, a different concern). Keep this pattern: zero new HTTP dependency for the new provider package. |
| Plain object + handler for tools (no Zod) | n/a | Tool-calling registration API (`addTool({ name, description, parameters, handler })`) | Already decided in PROJECT.md Key Decisions. Confirmed as the right call: every major LLM vendor's tool/function-calling API (OpenAI, Anthropic, Gemini, Bedrock Converse) already expects a JSON-Schema-shaped `parameters` object — wrapping it in Zod just to re-derive JSON Schema adds a dependency and an indirection beginners don't need. Keep `ToolExecutor` dependency-free. |

### Supporting Libraries — TypeScript SDK side

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | — | Deliberately avoid adding a new runtime dependency to `@khaveeai/core` or the new `generic-stt-tts` package for this milestone. The orchestrator, interfaces, and `ToolExecutor` dedup are all plain TS. |
| `vitest` ^2.0.0 (already in repo, used by `openai-stt-tts`) | existing | Unit tests for the new orchestrator + adapters | Match the existing `openai-stt-tts` package's test setup exactly (it already has a `ProviderDeps`-style injection seam) rather than introducing Jest (used elsewhere in the monorepo but inconsistently) for yet another package. |

### Core Technologies — Python serving side (`thonburian-stt`, `jai-tts`)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| Python | 3.11 (3.10 minimum) | Runtime for both services | F5-TTS's PyPI package and current `transformers`/`torch` both require 3.10+; 3.11 is the safe, widely-supported choice for new ML services in 2026 (not yet 3.13, which has slower wheel availability for some torch/CUDA builds). HIGH confidence — verified via PyPI pages for `f5-tts` and `transformers`. |
| FastAPI | 0.137.x (latest stable, released 2026-06-15) | HTTP framework for both services | FastAPI is the unambiguous standard for "wrap a Python ML model as an HTTP service" in 2025/2026 — async-native (matters because model inference should run in a thread/process pool, not block the event loop), automatic OpenAPI docs (useful for a beginner-facing SDK boundary), native `UploadFile`/multipart support for audio-in, and `StreamingResponse`/`Response(media_type="audio/wav")` for audio-out. HIGH confidence — verified current version directly from PyPI. Use `pip install "fastapi[standard]"` to pull in uvicorn + python-multipart automatically. |
| Uvicorn | 0.49.x (latest, released 2026-06-03) | ASGI server | Standard FastAPI companion server. Run with `--workers` > 1 only if the model is loaded per-worker with enough VRAM/RAM headroom (each worker process gets its own model copy) — for a single-GPU box, prefer 1 worker + internal async queueing over multiple workers. HIGH confidence. |
| `transformers` | **>=5.3.0** (latest 5.12.x as of 2026-06-15) — pin explicitly, do NOT use the model card's stated 4.37.2 | Runs `pipeline("automatic-speech-recognition", ...)` for Thonburian Whisper | **Critical, non-obvious finding**: the `biodatlab/whisper-th-large-v3-combined` model card pins `transformers==4.37.2`, but transformers versions 4.56.0 through 5.2.x (which postdate that pin) contain CVE-2026-4372 — a remote-code-execution vulnerability triggered during ordinary `from_pretrained()` model loading via a poisoned `config.json` field, patched in 5.3.0 (March 2026). Loading *any* third-party HF model (even a trusted one) on an unpatched version in that range is a supply-chain risk. The model itself is a standard Whisper architecture with no v4-specific API dependency, so it loads fine on current 5.x — verified no breaking pipeline-API changes affect `automatic-speech-recognition` task usage in the v5 migration notes. **Action: pin `transformers>=5.3.0,<6` in `thonburian-stt`'s requirements, ignore the model card's stale pin.** HIGH confidence (CVE + patched version verified via multiple independent security-research sources). |
| `torch` | 2.7.x or 2.8.x (CPU or CUDA build matching deployment target) | Backend for both `transformers` pipeline and F5-TTS | F5-TTS's own PyPI metadata references support up to torch 2.8.0; transformers 5.x requires torch >=2.6. Pick the CUDA build (`torch==2.7.1+cu121` style) only if deploying with a GPU; otherwise the plain CPU wheel is sufficient for low-traffic local/self-hosted use (large-v3 Whisper and F5-TTS are both usably fast on a modern CPU for single-utterance, non-realtime-streaming workloads, which matches this project's "utterance-at-a-time HTTP" decision). MEDIUM confidence on exact patch version (PyPI metadata didn't give an exact pin; range is directionally correct). |
| `f5-tts` (PyPI package, or vendored `flowtts` inference code per JaiTTS's "ThonburianTTS" repo) | 1.1.20 (latest, released 2026-04-20) | Voice-cloning TTS inference (`FlowTTSPipeline`) | JaiTTS is distributed as a model checkpoint + a separate "ThonburianTTS" inference repo exposing `FlowTTSPipeline`/`ModelConfig`/`AudioConfig` from a `flowtts.inference` module — not the vanilla `f5_tts.infer` CLI. Treat this as a vendored dependency (clone/pip-install the ThonburianTTS repo) rather than `pip install f5-tts` and hand-rolling the pipeline, since the custom XLM-R duration predictor needs that repo's specific wrapper. MEDIUM confidence — confirmed `FlowTTSPipeline` exists and its import path via search, but did not get to inspect its full source/requirements.txt directly. |

### Supporting Libraries — Python serving side

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `python-multipart` | latest (pulled in by `fastapi[standard]`) | Parses `multipart/form-data` for audio file uploads | Required for `thonburian-stt`'s `UploadFile`/`File(...)` endpoint — FastAPI raises an explicit error at request time if this isn't installed. |
| `soundfile` (libsndfile binding) | latest | Decode/encode WAV PCM for both services | Preferred over `librosa.load` for simple WAV I/O — much lighter dependency footprint (no SciPy/numba chain) and is what `transformers`' ASR pipeline and most F5-TTS forks use internally for reading/writing WAV. Use `librosa` only if you also need resampling of arbitrary input formats (MP3/OGG) beyond what `ffmpeg`-backed decoding gives you. |
| `ffmpeg` (system binary, not a pip package) | any recent static build | Decode non-WAV audio formats if the SDK ever sends something other than WAV | The PROJECT.md context confirms `AudioRecorder` already produces WAV blobs client-side, so this is a defensive/optional dependency, not a hard requirement for v1 — but `transformers`' ASR pipeline shells out to `ffmpeg` if given a path/bytes it can't decode natively, so install it in the container image regardless. |
| `numpy` | latest 2.x | Audio array manipulation between FastAPI request bytes and model input | Implicit dependency of `torch`/`transformers`/`soundfile`; pin loosely, don't hand-manage. |
| `pydantic` | v2.x (bundled with FastAPI) | Request/response schema validation | Use FastAPI's built-in Pydantic models for the JSON parts of each request (e.g., `language` query param, `reference_text` for voice cloning) — don't hand-validate. |
| `python-dotenv` | latest | Local `.env` loading for model paths/HF cache dir/port config | Lightweight, standard for small services; avoids hardcoding paths. |

### Development Tools — Python side

| Tool | Purpose | Notes |
|------|---------|-------|
| `uv` (Astral) | Python package/venv management for both new services | As of 2026, `uv` is the de facto standard for new Python service scaffolding — 10-100x faster resolves than pip/Poetry, single binary, `uv add fastapi "uvicorn[standard]"` style workflow, and (per recent industry signal) has the strongest tooling momentum behind it after Astral's 2026 acquisition by OpenAI. For two small greenfield services with heavy ML dependencies (torch, transformers), uv's fast resolver materially shortens iteration time pulling large wheels. MEDIUM confidence (strong multi-source agreement on adoption trend, but this is an ecosystem-trend claim, not a verifiable spec). Falls back cleanly to plain `pip install -r requirements.txt` if the user prefers — uv consumes that format directly. |
| Dockerfile per service | Containerized deployment | Each service should ship its own `Dockerfile` (python:3.11-slim base + system `ffmpeg` + `pip`/`uv` install + cached model weights via HF cache volume) since these are described as "lightweight backend services" meant to be self-hosted independently of the TS monorepo. |
| `pytest` + `httpx` (FastAPI's `TestClient` dependency) | Endpoint tests | Standard pairing for testing FastAPI routes without a running server. |

## Installation

```bash
# TypeScript SDK side — new package, no new runtime deps
cd packages/providers
mkdir generic-stt-tts && cd generic-stt-tts
pnpm init
pnpm add @khaveeai/core@workspace:*
pnpm add -D typescript@^5.0.0 vitest@^2.0.0 @vitest/coverage-v8@^2.0.0

# Python — thonburian-stt service
cd /Users/whitemalt/Documents/thonburian-stt
uv init
uv add "fastapi[standard]" "uvicorn[standard]" "transformers>=5.3.0,<6" torch soundfile python-dotenv
uv add --dev pytest httpx

# Python — jai-tts service
cd /Users/whitemalt/Documents/jai-tts
uv init
uv add "fastapi[standard]" "uvicorn[standard]" torch soundfile cached-path librosa python-dotenv
# plus vendored install of the ThonburianTTS / FlowTTSPipeline inference repo per its own instructions
uv add --dev pytest httpx
```

## How the two sides wire together

**Protocol (already decided in PROJECT.md, confirmed as correct for these models):** streaming-chunked HTTP, not WebSocket or WebRTC. The SDK's `VADProvider` (browser) segments microphone audio into complete utterances (WAV blobs), and each utterance is POSTed whole to the backend service — there is no partial/incremental transcription or synthesis to stream, because:
- Thonburian Whisper (via `transformers.pipeline`) is a batch ASR call — `chunk_length_s` controls *internal* long-audio chunking for the model's own attention window, not client-facing incremental streaming.
- F5-TTS-based JaiTTS is a flow-matching diffusion model; per F5-TTS's own GitHub issue tracker, even the official streaming-output path produces a long first packet before real-time factor improves — true low-latency incremental TTS streaming is not what this model is built for. (MEDIUM confidence — based on one GitHub issue's discussion of streaming latency, not a benchmark you should rely on, but it directionally confirms "whole-utterance HTTP" is the pragmatic choice already made.)

**Audio encoding conventions (verified, not assumed):**
- **STT request (browser → `thonburian-stt`):** WAV, 16kHz, mono, 16-bit PCM (`pcm_s16le`). This matches what Whisper-family models are trained/tuned for — sending higher sample rates or stereo wastes bandwidth with zero accuracy benefit; sending lower than 16kHz degrades accuracy. `AudioRecorder.ts` already produces WAV blobs from `MicVAD` — confirm/normalize sample rate at that boundary if the existing recorder doesn't already downsample to 16kHz (per `.planning/codebase` notes the existing `openai-stt-tts` provider already sends WAV blobs in this style — generalize that convention, don't invent a new one). Transport: `multipart/form-data` (`UploadFile` on the FastAPI side), matching the existing `STTClient.ts` pattern of POSTing a WAV blob.
- **TTS response (`jai-tts` → browser):** WAV, 24kHz, mono, 16-bit PCM — this is F5-TTS's native output sample rate; resampling down would only add latency and degrade quality for no transport benefit at utterance-sized payloads. Return as `Response(content=wav_bytes, media_type="audio/wav")` (or `StreamingResponse` if chunked transfer is wanted for large utterances) — matches the existing `TTSPlayer.ts` pattern of `fetch()` + `arrayBuffer()` + `AudioContext.decodeAudioData()`.
- **Multipart vs raw bytes:** Use `multipart/form-data` for the STT upload (consistent with existing `STTClient.ts`, and lets you attach `language`/`task` as form fields alongside the file in one request). Use a plain JSON body (`{ text, reference_voice_id? }`) for the TTS request since there's no binary upload needed there — JaiTTS's bundled default Thai reference voice means the common case sends no audio at all, only text.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Plain TS interfaces + hand-rolled pipeline orchestrator | Port pipecat's actual `Frame`/`FrameProcessor` graph model into TS (typed frame objects flowing through N processors, not just 4 fixed stages) | If a future milestone needs arbitrary pipeline graphs (e.g., parallel STT + sentiment analysis, or mid-pipeline frame transformation/filtering) rather than the fixed VAD→STT→LLM→TTS turn loop. Not needed now — PROJECT.md's scope is exactly 4 fixed stages, so a fixed-shape orchestrator is simpler and sufficient. |
| Streaming-chunked HTTP (whole-utterance POST) | WebSocket persistent connection per session | If a future STT/TTS vendor (e.g., Deepgram, ElevenLabs streaming) supports true partial/incremental results — at that point a `VADProvider`-less, continuously-streaming `STTProvider` variant would need a WebSocket-based interface shape, which is a different contract than the one being built now. Already correctly scoped out in PROJECT.md's "Out of Scope." |
| `transformers.pipeline` for Thonburian Whisper | `faster-whisper` (CTranslate2 backend) | If self-hosted inference latency/cost becomes a real problem — faster-whisper is ~4x faster and ~half the VRAM on the same model size, confirmed via multiple 2026 sources. However, `biodatlab/whisper-th-large-v3-combined` is a `transformers`-native checkpoint; using it with faster-whisper would require converting the model to CTranslate2 format first (extra build step, not "simple HTTP endpoint" as scoped). Stick with `transformers.pipeline` for this milestone; flag CTranslate2 conversion as a possible later optimization, not a v1 requirement. |
| `uv` for Python dependency management | Plain `pip` + `venv`, or Poetry | If the user/team has strong existing Poetry tooling/CI already built around it — `uv` is recommended as the better default for new greenfield services, not a hard requirement; `pip install -r requirements.txt` remains a safe universal fallback for whoever deploys these services. |
| FastAPI | Flask + Flask-RESTful, or raw ASGI (Starlette directly) | Flask is synchronous-by-default (would block on model inference unless manually threaded) and lacks FastAPI's automatic request validation/OpenAPI docs — actively worse fit for an ML-inference HTTP boundary. Raw Starlette is what FastAPI is built on; only drop to it if FastAPI's validation/dependency-injection layer becomes overhead-not-value for a single-endpoint service, which is unlikely to matter at this scale. Not recommended for either reason here. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| The model card's pinned `transformers==4.37.2` for `thonburian-stt` | That version range (and everything through 5.2.x) is within the CVE-2026-4372 RCE vulnerability window for malicious/poisoned model configs loaded via `from_pretrained()` — a real supply-chain risk when loading any third-party HF checkpoint, even a legitimate one, if your dependency happens to pull a vulnerable transformers/kernels combo. | Pin `transformers>=5.3.0,<6` explicitly in requirements; verify the model still loads correctly with `pipeline("automatic-speech-recognition", ...)` at that version (no breaking API changes affect this task per the v5 migration guide). |
| Flask for either Python service | Synchronous WSGI by default; you'd need to manually run model inference in a thread pool to avoid blocking the single worker thread on every request — exactly what FastAPI/Starlette gives you for free with `async def` + `run_in_threadpool`. No ecosystem advantage for this use case in 2025/2026. | FastAPI + Uvicorn. |
| Zod (or any schema library) for the tool-calling `parameters` shape in the TS SDK | Already decided against in PROJECT.md — adds a dependency and an extra JSON-Schema-derivation step for zero benefit, since every target LLM vendor's function-calling API already wants a raw JSON-Schema-shaped object. | Plain `{ name, description, parameters, handler }` object, `parameters` typed as a loose JSON-Schema-shaped object (or even `Record<string, unknown>` if stricter typing isn't worth the complexity). |
| WebSocket/WebRTC transport for the new `generic-stt-tts` provider's backend calls | Neither Thonburian Whisper nor JaiTTS support true incremental streaming — a persistent socket adds connection-lifecycle complexity (reconnect/backoff/heartbeat) with zero latency benefit over a simple POST-per-utterance, since the model can't start responding before it has the whole input anyway. | Plain `fetch()` POST per utterance, exactly like the existing `STTClient`/`ChatClient`/`TTSPlayer` pattern. |
| `librosa` as the default audio I/O library for simple WAV read/write in both Python services | Pulls in SciPy/numba/joblib as transitive dependencies just to read/write WAV files — heavy for what should be a lightweight service, and slower cold-start (numba JIT warmup) in a container. | `soundfile` for WAV I/O; reserve `librosa` only for resampling/feature-extraction needs the JaiTTS `FlowTTSPipeline` repo specifically requires (per PROJECT.md's note that it lists `librosa` as a dependency — that's the repo's call, not a reason to also use it in `thonburian-stt`). |
| Poetry for these two new greenfield Python services | Slower dependency resolution than `uv`, and adds a second packaging convention to the project when the wider org has no existing Poetry investment to leverage. | `uv` (or plain `pip` if minimal tooling is preferred). |

## Stack Patterns by Variant

**If GPU is available for self-hosting:**
- Install CUDA-matched `torch` wheel (e.g., `torch==2.7.1` with the appropriate `+cu12x` index) for both services.
- Run Uvicorn with a single worker (one model instance per GPU) rather than multiple workers, since each worker process would otherwise try to load its own full copy of the model onto the same GPU.
- Because: large-v3 Whisper and F5-TTS are both large enough that duplicating them across workers wastes VRAM fast; a single async worker handling a request queue is the standard self-hosted-ML-service pattern.

**If CPU-only (pure local/self-hosted, low-traffic):**
- Use the CPU `torch` wheel; expect higher per-request latency (whisper-large-v3 and F5-TTS are both noticeably slower on CPU) but this matches the "lightweight backend services... low-latency local/self-hosted use" framing for small/medium traffic, not high-concurrency production.
- Because: PROJECT.md explicitly scopes this as proving the abstraction end-to-end, not as a production-scale deployment — CPU inference is the simpler, dependency-lighter default to ship first.

**If audio input ever needs to support formats beyond WAV (future):**
- Add `ffmpeg` decoding at the FastAPI request boundary (read bytes → pipe through `ffmpeg` → PCM16 WAV → hand to `transformers.pipeline`).
- Because: today's scope is "VAD-segmented WAV blobs sent whole" per PROJECT.md — no other format needs supporting yet, so don't add this complexity preemptively.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `transformers>=5.3.0,<6` | `torch>=2.6` (per v5 migration requirement) | Confirmed via GitHub issue discussion of v5's torch floor; use torch 2.7.x or 2.8.x to stay comfortably above this floor. |
| `transformers>=5.3.0,<6` | `biodatlab/whisper-th-large-v3-combined` checkpoint | Model is a standard Whisper architecture (no custom modeling code requiring `trust_remote_code=True`); the `automatic-speech-recognition` pipeline task API is unchanged across the v4→v5 migration per the official migration guide — safe to run on current 5.x despite the model card's stale 4.37.2 pin. MEDIUM confidence: verified the migration guide's stated scope of breaking changes, did not execute the model on 5.x directly. |
| `f5-tts` 1.1.20 / vendored ThonburianTTS `FlowTTSPipeline` | `torch` up to 2.8.0 (per PyPI metadata) | JaiTTS adds a custom XLM-R duration predictor on top of vanilla F5-TTS — verify the vendored ThonburianTTS repo's own `requirements.txt`/`pyproject.toml` once it's pulled, since its pins may be narrower than vanilla `f5-tts`'s. Flagged as an open question — this research could not inspect that repo's exact dependency file. |
| FastAPI `[standard]` extras | `python-multipart`, `uvicorn[standard]` | Installing `fastapi[standard]` (not bare `fastapi`) pulls in everything needed for file uploads and a production-ready Uvicorn install in one command — avoids the common "forgot python-multipart, got a runtime error" pitfall. |
| `pnpm` workspace (`@khaveeai/core` ^0.3.3) | New `generic-stt-tts` package | Use `workspace:*` protocol for the internal dependency exactly as other provider packages do — no version research needed here, just match existing monorepo convention. |

## Sources

- pipecat-ai/pipecat-client-web (GitHub) — client/server split, transport abstraction, RTVI protocol — MEDIUM confidence (WebFetch summary of docs page, not full source read)
- docs.pipecat.ai/client/introduction — client SDK responsibilities — MEDIUM confidence
- pipecat reference docs (`reference-server.pipecat.ai`, `docs.pipecat.ai/guides/learn/pipeline`, Anam.ai's Pipecat frame-processing guide) — `FrameProcessor`/`STTService`/`TTSService`/`LLMService` class hierarchy — MEDIUM confidence, cross-referenced across 3 sources, consistent
- micdrop.dev/blog/alternative-to-pipecat, github.com/Godefroy/micdrop — TS-native alternative architecture (WebSocket-based, BYOK, no Python service) — MEDIUM confidence, useful as a sanity check that khavee-sdk's TS-SDK + separate-HTTP-services split is a reasonable, precedented design point distinct from pipecat's Python-server model
- pypi.org/project/transformers — version 5.12.1, released 2026-06-15 — HIGH confidence (direct PyPI fetch)
- pypi.org/project/fastapi — version 0.137.1, released 2026-06-15 — HIGH confidence (direct PyPI fetch)
- pypi.org/project/uvicorn — version 0.49.0, released 2026-06-03 — HIGH confidence (direct PyPI fetch)
- pypi.org/project/f5-tts — version 1.1.20, released 2026-04-20, torch up to 2.8.0 — HIGH confidence (direct PyPI fetch)
- huggingface.co/biodatlab/whisper-th-large-v3-combined model card — stated `transformers==4.37.2`/`torch==2.1.0` pins and `pipeline()` usage example — HIGH confidence (direct model card fetch)
- CVE-2026-4372 coverage (penligent.ai, pluto.security, techrepublic.com, siliconangle.com — cross-referenced, consistent on affected range 4.56.0–5.2.x, patched 5.3.0) — HIGH confidence, multiple independent security-research sources agree
- huggingface.co/biodatlab/ThonburianTTS model card (via search snippet) — `FlowTTSPipeline`/`ModelConfig`/`AudioConfig` import path from `flowtts.inference` — MEDIUM confidence (search-result summary, not direct page fetch)
- GitHub openai/whisper discussions #41, #870; danielrosehill Gist — 16kHz mono PCM16 WAV as Whisper's standard input convention — MEDIUM confidence (community consensus across multiple sources, consistent with Whisper's own internal `ffmpeg -ar 16000 -ac 1` preprocessing)
- GitHub SWivid/F5-TTS issue #666 ("target_sample_rate must be 24000"), issue #1225 (streaming first-packet latency) — 24kHz mono PCM16 WAV output convention, streaming latency caveat — MEDIUM confidence (GitHub issue discussion, not benchmarked directly)
- pypi.org/project/uvicorn, datacamp.com/tutorial/python-uv, noqta.tn uv guide — `uv` as 2026 standard Python tooling, OpenAI's 2026 acquisition of Astral — MEDIUM confidence (ecosystem-trend claim, multiple sources agree directionally, exact "acquisition" detail not independently re-verified beyond search summaries)
- Existing repo: `.planning/codebase/STACK.md`, `.planning/codebase/ARCHITECTURE.md` — confirmed existing TS-side conventions (`fetch()`-based clients, `@ricky0123/vad-web`, WAV blob production in `AudioRecorder.ts`) to extend rather than replace — HIGH confidence (direct repo read)

---
*Stack research for: composable multi-vendor voice AI pipeline (TS) + lightweight Python ML serving (STT/TTS)*
*Researched: 2026-06-17*
