---
phase: 03-python-backend-services
reviewed: 2026-06-19T04:46:25Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - /Users/whitemalt/Documents/thonburian-stt/main.py
  - /Users/whitemalt/Documents/thonburian-stt/requirements.txt
  - /Users/whitemalt/Documents/thonburian-stt/README.md
  - /Users/whitemalt/Documents/thonburian-stt/.gitignore
  - /Users/whitemalt/Documents/jai-tts/main.py
  - /Users/whitemalt/Documents/jai-tts/requirements.txt
  - /Users/whitemalt/Documents/jai-tts/README.md
  - /Users/whitemalt/Documents/jai-tts/.gitignore
  - /Users/whitemalt/Documents/jai-tts/assets/default_voice.txt
  - /Users/whitemalt/Documents/jai-tts/assets/LICENSE-default-voice.txt
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-06-19T04:46:25Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed two greenfield FastAPI services (`thonburian-stt`: Thai Whisper STT, `jai-tts`: Thai F5-TTS
voice cloning) that prove out the khavee-sdk generic pipeline abstraction end-to-end. Both services
are intentionally minimal/demo-scoped per documented decision D-01 (no hallucination rejection, no
concurrency-gating semaphore), and that scoping is honestly and clearly documented in both READMEs
and module docstrings — this is good practice and not flagged as a defect.

However, one issue rises above the documented "demo-scope tradeoff" list and constitutes a real
correctness bug rather than a deferred feature: `jai-tts`'s `/synthesize` endpoint writes every
request's output to the same fixed file path (`temp/synthesize_output.wav`), so concurrent requests
will race on that file and can return another request's audio, a truncated/corrupted file, or fail
outright. This is data-corruption-on-concurrent-use, not a performance issue, and is in scope for
this review.

Beyond that, both endpoints are missing baseline robustness: there's no exception handling around
the model/pipeline invocation (the single most likely failure point — malformed/non-audio uploads,
ffmpeg failures, empty/degenerate TTS input), no upload size limits, and no input validation on
`SynthesizeRequest.text` (empty string is accepted and passed straight to the TTS engine). None of
these are flagged in the documented out-of-scope list (which only covers BACK-02 and BACK-05), so
they are genuine gaps rather than accepted tradeoffs.

## Critical Issues

### CR-01: Concurrent `/synthesize` requests race on a shared fixed output file path

**File:** `jai-tts/main.py:97-111`
**Issue:** Every call to `POST /synthesize` writes to the exact same path,
`TEMP_DIR / "synthesize_output.wav"`, with no per-request uniqueness (no UUID, no request ID, no
temp-file isolation):
```python
TEMP_DIR.mkdir(parents=True, exist_ok=True)
output_file = str(TEMP_DIR / "synthesize_output.wav")
...
output_path = request.app.state.tts_pipe(
    text=body.text,
    ref_voice=DEFAULT_VOICE_PATH,
    output_file=output_file,
    ...
)
wav_bytes = Path(output_path).read_bytes()
```
FastAPI/uvicorn can process multiple in-flight requests concurrently (the TTS pipeline call is a
blocking sync call inside an `async def` handler, so it runs in a thread-pool, and multiple worker
threads can be mid-synthesis simultaneously). Two concurrent requests will both target
`synthesize_output.wav`: one request can read back the *other* request's audio (returning the wrong
voice/text to the wrong caller), or read a partially-written file if the read happens between the
other request's write start and finish. This is a correctness/data-integrity bug, not merely a
performance concern, and is outside the documented out-of-scope list in the README (which only
covers the BACK-05 semaphore/concurrency-gating *protection*, not request isolation).
**Fix:** Generate a unique filename per request (e.g. `uuid4()` or the request's object id) so
concurrent requests cannot collide:
```python
import uuid

@app.post("/synthesize")
async def synthesize(request: Request, body: SynthesizeRequest):
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    output_file = str(TEMP_DIR / f"synthesize_{uuid.uuid4().hex}.wav")
    try:
        output_path = request.app.state.tts_pipe(
            text=body.text,
            ref_voice=DEFAULT_VOICE_PATH,
            output_file=output_file,
            ref_text=DEFAULT_VOICE_TEXT,
            speed=1.0,
            check_duration=False,
        )
        wav_bytes = Path(output_path).read_bytes()
    finally:
        Path(output_file).unlink(missing_ok=True)
    return Response(content=wav_bytes, media_type="audio/wav")
```
(Cleanup via `unlink` also prevents unbounded growth of `temp/` across requests, which the current
code never deletes.)

## Warnings

### WR-01: No error handling around the ASR pipeline call — unhandled 500 on bad input

**File:** `thonburian-stt/main.py:52-63`
**Issue:** `request.app.state.asr_pipe(tmp.name, ...)` and the subsequent `result["text"]` access
have no try/except. A non-audio upload, a zero-byte file, a corrupt WAV, or any internal
`transformers`/`ffmpeg` failure propagates as an unhandled exception, producing a generic FastAPI
500 with (depending on deployment config) a stack trace, rather than a clean 4xx/5xx response. This
is unlike `jai-tts`'s documented stance of "FastAPI/Pydantic's automatic 422 ... is sufficient" —
that only covers Pydantic validation, not pipeline-time failures, and `thonburian-stt` has no
equivalent reasoning documented for skipping this.
**Fix:**
```python
@app.post("/transcribe")
async def transcribe(request: Request, file: UploadFile = File(...)):
    contents = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(contents)
        tmp.flush()
        try:
            result = request.app.state.asr_pipe(
                tmp.name,
                generate_kwargs={"language": "<|th|>", "task": "transcribe"},
                batch_size=16,
            )
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Transcription failed: {exc}") from exc
    return {"text": result.get("text", "")}
```

### WR-02: No error handling around the TTS pipeline call

**File:** `jai-tts/main.py:95-112`
**Issue:** `request.app.state.tts_pipe(...)` is called with no try/except. If the underlying
`flowtts` pipeline raises (e.g. due to empty text, an unsupported character set, or an internal
model error), the request fails with an unhandled 500 rather than a clean error response.
**Fix:** Wrap the pipeline call in try/except and convert to `HTTPException(status_code=422, ...)`
or `500` with a clear message, mirroring the fix shown in WR-01.

### WR-03: No validation on `SynthesizeRequest.text` — empty/whitespace-only input accepted

**File:** `jai-tts/main.py:91-93`
**Issue:** `text: str` has no `min_length` constraint or strip-and-check validation. An empty string
(`{"text": ""}`) or a whitespace-only string passes Pydantic validation and is forwarded directly to
the TTS pipeline, whose behavior on empty input is unverified (could throw, hang, or silently return
a zero-length/garbage WAV). The module docstring states "no custom error envelope... automatic 422
... is sufficient," but Pydantic's default `str` type does not reject empty strings, so this
intended safety net does not actually fire for the most obvious bad input.
**Fix:**
```python
from pydantic import BaseModel, field_validator

class SynthesizeRequest(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be empty")
        return v
```

### WR-04: No upload size limit on `/transcribe` — unbounded memory read of request body

**File:** `thonburian-stt/main.py:53-54`
**Issue:** `contents = await file.read()` reads the entire uploaded file into memory with no size
cap. A large or malicious upload (e.g. several GB) will be buffered fully in process memory before
any processing happens, risking OOM on the host. There is no `Content-Length` pre-check or
chunked-read-with-limit.
**Fix:** Enforce a reasonable max size, e.g.:
```python
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

contents = await file.read()
if len(contents) > MAX_UPLOAD_BYTES:
    raise HTTPException(status_code=413, detail="File too large")
```

### WR-05: `temp/synthesize_output.wav` is never cleaned up — unbounded disk growth and stale-file leakage

**File:** `jai-tts/main.py:97-111`
**Issue:** Independent of the race condition in CR-01, even in the single-request case the output
file written to `TEMP_DIR` is never deleted after being read and returned. Combined with the fixed
filename (post-fix this becomes a growing set of UUID-named files), `temp/` will grow unbounded
across the service's lifetime with no cleanup path.
**Fix:** Delete the temp file after reading it back (see the `finally: Path(output_file).unlink(missing_ok=True)` block proposed in CR-01's fix), or write to a `tempfile.NamedTemporaryFile` context manager instead of a fixed path under `TEMP_DIR`.

## Info

### IN-01: Unused `request: Request` parameter pattern is inconsistent with FastAPI idioms

**File:** `thonburian-stt/main.py:53`, `jai-tts/main.py:96`
**Issue:** Both handlers take `request: Request` solely to reach `request.app.state.<pipe>`. FastAPI
supports binding shared startup-time state more directly (e.g. a small dependency function using
`Depends`, or reading `app.state` via the module-level `app` object directly since both pipelines
are module-global singletons here). Not a bug, but the `Request` parameter obscures that this
handler has no other use for request internals (headers, client info, etc.).
**Fix:** Optional cleanup — e.g. `def transcribe(file: UploadFile = File(...)): result = app.state.asr_pipe(...)` referencing the module-level `app` directly, or introduce a typed `Depends` accessor if multiple endpoints end up sharing it.

### IN-02: No Content-Type/extension validation on uploaded STT file

**File:** `thonburian-stt/main.py:52-57`
**Issue:** The endpoint accepts any `UploadFile` regardless of declared `content_type` or filename
extension, then unconditionally writes it to a `.wav`-suffixed temp file and feeds it to the ASR
pipeline. Non-WAV audio (mp3, ogg) may still work via ffmpeg's format sniffing, but no validation
exists to reject obviously wrong inputs (e.g. a `.txt` or `.png` file) before it reaches the model,
making error messages from such cases entirely dependent on the pipeline's internal error surface
(see WR-01).
**Fix:** Optionally validate `file.content_type` starts with `audio/` or check magic bytes before
processing, returning a clear 415/422 for non-audio uploads.

### IN-03: `result["text"]` assumes a fixed dict shape from the ASR pipeline with no defensive access

**File:** `thonburian-stt/main.py:63`
**Issue:** `transformers.pipeline(task="automatic-speech-recognition", ...)` typically returns
`{"text": "..."}` for non-chunked output, but with `chunk_length_s=30` set (as configured at
`main.py:37`) and certain pipeline configurations, the return shape can include a `"chunks"` key or
differ for batched/streaming variants. Direct `result["text"]` indexing (vs `.get("text")`) will
raise `KeyError` rather than degrading gracefully if the shape ever differs.
**Fix:** Use `result.get("text", "")` and log/handle the missing-key case, or assert the expected
shape explicitly with a clear error message.

### IN-04: `flowtts` dependency is an unpublished, manually-patched local clone — fragile supply chain documented but not pinned

**File:** `jai-tts/requirements.txt:6-21`, `jai-tts/README.md:29-83`
**Issue:** This is not a code bug, but worth flagging as a maintainability/quality risk: the
`flowtts` dependency cannot be installed via `requirements.txt` at all — it requires manually
cloning `biodatlab/thonburian-tts` at an unpinned `HEAD`, patching in missing `__init__.py` files,
and installing the patched clone. There is no commit SHA pinned for the clone step (`git clone
https://github.com/biodatlab/thonburian-tts.git` with no `--branch`/checkout-to-SHA step), so a
future upstream change to that repo (e.g. removing `FlowTTSPipeline`, changing its `__call__`
signature, or fixing/breaking the missing-`__init__.py` issue) would silently break this service's
build reproducibility with no version lock to detect drift.
**Fix:** Pin the upstream clone to a specific commit SHA in the README's `git clone` step (e.g.
`git clone ... && git checkout <sha>`), so the documented workaround stays reproducible even if
upstream changes.

---

## Post-Review Resolution

**CR-01 fixed (2026-06-19):** `jai-tts/main.py`'s `/synthesize` now writes to a per-request
`uuid4()`-suffixed temp file (not the fixed `synthesize_output.wav` path) and deletes it in a
`finally` block after reading the bytes back — closing both the concurrent-request race and the
WR-05 disk-growth leak in one change. Verified with `python3 -m py_compile`.

WR-01/WR-02/WR-03/WR-04 and the Info items remain open — advisory per `workflow.code_review`,
consistent with this phase's documented demo-scope tradeoffs (D-01: no custom error envelope).

---

_Reviewed: 2026-06-19T04:46:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
