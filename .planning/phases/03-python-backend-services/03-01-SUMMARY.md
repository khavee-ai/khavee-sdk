---
phase: 03-python-backend-services
plan: 01
subsystem: api
tags: [fastapi, whisper, transformers, torch, thai-asr, python]

# Dependency graph
requires: []
provides:
  - "thonburian-stt FastAPI service scaffold at /Users/whitemalt/Documents/thonburian-stt"
  - "POST /transcribe (multipart WAV -> {\"text\": string}) backed by biodatlab/whisper-th-large-v3-combined"
  - "GET /health endpoint"
  - "Model-load-once-at-startup pattern via FastAPI lifespan with CUDA->MPS->CPU device auto-detection"
affects: [04-khavee-sdk-adapters, 05-end-to-end-demo]

# Tech tracking
tech-stack:
  added: [fastapi, uvicorn, python-multipart, transformers, torch]
  patterns:
    - "FastAPI lifespan context manager loads expensive ML model into app.state exactly once before yield, never inside a request handler"
    - "CUDA -> Apple Silicon MPS -> CPU device auto-detection chain (select_device())"
    - "Multipart file upload -> tempfile.NamedTemporaryFile -> model inference -> JSON response (no custom error envelope, relies on FastAPI's automatic 422 validation)"

key-files:
  created:
    - /Users/whitemalt/Documents/thonburian-stt/main.py
    - /Users/whitemalt/Documents/thonburian-stt/requirements.txt
    - /Users/whitemalt/Documents/thonburian-stt/README.md
    - /Users/whitemalt/Documents/thonburian-stt/.gitignore
  modified: []

key-decisions:
  - "Pinned transformers>=4.40,<5.0 per RESEARCH.md Open Question 3 (Whisper pipeline usage documented against 4.x API; 5.x breaking changes unverified) -- live pip3 index versions check confirmed both the 4.x range and current majors exist on PyPI at scaffold time"
  - "Pinned fastapi>=0.137,<1.0, uvicorn>=0.49,<1.0, python-multipart>=0.0.32,<1.0, torch>=2.4,<3.0 using floors verified live against PyPI (not recalled from training data, per RESEARCH.md guidance for fast-moving ML libraries)"
  - "Single-file main.py layout (no app/ package) -- explicitly Claude's discretion per CONTEXT.md, idiomatic for a one-endpoint demo service"
  - "BACK-02 (hallucination rejection) and the BACK-05 semaphore/concurrency-gating half are deliberately NOT implemented, per decision D-01 -- documented in README's 'Out of scope (deferred)' section"

patterns-established:
  - "Model-load-once via FastAPI lifespan: app.state.<model> assigned before yield, read-only access in request handlers"
  - "Device auto-detection: torch.cuda.is_available() -> torch.backends.mps.is_available() -> cpu fallback"
  - "No custom error envelope -- rely on FastAPI's built-in 422 validation for malformed input"

requirements-completed: [BACK-01, BACK-02, BACK-05]

# Metrics
duration: 1min
completed: 2026-06-19
---

# Phase 3 Plan 1: thonburian-stt FastAPI Scaffold Summary

**FastAPI service wrapping biodatlab/whisper-th-large-v3-combined for Thai ASR, with CUDA->MPS->CPU device auto-detection and model loaded exactly once at startup via lifespan.**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-06-19T04:17:09Z
- **Completed:** 2026-06-19T04:18:08Z
- **Tasks:** 2 completed
- **Files modified:** 4 created

## Accomplishments
- Scaffolded the `thonburian-stt` repo at `/Users/whitemalt/Documents/thonburian-stt` (previously empty) with `main.py`, `requirements.txt`, `README.md`, `.gitignore`
- Implemented `POST /transcribe` (multipart WAV upload -> `{"text": string}`) and `GET /health` per the D-02 HTTP contract
- Implemented the model-load-once-at-startup pattern via FastAPI's `lifespan` context manager, with `app.state.asr_pipe` assigned before `yield` and only read (never reassigned) in the request handler
- Implemented the D-06 device auto-detection chain (`select_device()`: CUDA -> Apple Silicon MPS -> CPU)
- Verified live PyPI versions for all five dependencies via `pip3 index versions` rather than relying on training-data recall (RESEARCH.md explicitly flagged this as a fast-moving ML library ecosystem)
- Documented the BACK-02/BACK-05 deferral (per D-01) explicitly in the README so it is not silently dropped

## Task Commits

This plan's deliverable files live entirely outside the khavee-sdk git worktree, at the sibling path `/Users/whitemalt/Documents/thonburian-stt`, which has no `.git` directory (greenfield, not a git repository). Per the parallel-execution instructions for this plan, there is nothing to `git commit` for Task 1 or Task 2 — only this SUMMARY.md is committed inside the khavee-sdk worktree.

1. **Task 1: Pin dependencies and scaffold repo metadata** — no commit (target repo has no `.git`)
2. **Task 2: Implement main.py — lifespan model load + /transcribe + /health** — no commit (target repo has no `.git`)

**Plan metadata:** committed in khavee-sdk worktree (this SUMMARY.md)

## Files Created/Modified
- `/Users/whitemalt/Documents/thonburian-stt/requirements.txt` - Pinned deps: fastapi, uvicorn, python-multipart, transformers (4.x range), torch
- `/Users/whitemalt/Documents/thonburian-stt/.gitignore` - Ignores venv/, __pycache__/, *.pyc, *.wav
- `/Users/whitemalt/Documents/thonburian-stt/README.md` - venv+uvicorn run sequence (port 8001), ffmpeg prerequisite, Hugging Face first-run note, API contract, BACK-02/BACK-05 deferral note
- `/Users/whitemalt/Documents/thonburian-stt/main.py` - FastAPI app: `select_device()`, `lifespan()` loading the Whisper pipeline once, `POST /transcribe`, `GET /health` (63 lines)

## Decisions Made
- Used `>=X,<Y` floor-and-major-ceiling pins (e.g. `fastapi>=0.137,<1.0`, `transformers>=4.40,<5.0`) rather than exact pins, verified against live PyPI registry data at scaffold time rather than memorized versions, per RESEARCH.md's explicit warning that these are fast-moving ML libraries.
- Kept `main.py` single-file (no `app/` package) per CONTEXT.md's explicit "Claude's Discretion" framing for a one-endpoint demo service.
- Did not add a try/except error envelope around `/transcribe` — relies on FastAPI's automatic 422 validation for malformed multipart input, per CONTEXT.md's descoped-robustness framing and the plan's explicit instruction.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' automated verification commands passed without requiring any auto-fixes (Rule 1/2/3) or architectural escalation (Rule 4).

## Issues Encountered

None. The `03-PATTERNS.md` file referenced in the plan's `<read_first>` sections does not exist on disk for this phase (only `03-CONTEXT.md` and `03-RESEARCH.md` exist) — this had no impact since `03-RESEARCH.md` contains the complete, directly-citable code patterns (Pattern 1/2/4, the full minimal `main.py` skeleton) needed to implement both tasks correctly.

## User Setup Required

None - no external service configuration required for this plan. Note for future phases: the service's first real run will require internet access to download `biodatlab/whisper-th-large-v3-combined` weights from Hugging Face Hub (documented in README), and `ffmpeg` must be installed via Homebrew (already confirmed present on this dev machine per 03-RESEARCH.md's Environment Availability table).

## Next Phase Readiness
- `thonburian-stt`'s HTTP contract (`POST /transcribe`, `GET /health`) is ready for Phase 4's `ThonburianSTTProvider` TypeScript adapter to wrap.
- Not yet smoke-tested end-to-end with real audio (deferred per plan's `<verification>` note — requires multi-GB model weight download, left to first run with internet/GPU access).
- The sibling `jai-tts` service (plan 03-02) is a separate, independent deliverable not touched by this plan.
- `FlowTTSPipeline` calling-convention ambiguity (RESEARCH.md Open Question 1) is specific to `jai-tts`, not `thonburian-stt` — does not block this plan's completeness.

---
*Phase: 03-python-backend-services*
*Completed: 2026-06-19*

## Self-Check: PASSED

- FOUND: /Users/whitemalt/Documents/thonburian-stt/main.py
- FOUND: /Users/whitemalt/Documents/thonburian-stt/requirements.txt
- FOUND: /Users/whitemalt/Documents/thonburian-stt/README.md
- FOUND: /Users/whitemalt/Documents/thonburian-stt/.gitignore
- FOUND: commit 1dc0263 (SUMMARY.md commit in khavee-sdk worktree)
- VERIFIED: `python3 -m py_compile main.py` exits 0
