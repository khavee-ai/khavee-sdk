---
phase: 03-python-backend-services
plan: 02
subsystem: api
tags: [fastapi, f5-tts, flowtts, voice-cloning, thai-tts, python]

# Dependency graph
requires: []
provides:
  - "jai-tts FastAPI service scaffold at /Users/whitemalt/Documents/jai-tts"
  - "POST /synthesize ({\"text\": string} -> raw audio/wav bytes) backed by JTS-AI/JaiTTS-F5TTS via FlowTTSPipeline"
  - "GET /health endpoint"
  - "Model-load-once-at-startup pattern via FastAPI lifespan with CUDA->MPS->CPU device auto-detection"
  - "Bundled permissively-licensed (CC BY 4.0, Google FLEURS) default Thai reference voice for text-only synthesis (BACK-04)"
  - "Documented, reproducible flowtts clone+patch+install workaround for the upstream thonburian-tts packaging bug"
affects: [04-khavee-sdk-adapters, 05-end-to-end-demo]

# Tech tracking
tech-stack:
  added: [fastapi, uvicorn, soundfile, torch, flowtts (git-installed, patched local clone of biodatlab/thonburian-tts)]
  patterns:
    - "FastAPI lifespan context manager loads expensive ML model (FlowTTSPipeline) into app.state exactly once before yield, never inside a request handler"
    - "CUDA -> Apple Silicon MPS -> CPU device auto-detection chain (select_device()), identical to thonburian-stt"
    - "JSON text request -> Pydantic validation -> pipeline call against the empirically-verified __call__ signature -> read synthesized file bytes -> Response(media_type=\"audio/wav\")"
    - "Trust-boundary verification before code depends on a git-installed package: verify import succeeds in the venv BEFORE writing any code that imports it"

key-files:
  created:
    - /Users/whitemalt/Documents/jai-tts/main.py
    - /Users/whitemalt/Documents/jai-tts/requirements.txt
    - /Users/whitemalt/Documents/jai-tts/README.md
    - /Users/whitemalt/Documents/jai-tts/.gitignore
    - /Users/whitemalt/Documents/jai-tts/assets/default_voice.wav
    - /Users/whitemalt/Documents/jai-tts/assets/default_voice.txt
    - /Users/whitemalt/Documents/jai-tts/assets/LICENSE-default-voice.txt
  modified: []

key-decisions:
  - "flowtts install workaround (human-approved): the upstream pip install git+https://github.com/biodatlab/thonburian-tts.git resolves zero packages because the flowtts/ source tree ships with no __init__.py files anywhere, so setuptools.find_packages() silently discovers nothing -- the install 'succeeds' but only registers the console-script entry point, not the flowtts Python source. Fix: clone the repo, add empty __init__.py marker files to flowtts/ and every subdirectory containing .py files that lacked one (package-discovery markers only, no code/model logic modified), then pip install the patched local clone. Documented as a copy-pasteable two-step procedure in README.md."
  - "FlowTTSPipeline calling convention (human-approved, resolves RESEARCH Open Question 1 / Pitfall 2): empirically confirmed via inspect.signature() against the installed package that the class exposes ONLY a callable __call__(self, text, ref_voice, output_file, ref_text=None, speed=1.0, check_duration=False) -> str (returns a file path). There is no .generate() method -- the HF model card's 'Quick Usage' snippet showing .generate(...) -> (audio, sr) is stale relative to the actually-installed package. main.py is written against the verified __call__ signature only, with a code comment recording this."
  - "JaiTTS-F5TTS checkpoint/vocab paths (hf://JTS-AI/JaiTTS-F5TTS/model.pt, hf://JTS-AI/JaiTTS-F5TTS/vocab.txt) taken from the HF model card's ModelConfig example and spot-checked live via HTTP HEAD requests (200 OK, 1.3GB / 11KB respectively) before being hardcoded into main.py's lifespan."
  - "Default reference voice (human-approved): a Google FLEURS (CC BY 4.0) Thai test-split clip (example id 1845) already sourced and saved at assets/default_voice.{wav,txt} plus assets/LICENSE-default-voice.txt -- verified present, non-empty, and correctly licensed; not re-sourced."
  - "No try/except error envelope added around /synthesize -- relies on FastAPI's automatic 422 Pydantic validation for malformed/missing text, per CONTEXT.md's descoped-robustness framing (D-01)."
  - "No Semaphore/concurrency gating added -- BACK-05's semaphore half is explicitly deferred per D-01; only the load-once-at-startup half is implemented."

patterns-established:
  - "Model-load-once via FastAPI lifespan: app.state.tts_pipe assigned before yield, read-only access in request handlers (mirrors thonburian-stt's app.state.asr_pipe pattern)"
  - "Device auto-detection: torch.cuda.is_available() -> torch.backends.mps.is_available() -> cpu fallback, copied verbatim from thonburian-stt"
  - "Trust-boundary-gated git install: verify a git-installed dependency imports cleanly in the target venv, with a human checkpoint, BEFORE any application code is written against it"
  - "No custom error envelope -- rely on FastAPI's built-in 422 validation for malformed input"

requirements-completed: [BACK-03, BACK-04, BACK-05]

# Metrics
duration: 24min
completed: 2026-06-19
---

# Phase 3 Plan 2: jai-tts FastAPI Scaffold Summary

**FastAPI service wrapping JTS-AI/JaiTTS-F5TTS voice cloning via a hand-patched flowtts install, exposing POST /synthesize (text -> raw WAV bytes) with a bundled CC BY 4.0 default Thai reference voice and CUDA->MPS->CPU device auto-detection.**

## Performance

- **Duration:** ~24 min (continuation from a blocking-human checkpoint; total includes prior-session setup already in place plus this session's verification, patching, and Task 2 implementation)
- **Started:** 2026-06-19T04:17:09Z (Task 1, prior session)
- **Completed:** 2026-06-19T04:39:51Z
- **Tasks:** 2 completed
- **Files modified:** 7 created (3 from Task 1, 4 from Task 2)

## Accomplishments
- Closed out Task 1's blocking-human checkpoint: both the `flowtts` git-install trust boundary and the default-voice license compliance were approved by the human and re-verified
- Discovered during re-verification that the previously-reported "working patched flowtts install" was not actually functional (`ModuleNotFoundError: No module named 'flowtts'`) -- diagnosed and fixed in this session by actually performing the approved clone+patch+install workaround: cloned `biodatlab/thonburian-tts` to a scratch directory, added empty `__init__.py` marker files to `flowtts/` and every code-containing subdirectory lacking one, and installed the patched local clone, which now imports cleanly
- Also diagnosed a `python` shell alias (pointing to Xcode's bundled Python 3.9) silently shadowing the activated venv -- documented this gotcha in README.md and used `./venv/bin/python` explicitly for all subsequent verification
- Empirically verified the `FlowTTSPipeline` calling convention via `inspect.signature()` against the installed class: confirmed it is exclusively the callable `__call__(text, ref_voice, output_file, ref_text=None, speed=1.0, check_duration=False) -> str` signature (B) -- there is no `.generate()` method, resolving RESEARCH Open Question 1
- Spot-checked the `JTS-AI/JaiTTS-F5TTS` checkpoint (`model.pt`, 1.3GB) and vocab (`vocab.txt`, 11KB) `hf://` paths via live HTTP HEAD requests (200 OK) before hardcoding them into `main.py`
- Implemented `main.py`: FastAPI app with `lifespan`-based one-time `FlowTTSPipeline` load (CUDA->MPS->CPU device auto-detection), `POST /synthesize` (JSON text -> raw `audio/wav` bytes using the bundled default reference voice), and `GET /health`
- Wrote `.gitignore` (ignoring `venv/`, `__pycache__/`, `*.pyc`, `*.out.wav`, `temp/`; deliberately not ignoring `assets/`) and a `README.md` documenting the two-step flowtts install workaround, the venv+uvicorn run sequence (port 8002), the `ffmpeg` prerequisite, the bundled default voice, and the BACK-05 semaphore-deferral per D-01

## Task Commits

This plan's deliverable files live entirely outside the khavee-sdk git worktree, at the sibling path `/Users/whitemalt/Documents/jai-tts`, which has no `.git` directory (greenfield, not a git repository). Per the parallel-execution instructions for this plan, there is nothing to `git commit` for Task 1 or Task 2 in the khavee-sdk worktree -- only this SUMMARY.md is committed there.

1. **Task 1: Verify flowtts git-install trust boundary, then pin requirements + source default voice** -- no commit (target repo has no `.git`); human-approved checkpoint closed out, automated verify re-confirmed passing
2. **Task 2: Verify FlowTTSPipeline signature, implement main.py against it, scaffold .gitignore/README** -- no commit (target repo has no `.git`); automated verify passing

**Plan metadata:** committed in khavee-sdk worktree (this SUMMARY.md)

## Files Created/Modified
- `/Users/whitemalt/Documents/jai-tts/requirements.txt` - fastapi, uvicorn, soundfile, torch, plus a comment block documenting the flowtts packaging bug, the workaround, and the `git+https://github.com/biodatlab/thonburian-tts.git` source line (not a bare PyPI `flowtts` entry) (carried over from Task 1, prior session, re-verified this session)
- `/Users/whitemalt/Documents/jai-tts/assets/default_voice.wav` - Google FLEURS (CC BY 4.0) Thai test-split clip, example id 1845 (carried over from Task 1, prior session, re-verified present and non-empty)
- `/Users/whitemalt/Documents/jai-tts/assets/default_voice.txt` - Transcript of the default reference clip (carried over, re-verified)
- `/Users/whitemalt/Documents/jai-tts/assets/LICENSE-default-voice.txt` - Source/license attribution for the FLEURS clip, including a documented survey of rejected alternative sources (Common Voice deprecated/gated, GigaSpeech2-derived dataset's ambiguous re-license, two CC BY-NC-SA-licensed candidates incompatible with commercial bundling) (carried over, re-verified)
- `/Users/whitemalt/Documents/jai-tts/main.py` - FastAPI app: `select_device()`, `lifespan()` loading `FlowTTSPipeline` once against the verified `__call__` signature, `POST /synthesize`, `GET /health` (104 lines, new this session)
- `/Users/whitemalt/Documents/jai-tts/.gitignore` - Ignores `venv/`, `__pycache__/`, `*.pyc`, `*.out.wav`, `temp/`; does not ignore `assets/` (new this session)
- `/Users/whitemalt/Documents/jai-tts/README.md` - Two-step flowtts install workaround (copy-pasteable clone+patch+install commands), venv+uvicorn run sequence (port 8002), `ffmpeg`/git prerequisites, API contract, bundled default voice note, BACK-05 deferral note (new this session)

## Decisions Made
- Performed the actual clone+patch+install workaround during this session (rather than trusting the "already done" status from the prior session's handoff) after empirical re-verification showed `flowtts` did not actually import -- this is a Rule 1 (auto-fix bug) correction, not a re-litigation of the already-approved workaround design.
- Used `inspect.signature()` directly against the installed `FlowTTSPipeline` class (rather than relying on `help()` text parsing) to get an unambiguous, machine-readable confirmation of the `__call__`-only signature.
- Hardcoded the JaiTTS-F5TTS `hf://` checkpoint/vocab paths from the HF model card's `ModelConfig` example after confirming both resolve with a live `HEAD` request, rather than assuming the example script's `ThuraAung1601/E2-F5-TTS` paths (which belong to a different reference example, not the JaiTTS-F5TTS model this phase targets).
- Kept `main.py` single-file (no `app/` package), matching `thonburian-stt`'s established convention and CONTEXT.md's explicit "Claude's Discretion" framing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Completed the flowtts clone+patch+install workaround that had not actually been executed**
- **Found during:** Task 1 re-verification (before proceeding to Task 2)
- **Issue:** The handoff context stated "a working patched flowtts install" already existed in the venv, but `./venv/bin/python -c "from flowtts.inference import FlowTTSPipeline..."` raised `ModuleNotFoundError: No module named 'flowtts'`. Inspecting `pip list` confirmed only the broken upstream `thonburian-tts==1.0.0` package (console-script + metadata only, no `flowtts` source) was installed -- the patch step had been approved in concept but never actually performed.
- **Fix:** Cloned `biodatlab/thonburian-tts` to `/tmp/thonburian-tts-patch`, confirmed via `find_packages()` that the `flowtts/` tree and most subdirectories with `.py` files lacked `__init__.py`, added empty marker files to each (package-discovery only, no code changes), uninstalled the broken `thonburian-tts` package, and reinstalled from the patched local clone.
- **Files modified:** None inside khavee-sdk or jai-tts (the fix happened entirely inside the jai-tts venv's site-packages and a `/tmp` scratch clone, not a tracked repo file)
- **Verification:** `./venv/bin/python -c "from flowtts.inference import FlowTTSPipeline, ModelConfig, AudioConfig; print('flowtts OK')"` now prints `flowtts OK`
- **Committed in:** N/A (no git-tracked file changed; jai-tts has no `.git`)

**2. [Rule 1 - Bug] Identified and worked around a `python` shell alias shadowing the venv**
- **Found during:** Task 1 re-verification
- **Issue:** `source venv/bin/activate` followed by `python -c ...` resolved to Xcode's bundled Python 3.9 (`/Applications/Xcode.app/.../python3`) rather than the venv's Python 3.11, due to a pre-existing shell alias. This silently produced misleading `ModuleNotFoundError` results that looked like a venv/install problem but were actually a PATH/alias problem.
- **Fix:** Diagnosed via `sys.executable`/`sys.path` inspection; switched to invoking `./venv/bin/python` explicitly for all verification and runtime commands; documented the gotcha in README.md so future operators don't lose time on the same red herring.
- **Files modified:** `/Users/whitemalt/Documents/jai-tts/README.md` (added a "venv activation gotcha" note)
- **Verification:** `./venv/bin/python -c "import sys; print(sys.executable)"` confirms the venv interpreter is used
- **Committed in:** N/A (no git-tracked file changed; jai-tts has no `.git`)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - bug fixes required to make the already-approved Task 1 design actually work)
**Impact on plan:** Both fixes were necessary to deliver what Task 1's checkpoint had already approved in principle; no scope creep, no architectural changes, no re-litigation of the human's approved decisions.

## Issues Encountered

None beyond the two auto-fixed deviations above. The `JaiTTS-F5TTS` HF model card's own "Quick Usage" code example is internally stale (shows a `.generate()` method that does not exist on the installed class) -- this was anticipated by RESEARCH.md's Open Question 1 / Pitfall 2 and resolved exactly as that document recommended (empirical inspection of the installed package, not trust in either documented source).

## User Setup Required

None - no external service configuration required for this plan. Note for future phases: the service's first real run will require internet access to download the `JTS-AI/JaiTTS-F5TTS` checkpoint (`model.pt`, ~1.3GB) and vocab (`vocab.txt`) from Hugging Face Hub (documented in README; both URLs spot-checked live this session and resolve with 200 OK). `ffmpeg` and `git` must be present on the host (ffmpeg already confirmed installed via Homebrew per 03-RESEARCH.md's Environment Availability table; git assumed present, standard on macOS dev machines).

## Next Phase Readiness
- `jai-tts`'s HTTP contract (`POST /synthesize`, `GET /health`) is ready for Phase 4's `JaiTTSProvider` TypeScript adapter to wrap.
- Not yet smoke-tested end-to-end with real audio synthesis (deferred per plan's `<verification>` note -- requires the multi-GB model checkpoint download and a full inference pass, left to first run with internet/GPU/MPS access).
- Both Phase 3 services (`thonburian-stt`, `jai-tts`) are now scaffolded; Phase 4 can proceed with adapter implementation against both documented contracts.
- `accelerate` was not needed during this session's scaffolding (no `ImportError: Accelerate` surfaced); if it becomes necessary in Phase 4's end-to-end testing, RESEARCH.md's guidance to gate it behind a fresh `checkpoint:human-verify` (it is flagged `[SUS]` by slopcheck, likely a stale low-download signal) still applies and was not bypassed here.

---
*Phase: 03-python-backend-services*
*Completed: 2026-06-19*

## Self-Check: PASSED

- FOUND: /Users/whitemalt/Documents/jai-tts/main.py
- FOUND: /Users/whitemalt/Documents/jai-tts/requirements.txt
- FOUND: /Users/whitemalt/Documents/jai-tts/README.md
- FOUND: /Users/whitemalt/Documents/jai-tts/.gitignore
- FOUND: /Users/whitemalt/Documents/jai-tts/assets/default_voice.wav
- FOUND: /Users/whitemalt/Documents/jai-tts/assets/default_voice.txt
- FOUND: /Users/whitemalt/Documents/jai-tts/assets/LICENSE-default-voice.txt
- VERIFIED: `./venv/bin/python -m py_compile main.py` exits 0
- VERIFIED: `from flowtts.inference import FlowTTSPipeline, ModelConfig, AudioConfig` prints `flowtts OK`
- VERIFIED: Task 2 automated `<verify>` check (py_compile + all grep assertions) passes
