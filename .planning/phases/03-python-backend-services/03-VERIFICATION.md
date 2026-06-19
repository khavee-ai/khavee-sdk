---
phase: 03-python-backend-services
verified: 2026-06-19T00:00:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
---

# Phase 3: Python Backend Services Verification Report

**Phase Goal:** Two standalone, production-shaped Python services exist (outside the khavee-sdk repo) that turn audio into Thai text and Thai text into audio, safely under concurrent load
**Verified:** 2026-06-19
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POSTing a Thai-speech WAV utterance to thonburian-stt `/transcribe` returns Thai transcription text (D-02 contract) | ✓ VERIFIED | `/Users/whitemalt/Documents/thonburian-stt/main.py:52-63` — `@app.post("/transcribe")` reads `UploadFile`, writes to `tempfile.NamedTemporaryFile`, calls `request.app.state.asr_pipe(...)`, returns `{"text": result["text"]}`. `python3 -m py_compile` exits 0. |
| 2 | The Whisper model is loaded exactly once at startup, not per request | ✓ VERIFIED | `main.py:28-40` — `app.state.asr_pipe = pipeline(...)` assigned inside `lifespan()` before `yield` (line 40); handler at line 58 only calls/reads `request.app.state.asr_pipe`, never reassigns. |
| 3 | The service auto-detects CUDA, then MPS, then falls back to CPU (D-06) | ✓ VERIFIED | `main.py:19-25` — `select_device()` implements exact chain: `torch.cuda.is_available()` → `torch.backends.mps.is_available()` → `"cpu"`. |
| 4 | A developer can install deps and run the service with plain venv + uvicorn (D-05) | ✓ VERIFIED | `README.md:9-14` documents `python3 -m venv venv` / `pip install -r requirements.txt` / `uvicorn main:app --host 0.0.0.0 --port 8001`. No Docker/docker-compose file exists anywhere in either service tree (confirmed via filesystem search). |
| 5 | BACK-02 and BACK-05-semaphore are explicitly deferred per D-01, documented in README | ✓ VERIFIED | `thonburian-stt/README.md:45-58` "Out of scope (deferred)" section names BACK-02 and BACK-05 explicitly and cites D-01. |
| 6 | POSTing Thai text to jai-tts `/synthesize` returns raw audio/wav bytes (D-03 contract) | ✓ VERIFIED | `jai-tts/main.py:96-121` — `@app.post("/synthesize")` calls `tts_pipe(...)`, reads resulting file bytes, returns `Response(content=wav_bytes, media_type="audio/wav")`. No base64/JSON envelope (`grep -i base64` returns no hits). `python3 -m py_compile` exits 0. |
| 7 | Calling `/synthesize` with text alone succeeds using the bundled default Thai reference voice (D-04) | ✓ VERIFIED | `main.py:41-43` defines `DEFAULT_VOICE_PATH`/`DEFAULT_VOICE_TEXT` from `assets/`; handler at line 111-113 passes `ref_voice=DEFAULT_VOICE_PATH, ref_text=DEFAULT_VOICE_TEXT` unconditionally — no caller-supplied reference audio is required. |
| 8 | The TTS pipeline is loaded exactly once at startup, not per request | ✓ VERIFIED | `main.py:56-80` — `app.state.tts_pipe = FlowTTSPipeline(...)` assigned inside `lifespan()` before `yield` (line 80); handler at line 109 only calls `request.app.state.tts_pipe`. |
| 9 | jai-tts auto-detects CUDA, then MPS, then falls back to CPU (D-06) | ✓ VERIFIED | `main.py:48-53` — identical `select_device()` chain to thonburian-stt. |
| 10 | A permissively-licensed default reference voice clip + transcript + license file are bundled in assets/ (D-04) | ✓ VERIFIED | `assets/default_voice.wav` (240KB, confirmed via `file`: valid RIFF/WAVE PCM 16-bit mono 16kHz), `assets/default_voice.txt` (Thai transcript), `assets/LICENSE-default-voice.txt` (names Google FLEURS dataset, CC BY 4.0, with a documented survey of 3 rejected alternative sources and rationale). All three non-empty and substantively present. |
| 11 | Both services run via plain venv + uvicorn per D-05, with no Docker | ✓ VERIFIED | `jai-tts/README.md:11-27` documents identical venv+uvicorn flow (port 8002). No Dockerfile/docker-compose anywhere in either tree. |
| 12 | BACK-05's semaphore half is explicitly deferred per D-01, documented in README | ✓ VERIFIED | `jai-tts/README.md:125-136` "Out of scope (deferred)" section names BACK-05 explicitly, cites D-01. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `/Users/whitemalt/Documents/thonburian-stt/main.py` | FastAPI app, lifespan model-load, POST /transcribe, GET /health | ✓ VERIFIED | 64 lines. Compiles (`py_compile` exit 0). Contains `biodatlab/whisper-th-large-v3-combined`, `app.state.asr_pipe`, both routes. |
| `/Users/whitemalt/Documents/thonburian-stt/requirements.txt` | Pinned manifest incl. python-multipart | ✓ VERIFIED | `fastapi>=0.137,<1.0`, `uvicorn>=0.49,<1.0`, `python-multipart>=0.0.32,<1.0`, `transformers>=4.40,<5.0`, `torch>=2.4,<3.0` — all 5 deps present, transformers correctly range-pinned to 4.x. |
| `/Users/whitemalt/Documents/thonburian-stt/README.md` | venv+uvicorn instructions, ffmpeg/first-run prereqs | ✓ VERIFIED | Documents port 8001, `brew install ffmpeg`, HF first-run download note, full API contract, explicit BACK-02/BACK-05/D-01 deferral section. |
| `/Users/whitemalt/Documents/thonburian-stt/.gitignore` | Ignores venv/, __pycache__/, test WAVs | ✓ VERIFIED | Contains `venv/`, `__pycache__/`, `*.pyc`, `*.wav`. |
| `/Users/whitemalt/Documents/jai-tts/main.py` | FastAPI app, lifespan TTS-pipeline load, POST /synthesize, GET /health | ✓ VERIFIED | 122 lines. Compiles (`py_compile` exit 0). Contains `/synthesize`, `app.state.tts_pipe`, `media_type="audio/wav"`, `default_voice` reference. |
| `/Users/whitemalt/Documents/jai-tts/requirements.txt` | Manifest incl. git+thonburian-tts flowtts install | ✓ VERIFIED | Lists `fastapi`, `uvicorn`, `soundfile`, `torch` plus a documented comment block explaining the flowtts packaging bug and pointing to `github.com/biodatlab/thonburian-tts`; deliberately does NOT list a bare PyPI `flowtts` entry. |
| `/Users/whitemalt/Documents/jai-tts/assets/default_voice.wav` | Bundled default Thai reference voice (BACK-04) | ✓ VERIFIED | 240KB valid WAV (RIFF/PCM 16-bit mono 16kHz), confirmed via `file` command. |
| `/Users/whitemalt/Documents/jai-tts/assets/default_voice.txt` | Transcript of default clip | ✓ VERIFIED | Contains matching Thai transcript text. |
| `/Users/whitemalt/Documents/jai-tts/assets/LICENSE-default-voice.txt` | License/attribution | ✓ VERIFIED | 3153 bytes; names Google FLEURS dataset, CC BY 4.0 license, full provenance + a documented comparison against 3 rejected alternative sources. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `lifespan(app)` (thonburian-stt) | `app.state.asr_pipe` | `transformers.pipeline` assignment before yield | ✓ WIRED | Line 34 assigns, line 40 yields after. Handler (line 58) only reads. |
| `transcribe` handler | `app.state.asr_pipe` | `request.app.state.asr_pipe(...)` call | ✓ WIRED | Line 58: `request.app.state.asr_pipe(tmp.name, generate_kwargs=..., batch_size=16)`. |
| `lifespan(app)` (jai-tts) | `app.state.tts_pipe` | `FlowTTSPipeline` load assignment before yield | ✓ WIRED | Line 75 assigns, line 80 yields after. |
| `synthesize` handler | `app.state.tts_pipe` | `request.app.state.tts_pipe(...)` call against verified signature | ✓ WIRED | Line 109: calls with verified `__call__(text=, ref_voice=, output_file=, ref_text=, speed=, check_duration=)` signature, confirmed empirically via `inspect.signature()` per SUMMARY and corroborated by the actual installed package import succeeding live (see Behavioral Spot-Checks). |
| `synthesize` handler | `assets/default_voice.wav` | default reference voice path constant | ✓ WIRED | Line 42: `DEFAULT_VOICE_PATH = str(ASSETS_DIR / "default_voice.wav")`; passed at line 111 as `ref_voice=DEFAULT_VOICE_PATH`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| thonburian-stt main.py is syntactically valid and matches all Task 2 acceptance grep assertions | `python3 -m py_compile main.py && grep` chain from PLAN `<verify>` | All assertions passed | ✓ PASS |
| jai-tts main.py is syntactically valid and matches all Task 2 acceptance grep assertions | `python3 -m py_compile main.py && grep` chain from PLAN `<verify>` | All assertions passed | ✓ PASS |
| jai-tts Task 1 trust-boundary + license artifacts present | `test -f/-s` + grep chain from PLAN `<verify>` | All assertions passed | ✓ PASS |
| flowtts (git-installed, patched) actually imports in the jai-tts venv — this is the load-bearing trust-boundary claim from SUMMARY.md, independently re-executed by the verifier (not trusted from narration) | `./venv/bin/python -c "from flowtts.inference import FlowTTSPipeline, ModelConfig, AudioConfig; print('flowtts OK')"` | Printed `flowtts OK` | ✓ PASS |
| No Docker/docker-compose files exist in either service tree (D-05 "no Docker" constraint) | `find ... -iname "*docker*"` | No matches | ✓ PASS |
| No debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) in either main.py | `grep -nE` | No matches in either file | ✓ PASS |
| CR-01 fix (race condition on shared output file) is actually present in the live file, not just claimed in REVIEW.md | Read `jai-tts/main.py:96-121` directly | Confirmed: `uuid.uuid4().hex`-suffixed `output_file` per request, `Path(output_file).unlink(missing_ok=True)` in a `finally` block | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BACK-01 | 03-01 | thonburian-stt accepts posted audio, returns Thai transcription via biodatlab/whisper-th-large-v3-combined | ✓ SATISFIED | `main.py` POST /transcribe implemented and wired against the exact model id; py_compile passes. REQUIREMENTS.md still shows "Pending" status text (not yet flipped to Complete) — documentation lag, not a code gap. |
| BACK-02 | 03-01 | Hallucination rejection on short/silent audio | DEFERRED (per D-01, confirmed) | REQUIREMENTS.md traceability table marks "Deferred"; CONTEXT.md D-01 documents rationale; thonburian-stt/README.md explicitly names BACK-02 in its "Out of scope (deferred)" section. Not implemented in main.py (no repetition/silence_trim symbols) — consistent with the deferral, not a gap. |
| BACK-03 | 03-02 | jai-tts accepts posted Thai text, returns synthesized WAV via JaiTTS-F5TTS | ✓ SATISFIED | `main.py` POST /synthesize implemented, returns raw audio/wav bytes per D-03; py_compile passes; live flowtts import confirmed working. |
| BACK-04 | 03-02 | jai-tts ships a validated default Thai reference voice for text-only synthesis | ✓ SATISFIED | `assets/default_voice.{wav,txt}` + `LICENSE-default-voice.txt` bundled and wired into the handler unconditionally (no caller-supplied reference required). |
| BACK-05 | 03-01, 03-02 | Both services load model once at startup AND gate concurrent requests via semaphore | PARTIALLY SATISFIED — load-once half ✓ SATISFIED, semaphore half DEFERRED (per D-01, confirmed) | Load-once-at-startup verified in both `lifespan()` blocks (key links table above). Semaphore/gating half explicitly deferred per CONTEXT.md D-01 and REQUIREMENTS.md "Deferred" status; both READMEs document this. Not a gap — explicitly scoped out by project decision. |

All 5 requirement IDs declared across both PLAN frontmatter blocks (BACK-01, BACK-02, BACK-03, BACK-04, BACK-05) are accounted for in REQUIREMENTS.md — no orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `jai-tts/main.py` | (fixed, was 64) | CR-01: shared fixed output file path race condition | Was Critical, now FIXED | Verified fixed in live file: per-request `uuid4()`-suffixed temp file + `finally: unlink`. No longer a gap. |
| `thonburian-stt/main.py` | 52-63 | WR-01/WR-04: no try/except around pipeline call, no upload size cap | Warning (open, accepted) | Documented in 03-REVIEW.md as advisory debt, consistent with D-01's descoped-robustness framing. Does not contradict any explicit must-have in PLAN frontmatter (no must-have claims error-handling or size limits). |
| `jai-tts/main.py` | 91-93 | WR-02/WR-03: no try/except around pipeline call, no empty-text validation | Warning (open, accepted) | Same as above — advisory debt, not a missing must-have. |
| `jai-tts/requirements.txt` | comment block | IN-04: unpinned flowtts clone SHA | Info (open, accepted) | Documented maintainability risk, not a functional defect; no must-have requires SHA pinning. |

No blocking debt markers (TBD/FIXME/XXX without issue reference) found in either modified file. The one Critical finding from code review (CR-01) was confirmed fixed in the actual codebase, not just claimed — verified by reading the live file directly.

### Human Verification Required

None. All must-haves resolved programmatically:
- Both `main.py` files compile and match every grep-verifiable structural assertion from their respective PLAN `<verify>` blocks.
- The `flowtts` trust-boundary import was independently re-executed against the live venv by this verifier (not trusted from SUMMARY narration) and printed `flowtts OK`.
- The CR-01 critical-bug fix was independently confirmed present in the live file (not trusted from REVIEW.md's "Post-Review Resolution" claim alone).
- License/provenance documentation for the bundled voice clip is complete and internally consistent (dataset, license, rejected-alternatives rationale).
- No Docker artifacts exist, confirming the D-05 "plain venv + uvicorn only" constraint.
- Full end-to-end model-download + real-audio inference smoke tests (multi-GB Whisper/F5-TTS weights) are explicitly out of scope for this phase per both PLANs' `<verification>` sections ("left to first run with internet/GPU access" / "Phase 4 follow-up") — this is a documented, deliberate scope boundary, not an unverified gap.

### Gaps Summary

No gaps. Both services exist as substantive, compiling, internally-consistent FastAPI applications outside the khavee-sdk repo, each implementing their documented HTTP contract (D-02/D-03), the model-load-once-at-startup pattern (verified via direct file inspection of lifespan/handler wiring), the CUDA→MPS→CPU device auto-detection chain, and (for jai-tts) a properly licensed bundled default voice. The one Critical code-review finding (CR-01, a concurrent-request race condition) was independently re-verified as fixed in the live file. BACK-02 and the BACK-05 semaphore half are deliberately deferred per a documented project decision (D-01) that is consistently reflected in CONTEXT.md, REQUIREMENTS.md, and both service READMEs — this is a scoping decision, not a missing deliverable, and matches the phase's "production-shaped" (not "production-hardened") framing in the roadmap goal.

Remaining open items (WR-01 through WR-05's error-handling/validation/cleanup warnings beyond CR-01, and IN-01 through IN-04's info-level notes) are accepted advisory debt per the code review's own resolution note, consistent with D-01's demo-scope framing, and do not contradict any explicit must-have in either PLAN's frontmatter.

---

*Verified: 2026-06-19*
*Verifier: Claude (gsd-verifier)*
