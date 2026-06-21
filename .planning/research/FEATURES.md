# Feature Research

**Domain:** WordPress plugin embedding a configurable, JS-heavy interactive widget (voice-chat VRM avatar) — analogous to AI chatbot plugins, 3D/AR model embed plugins, and other consumer-facing third-party-API-key plugins
**Researched:** 2026-06-21
**Confidence:** MEDIUM (WP plugin conventions are well-documented and consistent across many real plugins surveyed; no single official "embeddable widget plugin" spec exists, so synthesis is pattern-matched across category — chatbot plugins, 3D viewer plugins, API-key plugins)

## Feature Landscape

### Table Stakes (Users Expect These)

Features a WP admin assumes exist. Missing these makes the plugin feel broken or unsafe to use with a real API key.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Admin settings page under Settings API (`register_setting`/`settings_fields`) | Every reputable WP plugin uses the native Settings API for forms — it gets nonces, capability checks, and the standard save-flash-message UX for free. Custom `<form>` + manual `$_POST` handling is the #1 marker of an amateur/unsafe plugin. | LOW | Use `register_setting()` with a `sanitize_callback`; one options group is enough for v1 (no need for the network/multisite variant). |
| API key input as `type="password"` with show/hide toggle | Users expect secrets to be masked by default, matching every credential field in WP core (e.g. login screen) and every competing AI plugin (AI Engine, WPBot, BitBot). A bare `type="text"` field reads as insecure. | LOW | WP core already ships a password-visibility-toggle pattern (`wp-includes` password-toggle JS) since 5.3 — reuse it rather than hand-rolling. |
| Masked redisplay of a saved key (`sk-••••••1234`, last 4 visible) | Re-displaying the full saved key on every page load is a real leak vector (screen-share, shoulder-surf, browser history); masking-with-last-4 is the de facto convention seen across API-key plugins. | LOW-MEDIUM | Requires a "leave blank to keep existing key" submit convention plus a sanitize callback that detects the masked placeholder and skips overwrite — common gotcha (flag for PITFALLS). |
| Field-level validation + inline error/success admin notice on save | WP admins expect the standard `settings_error()` / admin notice pattern, not silent failure or a raw PHP warning. | LOW | E.g. validate the API key format before save, or do a lightweight live "Verify connection" round-trip call to OpenAI on save (deferred to v1.x, see MVP). |
| Capability-gated settings page (`manage_options`) | Standard WP expectation: only admins (or this capability) can view/edit a settings page holding a secret. Missing this is treated as a security bug in plugin reviews. | LOW | `add_options_page()`/`add_menu_page()` with explicit `'manage_options'` capability check inside the render callback too (defense in depth — menu hiding alone is not access control). |
| Shortcode with documented attributes, e.g. `[khaveeai_avatar voice="alloy" instructions="..."]` | Shortcodes are the lowest-common-denominator embed mechanism expected by every WP user, especially on classic-editor/page-builder sites (Elementor, Divi) that don't support Gutenberg blocks natively. | LOW-MEDIUM | Must work standalone in *any* editor, not just Gutenberg — classic editor, widgets, Elementor "shortcode" widget, page builders. |
| Equivalent Gutenberg block with the same configurable fields | All current AI-chatbot/3D-viewer plugins surveyed (AI Engine, Rapls AI Chatbot, AI Chatbot Builder, 3D Viewer Block) ship both a shortcode AND a block — block-only or shortcode-only is read as outdated/incomplete in 2026. | MEDIUM | Block inspector controls (e.g. `TextareaControl`/`SelectControl`/`MediaUpload` panel) must map 1:1 to the shortcode attributes — this is the standard pattern, not a v2 nicety. |
| Per-instance override of global defaults via shortcode/block attributes | E.g. global default voice = "alloy", but one page can embed `[khaveeai_avatar voice="ash"]`. This "global default + per-instance override" model is the standard pattern in every multi-instance WP embed plugin (forms, popups, chat widgets). | LOW-MEDIUM | Attribute resolution order: shortcode/block attr (if explicitly set) > plugin global option > hardcoded fallback. Must distinguish "explicitly set to empty" from "not set" if using empty string as a sentinel — prefer `null`/unset checks. |
| Media Library integration for avatar file upload (`wp.media` picker) | WP admins expect any file-upload UI to go through the native Media Library modal (drag-drop, existing-file reuse, file browser) — a raw `<input type=file>` posting to a custom AJAX handler feels broken/non-native. | MEDIUM | `.glb`/`.vrm` are NOT in WP's default allowed-mimes list — must be explicitly allow-listed via the `upload_mimes` filter, and ideally validated server-side beyond extension-sniffing (see Dependency Notes). |
| WP REST endpoint that proxies/mints credentials server-side (key never sent to browser) | This is the entire reason the plugin exists in "Custom mode" — table stakes, not a differentiator, given the constraint that the OpenAI key must never reach the browser. | MEDIUM-HIGH | This is **not** the standard authenticated-user `wp_rest`-nonce flow — the widget must work for anonymous, logged-out site visitors. Needs a public (`permission_callback => '__return_true'`) endpoint plus its own rate-limiting/abuse mitigation, since standard nonce auth assumes a logged-in WP session. Direct PHP analog of the existing `src/app/api/negotiate/route.ts`. |
| Frontend script/style enqueued only on pages that actually use the shortcode/block | Standard WP performance expectation — loading a multi-MB three.js/VRM JS bundle sitewide on every page (rather than only pages with the embed) is a recurring complaint pattern in plugin reviews ("bloat", "slows down every page"). | LOW-MEDIUM | Use `has_shortcode()`/block-presence detection (`has_block()`) on `wp_enqueue_scripts`, or conditionally enqueue from inside the shortcode/render callback itself. |
| Graceful degradation / clear error state when API key is missing or invalid | If admin forgets to configure the key, the frontend embed should show a clear (ideally admin-only-visible) message, not a silent blank box or raw JS console error — table stakes for any "you must configure this" plugin. | LOW | Render an inline notice only to users who can `manage_options`; show a generic/neutral placeholder to regular visitors. |

### Differentiators (Competitive Advantage)

Features that set khaveeai apart from generic chat-widget or chatbot plugins. Should map to the Core Value (vendor-neutral voice pipeline, full-duplex realtime voice, not just text chat).

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Full-duplex real-time *voice* conversation (not text chat widget) | Nearly every competing WP "AI chatbot" plugin (AI Engine, BitBot, WPBot) is text-first with optional TTS bolted on. A true WebRTC voice conversation via `OpenAIRealtimeProvider` is a meaningfully different, higher-value capability. | Already built (out of scope this milestone) | This is the existing `OpenAIRealtimeProvider` — the plugin's job is just to surface it, not rebuild it. |
| Animated 3D VRM/GLB avatar with lip-sync tied to voice output | No competing AI-chat WP plugin in the categories surveyed ships an animated VRM avatar; 3D-model-viewer plugins (3D Viewer, Advanced 3D Viewer) show static/rotating models with no voice/lip-sync tie-in. This combination is the actual differentiator. | Already built (out of scope this milestone) | `VRMAvatar`/`GLBAvatar` + lip-sync hook already exist; plugin surfaces them via the Media-Library-uploaded file. |
| Swappable config-source/token-provider strategy (Custom mode now, Platform mode later) without touching the JS bundle | Most competing plugins hardcode "bring your own API key" with no forward path to a managed/hosted tier — building the seam now (per Key Decisions in PROJECT.md) means a future "Platform mode" is a backend-only addition, not a rewrite. | MEDIUM | This is an architecture decision more than a user-facing feature in v1 — differentiates the *plugin's* extensibility for khaveeai's own roadmap, not necessarily visible to end WP admins yet. |
| Personality/instruction textarea (system prompt control) exposed directly in WP admin | Some competing plugins expose this; many don't, or bury it behind a paid tier. Exposing full instruction control for free in v1 differentiates against "AI Engine"-style plugins that gate prompt customization behind premium. | LOW | Plain `<textarea>` bound to an `instructions` config field passed straight to `OpenAIRealtimeProvider`. |
| Voice picker exposing all OpenAI Realtime voice options | Direct mapping to the underlying SDK's existing voice enum — minor but polishes the "feels complete" bar relative to chat-only competitors that don't expose voice choice at all. | LOW | Populate `<select>` options from the same string-literal union already defined in `RealtimeConfig`/`OpenAIRealtimeProvider` types — single source of truth, do not hand-duplicate the list in PHP. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that look good on a roadmap slide but create disproportionate complexity, support burden, or scope creep for a v1 embed plugin.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Multiple named "bot profiles" / multi-instance config management UI (à la AI Engine's multi-chatbot manager) | Power users will ask "can I have a different avatar/personality per page?" early. | This is a v1 scope trap — building a full CRUD profile manager (list, create, duplicate, delete bot configs) is a different, much larger feature than "one global default + per-shortcode override," which the PROJECT.md target features already satisfy via shortcode/block attribute overrides. | Ship "one global default config + per-instance shortcode/block attribute overrides" only. If true multi-profile management is wanted later, it's a clean v1.x/v2 add-on, not a v1 blocker. |
| Custom encryption-at-rest for the OpenAI API key beyond `wp_options` + capability gating | Security-conscious admins/reviewers will flag "the API key is stored in plaintext in the database." | Symmetric encryption-at-rest in WP requires solving secure key storage (the encryption key itself can't live next to the encrypted value in the DB) — proper implementations (e.g. Google Site Kit's `Data_Encryption` class) require a `wp-config.php`-level constant the admin must manually add, which materially raises setup friction for a v1, beginner-targeted plugin and contradicts "fully self-configured in WP admin." | Standard `wp_options` storage + strict capability gating (`manage_options`) + never echoing the full key back into page source/REST responses + optionally documenting (not requiring) a `wp-config.php` constant override (`KHAVEEAI_OPENAI_API_KEY`) for advanced/security-conscious admins, where the constant takes precedence over the DB option if defined. |
| Supporting every page builder's native widget format (Elementor widget, Divi module, Beaver Builder module) in v1 | "Just add an Elementor widget too" sounds like a small ask once shortcode + block exist. | Each page builder has its own widget/module registration API; shortcode support already covers ~100% of page builders (every builder has a generic "shortcode" or "HTML" widget) — building native Elementor/Divi modules is 2-3x the surface area for marginal UX gain. | Ship shortcode + Gutenberg block only. Document that the shortcode works inside any page builder's shortcode/HTML widget. Revisit native builder widgets only if there's demonstrated demand. |
| Client-side configurable "advanced" realtime parameters (temperature, max tokens, full VAD threshold tuning, etc.) exposed in the WP admin UI | Power users / the plugin author's own dev instincts will want to expose every `RealtimeConfig` field as a settings UI control "for completeness." | This is the classic WP "over-configurable" bloat pattern called out repeatedly in plugin criticism ("Frankenstein plugins," excessive style/config knobs) — most WP admins configuring a voice avatar do not know what VAD silence thresholds are, and a 20-field settings page actively hurts onboarding. | Expose only: API key, instructions, voice, avatar file. Keep all other `RealtimeConfig` fields at sane hardcoded defaults in the JS bundle for v1. Advanced tuning can be a documented `wp_filter`/constant override for developers, not an admin UI field. |
| Built-in analytics/usage dashboard (conversation logs, token usage charts) inside the plugin | Natural "while we're in here" addition once the voice pipeline is working, and several competing AI plugins (BitBot, AI Engine) monetize on usage analytics as a premium feature. | Conversation logging introduces data-retention/privacy obligations (GDPR-relevant if voice transcripts are stored) entirely orthogonal to "embed a voice avatar," and usage/token analytics requires either proxying through khaveeai's own backend (out of scope: Custom mode has zero cross-repo dependency) or duplicating OpenAI's own usage dashboard. | Defer entirely. If usage visibility is wanted later, point admins to their own OpenAI dashboard for Custom mode; usage analytics becomes a natural fit only once a future Platform mode exists with khaveeai's backend already in the request path. |
| Auto-generating/bundling a default VRM avatar inside the plugin | Reduces "what do I upload" friction for total beginners. | VRM/GLB avatar files are typically several MB to tens of MB — bundling one inside the plugin zip bloats the plugin package itself and conflicts with WordPress.org's plugin size guidelines/review expectations for plugin directory submissions. | Ship with no default model file; clearly document where to get a free VRM (e.g. VRoid Hub) and require upload via Media Library. Optionally link out rather than bundle. |
| Multi-tab settings page for a handful of fields | Multi-tab settings UIs feel "professional" and several larger competing plugins (AI Engine) use them once they accumulate many features. | With only 4 config fields (API key, instructions, voice, avatar) for v1, a tabbed UI is premature structure — it adds navigation overhead and JS for zero organizational benefit at this field count, and is itself a mild over-engineering anti-pattern at this scope. | Single flat settings page (one screen, one Save button) for v1. Revisit tabs only if field count grows materially (e.g. Platform mode adds a distinct "Mode" tab later). |

## Feature Dependencies

```
Admin Settings Page (API key, instructions, voice, avatar upload)
    └──requires──> WP Settings API registration (register_setting/add_options_page)
                       └──requires──> manage_options capability gate

Media Library Avatar Upload
    └──requires──> upload_mimes filter allow-listing .glb/.vrm
                       └──requires──> server-side file-type validation beyond extension check

Shortcode [khaveeai_avatar ...]
    └──requires──> Global default config (read from wp_options)
                       └──requires──> Admin Settings Page (saved options)

Gutenberg Block (same attributes as shortcode)
    └──requires──> Shared PHP attribute-resolution function
                       └──enhances──> Shortcode (same resolution logic, no duplicated defaulting)

Frontend JS bundle (avatar render + RealtimeProvider wiring)
    └──requires──> WP REST ephemeral-token route (mints token server-side)
                       └──requires──> Admin Settings Page (API key must be configured)
                       └──conflicts-with──> Standard wp_rest nonce auth (anonymous visitors have no WP session)

Conditional script/style enqueueing
    └──requires──> has_shortcode()/has_block() detection
                       └──enhances──> Page load performance (anti-bloat table stakes)

Config-source / token-provider PHP strategy seam
    └──enables (future)──> Platform mode (out of scope this milestone)
```

### Dependency Notes

- **Shortcode and Gutenberg block both require a shared PHP attribute-resolution function:** Both entry points must resolve "shortcode/block attribute → plugin global default → hardcoded fallback" identically. If this logic is duplicated instead of shared, the two embed methods will drift out of sync over time (a documented real-world pain point — competing plugins that maintain shortcode and block logic separately tend to have the block lag the shortcode in feature parity).
- **REST ephemeral-token route conflicts with standard `wp_rest` nonce auth:** The standard WP REST authentication pattern (`X-WP-Nonce` header + logged-in cookie) assumes an authenticated WP user session — confirmed via the official REST API Authentication docs. This widget must work for anonymous, logged-out site visitors viewing a public page — so the token-minting endpoint needs `permission_callback => '__return_true'` (public) plus its own abuse mitigation (rate limiting per IP, referrer/origin checking, optional short-lived signed token), not reliance on WP's built-in nonce system. This is a meaningful divergence from "standard" WP REST route conventions and should be flagged for the architecture/pitfalls research and roadmap phase planning.
- **Media Library avatar upload requires both the `upload_mimes` filter AND server-side validation:** Allow-listing the MIME type alone (`upload_mimes` filter) is necessary just to get WP to accept the upload, but WP's MIME detection for unusual binary formats like `.glb`/`.vrm` is extension-based and spoofable — additional validation (e.g., checking GLB's binary magic header `glTF`) is needed to avoid becoming an arbitrary-file-upload vector if reusing the public Media Library upload pipeline.
- **Config-source/token-provider seam enables (but does not require) Platform mode:** Building this strategy interface now means v1 ships with only one concrete implementation (Custom mode reading from `wp_options`), but the seam itself has no dependents yet — it is forward-compatible architecture, not a feature with its own UI in this milestone.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate "WP admin can self-configure and embed a working voice avatar."

- [ ] Settings page (Settings API) with: OpenAI API key (masked password field, last-4 redisplay), personality/instructions textarea, voice picker (`<select>`), avatar upload (Media Library picker, `.glb`/`.vrm` allow-listed) — essential, this is the entire "self-configured" value proposition
- [ ] `[khaveeai_avatar]` shortcode with attribute overrides (voice, instructions, avatar) falling back to global settings — essential, lowest-common-denominator embed path that works in any editor/page builder
- [ ] Gutenberg block with inspector controls mirroring the shortcode's attributes, sharing the same PHP attribute-resolution logic — essential per PROJECT.md target features, and expected baseline in 2026 even though shortcode alone would technically work
- [ ] WP REST route minting an ephemeral OpenAI Realtime token server-side, publicly accessible (no WP login required) with basic rate-limiting — essential; this is the entire reason "the key never reaches the browser" constraint can be satisfied
- [ ] Conditional script/style enqueueing only on pages containing the shortcode/block — essential to avoid the #1 "this plugin slows down my whole site" complaint pattern
- [ ] Admin-only error/notice state when API key is missing/invalid — essential minimum error handling, prevents silent breakage

### Add After Validation (v1.x)

Features to add once the core embed flow is proven to work end-to-end on a real WP site.

- [ ] `wp-config.php` constant override for the API key (`KHAVEEAI_OPENAI_API_KEY`) as an advanced/security-conscious-admin option — trigger: a security-minded user/reviewer specifically asks for non-DB key storage
- [ ] Live "Test Connection" button on the settings page (round-trips a lightweight call to OpenAI to confirm the key works before saving) — trigger: support requests about "it's not working" that trace back to bad/expired keys
- [ ] Per-page "disable avatar" override or position/size styling options (if requested) — trigger: real user feedback that the embed needs visual placement control beyond default

### Future Consideration (v2+)

Features to defer until Custom mode is validated and/or Platform mode work begins.

- [ ] Platform mode (API-key-driven config pulled from hosted `khavee-app`) — explicitly out of scope this milestone per PROJECT.md, blocked on a `khavee-app` backend addition
- [ ] Multi-profile / multi-bot configuration manager — defer until real demand for "different avatar per page" emerges beyond what shortcode/block per-instance overrides already cover
- [ ] Native page-builder widgets (Elementor/Divi/Beaver Builder) — defer; shortcode already covers these via generic shortcode/HTML widgets in every builder
- [ ] Usage/conversation analytics dashboard — defer indefinitely for Custom mode (no backend to aggregate against); natural fit only once Platform mode exists
- [ ] Multi-tab settings UI — defer until field count grows enough to justify it (e.g. when Platform mode adds a distinct mode-selection tab)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Settings API page (API key, instructions, voice, avatar) | HIGH | MEDIUM | P1 |
| Masked API key field + last-4 redisplay | HIGH | LOW | P1 |
| Shortcode with attribute overrides | HIGH | LOW-MEDIUM | P1 |
| Gutenberg block (shared logic with shortcode) | HIGH | MEDIUM | P1 |
| WP REST ephemeral-token route (public, rate-limited) | HIGH | MEDIUM-HIGH | P1 |
| Media Library upload with `.glb`/`.vrm` allow-listing + validation | HIGH | MEDIUM | P1 |
| Conditional script/style enqueueing | MEDIUM | LOW-MEDIUM | P1 |
| Admin-only missing-key error notice | MEDIUM | LOW | P1 |
| Config-source/token-provider strategy seam (architecture) | MEDIUM (future-facing) | MEDIUM | P1 |
| `wp-config.php` constant key override | LOW-MEDIUM | LOW | P2 |
| "Test Connection" button | MEDIUM | LOW-MEDIUM | P2 |
| Multi-profile config manager | MEDIUM | HIGH | P3 |
| Native page-builder widgets | LOW | HIGH | P3 |
| Usage/analytics dashboard | LOW (Custom mode) | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | AI Engine / chatbot-category plugins | 3D Viewer / GLB-embed-category plugins | Our Approach (khaveeai) |
|---------|---------------------------------------|------------------------------------------|--------------------------|
| Settings storage | `wp_options` via Settings API, often multi-tab UI for many features | `wp_options` + custom post type for managing multiple named viewers | `wp_options` via Settings API, single flat settings page (no multi-tab needed at this feature count) |
| API key handling | Masked password-style field, key tested against vendor API on save (some plugins) | N/A (no third-party API key needed for static 3D viewers) | Masked password field + last-4 redisplay; "Test Connection" deferred to v1.x |
| Shortcode + block | Both shipped, kept in sync by the plugin's own internal config object | Both shipped (e.g. 3D Viewer Block ships both) | Both shipped, explicitly sharing one PHP attribute-resolution function to avoid drift |
| File/media handling | N/A (text-based) | Custom post type per 3D model + Media Library upload, `upload_mimes` filter for `.glb`/`.gltf` | Media Library upload for avatar `.glb`/`.vrm`, allow-listed via `upload_mimes`, validated server-side |
| Multi-instance config | Full bot-profile manager (list/create/duplicate chatbots), often paid-tier-gated | Per-viewer custom post type, each with own settings | Single global default + per-shortcode/block override only (v1); full profile manager deferred to v2+ |
| Differentiator vs us | Text-first chat, often no voice or only basic TTS bolted on | Static/rotating 3D model, no voice/AI tie-in at all | Full-duplex realtime *voice* conversation + lip-synced animated avatar — no surveyed competitor combines both |

## Sources

- [Settings API – Plugin Handbook](https://developer.wordpress.org/plugins/settings/settings-api/) — HIGH confidence, official docs
- [5 Ways to Create a WordPress Plugin Settings Page (Delicious Brains)](https://deliciousbrains.com/create-wordpress-plugin-settings-page/) — MEDIUM confidence
- [Storing Confidential Data in WordPress — felix-arntz.me](https://felix-arntz.me/blog/storing-confidential-data-in-wordpress/) — MEDIUM-HIGH confidence (author is a WordPress core contributor; pattern matches Google Site Kit's actual shipped implementation)
- [How to safely store API keys and access protected external APIs in WordPress — Full Stack Digital](https://fullstackdigital.io/blog/how-to-safely-store-api-keys-and-access-protected-external-apis-in-wordpress/) — MEDIUM confidence
- [Day 38: Masking Strategy to Hide API Keys in WordPress Settings](https://pushpenderindia.wordpress.com/2024/09/06/day-38-masking-strategy-to-hide-api-keys-in-wordpress-settings/) — LOW-MEDIUM confidence (single blog source, but consistent with broader convention seen across plugin reviews)
- [block.json – Block Editor Handbook](https://developer.wordpress.org/block-editor/getting-started/fundamentals/block-json/) — HIGH confidence, official docs
- [Metadata in block.json – Block Editor Handbook](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-metadata/) — HIGH confidence, official docs
- [REST API Authentication – Developer.WordPress.org](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/) — HIGH confidence, official docs (confirms nonce auth requires a logged-in cookie session — informs the "conflicts with anonymous visitor" dependency note)
- [AI Engine plugin (WordPress.org)](https://wordpress.org/plugins/ai-engine/) — MEDIUM confidence, real shipped plugin, examined for shortcode/block/multi-bot-profile pattern
- [3D Viewer – glb/gltf Viewer by WPSE (WordPress.org)](https://wordpress.org/plugins/advanced-3d-model-viewer/) — MEDIUM confidence, real shipped plugin, examined for GLB Media Library/CPT pattern
- [The origin of WordPress plugin bloat — wpjohnny.com](https://wpjohnny.com/origin-of-wordpress-plugin-bloat/) — MEDIUM confidence, informs anti-feature rationale
- [The Impact Of Plugin Bloat On WordPress Speed — wpsiteplan.com](https://wpsiteplan.com/blog/impact-of-plugin-bloat-on-wordpress-speed/) — MEDIUM confidence, informs conditional-enqueueing table-stakes rationale
- Internal: `.planning/PROJECT.md` — project requirements, constraints, and Key Decisions for this milestone

---
*Feature research for: WordPress voice-avatar embed plugin (khaveeai, Custom mode v2.0)*
*Researched: 2026-06-21*
