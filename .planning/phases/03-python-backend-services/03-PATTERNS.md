# Phase 3: Python Backend Services - Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 8 (across two greenfield repos)
**Analogs found:** 0 / 8 in-repo (no existing Python code) — 8 / 8 covered by RESEARCH.md reference patterns + 1 cross-language contract check against khavee-sdk

## Greenfield Confirmation

Both target directories were checked directly and confirmed empty (no files besides the directory itself):

```
$ find /Users/whitemalt/Documents/thonburian-stt -maxdepth 3 -not -path '*/.git*'
/Users/whitemalt/Documents/thonburian-stt

$ find /Users/whitemalt/Documents/jai-tts -maxdepth 3 -not -path '*/.git*'
/Users/whitemalt/Documents/jai-tts
```

There is **no existing Python/FastAPI code anywhere accessible to this phase** (not in khavee-sdk, not in the two sibling repos). This phase is a true greenfield scaffold. Per the orchestrator's brief, the "analog" role is filled by:

1. **RESEARCH.md's `## Code Examples` and `## Architecture Patterns`** — directly-fetched, officially-documented FastAPI/HuggingFace/PyTorch patterns (HIGH confidence per RESEARCH.md's own confidence breakdown). These are reference implementations the planner/executor should copy near-verbatim, not abstractions to reinterpret.
2. **khavee-sdk's existing TypeScript HTTP client code** (`STTClient.ts`, `TTSPlayer.ts`) — read for cross-language **contract-shape cross-check** only (confirms D-02/D-03's chosen shapes are consistent with what the future Phase 4 consumer already expects from a proxy-style backend), not as a code-pattern source for Python.

No file in this phase has an in-repo analog. All "Closest Analog" entries below point to RESEARCH.md sections.

## File Classification

| New File | Repo | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|------|-----------|-----------------|----------------|
| `main.py` | thonburian-stt | controller + service (single-file) | request-response (file-I/O sub-flow) | RESEARCH.md Pattern 1 + Pattern 2 + Code Examples | reference-pattern (no in-repo analog) |
| `requirements.txt` | thonburian-stt | config | n/a | RESEARCH.md Standard Stack + Installation block | reference-pattern |
| `README.md` | thonburian-stt | config/doc | n/a | RESEARCH.md "Run command" block | reference-pattern |
| `.gitignore` | thonburian-stt | config | n/a | RESEARCH.md Recommended Project Structure | reference-pattern |
| `main.py` | jai-tts | controller + service (single-file) | request-response (file-I/O sub-flow) | RESEARCH.md Pattern 1 + Pattern 3 + Pattern 4 | reference-pattern (no in-repo analog; calling-convention open question) |
| `requirements.txt` | jai-tts | config | n/a | RESEARCH.md Standard Stack + Installation block | reference-pattern |
| `assets/default_voice.wav` + `.txt` + `LICENSE-default-voice.txt` | jai-tts | static asset (file-I/O) | file-I/O | RESEARCH.md Open Question 2 / D-04 | no analog — explicitly open for executor |
| `README.md` / `.gitignore` | jai-tts | config/doc | n/a | RESEARCH.md Recommended Project Structure | reference-pattern |

**Note on role/data-flow classification:** Both `main.py` files are intentionally NOT split into controller/service/model layers per CONTEXT.md's explicit discretion grant ("single `main.py` vs `app/` package layout... keep it simple given the demo framing"). RESEARCH.md's own recommendation concurs: single-file is idiomatic for a 1-endpoint demo service. Do not over-engineer a layered structure the user didn't ask for.

---

## Pattern Assignments

### `thonburian-stt/main.py` (controller+service, request-response / file-I/O)

**Analog:** RESEARCH.md "Pattern 1: Model-load-once-at-startup via FastAPI lifespan" + "Pattern 2: Multipart audio upload → JSON text response (D-02)" + "Complete minimal thonburian-stt/main.py skeleton" (RESEARCH.md Code Examples section)

**Imports pattern:**
```python
from contextlib import asynccontextmanager
import tempfile

import torch
from fastapi import FastAPI, File, Request, UploadFile
from transformers import pipeline
```

**Device auto-detection pattern (D-06)** — RESEARCH.md Pattern 4:
```python
def select_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"
```
Defensive variant noted in RESEARCH.md Pitfall 5 if extra caution wanted: `getattr(torch.backends, "mps", None)` — not required given verified current torch version, but available as a fallback if `AttributeError` surfaces.

**Model-load-once-at-startup pattern (lifespan, satisfies non-deferred half of BACK-05):**
```python
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
**Anti-pattern to avoid (RESEARCH.md Anti-Patterns):** never load the model inside the request handler — defeats load-once requirement, causes multi-second-to-minute per-request latency.

**Core request-response pattern (D-02 — multipart upload → JSON text):**
```python
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

**Health-check (Claude's Discretion item, not discussed — follow simplest idiomatic FastAPI convention):**
```python
@app.get("/health")
async def health():
    return {"status": "ok"}
```

**Error handling:** CONTEXT.md's Claude's Discretion explicitly defers to "FastAPI's standard validation/HTTP error conventions, no custom error envelope needed given D-01's descoped robustness." No try/except wrapping is shown in RESEARCH.md's reference pattern — malformed multipart bodies are rejected automatically by FastAPI's `UploadFile`/`File()` validation (422 response) before reaching the handler body. Do not add custom error envelopes per D-01.

**Pitfall to guard against (RESEARCH.md Pitfall 3):** `python-multipart` must be in `requirements.txt` explicitly — FastAPI only raises `RuntimeError: Form data requires "python-multipart" to be installed` lazily, at first `/transcribe` request, not at import time. Easy to miss during smoke-testing.

---

### `thonburian-stt/requirements.txt` (config)

**Analog:** RESEARCH.md "Standard Stack" table + "Installation (thonburian-stt)" block

```
fastapi
uvicorn
python-multipart
transformers
torch
```

RESEARCH.md recommends pinning `transformers` to a `4.x` release (e.g. `transformers>=4.40,<5.0`) rather than floating to the newer `5.x` major, since the Whisper pipeline usage pattern in the model card was documented against the `4.x` API surface (RESEARCH.md "Version verification" note + Open Question 3). Re-verify exact current versions at scaffold time via `pip3 index versions <pkg>` — RESEARCH.md explicitly warns training-data-recalled versions are stale for these fast-moving ML libraries.

---

### `jai-tts/main.py` (controller+service, request-response / file-I/O)

**Analog:** RESEARCH.md "Pattern 1: Model-load-once-at-startup via FastAPI lifespan" (same shape as thonburian-stt, different model) + "Pattern 3: JSON text request → raw WAV bytes response (D-03)" + "Pattern 4: Device auto-detection (D-06)"

**Imports pattern:**
```python
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel
import io
import soundfile as sf
```

**Core request-response pattern (D-03 — JSON text in, raw WAV bytes out, no base64/envelope):**
```python
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

**CRITICAL caveat — calling-convention is unresolved (RESEARCH.md Pattern 3 caveat, Pitfall 2, Open Question 1, Assumption A2):** Two real, independently-fetched sources disagree on `FlowTTSPipeline`'s actual method signature:
- HF model card "Quick Usage": `pipeline.generate(reference_audio=, reference_text=, gen_text=)` → returns `(audio, sr)` tuple
- GitHub repo's own `f5tts_thai_example.py`: callable `pipeline(text=, ref_voice=, ref_text=, output_file=, speed=, check_duration=)` → returns a file path

**The planner/executor MUST NOT trust either signature blindly.** RESEARCH.md's explicit recommendation: after `pip install git+https://github.com/biodatlab/thonburian-tts.git`, run `python -c "from flowtts.inference import FlowTTSPipeline; help(FlowTTSPipeline)"` (or read the installed source) and write the endpoint against the actual verified signature. This should be an explicit task in the plan, not assumed away. Warning signs if wrong: `TypeError: generate() got an unexpected keyword argument` or `AttributeError: 'FlowTTSPipeline' object has no attribute 'generate'`.

**Model-load-once-at-startup pattern (same shape, jai-tts specifics TBD pending calling-convention resolution):**
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    device = select_device()
    app.state.tts_pipe = load_jaitts_pipeline(device)  # exact constructor args depend on resolving the open question above
    yield
```

**Device auto-detection:** identical to thonburian-stt's `select_device()` — copy verbatim, no jai-tts-specific variation needed (RESEARCH.md Pattern 4 is shared across both services).

**Error handling:** Same as thonburian-stt — FastAPI's standard Pydantic validation (empty/malformed `text` field rejected automatically with 422) per CONTEXT.md's Claude's Discretion item; no custom error envelope.

---

### `jai-tts/requirements.txt` (config)

**Analog:** RESEARCH.md "Standard Stack" + "Supporting (jai-tts only)" tables + "Installation (jai-tts)" block

```
fastapi
uvicorn
soundfile
torch
git+https://github.com/biodatlab/thonburian-tts.git
```

**Critical pitfall (RESEARCH.md Pitfall 1):** `flowtts` is NOT on PyPI under any name — `pip install flowtts` will fail or install something unrelated. It is only obtainable via the git-install line above. The model card's own pip line (`pip install torch cached-path librosa transformers f5-tts`) does not include it — easy to assume it's bundled, it is not.

**Trust boundary flag (RESEARCH.md Package Legitimacy Audit, "Note on flowtts itself"):** Installing this git repo is a `checkpoint:human-verify` step per RESEARCH.md's protocol — the repo's actual `pyproject.toml`/`setup.py` packaging was not independently inspected this research session. Verify it installs and imports cleanly before trusting it in the running service.

**`accelerate` flag:** Do not add speculatively. Only install if `ImportError: Accelerate` actually surfaces during scaffolding (RESEARCH.md Standard Stack note + Package Legitimacy Audit — flagged `[SUS]` by the legitimacy tool due to a likely-stale low-download signal, not a genuine hallucination risk, but per protocol gate behind `checkpoint:human-verify` if it becomes necessary).

---

### `jai-tts/assets/default_voice.wav` + `default_voice.txt` + `LICENSE-default-voice.txt` (static asset, file-I/O)

**No analog — explicitly open per CONTEXT.md D-04 and RESEARCH.md Open Question 2.**

CONTEXT.md D-04: "Source a permissively-licensed public Thai speech sample (e.g. from Common Voice Thai or an equivalent CC/public-domain dataset)... Open for planner/executor: exact dataset/clip selection, license file to include, and how the clip + transcript are packaged."

RESEARCH.md adds: Common Voice Thai is CC0 at the dataset level but ships as a bulk archive, not individually browsable clips in most distribution forms — extracting one clean single-speaker clip + transcript needs an explicit task. Alternatively, the JaiTTS-F5TTS model card's own example reference clip (`hf://ThuraAung1601/E2-F5-TTS/ref_samples/ref_sample.wav`) could be reused if its license permits — not independently verified this session.

**Recommendation for planner:** Treat clip sourcing as its own task with a `checkpoint:human-verify` gate on license compliance (per CONTEXT.md's own framing). This is a content-sourcing task, not a code-pattern task — no code excerpt applies here.

---

## Shared Patterns

### Device auto-detection (CUDA → MPS → CPU)
**Source:** RESEARCH.md Pattern 4, Code Examples
**Apply to:** Both services' `main.py`, inside the `lifespan` function, before model load
```python
def select_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"
```
Identical code, copy verbatim into both services. Satisfies D-06.

### Model-load-once via FastAPI lifespan
**Source:** RESEARCH.md Pattern 1
**Apply to:** Both services' `main.py`
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    device = select_device()
    app.state.<model_attr> = <load model with device>
    yield

app = FastAPI(lifespan=lifespan)
```
Same shape both services; only the model-loading call differs. Satisfies the non-deferred half of BACK-05 (load-once is required; concurrency *gating* via semaphore is the descoped half per D-01).

### No custom error envelope
**Source:** CONTEXT.md Claude's Discretion + RESEARCH.md Anti-Patterns/Code Examples (no try/except shown around handler bodies)
**Apply to:** Both services' request handlers
Rely on FastAPI's automatic 422 validation responses for malformed input (bad multipart, empty/wrong-typed JSON body). Do not wrap handlers in custom try/except → custom JSON error shape — explicitly descoped per D-01's "no production-hardening" framing.

### "No secret in the browser" extended principle
**Source:** khavee-sdk CLAUDE.md's `OpenAISTTTTSProvider` backend-proxy assumption, extended by RESEARCH.md's "Project Constraints" section
**Apply to:** Both services
Neither service requires a secret/API key to run (both load open-weight HF models directly) — nothing to leak this phase. If a private/gated HF model token is ever needed, it must come from an environment variable (`os.environ[...]`), never hardcoded — consistent with the rest of the project's "no secret in client/source code" pattern, even though there's no actual secret-handling code to write in this phase.

### Plain venv + uvicorn run convention
**Source:** RESEARCH.md "Run command (both services)" block, satisfies D-05
**Apply to:** Both services' README.md
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001   # thonburian-stt
uvicorn main:app --host 0.0.0.0 --port 8002   # jai-tts (different port)
```

### Cross-language contract cross-check (informational, not a code pattern to copy)
**Source:** `packages/providers/openai-stt-tts/src/STTClient.ts` (khavee-sdk, lines 35-71) and `TTSPlayer.ts` (lines 1-60)
**Relevance:** Confirms the *shape* of D-02/D-03's chosen contracts is consistent with how khavee-sdk's existing STT/TTS HTTP clients already operate (multipart upload with a file field, JSON response with a text field; raw audio bytes fetched and decoded client-side) — even though field names differ (`STTClient.ts` uses `audio`/`transcript`, D-02 uses `file`/`text` — Phase 4 is explicitly responsible for reconciling/pinning this, not this phase). No code here should be copied into the Python services; it is provided only so the planner understands why D-02/D-03's shapes were chosen as "close to what the existing TS client already expects."

```typescript
// STTClient.ts:41-44 — existing TS client's multipart shape (for contrast only)
const form = new FormData();
form.append("audio", wavBlob, "utterance.wav");
```
```typescript
// STTClient.ts:64-66 — existing TS client's expected JSON response shape (for contrast only)
type STTResponse =
  | { transcript: string }
  | { data: { transcript: string } };
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `thonburian-stt/main.py` | controller+service | request-response/file-I/O | No existing Python code in either target repo or in khavee-sdk; covered instead by RESEARCH.md Patterns 1, 2, 4 (HIGH confidence, directly fetched from official FastAPI/HF docs) |
| `jai-tts/main.py` | controller+service | request-response/file-I/O | Same — covered by RESEARCH.md Patterns 1, 3, 4 (MEDIUM confidence on Pattern 3 specifically — calling convention unresolved, flagged as Open Question 1) |
| `jai-tts/assets/default_voice.*` | static asset | file-I/O | No code pattern applies — content-sourcing task, explicitly left open by CONTEXT.md D-04 |
| `requirements.txt` (both) | config | n/a | No existing Python dependency manifest anywhere in scope; covered by RESEARCH.md Standard Stack tables |

## Metadata

**Analog search scope:** `/Users/whitemalt/Documents/thonburian-stt` (confirmed empty), `/Users/whitemalt/Documents/jai-tts` (confirmed empty), `khavee-sdk/packages/providers/openai-stt-tts/src/` (read for cross-language contract cross-check only — `STTClient.ts`, `TTSPlayer.ts`)
**Files scanned:** 2 directories (empty) + 2 TypeScript files (contract cross-check) + RESEARCH.md (primary pattern source)
**Pattern extraction date:** 2026-06-19
**Primary pattern source:** `.planning/phases/03-python-backend-services/03-RESEARCH.md` — `## Architecture Patterns` (Patterns 1-4), `## Code Examples` (complete `main.py` skeleton), `## Common Pitfalls` (5 pitfalls), `## Open Questions` (3 questions, #1 and #2 directly affect file content)
