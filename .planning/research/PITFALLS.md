# Pitfalls Research

**Domain:** Composable/pluggable voice AI pipeline (STT/LLM/TTS, pipecat-style) with cross-vendor tool-calling and self-hosted Whisper-class ASR + F5-TTS-class voice-cloning TTS services
**Researched:** 2026-06-17
**Confidence:** MEDIUM-HIGH (architecture/abstraction pitfalls verified against pipecat docs, GitHub issues, and multi-source community reports; self-hosting pitfalls verified against multiple independent sources; codebase-specific risks verified directly against this repo's existing code via CONCERNS.md)

## Critical Pitfalls

### Pitfall 1: Designing the streaming abstraction around the easy vendor, not the hard one

**What goes wrong:**
The interfaces (`STTProvider`, `TTSProvider`, `LLMProvider`, `VADProvider`) get designed by first wiring up OpenAI (which supports low-latency streaming responses and partial transcripts) and only then trying to fit Thonburian STT and JaiTTS — which do whole-utterance, non-streaming, multi-second-latency inference — into the same shape. The result is an interface that assumes streaming/partial callbacks (`onPartialTranscript`, `onAudioChunk`) as the primary contract, forcing the non-streaming adapters to fake streaming by emitting a single "chunk" at the end, or worse, forcing consumers (React hooks, lipsync, UI status) to special-case "providers that don't really stream."

**Why it happens:**
OpenAI's STT/TTS is the only working reference implementation in the codebase today (`OpenAISTTTTSProvider.ts`), so it becomes the implicit template. Pipecat's own frame-based architecture is built for streaming-first vendors (Deepgram, ElevenLabs); copying that shape wholesale without checking whether *all* target vendors actually support partial results bakes in a leaky abstraction from day one. This project's own constraint ("neither model supports true incremental/partial streaming") makes this a near-certain trap unless explicitly designed against.

**How to avoid:**
Design the core interface contract around "whole utterance in, whole result out" as the lowest common denominator, with streaming as an *optional capability* a provider can advertise (e.g. `supportsPartialResults: boolean` or a separate `StreamingSTTProvider` extension interface) rather than the default shape every provider must implement. Build the Thonburian/JaiTTS adapters and the orchestrator's non-streaming path *first*, then verify OpenAI's streaming path can still be expressed as a specialization, not the other way around.

**Warning signs:**
- The base `STTProvider`/`TTSProvider` interface has required methods like `onPartialResult` or `onChunk` with no way to opt out.
- Adapter code for Thonburian/JaiTTS contains comments like "fake the streaming callback" or "call onChunk once with the whole buffer."
- The orchestrator branches on `if (provider.name === 'openai')` anywhere.

**Phase to address:**
Interface design phase (before any adapter is implemented) — this is the single highest-leverage decision in the whole milestone since it's expensive to retrofit after `generic-stt-tts` and both adapters exist.

---

### Pitfall 2: Tool-calling abstraction breaks because vendors disagree on schema, multi-call semantics, and execution-loop shape

**What goes wrong:**
The plain-object `{ name, description, parameters, handler }` tool API works fine for OpenAI but silently mismatches other vendors' real constraints when Bedrock/Gemini adapters are eventually built: Gemini requires explicit `type` fields on JSON-schema array `items` (rejects `items: {}`), Anthropic and OpenAI differ on whether multiple tool calls can be requested in one turn and how results are threaded back into the conversation (as a new "tool" role message vs. inline content blocks), and none of the major providers accept a top-level `$ref` in the parameters schema. If the `LLMProvider` interface's tool-result-injection step is modeled only after OpenAI's `tool_calls` → `role: "tool"` round-trip, a future Bedrock/Gemini adapter cannot be implemented without changing the core interface — defeating the stated goal of "tool-calling as a core capability, not a per-provider retrofit."

**Why it happens:**
Only one real LLM vendor (OpenAI, via the existing `ChatClient`) is in scope this milestone, so there is no second implementation to stress-test the abstraction against. It's easy to mistake "I built an interface" for "I built a vendor-agnostic interface" when only one vendor instantiates it. The existing `ToolExecutor.ts` (duplicated byte-for-byte across `openai-stt-tts` and `openai-realtime` per CONCERNS.md) was itself written against OpenAI's tool-call shape, so promoting it as-is into `packages/core` risks promoting an OpenAI-shaped abstraction and merely renaming it "generic."

**How to avoid:**
Before promoting `ToolExecutor`, explicitly write out (even as a comment/doc, not code) how Anthropic's and Gemini's tool-calling round-trip would map onto the same interface — multi-tool-call-per-turn support, how tool results re-enter the conversation, and JSON-schema constraints (no bare `items: {}`, no top-level `$ref`) — and adjust the interface shape now while the cost is low. Keep the tool *definition* format (plain object with JSON-schema-shaped `parameters`) deliberately minimal and avoid encoding any OpenAI-specific field names (e.g. `tool_call_id`) into the core `Tool`/`ToolCall` types; wrap vendor-specific IDs in an opaque field.

**Warning signs:**
- `LLMProvider`'s tool-call result type has a field literally named after an OpenAI API field (`tool_call_id`, `function.arguments` as a raw JSON string instead of parsed object).
- The interface assumes exactly one tool call per LLM turn.
- Tool parameter validation/normalization (e.g. ensuring array `items` always has `type`) doesn't exist anywhere — meaning a beginner's tool definition that works against OpenAI would silently fail against Gemini later.

**Phase to address:**
Tool-calling interface design / `ToolExecutor` promotion phase — verify against at least a written sketch of a second vendor (Anthropic or Gemini) even though no real adapter ships this milestone.

---

### Pitfall 3: VAD-segmented "whole utterance" HTTP calls reproduce Whisper's silence/short-audio hallucination failure mode

**What goes wrong:**
Thonburian STT receives short, VAD-segmented audio clips (a few seconds each) rather than long continuous audio. Whisper-family models (including the Thonburian fine-tune) are well-documented to hallucinate repeated phrases specifically when given short clips, clips with leading/trailing silence, or near-silent/noisy segments — because the model's audio embeddings go near-zero and it "fills in" the most recently seen phrase. If VAD segmentation is imperfect (clips a fraction of leading silence, or includes a tail of room noise after the user stops talking), the STT service will return confidently-wrong repeated text (e.g. the same Thai phrase 5 times) rather than an empty/low-confidence result, and the LLM stage will treat this hallucinated text as real user input.

**Why it happens:**
This is a known, specific Whisper failure mode (not generic ASR noise) triggered by exactly the conditions this architecture produces by design: short, separately-cut audio segments instead of long-form streaming audio with cross-chunk context. `transformers.pipeline`'s default decoding thresholds (`compression_ratio_threshold≈2.4`, `no_speech_threshold≈0.6`) are tuned for long-form chunked use and are not aggressive enough to suppress this on short clips.

**How to avoid:**
In the `thonburian-stt` service: (1) trim leading/trailing silence from each incoming utterance before inference (a cheap energy-based VAD pass, not just relying on the SDK-side VAD's boundaries), (2) set and tune `no_speech_threshold` / `compression_ratio_threshold` explicitly rather than relying on pipeline defaults, (3) reject or flag transcripts that are suspiciously short audio + suspiciously long/repetitive text (a simple repetition-ratio check on the output string), (4) return a confidence/no-speech signal in the HTTP response so the SDK side can distinguish "silence, no transcript" from "garbled transcript" instead of always treating 200 OK as "valid user speech."

**Warning signs:**
- End-to-end testing produces a transcript that repeats the same word/phrase 3+ times for what was a short or quiet utterance.
- The LLM responds nonsensically to a "user said nothing" event because Thonburian STT returned hallucinated text instead of empty string.
- No silence-trimming or repetition-detection step exists between `thonburian-stt`'s raw pipeline output and the HTTP response body.

**Phase to address:**
`thonburian-stt` service implementation phase — must be handled inside the Python service itself (closest to the audio), not patched over later in the SDK's STT adapter.

---

### Pitfall 4: Treating GPU-resident models as stateless request handlers leads to OOM or serialized requests under concurrency

**What goes wrong:**
Both `thonburian-stt` (Whisper-large, ~3GB+ VRAM at fp16) and `jai-tts` (F5-TTS, ~8GB+ VRAM, 10-30x slower on CPU) are large models. A naive FastAPI/Flask implementation that loads the model inside the request handler (or relies on multiple worker processes each loading their own copy) either pays a 5-30 second cold-start penalty per request, or multiplies VRAM usage by the worker count until the GPU OOMs. Separately, if both endpoints are called concurrently with no concurrency limit, simultaneous transcription + synthesis requests can exceed available VRAM and crash the process mid-request — which, in this project's pipeline, means a single bad turn takes down the whole backend service for all other users.

**Why it happens:**
Standard web-framework deployment patterns (multiple worker processes, autoscaling on request count) assume cheap, stateless, CPU-bound handlers. ML inference servers are the opposite: expensive-to-load, GPU-stateful, and the model load itself is the dominant cost, not request routing. This mismatch is the single most common mistake reported across self-hosted Whisper/PyTorch serving writeups.

**How to avoid:**
Load each model exactly once at process startup (FastAPI `lifespan` context manager, not per-request or per-worker), run a single worker process per GPU (not multiple uvicorn workers each loading a model copy), and gate concurrent inference with an explicit semaphore (e.g. `asyncio.Semaphore(1)` or `Semaphore(N)` sized to measured VRAM headroom) so excess requests queue instead of running simultaneously and OOMing. For this project's expected scale (a demo/proof-of-concept, not high-throughput production), default to serializing GPU calls (`Semaphore(1)`) rather than attempting batching — correctness and stability over throughput.

**Warning signs:**
- `model = pipeline(...)` or `model = FlowTTSPipeline(...)` appears inside a route handler function instead of at module/startup scope.
- `uvicorn --workers N` with N > 1 used for a GPU-bound service.
- No semaphore/lock around the inference call; load-testing with 2+ concurrent requests crashes the process or returns CUDA OOM errors.
- First request after service start takes 10-30+ seconds with no warmup step run at startup.

**Phase to address:**
`thonburian-stt` and `jai-tts` service scaffolding phase — this is foundational service architecture, not an optimization to defer.

---

### Pitfall 5: Bundled "default reference voice" for JaiTTS is treated as a one-time setup detail instead of a quality-critical, validated asset

**What goes wrong:**
F5-TTS-class zero-shot cloning quality is extremely sensitive to the reference audio: anything under ~3 seconds, noisy, multi-speaker, or with leading/trailing silence not trimmed measurably degrades output quality, and reference text that doesn't exactly match what's actually said in the reference audio (mismatched transcript) causes artifacts. If the bundled default Thai voice sample is grabbed quickly (e.g. cut from an arbitrary recording) without verifying clip length, noise floor, single-speaker isolation, and an exactly-matching reference transcript, the entire `jai-tts` service's default-voice output quality suffers — and because it's the *bundled default*, every demo and every beginner's first run hits this, not an edge case.

**Why it happens:**
"Reference audio" sounds like a config detail (just point to a WAV file) rather than a quality-critical model input with its own validation requirements. The JaiTTS/F5-TTS documentation's requirements (clean 3-10s clip, trimmed silence, exact-matching transcript) are easy to skim past since the pipeline will *run* successfully with a bad reference clip — it just produces degraded audio, which is a "looks done but isn't" failure mode (see checklist below), not a crash.

**How to avoid:**
Treat the bundled default reference voice as a deliverable with explicit acceptance criteria: 3-10 seconds, single speaker, low noise floor, silence trimmed from both ends, and a reference-text string that is verified character-for-character against what is actually spoken (re-transcribe it with Thonburian STT itself as a cross-check). Document these constraints in the `jai-tts` service so any future custom voice a developer supplies is validated against the same checklist (reject/warn on clips under ~3s or over ~15s, warn if no reference text provided).

**Warning signs:**
- The bundled reference WAV file has no accompanying validation script or documented provenance (where it came from, how it was trimmed).
- Generated demo audio has audible artifacts, mispronunciations, or a "muffled"/inconsistent voice timbre that nobody flagged because no listening QA pass happened.
- Reference text is typed from memory/approximation rather than transcribed from the actual reference audio.

**Phase to address:**
`jai-tts` service scaffolding phase (asset preparation), with a dedicated manual QA listening pass before the end-to-end demo phase.

---

### Pitfall 6: VAD/turn-taking cooldown logic, already fragile for OpenAI, gets copy-pasted instead of generalized — multiplying a known bug class

**What goes wrong:**
This codebase already has a documented, fragile pattern: `OpenAISTTTTSProvider`'s turn lifecycle duplicates a "resume mic + 500ms cooldown + reset status" recovery sequence in both the success and error paths (per CONCERNS.md), specifically to prevent the TTS output bleeding into the mic and re-triggering VAD ("loopback"). When the same VAD pause/resume/cooldown logic gets reimplemented inside the new generic orchestrator for non-OpenAI providers — whose TTS playback timing characteristics differ (JaiTTS audio may have different latency-to-first-byte, different tail silence, different playback duration) — there's a strong risk of copy-pasting the same 500ms-magic-number heuristic without re-validating it against the new providers' actual audio characteristics, and of reintroducing the duplicate-success/error-path bug in the generalized version.

**Why it happens:**
The existing fix is a heuristic tuned empirically for one specific TTS player's audio tail behavior, not a principled acoustic echo cancellation solution. Generalizing the *interface* without re-deriving the *timing constants* per backend is the path of least resistance under deadline pressure, and the new orchestrator will have at least one new playback pipeline (JaiTTS audio) with different characteristics than what 500ms was tuned against.

**How to avoid:**
When building the generic orchestrator's turn-lifecycle/cooldown logic, extract the "resume + cooldown + ready" sequence into a single shared function used by both success and error paths (eliminating the duplication CONCERNS.md flags), and make the cooldown duration a configurable parameter per VAD/TTS pairing rather than a hardcoded constant — then explicitly test it against JaiTTS's actual audio output (which may have a longer or shorter tail than OpenAI's TTS) before assuming the same 500ms value generalizes.

**Warning signs:**
- The new orchestrator has the same "resume mic" logic written twice (once on the happy path, once on the error path).
- The 500ms constant from `OpenAISTTTTSProvider.ts` is reused verbatim in the generic orchestrator with no comment indicating it was re-validated for the new TTS backend.
- End-to-end testing with JaiTTS shows the mic re-triggering VAD on JaiTTS's own audio tail (loopback symptom recurring with a new provider).

**Phase to address:**
Generic pipeline orchestrator implementation phase — explicitly budget time to validate timing assumptions against the JaiTTS audio pipeline specifically, not just OpenAI's.

---

### Pitfall 7: HTTP request/response audio framing mismatches (sample rate, encoding, multipart vs. raw body) discovered only at integration time

**What goes wrong:**
The SDK posts VAD-segmented audio utterances to Python services over "streaming-chunked HTTP." If the audio encoding contract (sample rate, bit depth, channel count, container format — raw PCM vs. WAV header vs. multipart form field) isn't pinned down explicitly and matched on both sides, the failure mode is silent degradation, not a clean error: Whisper-family models still "succeed" on resampled/wrong-channel-count audio but produce garbled or hallucinated transcripts (compounding Pitfall 3), and F5-TTS-based JaiTTS may produce audio at an unexpected sample rate that the SDK's `TTSPlayer`/Web Audio playback path doesn't handle, causing pitch-shifted or sped-up/slowed-down playback that "plays" without erroring.

**Why it happens:**
Audio format mismatches between client and server rarely throw type-level errors — `transformers.pipeline` and F5-TTS pipelines are permissive about input shape (they'll resample, they'll accept various bit depths) and produce *plausible* but wrong output rather than failing loudly. This is exactly the kind of cross-language (TS ↔ Python), cross-service boundary where assumptions silently diverge since there's no shared type system enforcing the contract.

**How to avoid:**
Pin and document the exact audio contract at the HTTP boundary in both directions (e.g. 16kHz mono 16-bit PCM WAV in, 24kHz (or whatever JaiTTS natively outputs) mono WAV out) and validate it server-side (reject/resample with a warning if the incoming audio doesn't match expected sample rate/channels, rather than passing it through blind). Add an explicit integration test that round-trips a known audio fixture through each service and asserts both the HTTP status and basic audio properties (duration, sample rate) of the response, not just "200 OK."

**Warning signs:**
- No documented audio format contract exists between the TS adapters and the Python services (just "send audio, get audio back").
- Manual testing reveals TTS output that sounds pitched-up/down or sped-up/slowed-down.
- STT accuracy is poor in ways that don't match Pitfall 3's hallucination signature (i.e., consistently wrong rather than repetitive) — a sign of resampling/encoding mismatch rather than a model limitation.

**Phase to address:**
Adapter implementation phase (`ThonburianSTTProvider`, `JaiTTSProvider`) — define the wire contract before writing either side of the HTTP call, not after both are "working" independently.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|------------------|
| Promote `ToolExecutor.ts` into `packages/core` with only cosmetic renaming, no interface redesign | Fast dedup, satisfies "no more duplication" goal immediately | Bakes OpenAI-shaped tool-call semantics into the "generic" core, requiring a breaking change when Bedrock/Gemini adapters are eventually built | Never — this is the one interface in the milestone explicitly meant to outlive a single vendor |
| Hardcode `Semaphore(1)` (fully serialized inference) in both Python services with no config | Simple, guaranteed to avoid GPU OOM during this milestone's proof-of-concept scale | Throughput ceiling of 1 request at a time per service; fine for a demo, wrong default if anyone later points production traffic at it | Acceptable for this milestone's demo/PoC scope — flag clearly in README/docstring as a scale limit, not a permanent architecture decision |
| Reuse the OpenAI provider's 500ms VAD-loopback cooldown constant unchanged in the generic orchestrator | Saves time re-deriving timing for new providers | Likely either insufficient (loopback recurs with JaiTTS) or excessive (sluggish turn-taking) since it was tuned for a different TTS player's audio tail | Never without at least one manual test against the new TTS provider's actual playback |
| Skip silence-trimming/repetition-detection in `thonburian-stt` for the first working version | Faster to a working demo path | Demo audio with any background noise or quiet speech produces hallucinated repeated-phrase transcripts that look like a "broken pipeline" bug rather than a known, fixable model behavior | Acceptable only as a tracked TODO with the known failure mode documented, not silently deferred |
| Use the orphaned `LLMProvider`/`TTSProvider` types in `packages/core/src/types/mock.ts` as a starting point for the new interfaces because "something similar already exists" | Less typing from scratch | Per PROJECT.md, these types are explicitly unrelated/orphaned from `RealtimeProvider` and not wired into any hook — reusing them risks importing unvetted assumptions and creating a second source of confusion | Never — PROJECT.md explicitly warns against conflating these |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|--------------|-----------------|-------------------|
| `transformers.pipeline("automatic-speech-recognition", ...)` for Thonburian Whisper | Using pipeline defaults for `chunk_length_s`, `no_speech_threshold`, `compression_ratio_threshold` on short VAD-segmented clips, inheriting long-form-audio-tuned defaults | Explicitly set/tune thresholds for short-clip input; trim silence before inference; consider calling `model.generate()` directly instead of the high-level pipeline for more control, per HF's own caveat about pipeline accuracy on edge cases |
| F5-TTS `FlowTTSPipeline` (ThonburianTTS inference repo) | Treating reference audio as a static config file without validating duration/noise/transcript match; assuming any "default voice" sample will produce good output | Validate reference clip against documented F5-TTS constraints (3-10s, trimmed silence, exact transcript match) before bundling as default |
| FastAPI/Flask serving either Python model | Loading the model inside the request handler or running multiple GPU-bound worker processes | Load once at process startup (`lifespan`/module scope), single worker per GPU, explicit semaphore-gated concurrency |
| SDK ↔ Python service HTTP boundary | Assuming "send audio bytes, get audio bytes back" is a sufficient contract without pinning sample rate/encoding/container format | Document and validate the exact audio wire format on both sides; add a round-trip fixture test |
| Generic `LLMProvider` tool-calling interface vs. future Bedrock/Gemini | Modeling the interface only against OpenAI's single-tool-call, `role: "tool"` round-trip shape since it's the only vendor implemented this milestone | Sketch (even without code) how Anthropic/Gemini's multi-tool-call and JSON-schema constraints would map onto the same interface before finalizing it |
| Reusing `ToolExecutor.ts` duplication fix | Treating "moved the file to packages/core" as equivalent to "validated it's vendor-agnostic" | Treat the move as an interface-redesign task, not a copy-paste relocation |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|------------------|
| Fully serialized (`Semaphore(1)`) inference on both Python services | Fine for one developer testing the demo; requests start queuing visibly once 2+ simultaneous utterances arrive | Document the limit explicitly; size semaphore to measured VRAM headroom if concurrency beyond a single demo user is ever needed | Breaks (becomes a noticeable bottleneck) the moment more than one concurrent end-to-end demo session is run, or any load test beyond 1 user |
| MFCC/DTW lipsync analysis already runs on every audio frame on the main thread (existing issue per CONCERNS.md) | UI jank/dropped frames when CPU is also handling new pipeline-orchestration overhead | Be aware this exists already; don't add more main-thread synchronous work in the new generic pipeline's React integration on top of it | Already present; compounds if the new pipeline adds additional synchronous per-frame work in `packages/react` |
| `setInterval` 100ms state-sync polling in `useRealtime.ts` (existing issue per CONCERNS.md) | Constant background re-renders (10/sec) for the lifetime of any connected session | Don't model the new generic pipeline's React state sync after this pattern; prefer pure event-driven callbacks | Already present in `openai-stt-tts`/`openai-realtime` integration; avoid replicating in new `generic-stt-tts` React wiring |
| No retry/backoff on STT/TTS/LLM HTTP calls (existing pattern per CONCERNS.md, `STTClient`/`ChatClient`/`TTSPlayer` fail immediately on any error) | A single transient network blip to `thonburian-stt`/`jai-tts` (e.g. brief GPU contention causing a timeout) fails the entire user turn rather than retrying | Add basic retry/backoff specifically for the new self-hosted services, which are more likely to have transient slowness (cold model, GPU contention) than a managed API | Becomes visible the first time the Python service is even slightly slow (e.g. under concurrent load with `Semaphore(1)` queuing) and a request times out |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing `thonburian-stt`/`jai-tts` HTTP endpoints without auth, mirroring the existing unauthenticated proxy/negotiate pattern flagged in CONCERNS.md | Anyone who can reach the service can run (GPU-billed, or at minimum compute-billed) inference requests, potentially exhausting the single-concurrency semaphore as a denial-of-service vector against legitimate users | Treat these as backend-only services not exposed directly to browsers; require the same proxy pattern already used for OpenAI keys, and add basic rate limiting given the cheap-to-trigger, expensive-to-compute nature of ASR/TTS requests |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|--------------|-------------------|
| Treating self-hosted STT/TTS latency (multi-second whole-utterance round trip) the same as OpenAI's near-realtime streaming in UI status/loading states | User sees a long silent gap with no "thinking"/"transcribing" indicator, feels like the app froze, may repeat themselves or barge in mid-process | Surface explicit per-stage status (listening → transcribing → thinking → speaking) and tune any "speaking" status trigger (per the existing `speakingStatusSet` pattern in `OpenAISTTTTSProvider`) to the new providers' actual audio-ready timing, not a copy of OpenAI's timing |
| No user-facing distinction between "STT heard silence" and "STT hallucinated/garbled text" (Pitfall 3) | LLM responds to nonsense, user is confused why the assistant "misheard" them when actually no real speech was a present | Have `thonburian-stt` return an explicit no-speech/low-confidence signal distinct from a real transcript, and have the orchestrator skip the LLM turn entirely on no-speech rather than sending hallucinated text forward |
| Default bundled JaiTTS voice sounds inconsistent/artifacted because the reference clip wasn't quality-validated (Pitfall 5) | First impression of the whole demo (and of "non-OpenAI vendors work") is a worse-sounding voice than OpenAI's TTS, undermining the milestone's core value proposition | Do a deliberate listening-QA pass on the bundled reference voice and treat it as a release-blocking asset, not a placeholder file |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **`generic-stt-tts` orchestrator compiles and runs against OpenAI-equivalent timing:** Often missing validation against the *actually non-streaming* Thonburian/JaiTTS timing characteristics — verify by running the full pipeline with artificial network/inference delay injected (not just against fast local mocks) to confirm no part of the orchestrator assumes sub-200ms responses.
- [ ] **Tool-calling "works":** Often missing verification that the interface generalizes beyond OpenAI's exact tool-call round-trip shape — verify by writing (even unimplemented) a second-vendor mapping sketch (Anthropic or Gemini) against the same interface before calling the interface done.
- [ ] **`thonburian-stt` "transcribes Thai audio correctly":** Often missing testing against short, quiet, and silence-padded clips specifically (not just clean long test recordings) — verify by deliberately testing 1-3 second clips and clips with leading/trailing silence for hallucinated repetition.
- [ ] **`jai-tts` "clones voice and produces Thai speech":** Often missing validation of the bundled default reference voice's actual quality and a check that reference text exactly matches reference audio — verify with a manual listening pass and a re-transcription cross-check (run the reference clip through `thonburian-stt` and diff against the stored reference text).
- [ ] **Backend services "run":** Often missing model-loaded-once-at-startup verification and concurrency safety — verify by sending 2 concurrent requests to each service and confirming no CUDA OOM / no duplicate model load, and confirming first-request latency isn't a 10-30s cold load disguised as "normal."
- [ ] **End-to-end demo "proves multi-vendor pipeline works":** Often missing the VAD-loopback cooldown re-validation against JaiTTS's actual audio tail (Pitfall 6) — verify by running several consecutive turns and confirming the mic doesn't re-trigger on the assistant's own JaiTTS audio output.
- [ ] **HTTP contract between SDK and Python services "works":** Often missing an explicit, tested audio format contract — verify with a round-trip fixture test asserting sample rate/duration of both the STT request audio and the TTS response audio, not just HTTP 200 status.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Streaming-first interface baked in (Pitfall 1) discovered after both adapters are built | HIGH | Introduce a capability-flag/extension interface retroactively, refactor the orchestrator to branch on capability rather than vendor identity, re-test both adapters; costly because it touches the core interface contract every adapter depends on |
| Tool-calling interface found to be OpenAI-shaped (Pitfall 2) only once a second vendor is attempted later | MEDIUM-HIGH | Introduce an adapter-level normalization layer between the vendor's native tool-call format and the core `ToolCall` type (isolate the damage to one adapter) rather than reopening the core interface if avoidable; if the core type itself must change, audit all consumers (`ToolExecutor`, both STT/TTS providers, `openai-realtime`) for the breaking change |
| Whisper hallucination on silence (Pitfall 3) discovered in later end-to-end testing | LOW-MEDIUM | Add silence-trimming + repetition-ratio rejection in `thonburian-stt` as a follow-up patch; doesn't require touching the SDK side if the service-level no-speech signal is added cleanly |
| GPU OOM under concurrency (Pitfall 4) discovered after initial "works on my machine" testing | LOW-MEDIUM | Add the semaphore gate and startup-time model loading; low cost if caught before any deployment, higher cost (service downtime, debugging crash logs) if discovered only via a production-like crash |
| Bad default reference voice quality (Pitfall 5) discovered late, e.g. during the end-to-end demo | LOW | Re-record/re-trim the reference clip and re-validate against the same checklist; isolated to one asset file, doesn't require code changes |
| VAD-loopback cooldown timing wrong for JaiTTS (Pitfall 6) discovered during demo testing | LOW-MEDIUM | Make the cooldown configurable per-provider-pairing if not already, tune empirically against JaiTTS's actual playback tail; same class of fix already applied once for OpenAI so the pattern is known |
| Audio format mismatch (Pitfall 7) discovered via garbled audio late in integration | LOW-MEDIUM | Pin the contract explicitly now, add resampling/validation at the service boundary, add the round-trip fixture test retroactively |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| Streaming-first interface bias (Pitfall 1) | Core interface design phase (STTProvider/TTSProvider/VADProvider/LLMProvider definition) | Interface can express a fully non-streaming provider as the default case, not a special case; both a sketch of OpenAI's streaming path and Thonburian/JaiTTS's whole-utterance path map cleanly onto it before any adapter code is written |
| OpenAI-shaped tool-calling abstraction (Pitfall 2) | `ToolExecutor` promotion / `LLMProvider` tool-calling design phase | A written mapping of how Anthropic/Gemini's tool-call round-trip and JSON-schema constraints would fit the same interface exists and required no core type changes |
| Whisper hallucination on short/silent clips (Pitfall 3) | `thonburian-stt` service implementation phase | Test suite includes short (1-3s) and silence-padded clips; service returns distinguishable no-speech signal instead of hallucinated repeated text |
| GPU OOM / cold-start under concurrency (Pitfall 4) | `thonburian-stt` and `jai-tts` service scaffolding phase | Concurrent-request load test (2+ simultaneous calls) completes without CUDA OOM or duplicate model loads; first request after startup time is measured and acceptable |
| Unvalidated default reference voice (Pitfall 5) | `jai-tts` service scaffolding / asset preparation phase | Manual listening QA pass completed and documented; reference text cross-checked against re-transcription of the reference audio |
| VAD-loopback cooldown not re-validated per provider (Pitfall 6) | Generic orchestrator implementation phase | Multi-turn end-to-end test with JaiTTS shows no mic self-triggering; cooldown duration is configurable, not a hardcoded copy of the OpenAI constant |
| Audio format/encoding mismatch at HTTP boundary (Pitfall 7) | Adapter implementation phase (`ThonburianSTTProvider`, `JaiTTSProvider`) | Documented wire-format contract exists; round-trip fixture test asserts sample rate/duration on both request and response paths |

## Sources

- [Speech Input & Turn Detection - Pipecat](https://docs.pipecat.ai/pipecat/learn/speech-input) — official docs on VAD latency budget and turn-detection limitations
- [Pipecat Voice Agent in Production: Complete Guide](https://luonghongthuan.com/en/blog/pipecat-voice-agent-production-scalable-guide/) — production issues and optimization patterns for pipecat-style pipelines
- [Severe latency and response desynchronization · pipecat-ai/pipecat#3218](https://github.com/pipecat-ai/pipecat/issues/3218) — real-world pipecat latency/desync issue report
- [Preemptive speech generation option · pipecat-ai/pipecat#3321](https://github.com/pipecat-ai/pipecat/issues/3321) — documents the VAD-end-of-speech-gating latency cost in pipecat's architecture
- [Sequential Pipeline Architecture for Voice Agents - LiveKit](https://livekit.com/blog/sequential-pipeline-architecture-voice-agents) — Audio In → VAD → STT → LLM → TTS → Audio Out architecture and barge-in design
- [Advice on Building Voice AI in June 2025 - Daily.co](https://www.daily.co/blog/advice-on-building-voice-ai-in-june-2025/) — practitioner advice on voice pipeline composition
- [LLM API Differences That Break Your Code - FutureSearch](https://futuresearch.ai/blog/llm-provider-quirks/) — concrete cross-provider tool-calling/JSON-schema/temperature gotchas (Gemini items.type, no top-level $ref, Anthropic thinking-mode tool_choice restriction)
- [Whisper Hallucination on Silence - DEV Community](https://dev.to/nareshipme/whisper-hallucination-on-silence-why-your-transcript-loops-the-same-phrase-2pg4) — root cause and mitigation of repeated-phrase hallucination on silence/short clips
- [Hallucination on audio with no speech · openai/whisper#1606](https://github.com/openai/whisper/discussions/1606) — official-repo discussion confirming the failure mode and decoding-threshold causes
- [Investigation of Whisper ASR Hallucinations Induced by Non-Speech Audio (arXiv)](https://arxiv.org/pdf/2501.11378) — academic analysis of the hallucination mechanism
- [The $0 Scalability Fix: How Whisper Microservice Saved Us from GPU OOM - Medium](https://medium.com/@patelhet04/the-0-scalability-fix-how-whisper-microservice-saved-us-from-gpu-oom-65dfd41a2180) — concurrency/VRAM exhaustion war story and semaphore-based fix
- [The Concurrency Mistake Hiding in Every FastAPI AI Service](https://jamwithai.substack.com/p/the-concurrency-mistake-hiding-in) — model-loading-per-request and worker-count vs. GPU-memory mismatch pattern
- [F5-TTS Setup Guide for Local Voice Cloning - BuilderAI](https://builderai.tools/blog/running-f5-tts-locally-for-voice-cloning) — reference audio quality constraints (3-10s, silence trimming, VRAM requirements)
- [RVCBench: Benchmarking the Robustness of Voice Cloning Across Modern Audio Generation Models (arXiv)](https://arxiv.org/pdf/2602.00443) — systematic real-world voice-cloning failure modes (short/noisy references, multi-speaker contamination, identity drift)
- [Barge-In Detection for Voice Agents - Beluga AI Framework](https://beluga-ai.org/docs/use-cases/voice-turn-barge-in-detection/) — barge-in architecture and latency budget components
- [Voice Agent Interruption Handling Runbook - Hamming AI](https://hamming.ai/resources/voice-agent-interruption-handling-runbook) — interruption/cancellation signal handling between TTS and LLM state
- `.planning/codebase/CONCERNS.md` (this repo) — existing fragile turn-lifecycle, duplicated `ToolExecutor`, VAD-loopback cooldown heuristic, and untested fragile-area findings used to ground Pitfalls 2 and 6 in this specific codebase

---
*Pitfalls research for: Composable voice AI pipeline with self-hosted Thai STT/TTS services*
*Researched: 2026-06-17*
