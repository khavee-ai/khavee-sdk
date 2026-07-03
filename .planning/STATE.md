---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: WordPress Plugin
status: executing
stopped_at: context exhaustion at 78% (2026-07-02)
last_updated: "2026-07-02T11:07:09.735Z"
last_activity: 2026-06-25 -- Phase 09 execution started
progress:
  total_phases: 9
  completed_phases: 8
  total_plans: 36
  completed_plans: 36
  percent: 89
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-21)

**Core value (v2.0):** A WordPress site owner can embed a working voice-chat VRM avatar on any page, fully self-configured in WP admin — no dependency on the hosted Khavee platform.
**Current focus:** Phase 09 — block-studio-visual-config-chat-lipsync

## Current Position

Phase: 09 (block-studio-visual-config-chat-lipsync) — EXECUTING
Plan: 1 of 6
Status: Executing Phase 09
Last activity: 2026-06-25 -- Phase 09 execution started

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 32 (15 v1.0 milestone Phases 1-4, + 4 v2.0 Phase 6)
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 3 | - | - |
| 2 | 7 | - | - |
| 3 | 2 | - | - |
| 4 | 3 | - | - |
| 6 | 4 | - | - |
| 06 | 4 | - | - |
| 07 | 5 | - | - |
| 8 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: 06-04, 07-01, 07-02, 07-03, 07-04
- Trend: Phase 7 (admin settings page) complete; gap-closure plan 07-04 closed a security-critical voice-allowlist bug (CR-01) and a defense-in-depth nonce gap (CR-02); a follow-up code review caught and fixed one more variant (CR-01-NEW — unvalidated existing-value fallback) in the same session before re-verification passed clean

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v2.0: WordPress plugin targets `OpenAIRealtimeProvider` (full-duplex WebRTC), not `generic-stt-tts` — matches the WP embedding use case shape
- v2.0: Custom mode only this milestone (self-configured); Platform mode is an explicit fast-follow blocked on a `khavee-app` backend addition
- v2.0: Config-source and token-provider logic built as swappable PHP strategies (`ConfigSourceInterface`, `TokenProviderInterface`) from the start, each with exactly one concrete implementation this milestone
- v2.0: PHP backend (Phase 6) sequenced first — proves the OpenAI ephemeral-token contract via `curl` before any JS exists, de-risking Phases 7-8
- v2.0: Frontend bundle work folded into Phase 8 (Render Layer) rather than its own phase — no standalone requirement maps to bundle infrastructure alone; it's consumed entirely by EMBED-05/PERF-01
- 06-04: OpenAI's `/v1/realtime/client_secrets` endpoint requires the session config nested under a top-level `session` key (not posted unwrapped) — confirmed via live curl against the real endpoint, fixed in `OpenAiDirectTokenProvider`
- 06-04: OpenAI's realtime session schema has no top-level `voice` field — voice only exists at `session.audio.output.voice`; `SessionController::apply_trust_model()` now strips any client-sent top-level `voice` and always forces the nested path
- 06-04: `wordpress-plugin/vendor/` is gitignored (Composer-regenerable); `composer.lock` is tracked despite zero current third-party deps, per application-package convention

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 5 (v1.0): VAD-loopback cooldown (currently a 500ms magic number tuned for OpenAI TTS) cannot be validated against JaiTTS until that service exists — must explicitly retest, not assume
- Phase 6: The public REST token route must be genuinely anonymous (`permission_callback => '__return_true'`) — WP nonce-based auth does not protect anonymous visitors and silently breaks under page caching; rate limiting/daily cap must be designed in from the first implementation, not retrofitted
- Phase 6: No official OpenAI documentation specifies per-IP/per-mint rate limits for the ephemeral-token endpoint — defensive rate-limiting design must be validated against actual OpenAI behavior at implementation time
- Phase 6: `src/app/api/negotiate/route.ts` is explicitly NOT the reference pattern for this route — it implements a different SDP-relay contract; the WP route must implement the ephemeral-token-minting (`useProxy`) contract instead
- Phase 7: VRM/GLB Media Library upload needs `upload_mimes` allow-listing AND binary magic-byte validation together — allow-list alone is a known disguised-file-upload vector
- Phase 8: WordPress core's currently-bundled React version was not verified during research — affects the bundle-isolation-vs-externalization decision; check Gutenberg/WP core changelog before finalizing build config
- Phase 8: Gutenberg block's `edit()` must use a separate `editorScript`/`viewScript` split — naively mounting the live SPA in the editor fires real mic prompts and OpenAI token mints on every admin keystroke

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260625-sqp | Wire up self-hosted auto-updates for wordpress-plugin via GitHub Releases (Plugin Update Checker + tag-triggered release workflow) | 2026-06-25 | d287f49 | [260625-sqp-wire-up-self-hosted-auto-updates-for-wor](./quick/260625-sqp-wire-up-self-hosted-auto-updates-for-wor/) |
| 260703-slv | Add Khavee Platform API key integration to WordPress plugin config resolution (PlatformConfigSource decorator over WpOptionsConfigSource) | 2026-07-03 | bf16df8 | [260703-slv-add-khavee-platform-api-key-integration-](./quick/260703-slv-add-khavee-platform-api-key-integration-/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-02T11:07:09.730Z
Stopped at: context exhaustion at 78% (2026-07-02)
Resume file: None

Last activity: 2026-07-03 - Completed quick task 260703-slv: Add Khavee Platform API key integration to WordPress plugin config resolution
</content>
