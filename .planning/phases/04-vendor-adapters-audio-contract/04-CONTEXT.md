# Phase 4: Vendor Adapters & Audio Contract - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

`ThonburianSTTProvider` and `JaiTTSProvider` — two new adapter classes in `packages/providers/generic-stt-tts` (sibling to Phase 2's `OpenAISTTAdapter`/`OpenAITTSAdapter`) — implement `STTProvider`/`TTSProvider` by talking HTTP to the real `thonburian-stt` (port 8001) and `jai-tts` (port 8002) services built in Phase 3. The audio wire format (sample rate, encoding, channels) for both directions is documented in one place and proven by a round-trip test. No orchestrator wiring, no end-to-end demo, no tool-calling involvement — that's Phase 5. `openai-stt-tts` and the OpenAI adapters stay untouched.

</domain>

<decisions>
## Implementation Decisions

### Adapter connection config (no auth, port-defaulted)
- **D-01:** `ThonburianSTTProvider`/`JaiTTSProvider` constructors take only `{ baseUrl?: string }` — no `authToken`/JWT field. Unlike the OpenAI adapters (which proxy through a backend to hide an API key), these are local demo services with nothing to protect, so the OpenAI adapters' `{endpoint, authToken}` shape does not apply here. User's explicit call over matching the existing shape for consistency.
- **D-02:** `baseUrl` defaults to `http://localhost:8001` (Thonburian) / `http://localhost:8002` (JaiTTS) — matching the ports documented in each service's README. Still overridable for a non-local deployment later. `new ThonburianSTTProvider()` / `new JaiTTSProvider()` work with zero config out of the box.

### Request timeout (CPU-fallback safety net)
- **D-03:** Both adapters add a configurable `timeoutMs` config field (using `AbortSignal.timeout()`), defaulting to **60000 (60s)**. This is a deliberate departure from `STTClient`/`TTSPlayer` (which have no timeout) — justified because Whisper-large/F5-TTS can run on CPU fallback (Phase 3 D-06) and a hung/crashed backend should not leave the pipeline stuck forever. The timeout-triggered abort should flow through the same `error instanceof Error ? error : new Error(String(error))` normalization as any other adapter failure.

### Unsupported per-call options (silent ignore)
- **D-04:** Both services hardcode behavior server-side that the interfaces otherwise expose as per-call options: `thonburian-stt` always transcribes as Thai (ignores `STTProvider.transcribe()`'s `opts?.language`), and `jai-tts` always uses its bundled default reference voice at `speed=1.0` (ignores `TTSProvider.speak()`'s `opts.voice`/`opts.speed`). When a caller passes any of these, the adapter **silently ignores** them — no `console.warn`, no error. This matches the existing best-effort pattern already used for `signal` (Phase 2 D-01/D-02): the interface accepts the param everywhere for vendor-neutrality, but not every vendor honors every param.

### Round-trip test strategy (ADPT-03)
- **D-05:** The round-trip test (encode → POST → decode → assert format) hits the **real running local services**, not fixture audio + mocked HTTP. Both `thonburian-stt` and `jai-tts` already have working venvs/models installed locally (confirmed during this discussion — `jai-tts/venv` exists with `flowtts` installed). A mocked-HTTP test would only validate the SDK's own encode/decode logic and would have missed the real format mismatch discovered during this discussion (see Specific Ideas below) — hitting the real services is the only way to prove actual byte-format compatibility, which is the explicit point of ADPT-03.
- **D-06:** This test is a **separate, opt-in script** — not part of the package's default `vitest` suite (`packages/providers/generic-stt-tts/vitest.config.ts`). It requires both services running with real models loaded, which is incompatible with the repo's CI (`.github/workflows/publish.yml` runs Node 18 only, no Python/GPU). Document how to run it (start both services, then run the script) in the package README or a code comment; it never runs automatically in `pnpm test` or CI.

### Claude's Discretion
- Exact file/class names beyond `ThonburianSTTProvider`/`JaiTTSProvider` (matches `<Vendor><Stage>Provider` convention already established by `OpenAISTTAdapter`/`OpenAITTSAdapter`, though these use plain `<Vendor>Provider` naming since each vendor only covers one stage here).
- Whether to write a custom lightweight `fetch()` call per adapter vs. extracting a tiny shared HTTP helper — `STTClient`/`TTSPlayer` cannot be reused as-is (see Code Context below: field name, response envelope, and auth shape all differ). Planner's call on how much, if any, of that logic is factored out.
- Exact location/format of the audio wire-format documentation (code doc comment vs. a README section in `generic-stt-tts`) — both acceptable per ROADMAP.md wording for ADPT-03.
- `supportsStreaming`/`supportsRejection` capability flags on the new adapters — both `false` per Phase 3's confirmed deferral of BACK-02 (no rejection heuristic in `thonburian-stt`) and neither service supporting incremental streaming; not in question.
- Whether the round-trip test script lives under `packages/providers/generic-stt-tts/scripts/` or a `__tests__`-adjacent location flagged to skip by default — planner's call, just must satisfy D-06 (opt-in, not in default `pnpm test`/CI).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level scope and decisions
- `.planning/PROJECT.md` — Core value, milestone-wide decisions, streaming-chunked HTTP protocol choice
- `.planning/REQUIREMENTS.md` — Full ADPT-01..03 requirement text
- `.planning/ROADMAP.md` — Phase 4 goal and its 3 numbered success criteria
- `.planning/STATE.md` — Accumulated decisions; notes Phase 3's CPU-fallback concern relevant to D-03's timeout

### Phase 1 & 2 deliverables (the contract and pattern this phase builds against)
- `packages/core/src/types/pipeline.ts` — `STTProvider`, `TTSProvider`, `STTResult`, `LLMCompletionResult` — the exact interfaces `ThonburianSTTProvider`/`JaiTTSProvider` must implement
- `packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts` and `OpenAITTSAdapter.ts` — the direct sibling pattern (constructor config shape, capability flag declarations, `opts.signal` bridging) — note D-01 deliberately diverges from these on auth
- `.planning/phases/02-generic-pipeline-orchestrator/02-CONTEXT.md` — D-06 (adapters live in `generic-stt-tts` as real shippable code, not test fixtures) and D-01/D-02 (best-effort `signal` pattern that D-04 extends to other ignored options)
- `.planning/phases/01-core-interfaces-tool-calling/01-CONTEXT.md` — D-06 (`STTResult.rejected` is optional; vendors that never reject simply omit it — applies directly to `ThonburianSTTProvider`)

### Phase 3 deliverables (the actual services this phase calls)
- `/Users/whitemalt/Documents/thonburian-stt/main.py` — confirms `POST /transcribe` expects multipart field name **`file`** (not `audio`) and returns `{"text": string}` (not `{"transcript": ...}`) — `STTClient`'s wire shape does NOT match, cannot be reused as-is
- `/Users/whitemalt/Documents/thonburian-stt/README.md` — confirms port 8001, confirms BACK-02 (hallucination rejection) is NOT implemented (service returns whatever Whisper produces)
- `/Users/whitemalt/Documents/jai-tts/main.py` — confirms `POST /synthesize` accepts JSON `{"text": string}`, returns raw `audio/wav` bytes; voice/speed are hardcoded (`DEFAULT_VOICE_PATH`, `speed=1.0`), confirming D-04's premise
- `/Users/whitemalt/Documents/jai-tts/README.md` — confirms port 8002, confirms the bundled default reference voice requires no caller-supplied audio
- `.planning/phases/03-python-backend-services/03-CONTEXT.md` — D-02/D-03 (API contract shape preview), D-06 (CPU/GPU auto-detection — motivates D-03's timeout)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts` / `OpenAITTSAdapter.ts` — structural pattern to follow (implements interface, takes a config object, wraps an HTTP call) — but their underlying helper classes (`STTClient`, `TTSPlayer`) cannot be reused for the new adapters (see below)
- `audioContext.decodeAudioData()` (used in `TTSPlayer.speak()`, `packages/providers/openai-stt-tts/src/TTSPlayer.ts:99`) — the Web Audio API auto-resamples on decode, so `jai-tts`'s 24kHz output plays correctly regardless of the `AudioContext`'s own sample rate; no manual resampling needed on the SDK side

### Established Patterns
- `error instanceof Error ? error : new Error(String(error))` normalization (CLAUDE.md Error Handling) — apply to timeout aborts (D-03) and any fetch failure
- Best-effort optional params already precedented by `signal` (Phase 2 D-01/D-02) — D-04 extends this same "accept it, vendor may ignore it" philosophy to `language`/`voice`/`speed`

### Integration Points
- **STT wire-format mismatch confirmed:** `STTClient.transcribe()` (`packages/providers/openai-stt-tts/src/STTClient.ts:44`) posts the multipart field as `"audio"` and expects a `{transcript}` or `{data:{transcript}}` JSON response. `thonburian-stt/main.py` expects the field named `"file"` and returns `{"text": ...}`. These are genuinely incompatible wire shapes — `ThonburianSTTProvider` needs its own `fetch()`/`FormData` logic, it cannot wrap `STTClient`.
- **TTS wire format is directly compatible:** `TTSPlayer`'s `decodeAudioData()` call works on any browser-decodable WAV regardless of sample rate/bit depth, so `jai-tts`'s raw `audio/wav` response can be decoded the same way — but `JaiTTSProvider` still can't reuse `TTSPlayer.speak()` wholesale since that method POSTs JSON `{text, voice, speed, model, ttsInstructions}` with a JWT header, while `jai-tts` only accepts `{text}` with no auth. A new, much simpler fetch call is needed.
- `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` — the orchestrator these adapters plug into is unmodified this phase; just confirms the adapters only need to satisfy `STTProvider`/`TTSProvider`, no orchestrator-side changes.

</code_context>

<specifics>
## Specific Ideas

Verified during this discussion (not yet documented anywhere — must be captured in ADPT-03's wire-format doc):

- **STT direction (SDK → thonburian-stt):** `AudioRecorder`'s `utils.encodeWAV()` call (`@ricky0123/vad-web`, `packages/providers/openai-stt-tts/src/AudioRecorder.ts:73`) uses that library's *defaults* — **16000 Hz, mono, 32-bit IEEE float PCM** (WAV format code `3`, not the more common 16-bit integer PCM). This is the actual format `ThonburianSTTProvider.transcribe()` receives and must forward.
- **TTS direction (jai-tts → SDK):** `flowtts`'s `FlowTTSPipeline` writes output via `soundfile.write(file_wave, wav, self.target_sample_rate)` with `target_sample_rate = 24000` (confirmed in the installed `flowtts/load_flowtts.py` and `flowtts/inference.py`'s `"Set to F5-TTS expected sample rate"` comment) and no explicit `subtype`, so `soundfile` defaults to **24000 Hz, mono, 16-bit PCM**. This is the actual format `JaiTTSProvider.speak()` receives back.
- These two formats differ from each other (float32 vs. int16, 16kHz vs. 24kHz) — ADPT-03's documentation must call out both explicitly, per-direction, not assume one shared format.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Real Bedrock/Gemini adapters remain out-of-scope per PROJECT.md; the end-to-end demo wiring these adapters into `GenericPipelineProvider` is already tracked as Phase 5.)

</deferred>

---

*Phase: 4-Vendor Adapters & Audio Contract*
*Context gathered: 2026-06-19*
