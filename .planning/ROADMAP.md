# Roadmap: Khavee Generic Voice Pipeline

## Milestones

- ✅ **v1.0 Generic Voice Pipeline** - Phases 1-5 (Phase 5 in progress)
- 🚧 **v2.0 WordPress Plugin (Custom Mode)** - Phases 6-8 (Phase 6 complete)

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 Generic Voice Pipeline (Phases 1-5)</summary>

- [x] **Phase 1: Core Interfaces & Tool-Calling** - Define vendor-neutral VAD/STT/LLM/TTS interfaces and a redesigned, shared ToolExecutor in `@khaveeai/core` (completed 2026-06-17)
- [x] **Phase 2: Generic Pipeline Orchestrator** - Build the `{vad, stt, llm, tts, tools}`-composing orchestrator that implements `RealtimeProvider` (completed 2026-06-18)
- [x] **Phase 3: Python Backend Services** - Scaffold and harden `thonburian-stt` and `jai-tts` as standalone FastAPI services (completed 2026-06-19)
- [x] **Phase 4: Vendor Adapters & Audio Contract** - Build thin HTTP adapter classes and pin the audio wire format with a round-trip test (completed 2026-06-19)
- [ ] **Phase 5: End-to-End Mixed-Vendor Demo & Documentation** - Wire everything into a working mixed-vendor demo with tool-calling, plus beginner docs

</details>

### v2.0 WordPress Plugin (Custom Mode)

- [x] **Phase 6: PHP Backend Core — Config/Token Strategies + REST Contract** - Build the `ConfigSourceInterface`/`TokenProviderInterface` strategy seam and a public, abuse-resistant REST route that mints OpenAI ephemeral tokens server-side (completed 2026-06-23)
- [x] **Phase 7: Admin Settings Page** - WP Settings API page for API key, instructions, voice, and VRM/GLB avatar upload, reading/writing exclusively through `ConfigSourceInterface` (completed 2026-06-24)
- [ ] **Phase 8: Frontend Bundle, Shortcode & Block** - Bundled React SPA embedding the existing `OpenAIRealtimeProvider` + VRM avatar, surfaced via a shared-render-path shortcode and Gutenberg block, enqueued only where used

## Phase Details

### Phase 1: Core Interfaces & Tool-Calling

**Goal**: `@khaveeai/core` exposes a fixed, vendor-neutral contract (four provider interfaces plus tool-calling types) that every later phase builds against without redesign
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06
**Success Criteria** (what must be TRUE):

  1. `VADProvider`, `STTProvider`, `LLMProvider`, and `TTSProvider` interfaces exist in `@khaveeai/core` and each declares capability flags (e.g. `supportsStreaming`) usable by a branching consumer
  2. A developer can register a tool by passing a plain object `{name, description, parameters, handler}` to a single `addTool()`-style call — no Zod, no decorators, no schema library import required
  3. Tool-call results are normalized to one shape (`{success, message}`) regardless of which LLM vendor produced the call, verified by a unit test exercising at least two differently-shaped mock vendor responses
  4. `ToolExecutor` exists once in `@khaveeai/core` (no byte-for-byte duplicate remains in `openai-stt-tts` or `openai-realtime`) and both existing packages compile/test green against the promoted version
  5. A written sketch (code comment or design note) demonstrates how a non-OpenAI vendor (Anthropic- or Gemini-shaped multi-tool-call round trip) maps onto the `LLMProvider` interface without needing OpenAI-specific field names like `tool_call_id`

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Promote ToolExecutor to core + Tool/ToolResult types + vitest infra + CORE-04 normalization test

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Four pipeline-stage interfaces + capability flags + vendor-neutral ToolCall + multi-vendor sketch + mock.ts collision rename
- [x] 01-03-PLAN.md — Delete duplicate ToolExecutors, repoint both providers to core, verify builds/tests green

### Phase 2: Generic Pipeline Orchestrator

**Goal**: A developer can assemble a complete voice pipeline from any combination of the Phase 1 interfaces using one orchestrator class, with no changes required in `@khaveeai/react`
**Depends on**: Phase 1
**Requirements**: ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05
**Success Criteria** (what must be TRUE):

  1. A developer can construct a working pipeline by passing `{vad, stt, llm, tts, tools}` to a single generic orchestrator class
  2. The orchestrator implements `RealtimeProvider` and runs unmodified through `@khaveeai/react`'s existing hook, verified by exercising it with adapted existing OpenAI helper classes (`STTClient`, `ChatClient`, `TTSPlayer`) as stand-in implementations
  3. Triggering new user speech mid-turn cancels in-flight LLM/TTS work via an `AbortSignal`-style hook, observable as the in-progress response stopping rather than completing
  4. The VAD-to-mic-reopen cooldown is set via a constructor/config value (not a hardcoded constant), and changing it changes observed mic-reopen timing
  5. A provider throwing or rejecting with a non-Error value (e.g. a string or vendor-specific error object) reaches the orchestrator's error callback as a normalized `Error` instance without crashing the active session

**Plans**: 7 plans
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — D-01 signal? on pipeline interfaces + additive helper-class exports from openai-stt-tts + scaffold the generic-stt-tts package

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Four OpenAI adapter classes (VAD/STT/LLM/TTS) wrapping the existing helpers, with tools+signal+tool_calls in the LLM adapter

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — GenericPipelineProvider orchestrator (barge-in, tool loop, config cooldown, error normalization) + adapter integration test + barrel exports

**Wave 4** *(gap closure — ORCH-03 BLOCKED → SATISFIED)*

- [x] 02-04-PLAN.md — Close ORCH-03 gap: fix CR-01 (abort guards in runTurnFromText + runTurn) and CR-02 (sendMessage AbortController ownership) + regression tests for stale-utterance discard and sendMessage-vs-concurrent-VAD coordination

**Wave 5** *(gap closure — GAP-02-05 registerFunction silent no-op)*

- [x] 02-05-PLAN.md — Close GAP-02-05: registerFunction() now appends a RealtimeTool→Tool-converted entry to a runtime tool list so post-construction tools are offered to the LLM (not just registered for dispatch) + regression test asserting the tool appears in the tools sent to llm.complete()

**Wave 6** *(gap closure — CR-03 multi-round tool-calling protocol violation)*

- [x] 02-06-PLAN.md — Close CR-03: tool-calling loop pushes the LLM's assistant/tool_calls turn into history (as an `[assistant_tool_calls] <json>` marker) before tool-result markers, and OpenAILLMAdapter.mapMessage() re-emits it as OpenAI's `{role:"assistant", content:null, tool_calls:[...]}` wire shape — fixing HTTP 400 on round 2+ of any real tool-calling conversation + orchestrator regression test (inspects round-2 args.messages) + adapter wire-shape unit test

**Wave 7** *(gap closure — WR-05/WR-06 marker-protocol robustness, post-02-06 code review)*

- [x] 02-07-PLAN.md — Close WR-05 + WR-06: make trimHistory() marker-pair-aware so the trim boundary never strands a `[tool_result ...]` message without its `[assistant_tool_calls]` predecessor (WR-05, reintroduces CR-03's HTTP-400 across long sessions); gate OpenAILLMAdapter.mapMessage()'s marker branches on message.role + wrap the assistant-branch JSON.parse in try/catch so ordinary user text starting with a marker prefix no longer crashes the turn (WR-06) + two regression tests

### Phase 3: Python Backend Services

**Goal**: Two standalone, production-shaped Python services exist (outside the khavee-sdk repo) that turn audio into Thai text and Thai text into audio, safely under concurrent load
**Depends on**: Nothing (independent of Phases 1-2; only needs the HTTP contract agreed, not built)
**Requirements**: BACK-01, BACK-02, BACK-03, BACK-04, BACK-05
**Success Criteria** (what must be TRUE):

  1. POSTing a Thai-speech audio utterance to `thonburian-stt` (at `/Users/whitemalt/Documents/thonburian-stt`) returns the correct Thai transcription text using `biodatlab/whisper-th-large-v3-combined` (or its base variant)
  2. POSTing a short or silent audio segment to `thonburian-stt` returns a distinguishable no-speech/rejected result rather than a hallucinated transcription treated as valid speech
  3. POSTing Thai text to `jai-tts` (at `/Users/whitemalt/Documents/jai-tts`) returns synthesized, audibly-correct WAV audio using the JaiTTS-F5TTS voice-cloning model
  4. Calling `jai-tts` with text alone (no reference audio supplied) succeeds and produces speech in the bundled default Thai reference voice
  5. Both services load their model exactly once at startup (not per-request) and reject or queue concurrent requests beyond a configured limit (e.g. semaphore) instead of crashing under concurrent load
     *(Note: the semaphore/concurrency-gating half of this criterion is descoped for Phase 3 per CONTEXT.md D-01 — only model-load-once is implemented; BACK-02 hallucination rejection is likewise deferred.)*

**Plans**: 2 plans
Plans:
**Wave 1** *(both services are independent sibling repos with zero file overlap — fully parallel)*

- [x] 03-01-PLAN.md — thonburian-stt FastAPI service: lifespan model-load-once (CUDA→MPS→CPU) + POST /transcribe (multipart→{"text"}) using biodatlab/whisper-th-large-v3-combined; BACK-01, BACK-02 (deferral documented), BACK-05 (load-once half)
- [x] 03-02-PLAN.md — jai-tts FastAPI service: flowtts git-install trust-boundary checkpoint + license-verified default Thai reference voice + FlowTTSPipeline signature verification + POST /synthesize (JSON text→raw WAV bytes); BACK-03, BACK-04, BACK-05 (load-once half)

### Phase 4: Generic Demo Page

**Goal**: A Next.js demo page uses GenericPipelineProvider with JaiTTS/Thonburian as STT/TTS backends, proving the generic pipeline works end-to-end with non-OpenAI vendors. Adapter glue code lives in the demo app (not exported from SDK).
**Depends on**: Phase 1, Phase 2, Phase 3
**Requirements**: ADPT-01, ADPT-02, ADPT-03
**Success Criteria** (what must be TRUE):

  1. A Next.js demo page exists (e.g., `/generic-demo`) that wires `GenericPipelineProvider` with demo-local adapter implementations for STT (POST to `thonburian-stt` /transcribe) and TTS (POST to `jai-tts` /synthesize)
  2. Running the demo executes a full voice turn — speech in via VAD, transcription via Thonburian STT, completion via an LLM, speech out via JaiTTS — and the audio played back is recognizably correct Thai speech
  3. The audio wire format (sample rate, encoding, channels) for both directions is documented in a code comment or README section, and a round-trip test (encode → POST → decode → assert format) passes for both services

**Plans**: 3 plans
Plans:
**Wave 1** *(demo-local STT/TTS adapters — no file overlap)*

- [x] 04-01-PLAN.md — Thonburian STT adapter in demo app (src/app/generic-demo/adapters/ThonburianSTTAdapter.ts) posting multipart "file" to thonburian-stt /transcribe, 60s timeout + demo page scaffold with GenericPipelineProvider wiring (ADPT-01)
- [x] 04-02-PLAN.md — JaiTTS adapter in demo app (src/app/generic-demo/adapters/JaiTTSAdapter.ts) POSTing {text} JSON to jai-tts /synthesize, WAV decode/playback via Web Audio API, AbortSignal timeout + integrate with demo page (ADPT-02)

**Wave 2** *(blocked on Wave 1 — both adapters must work)*

- [x] 04-03-PLAN.md — Audio wire format documentation + round-trip test script + demo page polish (UI, VAD cooldown tuning, LLM provider wiring) (ADPT-03)

### Phase 5: End-to-End Mixed-Vendor Demo & Documentation

**Goal**: A real user can run one voice conversation that proves STT and TTS come from different non-OpenAI vendors simultaneously, with tool-calling working, and a beginner can repeat the pattern with their own vendor
**Depends on**: Phase 2, Phase 4
**Requirements**: ADPT-04, ADPT-05
**Success Criteria** (what must be TRUE):

  1. Running the demo executes a full voice turn — speech in via VAD, transcription via Thonburian STT, completion via an LLM, speech out via JaiTTS — and the audio played back is recognizably correct Thai speech
  2. The same demo session includes at least one registered tool that the LLM calls and whose result is reflected in the assistant's next reply
  3. The VAD-to-mic-reopen cooldown is validated (and adjusted via the Phase 2 config knob if needed) against JaiTTS's actual audio playback tail, not left at the value tuned for OpenAI's TTS
  4. Documentation/example exists showing a beginner how to implement a new custom `STTProvider` or `TTSProvider` and register a tool, using only the patterns established in Phases 1-4, with no missing steps when followed fresh

**Plans**: TBD

### Phase 6: PHP Backend Core — Config/Token Strategies + REST Contract

**Goal**: A WordPress site can mint a real OpenAI Realtime ephemeral token for an anonymous visitor over a `curl`-testable REST route, with the OpenAI API key never leaving the server, and the config/token logic structured so a future platform-driven implementation can swap in later without touching this contract
**Depends on**: Nothing (first phase of v2.0; greenfield plugin code)
**Requirements**: ARCH-01, ARCH-02, REST-01, REST-02, REST-03, REST-04
**Success Criteria** (what must be TRUE):

  1. `curl`-ing the WP REST token route as an anonymous (logged-out) request returns a valid ephemeral OpenAI Realtime token in the response body, with no WP login/nonce required
  2. The OpenAI API key never appears in any REST response body, HTTP header, or page source — confirmed by inspecting the route's response payload
  3. Repeated rapid requests from the same IP are throttled (HTTP 429 or equivalent) once a per-IP rate limit and daily mint cap are exceeded, rather than minting unlimited tokens
  4. The token route's HTTP response includes `Cache-Control: no-store`, confirmed by inspecting response headers
  5. Config retrieval (API key, instructions, voice, avatar URL) and token minting are each implemented behind a swappable interface (`ConfigSourceInterface`, `TokenProviderInterface`) with exactly one concrete implementation each, demonstrated by the REST controller depending only on the interfaces, not concrete classes

**Plans**: 4 plans
Plans:
**Wave 1** *(two independent strategy seams — no file overlap)*

- [x] 06-01-PLAN.md — ConfigSourceInterface + WpOptionsConfigSource (ARCH-01) + plugin bootstrap + Composer PSR-4 autoload
- [x] 06-02-PLAN.md — TokenProviderInterface + OpenAiDirectTokenProvider (ARCH-02): wp_remote_post to client_secrets, value->ephemeralToken remap, detail-free failure normalization + standalone harness

**Wave 2** *(blocked on Wave 1 — needs both interfaces)*

- [x] 06-03-PLAN.md — RateLimiter (per-IP 5/10min + sitewide 200/day) + SessionController (wire contract, D-07 trust model, 429/502/503, Cache-Control: no-store) + Plugin.php composition root (REST-01..04)

**Wave 3** *(blocked on Wave 2 — live verification checkpoint)*

- [x] 06-04-PLAN.md — curl-verify.sh exercising the four observable REST criteria + human checkpoint against a live WP install with a real OpenAI key (live verification surfaced and fixed 2 real wire-contract bugs: unwrapped client_secrets body, invalid top-level voice field)

**UI hint**: yes

### Phase 7: Admin Settings Page

**Goal**: A WordPress admin can fully configure the avatar (API key, personality, voice, avatar file) from one WP Settings API page, with the saved configuration immediately readable by Phase 6's `ConfigSourceInterface`
**Depends on**: Phase 6 (reads/writes through `ConfigSourceInterface`/`WpOptionsConfigSource`)
**Requirements**: SET-01, SET-02, SET-03, SET-04, SET-05, SET-06, ASSET-01
**Success Criteria** (what must be TRUE):

  1. An admin can enter an OpenAI API key on the settings page, save it, and on page reload see it redisplayed masked (e.g. `sk-••••••1234`) rather than in full
  2. An admin can enter personality/instruction text in a textarea, select a voice from a dropdown, and upload a `.vrm` or `.glb` file via the WP Media Library — all three persist after save and reload
  3. A non-admin user (lacking `manage_options`) cannot see the settings menu item and cannot successfully render the settings page even by navigating directly to its URL
  4. Uploading a renamed non-VRM/GLB file (correct extension, wrong binary content) through the avatar picker is rejected rather than accepted into the Media Library
  5. When the API key is unset, the settings page shows a "not configured" status banner, and `ConfigSourceInterface` exposes an `is_configured()` contract (consumed by that banner and reusable by the Phase 8 frontend embed). *(The frontend-embed half — an admin-only inline notice and a logged-out-visitor neutral placeholder on a page with the embedded avatar — is Phase 8 scope; see Phase 8 Success Criterion 6.)*

**Plans**: 5 plans
Plans:
**Wave 1**

- [x] 07-01-PLAN.md — ConfigSourceInterface.is_configured() + WpOptionsConfigSource avatar attachment-ID read resolution + bare-PHP harness (SET-06) [ALREADY WRITTEN — finalized by prior planner run]

**Wave 2** *(blocked on Wave 1 — consumes the is_configured() contract + avatar_attachment_id field)*

- [x] 07-02-PLAN.md — SettingsPage.php (top-level menu, capability gate at menu + render callback, masked-resave-safe API key, voice dropdown, instructions textarea, is_configured "not configured" banner) + Plugin.php composition-root wiring + FixtureConfigSource repair + harness masking/sanitize cases (SET-01, SET-02, SET-03, SET-05)

**Wave 3** *(blocked on Wave 2 — inserts into SettingsPage.php at 07-02's marked avatar-field site)*

- [x] 07-03-PLAN.md — Avatar field + two-filter (upload_mimes + wp_check_filetype_and_ext) content validation scoped via admin_init + Referer-check (revised from the originally planned load-<hook_suffix> after live wp-env testing falsified that approach) to cover BOTH wp.media's async-upload.php AJAX path AND options.php save (resolves Open Question 2 / A2) + 50MB limit + Remove-avatar control + human-verify checkpoint against a live WP install (SET-04, SET-05, ASSET-01)

**Wave 4** *(gap closure — CR-01/CR-02 from 07-REVIEW.md/07-VERIFICATION.md + ROADMAP Criterion 5 wording)*

- [x] 07-04-PLAN.md — Close CR-01 (enforce self::VOICES allowlist on the persisted voice value) + CR-02 (add a verifiable nonce to the upload-filter activation gate, fail-closed, keeping admin_init + Referer; no load-<hook_suffix> regression) + correct ROADMAP Phase 7 Success Criterion 5 wording (SET-03, ASSET-01, SET-06) (completed 2026-06-24)

**Wave 5** *(gap closure — UAT Test 5: every valid .glb/.vrm avatar upload rejected client-side by Plupload; root-caused in .planning/debug/avatar-upload-rejected.md)*

- [ ] 07-05-PLAN.md — Separate the upload_mimes filter (widens Plupload's client-side extension allowlist; register at settings-page GET render under manage_options + page match) from the nonce-gated wp_check_filetype_and_ext magic-byte filter (ASSET-01, stays on the upload POST per CR-02/07-04); admin_init + Referer + shutdown preserved, load-<hook_suffix> not reintroduced; live wp-env human-verify checkpoint (valid upload succeeds + disguised file still rejected) (SET-04, ASSET-01)

**UI hint**: yes

### Phase 8: Frontend Bundle, Shortcode & Block

**Goal**: A site owner can embed a fully working voice-chat VRM avatar on any page via shortcode or Gutenberg block, using one shared bundle and shared attribute-resolution logic, loaded only where actually used
**Depends on**: Phase 6 (REST contract + bootstrap shape), Phase 7 (settings provide the default config the bundle renders against)
**Requirements**: EMBED-01, EMBED-02, EMBED-03, EMBED-04, EMBED-05, PERF-01
**Success Criteria** (what must be TRUE):

  1. Placing `[khaveeai_avatar]` in any post/page editor (classic editor, block editor, or a page builder's shortcode/HTML widget) renders a working voice-chat VRM avatar on the published page
  2. A shortcode instance with explicit `voice`/`instructions`/`avatar` attributes overrides the global settings for that instance only, while an instance with no attributes falls back to the global settings
  3. Inserting the equivalent Gutenberg block and setting its inspector controls produces the same rendered output and override behavior as the shortcode with matching attributes
  4. Opening the Gutenberg block in the editor never triggers a microphone permission prompt or a real OpenAI token request — only viewing the published front-end page does
  5. The avatar bundle's JS/CSS assets are present in the page source on a page containing the shortcode/block, and absent from the page source on a page that does not
  6. When the API key is unset or invalid, an admin viewing a page with the embedded avatar sees an inline notice identifying the problem, while a logged-out visitor sees a neutral placeholder instead of a broken widget or console error *(the frontend-embed half of the SET-06 split; Phase 7 delivers the `is_configured()` contract + settings-page banner this builds on)*

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

(Phase 2 may be planned/executed in parallel with Phase 3 once Phase 1 is complete, per research — both depend only on Phase 1, not on each other. Phase 8's frontend bundle work can start once Phase 6's REST contract shape is fixed, in parallel with Phase 7, per v2.0 research.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Interfaces & Tool-Calling | 3/3 | Complete | 2026-06-17 |
| 2. Generic Pipeline Orchestrator | 7/7 | Complete | 2026-06-18 |
| 3. Python Backend Services | 2/2 | Complete | 2026-06-19 |
| 4. Vendor Adapters & Audio Contract | 3/3 | Complete | 2026-06-19 |
| 5. End-to-End Mixed-Vendor Demo & Documentation | 0/TBD | Not started | - |
| 6. PHP Backend Core — Config/Token Strategies + REST Contract | 4/4 | Complete | 2026-06-23 |
| 7. Admin Settings Page | 4/4 | Complete   | 2026-06-24 |
| 8. Frontend Bundle, Shortcode & Block | 0/TBD | Not started | - |
