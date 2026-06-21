# Project Research Summary

**Project:** Khavee WordPress Plugin (Custom Mode) — v2.0 Milestone
**Domain:** WordPress plugin (PHP backend + bundled React 19/Three.js frontend SPA) embedding an existing OpenAI Realtime voice-chat VRM avatar
**Researched:** 2026-06-21
**Confidence:** MEDIUM-HIGH

## Executive Summary

This milestone is a WordPress plugin that surfaces khavee-sdk's existing `OpenAIRealtimeProvider` (full-duplex WebRTC voice + VRM avatar) inside any WordPress site, fully self-configured from WP admin. It is **not** new voice-pipeline work — the hard SDK problem (STT/LLM/TTS orchestration) was solved in prior milestones. The new work is entirely WordPress-shaped: a PHP backend that mints OpenAI Realtime ephemeral tokens server-side (so the API key never reaches the browser), an admin settings screen (API key, instructions, voice, VRM/GLB avatar upload via Media Library), and a shortcode + Gutenberg block that both render a shared bundled JS SPA. Experts build this category of plugin (chatbot/3D-embed WP plugins) with: WP Settings API for config, `@wordpress/scripts` for the JS build, Media Library for file upload, and a single shared PHP render path feeding both the shortcode and block so they never drift apart.

The recommended approach is two small PHP strategy interfaces — `ConfigSourceInterface` (where settings come from) and `TokenProviderInterface` (how a session token is minted) — each with exactly one concrete implementation this milestone (WP options-backed config, direct-to-OpenAI token minting), wired together in a single composition-root file (`Plugin.php`). This satisfies the project's explicit constraint that a future "Platform mode" must slot in without touching the JS bundle: the REST contract (`{sessionConfig} -> {ephemeralToken, sessionId}`) is the actual seam, not the PHP class names. The frontend is a separately-bundled (Vite/esbuild, not `tsc`) React 19 SPA that imports `@khaveeai/react` + `@khaveeai/providers-openai-realtime` unmodified, configured via `useProxy: true` pointed at the new WP REST route.

The dominant risk cluster is **the public REST route itself**: because the avatar must work for anonymous, logged-out site visitors, the token-minting endpoint cannot use WordPress's standard nonce-based REST auth (which only protects logged-in user sessions and is documented to silently break under page caching). It must be registered as genuinely public (`permission_callback => '__return_true'`) and protected instead by IP-based rate limiting, a daily mint ceiling, and `Cache-Control: no-store` — without these, any visitor who discovers the route URL can run up the site owner's real OpenAI billing indefinitely, with no auth boundary stopping them. A second risk cluster is around the bundled JS itself: React-version collisions with WordPress core's bundled React, Gutenberg editor preview accidentally firing live mic/WebRTC/token calls inside wp-admin, and `.glb`/`.vrm` file upload needing both MIME allow-listing AND binary magic-byte validation (the allow-list alone is a known disguised-file-upload vector). All of these are addressed in the architecture's recommended structure (separate `editorScript`/`viewScript`, bundle isolation, scoped `upload_mimes` filter) — see PITFALLS.md for full detail.

## Key Findings

### Recommended Stack

The plugin is built with `@wordpress/scripts` (webpack-based, zero-config, auto-generates the PHP `*.asset.php` dependency manifest) for the JS build — explicitly **not** the newer `@wordpress/build` (esbuild-based), which is documented as not production-ready as of April 2026. PHP backend uses Composer for PSR-4 autoloading only (no HTTP client dependency — WordPress core's `wp_remote_post()`/`wp_remote_get()` is used instead of Guzzle, avoiding vendored-dependency version-conflict risk with other plugins). The frontend SPA reuses `@khaveeai/react`, `@khaveeai/core`, and `@khaveeai/providers-openai-realtime` directly (pinned to exact versions already used in the monorepo — `react@^19.1.0`, `three@^0.180.0`, `@pixiv/three-vrm@^3.4.2`) rather than reimplementing avatar rendering.

**Core technologies:**
- `@wordpress/scripts` (^32.4.0) — zero-config webpack build, auto-generated asset manifest for cache-busted, dependency-tracked script enqueueing
- PHP 8.0+ (or 7.4-syntax-target if wordpress.org distribution is wanted) with Composer PSR-4 autoloading — no scaffolding generator needed; structure is already pre-defined (`includes/`, `src/`)
- `@khaveeai/react` / `@khaveeai/core` / `@khaveeai/providers-openai-realtime` (workspace or published) — the entire reason this plugin is fast to build; existing, validated SDK packages are consumed unmodified
- `wp_remote_post()` (WP core HTTP API) — for the one server-to-server call to OpenAI's ephemeral-token endpoint; explicitly avoid Guzzle/cURL via Composer
- `wp-env` (`@wordpress/env`) — disposable local WordPress+MySQL Docker environment for manual testing against a real WP core version

### Expected Features

WP admins evaluating this plugin expect it to look and behave like other reputable API-key-driven WP plugins (AI chatbot plugins, 3D-embed plugins): native Settings API forms, masked credential fields, both a shortcode and a Gutenberg block sharing logic, and Media Library-based file upload — not custom forms or raw `<input type=file>` handlers.

**Must have (table stakes):**
- Admin settings page via Settings API (`register_setting`), capability-gated to `manage_options`
- API key as masked `type="password"` field with last-4 redisplay on reload (never re-echo the full key)
- `[khaveeai_avatar]` shortcode AND an equivalent Gutenberg block, both sharing one PHP attribute-resolution function so they never drift apart
- Media Library upload for `.glb`/`.vrm` avatar files (allow-listed via `upload_mimes`, validated server-side beyond extension)
- Public WP REST route that mints the ephemeral OpenAI token server-side (key never reaches the browser) — this is the entire value proposition, not a differentiator
- Conditional script/style enqueueing only on pages that actually use the shortcode/block (avoid sitewide multi-MB bundle bloat)
- Admin-visible error notice when the API key is missing/invalid; neutral placeholder for regular visitors

**Should have (competitive):**
- Full-duplex real-time *voice* (not text chat) — already built, this plugin just surfaces it; no competing WP AI-chat plugin combines this with an animated lip-synced 3D avatar
- Personality/instructions textarea exposed directly (not paywalled, unlike some competitors)
- Voice picker populated from the SDK's existing voice enum (single source of truth, not hand-duplicated in PHP)

**Defer (v2+):**
- Multi-profile/multi-bot configuration manager (ship "one global default + per-shortcode override" only)
- Native page-builder widgets (Elementor/Divi) — shortcode already covers all builders via their generic shortcode/HTML widgets
- Usage/conversation analytics dashboard — no backend to aggregate against in Custom mode
- `wp-config.php` constant key override and a "Test Connection" button — useful but not launch-blocking (v1.x)
- Platform mode (API-key-driven config from hosted `khavee-app`) — explicitly out of scope, blocked on a `khavee-app` backend that doesn't exist yet

### Architecture Approach

The architecture centers on two narrow PHP strategy interfaces (`ConfigSourceInterface`, `TokenProviderInterface`), each with one concrete implementation this milestone, wired together by a single composition-root file (`Plugin.php` — WordPress has no built-in DI container, and one isn't needed for ~6-8 classes). A REST controller (`SessionController`) is the only thing that talks to both strategies and is the seam that must exactly match the response shape `OpenAIRealtimeProvider.ts`'s `useProxy` branch expects. Shortcode and Gutenberg block are both thin adapters calling one shared `AvatarRenderer::render()` method, ensuring config-shape parity between the two embed methods. The JS bundle is built separately (Vite/esbuild) from the rest of the monorepo's `tsc`-based packages, since it must produce one consumer-facing bundled file, not a library.

**Major components:**
1. `ConfigSourceInterface` / `WpOptionsConfigSource` — resolves admin-configured settings (API key, instructions, voice, avatar URL) from `wp_options`
2. `TokenProviderInterface` / `OpenAiDirectTokenProvider` — mints an OpenAI Realtime ephemeral token server-to-server via `wp_remote_post`
3. `SessionController` (REST) — the PHP/JS integration contract: `POST /khaveeai/v1/session` -> `{sessionConfig}` in, `{data:{ephemeralToken, sessionId}}` out
4. `AvatarRenderer` — single shared render path producing mount-point HTML + bootstrap JSON, called by both `AvatarShortcode` and `AvatarBlock`
5. `AssetManager` — registers/enqueues the built bundle on `wp_enqueue_scripts` (never inside the shortcode/block callback — see Pitfall below), idempotent across multiple instances per page
6. Frontend SPA (`build/khaveeai-bundle.js`) — imports `@khaveeai/react` + `@khaveeai/providers-openai-realtime` unmodified, constructs `OpenAIRealtimeProvider` with `useProxy: true` pointed at the WP REST route

A concrete discrepancy flagged by research: the existing `src/app/api/negotiate/route.ts` (SDP-relay pattern) is **not** the contract to replicate — the WP route must instead implement the ephemeral-token-minting contract (`OpenAIRealtimeProvider.ts` lines 139-226, the `useProxy`/`proxyEndpoint` branch), which is a different, currently-less-exercised code path in the existing provider.

### Critical Pitfalls

1. **Anonymous token route becomes an unmetered OpenAI billing proxy** — because the route must work for logged-out visitors, `permission_callback` is effectively `__return_true`; without IP-based rate limiting (WP transients), a daily mint ceiling, and shortest-possible token scope, anyone who discovers the route can run up the site owner's OpenAI bill with no browser/avatar involved at all. Must be architected in from the first implementation, not retrofitted.
2. **Nonce-based auth assumed to "just work" for anonymous visitors** — WP's standard `wp_rest` cookie-nonce pattern only protects logged-in users and is documented to silently fail under page caching for anonymous visitors. The route must be treated as genuinely public with abuse-mitigation (referer/origin checks + rate limiting), not pseudo-authenticated.
3. **Caching layers serve stale/shared ephemeral tokens** — if the token endpoint is GET-cacheable or a token is embedded in server-rendered shortcode/block HTML, every visitor to a cached page gets the same expired/shared token. Must be `POST`-only with explicit `Cache-Control: no-store`, fetched live client-side, never baked into cacheable HTML.
4. **Multiple React copies colliding with WP core or theme/plugin-bundled React** — WP core has bundled React via `wp-element` since 5.0; this plugin needs React 19 specifically, so full bundle isolation (no leaked globals) is the safer default over externalizing against a potentially-older WP-core React version.
5. **Gutenberg editor preview fires live mic/WebRTC/token calls inside wp-admin** — naively mounting the same SPA in the block's `edit()` triggers mic permission prompts and mints real tokens on every admin keystroke/re-render. Must use `block.json`'s separate `editorScript`/`viewScript` so the editor shows only a static inert preview.
6. **`.glb`/`.vrm` upload validation is "looks done but isn't"** — allow-listing the MIME via `upload_mimes` alone (without binary magic-byte content validation) lets a disguised malicious file land in the Media Library under a trusted-looking extension; both the filter AND `wp_check_filetype_and_ext` magic-byte validation are required together, and `upload_mimes` is a global filter that must be scoped narrowly around this plugin's own upload action, not left registered for the full request lifecycle.

## Implications for Roadmap

Based on combined research, the natural phase structure follows the architecture's own "Suggested Build Order" (the two PHP strategy interfaces and the REST contract are the actual integration risk; render/shortcode/block layers are comparatively low-risk, well-documented WP patterns to build once the PHP-to-OpenAI contract is proven via `curl`):

### Phase 1: PHP Backend Core — Config/Token Strategies + REST Contract
**Rationale:** This is the genuine integration risk this milestone calls out — get the `ConfigSourceInterface`/`TokenProviderInterface`/`SessionController` contract working and `curl`-testable before any JS exists, de-risking the rest of the build.
**Delivers:** `ConfigSourceInterface` + `WpOptionsConfigSource`, `TokenProviderInterface` + `OpenAiDirectTokenProvider`, `SessionController` REST route, `Plugin.php` composition root
**Addresses:** "WP REST route that mints an ephemeral OpenAI Realtime token server-side" (FEATURES.md table stakes); the config-source/token-provider swappable-strategy constraint from PROJECT.md
**Avoids:** Pitfalls 1, 2, 3 (anonymous-route abuse, nonce confusion, cache-safety) — must be architected into the route's first implementation, including rate limiting (IP+transient), `__return_true` + abuse mitigation (not nonce auth), `POST`-only + `Cache-Control: no-store`

### Phase 2: Admin Settings Page
**Rationale:** Depends only on `ConfigSourceInterface` (Phase 1, step 1); needed before real end-to-end testing since `WpOptionsConfigSource` needs actual settings to read, but has no hard blocking dependency on the REST route being finished.
**Delivers:** Settings API page — masked API key field (last-4 redisplay), instructions textarea, voice picker, Media Library avatar picker (`.glb`/`.vrm`)
**Uses:** WP Settings API (`register_setting`, `add_settings_field`), `wp.media` JS picker — no new schema/validation library
**Implements:** `Admin/SettingsPage.php` reading/writing through `ConfigSourceInterface`, never bypassing it directly to `wp_options`
**Avoids:** Pitfalls 7, 8 (upload MIME allow-list + magic-byte validation shipped together, scoped narrowly to this plugin's own upload action, not left globally registered)

### Phase 3: Frontend Bundle (React SPA)
**Rationale:** Can start in parallel with Phases 1-2 since it only needs to know the REST contract shape (already defined by Phase 1's interface design, not its finished implementation) and the bootstrap-data attribute shape — but should be sequenced after Phase 1's contract is `curl`-verified to avoid building against a moving target.
**Delivers:** A new small Vite/esbuild-built TS package (`wordpress-plugin/bundle-src/`) that imports `@khaveeai/react` + `@khaveeai/providers-openai-realtime` unmodified and mounts into `[data-khaveeai-root]`, constructing `OpenAIRealtimeProvider` with `useProxy: true`
**Uses:** Existing, unmodified `@khaveeai/react`/`@khaveeai/providers-openai-realtime` per the explicit constraint that the existing provider stays untouched
**Avoids:** Pitfall 4 (React version collision) — decide bundle isolation vs. externalization here; this is a one-time architectural choice, expensive to reverse once the enqueue contract is public API

### Phase 4: Render Layer — Shortcode + Block + Asset Enqueueing
**Rationale:** Depends on both `ConfigSourceInterface` (Phase 1/2) and the bundle's bootstrap-data shape (Phase 3) being stable; the shortcode path gives an end-to-end testable flow before the block adds editor-side complexity, so build shortcode before block.
**Delivers:** `AvatarRenderer` (shared render path), `AssetManager` (idempotent, hook-based enqueueing), `AvatarShortcode`, then `AvatarBlock` + `block.json` + `assets/editor.js`
**Implements:** Shared render path pattern (one normalized config shape feeding both embed methods); `editorScript`/`viewScript` split for the block
**Avoids:** Pitfall 5 (enqueue-ordering/optimizer-plugin interference — register on `wp_enqueue_scripts`, never inside the render callback) and Pitfall 6 (Gutenberg editor firing live mic/WebRTC — static inert `edit()` preview only)

### Phase Ordering Rationale

- PHP-to-OpenAI integration (Phase 1) is sequenced first because it is the one piece with no comparable shipped precedent (per PITFALLS.md, "no existing public WordPress plugin combines anonymous ephemeral-token minting + WebRTC + VRM avatar upload") — proving this contract early via `curl` removes risk from every downstream phase.
- Settings (Phase 2) and the frontend bundle (Phase 3) can proceed in parallel once Phase 1's interfaces (not full implementation) are defined, since both only need the *shape* of the contract.
- Render/shortcode/block (Phase 4) is sequenced last because it is the most WP-API-specific, best-documented, lowest-risk layer — it should not block on anything except the other three being stable, and shortcode-before-block within this phase gives an earlier end-to-end testable path.
- This ordering directly mirrors ARCHITECTURE.md's own "Suggested Build Order" section, which explicitly recommends proving the PHP-to-OpenAI triangle before touching JS.

### Research Flags

Needs deeper research during planning:
- **Phase 1 (REST/token route):** No official OpenAI documentation specifies per-IP/per-mint rate limits for the ephemeral-token endpoint specifically — validate actual OpenAI rate-limit behavior at implementation time (account-plan-dependent, may change). Also confirm the exact ephemeral-token response shape (`value` field per OpenAI docs) against the existing `OpenAIRealtimeProvider.ts`'s `ProxyTokenResponse` type before finalizing the PHP response-reshaping logic.
- **Phase 3 (frontend bundle):** Could not verify WordPress core's currently-bundled React version — this determines the Pitfall 4 decision (full isolation vs. externalization). Check the current Gutenberg/WP core changelog before deciding.
- **Phase 4 (Gutenberg block):** `ServerSideRender`/dynamic-block editor-preview pattern was WebSearch-verified only (no single canonical doc independently re-verified) — flag for validation if editor preview behavior diverges from expectations during implementation.

Phases with standard, well-documented patterns (skip research-phase):
- **Phase 2 (admin settings page):** WP Settings API, Media Library `wp.media` picker, and `upload_mimes`/`wp_check_filetype_and_ext` are all HIGH-confidence, officially documented WordPress core patterns with direct working-code precedent (e.g. `eldinor/babylon-wordpress-plugin` for the GLB MIME mapping).
- **Phase 4 (shortcode registration, conditional enqueueing):** Standard, extensively documented WordPress plugin conventions with no novel risk beyond the pitfalls already cataloged.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH (core WP APIs) / MEDIUM (bundler choice) | WordPress Settings API, REST auth model, `upload_mimes` verified against official developer.wordpress.org docs. `@wordpress/scripts` vs. Vite/esbuild choice is community-consensus (no Context7 entry), but well-corroborated. |
| Features | MEDIUM | No single official "embeddable WP widget plugin" spec exists; synthesized by pattern-matching across real shipped competitors (AI Engine, 3D Viewer Block) — internally consistent but not officially codified. |
| Architecture | HIGH (WP REST/enqueue APIs, OpenAI ephemeral-token contract) / MEDIUM (PHP strategy-pattern/DI conventions) | The REST contract and OpenAI endpoint behavior were verified directly against this repo's own `OpenAIRealtimeProvider.ts` source and official OpenAI docs. The composition-root/strategy-interface approach is informed engineering judgment, not an official WordPress-endorsed standard — no single canonical "WordPress DI" doc exists. |
| Pitfalls | MEDIUM | Core WordPress behaviors (nonces, `upload_mimes`, plugin-review guidelines) are HIGH confidence (official docs). The specific combination of risks for this plugin (anonymous ephemeral-token minting + WebRTC + VRM upload) has no directly comparable shipped precedent — pitfalls are synthesized risk analysis from closest documented analogs, not confirmed bug reports. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **OpenAI rate-limit behavior for the ephemeral-token endpoint specifically** is undocumented by OpenAI for per-IP/per-mint scenarios — the rate-limiting design in Phase 1 is a defensive pattern, not a documented threshold; validate against current OpenAI docs at implementation time.
- **WordPress core's currently-bundled React version** could not be verified — directly affects the Phase 3 bundle-isolation-vs-externalization decision; check the Gutenberg/WP core changelog before finalizing the build config.
- **No directly comparable shipped WordPress plugin** combines anonymous ephemeral-token minting + WebRTC + VRM avatar upload in one package — Pitfalls 1, 2, 3, and 6 are synthesized architectural risk analysis rather than confirmed real-world bug reports; treat their mitigations as load-bearing design decisions to verify carefully during Phase 1/4 QA, not optional hardening.
- **The existing `src/app/api/negotiate/route.ts` is explicitly NOT a working reference** for this milestone's PHP route — it implements a different (SDP-relay) contract than the ephemeral-token contract this plugin needs (`useProxy` branch of `OpenAIRealtimeProvider.ts`). This should be called out explicitly during Phase 1 planning so no one mistakenly ports the wrong pattern.

## Sources

### Primary (HIGH confidence)
- [Realtime API with WebRTC | OpenAI API](https://platform.openai.com/docs/guides/realtime-webrtc) — ephemeral token endpoint, WebRTC negotiation flow
- [Create client secret | OpenAI API Reference](https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret) — response shape, TTL
- [Settings API – Plugin Handbook](https://developer.wordpress.org/plugins/settings/settings-api/)
- [Authentication – REST API Handbook](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [Adding Custom Endpoints – REST API Handbook](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/)
- [upload_mimes – Hook, WordPress Developer Resources](https://developer.wordpress.org/reference/hooks/upload_mimes/)
- [wp_check_filetype_and_ext() – Function Reference](https://developer.wordpress.org/reference/functions/wp_check_filetype_and_ext/)
- [@wordpress/build, the next generation of WordPress plugin build tooling – WordPress Developer Blog](https://developer.wordpress.org/news/2026/04/wordpress-build-the-next-generation-of-wordpress-plugin-build-tooling/)
- Repo inspection: `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`, `src/app/api/negotiate/route.ts`, `packages/react/package.json`, `packages/core/package.json`

### Secondary (MEDIUM confidence)
- [How to Properly Restrict Access to WordPress REST API Routes – Plugin Vulnerabilities](https://www.pluginvulnerabilities.com/2022/12/13/how-to-properly-restrict-access-to-wordpress-rest-api-routes/)
- [GitHub: eldinor/babylon-wordpress-plugin](https://github.com/eldinor/babylon-wordpress-plugin) — `model/gltf-binary` MIME mapping precedent
- [AI Engine plugin (WordPress.org)](https://wordpress.org/plugins/ai-engine/), [3D Viewer – glb/gltf Viewer (WordPress.org)](https://wordpress.org/plugins/advanced-3d-model-viewer/) — competitor feature analysis
- WebSearch: WP REST transient-based rate limiting (multiple independent community sources)
- WebSearch: WordPress DI/strategy pattern conventions (carlalexander.ca, x-wp/di, lucatume/di52)

### Tertiary (LOW confidence)
- OpenAI ephemeral-token endpoint per-IP/per-mint rate-limit specifics — no official documentation found, needs validation at implementation time
- WordPress core's currently-bundled React version for the editor — not independently verified this research pass

---
*Research completed: 2026-06-21*
*Ready for roadmap: yes*
