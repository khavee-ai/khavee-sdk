# Phase 8: Frontend Bundle, Shortcode & Block - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the WordPress plugin's frontend half: a single bundled JS asset (new `packages/wp-bundle` build package, wrapping `@khaveeai/react` + `@khaveeai/providers-openai-realtime`'s `OpenAIRealtimeProvider`) mounted via two shared-render-path entry points — a `[khaveeai_avatar]` shortcode and an equivalent Gutenberg block — with per-instance attribute overrides (voice/instructions/avatar) that fall back to Phase 7's global settings. The bundle is enqueued only on pages that actually contain the shortcode/block (PERF-01). The Gutenberg block's editor preview never mounts the live SPA or triggers mic/token activity (EMBED-05). This phase also extends Phase 6's REST route with a validated per-instance override path — Phase 6 deliberately ignored client-sent voice/instructions; this phase adds a narrow, whitelisted exception for the per-instance case without reopening that security boundary. No changes to `OpenAIRealtimeProvider`, `ConfigSourceInterface`, or `TokenProviderInterface` beyond what the override path strictly requires.

</domain>

<decisions>
## Implementation Decisions

### Idle / Connecting Visual States
- **D-01:** Idle state (before the visitor clicks to connect): the VRM/GLB avatar renders immediately in a static idle pose (proves the model loaded), with a "Click to talk" button/overlay on top. Matches the existing demo app's `VRMAvatar`/`GLBAvatar` rendering pattern (`src/app/openai/page.tsx`). Per PITFALLS.md Pitfall 6/UX guidance, this click is the explicit gesture required before any mic permission request or token mint — never auto-connect on page load.
- **D-02:** Connecting state (after click, before WebRTC connects): a subtle loading indicator/pulse overlays the avatar itself; the button becomes disabled or shows "Connecting...". The avatar stays visible the whole time — no full-widget swap, no layout shift.

### Per-Instance Override UX & Mechanism
- **D-03:** Shortcode attribute syntax: `[khaveeai_avatar voice="echo" instructions="..." avatar="123"]` — plain WP shortcode attributes matching the settings-page field names. `avatar` is a Media Library attachment ID (consistent with Phase 7's storage-by-ID decision for the global avatar, not a raw URL). Any omitted attribute falls back to the global setting (EMBED-02).
- **D-04:** Gutenberg block inspector controls mirror the settings page exactly: same voice `<select>` (10 OpenAI voices), same instructions `<textarea>`, same `wp.media` avatar picker — each field shows a "(using global default)" placeholder when empty, teaching the same mental model as Phase 7's settings page (EMBED-03's "inspector controls mirror the shortcode's attributes" + consistency with Phase 7 D-01's plain-form approach).
- **D-05 (load-bearing security decision):** Phase 6 D-07 made the REST route ignore client-sent `voice`/`instructions` entirely — it always injects the admin's global config, closing a "jailbreak-via-public-endpoint" gap. This phase needs that gap to stay closed while still letting EMBED-02's per-instance overrides actually take effect at the session level (not just cosmetically in rendered HTML). Resolution: the REST route gains an explicit, narrowly validated override mechanism — `voice` must be one of the 10 known OpenAI voices (anything else is rejected/ignored, never passed through raw), `instructions` has an enforced length cap, `avatar` must resolve to a real, existing Media Library attachment ID (no arbitrary URLs). The shortcode/block's rendered bootstrap config supplies these values to the bundle, which sends them to the route; the route validates before using them — this is additive to Phase 6's contract, not a removal of its protection. Phase 6's `SessionController`/`ConfigSourceInterface`/`TokenProviderInterface` classes are not otherwise modified.

### Not-Configured / Error Placeholder (Frontend half of SET-06 / EMBED criterion 6)
- **D-06:** Admin-only inline notice: when the API key is missing/invalid, an admin viewing a page with the embedded avatar sees a WP-admin-notice-styled banner INSIDE the widget's mount point — "Khavee AI Avatar isn't configured yet — [Go to Settings]" linking to the Phase 7 settings page. This notice is rendered server-side (PHP) ONLY when `current_user_can('manage_options')` is true — logged-out visitors never receive this markup in the page source at all, not merely CSS-hidden. Reuses Phase 7's `is_configured()` contract (D-13 in `07-CONTEXT.md`).
- **D-07:** Logged-out visitor sees a static avatar silhouette/generic placeholder image in the same mount point — no live 3D model, no "Click to talk" button, no error text, no console error. Visually present (not a blank gap) but clearly inert.

### Build & Distribution
- **D-08:** A new workspace package, `packages/wp-bundle`, is the build tool for the WordPress frontend bundle — sibling to `packages/core`, `packages/react`, `packages/providers/*` in the pnpm workspace, so it resolves `@khaveeai/react` and `@khaveeai/providers-openai-realtime` the same way every other package does. Built with Vite or esbuild (NOT `tsc` — this produces one consumer-facing bundle file, not a library with type declarations). Output is copied into `wordpress-plugin/build/khaveeai-bundle.js` (and a separate, much smaller `wordpress-plugin/assets/editor.js` for the Gutenberg editor-side script per D-05 of `ARCHITECTURE.md`'s recommended structure — see Canonical References).
- **D-09:** The built bundle (`wordpress-plugin/build/khaveeai-bundle.js`) IS committed to git, rebuilt whenever source changes. Rationale: site owners installing the plugin via zip/clone need a working build immediately with no Node/pnpm toolchain on their server — unlike `wordpress-plugin/vendor/` (Composer, gitignored, regenerable via a PHP-only `composer install` that any PHP host can run), there is no equivalent zero-toolchain JS regeneration path available to a typical WP site owner.
- **D-10 (Pitfall 4 resolution):** Full bundle isolation — the Vite/esbuild output is a self-contained IIFE that never assigns `window.React`/`window.ReactDOM` and never declares a dependency on WP-core's registered `react`/`react-dom` script handles (no `@wordpress/dependency-extraction-webpack-plugin`-style externalization). This is the safer default per PITFALLS.md Pitfall 4, since this plugin specifically needs React 19 and WP-core's bundled React version was not verified during milestone research. Trade-off accepted: larger bundle size (React may be duplicated if another active plugin also bundles its own), in exchange for zero collision risk with WP-core's Gutenberg-editor React or any theme/plugin combination.

### Claude's Discretion
- Exact PHP class/file names beyond what `ARCHITECTURE.md`'s recommended structure already specifies (`Render/AvatarRenderer.php`, `Shortcode/AvatarShortcode.php`, `Block/AvatarBlock.php` + `block.json`, `Assets/AssetManager.php`) — these names are the canonical recommendation from research; deviate only if there's a concrete reason.
- Exact wording/copy for the "Click to talk" button, the connecting-state label, the not-configured banner's link text, and the silhouette placeholder's visual design — left to implementation; should follow plain WP-admin-notice conventions for the admin-facing banner (no decorative emoji per CLAUDE.md), and a simple, professional static image/SVG for the visitor-facing silhouette.
- Whether the per-instance override validation (D-05) lives as new methods on `SessionController` directly or as a small new helper class — implementation detail, as long as the validation is server-side, fail-closed (reject anything not in the whitelist, never pass through raw), and does not touch `ConfigSourceInterface`/`TokenProviderInterface`'s existing method signatures.
- Exact mechanism for `wp_plupload_default_settings`-style enqueue conditionals (`has_shortcode()`/`has_block()` detection per PERF-01) — implementation detail of `AssetManager.php`; the requirement (asset present only on pages containing the shortcode/block) is fixed, the exact detection code path is not discussed.
- Whether the override validation in D-05 is enforced inline in `SessionController::create_session()` or factored into a small dedicated validator — planner's call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone planning artifacts
- `.planning/ROADMAP.md` (Phase 8 section) — phase goal, 6 numbered success criteria, requirement IDs (EMBED-01..05, PERF-01)
- `.planning/REQUIREMENTS.md` (EMBED-01..05, PERF-01) — exact requirement wording for this phase
- `.planning/PROJECT.md` — milestone context, "Custom mode only" constraint, Key Decisions table

### Architecture & pitfalls research (this milestone)
- `.planning/research/ARCHITECTURE.md` — recommended project structure (`Render/AvatarRenderer.php`, `Shortcode/AvatarShortcode.php`, `Block/AvatarBlock.php`/`block.json`, `Admin/SettingsPage.php` already built, `Assets/AssetManager.php`), Pattern 2 ("One shared render path, two thin registration adapters" — the load-bearing pattern this phase implements), Pattern 3 (REST controller as the contract seam), the `build/khaveeai-bundle.js` + `assets/editor.js` separate-bundle rationale
- `.planning/research/PITFALLS.md` — Pitfall 4 (React version collision, resolved via D-10), Pitfall 5 (script enqueue ordering / manifest-driven `$deps`, relevant to `AssetManager.php`), Pitfall 6 (Gutenberg editor/front-end split — `editorScript`/`viewScript`, directly drives EMBED-05), Pitfall 9 (WP.org disclosure, relevant only if/when publicly distributed — out of scope for this milestone's build but documented for awareness), the full "Looks Done But Isn't" checklist (React bundle isolation verification, Gutenberg editor preview verification)
- `.planning/research/STACK.md` — any WP-side build-tooling stack notes (Vite/esbuild recommendation source)

### Existing code this phase builds on (Phases 6-7, NOT to be broken)
- `wordpress-plugin/includes/Rest/SessionController.php` — gains the new validated per-instance override mechanism (D-05); existing global-config-injection behavior (Phase 6 D-07) for the no-override case must not change
- `wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php` / `WpOptionsConfigSource.php` — `is_configured()` (Phase 7 D-13) is the contract this phase's admin notice (D-06) consumes; `get_runtime_config()` is the global-defaults source that shortcode/block attributes fall back to (D-03/D-04)
- `wordpress-plugin/includes/Admin/SettingsPage.php` — the voice `<select>`/instructions `<textarea>`/avatar `wp.media` picker patterns this phase's Gutenberg inspector (D-04) mirrors; the settings page IS the link target for D-06's admin notice
- `wordpress-plugin/includes/Plugin.php` — composition root; new `Render/AvatarRenderer.php`, `Shortcode/AvatarShortcode.php`, `Block/AvatarBlock.php`, `Assets/AssetManager.php` classes wire in here following the existing constructor-injection pattern (no DI container)
- `wordpress-plugin/khaveeai.php` — PSR-4 autoload bootstrap; new namespaced classes under `includes/` need no `composer.json` change if namespaced correctly under `Khavee\Plugin\`

### Existing TypeScript contract this bundle wraps (NOT to be modified)
- `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` — the `RealtimeProvider` implementation the bundle instantiates with `useProxy: true` and `proxyEndpoint` pointing at the REST route; lines 134-226 are the `connect()` contract this plugin's PHP route must satisfy (already built in Phase 6)
- `packages/core/src/types/realtime.ts` lines 27-56 — `RealtimeConfig.proxyEndpoint`, the 10-voice enum (`alloy | ash | ballad | coral | echo | sage | shimmer | verse | marin | cedar`) — the authoritative whitelist for D-05's voice validation
- `packages/react/src/KhaveeProvider.tsx`, `packages/react/src/VRMAvatar.tsx`/`GLBAvatar.tsx`, `packages/react/src/hooks/useRealtime.ts` — the React layer this bundle wraps; `chatStatus` drives the idle/connecting/speaking visual states (D-01/D-02)
- `src/app/openai/page.tsx` — the closest existing reference pattern for "construct one provider, wrap in `KhaveeProvider`, render `VRMAvatar`" — NOT a 1:1 template (it's a Next.js page, not a WP-embeddable IIFE), but the React composition pattern transfers directly

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@khaveeai/react`'s `KhaveeProvider`/`useRealtime`/`VRMAvatar`/`GLBAvatar` — the entire React rendering/state layer this bundle wraps; no new avatar-rendering logic needs to be written, only a WP-specific mount/bootstrap wrapper around it.
- `@khaveeai/providers-openai-realtime`'s `OpenAIRealtimeProvider` — the exact provider class to instantiate, configured with `useProxy: true` + `proxyEndpoint` pointing at Phase 6's REST route.
- Phase 7's `SettingsPage.php` voice `<select>`/instructions `<textarea>`/avatar `wp.media` picker markup — directly mirrored (not just referenced) by the Gutenberg block's inspector per D-04.

### Established Patterns
- "Backend proxy assumption" — already established across Phases 6-7; this phase's bundle continues it by never holding an API key, only ever calling the REST route.
- WP Settings API plain-form approach (Phase 7 D-01) — extended here to the Gutenberg inspector's field choices (D-04), for UI consistency across the plugin's two configuration surfaces (global settings page vs. per-instance block attributes).
- Constructor-injection composition root (`Plugin.php`, no DI container) — new render/shortcode/block/asset classes wire in the same way `SessionController`/`SettingsPage` already do.

### Integration Points
- `SessionController::create_session()` is the one place D-05's override validation logic plugs in — must coexist with Phase 6's existing rate-limiting (`RateLimiter.php`) and the existing no-override-trusts-global-config path.
- `AssetManager.php` (new) is the one place enqueue logic lives — must hook late enough that `has_shortcode()`/`has_block()` detection works (per PITFALLS.md Pitfall 5's guidance to enqueue conditionally from the render callback, not a blanket site-wide hook).
- `Render/AvatarRenderer.php` (new) is the single shared function `AvatarShortcode.php` and `AvatarBlock.php` both call — the literal implementation of D-03/D-04's "shortcode and block must not drift apart" requirement (EMBED-04).

</code_context>

<specifics>
## Specific Ideas

- Mask/placeholder text patterns should match Phase 7's plain, undecorated WP-admin-notice style — no emoji, per CLAUDE.md's logging/comment conventions extended to UI copy (carried forward from `07-CONTEXT.md`'s same note).
- The admin notice (D-06) and the settings-page "not configured" banner (Phase 7 D-14) are DISTINCT surfaces sharing the same `is_configured()` check — this phase's notice is NOT a duplicate of Phase 7's, it's the frontend-embed half explicitly scoped out of Phase 7 (per `07-CONTEXT.md` D-12/D-13's framing).
- Voice/instructions/avatar override validation (D-05) must be genuinely fail-closed: an invalid voice value is REJECTED (falls back to global), not silently passed through to OpenAI's API as a free-form string.

</specifics>

<deferred>
## Deferred Ideas

- WP.org public distribution readiness (readme.txt "External services" disclosure section, unminified-source-link requirement per PITFALLS.md Pitfall 9) — not discussed as part of this phase's scope; relevant only if/when the plugin is submitted to WordPress.org, which is not confirmed as a goal for this milestone.
- A live, click-triggered 3D preview inside the Gutenberg editor (beyond the static inert preview EMBED-05 requires) — not raised during this discussion; if wanted later, would need to be explicitly gated behind a user click per PITFALLS.md Pitfall 6's guidance, and is new scope, not an oversight here.

None — discussion stayed within phase scope otherwise.

</deferred>

---

*Phase: 8-frontend-bundle-shortcode-block*
*Context gathered: 2026-06-25*
