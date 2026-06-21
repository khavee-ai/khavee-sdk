# Requirements: WordPress Plugin (Custom Mode) — Milestone v2.0

**Defined:** 2026-06-21
**Core Value (this milestone):** A WordPress site owner can embed a working voice-chat VRM avatar on any page, fully self-configured in WP admin — no dependency on the hosted Khavee platform.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Settings & Configuration

- [ ] **SET-01**: Admin can configure an OpenAI API key via a WP Settings API page; the saved key is redisplayed masked (e.g. `sk-••••••1234`), never in full
- [ ] **SET-02**: Admin can configure a personality/instruction system prompt via a textarea
- [ ] **SET-03**: Admin can select a voice from OpenAI's Realtime voice list via a dropdown
- [ ] **SET-04**: Admin can upload a VRM or GLB avatar file via the WP Media Library
- [ ] **SET-05**: Settings page is gated to users with the `manage_options` capability, checked both at menu registration and inside the render callback
- [ ] **SET-06**: An inline admin-only notice appears on the frontend embed when the API key is missing or invalid; regular visitors see a neutral placeholder instead of a broken widget or console error

### Embedding (Shortcode + Block)

- [ ] **EMBED-01**: Site owner can embed the avatar via a `[khaveeai_avatar]` shortcode, usable in any editor or page builder
- [ ] **EMBED-02**: Shortcode supports per-instance attribute overrides (voice, instructions, avatar) that fall back to the global settings when omitted
- [ ] **EMBED-03**: Site owner can embed the avatar via an equivalent Gutenberg block whose inspector controls mirror the shortcode's attributes
- [ ] **EMBED-04**: Shortcode and block resolve attributes (instance override → global default → hardcoded fallback) through one shared PHP function, so the two embed methods cannot drift out of sync
- [ ] **EMBED-05**: The Gutenberg block's editor preview (`edit()`) never mounts the live SPA, opens a microphone prompt, or mints a real OpenAI token while editing — only the front-end render does

### Session Backend (REST)

- [ ] **REST-01**: Browser can request an ephemeral OpenAI Realtime token from a WP REST route without requiring a logged-in WP session (anonymous site visitors must be able to start a session)
- [ ] **REST-02**: The OpenAI API key is never transmitted to the browser at any point in the settings, page-render, or session flow
- [ ] **REST-03**: The token route applies per-IP rate limiting and a daily mint cap, so an anonymous endpoint cannot become an unmetered proxy against the site owner's OpenAI billing
- [ ] **REST-04**: The token route responds with `Cache-Control: no-store`, so page-caching plugins cannot serve a stale or shared token to a different visitor

### Asset Handling & Performance

- [ ] **ASSET-01**: VRM/GLB Media Library uploads are validated server-side beyond file extension (binary magic-byte check) before being accepted, in addition to the `upload_mimes` allowlist
- [ ] **PERF-01**: The avatar JS bundle and its dependencies are enqueued only on pages that actually contain the shortcode or block (via `has_shortcode()`/`has_block()` detection), not site-wide

### Architecture / Extensibility

- [ ] **ARCH-01**: Config retrieval (API key, instructions, voice, avatar URL) is implemented behind a `ConfigSourceInterface` with one concrete implementation (`WpOptionsConfigSource`) this milestone, so a future platform-driven config source can be added without changing the JS bundle or rendering code
- [ ] **ARCH-02**: Ephemeral-token minting is implemented behind a `TokenProviderInterface` with one concrete implementation (`OpenAiDirectTokenProvider`) this milestone, so a future platform-driven token provider can be added without changing the JS bundle or REST contract shape

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Platform Mode (Fast-Follow)

- **PLAT-01**: Platform mode — API-key-driven config pulled from the hosted `khavee-app` dashboard, swapped in via the `ConfigSourceInterface`/`TokenProviderInterface` seam built this milestone. Blocked on a new API-key-gated ephemeral-token endpoint in `khavee-app` (separate repo, separate milestone).

### Settings Enhancements

- **SETV2-01**: `wp-config.php` constant override for the API key (`KHAVEEAI_OPENAI_API_KEY`), taking precedence over the DB option, for security-conscious admins
- **SETV2-02**: "Test Connection" button on the settings page that round-trips a lightweight call to OpenAI to confirm the key works before saving

### Multi-Instance & Distribution

- **MULTI-01**: Multi-profile / multi-bot configuration manager (named configs beyond one global default + per-instance overrides)
- **MULTI-02**: Native page-builder widgets (Elementor, Divi, Beaver Builder) beyond the generic shortcode/HTML widget support every builder already provides
- **MULTI-03**: Usage/conversation analytics dashboard inside the plugin
- **MULTI-04**: Multi-tab settings UI (revisit once field count grows, e.g. when Platform mode adds a distinct mode-selection tab)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Platform mode itself (not just deferred — actively blocked) | Requires a new API-key-gated ephemeral-token endpoint in `khavee-app` that doesn't exist; that's a separate repo/codebase and separate milestone |
| Encryption-at-rest for the OpenAI API key beyond `wp_options` + capability gating | Proper encryption-at-rest requires a `wp-config.php`-level constant the admin must manually add, which contradicts "fully self-configured in WP admin" for v1; standard `wp_options` + strict capability gating + never echoing the full key is the accepted WP convention |
| Multi-bot profile management UI | Classic WP over-configurability trap; one global default + per-instance shortcode/block override already covers "different avatar per page" |
| Native Elementor/Divi/Beaver Builder widgets | Shortcode already works inside every page builder's generic shortcode/HTML widget; native widgets are 2-3x the surface area for marginal UX gain |
| Client-side-configurable advanced realtime parameters (temperature, VAD thresholds, etc.) in the admin UI | Most WP admins don't know what these mean; keep hardcoded sane defaults in the JS bundle, expose only API key/instructions/voice/avatar |
| Built-in usage/conversation analytics dashboard | Introduces data-retention/GDPR obligations orthogonal to "embed an avatar"; Custom mode has no backend to aggregate against anyway |
| Bundling a default VRM avatar inside the plugin package | VRM/GLB files are several MB+; bloats the plugin zip and conflicts with WordPress.org size/review expectations |
| Multi-tab settings UI | Premature structure at 4 config fields; single flat settings page is sufficient for v1 |
| Modifying `openai-realtime`'s `OpenAIRealtimeProvider` or the existing Next.js `src/app/api/negotiate/route.ts` | Out of scope per project constraints; the WP PHP route implements the OpenAI ephemeral-token contract directly, not modeled on the demo app's SDP-relay route (confirmed mismatch during research) |
| `khavee-app` platform changes of any kind | Separate repo/codebase; not part of khavee-sdk milestones |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SET-01 | Phase 7 | Pending |
| SET-02 | Phase 7 | Pending |
| SET-03 | Phase 7 | Pending |
| SET-04 | Phase 7 | Pending |
| SET-05 | Phase 7 | Pending |
| SET-06 | Phase 7 | Pending |
| EMBED-01 | Phase 8 | Pending |
| EMBED-02 | Phase 8 | Pending |
| EMBED-03 | Phase 8 | Pending |
| EMBED-04 | Phase 8 | Pending |
| EMBED-05 | Phase 8 | Pending |
| REST-01 | Phase 6 | Pending |
| REST-02 | Phase 6 | Pending |
| REST-03 | Phase 6 | Pending |
| REST-04 | Phase 6 | Pending |
| ASSET-01 | Phase 7 | Pending |
| PERF-01 | Phase 8 | Pending |
| ARCH-01 | Phase 6 | Pending |
| ARCH-02 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19 (Phase 6: 6, Phase 7: 7, Phase 8: 6)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-21*
*Last updated: 2026-06-21 after roadmap creation (Phases 6-8 mapped)*
</content>
