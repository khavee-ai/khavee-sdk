# Architecture Research

**Domain:** WordPress plugin embedding a bundled React/Three.js SPA (voice-chat VRM avatar), with a PHP backend that mints OpenAI Realtime ephemeral tokens and serves admin-configured settings
**Researched:** 2026-06-21
**Confidence:** HIGH (WP REST/enqueue APIs, OpenAI ephemeral-token contract verified against actual SDK code) / MEDIUM (PHP strategy-pattern conventions, third-party plugin examples — WebSearch-verified, not Context7-verified, no single official "WordPress plugin DI" standard exists)

> **Note:** This file supersedes the prior milestone's `generic-stt-tts` pipeline architecture research (pipecat-style VAD/STT/LLM/TTS decomposition), which is now validated/shipped (see `.planning/PROJECT.md` Validated section). This research covers the current milestone only: the WordPress plugin's PHP layer.

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  BROWSER (one bundled JS file, output of a new Vite/esbuild package) │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ KhaveeProvider (React context) + useRealtime + VRMAvatar     │    │
│  │   └─ OpenAIRealtimeProvider (useProxy: true,                 │    │
│  │       proxyEndpoint: <WP REST URL>)                          │    │
│  └──────────────────────────────────────────────────────────────┘    │
│        ▲ mounts into                      │ POST {sessionConfig}     │
│        │ <div id="khaveeai-root"          │ GET  → ephemeralToken    │
│        │      data-config="...">          ▼                         │
├────────┼───────────────────────────────────────────────────────────┤
│        │              WORDPRESS PHP (server)                        │
│  ┌─────┴──────────┐  ┌────────────────────────────────────────┐    │
│  │ Shortcode /    │  │ REST Controller                         │    │
│  │ Gutenberg Block│  │ POST /khaveeai/v1/session               │    │
│  │ (render path)  │  │  ├─ ConfigSourceInterface (admin opts)  │    │
│  └───────┬────────┘  │  └─ TokenProviderInterface (OpenAI call) │    │
│          │            └──────────────┬───────────────────────────┘    │
│          ▼                           ▼                                │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Admin Settings Page (Settings API) → wp_options                │    │
│  │ ConfigSource: WPOptionsConfigSource (this milestone)            │    │
│  │ ConfigSource: PlatformApiConfigSource (future, NOT built now)   │    │
│  └──────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────┬──────────────────────────────────┘
                                     │ POST (server-to-server, API key never leaves PHP)
                                     ▼
                    https://api.openai.com/v1/realtime/client_secrets
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Bootstrap/main plugin file | Plugin header, autoload, hook registration, container wiring | `wordpress-plugin/khaveeai.php` |
| Config source strategy | Resolve "what API key, instructions, voice, avatar URL to use" from *some* backing store | Interface + 1 concrete class this milestone (WP options) |
| Token provider strategy | Resolve "how do I get a short-lived OpenAI Realtime token" from *some* upstream | Interface + 1 concrete class this milestone (direct OpenAI call) |
| REST controller | Translate HTTP request → call config source + token provider → JSON response shaped exactly as `OpenAIRealtimeProvider`'s `useProxy` branch expects | `WP_REST_Controller` subclass, registered on `rest_api_init` |
| Shortcode/Block render path | Produce the mount-point `<div>` + bootstrap data (REST URL, nonce, avatar URL, public-safe config) once, shared by shortcode and block | One shared render function/class, two thin adapters calling it |
| Enqueue manager | Register/enqueue the one built JS bundle + bootstrap data, once per page load, regardless of how many times shortcode/block appear | `wp_enqueue_script` + `wp_add_inline_script` (not `wp_localize_script`) |
| Admin settings page | Render/save the WP Admin UI backing the config source (API key field, textarea, voice picker, Media Library avatar picker) | WP Settings API (`register_setting`, `add_settings_field`) or a small custom admin page |

## Recommended Project Structure

```
wordpress-plugin/
├── khaveeai.php                          # Plugin bootstrap: header docblock, version const,
│                                          #   require autoloader, hook registration only
├── includes/
│   ├── Plugin.php                        # Composition root — wires concrete strategies into
│   │                                      #   the REST controller and admin page (the ONE place
│   │                                      #   that knows which ConfigSource/TokenProvider is active)
│   ├── ConfigSource/
│   │   ├── ConfigSourceInterface.php     # get_runtime_config(): array{instructions, voice, avatar_url, model}
│   │   │                                 #   get_api_key(): string  (server-side only, never returned to REST response)
│   │   └── WpOptionsConfigSource.php     # Reads wp_options via get_option('khaveeai_settings')
│   │                                     #   (PlatformApiConfigSource.php is future work, NOT built this milestone)
│   ├── TokenProvider/
│   │   ├── TokenProviderInterface.php    # mint_session(array $sessionConfig, string $apiKey): array
│   │   │                                 #   {ephemeralToken, sessionId, expiresAt}
│   │   └── OpenAiDirectTokenProvider.php # wp_remote_post to api.openai.com/v1/realtime/client_secrets
│   │                                     #   (PlatformApiTokenProvider.php is future work, NOT built this milestone)
│   ├── Rest/
│   │   └── SessionController.php         # WP_REST_Controller: registers POST /khaveeai/v1/session,
│   │                                     #   permission_callback for anonymous-but-rate-limited access,
│   │                                     #   calls ConfigSource + TokenProvider, shapes response
│   ├── Render/
│   │   └── AvatarRenderer.php            # Single shared method: build mount-div HTML + inline
│   │                                     #   bootstrap JSON (called by both Shortcode and Block)
│   ├── Shortcode/
│   │   └── AvatarShortcode.php           # Registers [khaveeai_avatar], parses shortcode atts,
│   │                                     #   delegates to AvatarRenderer
│   ├── Block/
│   │   ├── block.json                    # Block metadata (attributes mirror shortcode atts 1:1)
│   │   └── AvatarBlock.php               # register_block_type with a render_callback that
│   │                                     #   delegates to AvatarRenderer (server-side/dynamic render —
│   │                                     #   editor preview uses ServerSideRender, no duplicated JS logic)
│   ├── Admin/
│   │   └── SettingsPage.php              # WP Settings API page: API key, instructions, voice,
│   │                                     #   Media Library avatar picker → writes wp_options
│   └── Assets/
│       └── AssetManager.php              # wp_enqueue_script/style for the built bundle,
│                                         #   wp_add_inline_script for bootstrap data (REST URL + nonce)
├── build/
│   └── khaveeai-bundle.js                # Output of a bundler step that imports @khaveeai/react +
│                                         #   @khaveeai/providers-openai-realtime and mounts into
│                                         #   [data-khaveeai-root] — built by a NEW small Vite/esbuild
│                                         #   package outside the existing tsc-based packages, copied in
├── assets/
│   └── editor.js                         # Minimal Gutenberg editor-side script (block registration,
│                                         #   InspectorControls for the same attributes) — separate
│                                         #   small bundle, NOT the same file as khaveeai-bundle.js
```

### Structure Rationale

- **`ConfigSource/` and `TokenProvider/` as sibling interface+impl folders:** these are the two seams the milestone explicitly calls out as needing to be swappable later without touching the JS bundle. Keeping them as small, narrowly-scoped interfaces (not one fat "ProviderInterface") means the future Platform-mode classes are pure *additions* — `PlatformApiConfigSource implements ConfigSourceInterface` and `PlatformApiTokenProvider implements TokenProviderInterface` — wired in by changing one line in `Plugin.php`, never touching `SessionController.php`, `Render/`, or any JS.
- **`Render/AvatarRenderer.php` as a shared class, not duplicated in Shortcode/Block:** WordPress shortcodes and Gutenberg blocks are registered through entirely different APIs (`add_shortcode` vs `register_block_type`), but both ultimately need to produce the same mount-point markup + bootstrap JSON. Centralizing that in one renderer means shortcode attributes and block attributes must map to the *same* config shape (enforced by both adapters calling the same method signature), which directly satisfies "share one render path without duplicating logic."
- **`Plugin.php` as composition root:** WordPress has no built-in service container. Rather than pull in a DI library (overkill for ~6-8 classes), one `Plugin.php` file constructs concrete strategy instances and injects them into `SessionController` and `SettingsPage` via constructor args. This is the smallest unit of "dependency injection" needed — swapping strategies later means changing the `new WpOptionsConfigSource()` / `new OpenAiDirectTokenProvider()` lines in exactly one file.
- **`Assets/AssetManager.php` separate from `Render/`:** enqueuing must happen on `wp_enqueue_scripts` (a WordPress hook with strict timing — too late to call reliably from inside a shortcode callback that may run during `the_content` filtering, after the head has already been printed in many themes/caching setups). Keeping asset registration on its own hook, decoupled from *whether* the shortcode/block is actually used on the page, avoids the classic "script not loaded because shortcode rendered after wp_head" bug (see Anti-Pattern 1).
- **`build/khaveeai-bundle.js` lives under `wordpress-plugin/` but is built by a separate bundler config, not `tsc`:** every other package in this monorepo builds with `tsc` (type-checking, multi-file output for library consumption). The WP bundle is the opposite — one consumer-facing IIFE/UMD file with React/Three.js inlined. This needs Vite or esbuild, not `tsc`. Treating it as its own buildable unit (even if its output physically lives inside `wordpress-plugin/`) keeps the existing `tsc`-based package builds untouched, satisfying the "must not break existing providers" constraint.

## Architectural Patterns

### Pattern 1: Strategy interfaces for config source and token minting

**What:** Two narrow PHP interfaces — `ConfigSourceInterface` (where do settings come from) and `TokenProviderInterface` (how is a session token minted) — each with exactly one concrete implementation this milestone, instantiated in one composition-root file.
**When to use:** Whenever the milestone explicitly says "swappable later, don't touch the JS bundle" — this is precisely that case (Custom mode now, Platform mode later, blocked on a `khavee-app` endpoint that doesn't exist yet, per `.planning/PROJECT.md`).
**Trade-offs:** Pro — zero cost today (it's just one `implements` clause per class), all the cost is paid later when adding the second implementation, and the JS bundle genuinely never needs to change because the REST response shape is the actual contract, not the PHP class names. Con — a single-implementation interface can look like premature abstraction to a reviewer; mitigate by keeping both interfaces under 2-3 methods each (no speculative methods for Platform mode that aren't needed yet).

**Example:**
```php
interface ConfigSourceInterface {
    /** Public-safe display/runtime config — never includes the API key. */
    public function get_runtime_config(): array; // ['instructions' => ..., 'voice' => ..., 'avatar_url' => ..., 'model' => ...]

    /** Server-side-only secret, never serialized into a REST response or the JS bundle. */
    public function get_api_key(): string;
}

interface TokenProviderInterface {
    /**
     * @param array $session_config Shape matching OpenAIRealtimeProvider's `sessionConfig` (model, instructions, voice, tools, audio).
     * @param string $api_key Resolved by ConfigSourceInterface::get_api_key(), passed in — TokenProvider never reads wp_options itself.
     * @return array{ephemeralToken: string, sessionId: ?string, expiresAt: ?int}
     */
    public function mint_session(array $session_config, string $api_key): array;
}
```

### Pattern 2: One shared render path, two thin registration adapters

**What:** `AvatarRenderer::render(array $atts): string` is the single function that knows how to turn a normalized attributes array into mount-point HTML. `AvatarShortcode` and `AvatarBlock` are each ~10-20 lines: parse their respective input format (`shortcode_atts()` vs block `$attributes` array) into the *same* normalized shape, then call `AvatarRenderer::render()`.
**When to use:** Any time a WP plugin must support both shortcode and block for the same feature — this is a well-established pattern in real-world plugins (widget-embedding plugins commonly use a shared render callback for exactly this reason, per general WP plugin development conventions surveyed).
**Trade-offs:** Pro — config shape (instructions override, voice override, avatar override per-instance) is defined exactly once; admin defaults and per-shortcode/per-block overrides merge through one code path, so there's no risk of shortcode and block attributes silently drifting apart. Con — block attributes need a `block.json` schema that's kept in sync by hand with the shortcode's accepted attribute names (no codegen exists for this in core WP) — mitigate with a single PHP constant/array listing the canonical attribute names, referenced by both `block.json`'s comments and the shortcode's `shortcode_atts()` defaults.

**Example:**
```php
final class AvatarRenderer {
    public function __construct(
        private ConfigSourceInterface $config_source,
        private AssetManager $assets
    ) {}

    public function render(array $atts): string {
        $defaults = $this->config_source->get_runtime_config();
        $merged = wp_parse_args($atts, $defaults); // per-instance atts override admin defaults
        $this->assets->enqueue(); // idempotent — safe to call N times if N shortcodes/blocks on one page
        $id = 'khaveeai-' . wp_unique_id();
        return sprintf(
            '<div id="%s" class="khaveeai-root" data-khaveeai-config="%s"></div>',
            esc_attr($id),
            esc_attr(wp_json_encode($this->public_safe($merged)))
        );
    }
}
```

### Pattern 3: REST controller as the only thing that talks to both strategies

**What:** `SessionController::create_session(WP_REST_Request $request)` is the single method that: (1) asks `ConfigSourceInterface` for runtime config + API key, (2) merges any client-supplied `sessionConfig` overrides from the POST body (mirroring what `OpenAIRealtimeProvider.ts` sends), (3) calls `TokenProviderInterface::mint_session()`, (4) shapes the response to exactly match what `OpenAIRealtimeProvider`'s `useProxy` branch parses.
**When to use:** This is the seam between PHP and the existing TypeScript provider — get this contract wrong and the JS bundle breaks regardless of which strategy implementations are behind it.
**Trade-offs:** No real trade-off — this is the one place where the response shape is genuinely load-bearing and must match the TS code exactly (see Integration Points below for the exact shape, taken directly from `OpenAIRealtimeProvider.ts:206-219`).

**Example:**
```php
public function create_session( WP_REST_Request $request ): WP_REST_Response {
    $api_key = $this->config_source->get_api_key();
    if ( empty( $api_key ) ) {
        return new WP_REST_Response( [ 'error' => 'khaveeai_not_configured' ], 503 );
    }
    $session_config = $request->get_param( 'sessionConfig' ) ?? [];
    $result = $this->token_provider->mint_session( $session_config, $api_key );
    // Shape MUST match ProxyTokenResponse parsed in OpenAIRealtimeProvider.ts connect()
    return new WP_REST_Response( [
        'data' => [
            'ephemeralToken' => $result['ephemeralToken'],
            'sessionId'      => $result['sessionId'] ?? null,
        ],
    ], 200 );
}
```

## Data Flow

### Request Flow (page load → connect → session token)

```
1. WP renders page → AvatarShortcode/AvatarBlock → AvatarRenderer::render()
       ↓ (server-side, on every page request)
   AssetManager::enqueue() → wp_enqueue_script(bundle) + wp_add_inline_script(bootstrap JSON: {restUrl, nonce, defaultConfig})
       ↓ HTML response includes <div data-khaveeai-config="..."> + <script> tags

2. Browser: bundle's entry point reads data-khaveeai-config off the mount div
       ↓
   new OpenAIRealtimeProvider({ useProxy: true, proxyEndpoint: <restUrl from bootstrap>, instructions, voice, ...})
       ↓ user clicks Connect →
   provider.connect() → POST <restUrl> with { sessionConfig: {...} }
       ↓
3. WP REST: SessionController::create_session()
       ↓ permission_callback already passed (rate-limit + public-by-design check, see Integration Points)
   ConfigSourceInterface::get_api_key() → wp_options
       ↓
   TokenProviderInterface::mint_session(sessionConfig, apiKey)
       ↓ server-to-server only
   POST https://api.openai.com/v1/realtime/client_secrets  (Authorization: Bearer <real OpenAI key>)
       ↓
   { value: "ek_...", session: {...} }  ← OpenAI's actual response shape
       ↓ PHP reshapes to khaveeai's REST contract
   { data: { ephemeralToken: "ek_...", sessionId: "..." } }
       ↓ HTTP response to browser
4. Browser: provider.connect() resolves bearerToken = data.ephemeralToken
       ↓ browser itself, directly (no PHP involved) →
   POST https://api.openai.com/v1/realtime/calls  (Authorization: Bearer ek_..., body: SDP offer)
       ↓
   WebRTC session established directly between browser and OpenAI
```

### Key Data Flows

1. **Admin config → browser bootstrap:** `wp_options['khaveeai_settings']` → `WpOptionsConfigSource::get_runtime_config()` → `AvatarRenderer::render()` merges with per-instance shortcode/block atts → serialized into `data-khaveeai-config` attribute (public-safe fields only: instructions, voice, avatar URL, model — never the API key) → read by the bundle's mount script on `DOMContentLoaded`.
2. **API key never crosses the PHP/browser boundary:** `get_api_key()` is called only inside `SessionController::create_session()`, passed directly into `TokenProviderInterface::mint_session()` as a function argument, and is never included in any value returned to the REST response or echoed into page HTML. This is the one invariant that must hold across both current and future TokenProvider implementations.
3. **Anonymous visitor → session token:** unlike most WP REST design guidance (which assumes a logged-in user with a `wp_rest` nonce), this endpoint must work for anonymous front-end visitors. The REST route's `permission_callback` cannot require `wp_verify_nonce()` against the standard `wp_rest` action tied to a logged-in user's nonce, because anonymous visitors get a weaker, cache-fragile nonce. See Integration Points for the concrete recommended approach (public + IP-based rate limiting, not user-auth nonce).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single-site, low traffic | Current design as-is: transient-based per-IP rate limiting on the REST route is sufficient; `wp_options` for config is fine (autoloaded option, cached by object cache if present). |
| Multiple shortcodes/blocks per page, moderate traffic | `AssetManager::enqueue()` must be idempotent (guard with `wp_script_is($handle, 'enqueued')`) so N widget instances on one page don't double-enqueue the bundle or fire duplicate `wp_add_inline_script` bootstrap blocks — each instance needs its own DOM id but shares one script tag. |
| High traffic / many concurrent sessions | Transient-based rate limiting (object cache-backed, e.g. Redis via a persistent object cache plugin) becomes important since each `connect()` call is a real OpenAI API call with cost; consider moving from per-IP transient counting to a dedicated rate-limit plugin or Cloudflare-level rule if traffic grows, since PHP-level transients alone don't reliably synchronize across multi-server WP setups without a shared object cache. |

### Scaling Priorities

1. **First bottleneck:** Unauthenticated REST route being hit by bots/scrapers to enumerate ephemeral tokens or exhaust OpenAI quota — mitigate immediately (this milestone, not deferred) with per-IP transient rate limiting in the controller's `permission_callback`, returning 429 past a low threshold (e.g. 5-10 session-creation requests per minute per IP, since this is a high-cost endpoint, not a read endpoint).
2. **Second bottleneck:** `wp_options` autoload bloat if the avatar/settings blob grows large (e.g. storing a base64 avatar instead of a Media Library attachment ID) — mitigated by storing only the Media Library attachment ID in options and resolving the URL via `wp_get_attachment_url()` at render time, not storing the binary or full URL in options.

## Anti-Patterns

### Anti-Pattern 1: Enqueuing scripts from inside the shortcode/block render callback

**What people do:** Call `wp_enqueue_script()` directly inside the shortcode handler or block `render_callback`, assuming "it'll just work because the function runs during page render."
**Why it's wrong:** Shortcodes run during `the_content` filtering, which in many themes happens *after* `wp_head` has already printed enqueued `<script>`/`<style>` tags (when scripts are not registered for footer output), or scripts can be missed entirely if a caching/page-builder plugin pre-renders content outside the normal hook sequence. This is one of the most commonly reported real-world WP plugin bugs for "widget doesn't show up."
**Do this instead:** Register the script/style on `wp_enqueue_scripts` (always, unconditionally, with `'in_footer' => true`) so it's queued correctly regardless of when/whether the shortcode actually renders; the bundle's mount script simply no-ops if it finds no `[data-khaveeai-config]` elements in the DOM. Optionally use `has_shortcode()`/block-presence detection on the *current post* as a performance optimization to skip enqueuing on pages that definitely don't use it — but never make enqueuing depend on the shortcode/block callback firing first.

### Anti-Pattern 2: Requiring a logged-in-user nonce on a public-facing REST route

**What people do:** Copy the common WP REST API security advice verbatim — register the route with a `permission_callback` that calls `wp_verify_nonce($nonce, 'wp_rest')` — without accounting for the fact that this endpoint must serve anonymous, not-logged-in front-end visitors.
**Why it's wrong:** A nonce generated for an anonymous visitor (`wp_create_nonce('wp_rest')` when `is_user_logged_in()` is false) is tied to UID `0`, and many full-page caching setups will serve a stale nonce baked into cached HTML, causing legitimate visitors to intermittently get `rest_cookie_invalid_nonce` errors. This is a frequently-reported real-world issue for public-facing AJAX/REST widgets on cached WP sites.
**Do this instead:** Register the route with `'permission_callback' => '__return_true'` (intentionally public) and implement actual abuse prevention via IP-based rate limiting (transient counter, 429 past threshold) plus optional lightweight checks (e.g. `Origin`/`Referer` header matching the site's own domain, as a hot-linking deterrent, not as real security). Document explicitly in code comments that this route is intentionally public-by-design, not an oversight — this matches the trust model OpenAI's own ephemeral-token pattern assumes (the short-lived, scoped token itself is the security boundary, not the minting route's auth).

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| OpenAI Realtime API (ephemeral token mint) | Server-to-server `wp_remote_post()` from `OpenAiDirectTokenProvider::mint_session()` to `https://api.openai.com/v1/realtime/client_secrets`, `Authorization: Bearer <real key>` | HIGH confidence — verified against OpenAI's current official docs (`platform.openai.com/docs/guides/realtime-webrtc`, `platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret`). Response top-level field is `value` (the `ek_...` token), default TTL ~1 minute. **This does NOT match the existing `src/app/api/negotiate/route.ts`'s SDP-relay pattern** (that route forwards the raw SDP offer to `/v1/realtime?model=...` directly, with no ephemeral-token step) — it instead matches the *other*, currently-unused-in-the-demo-app code path inside `OpenAIRealtimeProvider.connect()` (lines 139-226) that activates when `config.useProxy && config.proxyEndpoint` are both set. The WP plugin must implement the ephemeral-token contract, not the SDP-relay contract, because `useProxy: true` is required for "API key never reaches the browser." This is a concrete discrepancy worth flagging to the roadmapper: the existing demo app is not a working reference for this milestone's PHP route. |
| OpenAI Realtime API (WebRTC calls) | Browser calls `https://api.openai.com/v1/realtime/calls` directly with the ephemeral token — PHP is not involved in this step at all | Existing `OpenAIRealtimeProvider.ts` behavior (line 230), unchanged by this milestone. The WP plugin's PHP only ever touches the *token-minting* call, never the SDP/WebRTC negotiation itself. |
| WP Media Library (avatar upload) | Standard `wp_enqueue_media()` + `wp.media` JS picker in the admin settings page, storing the resulting attachment ID in `wp_options`, resolved to a URL via `wp_get_attachment_url()` at render time | Standard WP admin pattern, not a third-party API — no special research needed, well-documented in WP core. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Browser bundle ↔ WP REST route | HTTP POST, JSON in/out, contract = `{ sessionConfig }` in → `{ data: { ephemeralToken, sessionId } }` out | This is the one contract that must never change shape when swapping `ConfigSourceInterface`/`TokenProviderInterface` implementations — it's what makes the "don't touch the JS bundle" requirement achievable. Both current and future (Platform-mode) implementations must produce identically-shaped responses. |
| `AvatarShortcode`/`AvatarBlock` ↔ `AvatarRenderer` | Direct PHP method call, normalized attributes array in, HTML string out | No HTTP/REST involved — this is the "share one render path" boundary, resolved entirely server-side at WP render time, not at JS runtime. |
| `SessionController` ↔ `ConfigSourceInterface`/`TokenProviderInterface` | Direct PHP method calls, constructor-injected (composition root in `Plugin.php`) | No WP hooks/filters used for this wiring — using `apply_filters()` to let strategies be swapped via a filter is tempting but unnecessary complexity for two implementations chosen by the plugin itself; the composition root choosing the concrete class is sufficient and simpler to reason about. Revisit only if Platform mode needs to be a *site-admin* runtime choice rather than a milestone-time code choice. |
| Admin settings page ↔ `ConfigSourceInterface` | `WpOptionsConfigSource` reads/writes `wp_options` directly; `SettingsPage.php` never bypasses the interface to read options itself | Keeps the admin UI decoupled from "where config actually lives," so a future Platform-mode settings page (e.g. "enter your khavee-app API key instead of an OpenAI key") can reuse the same `SettingsPage` rendering scaffold by swapping which `ConfigSourceInterface` backs it. |
| Gutenberg block editor preview ↔ PHP render | Server-side render via `register_block_type`'s `render_callback` (dynamic block, not a static `save()` that serializes HTML into post content) | Using a dynamic block (PHP-rendered on both editor preview, via `ServerSideRender`, and the live front end) ensures the editor preview and the front end always go through the *same* `AvatarRenderer::render()` call — avoiding drift between what the editor shows and what visitors see, a common pitfall when teams instead duplicate rendering logic in JS for the editor preview. |

## Suggested Build Order

1. **`includes/ConfigSource/ConfigSourceInterface.php` + `WpOptionsConfigSource.php`** — no dependencies on anything else; defines the config shape everything downstream consumes.
2. **`includes/TokenProvider/TokenProviderInterface.php` + `OpenAiDirectTokenProvider.php`** — no dependency on ConfigSource (takes the API key as a parameter, doesn't fetch it itself); can be built/tested in parallel with step 1.
3. **`includes/Rest/SessionController.php`** — depends on both interfaces from steps 1-2 (via constructor injection); this is the contract the JS bundle needs, so having it working and testable via `curl`/Postman before touching any JS de-risks the integration.
4. **`includes/Plugin.php`** (composition root) — wires steps 1-3 together; minimal but needed before the plugin does anything on a real WP install.
5. **`includes/Admin/SettingsPage.php`** — depends on `ConfigSourceInterface` (step 1) to read/write; can be built before or after step 3/4, no hard blocking dependency, but needed before real end-to-end testing since `WpOptionsConfigSource` needs actual settings to read.
6. **The bundler package for `build/khaveeai-bundle.js`** (separate small TS package, e.g. `wordpress-plugin/bundle-src/` built with Vite/esbuild, importing `@khaveeai/react` + `@khaveeai/providers-openai-realtime`) — can start in parallel with steps 1-5 since it only needs to know the REST contract shape (already defined by step 3's interface, doesn't need step 3's implementation finished) and the `data-khaveeai-config` attribute shape.
7. **`includes/Render/AvatarRenderer.php`** — depends on `ConfigSourceInterface` (step 1) and needs to know the bundle's expected bootstrap data shape (step 6), so build after both are stable.
8. **`includes/Assets/AssetManager.php`** — depends on the bundle file existing (step 6) and is called by `AvatarRenderer` (step 7); register on `wp_enqueue_scripts` per Anti-Pattern 1.
9. **`includes/Shortcode/AvatarShortcode.php`** — depends on `AvatarRenderer` (step 7); thin adapter, fastest to build once the renderer exists, and gives an end-to-end testable path (shortcode → renderer → assets → REST → OpenAI) before the block adds editor-side complexity.
10. **`includes/Block/AvatarBlock.php` + `block.json` + `assets/editor.js`** — depends on `AvatarRenderer` (step 7), built last since it's the most WP-API-specific piece (block registration, `ServerSideRender` editor preview, `InspectorControls`) and benefits from the shortcode path already proving the renderer/REST/bundle integration works.
11. **`khaveeai.php`** (top-level bootstrap/plugin header) — technically needed for WP to recognize the plugin at all, but can be a minimal stub from day one (just headers + autoloader require) and only needs final hook-registration wiring once steps 1-10 exist to register.

**Rationale for this order:** the two strategy interfaces (1-2) and the REST contract they back (3) are the actual integration risk this milestone calls out explicitly — building and curl-testing that triangle first means the eventual JS bundle work (6) has a stable, already-verified contract to target, and the render/shortcode/block layers (7-10) are comparatively low-risk, well-documented WordPress patterns that can be built quickly once the harder PHP-to-OpenAI integration is proven.

## Sources

- [Realtime API with WebRTC | OpenAI API](https://platform.openai.com/docs/guides/realtime-webrtc) — HIGH confidence, official docs, confirms `/v1/realtime/client_secrets` ephemeral token endpoint and `/v1/realtime/calls` WebRTC negotiation endpoint
- [Create client secret | OpenAI API Reference](https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret) — HIGH confidence, official API reference, confirms response shape (`value` field, `ek_` prefix, default ~1 min TTL)
- `/Users/whitemalt/Documents/khavee-sdk/packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` (lines 134-260) — HIGH confidence, this is the actual consuming code; the `useProxy`/`proxyEndpoint` branch and its `ProxyTokenResponse` type define the exact contract the WP REST route must satisfy
- `/Users/whitemalt/Documents/khavee-sdk/src/app/api/negotiate/route.ts` — HIGH confidence (read directly), documents that the *existing* Next.js demo route uses a different, older SDP-relay pattern not matching the `useProxy` contract — flagged as a discrepancy, not something to copy
- [Adding Custom Endpoints – REST API Handbook | Developer.WordPress.org](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/) — HIGH confidence, official WP docs, `register_rest_route`/`permission_callback` patterns
- [How to Properly Restrict Access to WordPress REST API Routes – Plugin Vulnerabilities](https://www.pluginvulnerabilities.com/2022/12/13/how-to-properly-restrict-access-to-wordpress-rest-api-routes/) — MEDIUM confidence, community source, corroborates `__return_true` vs nonce trade-off for public endpoints
- WebSearch: WP REST rate limiting via transients (wpthrill.com, benryan.com.au, wpwinners.com, headwall-hosting.com — multiple independent sources agreeing on transient-based per-IP throttling pattern) — MEDIUM confidence, no single official WP core doc for this specific pattern, but consistent across independent community sources
- WebSearch: WordPress DI/strategy pattern conventions (carlalexander.ca "Using dependency injection with WordPress", x-wp/di and lucatume/di52 GitHub repos) — MEDIUM confidence; confirms "interfaces over concrete classes, avoid the God Class singleton anti-pattern" is established community best practice, but there is no single official WordPress-endorsed DI standard — the composition-root approach recommended here is a deliberately lightweight compromise given the small number of swappable classes in this plugin, not a claim that this is "the" WordPress way
- WebSearch: `wp_localize_script` vs `wp_add_inline_script` vs data attributes for passing PHP config into JS (developer.wordpress.org reference page, yourwpweb.com) — MEDIUM confidence; `wp_add_inline_script` is documented in WP core as the modern replacement for `wp_localize_script` when not localizing translatable strings, which matches this plugin's use case (passing REST URL/nonce/config, not i18n strings)
- Gutenberg dynamic blocks / `ServerSideRender` pattern for editor-preview-matches-frontend — MEDIUM confidence, well-established Gutenberg convention referenced across WordPress block development community sources, not independently re-verified against a single canonical doc in this research pass — flag for validation if block editor preview behavior diverges from expectations during implementation

---
*Architecture research for: WordPress plugin PHP layer — config-source/token-provider strategy seam, React SPA bridging, shared shortcode/block render path, anonymous REST session minting*
*Researched: 2026-06-21*
