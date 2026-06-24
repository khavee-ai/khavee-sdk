# Phase 8: Frontend Bundle, Shortcode & Block - Research

**Researched:** 2026-06-25
**Domain:** WordPress shortcode/Gutenberg block embedding of a bundled React/Three.js VRM avatar SPA, built via a new non-`tsc` bundler package in the existing pnpm workspace
**Confidence:** HIGH (WP shortcode/REST/enqueue APIs, existing PHP contract, esbuild/Vite IIFE bundling) / MEDIUM (Gutenberg dynamic-block `viewScript` reliability — verified against an open WP Core trac ticket, not a closed/fixed issue) / LOW (none — all claims below are either verified against the codebase, official docs, or explicitly flagged)

## Summary

This phase wraps already-built TypeScript SDK packages (`@khaveeai/react`, `@khaveeai/providers-openai-realtime`) into one self-contained IIFE bundle that WordPress can enqueue, then exposes that bundle through two PHP-side registration adapters — a shortcode and a Gutenberg block — that both funnel through a single shared `AvatarRenderer::render()` call. The hard constraints are: (1) the bundle must never leak `window.React`/`window.ReactDOM` or assume WP-core's bundled React (full isolation, per CONTEXT.md D-10), since WP core's actual bundled React version was never verified and this plugin needs React 19; (2) the Gutenberg editor preview must NEVER mount the live SPA — it needs a separate, smaller editor-only script and a static/inert preview, achieved via `ServerSideRender` + PHP `render_callback`, NOT via `block.json`'s `viewScript` field, because `viewScript` enqueueing for dynamic (PHP-rendered) blocks is documented as broken in an open WordPress Core Trac ticket (#56470) referenced by Gutenberg issue #43727; (3) the existing `SessionController::apply_trust_model()` (Phase 6) currently strips ALL client-sent `voice`/`instructions`, and this phase must add a narrow, allowlist-validated override path without removing that protection.

The codebase's milestone-level `ARCHITECTURE.md`/`PITFALLS.md`/`STACK.md` research already exists and is authoritative for file/class naming (`Render/AvatarRenderer.php`, `Shortcode/AvatarShortcode.php`, `Block/AvatarBlock.php`, `Assets/AssetManager.php`) and the major pitfalls (React collision, enqueue ordering, editor/front-end split). This phase's own CONTEXT.md has already locked the bundler choice (Vite or esbuild, full isolation) and the override mechanism's shape (D-05) as decisions, not open questions — this research confirms those decisions are technically sound and fills in implementation-level gaps: the `viewScript`-for-dynamic-blocks caveat, the `block.json` `render` vs `render_callback` choice, the exact `wp_enqueue_script` IIFE-global pattern, and the conditional-enqueue mechanics for PERF-01.

**Primary recommendation:** Build `packages/wp-bundle` with esbuild in IIFE format (no externals, no WP-global dependency), output one self-mounting front-end bundle (`khaveeai-bundle.js`) that scans the DOM for `[data-khaveeai-config]` on load and a second, much smaller editor-only script (`assets/editor.js`, built separately, importing only `@wordpress/blocks`/`@wordpress/block-editor`/`@wordpress/server-side-render`, never `@khaveeai/react`) registered via `editorScript` in `block.json`; the front-end render path goes through PHP's `render_callback`/`render` (NOT `viewScript`), with `AssetManager::enqueue()` called from inside that same render path, guarded by `has_shortcode()`/block-presence detection for PERF-01.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Shortcode/block attribute parsing & normalization | API/Backend (PHP) | — | `AvatarShortcode`/`AvatarBlock` are pure PHP adapters; no JS involved in resolving attrs → config |
| Attribute override → global default merge (EMBED-02/04) | API/Backend (PHP) | — | `AvatarRenderer::render()` is the single PHP function; must not be duplicated client-side |
| Mount-point HTML + bootstrap JSON generation | API/Backend (PHP) | — | Server-rendered `<div data-khaveeai-config="...">`, never client-templated |
| Asset enqueueing (conditional, PERF-01) | API/Backend (PHP) | — | `wp_enqueue_script`/`has_shortcode()` — pure WP hook-system concern |
| Avatar SPA mount, VAD-free WebRTC voice pipeline | Browser/Client | — | `@khaveeai/react` + `OpenAIRealtimeProvider` run entirely in-browser; PHP never touches WebRTC |
| Ephemeral token minting + override validation (D-05) | API/Backend (PHP) | — | `SessionController` server-side; this is the actual security boundary, never trust the browser |
| Gutenberg editor block registration + inspector controls | Browser/Client (wp-admin only) | API/Backend (PHP, `ServerSideRender` call target) | `assets/editor.js` registers the block type and renders `InspectorControls`; the literal preview markup still comes from PHP via `ServerSideRender`'s REST call to `render_callback` |
| Admin not-configured notice / visitor placeholder (D-06/D-07) | API/Backend (PHP) | — | Decided entirely server-side via `current_user_can()` before any bundle JS runs; zero client-side branching |
| VRM/GLB model rendering, lip-sync, talking animation | Browser/Client | — | Unchanged `@khaveeai/react` `VRMAvatar`/`GLBAvatar` components, already built |

## Project Constraints (from CLAUDE.md)

- **Compatibility constraint:** `openai-stt-tts` provider stays untouched this milestone — this phase wraps `openai-realtime` (`OpenAIRealtimeProvider`), not `openai-stt-tts`; no overlap risk, but do not accidentally import from `openai-stt-tts` in the bundle.
- **Language boundary:** PHP (`wordpress-plugin/`) and TypeScript (`packages/*`) integrate over HTTP only — the REST contract (`SessionController`) is the seam; the bundle never calls PHP via anything but `fetch()`.
- **No new abstract schema library for tool-calling** — out of scope for this phase (no new tools/function-calling surface introduced here), but if the bundle instantiates `OpenAIRealtimeProvider` with `tools`, it must use the existing plain-JS-object `RealtimeTool` shape, not a new validation library.
- **Vendor neutrality:** not directly exercised by this phase (no new vendor adapter), but the bundle must not hardcode anything that would block a future Bedrock/Gemini `RealtimeProvider` from being swapped in later — config flows through `RealtimeConfig`, unchanged.
- **Naming conventions:** new PHP classes follow existing `Khavee\Plugin\<Namespace>\<ClassName>` PSR-4 pattern (`Khavee\Plugin\Render\AvatarRenderer`, `Khavee\Plugin\Shortcode\AvatarShortcode`, `Khavee\Plugin\Block\AvatarBlock`, `Khavee\Plugin\Assets\AssetManager`), matching `SessionController`/`SettingsPage`/`RateLimiter`'s existing style (final classes, constructor injection, no DI container).
- **Error handling convention:** existing PHP code returns generic, no-detail error bodies (`session_unavailable`, `khaveeai_not_configured`) rather than raw exception text — the new override-validation path (D-05) must follow this same fail-closed, generic-error convention, never echoing why a voice/instructions value was rejected back to the client in a way that aids probing.
- **No DI container** — `Plugin.php` remains the single composition root; new classes are wired with `new X()` calls there, exactly as `WpOptionsConfigSource`/`OpenAiDirectTokenProvider`/`RateLimiter` already are.
- **TypeScript strict mode** — the new `packages/wp-bundle` package's entry/mount script must be written strict-mode-safe (no implicit `any`), consistent with `tsconfig.packages.json`.
- **No emoji in logs/comments/UI copy** — explicitly called out again in this phase's own CONTEXT.md (admin notice copy, button labels) and UI-SPEC.md.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Idle state renders the VRM/GLB avatar immediately in a static idle pose with a "Click to talk" button/overlay on top — matches `src/app/openai/page.tsx`'s `VRMAvatar`/`GLBAvatar` pattern. Never auto-connect on page load (explicit user gesture required before any mic/token activity).
- **D-02:** Connecting state (after click, before WebRTC connects) shows a subtle loading indicator/pulse overlaying the avatar; button disabled/"Connecting...". Avatar stays visible throughout — no full-widget swap, no layout shift.
- **D-03:** Shortcode attribute syntax: `[khaveeai_avatar voice="echo" instructions="..." avatar="123"]` — plain WP shortcode attributes matching settings-page field names. `avatar` is a Media Library attachment ID (consistent with Phase 7's storage-by-ID decision). Omitted attributes fall back to the global setting (EMBED-02).
- **D-04:** Gutenberg block inspector controls mirror the settings page exactly: same voice `<select>` (10 OpenAI voices), same instructions `<textarea>`, same `wp.media` avatar picker — each field shows a "(using global default)" placeholder when empty.
- **D-05 (load-bearing security decision):** Phase 6 D-07 made the REST route ignore client-sent `voice`/`instructions` entirely. This phase needs a narrowly validated override mechanism: `voice` must be one of the 10 known OpenAI voices (anything else rejected/ignored, never passed through raw), `instructions` has an enforced length cap, `avatar` must resolve to a real, existing Media Library attachment ID (no arbitrary URLs). The route validates before using overrides — additive to Phase 6's contract, not a removal. `SessionController`/`ConfigSourceInterface`/`TokenProviderInterface` are not otherwise modified.
- **D-06:** Admin-only inline notice when API key missing/invalid: WP-admin-notice-styled banner INSIDE the widget's mount point — "Khavee AI Avatar isn't configured yet — [Go to Settings]". Server-side (PHP) ONLY when `current_user_can('manage_options')` is true — logged-out visitors never receive this markup in page source at all (not CSS-hidden). Reuses Phase 7's `is_configured()` contract.
- **D-07:** Logged-out visitor sees a static avatar silhouette/generic placeholder image in the same mount point — no live 3D model, no "Click to talk" button, no error text, no console error. Visually present, clearly inert.
- **D-08:** New workspace package `packages/wp-bundle` — sibling to `packages/core`, `packages/react`, `packages/providers/*`. Built with Vite or esbuild (NOT `tsc`). Output copied into `wordpress-plugin/build/khaveeai-bundle.js` and a separate, smaller `wordpress-plugin/assets/editor.js` for the Gutenberg editor-side script.
- **D-09:** Built bundle (`wordpress-plugin/build/khaveeai-bundle.js`) IS committed to git, rebuilt whenever source changes — site owners need a working build immediately with no Node/pnpm toolchain on their server.
- **D-10 (Pitfall 4 resolution):** Full bundle isolation — the Vite/esbuild output is a self-contained IIFE that never assigns `window.React`/`window.ReactDOM` and never declares a dependency on WP-core's registered `react`/`react-dom` script handles (no `@wordpress/dependency-extraction-webpack-plugin`-style externalization). Trade-off accepted: larger bundle size, in exchange for zero collision risk.

### Claude's Discretion

- Exact PHP class/file names beyond what `ARCHITECTURE.md` already specifies — deviate only if there's a concrete reason.
- Exact wording/copy for "Click to talk" button, connecting-state label, not-configured banner link text, silhouette placeholder visual design — follow plain WP-admin-notice conventions (no decorative emoji), simple professional static image/SVG for the silhouette.
- Whether D-05's per-instance override validation lives as new methods on `SessionController` directly or as a small new helper class — implementation detail, as long as validation is server-side, fail-closed, and does not touch `ConfigSourceInterface`/`TokenProviderInterface` signatures.
- Exact mechanism for `has_shortcode()`/`has_block()` enqueue conditionals (PERF-01) — implementation detail of `AssetManager.php`; the requirement (asset present only on pages containing the shortcode/block) is fixed, the exact detection code path is not discussed.
- Whether D-05 validation is enforced inline in `SessionController::create_session()` or factored into a small dedicated validator — planner's call.

### Deferred Ideas (OUT OF SCOPE)

- WP.org public distribution readiness (readme.txt "External services" disclosure, unminified-source-link requirement per PITFALLS.md Pitfall 9) — not in scope this milestone.
- A live, click-triggered 3D preview inside the Gutenberg editor (beyond the static inert preview EMBED-05 requires) — new scope if wanted later, not an oversight here.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EMBED-01 | Site owner can embed the avatar via a `[khaveeai_avatar]` shortcode, usable in any editor or page builder | Standard `add_shortcode()` registration; see Architecture Patterns Pattern 1 and Code Examples |
| EMBED-02 | Shortcode supports per-instance attribute overrides (voice, instructions, avatar) that fall back to global settings when omitted | `wp_parse_args()` merge pattern in `AvatarRenderer::render()`; D-05's REST-side validation closes the security gap this introduces |
| EMBED-03 | Site owner can embed via an equivalent Gutenberg block whose inspector controls mirror the shortcode's attributes | `block.json` attributes schema kept in 1:1 sync with shortcode atts via a single shared PHP constant; see Don't Hand-Roll and Code Examples |
| EMBED-04 | Shortcode and block resolve attributes through one shared PHP function so the two embed methods cannot drift out of sync | `AvatarRenderer::render(array $atts): string` — Pattern 1 below, directly from milestone ARCHITECTURE.md Pattern 2 |
| EMBED-05 | Gutenberg block editor preview never mounts the live SPA, opens a mic prompt, or mints a real token while editing | `ServerSideRender` + PHP `render_callback`/`render`, editor script imports nothing from `@khaveeai/react`; see Common Pitfalls Pitfall 1 (viewScript caveat) |
| PERF-01 | Avatar JS bundle enqueued only on pages containing the shortcode/block, not site-wide | `has_shortcode()` + block-presence check inside the render path, NOT a blanket `wp_enqueue_scripts` hook; see Architecture Patterns Pattern 2 |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| esbuild | 0.28.1 [VERIFIED: npm registry] | Bundles `packages/wp-bundle`'s entry point (`@khaveeai/react` + `@khaveeai/providers-openai-realtime` + mount logic) into one IIFE | Fastest bundler for a single self-contained browser global bundle; native IIFE format support with zero config beyond `--bundle --format=iife`; no dependency-extraction plugin needed since D-10 mandates full isolation (no externals) |
| Vite | 8.1.0 [VERIFIED: npm registry] | Alternative to esbuild if a dev-server/HMR workflow is wanted for iterating on the bundle's mount script | `vite build --mode lib` with `format: 'iife'` works equally well; CONTEXT.md D-08 explicitly allows either — pick esbuild for simplicity (this is a single-entry, no-HMR-needed build) unless the team wants Vite's plugin ecosystem |
| TypeScript | ^5.x [CITED: existing repo `package.json`] | Source language for `packages/wp-bundle`'s entry/mount script | Matches every other package in the monorepo; `tsc` is NOT used for this package's actual build output (esbuild/Vite handles that), but `tsc --noEmit` can still type-check the source |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@khaveeai/react` | 0.2.9 [CITED: workspace package.json] | `KhaveeProvider`, `VRMAvatar`/`GLBAvatar`, `useRealtime` | Already built — the bundle's entry point imports this directly via the pnpm workspace `workspace:*` protocol during dev, bundled into the IIFE at build time |
| `@khaveeai/providers-openai-realtime` | 0.3.13 [CITED: workspace package.json] | `OpenAIRealtimeProvider` with `useProxy: true` | Instantiated once per mount-point div, configured with `proxyEndpoint` read from the div's `data-khaveeai-config` attribute |
| `react` / `react-dom` | ^19.1.0 [CITED: workspace package.json devDependency] | React runtime, bundled (not externalized) into the IIFE per D-10 | Must be a `dependency` (not `peerDependency`) of `packages/wp-bundle` specifically, the opposite of `@khaveeai/react`'s own `peerDependencies` — the bundle is the one place in this monorepo that needs to own/ship its own React copy |
| `@wordpress/scripts` | 32.5.0 [VERIFIED: npm registry] | Builds ONLY `wordpress-plugin/assets/editor.js` (the Gutenberg block-registration script) | Recommended by milestone-level `STACK.md` for WP-admin-side JS specifically because it auto-externalizes against `wp-element`/`wp-i18n` globals via `DependencyExtractionWebpackPlugin` and auto-generates the `*.asset.php` dependency manifest `wp_register_script()` can consume — appropriate ONLY for the editor script, which deliberately wants to share WP-core's React, unlike the front-end bundle which deliberately does not (D-10) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| esbuild for the front-end bundle | Rollup | Rollup has better tree-shaking for library output, but this is an application-shaped single entry point, not a library — esbuild's speed advantage matters more here and CONTEXT.md D-08 already names esbuild/Vite specifically |
| `@wordpress/scripts` for the front-end bundle too | esbuild/Vite (chosen) | `@wordpress/scripts`'s `DependencyExtractionWebpackPlugin` externalizes against `wp-element` by default — exactly what D-10 explicitly rejects for the front-end bundle (full isolation, no WP-core React dependency) — using it here would require manually disabling that plugin, fighting the tool's defaults |
| `block.json` `render` (PHP file path) | `render_callback` (PHP function reference passed to `register_block_type()`) | Both work identically for this phase's purposes; `render` (file path) is the WP 6.1+ "canonical" declarative style, `render_callback` is the older imperative style — since `AvatarRenderer::render()` already exists as a reusable method (shared with the shortcode), wiring `render_callback` directly to a thin `AvatarBlock::render_callback()` wrapper avoids creating a separate `render.php` template file purely to re-delegate; either is correct, `render_callback` is marginally less indirection here |

**Installation:**
```bash
# packages/wp-bundle (new workspace package)
pnpm --filter @khaveeai/wp-bundle add react@^19.1.0 react-dom@^19.1.0
pnpm --filter @khaveeai/wp-bundle add -D esbuild@^0.28.1 typescript@^5

# wordpress-plugin (editor-side build, separate from packages/wp-bundle)
cd wordpress-plugin && npm install --save-dev @wordpress/scripts@^32.5.0
```

**Version verification:** Confirmed live via `npm view <pkg> version` against the npm registry on 2026-06-25: `esbuild` 0.28.1, `vite` 8.1.0 (current major is 8, not 5/6 — training data on Vite's version number is stale), `@wordpress/scripts` 32.5.0. No bundler is currently installed anywhere in this repo (`node_modules/.bin` has no `esbuild`/`vite`/`rollup`/`webpack` entries) — this is a net-new toolchain addition, not a version bump.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| esbuild | npm | ~7 yrs (since 2020) | very high (tens of millions/wk) | github.com/evanw/esbuild | [OK] | Approved |
| vite | npm | ~6 yrs (since 2020) | very high (tens of millions/wk) | github.com/vitejs/vite | [OK] | Approved |
| @wordpress/scripts | npm | ~7 yrs, official WordPress org package | high | github.com/WordPress/gutenberg | [ASSUMED — not run through slopcheck this session, but is an official `@wordpress/*` scoped package published by the WordPress Gutenberg monorepo, same trust tier as `@wordpress/element`/`@wordpress/block-editor` already referenced in milestone STACK.md] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

`slopcheck install esbuild vite` was run live this session (npm install dry-run via slopcheck) and returned `[OK]` for both packages against the npm registry. `@wordpress/scripts` was not independently re-run through slopcheck this session (no new install needed — already verified by the milestone's own `STACK.md` research with a live npm registry version check), but as an official `@wordpress/*`-namespaced package from the Gutenberg project it carries the same provenance tier as Context7/official-docs-sourced packages.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ BROWSER (front end — public page with [khaveeai_avatar] or block)   │
│                                                                       │
│  khaveeai-bundle.js (IIFE, self-mounting, no globals leaked)         │
│   1. querySelectorAll('[data-khaveeai-config]') on DOMContentLoaded  │
│   2. For each div: parse JSON config (voice/instructions/avatar/     │
│      restUrl), render <KhaveeProvider><VRMAvatar/></KhaveeProvider>  │
│   3. Idle state: static pose + "Click to talk" overlay (no mic yet) │
│   4. On click → OpenAIRealtimeProvider.connect()                     │
│        → mic permission prompt fires HERE (first user gesture)      │
│        → POST {restUrl} { sessionConfig: {voice, instructions, ...}}│
│                                                                       │
└──────────────────────────┬────────────────────────────────────────────┘
                           │ POST /khaveeai/v1/session
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ WORDPRESS PHP (server, page render time AND REST request time)       │
│                                                                       │
│  PAGE RENDER PATH (the_content filter / block render):                │
│   AvatarShortcode::render($atts) ──┐                                 │
│   AvatarBlock::render_callback() ──┴──► AvatarRenderer::render()      │
│                                          ├─ merge atts ⊕ global       │
│                                          │  config (ConfigSource)     │
│                                          ├─ AssetManager::enqueue()   │
│                                          │  (idempotent, conditional) │
│                                          ├─ if !is_configured():      │
│                                          │   admin notice (D-06) OR   │
│                                          │   visitor placeholder(D-07)│
│                                          └─ else: mount div + JSON    │
│                                                                       │
│  REST PATH (SessionController::create_session, UNCHANGED Phase 6     │
│  flow + new D-05 override step):                                     │
│   1. RateLimiter check/record                                        │
│   2. ConfigSource::get_api_key() → 503 if empty                      │
│   3. apply_trust_model(session_config, instance_overrides)           │
│      ├─ voice: allowlist-validate instance override, else global     │
│      ├─ instructions: length-cap instance override, else global      │
│      └─ avatar: validate attachment ID exists, else global           │
│   4. TokenProvider::mint_session() → OpenAI                          │
│   5. respond({ data: { ephemeralToken, sessionId } })                │
│                                                                       │
│  EDITOR PATH (wp-admin block editor, separate code path entirely):    │
│   assets/editor.js registers block type, renders InspectorControls   │
│   → <ServerSideRender block="khaveeai/avatar" attributes={...} />    │
│   → REST GET /wp/v2/block-renderer/khaveeai/avatar?attributes=...    │
│   → calls the SAME AvatarBlock::render_callback() server-side        │
│   → returns static HTML preview, but khaveeai-bundle.js is NEVER     │
│     enqueued in wp-admin — only assets/editor.js loads there         │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/wp-bundle/                     # NEW workspace package (D-08)
├── package.json                        # name: @khaveeai/wp-bundle, private (not published)
├── tsconfig.json                       # extends tsconfig.packages.json, noEmit (esbuild handles output)
├── build.mjs                           # esbuild build script (--bundle --format=iife --outfile=...)
└── src/
    ├── index.ts                       # Entry point: DOM scan + mount loop
    ├── mount.tsx                      # Per-instance React tree: KhaveeProvider + VRMAvatar/GLBAvatar + click-to-talk UI
    └── ui/
        ├── ClickToTalkOverlay.tsx     # D-01/D-02 idle/connecting button states
        └── ErrorOverlay.tsx          # Runtime "Couldn't connect. Try again." state (UI-SPEC Interaction States)

wordpress-plugin/
├── includes/
│   ├── Render/AvatarRenderer.php       # Shared render path (EMBED-04) — ALREADY SPECIFIED in milestone ARCHITECTURE.md
│   ├── Shortcode/AvatarShortcode.php   # add_shortcode('khaveeai_avatar', ...)
│   ├── Block/
│   │   ├── block.json                  # attributes mirror shortcode atts 1:1; editorScript + render_callback wiring
│   │   └── AvatarBlock.php             # register_block_type(), render_callback delegates to AvatarRenderer
│   └── Assets/AssetManager.php         # wp_enqueue_script/style, has_shortcode()/block-presence conditional (PERF-01)
├── build/
│   └── khaveeai-bundle.js              # esbuild output, COMMITTED to git (D-09)
└── assets/
    └── editor.js                       # @wordpress/scripts output, block registration + InspectorControls ONLY
```

### Pattern 1: One shared render path, two thin registration adapters (EMBED-04)

**What:** `AvatarRenderer::render(array $atts): string` is the single function that normalizes attributes (instance override → global default merge) and emits mount-point HTML + bootstrap JSON. `AvatarShortcode` and `AvatarBlock` are each thin adapters that parse their respective input format into the same normalized shape, then call `AvatarRenderer::render()`.
**When to use:** This is the literal implementation of EMBED-04's requirement — do not let shortcode and block attribute-merge logic diverge.
**Example:**
```php
// Source: this monorepo's own milestone ARCHITECTURE.md Pattern 2 (already researched)
final class AvatarRenderer {
    public function __construct(
        private ConfigSourceInterface $config_source,
        private AssetManager $assets
    ) {}

    public function render(array $atts): string {
        $defaults = $this->config_source->get_runtime_config();
        $merged = wp_parse_args($atts, $defaults); // instance atts override admin defaults
        $this->assets->enqueue(); // idempotent — safe to call N times per page
        $id = 'khaveeai-' . wp_unique_id();
        return sprintf(
            '<div id="%s" class="khaveeai-root" data-khaveeai-config="%s"></div>',
            esc_attr($id),
            esc_attr(wp_json_encode($this->public_safe($merged)))
        );
    }
}
```

### Pattern 2: Conditional asset enqueue gated by content detection (PERF-01)

**What:** `AssetManager::enqueue()` is called from inside `AvatarRenderer::render()` (i.e., only when a shortcode/block actually renders), guarded by an idempotency check (`wp_script_is($handle, 'enqueued')`) so N instances on one page enqueue the bundle exactly once. This satisfies PERF-01 directly — the script genuinely never loads on pages without the shortcode/block, because the render path itself is the trigger.
**When to use:** Always for this phase — do NOT use a blanket `wp_enqueue_scripts` hook that runs on every page and tries to `has_shortcode( get_post()->post_content, 'khaveeai_avatar' )` as a guard; that approach misses Gutenberg blocks (which don't use shortcode syntax) and misses page-builder shortcode/HTML widgets that inject content outside `the_content`. Calling enqueue from the actual render callback is simpler AND more correct than reimplementing presence-detection separately.
**Example:**
```php
// AssetManager.php
final class AssetManager {
    private const HANDLE = 'khaveeai-bundle';
    private const STYLE_HANDLE = 'khaveeai-bundle-style';

    public function enqueue(): void {
        if ( wp_script_is( self::HANDLE, 'enqueued' ) ) {
            return; // idempotent — N shortcodes/blocks on one page share one enqueue
        }
        $bundle_path = plugin_dir_path( KHAVEEAI_PLUGIN_FILE ) . 'build/khaveeai-bundle.js';
        $version = file_exists( $bundle_path ) ? (string) filemtime( $bundle_path ) : KHAVEEAI_VERSION;

        wp_enqueue_script(
            self::HANDLE,
            plugins_url( 'build/khaveeai-bundle.js', KHAVEEAI_PLUGIN_FILE ),
            array(), // deliberately NO deps array — D-10 full isolation, bundle owns its own React
            $version,
            array( 'in_footer' => true )
        );
        wp_enqueue_style(
            self::STYLE_HANDLE,
            plugins_url( 'build/khaveeai-bundle.css', KHAVEEAI_PLUGIN_FILE ),
            array(),
            $version
        );
    }
}
```

### Pattern 3: Gutenberg dynamic block with PHP-only render path (EMBED-05)

**What:** The block is registered via `block.json` with `"editorScript": "file:./assets/editor.js"` and either `"render": "file:./render.php"` or a `render_callback` passed to `register_block_type()` — but deliberately NO `"viewScript"` entry. `assets/editor.js` imports `@wordpress/server-side-render` and renders `<ServerSideRender block="khaveeai/avatar" attributes={attributes} />` inside `edit()`. The front-end bundle (`khaveeai-bundle.js`) is enqueued separately, by `AvatarRenderer`/`AssetManager`, the same way the shortcode triggers it — NOT via `block.json`'s asset-loading mechanism at all.
**When to use:** Always for this phase, and this is a deviation worth flagging explicitly — see Common Pitfalls below for why `viewScript` is the wrong tool here even though it looks like the "obviously correct" declarative option for a front-end-only script.
**Example:**
```json
// block.json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "khaveeai/avatar",
  "title": "Khavee AI Avatar",
  "category": "widgets",
  "attributes": {
    "voice": { "type": "string", "default": "" },
    "instructions": { "type": "string", "default": "" },
    "avatar": { "type": "number", "default": 0 }
  },
  "editorScript": "file:./assets/editor.js",
  "render": "file:./render.php"
}
```
```php
// render.php — called both by ServerSideRender (editor preview) and the front end
// $attributes is provided by WordPress's block render pipeline.
echo khaveeai_avatar_renderer()->render( $attributes );
```

### Anti-Patterns to Avoid

- **Relying on `block.json`'s `viewScript` to load the front-end avatar bundle:** looks correct (it is the field literally named for "front-end-only script"), but for DYNAMIC blocks (PHP `render_callback`/`render`, which this block must be — its output depends on server-side config merge) there is a long-standing, still-open WordPress Core Trac bug (#56470, tracked in Gutenberg issue #43727) where `viewScript`-declared assets are unreliably enqueued. Use `AssetManager::enqueue()` from the shared render path instead (Pattern 2) — this also has the benefit of being the exact same mechanism the shortcode already uses, so there's only one enqueue code path to reason about for both embed methods, not two.
- **Building the front-end bundle with `@wordpress/scripts`:** its `DependencyExtractionWebpackPlugin` externalizes React against `wp-element` by default — exactly the opposite of D-10's full-isolation requirement. Reserve `@wordpress/scripts` for `assets/editor.js` only, where sharing WP-core's React for the editor UI is actually desirable.
- **A single shared JS file branching on `typeof wp !== 'undefined'` to decide editor-vs-front-end behavior:** the milestone's own `PITFALLS.md` Anti-Pattern table explicitly flags this as "acceptable only as an early dev-spike," never for real mic/token testing — always ship the editor script and the front-end bundle as two genuinely separate build outputs/entry points from day one.
- **Enqueuing the bundle via a blanket `wp_enqueue_scripts` hook with a manual `has_shortcode()` guard, decoupled from the actual shortcode/block render callback:** this duplicates the presence-detection logic the render callback already has "for free" (it only runs when the shortcode/block is actually present) and risks drifting out of sync with block detection, which `has_shortcode()` cannot do at all (blocks don't use shortcode syntax). Enqueue from inside the render path (Pattern 2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Editor-preview rendering that mirrors the front-end render exactly | A second, JS-side preview renderer that re-implements `AvatarRenderer`'s merge logic in React/JS for the editor | `@wordpress/server-side-render`'s `<ServerSideRender>` component, which calls the SAME PHP `render_callback` via REST | Any hand-rolled JS preview will inevitably drift from the PHP render path over time — `ServerSideRender` makes drift structurally impossible since there is only one render function |
| Per-page asset-presence detection for blocks | A custom `post_content` regex/string search for the block's JSON comment delimiters | `has_block( 'khaveeai/avatar', $post )` (core WP function, exists for exactly this) combined with the render-path-triggered enqueue from Pattern 2 | `has_block()` already parses the block comment delimiters correctly including nested blocks and block variations — a hand-rolled string search will miss edge cases (block inside a group/column block, etc.) |
| IIFE global-scope isolation / "does my bundle leak anything" verification | A manual code review pass reading through the bundled output | esbuild's `--format=iife` with no `--global-name` set (anonymous IIFE) PLUS a build-time grep/test asserting `window.React`/`window.ReactDOM`/`window.khaveeai` are NOT defined after the script executes | Manual review of a multi-hundred-KB bundled file is unreliable; a one-line automated check in the build pipeline catches regressions permanently |
| Rate limiting / abuse prevention for the REST override path | A new rate-limit mechanism specific to the per-instance override fields | The EXISTING `RateLimiter` class, unchanged — D-05's validation runs INSIDE the same `create_session()` flow that's already rate-limited | The abuse surface (anonymous POST to mint a token) is identical whether or not instance overrides are sent; a second limiter would be redundant complexity with no new threat it actually covers |

**Key insight:** This phase has almost no genuinely novel logic to write — `AvatarRenderer`'s merge function, `ServerSideRender`'s editor preview, and `has_shortcode()`/`has_block()`'s detection are all either already-specified patterns from the milestone's own research or WordPress core primitives built for exactly this use case. The actual engineering risk is entirely in get the bundler config and the two-script (editor/front-end) split right on the first try, since CONTEXT.md D-10 and the `viewScript` caveat above are both "expensive to reverse once shipped" architectural choices, not implementation details.

## Common Pitfalls

### Pitfall 1: `viewScript` does not reliably enqueue for dynamic (server-rendered) blocks

**What goes wrong:** A developer declares `"viewScript": "file:./build/khaveeai-bundle.js"` in `block.json`, expecting WordPress to auto-enqueue it on the front end whenever the block is present, exactly as documented. For a STATIC block (one with a JS `save()` function that serializes HTML into post content), this works. For a DYNAMIC block (PHP `render_callback`/`render`, which this block must be, since its output depends on server-side config merge), the front-end script silently fails to enqueue in some WordPress/Gutenberg version combinations.
**Why it happens:** This is a confirmed, still-open upstream bug — WordPress Core Trac ticket #56470, tracked via Gutenberg GitHub issue #43727 (closed on the Gutenberg side specifically because the fix must land in WordPress Core, not Gutenberg). The dynamic-block render pipeline does not consistently trigger the same asset-registration path that static blocks use for `viewScript`.
**How to avoid:** Do not depend on `viewScript` for this block at all. Enqueue `khaveeai-bundle.js` from inside `AvatarRenderer::render()` (the same shared render path the shortcode already uses, called from the block's `render_callback`/`render.php`) — see Pattern 2/3 above. This sidesteps the bug entirely since the script is never declared via `block.json`'s asset-loading mechanism.
**Warning signs:** Avatar renders fine in a manual `curl`/browser test of the raw shortcode but the block-inserted version's front-end mount-point div has no JS behavior at all (button does nothing) despite no console errors — check Network tab for whether `khaveeai-bundle.js` even loaded.

### Pitfall 2: Enqueuing from a blanket hook instead of the render callback breaks PERF-01 silently

**What goes wrong:** `wp_enqueue_scripts` (unconditional) + a `has_shortcode()` check inside it looks like the "correct" WP pattern (it's even what the milestone's own `PITFALLS.md` Anti-Pattern 1 superficially endorses as a fallback — "optionally use `has_shortcode()`/block-presence detection as a performance optimization"). But `has_shortcode()` only inspects `$post->post_content` for the literal `[khaveeai_avatar` string — it returns false for: page builder shortcode/HTML widgets that store content outside `post_content` (many page builders use post meta or a separate content field), the block (which uses JSON comment delimiters, not shortcode syntax), and any shortcode rendered via a widget area rather than the main content.
**Why it happens:** `has_shortcode()` is a `post_content`-string-search convenience function, not a general "will this shortcode actually render on this request" predicate.
**How to avoid:** Trigger enqueue from the actual render callback (Pattern 2), which by definition only runs when the shortcode/block genuinely renders, regardless of where the content came from. Treat any `has_shortcode()`/`has_block()` pre-check as a pure optimization layered ON TOP of the render-triggered enqueue (e.g., to skip needlessly parsing widget content on a page that obviously has neither), never as the sole gating mechanism.
**Warning signs:** Avatar doesn't appear when embedded via a page builder's HTML widget, even though the exact same shortcode text works when pasted into the classic editor.

### Pitfall 3: Editor-side `assets/editor.js` accidentally bundling `@khaveeai/react`/`OpenAIRealtimeProvider`

**What goes wrong:** A developer building `assets/editor.js` imports a shared "config types" module that transitively imports from `@khaveeai/react` or `@khaveeai/providers-openai-realtime`, pulling the entire SPA (and its mic/WebRTC code paths) into the editor bundle even though `edit()` never calls `connect()`.
**Why it happens:** TypeScript/bundler tree-shaking does not always eliminate side-effecting imports, and it's tempting to reuse `RealtimeConfig`'s type shape for the block's attribute typing.
**How to avoid:** `assets/editor.js` and `packages/wp-bundle`'s entry point must have ZERO shared imports beyond plain data shapes defined as plain TypeScript interfaces (not imported from `@khaveeai/core` even for types, to guarantee zero bundler entanglement) — duplicate the tiny attribute-shape type locally in the editor script's source rather than importing it. Verify post-build by checking `assets/editor.js`'s bundle size stays in the tens-of-KB range (block registration + `ServerSideRender` only) rather than the multi-hundred-KB range a bundled React+Three.js+VRM SPA would produce.
**Warning signs:** `assets/editor.js`'s built file size balloons unexpectedly; opening the block editor triggers a console warning about `RTCPeerConnection`/`navigator.mediaDevices` being referenced (a build-time tree-shaking failure would still reference these browser APIs even if never called at runtime, in some bundler configurations).

### Pitfall 4: D-05's override validation accidentally re-opens the Phase 6 jailbreak gap

**What goes wrong:** A developer implements the override path by changing `apply_trust_model()`'s unconditional `unset($session_config['voice'])` + force-overwrite into something like `$session_config['audio']['output']['voice'] = $instance_override_voice ?? $runtime_config['voice'];` without first validating `$instance_override_voice` against the 10-voice allowlist — any string the client sends (including ones that aren't valid OpenAI voices, or worse, control characters/injection attempts) now reaches OpenAI's API directly.
**Why it happens:** The override mechanism is additive to existing code that currently does a hard overwrite; it's easy to swap "always overwrite" for "overwrite unless client provided something" without realizing the "something" needs its own validation step, not just an existence check.
**How to avoid:** Validate FIRST, independently of whether an override was even requested: `$voice = in_array($client_voice, self::ALLOWED_VOICES, true) ? $client_voice : $runtime_config['voice'];` — the exact same `in_array(..., true)` pattern `SettingsPage::sanitize_settings()` already uses for the admin-side voice dropdown (CR-01's fix, already shipped in Phase 7). Apply the identical allowlist-or-fallback pattern for `instructions` (length cap, not allowlist) and `avatar` (verify `get_post($id)` returns a real attachment of the expected MIME type, not just `is_numeric()`).
**Warning signs:** A code reviewer asks "what happens if I send `voice: "ignore previous instructions and..."`" and the answer isn't an immediate, confident "rejected, falls back to global" — see CR-01/CR-01-NEW in `.planning/STATE.md`'s history for the project's own precedent of catching exactly this class of bug in Phase 7's settings sanitization, twice.

### Pitfall 5: Bundle isolation verified only by "it looks fine," not by an automated check

**What goes wrong:** D-10's full-isolation requirement (no `window.React`/`window.ReactDOM` leak) is satisfied by default behavior of `esbuild --format=iife` (anonymous IIFE, no global name set), but a future change to the build script (e.g., someone adds `--global-name=khaveeai` thinking it's needed for debugging, or switches to UMD format for some other reason) can silently reintroduce a global leak with no build-time error.
**Why it happens:** IIFE isolation is a property of bundler CONFIGURATION, not of the source code — nothing in `packages/wp-bundle/src/` itself would change if isolation broke.
**How to avoid:** Add a post-build smoke check (even a simple Node script run in CI/the build pipeline) that loads the built `khaveeai-bundle.js` into a minimal DOM-less or jsdom-based sandbox and asserts `typeof globalThis.React === 'undefined'` and `typeof globalThis.ReactDOM === 'undefined'` after execution.
**Warning signs:** None visible without the check — this is exactly the kind of regression that "looks done" until a specific theme/plugin combination collides with it on a live site, per the milestone's own `PITFALLS.md` Pitfall 4 framing.

## Code Examples

### esbuild IIFE build script for `packages/wp-bundle`

```javascript
// packages/wp-bundle/build.mjs
// Source: esbuild official docs (esbuild.github.io/api/#format) — IIFE format
// wraps output in a function expression so bundle-local variables never leak
// into global scope; omitting --global-name means NOTHING is assigned to
// window at all (D-10's "never assigns window.React/window.ReactDOM").
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',          // no --global-name set: zero globals exposed
  outfile: '../../wordpress-plugin/build/khaveeai-bundle.js',
  minify: true,
  target: ['es2017'],       // matches root tsconfig.json's ES2017 target
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  // Deliberately NO `external` array — D-10 full isolation means react,
  // react-dom, three, @pixiv/three-vrm all get bundled INLINE, not externalized.
});
```

### Front-end entry point: scan-and-mount pattern

```typescript
// packages/wp-bundle/src/index.ts
// Self-mounting bundle: finds every [data-khaveeai-config] div and renders
// an independent KhaveeProvider+VRMAvatar tree into each one. Runs once on
// DOMContentLoaded; safe to load on pages with zero, one, or many instances.
import { createRoot } from 'react-dom/client';
import { mountAvatarInstance } from './mount';

function mountAll(): void {
  const roots = document.querySelectorAll<HTMLElement>('[data-khaveeai-config]');
  roots.forEach((el) => {
    if (el.dataset.khaveeaiMounted === 'true') return; // idempotency guard
    el.dataset.khaveeaiMounted = 'true';
    const config = JSON.parse(el.dataset.khaveeaiConfig ?? '{}');
    const root = createRoot(el);
    mountAvatarInstance(root, config);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountAll);
} else {
  mountAll();
}
```

### PHP: AvatarShortcode thin adapter

```php
// Source: pattern directly from this monorepo's milestone ARCHITECTURE.md
final class AvatarShortcode {
    public function __construct(private AvatarRenderer $renderer) {}

    public function register(): void {
        add_shortcode( 'khaveeai_avatar', array( $this, 'render' ) );
    }

    public function render( $atts ): string {
        $atts = shortcode_atts(
            array(
                'voice'        => '',
                'instructions' => '',
                'avatar'       => '',
            ),
            (array) $atts,
            'khaveeai_avatar'
        );
        // Empty-string atts must NOT override global defaults — only a
        // genuinely-provided value should reach AvatarRenderer's merge.
        $atts = array_filter( $atts, static fn( $v ) => '' !== $v );
        return $this->renderer->render( $atts );
    }
}
```

### PHP: D-05 validated override inside SessionController

```php
// Extends the EXISTING apply_trust_model() in
// wordpress-plugin/includes/Rest/SessionController.php — added validation,
// not a removal of the existing global-config-forcing behavior.
private const ALLOWED_VOICES = [
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
];
private const MAX_INSTRUCTIONS_LENGTH = 2000;

private function apply_trust_model( array $session_config, array $instance_overrides = array() ): array {
    $runtime_config = $this->config_source->get_runtime_config();

    // Voice: allowlist-or-fallback, identical pattern to SettingsPage::sanitize_settings()'s CR-01 fix.
    $override_voice = $instance_overrides['voice'] ?? '';
    $voice = in_array( $override_voice, self::ALLOWED_VOICES, true )
        ? $override_voice
        : $runtime_config['voice'];

    // Instructions: length-capped, never raw-passed beyond the cap.
    $override_instructions = $instance_overrides['instructions'] ?? '';
    $instructions = ( '' !== $override_instructions && strlen( $override_instructions ) <= self::MAX_INSTRUCTIONS_LENGTH )
        ? $override_instructions
        : $runtime_config['instructions'];

    $session_config['instructions'] = $instructions;
    unset( $session_config['voice'] );
    $session_config['audio']['output']['voice'] = $voice;

    return $session_config;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `register_block_type()` with separately-registered `wp_register_script`/`wp_register_style` calls plus a manual `$args` array | `block.json` metadata file as the canonical registration source (`register_block_type( __DIR__ )`), `editorScript`/`render` resolved automatically | Recommended since WP 5.8 (current stable practice, still true as of 2026) | Less PHP boilerplate; `editorScript`/`editorStyle`/`style` fields auto-resolve to file paths relative to `block.json` |
| `render_callback` PHP function reference passed to `register_block_type()` | `"render": "file:./render.php"` declarative field in `block.json` (WP 6.1+) | WP 6.1 | Either still works; `render` is the more "modern" declarative style but `render_callback` remains fully supported and is arguably simpler when delegating to an existing shared method like `AvatarRenderer::render()` rather than a dedicated template file |
| Interactivity API for client-side block interactivity (no separate React app) | N/A for this phase | WP 6.5+ | NOT applicable here — the Interactivity API is for blocks that need light client interactivity using WP's own directive system; this block needs a full React+Three.js+WebRTC SPA, which is exactly the case the Interactivity API does NOT replace (full app shells still need their own bundle) |

**Deprecated/outdated:**
- `@wordpress/build` (esbuild-based successor to `@wordpress/scripts`): explicitly documented by WordPress's own developer blog (April 2026) as "not ready for every use case yet" with known gaps in block registration — do not adopt for `assets/editor.js` this phase; `@wordpress/scripts` (webpack-based, stable) remains correct.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@wordpress/scripts` is the correct tool specifically for `assets/editor.js` (not the front-end bundle) | Standard Stack, Architecture Patterns Pattern 3 | If WP core's actual currently-bundled React version is incompatible with what `@wordpress/scripts`'s `DependencyExtractionWebpackPlugin` externalizes against, the editor script could break in wp-admin even though the front-end bundle (fully isolated) would be unaffected — STATE.md's own Blockers/Concerns section already flags this exact unresolved item: "WordPress core's currently-bundled React version was not verified during research" |
| A2 | `register_block_type( __DIR__ )` auto-discovers `block.json` correctly when called from `AvatarBlock.php`'s `init` hook, with PSR-4 autoloading | Architecture Patterns Pattern 3 | Low risk — this is a well-documented, stable WP core API; the only real variable is the exact directory path passed, which is an implementation detail not a research gap |
| A3 | The Gutenberg `viewScript`-for-dynamic-blocks bug (Trac #56470) is still unresolved as of this research date (2026-06-25) | Common Pitfalls Pitfall 1 | If WordPress Core has since fixed this (the Gutenberg-side issue is closed only because the fix needs to land in Core, and Core release notes were not separately checked for a fix landing), the `viewScript`-avoidance recommendation becomes merely "still correct but no longer strictly necessary" — low risk either way since the recommended pattern (enqueue from the render path) works regardless of whether the bug is fixed |

**A1 and A3 carry the most planning risk** — both are flagged as open/unverified by either this research or the project's own prior STATE.md, and both should be spot-checked with a real `wp-env` install (already recommended by milestone STACK.md) before the planner finalizes the editor-script build tooling and before assuming `viewScript` avoidance is still load-bearing.

## Open Questions (RESOLVED)

1. **Does the target WP core version's bundled React conflict with `@wordpress/scripts`'s externalization for `assets/editor.js`?**
   - What we know: D-10 already resolved this for the FRONT-END bundle (full isolation, side-steps the question entirely). The editor script is a much smaller surface (block registration + `ServerSideRender`), so even a React-version mismatch there is lower-stakes than it would be for the main SPA.
   - What's unclear: Whether `assets/editor.js` itself needs any React-version awareness at all, since `ServerSideRender` and block registration APIcalls (`@wordpress/blocks`, `@wordpress/block-editor`) are typically consumed via `@wordpress/element`'s `createElement`, not raw JSX requiring a specific React version.
   - Recommendation: Use `@wordpress/element` (not bare `react`) for `assets/editor.js`'s component code, exactly as milestone STACK.md already recommends for "admin settings screen if built as a React UI" — this sidesteps version concerns entirely since `wp-element` is whatever WP core itself ships, by definition compatible with itself.
   - **RESOLVED:** Adopt the `@wordpress/element` recommendation. Implemented by plan 08-04, which builds `assets/editor.js` via `@wordpress/scripts` and consumes `@wordpress/element` (never bare `react`), so the editor script inherits WP-core's own React version and cannot collide with it.

2. **Should the avatar silhouette placeholder (D-07) be a static image file shipped in the plugin, or an inline SVG?**
   - What we know: UI-SPEC.md leaves this to "Claude's Discretion" / implementation detail — no decorative icon library, no exotic deps.
   - What's unclear: Whether a static raster image (PNG/WebP) or inline SVG better serves the "no console error, no broken image icon if the file fails to load" requirement.
   - Recommendation: Inline SVG embedded directly in the PHP-rendered HTML (not a separate enqueued image file) — guarantees zero additional HTTP request, zero broken-image-icon failure mode, and trivially themable via `currentColor`/CSS without needing a build step.
   - **RESOLVED:** Adopt the inline-SVG recommendation. Implemented by plan 08-02, whose `AvatarRenderer` D-07 branch returns a neutral inline-SVG silhouette directly in the rendered HTML (no separate enqueued image asset).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Building `packages/wp-bundle` and `assets/editor.js` | ✓ | v23.5.0 | — |
| pnpm | Workspace package management | ✓ | 10.12.1 | — |
| PHP | WordPress plugin runtime (dev/test) | ✓ | 8.5.7 (cli) | — |
| Composer | `wordpress-plugin/` dependency management | ✓ | present at `/opt/homebrew/bin/composer` | — |
| `wp` (WP-CLI) | Local WordPress testing/scaffolding | ✗ | — | `@wordpress/env` (`wp-env`, Docker-based) recommended by milestone STACK.md as the primary local-testing mechanism instead of WP-CLI; Docker availability not verified this session — if Docker is also unavailable, manual `curl`-based REST testing (as Phase 6 already did, per `tests/curl-verify.sh`) remains a viable fallback for the REST-contract half of this phase, though it cannot exercise the actual shortcode/block rendering or bundle mounting |
| esbuild / Vite | Building the front-end bundle | ✗ (not yet installed) | 0.28.1 / 8.1.0 available on npm registry | None needed — this is a net-new devDependency to add, not a missing system tool |
| `@wordpress/scripts` | Building `assets/editor.js` | ✗ (not yet installed) | 32.5.0 available on npm registry | None needed — net-new devDependency |

**Missing dependencies with no fallback:**
- None blocking — WP-CLI's absence has a documented fallback (`wp-env`) and the bundler packages are simply not-yet-installed devDependencies that this phase installs as part of its own work, not pre-existing environment gaps.

**Missing dependencies with fallback:**
- WP-CLI (`wp`) — use `@wordpress/env` (Docker-based `wp-env`) for local manual testing instead; verify Docker availability separately before relying on this fallback at implementation time.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | PHP: bare-PHP harness pattern (no PHPUnit found) — see `wordpress-plugin/tests/*.php`, each a standalone script with in-memory WP-function stubs, run via `php tests/X.php`. JS: none currently configured for any provider package except `packages/providers/openai-stt-tts` (Vitest) and `packages/providers/qdrant` (Jest) — `packages/react`, `packages/core`, `packages/providers/openai-realtime` have NO test framework configured. |
| Config file | none — `wordpress-plugin/tests/rest-logic-harness.php`, `settings-page-harness.php`, `token-provider-harness.php` are standalone scripts, not a PHPUnit/Pest suite |
| Quick run command | `php wordpress-plugin/tests/rest-logic-harness.php` (existing pattern); a new `wordpress-plugin/tests/render-logic-harness.php` should follow the identical in-memory-stub style for `AvatarRenderer`'s merge logic |
| Full suite command | `for f in wordpress-plugin/tests/*.php; do php "$f"; done` (no aggregate runner currently exists) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EMBED-02 | Instance override falls back to global when omitted; allowlist-rejects invalid voice | unit (bare-PHP harness, mirrors existing `rest-logic-harness.php` style) | `php wordpress-plugin/tests/render-logic-harness.php` | ❌ Wave 0 |
| EMBED-04 | Shortcode atts and block attributes produce IDENTICAL merged config for the same inputs | unit (bare-PHP harness — call `AvatarRenderer::render()` twice with shortcode-shaped vs block-shaped input, assert identical normalized output) | `php wordpress-plugin/tests/render-logic-harness.php` | ❌ Wave 0 |
| EMBED-05 | Editor script never imports/bundles `@khaveeai/react`/`OpenAIRealtimeProvider` | smoke (build-output size/grep check, not a unit test) | `grep -c "RTCPeerConnection" wordpress-plugin/assets/editor.js` expected `0` | ❌ Wave 0 |
| D-05 (security) | Invalid/malicious voice override is rejected, never reaches `mint_session()` | unit (bare-PHP harness) | `php wordpress-plugin/tests/render-logic-harness.php` (or extend `rest-logic-harness.php`) | ❌ Wave 0 — this is the highest-priority test given Phase 7's CR-01/CR-01-NEW precedent of exactly this bug class recurring |
| PERF-01 | Asset enqueue is genuinely conditional (not site-wide) | manual / smoke (no automated WP-environment test harness exists for actual `wp_enqueue_script` behavior without a real or `wp-env` WP install) | manual: view source of a page without the shortcode/block, confirm `khaveeai-bundle.js` `<script>` tag absent | ❌ Wave 0 — requires `wp-env` or live WP install, not unit-testable with the bare-PHP-stub harness style |
| Bundle isolation (D-10) | `khaveeai-bundle.js` never assigns `window.React`/`window.ReactDOM` | smoke (Node script) | `node wordpress-plugin/tests/bundle-isolation-check.mjs` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `php wordpress-plugin/tests/render-logic-harness.php` (whichever harness file is being modified)
- **Per wave merge:** all `wordpress-plugin/tests/*.php` harnesses + the bundle-isolation Node smoke check
- **Phase gate:** Full harness suite green + manual `wp-env`-based verification of PERF-01/EMBED-05 (these two requirements are fundamentally about real WordPress runtime behavior — has_shortcode/has_block detection, ServerSideRender's actual REST call, viewScript-vs-render-path enqueue timing — that a bare-PHP-stub harness cannot fully exercise) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `wordpress-plugin/tests/render-logic-harness.php` — covers EMBED-02/EMBED-04/D-05, following the exact in-memory-stub pattern already established in `rest-logic-harness.php`/`settings-page-harness.php`
- [ ] `wordpress-plugin/tests/bundle-isolation-check.mjs` — covers D-10, a small Node script that `require()`s or evaluates the built `khaveeai-bundle.js` in a sandboxed context and asserts no `window.React`/`window.ReactDOM` leak
- [ ] `wp-env` (`@wordpress/env`) install — needed for any real manual verification of PERF-01 (conditional enqueue), EMBED-05 (actual editor preview behavior), and EMBED-01/03 (shortcode/block actually rendering on a real page) — none of these are reachable via the bare-PHP-stub harness style alone

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Route remains intentionally anonymous/public per Phase 6's established trust model (ephemeral token IS the security boundary) — unchanged this phase |
| V3 Session Management | no | No new session/cookie mechanism introduced |
| V4 Access Control | yes | D-06's admin-only notice gated via `current_user_can('manage_options')` — same pattern as `SettingsPage::render_page()`'s existing two-layer check; the front-end notice needs only ONE layer (no menu-registration equivalent exists for content rendered in `the_content`), but must still check independently at render time, never trust a cached/passed-down boolean |
| V5 Input Validation | yes | D-05's voice allowlist / instructions length cap / avatar attachment-ID existence check — this is THE security-critical validation surface this phase introduces; must be `in_array(..., true)` strict-mode allowlisting (per Phase 7's CR-01 precedent), never a blocklist or format-heuristic |
| V6 Cryptography | no | No new cryptographic operation introduced — API key handling is unchanged from Phase 6/7 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via per-instance `instructions` override reaching OpenAI unfiltered | Tampering | Length cap (D-05) reduces blast radius but does NOT prevent injection content within the cap — this is an accepted residual risk per CONTEXT.md's framing (the override mechanism's job is to prevent jailbreaking the GLOBAL admin-configured instructions, not to content-filter what a site owner's OWN page author writes into their own shortcode instance; a malicious site owner already has `manage_options`-adjacent trust by being able to edit page content at all) |
| Arbitrary `avatar` attachment ID probing (enumerate Media Library IDs via the override param) | Information Disclosure | `avatar` override must resolve via `get_post($id)` + verify `post_type === 'attachment'` AND the expected MIME type, falling back to the global avatar (never echoing "attachment not found" specifics back to the client) on any mismatch — same fail-closed, generic-error convention as the rest of this codebase's error handling |
| Reflected XSS via shortcode/block attribute values rendered into the mount-point's `data-khaveeai-config` JSON attribute | Tampering | `esc_attr( wp_json_encode(...) )` — already the established pattern in milestone ARCHITECTURE.md's `AvatarRenderer::render()` example; must be preserved exactly, including for the NEW per-instance override fields this phase adds to the merged config array |
| Editor-preview REST call (`ServerSideRender`'s `/wp/v2/block-renderer/khaveeai/avatar`) being used to probe global config/API-key state from wp-admin by a lower-privileged user | Information Disclosure | `register_block_type()`'s block-renderer REST endpoint already requires the user to have permission to edit the relevant post type by WP core default — no additional gate needed, but verify `AvatarBlock::render_callback()` does NOT echo `get_api_key()` or any secret into its returned HTML under any input, since the block-renderer endpoint's own auth is a WP-core concern, not this plugin's |

## Sources

### Primary (HIGH confidence)
- This repository's own `.planning/research/ARCHITECTURE.md`, `PITFALLS.md`, `STACK.md` (milestone-level, dated 2026-06-21) — recommended project structure, Pattern 1-3, Pitfall 4/5/6/9, bundler comparison table
- This repository's own existing PHP source: `wordpress-plugin/includes/Rest/SessionController.php`, `ConfigSource/WpOptionsConfigSource.php`, `ConfigSource/ConfigSourceInterface.php`, `Admin/SettingsPage.php`, `Plugin.php`, `RateLimit/RateLimiter.php` — read directly this session
- This repository's own existing TypeScript source: `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`, `packages/core/src/types/realtime.ts`, `packages/core/src/types/conversation.ts`, `packages/react/src/KhaveeProvider.tsx`, `packages/react/src/VRMAvatar.tsx` — read directly this session
- `npm view esbuild version` → 0.28.1, `npm view vite version` → 8.1.0, `npm view @wordpress/scripts version` → 32.5.0 — live registry checks, this session
- `slopcheck install esbuild vite` → both `[OK]` — live tool run, this session
- [Metadata in block.json – Block Editor Handbook](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-metadata/) — `editorScript`/`viewScript`/`render` field semantics
- [esbuild API docs — format option](https://esbuild.github.io/api/) — IIFE format / global-name behavior

### Secondary (MEDIUM confidence)
- [ViewScript in block.json does not work for dynamic blocks · Issue #43727 · WordPress/gutenberg](https://github.com/WordPress/gutenberg/issues/43727) — fetched directly this session; confirms the bug references WordPress Core Trac #56470 and is closed on the Gutenberg side only because the fix needs to land in Core (cannot independently confirm Core-side resolution status this session — see Assumptions Log A3)
- [@wordpress/build, the next generation of WordPress plugin build tooling – WordPress Developer Blog](https://developer.wordpress.org/news/2026/04/wordpress-build-the-next-generation-of-wordpress-plugin-build-tooling/) — confirms `@wordpress/build` (esbuild-based) is not production-ready as of April 2026
- WebSearch results on dynamic block `render_callback`/`ServerSideRender`/`render` field conventions — cross-referenced against the official Block Editor Handbook pages above

### Tertiary (LOW confidence)
- None — all findings in this research were either verified against the live codebase, official WP docs, or a direct registry/tool check this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — esbuild/Vite/`@wordpress/scripts` versions verified live against npm registry this session; slopcheck-approved
- Architecture: HIGH — directly inherits an already-completed, internally-consistent milestone-level architecture research document, cross-checked against this phase's own locked CONTEXT.md decisions with no contradictions found
- Pitfalls: MEDIUM-HIGH — the `viewScript`-for-dynamic-blocks pitfall (Pitfall 1) is the one genuinely new finding this research session surfaced beyond what the milestone-level research already covered, sourced from a real, currently-open GitHub issue, but its exact upstream WordPress Core resolution status was not independently re-verified (flagged as Assumption A3)

**Research date:** 2026-06-25
**Valid until:** 30 days (stable WP core APIs + already-locked CONTEXT.md decisions; re-verify the `viewScript` bug status and `@wordpress/scripts`/esbuild/Vite versions if planning is delayed past this window, since WP core/Gutenberg ship on a roughly monthly cadence)
</content>
