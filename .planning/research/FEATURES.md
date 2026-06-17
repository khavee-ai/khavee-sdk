# Feature Research

**Domain:** Composable/pluggable voice-AI pipeline framework (pipecat-style STT/LLM/TTS orchestration with tool-calling), for a TypeScript SDK provider package
**Researched:** 2026-06-17
**Confidence:** MEDIUM-HIGH (cross-verified across pipecat, LiveKit Agents, Vocode, Vapi docs/search; no Context7 entries available for these specific frameworks, so individual claims are WebSearch-verified against official docs/GitHub where a URL is cited)

## Feature Landscape

### Table Stakes (Users Expect These)

Features every composable voice-pipeline framework in this space (pipecat, LiveKit Agents, Vocode) provides. Missing these makes the abstraction feel broken or like a toy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-stage provider interfaces (`VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`) with one method each doing the "real work" | Every framework researched (pipecat's `STTService`/`LLMService`/`TTSService`, LiveKit's `stt.STT`/`tts.TTS` abstract base classes, Vocode's `Transcriber`/`Agent`/`Synthesizer`) centers on exactly this 3-4-stage decomposition. This is the entire value proposition stated in PROJECT.md. | MEDIUM | Khavee already has the concrete classes (`AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer`) to generalize — confirmed in ARCHITECTURE.md. Keep each interface to 1-2 core methods (`transcribe()`, `complete()`/`generate()`, `speak()`) — fat interfaces are the anti-pattern pipecat avoids by splitting `process_frame`/`push_frame` from service-specific logic. |
| A generic pipeline orchestrator that composes any `{vad, stt, llm, tts}` combination | This is literally what pipecat's `Pipeline` class and Vocode's `StreamingConversation` do — connect arbitrary processors/components into one runnable session. Already named as the deliverable in PROJECT.md ("pipecat-style"). | MEDIUM | Maps directly onto generalizing `OpenAISTTTTSProvider`'s `runTurn`/`runTurnFromText` per ARCHITECTURE.md's own recommendation — a single `PipelineRealtimeProvider`-equivalent class constructed with stage implementations as args. |
| Tool/function-calling loop as a core capability of the LLM stage, not bolted on per-vendor | LiveKit Agents, pipecat, Vocode, and Vapi all treat function/tool calling as a first-class part of the LLM abstraction (LiveKit's `@function_tool`, pipecat's `register_function`/`ToolsSchema`, Vapi's `tools` array on the assistant). PROJECT.md already commits to this via Key Decisions table. | MEDIUM | Already exists in khavee as `RealtimeTool` + `ToolExecutor`, just duplicated (CONCERNS.md). Promote to `@khaveeai/core`, adapt to the new `LLMProvider` interface signature. |
| Plain-object tool definition: `{ name, description, parameters, handler }` matching JSON-Schema-shaped `parameters` | Confirmed as the universal wire format: OpenAI's function-calling API (`{name, description, parameters: {type:"object", properties, required}}`), Vapi's custom tools (same shape, `parameters.properties`), and even LiveKit's Node.js tools (object with `description`/`parameters`/`execute`) all converge on "JSON-schema-ish object + handler/execute fn," not class decorators. | LOW | **Important divergence found:** khavee's *current* `RealtimeTool.parameters` (in `packages/core/src/types/realtime.ts`) is a custom flat map (`{ [key]: { type, required, enum, description } }`), NOT real JSON Schema (no nested `properties`/`type:"object"` wrapper). PROJECT.md's stated goal ("matches JSON-schema shape every LLM vendor's tool-calling API already expects") implies this should be reconciled — either keep the simplified flat-map shape (it's arguably *more* beginner-friendly than raw JSON Schema) and have each `LLMProvider` adapter translate it to real JSON Schema internally, or migrate to real JSON Schema. Flagged as a design decision for requirements, not a research gap. |
| Tool result format normalized regardless of vendor (`{success, message}` or similar) | Vapi normalizes every tool response into a `results` array keyed by `toolCallId`; pipecat normalizes via `FunctionCallResultProperties`; LiveKit normalizes via the return value of `@function_tool`-decorated functions. Every framework needs ONE result shape the orchestrator understands, with the LLM adapter translating to/from the vendor's wire format. | LOW | Khavee already has this: `ToolExecutor.execute()` returns `{success: boolean, message: string}`. Keep it — it's simpler than most ecosystem examples and beginner-friendly. |
| Per-stage configuration objects, not one flat inherited config | ARCHITECTURE.md's own Anti-Patterns section flags `OpenAISTTTTSConfig extends RealtimeConfig` flat-field bloat as a problem. Pipecat uses `PipelineParams` plus per-service constructor args; LiveKit uses per-plugin constructor kwargs; Vocode uses per-component config classes (`TranscriberConfig`, `AgentConfig`, `SynthesizerConfig`). | LOW-MEDIUM | Directly actionable: `{ vad: VADConfig, stt: STTConfig, llm: LLMConfig, tts: TTSConfig, tools, instructions }` composition instead of flat inheritance, as ARCHITECTURE.md already recommends. |
| Barge-in / interruption support (stop TTS playback when user starts speaking, cancel in-flight LLM/TTS work) | Universal expectation in turn-based voice agents — pipecat's SystemFrame/InterruptionFrame priority queue, LiveKit's automatic interruption handling, and general industry consensus (sub-150ms target) all treat this as non-negotiable for natural conversation. | MEDIUM-HIGH | Khavee already has a version of this (VAD pause/resume + 500ms cooldown in `OpenAISTTTTSProvider`, flagged as fragile/duplicated recovery logic in CONCERNS.md). The generic orchestrator must support a `cancel()`/abort path through whichever LLM/TTS adapter is active — needs an `AbortSignal`-style hook on `LLMProvider.complete()` and `TTSProvider.speak()`, not just on the orchestrator. |
| Errors normalized to `Error` instances, forwarded via callback, never thrown to crash the session | Pipecat surfaces `ErrorFrame` as a structured, non-fatal signal; LiveKit's plugin base classes declare capabilities precisely so unsupported operations throw a clear, typed error rather than failing silently. Khavee's existing pattern (try/catch at lifecycle boundaries, `onError?.()` callback, status always reset to a safe state) already matches this. | LOW | Carry the existing `OpenAISTTTTSProvider` error convention into the new generic orchestrator unchanged — `error instanceof Error ? error : new Error(String(error))`, always reset `chatStatus`/turn-active flag in `finally`. This is already validated by the codebase, just needs to apply uniformly across whichever STT/TTS adapter is plugged in. |
| Audio format/sample-rate negotiation between stages | Pipecat explicitly handles this — `PipelineParams.audio_in_sample_rate`/`audio_out_sample_rate`, automatic resampling when a TTS/STT service's native rate differs from the pipeline's, WAV-header-based auto-detection. This is a real, repeatedly-hit problem (cited GitHub issue: "set transport sample rate based on STT/TTS sample rates"). | MEDIUM | **Directly relevant to this milestone**: Thonburian Whisper and JaiTTS will each have their own native sample rates distinct from OpenAI's. The `STTProvider`/`TTSProvider` interfaces need an explicit, documented sample-rate/format contract (e.g. `STTProvider.transcribe(audio: Blob, opts): Promise<string>` where the adapter handles resampling itself, OR the orchestrator declares an expected format and each adapter must accept/produce it). Decide once, document clearly — this is a common integration bug source across the ecosystem. |
| Streaming-vs-chunked capability declaration per stage | LiveKit's STT/TTS base classes declare capabilities (e.g. streaming supported or not) so the framework can validate usage and give a clear error ("use a different TTS or StreamAdapter") instead of silently misbehaving. Directly relevant since PROJECT.md confirms neither Thonburian Whisper nor JaiTTS support true incremental streaming. | LOW | A simple boolean/enum capability flag (e.g. `STTProvider.supportsStreaming = false`) lets the orchestrator and consuming code branch correctly, and lets future Bedrock/Gemini adapters declare richer capabilities without redesigning the interface. Cheap to add now, expensive to retrofit later. |
| Vendor-neutral conversation/message history format passed into the LLM stage | Every framework (OpenAI `messages: [{role, content}]`, pipecat's `OpenAILLMContext`, LiveKit's `ChatContext`, Vocode's transcript-to-agent handoff) needs one canonical message-array shape that the LLM adapter translates to its vendor's wire format. Khavee already has this internally (`ChatMessage[]` in `OpenAISTTTTSProvider`). | LOW | Promote the existing internal shape (`{role, content}[]`) to `@khaveeai/core` as part of the `LLMProvider` interface contract — don't invent a new shape. |

### Differentiators (Competitive Advantage)

Features that go beyond what's strictly needed to prove the abstraction, but materially improve on what the bigger frameworks do — or align tightly with khavee's actual niche (3D avatar + lipsync + beginner DX + Thai-language vendors).

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| Beginner DX: zero-schema-library tool registration (`{name, description, parameters, handler}` plain object, no Zod/decorators) | This is a genuine differentiator versus LiveKit's Node.js SDK (requires Zod for `parameters`) and versus most TS agent frameworks that lean on Zod/decorators for type safety. Matches Vapi's and OpenAI's raw-JSON-schema-object simplicity but keeps a plain handler function instead of a webhook round-trip. Directly serves PROJECT.md's stated "Beginner DX" constraint. | LOW | Already decided in PROJECT.md Key Decisions. The research validates this as differentiated, not just convenient — competing TS frameworks (LiveKit JS) impose a schema-validation dependency that khavee's target beginner audience doesn't need. |
| First-class avatar/lipsync event surface (`onMouthStateChange`, `onPhonemeDetected`, `onAudioData` → analyser) wired generically across any TTS vendor | None of pipecat/LiveKit/Vocode/Vapi have a built-in 3D-avatar lipsync concept — this is khavee's actual product wedge (per ARCHITECTURE.md, `VRMAvatar`/`GLBAvatar` + MFCC/DTW phoneme detection already exist and are unique to this SDK). | MEDIUM | The generalization work must ensure the new generic `TTSProvider` interface still exposes the audio buffer/analyser hook so lipsync keeps working for non-OpenAI TTS vendors (e.g. JaiTTS) without forking the lipsync code per provider. This is the single feature that most differentiates khavee from "yet another pipecat clone." |
| First reference implementation using fully non-Western, Thai-native vendors (Thonburian Whisper STT + JaiTTS TTS) proving the abstraction isn't OpenAI-shaped in disguise | Pipecat/LiveKit/Vocode are vendor-agnostic in theory but their docs, examples, and most production usage skew toward English-first vendors (Deepgram, Cartesia, ElevenLabs). A working Thai STT+TTS pipeline is a meaningfully different proof point and a real market differentiator for Thai-language voice apps. | HIGH (mostly in the Python services, not the TS SDK) | This is the actual "does the abstraction hold up" test. If the interfaces only work cleanly for HTTP-buffered, non-streaming, whole-utterance vendors (which Thonburian/JaiTTS are), the interfaces are honest about that constraint rather than over-promising streaming support they can't deliver. |
| Mixed-vendor pipelines (STT from vendor A, TTS from vendor B, LLM from vendor C) as a documented, demoed use case | ARCHITECTURE.md explicitly flags that today "there is no concept of running STT from one vendor and TTS from another simultaneously." Pipecat/LiveKit support this in principle but very few public demos actually cross vendors this aggressively (e.g. Thai STT + generic LLM + Thai TTS, no OpenAI in the loop at all). | MEDIUM | This is the actual deliverable named in PROJECT.md's Active requirements ("End-to-end demo... proving STT/TTS can come from different, non-OpenAI, mixed vendors"). Worth treating as a flagship example, not just a smoke test. |
| Single shared `ToolExecutor` with consistent timeout/error handling across all providers (realtime + pipeline) | CONCERNS.md flags the current byte-for-byte duplication as a real tech-debt risk ("any bug fix... must be applied twice"). Centralizing it is differentiation-by-removing-debt: makes khavee's tool-calling more consistent than frameworks that re-implement tool execution per integration. | LOW | Direct execution of an already-identified fix; low risk, clear win, already an Active requirement. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that look like "of course we need this" given the ecosystem, but would be premature, scope-inflating, or actively contradict this milestone's stated constraints.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| True incremental/partial streaming STT and TTS (word-by-word transcripts, sentence-by-sentence audio) | Pipecat, LiveKit, and Deepgram/Cartesia-class vendors all support this and it's the industry's latency gold standard (sub-300ms budgets cited repeatedly in research). | PROJECT.md explicitly rules this out: "neither Thonburian Whisper nor JaiTTS support it natively." Building a streaming-shaped interface now (e.g. an `AsyncIterable<token>` contract) over two backends that fundamentally only do whole-utterance HTTP would force fake/buffered "streaming" that adds complexity without latency benefit, and would mislead future adapter authors about what the interface actually guarantees. | Keep `STTProvider.transcribe()` / `TTSProvider.speak()` as single-shot Promise-returning calls over buffered audio, exactly as decided ("streaming-chunked HTTP" per Key Decisions). Document the interface as utterance-level, not token-level, so a future streaming-capable vendor adapter is additive (e.g. an optional `transcribeStream()` capability flag) rather than a breaking redesign. |
| Zod-based (or any schema-library-based) tool/parameter validation | LiveKit's Node SDK and many TS agent frameworks use Zod for compile-time + runtime parameter safety, which seems like "the more correct TS way." | PROJECT.md hard-constrains against this: "Beginner DX... no extra schema library... plain JS objects only." Adding Zod (even optionally) creates two parallel tool-definition shapes for users to be confused by, and pulls in a dependency this SDK has deliberately avoided in `@khaveeai/core` (which currently has zero schema-validation deps, per ARCHITECTURE.md's Cross-Cutting Concerns). | Plain-object `{name, description, parameters, handler}` only. If runtime validation of `args` against `parameters` is wanted later, write a tiny internal type-check (string/number/boolean/enum) rather than depending on Zod — keeps the zero-dependency promise. |
| Real Bedrock/Gemini provider adapters built now | The interfaces are explicitly designed to "support them later," which naturally tempts building them now to prove it. | PROJECT.md explicitly puts this Out of Scope this milestone: "only used as illustrative examples... no adapters are built now." Building them would dilute focus from validating the Thai-vendor proof point and risks over-fitting the interface design to AWS/Google's specific SDKs before the abstraction is even battle-tested once. | Design the `LLMProvider`/`STTProvider`/`TTSProvider` interfaces by checking they *could* wrap Bedrock/Gemini's known request/response shapes on paper (a thought experiment / interface review), but defer actual implementation to a future milestone. |
| Refactoring `openai-stt-tts` onto the new generic interfaces in this milestone | Once the generic interfaces exist, it's tempting to immediately migrate the one working, tested provider onto them to "finish the job" and avoid two parallel patterns living in the repo. | PROJECT.md explicitly rules this out ("left untouched this milestone, may migrate later") and Constraints section reinforces "Must not break the existing openai-stt-tts provider." Touching working, tested code (it's the *only* package with tests per CONCERNS.md) while the new abstraction is unproven is a needless regression risk. | Ship `generic-stt-tts` as a new, separate package this milestone. Treat `openai-stt-tts` migration as a distinct, later milestone once the generic interfaces have a second/third real adapter validating them (Thonburian/JaiTTS qualify). |
| Full-duplex / WebRTC-based generic pipeline (unifying with `openai-realtime`'s transport model) | Once you have a generic pipeline, it's tempting to also generalize the full-duplex realtime path so there's "one true orchestrator" for everything. | PROJECT.md explicitly scopes this out: "`openai-realtime`'s full-duplex WebRTC provider — separate concern, not modified." ARCHITECTURE.md confirms this is architecturally a different beast entirely (one ~800-line class because the vendor API is a single full-duplex session with no separate STT/LLM/TTS calls) — pipecat itself treats WebRTC full-duplex and turn-based cascaded pipelines as different deployment modes, not one unified abstraction. | Keep `RealtimeProvider` as the single outer interface both `OpenAIRealtimeProvider` (full-duplex) and the new generic pipeline orchestrator (turn-based, composed) implement — exactly as today. Don't try to make the *internal* composition model (frame-based pipeline vs. monolithic WebRTC session) the same; only the outer contract needs to be shared. |
| A generalized "legacy" `LLMProvider`/`TTSProvider` (from `packages/core/src/types/mock.ts`) reconciliation as part of this work | Since the new milestone is also introducing an `LLMProvider` interface, it's tempting to merge/fix the existing orphaned `LLMProvider`/`TTSProvider` types flagged in ARCHITECTURE.md so there's "one clean LLMProvider in the codebase." | PROJECT.md explicitly warns: "should not be confused with the new interfaces being designed here; may need cleanup or reconciliation" — phrased as a future concern, not an Active requirement. Folding in cleanup of unrelated dead code (the `mock`/`openai` non-realtime packages built against the old shape) expands this milestone's blast radius into code paths nothing in the Active requirements touches. | Name the new interface distinctly enough in the actual implementation (e.g. keep it scoped to the new `generic-stt-tts` package's exports, or clearly version/namespace it in `@khaveeai/core`) that it doesn't silently collide with or get confused with the existing `mock.ts` `LLMProvider`. Leave the legacy type's fate to a later cleanup milestone — note it as a flag for requirements/roadmap, not something to fix now. |
| Token-budget-aware history trimming (tiktoken-based) as part of the new generic `LLMProvider` | CONCERNS.md flags the current count-based trimming (`maxTurns * 2` messages) as a scaling limit, and a generic LLM interface feels like the right place to "finally fix" it. | Out of this milestone's stated scope (PROJECT.md doesn't list it under Active requirements) and adds a tokenizer dependency (tiktoken or similar) whose accuracy varies per-vendor (a Bedrock/Gemini model's tokenizer differs from OpenAI's) — solving it generically is a deeper, vendor-aware problem than this milestone's interface-design goal. | Carry forward the existing message-count trimming behavior unchanged in the new orchestrator (consistent with not modifying `openai-stt-tts`'s working logic); flag token-aware trimming as a future enhancement once there's a real multi-vendor LLM adapter to test it against. |

## Feature Dependencies

```
[STTProvider interface] ──requires──> [Audio format/sample-rate contract decided]
[TTSProvider interface] ──requires──> [Audio format/sample-rate contract decided]
[VADProvider interface] ──enhances──> [Pipeline orchestrator] (orchestrator can run without VAD if text-only `sendMessage()` path is kept, as OpenAISTTTTSProvider already supports)

[Pipeline orchestrator] ──requires──> [STTProvider interface]
[Pipeline orchestrator] ──requires──> [LLMProvider interface]
[Pipeline orchestrator] ──requires──> [TTSProvider interface]
[Pipeline orchestrator] ──requires──> [Per-stage config composition] (flat config inheritance blocks clean multi-vendor config)

[LLMProvider tool-calling support] ──requires──> [Shared ToolExecutor in @khaveeai/core] (dedup must happen before/alongside interface definition, not after)
[Beginner-friendly tool registration] ──requires──> [Plain-object tool schema decided] (flat custom shape vs. real JSON Schema — must be resolved before LLMProvider interface is finalized, since every vendor adapter's translation logic depends on it)

[Thonburian STT adapter] ──requires──> [STTProvider interface] + [Audio format/sample-rate contract] + [HTTP backend service exists]
[JaiTTS adapter] ──requires──> [TTSProvider interface] + [Audio format/sample-rate contract] + [HTTP backend service exists] + [Lipsync/analyser hook preserved in TTSProvider]

[Mixed-vendor end-to-end demo] ──requires──> [Thonburian STT adapter] + [JaiTTS adapter] + [Any LLMProvider adapter (OpenAI-backed is fine)] + [Pipeline orchestrator]

[Streaming STT/TTS] ──conflicts──> [This milestone's scope] (explicitly out of scope; do not let interface design implicitly assume streaming)
[Zod/decorator tool schemas] ──conflicts──> [Beginner DX constraint] (explicitly out of scope)
```

### Dependency Notes

- **Audio format/sample-rate contract must be decided before either real adapter (Thonburian, JaiTTS) is built**: this is the one place the ecosystem research (pipecat's repeated resampling fixes, GitHub issue #928) shows real, recurring pain. Decide once at the interface level — e.g. "STTProvider always receives a WAV Blob and is responsible for any resampling it needs" / "TTSProvider always returns audio at its native rate and the consumer (TTSPlayer-equivalent) resamples for playback" — and document it so it isn't rediscovered per-adapter.
- **Tool schema shape (flat custom map vs. real JSON Schema) blocks finalizing `LLMProvider`**: every vendor's `LLMProvider` adapter needs to translate `RealtimeTool.parameters` into that vendor's wire format. If the shape changes after adapters exist, every adapter's translation logic must be revisited. Resolve this as an early interface-design decision, not an implementation detail discovered later.
- **Shared `ToolExecutor` dedup enhances but does not block `LLMProvider` design**: the interface can be designed independently, but the dedup should land in the same phase so the new `LLMProvider`'s tool-calling contract and the executor's signature are designed together (avoiding a third near-duplicate `ToolExecutor` variant).
- **VAD is an enhancement, not a hard requirement, for the orchestrator**: `OpenAISTTTTSProvider.sendMessage()` already proves a text-only path that skips STT/VAD entirely. The generic orchestrator should preserve this — useful for testing LLM/TTS adapters without a microphone, and for text-chat-only consumers.
- **Streaming and Zod explicitly conflict with this milestone's constraints**: listed here as a dependency-graph "conflict" so roadmap phases don't accidentally reintroduce them as a "nice to have while we're in here" addition during interface design.

## MVP Definition

### Launch With (v1 — this milestone, per PROJECT.md Active requirements)

- [ ] `VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider` interfaces in `@khaveeai/core` — the entire value proposition; nothing else is buildable without this
- [ ] Generic pipeline orchestrator composing any `{vad, stt, llm, tts}` combination — the actual "pipecat-style" deliverable
- [ ] Plain-object tool registration (`{name, description, parameters, handler}` + `addTool()`-style call) — beginner DX is a hard constraint, not optional
- [ ] Shared `ToolExecutor` promoted/deduped into `@khaveeai/core`, adapted to `LLMProvider` — already-identified debt, low cost to fix now while touching this code anyway
- [ ] `generic-stt-tts` package implementing orchestrator + interfaces — the deliverable package
- [ ] `thonburian-stt` backend service (HTTP, audio-in/Thai-text-out) — needed to prove the abstraction with a real non-OpenAI vendor
- [ ] `jai-tts` backend service (HTTP, text-in/WAV-out, bundled default Thai voice) — same, for TTS
- [ ] `ThonburianSTTProvider` / `JaiTTSProvider` adapter classes — the actual interface implementations that prove the contract works
- [ ] End-to-end mixed-vendor demo (Thonburian STT + any LLM + JaiTTS) with tool-calling working — the proof that this isn't just an interface on paper
- [ ] Documentation/examples for wiring a custom vendor + registering a tool — required for the "beginner-friendly" claim to be real, not just intended

### Add After Validation (v1.x)

- [ ] Migrate `openai-stt-tts` onto the new generic interfaces (deferred per PROJECT.md, trigger: interfaces proven stable across 2+ real adapters)
- [ ] Real Bedrock and/or Gemini adapters (trigger: a concrete need/customer for either vendor; interfaces already designed to support them)
- [ ] Capability-flag system (`supportsStreaming`, etc.) formalized beyond a simple boolean, if/when a genuinely streaming-capable STT/TTS vendor is added
- [ ] Reconciliation/cleanup of the orphaned legacy `LLMProvider`/`TTSProvider` in `mock.ts` (trigger: someone gets confused by the duplicate naming, or the `mock`/`openai` non-realtime packages need to be revived or removed)

### Future Consideration (v2+)

- [ ] True incremental streaming STT/TTS support, if/when a vendor that supports it is added to the validation set (defer until there's a real streaming-capable backend, not just because the ecosystem leaders support it)
- [ ] Token-budget-aware (tiktoken-style) history trimming generalized across vendors (defer — vendor-specific tokenizer differences make this a deeper problem than this milestone's scope)
- [ ] Multi-tenant auth/authorization layer for proxy endpoints (CONCERNS.md "Missing Critical Features" — orthogonal to this milestone's interface work, but worth flagging since the new Thonburian/JaiTTS proxy endpoints will inherit the same gap)
- [ ] Retry/backoff for transient network failures across STT/LLM/TTS HTTP clients (CONCERNS.md flags this as missing today; the new adapters should not inherit single-attempt fragility without at least flagging it for follow-up)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Core per-stage interfaces (VAD/STT/LLM/TTS) | HIGH | MEDIUM | P1 |
| Generic pipeline orchestrator | HIGH | MEDIUM | P1 |
| Beginner-friendly plain-object tool registration | HIGH | LOW | P1 |
| Shared `ToolExecutor` dedup | MEDIUM | LOW | P1 |
| Audio format/sample-rate contract decision | HIGH | LOW (decision) / MEDIUM (implementation) | P1 |
| Thonburian STT backend + adapter | HIGH | HIGH (Python ML service) | P1 |
| JaiTTS backend + adapter | HIGH | HIGH (Python ML service, voice-cloning pipeline) | P1 |
| Mixed-vendor end-to-end demo | HIGH | MEDIUM | P1 |
| Lipsync/analyser hook preserved generically across TTS vendors | HIGH (core differentiator) | MEDIUM | P1 |
| Per-stage config composition (replacing flat inheritance) | MEDIUM | LOW | P1 |
| Beginner documentation/examples | HIGH | LOW-MEDIUM | P1 |
| Streaming capability flags (boolean, simple) | LOW now / MEDIUM later | LOW | P2 |
| Bedrock/Gemini real adapters | MEDIUM (future-proofing signal) | HIGH | P3 |
| True incremental streaming STT/TTS | MEDIUM (latency UX) | HIGH | P3 |
| Token-budget-aware history trimming | LOW-MEDIUM | MEDIUM | P3 |
| Legacy `LLMProvider`/`TTSProvider` cleanup | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for this milestone (matches PROJECT.md Active requirements)
- P2: Should have, cheap to seed now (capability flags) even if not exercised until later
- P3: Explicitly deferred — matches PROJECT.md Out of Scope

## Competitor Feature Analysis

| Feature | Pipecat | LiveKit Agents | Vocode | Vapi | Khavee's Planned Approach |
|---------|---------|-----------------|--------|------|---------------------------|
| Pipeline composition model | `Pipeline` of `FrameProcessor`s, typed `Frame` objects flow through | Plugin-based; `stt.STT`/`tts.TTS` abstract base classes, agent session orchestrates | `StreamingConversation` orchestrates `Transcriber`/`Agent`/`Synthesizer` | Hosted/managed — no client-side pipeline composition exposed to developers | Generic orchestrator class taking `{vad, stt, llm, tts}` as constructor args — simpler than frame-based, closer to Vocode's component model, matching the existing `ProviderDeps` injection seam already in the codebase |
| Tool/function calling shape | `FunctionSchema`/`ToolsSchema`, supports "direct functions" (signature+docstring auto-extracted) | `@function_tool` decorator (Python) or object w/ Zod `parameters` (Node.js) | Agent-level custom logic, less standardized public tool API | JSON-schema `parameters` object + webhook-based `execute`-equivalent | Plain object `{name, description, parameters, handler}`, no decorators/Zod — strictly simpler than every researched competitor's TS/JS-facing API |
| Streaming support | Full incremental streaming, frame-by-frame | Full incremental streaming, sub-300ms STT targets cited | Streaming-first (`StreamingConversation` name implies it) | Managed, abstracts streaming away from developer | Explicitly NOT streaming this milestone — utterance-level HTTP only, an honest scope reduction matching the two validation backends' real capabilities |
| Audio format negotiation | Explicit `PipelineParams` sample-rate config + auto-resampling | Capability declarations per plugin, framework validates compatibility | Less explicit in public docs — handled within transcriber/synthesizer config | Hidden (managed service) | Needs an explicit, documented contract (decision pending) — closest models to follow are pipecat's resampling approach or LiveKit's capability-flag approach |
| Beginner DX target audience | Python-first, assumes comfort with async generators/frame types | Python and Node.js both, Node.js still requires Zod | Python, moderate complexity | No-code/low-code (visual + API), not really an SDK comparison | TypeScript-first, deliberately simpler tool API than any researched competitor's JS/TS surface — explicit differentiator |
| 3D avatar / lipsync integration | None | None | None | None | Already exists (VRM/GLB + MFCC/DTW phoneme detection) — must be preserved generically across the new TTS interface; this is khavee's actual moat, not present in any competitor researched |

## Sources

- [Pipeline & Frame Processing - Pipecat](https://docs.pipecat.ai/guides/learn/pipeline)
- [pipecat-ai/pipecat | DeepWiki](https://deepwiki.com/pipecat-ai/pipecat)
- [Frame processing in Pipecat: from pipeline fundamentals to custom video filters | Anam](https://anam.ai/blog/pipecat-frame-processing-guide)
- [Function Calling - Pipecat](https://docs.pipecat.ai/pipecat/learn/function-calling)
- [pipecat.adapters.schemas.tools_schema — pipecat-ai documentation](https://reference-server.pipecat.ai/en/latest/_modules/pipecat/adapters/schemas/tools_schema.html)
- [Text to Speech - Pipecat](https://docs.pipecat.ai/pipecat/learn/text-to-speech)
- [Consider setting transport input/output sample rate based on STT/TTS sample rates · Issue #928 · pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat/issues/928)
- [pipecat.services.tts_service — pipecat-ai documentation](https://reference-server.pipecat.ai/en/latest/api/pipecat.services.tts_service.html)
- [LLM Integration | livekit/agents | DeepWiki](https://deepwiki.com/livekit/agents/4-llm-integration)
- [Introduction | LiveKit Documentation](https://docs.livekit.io/agents/)
- [Voice Agent Architecture: STT, LLM, and TTS Pipelines Explained | LiveKit](https://livekit.com/blog/voice-agent-architecture-stt-llm-tts-pipelines-explained)
- [TTS and STT Plugins | livekit/agents | DeepWiki](https://deepwiki.com/livekit/agents/6-tts-and-stt-plugins)
- [TTS Provider Implementations | livekit/agents | DeepWiki](https://deepwiki.com/livekit/agents/6.2-tts-provider-implementations)
- [Function tools | LiveKit Documentation](https://docs.livekit.io/agents/logic/tools/definition/)
- [GitHub - vocodedev/vocode-core: Build voice-based LLM agents. Modular + open source.](https://github.com/vocodedev/vocode-core)
- [Fully local conversation - Vocode](https://docs.vocode.dev/open-source/local-conversation)
- [Custom Tools | Vapi](https://docs.vapi.ai/tools/custom-tools)
- [Introduction to Tools | Vapi](https://docs.vapi.ai/tools)
- [Function calling | OpenAI API](https://developers.openai.com/api/docs/guides/function-calling)
- [Voice AI Barge-In and Turn-Taking: A 2026 Implementation Guide](https://futureagi.com/blog/voice-ai-barge-in-turn-taking-2026/)
- [Sequential Pipeline Architecture for Voice Agents | LiveKit](https://livekit.com/blog/sequential-pipeline-architecture-voice-agents)
- Codebase analysis: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`, `.planning/PROJECT.md`, `packages/core/src/types/realtime.ts`, `packages/core/src/types/mock.ts`, `packages/providers/openai-stt-tts/src/ToolExecutor.ts`

---
*Feature research for: composable voice-AI pipeline provider abstraction (khavee-sdk generic-stt-tts milestone)*
*Researched: 2026-06-17*
