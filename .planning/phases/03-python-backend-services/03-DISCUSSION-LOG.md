# Phase 3: Python Backend Services - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 3-Python Backend Services
**Areas discussed:** Robustness scope, API contract shape, Default reference voice, Runtime & deployment, Device selection

---

## Robustness scope (BACK-02 / BACK-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Skip both | Plain endpoints, no hallucination filtering, no concurrency limits | ✓ |
| Minimal version of both | One-line silence check + semaphore(1) | |
| Keep as originally scoped | Full repetition-ratio check + tuned semaphore | |

**User's choice:** Skip both.
**Notes:** User stated upfront: "i need it to be the most simple backend since it is a demo to verify that my sdk works." This is the framing that drove every subsequent answer in this discussion.

---

## API contract shape

| Option | Description | Selected |
|--------|-------------|----------|
| Multipart file upload / raw WAV response | POST /transcribe (multipart) → {text}; POST /synthesize ({text}) → raw audio/wav bytes | ✓ |
| JSON with base64-encoded audio | Everything as JSON with base64 audio fields | |

**User's choice:** Multipart upload / raw WAV response.

---

## Default reference voice (BACK-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Synthesize/record one short clip now | Record/generate ~10-15s Thai speech, commit as bundled default | |
| Find a permissively-licensed public sample | Source from e.g. Common Voice Thai or equivalent CC/public-domain dataset | ✓ |

**User's choice:** Find a permissively-licensed public sample.

---

## Runtime & deployment

| Option | Description | Selected |
|--------|-------------|----------|
| Plain venv + uvicorn | No Docker, two terminals/processes locally | ✓ |
| Docker / docker-compose | Containerized, more setup work | |

**User's choice:** Plain venv + uvicorn.

---

## Device selection

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect, prefer GPU/MPS if available | torch.cuda.is_available()/MPS check, fallback CPU | ✓ |
| Always CPU | Simplest, no device-detection code | |

**User's choice:** Auto-detect, prefer GPU/MPS if available.

---

## Claude's Discretion

- Exact FastAPI app structure (single file vs package layout)
- Health-check endpoint, logging setup, port conventions
- Whether the two sibling repos share any scaffolding conventions (no shared abstraction required)
- Error handling for malformed input (standard FastAPI validation, no custom error envelope)
- Exact reference-voice dataset/clip selection and packaging

## Deferred Ideas

- Hallucination rejection (BACK-02) — revisit if this moves past demo use
- Concurrency gating (BACK-05) — revisit if this moves past demo use
- Dockerization — reasonable before any real deployment, not now
- Dataset-grade reference-voice provenance (multiple voices, attribution pipeline) — one working default is enough
