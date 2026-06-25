# Khavee Generic Voice Pipeline

## What This Is

khavee-sdk currently ships an `openai-stt-tts` provider that hardcodes the STT → LLM → TTS voice pipeline to OpenAI's APIs. This project adds a new `generic-stt-tts` provider package that decomposes the pipeline into swappable interfaces (VAD, STT, LLM/completion with tool-calling, TTS) — pipecat-style — so any vendor can be plugged into any stage. Two new lightweight backend services (Thonburian Whisper STT, JaiTTS voice-cloning TTS) are built to prove the abstraction end-to-end with real non-OpenAI vendors.

## Core Value

A developer can assemble a full voice pipeline (STT + LLM + TTS, with tool-calling) from independently swappable vendor adapters — without being locked into OpenAI for every stage.

## Current Milestone: v2.0 WordPress Plugin (Custom Mode)

**Goal:** Ship a khaveeai WordPress plugin that embeds a voice-chat VRM avatar on any WordPress site, fully self-configured in WP admin — no dependency on the hosted Khavee platform.

**Target features:**
- `[khaveeai_avatar]` shortcode and a Gutenberg block, both sharing one JS bundle and config shape
- Admin settings: OpenAI API key, personality/instruction textarea, voice picker, VRM/GLB avatar upload via Media Library
- WP REST route that mints an ephemeral OpenAI Realtime token server-side per session (the OpenAI key never reaches the browser)
- Config-source and token-provider logic structured as swappable strategies so a future platform-API-key mode can slot in without touching the JS bundle or rendering code (that mode itself is out of scope this milestone — it's blocked on a `khavee-app` backend addition)

## Requirements

### Validated

- ✓ STT → LLM completion → TTS pipeline pattern works end-to-end — existing (`openai-stt-tts`)
- ✓ VAD-based audio segmentation into utterances — existing (`AudioRecorder.ts`)
- ✓ Tool/function-calling execution loop — existing (`ToolExecutor.ts`, duplicated across `openai-stt-tts` and `openai-realtime`)
- ✓ React hook integration for realtime voice UI (lipsync, status) — existing (`packages/react`)
- ✓ Define core provider interfaces: STTProvider, TTSProvider, VADProvider, and an LLMProvider with tool-calling support — Validated in Phase 1 (`packages/core/src/types/pipeline.ts`)
- ✓ Beginner-friendly tool-calling API: plain object `{ name, description, parameters, handler }` — Validated in Phase 1 (`packages/core/src/types/tools.ts`)
- ✓ Promote/dedupe the existing `ToolExecutor` into `packages/core`, adapted to the new generic LLMProvider interface — Validated in Phase 1 (CORE-05; both provider packages now re-export from `@khaveeai/core` for backward compatibility)
- ✓ Build a generic pipeline orchestrator that composes any combination of these interfaces (pipecat-style) — Validated in Phase 2 (`GenericPipelineProvider`)
- ✓ New `packages/providers/generic-stt-tts` package implementing the orchestrator + interfaces — Validated in Phase 2
- ✓ New `thonburian-stt` backend service: Python server wrapping `biodatlab/whisper-th-large-v3-combined` (Thonburian Whisper v3), simple HTTP endpoint, audio in → Thai text out — Validated in Phase 3 (BACK-01, BACK-05 load-once half; BACK-02 explicitly deferred per D-01)
- ✓ New `jai-tts` backend service: Python server wrapping `JTS-AI/JaiTTS-F5TTS` via F5-TTS's FlowTTSPipeline, bundled default Thai reference voice, simple HTTP endpoint, text in → WAV audio out — Validated in Phase 3 (BACK-03, BACK-04, BACK-05 load-once half; BACK-05 semaphore half explicitly deferred per D-01)
- ✓ WP REST ephemeral-token route (PHP equivalent of `src/app/api/negotiate/route.ts`) so the OpenAI key never reaches the browser — Validated in Phase 6 (`SessionController` at `POST khaveeai/v1/session`; REST-01..04). Live-verified against a real WordPress install + real OpenAI key.
- ✓ Config-source / token-provider seam in the plugin's PHP code, structured so a future platform-API-key mode can be added without touching the JS bundle — Validated in Phase 6 (ARCH-01/02: `ConfigSourceInterface`/`WpOptionsConfigSource`, `TokenProviderInterface`/`OpenAiDirectTokenProvider`; `SessionController` depends only on the interfaces)
- ✓ WP Settings API admin page for API key (masked redisplay), personality/instructions, voice picker, and VRM/GLB avatar upload via Media Library, gated behind `manage_options` and reading/writing exclusively through `ConfigSourceInterface` — Validated in Phase 7 (SET-01..06, ASSET-01). Includes server-side magic-byte content validation rejecting disguised non-glTF files, and a `manage_options`+page-match GET-render condition that widens Plupload's client-side `glb`/`vrm` allowlist without weakening the nonce-gated upload-POST validation (07-05 gap closure, closing 07-UAT.md Test 5).
- ✓ WordPress plugin frontend bundle, shortcode (`[khaveeai_avatar]`), and Gutenberg block (`khaveeai/avatar`), both rendering through one shared `AvatarRenderer`/`AssetManager` path, conditionally enqueued only on pages that use them, with per-instance voice/instructions/avatar overrides validated server-side and an admin-notice/visitor-placeholder split when unconfigured — Validated in Phase 8 (EMBED-01..05, PERF-01). This completes all four target features of the v2.0 milestone.

### Active

- [ ] khavee-sdk adapter classes (e.g. ThonburianSTTProvider, JaiTTSProvider) implementing the new interfaces, talking to these two services over streaming-chunked HTTP — belongs to the earlier generic-pipeline scope (Phase 5), not v2.0; left "Not started" when v2.0 was prioritized ahead of it
- [ ] End-to-end demo: generic-stt-tts pipeline using Thonburian STT + an LLM + JaiTTS, proving STT/TTS can come from different, non-OpenAI, mixed vendors with tool-calling working — same Phase 5 scope, still pending
- [ ] Documentation/examples showing how a beginner wires up a custom STT/TTS vendor and registers a tool — same Phase 5 scope, still pending
- [ ] Two browser-only manual checks (real mic-permission-dialog click, WebGL avatar visual quality) from Phase 8 — tracked in `08-HUMAN-UAT.md`, not blocking, run `/gsd:verify-work 8` to close out

### Out of Scope

- Refactoring `openai-stt-tts` onto the new interfaces — left untouched this milestone, may migrate later
- Real AWS Bedrock STT and Google Gemini TTS adapters — only used as illustrative examples; interfaces must support them later but no adapters are built now
- `openai-realtime`'s full-duplex WebRTC provider — separate concern, not modified by the generic-stt-tts work (it IS the provider the WordPress plugin embeds)
- True streaming (partial/incremental) transcription or synthesis — neither Thonburian Whisper nor JaiTTS support it natively; utterances are VAD-segmented and sent whole over HTTP
- Resolving the empty `packages/providers/azure` placeholder — unrelated pre-existing debt
- WordPress plugin "Platform mode" (API-key-driven config pulled from the hosted `khavee-app` dashboard) — blocked on a new API-key-gated ephemeral-token endpoint in `khavee-app` that doesn't exist yet; explicit fast-follow, not this milestone
- `khavee-app` platform changes of any kind — separate repo/codebase, out of scope for khavee-sdk milestones

## Context

- khavee-sdk is a pnpm monorepo: Next.js 15 demo app + `@khaveeai/core`, `@khaveeai/react`, and provider packages under `packages/providers/`.
- The existing `openai-stt-tts` provider (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`) already decomposes its pipeline into 4 concrete classes — `AudioRecorder` (VAD), `STTClient`, `ChatClient` (LLM), `TTSPlayer` — wired together in the constructor with a `ProviderDeps` injection seam currently only used by tests. This is the natural pattern to generalize into interfaces.
- The single seam the rest of the SDK depends on today is `RealtimeProvider` in `packages/core/src/types/realtime.ts`.
- `ToolExecutor.ts` is duplicated byte-for-byte between `openai-stt-tts` and `openai-realtime` (flagged in `.planning/codebase/CONCERNS.md`) — dedup target during this work.
- An orphaned legacy `LLMProvider`/`TTSProvider` abstraction already exists in `packages/core/src/types/mock.ts`, unrelated to `RealtimeProvider` and not wired into any current hook — should not be confused with the new interfaces being designed here; may need cleanup or reconciliation.
- `thonburian-stt` and `jai-tts` (`/Users/whitemalt/Documents/thonburian-stt`, `/Users/whitemalt/Documents/jai-tts`) are now scaffolded FastAPI services (Phase 3) — sibling repos to khavee-sdk, no `.git` of their own yet, each with `main.py`/`requirements.txt`/`README.md`. `thonburian-stt` runs on port 8001, `jai-tts` on port 8002.
- Thonburian Whisper: `biodatlab/whisper-th-large-v3-combined` on Hugging Face, run via `transformers.pipeline("automatic-speech-recognition", ...)`, supports `chunk_length_s` for longer audio, Apache 2.0.
- JaiTTS: the GitHub repo (`JTS-AI-Team/JaiTTS`) is benchmark/eval code only — no deployable server. The actual model is `JTS-AI/JaiTTS-F5TTS` on Hugging Face, an F5-TTS-based Thai voice-cloning model with a custom XLM-R duration predictor, run via a `FlowTTSPipeline` from the `biodatlab/thonburian-tts` inference repo (the `flowtts` package). **Phase 3 finding:** that repo's PyPI/git packaging is broken (no `__init__.py` files, so `pip install git+...` silently installs no actual source) — the working install requires cloning the repo, adding empty `__init__.py` markers, then installing the patched local clone (documented in `jai-tts/README.md`). The verified `FlowTTSPipeline` API is a callable `__call__(text, ref_voice, output_file, ref_text, speed, check_duration) -> filepath`, not the `.generate()` shown on the HF model card. Default reference voice is a Google FLEURS (CC BY 4.0) clip, bundled at `jai-tts/assets/`.
- Communication protocol decided: streaming-chunked HTTP — SDK buffers VAD-segmented utterances and POSTs each one to the backend service, rather than persistent WebSocket streaming (neither model supports true incremental/partial streaming).
- `wordpress-plugin/includes` and `wordpress-plugin/src` are pre-existing but completely empty scaffold directories — no plugin header file, no PHP, no build tooling yet. Greenfield build.
- There is a separate hosted platform monorepo, `khavee-app` (NestJS `apps/api` + dashboard `apps/web` + `packages/db`), with its own "project" concept (model, personality, voice profile) and an `X-API-Key`-authenticated `KhaveeClient` in `@khaveeai/core` (currently zero consumers in khavee-sdk). The platform API key is single-tier/secret (full project-owner access, no publishable variant) and must never reach a browser. Its existing ephemeral-token minting (`ChatTokenService`) is JWT-session-gated only — there is no API-key-authenticated path for anonymous embedded widgets yet. That gap is what blocks the future "Platform mode" for this plugin.

## Constraints

- **Compatibility**: Must not break the existing `openai-stt-tts` provider or its consumers — it stays as-is, untouched, this milestone
- **Language boundary**: `thonburian-stt` and `jai-tts` are Python ML services; khavee-sdk is TypeScript — integration is over HTTP, not in-process bindings
- **Beginner DX**: Tool-calling API must be usable by a beginner with no extra schema library — plain JS objects only
- **Vendor neutrality**: Core interfaces (STTProvider, TTSProvider, VADProvider, LLMProvider) must be vendor-agnostic enough to support future Bedrock/Gemini adapters without redesign, even though those adapters aren't built now

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| New `generic-stt-tts` package instead of refactoring `openai-stt-tts` | Avoids risking the existing, working OpenAI provider; proves abstraction in isolation first | — Pending |
| Tool-calling: plain object + handler (no Zod/decorators) | Matches JSON-schema shape every LLM vendor's tool-calling API already expects; zero added dependency; simplest for beginners | — Pending |
| Tool-calling is a core LLMProvider capability, not per-provider opt-in | Bedrock/Gemini providers built later just implement it instead of needing a retrofit | — Pending |
| Promote/dedupe existing `ToolExecutor.ts` into `packages/core` | Already duplicated byte-for-byte across two packages (flagged in CONCERNS.md); reuse over rewrite | — Pending |
| STT/TTS backend protocol: streaming-chunked HTTP, not WebSocket | Neither Whisper nor F5-TTS-based JaiTTS support true incremental/partial transcription or synthesis — utterance-at-a-time HTTP matches reality | Validated in Phase 3 (`POST /transcribe`, `POST /synthesize`) |
| BACK-02 (hallucination rejection) and BACK-05's semaphore half deferred for Phase 3 | Demo-scoped proof of the SDK abstraction, not production-hardening; threshold tuning/semaphore sizing not worth it yet | Deferred — tracked in REQUIREMENTS.md, revisit if this moves past demo use |
| Bedrock and Gemini adapters out of scope this milestone | They were illustrative of "any vendor" — Thonburian + JaiTTS are the real proof vendors; interface design alone must keep the door open | — Pending |
| WordPress plugin targets `OpenAIRealtimeProvider`, not `generic-stt-tts` | WP embedding is a full-duplex voice chat widget use case (WebRTC), matching the existing realtime provider's shape, not the segmented STT/LLM/TTS pipeline | — Pending |
| WordPress plugin v2.0 ships "Custom mode" only (self-configured: own OpenAI key, instructions, voice, avatar upload); "Platform mode" (API-key-driven config from `khavee-app`) is an explicit fast-follow | Custom mode has zero cross-repo dependency and can ship now; Platform mode is blocked on a new API-key-gated ephemeral-token endpoint that doesn't exist yet in `khavee-app` | — Pending |
| Plugin's config-source and token-provider logic built as swappable PHP strategies from the start | Lets Platform mode slot in later without touching the JS bundle or rendering code | Validated in Phase 6 — `ConfigSourceInterface`/`TokenProviderInterface`, exactly one concrete implementation each, `SessionController` depends only on the interfaces |
| Shortcode and Gutenberg block share one `AvatarRenderer::render()` path instead of independent rendering logic | EMBED-04 parity requirement; avoids two divergent override-merge implementations | Validated in Phase 8 — `AvatarShortcode`/`AvatarBlock` both delegate to the same `Plugin.php`-constructed `$renderer` instance |
| Gutenberg block uses PHP `render_callback` (ServerSideRender), not `block.json`'s `viewScript` | A documented WordPress Core dynamic-block bug drops `viewScript` unreliably; `render_callback` also structurally guarantees the editor preview can never load the SPA bundle (EMBED-05) | Validated in Phase 8 — confirmed live: the real `wp/v2/block-renderer` REST response contains no `<script>` tag and no session/token code |
| Per-instance voice/instructions overrides validated against the actual `sessionConfig` fields the bundle already sends (`audio.output.voice`, `instructions`), not a new wire field | `OpenAIRealtimeProvider.connect()` is out of scope to modify and takes no arguments — overrides must ride fields already in the real request | Validated in Phase 8 — `SessionController::apply_trust_model()`, fail-closed allowlist/cap validation, multi-byte-safe (`mb_strlen`) length check |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-25 — Phase 8 complete (frontend bundle, shortcode, Gutenberg block). All four v2.0 "WordPress Plugin (Custom Mode)" target features are now done. Note: Phase 5 (End-to-End Mixed-Vendor Demo & Documentation) remains "Not started" — it belongs to the earlier generic-pipeline scope, not v2.0, and was left pending when v2.0 was prioritized ahead of it.*
