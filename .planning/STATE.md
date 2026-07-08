---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: WordPress Plugin
status: executing
stopped_at: context exhaustion at 75% (2026-07-07)
last_updated: "2026-07-07T09:12:18.091Z"
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

- *(none — the Settings page follow-up fix chain (260707-0u6 → 260707-oyu → 260707-wa2 → 260708-0rs → 260708-16h) is closed; all issues from the user's live re-test are now live-verified resolved, including a latent shared-VRM-scene bug in `@khaveeai/react` that the sizing fix incidentally surfaced)*
- Single-instance regression check for the 260708-16h VRMAvatar fix (per-instance GLTFLoader.parseAsync replacing drei's useGLTF) was not live-verified against the main Next.js demo app in this session (no dev server confirmed running) — architecturally low-risk (unchanged single-parse behavior when only one instance exists) but worth a quick look next time that app is touched
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
| 260704-05c | Redesign admin Settings page + block sidebar UI (sectioned layout, per-field "Synced from Platform" pills + override disclosures, sidebar Global default/Custom segmented toggles) | 2026-07-04 | 37a985e | [260704-05c-redesign-the-khavee-admin-settings-page-](./quick/260704-05c-redesign-the-khavee-admin-settings-page-/) |
| 260704-77n | Add a site-wide floating chat launcher (Settings toggle + wp_footer hook + FloatingWidget launcher/panel wrapping the existing avatar+chat pieces); live verification caught and fixed a GLB-load-failure/WebGL-context-loss regression that unmounted the whole widget (new AvatarErrorBoundary) | 2026-07-04 | 800b62d | [260704-77n-build-a-site-wide-floating-chat-launcher](./quick/260704-77n-build-a-site-wide-floating-chat-launcher/) |
| 260705-p30 | Floating widget controls: remove unread dot, remove chat toggle, reposition mic bottom-right (floating-only, ControlBar gained showChatToggle/className props defaulting to inline-embed's current behavior), plus floating-specific bg color/transparency/avatar offset/scale settings independent of the global avatar config | 2026-07-05 | a77913b | [260705-p30-floating-widget-controls](./quick/260705-p30-floating-widget-controls/) |
| 260706-vf4 | Live visual preview for floating widget Settings page: WP color picker + range sliders replacing blind text/number inputs, 360x520 live avatar preview reusing the existing khaveeai-preview bundle's generic DOM-observer path (zero bundle/build changes needed); live verification caught and fixed a real staleness bug in color-palette swatch clicks (Iris's irischange event fires before writing the new color into the DOM value) | 2026-07-06 | f310d5d | [260706-vf4-live-preview-floating-widget-settings](./quick/260706-vf4-live-preview-floating-widget-settings/) |
| 260706-wop | Live camera-angle drag control for the floating widget Settings-page preview: orbit-drag in the preview writes back to a new floating-only "Floating camera angle" slider (bidirectional, via a new inverse-rotation math helper + a CustomEvent bridge since the preview mounts outside any React tree the Settings page controls), fully wired PHP layer, verified end-to-end including the actual live front-end floating widget | 2026-07-06 | 6b4f9e0 | [260706-wop-live-camera-angle-drag-preview](./quick/260706-wop-live-camera-angle-drag-preview/) |
| 260706-x6b | Settings page visual redesign: card-based sections with branded flat-purple styling (mirrors packages/wp-bundle/styles.css's design tokens), two-column sticky-preview layout for the Floating Widget section only (fields left, live preview right, no scroll needed), responsive single-column fallback on narrow viewports; pure presentation pass, zero functional changes (all element IDs the 260706-vf4/260706-wop live-preview JS depends on verified intact) | 2026-07-06 | b60e2b4 | [260706-x6b-settings-page-redesign](./quick/260706-x6b-settings-page-redesign/) |
| 260707-0u6 | Settings page fixes batch: floating-preview clarifying caption, removed Remove-Key checkboxes in favor of blank-and-save removal, live avatar preview in Avatar section, purple accent-color on range/checkbox inputs, static mock chat transcript in Floating Widget preview, transparent-toggle bug fix attempt #1 (Canvas `key`-prop remount). Automated checks all pass; live human verification incomplete — user's live re-test surfaced 3 outstanding problems (avatar preview layout position, mock chat not nested in chat-box wrapper, transparent-toggle bug still occurring) carried forward as a follow-up task | 2026-07-07 | 724663c (merge c3c8896) | [260707-0u6-settings-page-fixes-batch](./quick/260707-0u6-settings-page-fixes-batch/) |
| 260707-oyu | Settings page follow-up fixes: Avatar section preview moved into a two-column layout (mirrors Floating Widget), mock chat bubbles rewired into a real chat-box wrapper (header + bounded transcript) matching ChatBox.tsx — both live-verified working. Also attempted a fix for the transparent-toggle bug (disproved the prior `key`-prop-remount hypothesis via source trace, simplified the Canvas `gl` prop) — live-verified this did NOT resolve the bug; root cause was elsewhere (see 260707-wa2) | 2026-07-07 | 3f4fa74 (merge 5467395) | [260707-oyu-settings-page-follow-up-fixes](./quick/260707-oyu-settings-page-follow-up-fixes/) |
| 260707-wa2 | Transparent-toggle bug — genuine fix (3rd attempt). Live DOM inspection found the real root cause: `SettingsPage.php`'s belt-and-braces `input`/`change` listeners passed `rebuild` directly to `addEventListener`, so the browser invoked `rebuild(event)` — the native DOM Event leaked into `rebuild`'s `colorOverride` param, corrupting `bgColor` into a serialized Event object on every checkbox/slider interaction. Fixed by wrapping both listeners in zero-arg closures. Live-verified in wp-env: 3 rapid check/uncheck cycles reliably restore the background; slider regression check passed | 2026-07-07 | a9ea603 (merge cbe0225) | [260707-wa2-transparent-toggle-genuine-fix](./quick/260707-wa2-transparent-toggle-genuine-fix/) |
| 260708-0rs | Preview mount container sizing fix: added missing `containerWidth`/`containerHeight` to both Settings-page preview mount configs (Avatar 280x340, Floating 360x520) — the React container div had no ancestor height to resolve percentage sizing from, so the canvas was collapsing to ~140-180px instead of filling its box. Live verification surfaced a separate latent bug (see 260708-16h) that this sizing fix exposed but did not cause; once that companion fix landed, both previews fill their boxes correctly | 2026-07-08 | 4780b42 (merge a4bb768) | [260708-0rs-preview-mount-container-sizing-fix](./quick/260708-0rs-preview-mount-container-sizing-fix/) |
| 260708-16h | VRMAvatar shared-scene multi-instance fix (in `@khaveeai/react`, not just wp-plugin): `useGLTF`'s global-by-URL cache meant two simultaneous `<VRMAvatar src="same-url">` instances (both Settings-page previews) shared literally the same `scene`/`VRM` object — mounting it in a second Canvas reparented it away from the first, leaving one preview blank. Researched (three-vrm has no clone API; scene.clone()/SkeletonUtils.clone are insufficient since the VRM's humanoid/expressionManager/springBoneManager still reference the original bones) and fixed via a new `useLoadVRM(src)` hook that runs an independent per-instance `GLTFLoader.parseAsync()` + `VRMLoaderPlugin`, with a module-level buffer cache to avoid redundant fetches. A second regression (idle animation not autoplaying, avatar stuck in T-pose) was caught during live verification and fixed in the same task — the animation-switching effect's dependency array was missing `processedClips`, a bug only exposed once loading became async instead of Suspense-based. Live-verified: both previews render independently, orbit-dragging one doesn't affect the other, idle pose correct | 2026-07-08 | 4396b77, b90faeb, 107a562 | [260708-16h-vrmavatar-shared-scene-instance-fix](./quick/260708-16h-vrmavatar-shared-scene-instance-fix/) |
| 260708-1ws | Floating Widget preview now structurally matches the real front-end widget: extracted `PreviewAvatarCanvas` (reusable avatar Canvas), extended `PreviewChatBox` with static example bubbles, added `PreviewFloatingWidget` mirroring `FloatingWidget.tsx`'s exact CSS classes (`.khaveeai-floating-panel/header/avatar-area/chat`) — purple header with title/subtitle/close, fixed 200px avatar area with a static non-functional "Click to talk" pill, chat filling the rest. `previewMode:'floating'` gates the new layout to only the Floating Widget mount (Avatar section + Gutenberg editor previews unaffected). Removed the now-dead PHP `render_floating_preview_mock_chat()`. STUDIO-02 safety preserved (build-time assertion passed). Live-verified: panel renders correctly, transparent-toggle fix still works, Avatar section preview unchanged | 2026-07-08 | 77ef12d, c070ac3, 4053042, 746cbd6 | [260708-1ws-floating-preview-real-widget-parity](./quick/260708-1ws-floating-preview-real-widget-parity/) |
| 260708-nh0 | Floating widget header tweaks (both real widget and preview, edited together since 260708-1ws made them mirror each other): removed the "Usually replies instantly" subtitle entirely; reduced `.khaveeai-floating-header` padding from 16px/18px to 12px/18px for a visibly thinner bar. Rebuilt all 4 bundle artifacts. Live-verified: header shows only "AI Assistant", thinner bar, close button/title still properly aligned, no other panel changes | 2026-07-08 | 2a2e7ed, 023b2dc | [260708-nh0-thin-header-remove-subtitle](./quick/260708-nh0-thin-header-remove-subtitle/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-07T09:12:18.084Z
Stopped at: context exhaustion at 75% (2026-07-07)
Resume file: None

Last activity: 2026-07-08 - Completed quick task 260708-nh0: floating widget header thinned + "Usually replies instantly" subtitle removed (real widget + preview, kept in sync per 260708-1ws), fully live-verified
</content>
