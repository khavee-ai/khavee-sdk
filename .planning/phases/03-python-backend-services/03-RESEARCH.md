# Phase 3: Python Backend Services - Research

**Researched:** 2026-06-19
**Domain:** Python ML inference services (FastAPI) — Thai ASR (Whisper-based) and Thai TTS (F5-TTS-based voice cloning)
**Confidence:** MEDIUM-HIGH (core FastAPI/transformers patterns HIGH; ThonburianTTS/F5-TTS inference repo MEDIUM — verified against live README content but the repo's exact runtime behavior is unconfirmed until cloned and run)

## Summary

This phase scaffolds two independent, minimal FastAPI services in sibling repos outside khavee-sdk: `thonburian-stt` (Thai speech-to-text via `biodatlab/whisper-th-large-v3-combined`, run through `transformers.pipeline`) and `jai-tts` (Thai voice-cloning text-to-speech via `JTS-AI/JaiTTS-F5TTS`, run through a `FlowTTSPipeline` class from the `biodatlab/thonburian-tts` GitHub repo, NOT a pip-installable package under that name). Both services load their model exactly once at FastAPI startup (lifespan event) and auto-detect CUDA → MPS → CPU. No Docker; plain venv + `uvicorn`. The API contracts are intentionally simple per CONTEXT.md D-02/D-03: STT takes multipart file upload and returns `{"text": ...}`; TTS takes JSON `{"text": ...}` and returns raw `audio/wav` bytes.

The single most important finding: **`FlowTTSPipeline` is not a pip package.** It lives inside the `biodatlab/thonburian-tts` GitHub repo (license: MIT for code, CC BY-NC-SA 4.0 for the underlying ThonburianTTS models — the JaiTTS-F5TTS checkpoint itself is Apache-2.0 per its own model card, but the *inference code* you're borrowing carries the thonburian-tts repo's own MIT license). This repo must be `pip install git+https://...` or cloned and installed in editable mode (`pip install -e .`) into `jai-tts`'s venv — it is not on PyPI as `flowtts` or any other name. The actual model checkpoint and vocab are loaded from Hugging Face via `hf://` URIs resolved by `cached_path`, not downloaded manually.

**Primary recommendation:** Scaffold both services as single-file `main.py` FastAPI apps (per CONTEXT.md, this is explicitly Claude's discretion, and a single-file layout is idiomatic for a 1-endpoint demo service). Use FastAPI's `lifespan` context manager with `app.state` to hold the loaded model exactly once. For `jai-tts`, vendor the `thonburian-tts` repo's `flowtts` package via `pip install git+https://github.com/biodatlab/thonburian-tts.git` directly in `requirements.txt` (no separate clone step needed at scaffold time — pip handles the git install).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Audio upload handling (multipart parse) | API / Backend (FastAPI, `thonburian-stt`) | — | FastAPI's `UploadFile` is the standard ingestion point; no browser/CDN tier exists in this phase |
| ASR inference (Whisper) | API / Backend (`thonburian-stt`) | — | Model loaded in-process via `transformers.pipeline`; no external inference server |
| Text-to-speech inference (F5-TTS/FlowTTSPipeline) | API / Backend (`jai-tts`) | — | Model loaded in-process via vendored `flowtts` package |
| Reference voice asset storage | Database / Storage (flat files in repo, `assets/`) | API / Backend (reads at request time or startup) | No DB needed for one static asset; bundled file is simplest persistence for a demo |
| Model weight retrieval | External Service (Hugging Face Hub via `hf://` + `cached_path`) | — | Both models pull weights from HF at first run, cached locally afterward — not bundled in the repo |
| Device selection (CUDA/MPS/CPU) | API / Backend (startup-time, both services) | — | Pure Python/torch logic, no separate tier |
| HTTP contract (wire format) | API / Backend (both services expose it; consumed by Phase 4's khavee-sdk adapters) | — | This phase only needs *a* working contract; Phase 4 formally pins it |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastapi` | 0.137.2 (current; pin to a recent 0.11x for stability — see note) | HTTP service framework for both services | De facto standard for Python ML microservices; async, automatic OpenAPI docs, native `UploadFile`/`Response` primitives matching D-02/D-03 exactly [VERIFIED: PyPI registry] |
| `uvicorn` | 0.49.0 | ASGI server to run FastAPI apps (`uvicorn main:app`) | Standard FastAPI companion server; D-05 mandates plain venv+uvicorn, no Docker [VERIFIED: PyPI registry] |
| `transformers` | 4.x recommended over the bleeding-edge 5.x (see Version verification note) | Runs `biodatlab/whisper-th-large-v3-combined` via `pipeline("automatic-speech-recognition", ...)` | Official model card's documented usage path [CITED: huggingface.co/biodatlab/whisper-th-large-v3-combined] |
| `torch` | 2.x (CPU or platform-matched build) | Backend tensor runtime for both Whisper and F5-TTS | Required by `transformers` and by `f5-tts`/`flowtts`; `torch.cuda.is_available()` / `torch.backends.mps.is_available()` drive device selection (D-06) [VERIFIED: PyPI registry] |
| `python-multipart` | 0.0.32 | Required by FastAPI/Starlette to parse `multipart/form-data` (file uploads) for `thonburian-stt`'s `/transcribe` endpoint | FastAPI silently requires this as a peer dependency for `UploadFile`/`File()` — must be in `requirements.txt` explicitly [VERIFIED: PyPI registry; flagged by slopcheck as a "classic LLM naming pattern" but confirmed established/legitimate] |
| `soundfile` | 0.14.0 | Write synthesized audio to WAV bytes in `jai-tts` (`sf.write(...)`) | Used directly in the JaiTTS-F5TTS model card's own quick-usage example [CITED: huggingface.co/JTS-AI/JaiTTS-F5TTS README] |

### Supporting (jai-tts only — pulled transitively by `git+https://github.com/biodatlab/thonburian-tts.git`)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `cached-path` (PyPI: `cached-path`, import: `cached_path`) | 1.8.10 | Resolves `hf://...` URIs to local cached file paths for model checkpoint/vocab/reference audio | Required by `ModelConfig(checkpoint="hf://...")` pattern shown in the official example [VERIFIED: PyPI registry] |
| `librosa` | 0.11.0 | Audio loading/resampling used internally by the `flowtts` pipeline | Pulled in as a dependency of the vendored `thonburian-tts` repo; do not pin separately unless conflicts arise [VERIFIED: PyPI registry] |
| `f5-tts` | 1.1.20 | Underlying F5-TTS model architecture/inference primitives that `flowtts` wraps | Explicitly listed as a dependency on the JaiTTS-F5TTS model card [CITED: huggingface.co/JTS-AI/JaiTTS-F5TTS README] |
| `accelerate` | flagged `[SUS]` by slopcheck (87 downloads recorded at check time — likely a stale/low-traffic snapshot, not necessarily a hallucination; `accelerate` is HuggingFace's own well-known package) | Device placement helper sometimes required by `transformers`/`f5-tts` model loading | Install only if a `ImportError: Accelerate` surfaces during scaffolding; do not add speculatively |
| `ffmpeg` (system binary, not pip) | 7.1.1 confirmed installed via Homebrew on this machine | Audio decode/encode backend for `librosa`/`soundfile` on some formats | Confirmed present locally [VERIFIED: `ffmpeg -version` ran successfully]; document as a system prerequisite in each service's README since it is NOT pip-installable |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `transformers.pipeline` for Whisper | `openai-whisper` (original repo) or `faster-whisper` (CTranslate2) | `faster-whisper` is faster on CPU but the model card explicitly documents the `transformers.pipeline` path for `biodatlab/whisper-th-large-v3-combined` — using a different loader risks subtle incompatibilities (custom tokenizer/decoder prompt ids) not present in the documented path. Stick with `transformers.pipeline` as specified. |
| Vendoring `thonburian-tts` via `pip install git+https://...` | Manually cloning the repo as a subdirectory and adding to `PYTHONPATH` | `pip install git+` is simpler (one line in `requirements.txt`, normal `pip install -r` workflow) and avoids manual path hacks; only fall back to manual clone if the git-install method fails during scaffolding (e.g., due to the repo's own setup.py/pyproject.toml issues, which were not independently verified this session) |
| Single `main.py` per service | `app/` package with `routers/`, `models/`, `services/` subdirectories | Per CONTEXT.md, this is explicitly Claude's discretion. Given each service has exactly one endpoint and one model, a package layout is premature structure for this phase's scope — single-file is idiomatic for a demo-sized FastAPI service |

**Installation (thonburian-stt):**
```bash
pip install fastapi uvicorn python-multipart transformers torch
```

**Installation (jai-tts):**
```bash
pip install fastapi uvicorn soundfile torch
pip install git+https://github.com/biodatlab/thonburian-tts.git
```

**Version verification:** Verified directly via `pip3 index versions <pkg>` against the live PyPI registry on 2026-06-19. All listed current versions are far newer than training-data knowledge would suggest (e.g., `transformers` is at major version 5.x, `torch` at 2.12.x) — **do not pin to versions recalled from training data; re-verify at scaffold time** since these are fast-moving ML libraries. Recommend pinning `transformers` to a `4.x` release (e.g. `4.57.x`) rather than jumping to the brand-new `5.x` major, since the Whisper pipeline usage pattern on the model card was written against the `4.x` API surface and `5.x`'s breaking changes are unverified against this specific model as of this research session.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|--------------|-----------|-------------|
| fastapi | PyPI | mature (years) | very high | github.com/fastapi/fastapi | OK | Approved |
| uvicorn | PyPI | mature (years) | very high | github.com/encode/uvicorn | OK | Approved |
| transformers | PyPI | mature (years) | very high | github.com/huggingface/transformers | OK | Approved |
| torch | PyPI | mature (years) | very high | github.com/pytorch/pytorch | OK | Approved |
| python-multipart | PyPI | mature | high | (established despite naming pattern) | OK (flagged info-only: "Name starts with 'python-' -- classic LLM naming pattern. Name looks like LLM bait but package is established.") | Approved |
| soundfile | PyPI | mature | high | github.com/bastibe/python-soundfile | OK | Approved |
| cached-path | PyPI | mature | moderate | github.com/allenai/cached_path | OK | Approved |
| librosa | PyPI | mature (years) | very high | github.com/librosa/librosa | OK | Approved |
| f5-tts | PyPI | active, growing | moderate | github.com/SWivid/F5-TTS | OK | Approved |
| accelerate | PyPI | mature (HuggingFace official) | low download count recorded by tool at check time | github.com/huggingface/accelerate | SUS ("Only 87 downloads. Nobody uses this." — almost certainly a stale/incomplete registry snapshot for this well-known package, not a genuine hallucination signal) | Flagged — planner should add a `checkpoint:human-verify` before installing IF `accelerate` becomes necessary during scaffolding; do not install speculatively |

**Packages removed due to slopcheck [SLOP] verdict:** none (an initial check incorrectly targeted the `npm` registry and produced false `[SLOP]` results for `librosa`, `cached-path`, `python-multipart`, `soundfile`, `f5-tts` — this was an ecosystem-detection error, not a genuine finding. Re-running with `--ecosystem pypi` / `scan` against the correct registry returned `OK` for all of them. This is documented here precisely because it is the exact cross-ecosystem confusion failure mode the verification protocol warns about — always force `--ecosystem pypi` for these two services.)

**Packages flagged as suspicious [SUS]:** `accelerate` — flagged only due to an apparently stale low-download-count signal from the slopcheck tool; this is HuggingFace's own widely-used package (`github.com/huggingface/accelerate`) and is very unlikely to be hallucinated, but per protocol it is downgraded to flagged status. The planner should gate its install behind `checkpoint:human-verify` only if/when it is actually needed (it may not be required at all — `transformers.pipeline` and `flowtts` may work without it).

**Note on `flowtts` itself:** The `flowtts` package (imported as `from flowtts.inference import FlowTTSPipeline, ModelConfig, AudioConfig`) is NOT on PyPI under any name — it is installed by `pip install git+https://github.com/biodatlab/thonburian-tts.git`, which registers the package locally as `flowtts` (per the repo's own `pyproject.toml`/`setup.py`, not independently inspected this session). slopcheck cannot meaningfully audit a git-install target the way it audits a registry package; this is a `[ASSUMED]` trust boundary — the planner should treat cloning/installing this repo as a `checkpoint:human-verify` step (verify the repo content matches expectations before trusting it in a service that will run arbitrary model-loading code).

## Architecture Patterns

### System Architecture Diagram

```
                    thonburian-stt service                          jai-tts service
                    ────────────────────                            ───────────────

  Client                                                 Client
    │  POST /transcribe                                    │  POST /synthesize
    │  multipart/form-data (WAV file)                       │  {"text": "..."}
    ▼                                                       ▼
┌─────────────────────┐                              ┌─────────────────────┐
│ FastAPI endpoint     │                              │ FastAPI endpoint     │
│ UploadFile.read()    │                              │ Pydantic body model  │
└──────────┬───────────┘                              └──────────┬───────────┘
           │ raw bytes                                            │ text string
           ▼                                                      ▼
┌─────────────────────┐                              ┌─────────────────────┐
│ app.state.asr_pipe   │  ◄── loaded ONCE at          │ app.state.tts_pipe   │ ◄── loaded ONCE at
│ (transformers        │      startup (lifespan)      │ (FlowTTSPipeline)    │      startup (lifespan)
│  pipeline object)    │                              │                      │
└──────────┬───────────┘                              └──────────┬───────────┘
           │ pipe(audio_bytes, generate_kwargs=...)               │ pipeline(text=..., ref_voice=DEFAULT,
           ▼                                                      │           ref_text=DEFAULT_TEXT)
   {"text": "transcription"}                                     ▼
           │                                              raw WAV bytes (in-memory via soundfile)
           ▼                                                      │
   JSON response                                                  ▼
                                                          Response(content=wav_bytes, media_type="audio/wav")

  Startup (both services, identical pattern):
  ┌────────────────────────────────────────────────────┐
  │ @asynccontextmanager lifespan(app):                │
  │   device = "cuda" if torch.cuda.is_available()     │
  │            else "mps" if torch.backends.mps...     │
  │            else "cpu"                               │
  │   app.state.<model> = load_once(device)            │
  │   yield                                             │
  │   # no explicit cleanup needed for a demo service   │
  └────────────────────────────────────────────────────┘
```

### Recommended Project Structure

**thonburian-stt/**
```
thonburian-stt/
├── main.py              # FastAPI app, lifespan, /transcribe endpoint
├── requirements.txt     # fastapi, uvicorn, python-multipart, transformers, torch
├── README.md            # how to run: python -m venv, pip install -r, uvicorn main:app
└── .gitignore           # venv/, __pycache__/, *.wav (test artifacts)
```

**jai-tts/**
```
jai-tts/
├── main.py                       # FastAPI app, lifespan, /synthesize endpoint
├── requirements.txt              # fastapi, uvicorn, soundfile, torch, git+thonburian-tts
├── assets/
│   ├── default_voice.wav         # bundled reference clip (BACK-04, see D-04)
│   ├── default_voice.txt         # transcript of the clip
│   └── LICENSE-default-voice.txt # attribution/license for the source dataset clip
├── README.md
└── .gitignore
```

### Pattern 1: Model-load-once-at-startup via FastAPI lifespan
**What:** Use `@asynccontextmanager` lifespan function that loads the model into `app.state` before `yield`, never inside a request handler.
**When to use:** Always, for any service holding an expensive-to-load model — directly satisfies the non-deferred half of BACK-05.
**Example:**
```python
# Source: https://fastapi.tiangolo.com/advanced/events/ (adapted)
from contextlib import asynccontextmanager
from fastapi import FastAPI
import torch
from transformers import pipeline

def select_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"

@asynccontextmanager
async def lifespan(app: FastAPI):
    device = select_device()
    app.state.asr_pipe = pipeline(
        task="automatic-speech-recognition",
        model="biodatlab/whisper-th-large-v3-combined",
        chunk_length_s=30,
        device=device,
    )
    yield
    # no explicit teardown required for a demo service

app = FastAPI(lifespan=lifespan)
```

### Pattern 2: Multipart audio upload → JSON text response (D-02)
**What:** `thonburian-stt`'s `/transcribe` endpoint.
**When to use:** Exactly per D-02's locked decision — no alternative shapes should be planned.
**Example:**
```python
# Source: FastAPI docs (https://fastapi.tiangolo.com/tutorial/request-files/) + biodatlab model card pattern
from fastapi import FastAPI, UploadFile, File, Request
import tempfile

@app.post("/transcribe")
async def transcribe(request: Request, file: UploadFile = File(...)):
    contents = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(contents)
        tmp.flush()
        result = request.app.state.asr_pipe(
            tmp.name,
            generate_kwargs={"language": "<|th|>", "task": "transcribe"},
            batch_size=16,
        )
    return {"text": result["text"]}
```

### Pattern 3: JSON text request → raw WAV bytes response (D-03)
**What:** `jai-tts`'s `/synthesize` endpoint.
**When to use:** Exactly per D-03's locked decision — raw bytes, `audio/wav` media type, no base64/JSON envelope.
**Example:**
```python
# Source: JaiTTS-F5TTS model card quick-usage example (https://huggingface.co/JTS-AI/JaiTTS-F5TTS)
#         adapted to FastAPI Response per https://fastapi.tiangolo.com/advanced/custom-response/
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel
import io
import soundfile as sf

class SynthesizeRequest(BaseModel):
    text: str

@app.post("/synthesize")
async def synthesize(request: Request, body: SynthesizeRequest):
    pipe = request.app.state.tts_pipe
    audio, sr = pipe.generate(
        reference_audio=DEFAULT_VOICE_PATH,
        reference_text=DEFAULT_VOICE_TEXT,
        gen_text=body.text,
    )
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    return Response(content=buf.getvalue(), media_type="audio/wav")
```
**Caveat:** the exact `.generate(...)` vs. callable-pipeline (`pipeline(text=..., ref_voice=..., ref_text=..., output_file=...)`) calling convention is **inconsistently documented between two real sources fetched this session** — the model card's "Quick Usage" section shows `pipeline.generate(reference_audio=, reference_text=, gen_text=)` returning `(audio, sr)`, while the repo's own `f5tts_thai_example.py` calls the pipeline object directly: `pipeline(text=, ref_voice=, ref_text=, output_file=, speed=, check_duration=)` and returns a file path. **This must be resolved empirically at scaffold time by inspecting the installed `flowtts` package's actual `FlowTTSPipeline.__call__`/`.generate` signatures** — do not assume either signature is correct without checking installed source. Flagged as an Open Question below.

### Pattern 4: Device auto-detection (D-06)
**What:** CUDA → MPS → CPU fallback chain, computed once at startup.
**When to use:** In the lifespan function of both services, before model load.
**Example:**
```python
# Source: PyTorch official guidance (https://developer.apple.com/metal/pytorch/) + standard community pattern
import torch

def select_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"
```

### Anti-Patterns to Avoid
- **Loading the model inside the request handler:** Defeats the entire purpose of BACK-05's load-once requirement; causes multi-second-to-minute latency per request and risks repeated OOM.
- **Returning audio as base64-encoded JSON:** Explicitly rejected by D-03 — adds encoding overhead and complexity the phase doesn't need.
- **Hardcoding `device="cpu"`:** Explicitly rejected by D-06 — both Whisper-large and F5-TTS are slow on CPU; auto-detection is required.
- **Treating `transformers` 5.x as a drop-in replacement for the documented 4.x pipeline usage:** The model card's example predates the 5.x major version; verify pipeline behavior empirically before trusting it on 5.x.
- **Assuming `flowtts` is pip-installable as a standalone package name:** It is not on PyPI; it only exists via the `thonburian-tts` git repo install.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Thai ASR | Custom Whisper fine-tuning or wrapper | `transformers.pipeline("automatic-speech-recognition", model="biodatlab/whisper-th-large-v3-combined")` | Model card documents the exact, tested usage path; reinventing the pipeline wrapper risks subtle decoder-prompt/tokenizer mismatches |
| Thai voice cloning | Custom F5-TTS integration from scratch | `FlowTTSPipeline` from `biodatlab/thonburian-tts` | The duration-predictor and Thai-specific tokenization/byte-ratio handling are already solved in this vendored pipeline — hand-rolling F5-TTS inference for Thai text risks the exact pacing/rushed-speech bug the XLM-R duration predictor was built to fix |
| Device selection | Custom GPU detection heuristics | `torch.cuda.is_available()` / `torch.backends.mps.is_available()` | These are the canonical, maintained APIs; no edge case they don't already handle |
| Multipart parsing | Manual `multipart/form-data` byte parsing | FastAPI's `UploadFile`/`File()` (backed by `python-multipart`) | Standard library-grade quality; manual parsing is a well-known security/correctness foot-gun (boundary parsing, encoding edge cases) |
| WAV encoding | Manual WAV header construction | `soundfile.write(buf, audio, sr, format="WAV")` | Handles RIFF header correctness, dtype/PCM conversion, and sample-rate metadata correctly; manual header-writing is exactly the kind of "deceptively complex" problem this section exists to flag |

**Key insight:** Both backend services exist specifically to wrap pre-built, research-grade model pipelines (Whisper and F5-TTS-based voice cloning) — the entire value of this phase is correctly wiring existing, documented inference code into a minimal HTTP surface, not re-deriving ASR/TTS algorithms.

## Common Pitfalls

### Pitfall 1: Treating `flowtts` as a PyPI package
**What goes wrong:** `pip install flowtts` fails or installs an unrelated package; planner/executor wastes time hunting for a package that doesn't exist under that name on PyPI.
**Why it happens:** The model card's own pip install line (`pip install torch cached-path librosa transformers f5-tts`) does NOT include `flowtts` — it's easy to assume it's bundled in `f5-tts` since the import looks similar, but `flowtts` only comes from the separate `thonburian-tts` git repo.
**How to avoid:** Explicitly install via `pip install git+https://github.com/biodatlab/thonburian-tts.git` as a separate line in `requirements.txt`/setup step.
**Warning signs:** `ModuleNotFoundError: No module named 'flowtts'` after installing only the model card's listed pip packages.

### Pitfall 2: Inconsistent FlowTTSPipeline calling convention between sources
**What goes wrong:** Code written against the model card's `pipeline.generate(reference_audio=, reference_text=, gen_text=)` → `(audio, sr)` signature breaks if the installed package actually expects the repo example's `pipeline(text=, ref_voice=, ref_text=, output_file=)` → file-path-returning callable signature (or vice versa).
**Why it happens:** Two real, independently-fetched sources (the HF model card's "Quick Usage" and the GitHub repo's own `f5tts_thai_example.py`) show different call signatures for what should be the same class — likely because the model card's README was written for/copied from a slightly different version of the pipeline than what `f5tts_thai_example.py` demonstrates, or the class supports both a `__call__` and a `.generate` method.
**How to avoid:** After installing the `thonburian-tts` package, inspect `FlowTTSPipeline`'s actual methods directly (`python -c "from flowtts.inference import FlowTTSPipeline; help(FlowTTSPipeline)"` or read the installed source) before writing the `/synthesize` endpoint. Do not trust either documented signature blindly.
**Warning signs:** `TypeError: generate() got an unexpected keyword argument` or `AttributeError: 'FlowTTSPipeline' object has no attribute 'generate'`.

### Pitfall 3: `python-multipart` missing causes a cryptic FastAPI error
**What goes wrong:** Omitting `python-multipart` from `requirements.txt` causes FastAPI to raise a runtime error only when the `/transcribe` endpoint is actually hit (not at import time), which can be confusing during smoke-testing.
**Why it happens:** FastAPI/Starlette lazily checks for `python-multipart` only when form/file data is parsed; the dependency is "soft" (not enforced by `pip install fastapi` alone).
**How to avoid:** Always include `python-multipart` explicitly in `requirements.txt` whenever any endpoint uses `UploadFile`/`File()`/`Form()`.
**Warning signs:** `RuntimeError: Form data requires "python-multipart" to be installed` on first request to `/transcribe`.

### Pitfall 4: `chunk_length_s` only matters for audio longer than ~30s
**What goes wrong:** Assuming `chunk_length_s=30` changes behavior for typical short VAD-segmented utterances (a few seconds), when in practice it's a no-op for short clips and only matters for long-form audio.
**Why it happens:** Misreading the model card's example, which is written for general-purpose use (including long audio), not specifically for the short, VAD-segmented utterances this phase's eventual consumer (Phase 4's adapter) will send.
**How to avoid:** Keep `chunk_length_s=30` as a safe default (matches the documented usage) — it does not need tuning down for short clips, but don't expect it to change short-utterance behavior.
**Warning signs:** None expected to actually surface in this phase, since BACK-02's hallucination-on-short-audio handling is explicitly descoped (D-01) — flagging here only so the executor doesn't waste time tuning this parameter.

### Pitfall 5: `torch.backends.mps` not available on non-macOS/non-Apple-Silicon
**What goes wrong:** `torch.backends.mps.is_available()` itself is safe to call on any platform (returns `False` elsewhere), but `AttributeError` could theoretically occur on very old/custom PyTorch builds that lack the `mps` backend module entirely.
**Why it happens:** `mps` backend support was added in relatively recent PyTorch versions (1.12+); virtually all current PyPI-installable `torch` versions have it, but it's worth a defensive check.
**How to avoid:** Use `getattr(torch.backends, "mps", None)` defensively if extra caution is wanted, though given the verified current `torch` version (2.12.1) this is very unlikely to be an issue.
**Warning signs:** `AttributeError: module 'torch.backends' has no attribute 'mps'` (very unlikely given current torch versions).

## Code Examples

### Complete minimal `thonburian-stt/main.py` skeleton
```python
# Source: composed from https://fastapi.tiangolo.com/advanced/events/,
#         https://fastapi.tiangolo.com/tutorial/request-files/, and
#         https://huggingface.co/biodatlab/whisper-th-large-v3-combined
from contextlib import asynccontextmanager
import tempfile

import torch
from fastapi import FastAPI, File, Request, UploadFile
from transformers import pipeline


def select_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@asynccontextmanager
async def lifespan(app: FastAPI):
    device = select_device()
    app.state.asr_pipe = pipeline(
        task="automatic-speech-recognition",
        model="biodatlab/whisper-th-large-v3-combined",
        chunk_length_s=30,
        device=device,
    )
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(request: Request, file: UploadFile = File(...)):
    contents = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(contents)
        tmp.flush()
        result = request.app.state.asr_pipe(
            tmp.name,
            generate_kwargs={"language": "<|th|>", "task": "transcribe"},
            batch_size=16,
        )
    return {"text": result["text"]}
```

### Run command (both services)
```bash
# Source: standard uvicorn/FastAPI convention
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001   # thonburian-stt
uvicorn main:app --host 0.0.0.0 --port 8002   # jai-tts (different port)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `transformers` 4.x pipeline API (what the model card documents) | `transformers` 5.x is now the latest on PyPI | 5.x released sometime before this research session (exact date not independently confirmed) | The Whisper model card's exact usage example was written against 4.x; pin to a recent 4.x release unless 5.x compatibility is independently verified at scaffold time |
| F5-TTS UTF-8 byte-ratio duration estimation | XLM-R neural duration predictor (JaiTTS-F5TTS's own contribution) | Per the JaiTTS-F5TTS model card's own benchmark table | Improves Thai/mixed-script pacing; this phase should use the "+ Duration Predictor" variant if the checkpoint/config supports selecting it, though the basic `JaiTTS-F5TTS` checkpoint without the predictor is also a valid, simpler choice for this phase's demo scope |

**Deprecated/outdated:**
- None identified as deprecated within scope — both target models are current, actively maintained as of this research session.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pip install git+https://github.com/biodatlab/thonburian-tts.git` successfully installs a working `flowtts` package importable as `from flowtts.inference import FlowTTSPipeline, ModelConfig, AudioConfig` | Standard Stack, Architecture Patterns | If the repo's packaging is broken or requires manual `pip install -e .` after clone, scaffolding will fail and require a fallback clone-based install step |
| A2 | The exact `FlowTTSPipeline` calling convention (`.generate(...)` returning `(audio, sr)` vs. `__call__(...)` returning a file path) — two real sources disagree | Pattern 3, Pitfall 2 | Endpoint code written against the wrong signature will throw `TypeError`/`AttributeError` at first request; must be verified against installed package source before finalizing `/synthesize` |
| A3 | `JaiTTS-F5TTS`'s checkpoint path is `hf://JTS-AI/JaiTTS-F5TTS/model.pt` and vocab is `hf://JTS-AI/JaiTTS-F5TTS/vocab.txt` exactly as shown in the model card's Quick Usage snippet | Code Examples, Standard Stack | If the actual file names/paths in the JTS-AI/JaiTTS-F5TTS HF repo differ, `cached_path` resolution will fail with a 404-style error; must spot-check the repo's file listing at scaffold time |
| A4 | `accelerate` is a legitimate, widely-used HuggingFace package despite slopcheck's `[SUS]` low-download flag | Package Legitimacy Audit | Extremely low risk — this is a near-certainty given it's `github.com/huggingface/accelerate`, but flagged per protocol since the tool's signal technically warrants caution |
| A5 | Mozilla Common Voice Thai (or an equivalent CC0/CC-BY dataset) has individually downloadable, license-clear single-clip samples suitable for bundling as `jai-tts`'s default reference voice — this was not independently verified by downloading an actual clip and license file this session | Don't Hand-Roll (BACK-04), Open Questions | If Common Voice's actual distribution format doesn't allow easy single-clip extraction with clear per-clip licensing, the executor will need to find an alternative permissively-licensed source; this is explicitly left as "Open for planner/executor" per CONTEXT.md D-04 |
| A6 | `f5-tts` PyPI package (1.1.20) and the `flowtts` git-installed package are compatible with each other at their respective latest versions — not independently verified by actually running them together | Standard Stack, Common Pitfalls | If version drift between `f5-tts`'s latest PyPI release and what `thonburian-tts`'s `flowtts` package expects causes an incompatibility, dependency pins may need manual adjustment during scaffolding (STATE.md already flags this as a known blocker/concern) |

## Open Questions

1. **Exact `FlowTTSPipeline` calling convention**
   - What we know: Two real sources (HF model card "Quick Usage" vs. GitHub repo's own example script) show different signatures — `.generate(reference_audio=, reference_text=, gen_text=)` returning `(audio, sr)` vs. callable `pipeline(text=, ref_voice=, ref_text=, output_file=, speed=, check_duration=)` returning a file path.
   - What's unclear: Whether the class exposes both methods, whether one is deprecated, or whether the model card's README is simply stale relative to the actual installed package.
   - Recommendation: At scaffold time, after `pip install git+https://github.com/biodatlab/thonburian-tts.git`, run `python -c "from flowtts.inference import FlowTTSPipeline; help(FlowTTSPipeline)"` (or read the installed source directly) and write the endpoint against the actual, verified signature. Treat both documented examples as guidance, not ground truth.

2. **Default reference voice source clip and license terms (BACK-04)**
   - What we know: Mozilla Common Voice Thai is CC0-licensed at the dataset level and is the kind of source CONTEXT.md D-04 points to; the JaiTTS-F5TTS example itself uses a different reference sample (`hf://ThuraAung1601/E2-F5-TTS/ref_samples/ref_sample.wav`) which may itself be usable but its license/provenance was not independently verified this session.
   - What's unclear: The exact mechanics of extracting one clean, single-speaker, clearly-licensed clip + transcript from Common Voice's bulk distribution (it ships as a large bundled archive, not individually browsable clips, in most distribution forms) — or whether to instead reuse the JaiTTS-F5TTS/ThonburianTTS example's own reference clip if its license permits.
   - Recommendation: Planner should treat exact clip sourcing as an explicit task with a `checkpoint:human-verify` gate on license compliance, per CONTEXT.md's own framing ("Open for planner/executor: exact dataset/clip selection, license file to include").

3. **`transformers` 4.x vs 5.x compatibility with the Whisper pipeline usage pattern**
   - What we know: The model card's documented usage was written against the 4.x API; `transformers` 5.x is now the latest on PyPI as of this session.
   - What's unclear: Whether `pipeline("automatic-speech-recognition", model="biodatlab/whisper-th-large-v3-combined", ...)` works identically on 5.x without code changes.
   - Recommendation: Pin `transformers` to a recent `4.x` release in `requirements.txt` (e.g., `transformers>=4.40,<5.0`) to match the documented/tested usage path, rather than floating to 5.x, unless the executor explicitly verifies 5.x compatibility first.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3 | Both services | ✓ | 3.11.7 (pyenv) | — |
| pip | Both services | ✓ | 23.2.1 | — |
| ffmpeg | librosa/soundfile audio decode (jai-tts), possibly thonburian-stt | ✓ | 7.1.1 (Homebrew) | — |
| Apple Silicon GPU (MPS) | Device auto-detection (D-06) | ✓ | Apple M-series (arm64, Darwin 25.0.0) confirmed via `uname -a` | CPU fallback already built into the device-selection pattern |
| CUDA GPU | Device auto-detection (D-06) | ✗ (this machine is Apple Silicon, no discrete NVIDIA GPU) | — | MPS first, then CPU — already covered by the auto-detection chain |
| Internet access (Hugging Face Hub) | Downloading both models' weights at first run | Assumed ✓ (not explicitly tested this session, but required for `hf://` resolution via `cached_path` and `transformers`'s model download) | — | None — both services require at least one successful internet-connected run to cache model weights locally; document this as a first-run prerequisite |
| git | Installing `thonburian-tts` via `pip install git+https://...` | Assumed ✓ (standard on macOS dev machines, not explicitly version-checked this session) | — | None needed; ubiquitous tool |

**Missing dependencies with no fallback:**
- None blocking — Apple Silicon MPS covers the GPU acceleration need on this development machine; CPU is the final fallback for any environment lacking both CUDA and MPS.

**Missing dependencies with fallback:**
- CUDA GPU is absent on this dev machine but MPS (Apple Silicon) is present and is the correct fallback per D-06's auto-detection design — no action needed, this is expected/by-design for this machine.

## Project Constraints (from CLAUDE.md)

khavee-sdk's `CLAUDE.md` governs the TypeScript monorepo (`packages/*`, `src/app/*`) and does not directly constrain Python service code in the sibling `thonburian-stt`/`jai-tts` repos — no TypeScript naming/style/error-handling conventions apply to this phase's deliverables. The following cross-cutting principles DO carry over by extension of the project's overall philosophy and should inform planning:

- **"No secret in the browser" pattern (from `OpenAISTTTTSProvider`'s backend-proxy assumption):** Neither `thonburian-stt` nor `jai-tts` require any API keys or secrets to run (both load open-weight HF models directly) — there is nothing to leak in this phase, but if either service later needs a secret (e.g., a private HF token for a gated model), it must come from an environment variable, never hardcoded, consistent with the rest of the project's pattern.
- **Beginner DX constraint (from PROJECT.md):** While this phase's deliverable is server-side Python, not the SDK's tool-calling API, the same "simplicity over cleverness" spirit applies — D-02/D-03's plain multipart/raw-bytes contracts (rather than a custom binary protocol or streaming framework) are consistent with this principle.
- **GSD Workflow Enforcement:** Direct file edits in `thonburian-stt`/`jai-tts` should still happen via the GSD execute-phase workflow per `khavee-sdk/CLAUDE.md`'s instruction, even though those repos are outside khavee-sdk itself — the planning/execution discipline applies project-wide, not just to files inside this repo.

No directive in CLAUDE.md contradicts any recommendation in this research.

## Sources

### Primary (HIGH confidence)
- https://huggingface.co/biodatlab/whisper-th-large-v3-combined — model card, pipeline usage, license (fetched directly)
- https://huggingface.co/JTS-AI/JaiTTS-F5TTS/raw/main/README.md — full raw README fetched verbatim, including YAML frontmatter, installation steps, Quick Usage code, citation block
- https://github.com/biodatlab/thonburian-tts/blob/main/f5tts_thai_example.py — full raw example script fetched verbatim
- https://fastapi.tiangolo.com/advanced/events/ — official FastAPI lifespan documentation
- `pip3 index versions <pkg>` — direct PyPI registry queries for fastapi, uvicorn, transformers, torch, librosa, cached-path, soundfile, python-multipart (run live this session)
- `slopcheck scan . --json` (ecosystem=pypi, run live this session) — package legitimacy verification

### Secondary (MEDIUM confidence)
- https://github.com/biodatlab/thonburian-tts — repo overview, installation instructions (WebFetch summary, cross-checked against the directly-fetched README.md raw content and example script)
- https://huggingface.co/JTS-AI-Team/JaiTTS (GitHub repo `github.com/JTS-AI-Team/JaiTTS`) — confirmed benchmark/eval-only code, no deployable server (consistent with PROJECT.md's prior research)
- FastAPI request-files and custom-response documentation pages (WebSearch-sourced examples, consistent with widely-known FastAPI idioms)

### Tertiary (LOW confidence)
- WebSearch result describing a "JaiTTS-v1.0" paper based on "VoxCPM" architecture (arxiv 2604.27607) — this appears to describe the *flagship* JaiTTS model (a different, better-performing variant NOT used by this phase), not `JaiTTS-F5TTS` specifically. Flagged for awareness only: the model this phase actually targets (`JaiTTS-F5TTS`) is explicitly self-described in its own model card as "a non-autoregressive JaiTTS voice cloning model based on F5-TTS" and "one of our experimental variants... released for research and benchmarking only" — distinct from the paper's main JaiTTS-v1.0 result. Do not conflate the two; this research targets `JaiTTS-F5TTS` per CONTEXT.md's explicit scope.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all core packages (fastapi, uvicorn, transformers, torch) verified live against PyPI registry and slopcheck; versions confirmed current as of 2026-06-19
- Architecture (FastAPI patterns): HIGH — lifespan/startup pattern and multipart/raw-bytes response patterns are official, well-documented FastAPI idioms, directly fetched from official docs
- Architecture (FlowTTSPipeline/ThonburianTTS specifics): MEDIUM — verified via direct fetch of the actual model card README and example script (not hallucinated), but the exact calling convention is internally inconsistent between two real sources and was not resolved by running the code (the repo is not yet cloned/installed)
- Pitfalls: MEDIUM-HIGH — FastAPI/python-multipart pitfall is well-established community knowledge; flowtts-specific pitfalls are inferred from source inconsistency, not from hands-on reproduction

**Research date:** 2026-06-19
**Valid until:** 14 days (fast-moving ML library ecosystem — `transformers` and `torch` both ship frequent releases; the `thonburian-tts`/`JaiTTS-F5TTS` repos are research-prototype-stage and may change their API surface without notice)
