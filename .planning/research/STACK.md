# Stack Research — WordPress Plugin (v2.0 Milestone)

**Domain:** WordPress plugin (PHP backend + bundled React/Three.js frontend widget) embedding an OpenAI Realtime voice-chat VRM avatar
**Researched:** 2026-06-21
**Confidence:** HIGH (WordPress core APIs, REST API auth model, Settings API, upload_mimes pattern — all verified against developer.wordpress.org) / MEDIUM (bundler choice — verified via multiple community sources, no Context7 entry for `@wordpress/scripts`)

> **Note:** This file covers ONLY the WordPress-plugin-specific stack for the v2.0 "WordPress Plugin (Custom Mode)" milestone. It does not duplicate or replace `STACK.md`, which documents the prior milestone's `generic-stt-tts` pipeline + Python ML services research (2026-06-17) — that research remains valid and unrelated to this scope. The WordPress plugin embeds the EXISTING `OpenAIRealtimeProvider` (full-duplex WebRTC), not the `generic-stt-tts` pipeline.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@wordpress/scripts` | ^32.4.0 | Zero-config webpack build for the plugin's JS bundle (shortcode widget + admin settings UI) | WordPress's own officially maintained build tool, built on webpack + Babel, designed specifically for plugin/block authors. It auto-generates a PHP `*.asset.php` dependency manifest (script handle + version + dependency array) that `wp_register_script()` can `require()` directly — eliminating manual cache-busting and dependency tracking. Already handles JSX/TSX, CSS, and SCSS out of the box. **Do not use `@wordpress/build`** — announced April 2026 as the eventual esbuild-based successor but explicitly stated as "not ready for every use case yet," with documented gaps in block registration; has not replaced `@wordpress/scripts` even internally yet. Revisit in a future milestone once convergence completes. |
| PHP | 7.4+ syntax target, write for 8.0+ runtime | Plugin backend language | WordPress core still declares PHP 7.4 as its minimum, but the vast majority of active wordpress.org installs run PHP 8.0+. Target 7.4-compatible syntax (no enums, no readonly properties) only if planning wordpress.org distribution for max install-base reach; otherwise write modern PHP 8.x and declare `Requires PHP: 8.0` in the plugin header. |
| Composer (PSR-4 autoloading only, no runtime HTTP deps) | latest 2.x | Class autoloading for the plugin's PHP code | WordPress core ships no autoloader. Hand-rolled `require_once` chains don't scale past a handful of classes. Composer's PSR-4 autoload map (`"Khavee\\Plugin\\": "includes/"`) is the de facto standard among modern WP plugins and costs nothing at runtime beyond one `require __DIR__ . '/vendor/autoload.php';` in the bootstrap file. Do NOT pull in a Composer HTTP client — see "What NOT to Use". |
| Native WordPress plugin file structure (no scaffolding generator) | N/A | Overall plugin file/folder layout | `wordpress-plugin/includes/` (PHP classes, PSR-4 autoloaded) and `wordpress-plugin/src/` (uncompiled JS/TSX source for `@wordpress/scripts` to build) are already pre-scaffolded as empty directories — this matches the convention used by Gutenberg-block plugins and the "PSR-4 WordPress Plugin Boilerplate" pattern: one root `khaveeai.php` bootstrap file with the required plugin header docblock, `includes/` for namespaced classes, `src/` for source JS, `build/` (generated, gitignored) for compiled output. |

### Supporting Libraries (JS side — bundled by @wordpress/scripts)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react`, `react-dom` | ^19.1.0 (match existing `packages/react` peerDependency) | UI runtime for the avatar widget and admin settings screen | Already the version used across the monorepo (`@khaveeai/react`, root Next.js app). Keep in lockstep to avoid two incompatible React copies if the plugin imports `@khaveeai/react` directly. |
| `@wordpress/element` | bundled with `@wordpress/scripts` deps | WordPress's thin wrapper around React, for the **admin settings page only**, if it's built as a React UI | WP core loads its own copy of React via `wp-element` for the block editor. If the admin settings screen is a React UI, importing `@wordpress/element` instead of bare `react` lets `@wordpress/scripts`'s bundled `DependencyExtractionWebpackPlugin` externalize React against WP's already-loaded `wp-element`/`react` globals — shrinking the bundle and avoiding "two Reacts" conflicts in `wp-admin`. **For the public-facing shortcode/block widget (the VRM avatar)**, do NOT rely on `wp-element` externalization — ship a fully bundled React copy there, since the widget must work standalone on the front end where `wp-element` is not guaranteed to be enqueued, and exact version control matching `@khaveeai/react`'s peer dependency matters more than bundle size there. |
| `three`, `@pixiv/three-vrm`, `@react-three/fiber`, `@react-three/drei` | pin exactly to what `@khaveeai/react` already uses (`three ^0.180.0`, `@pixiv/three-vrm ^3.4.2`, `@react-three/fiber ^9.3.0`, `@react-three/drei ^10.7.6`) | 3D avatar rendering, reused via `@khaveeai/react`'s `VRMAvatar`/`GLBAvatar` components | The plugin's widget bundle should consume `@khaveeai/react` and `@khaveeai/core` directly rather than re-implementing avatar rendering — this is the existing, validated component layer. Pinning exact versions avoids a second, divergent three.js copy bloating the bundle (three.js does not tree-shake well across duplicate major/minor versions — see Version Compatibility). |
| `@khaveeai/react`, `@khaveeai/core`, `@khaveeai/providers-openai-realtime` | `workspace:*` inside the monorepo (published npm versions if built/packaged standalone) | Avatar rendering, core types, and the `OpenAIRealtimeProvider` WebRTC voice client | This is the entire reason the plugin can be built fast — it consumes existing, tested SDK packages rather than reimplementing the voice pipeline. The plugin's JS is essentially "a thin React app that constructs an `OpenAIRealtimeProvider`, wraps it in `KhaveeProvider`, and renders `VRMAvatar`," configured from data injected by PHP (see Integration Points below). Per PROJECT.md, the plugin targets `OpenAIRealtimeProvider` specifically (full-duplex WebRTC), not the `generic-stt-tts` pipeline. |
| None — no new schema/validation library | — | Settings form validation | PHP-side validation/sanitization uses WordPress's built-in `sanitize_text_field()`, `sanitize_textarea_field()`, `absint()`, etc. Do not add a PHP validation library for a handful of settings fields. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `wp-scripts start` / `wp-scripts build` | Dev-mode watch build / production build | Add as `package.json` scripts inside `wordpress-plugin/` — this needs its OWN `package.json` (the directory is not currently in `pnpm-workspace.yaml`'s globs). Recommended: add `wordpress-plugin` to the pnpm workspace list so it can depend on `@khaveeai/react`/`@khaveeai/core` via `workspace:*` during development, switching to published semver ranges only at packaging/release time. |
| PHPCS + `WordPress-Coding-Standards` ruleset | PHP linting against WP coding conventions | Optional but standard for any plugin aiming at wordpress.org distribution; not required for an internally-distributed/self-hosted plugin, but cheap to add as a Composer dev-dependency. |
| `wp-env` (`@wordpress/env`) | Local WordPress + MySQL Docker environment for manual testing | Recommended over a manual MAMP/LocalWP install — spins up a disposable WP instance with the plugin auto-mounted, matching how Gutenberg itself is developed/tested. Also the easiest way to verify `@wordpress/scripts` version compatibility against a specific target WP core version before assuming it. |

## Installation

```bash
# Inside wordpress-plugin/ (new package.json, separate from root monorepo package.json
# unless wordpress-plugin is added to pnpm-workspace.yaml)
npm install --save-dev @wordpress/scripts @wordpress/env

# Frontend/admin React app dependencies
npm install react@^19.1.0 react-dom@^19.1.0
npm install @khaveeai/core @khaveeai/react @khaveeai/providers-openai-realtime

# PHP side (run from wordpress-plugin/)
composer init
composer require --dev wp-coding-standards/wpcs squizlabs/php_codesniffer  # optional, lint-only
# Do NOT `composer require` an HTTP client (guzzlehttp/guzzle, etc.) —
# use WordPress core's wp_remote_post()/wp_remote_get() instead (see "What NOT to Use")
```

## Integration Points with Existing khavee-sdk Packages

- **`OpenAIRealtimeProvider` (`@khaveeai/providers-openai-realtime`)** — the plugin's JS bundle constructs this directly, configured with a `useProxy`-style mode pointed at the plugin's own WP REST route instead of `src/app/api/negotiate/route.ts`. The provider class itself needs no modification; only the endpoint URL it's given changes.
- **`KhaveeProvider` / `VRMAvatar` / `GLBAvatar` (`@khaveeai/react`)** — reused as-is for rendering. The plugin's React entry point wraps the configured provider instance in `KhaveeProvider` exactly like `src/app/openai/page.tsx` does, then renders `VRMAvatar` (or `GLBAvatar` depending on the uploaded file type).
- **`@khaveeai/core` types** — `RealtimeConfig`, `RealtimeProvider` types flow through unchanged; the plugin does not need new core types, only PHP-side equivalents of the same config shape (API key, voice, instructions) serialized into the page via `wp_localize_script`/inline JSON.
- **The existing Next.js `negotiate` route is the direct PHP porting target** — `src/app/api/negotiate/route.ts` takes a raw SDP body, forwards it to OpenAI with the server-held API key, returns the SDP answer. The PHP REST route should replicate this exactly (see Architecture/Pitfalls files for the request/response shape), registered as a public WP REST endpoint.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| `@wordpress/scripts` (webpack-based) | Vite (via `vite-for-wp` or a manual manifest integration) | Vite gives faster HMR and simpler config, and works fine for plugins shipping ONE standalone bundle consumed via a plain `<script type="module">` tag with no WP dependency externalization needs. Choose Vite only if willing to hand-write the PHP-side asset-enqueueing/versioning logic (Vite does not auto-generate a `*.asset.php` manifest the way `@wordpress/scripts` does) and don't need to externalize against `wp-element`/`wp-i18n` globals. For this plugin (admin settings page inside `wp-admin` + a public widget), `@wordpress/scripts`'s automatic dependency externalization and zero-config asset versioning outweighs Vite's faster dev loop. |
| `@wordpress/scripts` (webpack) | esbuild directly (manual config) | Raw esbuild bundles dramatically faster than webpack, but loses `DependencyExtractionWebpackPlugin`'s automatic WP-global externalization and the auto-generated asset manifest — both would need hand-reimplementing. Worth revisiting once `@wordpress/build` (WordPress's own esbuild-based successor) matures past its current early/unstable state. |
| Composer PSR-4 autoloading, hand-rolled classes | A WP plugin boilerplate generator (e.g., "PSR-4 WordPress Plugin Boilerplate" GitHub template) | Boilerplate generators are fine time-savers for a brand-new solo plugin, but this plugin already has a pre-scaffolded `includes/`/`src/` shape from prior planning — bootstrapping from a generator template would fight that existing structure. Use the generator's *patterns* (namespace-per-folder, one bootstrap file with the plugin header) without importing its full scaffold. |
| `wp_remote_post()` (WP HTTP API) for calling OpenAI's `client_secrets` endpoint | Guzzle / raw cURL via Composer | Only reach for Guzzle if advanced HTTP features WP's HTTP API genuinely lacks are needed (HTTP/2, connection pooling) — irrelevant for a single short POST per visitor session. Guzzle adds a Composer dependency tree that must be vendored and shipped inside the plugin zip, increasing plugin size and conflict risk with other plugins that also bundle Guzzle at a different version (a well-known WP plugin compatibility hazard). |
| Server-injected localized config (`wp_localize_script` / `wp_add_inline_script` with `wp_json_encode`) for passing PHP settings into the JS bundle | A second REST round-trip from JS to fetch settings on mount | For settings that are public anyway (voice picker choice, avatar URL, instructions text used to seed the realtime session), inject them directly into the page at render time — avoids an extra HTTP request and avoids needing a public "get settings" REST route at all. Reserve the REST route exclusively for the action that must happen per-session and must hit OpenAI server-side: minting the ephemeral client secret. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `@wordpress/build` (the new esbuild-based tool) | Explicitly documented (April 2026 WP developer blog) as not production-ready, with known gaps in block registration and no stated migration timeline for `@wordpress/scripts` users | `@wordpress/scripts` (current stable, webpack-based) |
| Guzzle / any Composer-vendored HTTP client | WordPress core already ships `wp_remote_get()`/`wp_remote_post()`, which route through the same filter/action system as the rest of WP core (so other plugins/security tools can intercept/inspect outbound requests), require zero vendoring, and avoid version-conflict risk with other installed plugins that bundle their own (possibly different-version) Guzzle copy in `vendor/` | `wp_remote_post()` with an explicit `timeout` arg (default WP timeout is only 3s — set `timeout => 10` defensively for the OpenAI call) |
| WordPress nonces (`wp_create_nonce('wp_rest')` / `X-WP-Nonce`) as the auth mechanism for the **ephemeral-token-minting REST route** | Nonces are cryptographically tied to a specific logged-in user's ID + session token (or, for logged-out users, the `nonce_user_logged_out` filter value) and are explicitly documented as unsuitable for anonymous/public-facing pages — they silently break under any page-caching layer (cached HTML serves a stale nonce to every visitor, causing `403 rest_cookie_invalid_nonce` for everyone once the cache is warm). The avatar widget's session-token route is hit by anonymous front-end visitors on a likely-cached page — exactly the documented failure case | Register the route with `'permission_callback' => '__return_true'` (fully public, matching how the existing Next.js `negotiate` route has zero auth gating — the OpenAI API key itself is the only secret, held server-side) and protect it instead with: (a) optional origin/referer checks, (b) a short server-side rate limit (e.g., WP transients keyed by IP) to prevent abuse of the site owner's OpenAI quota, (c) never exposing the real API key — only ever returning OpenAI's short-lived (1-minute) ephemeral client secret. This mirrors the project's own established pattern in `src/app/api/negotiate/route.ts`. |
| Plain-text API key storage with no masking on display | The OpenAI key is the single secret this plugin must protect (per CLAUDE.md: "the OpenAI key never reaches the browser") | At minimum use WP's Settings API with a `sanitize_callback` and store via `update_option()` (already not browser-readable by default, since `wp_options` is not exposed via default REST routes); never echo the raw key value back into any admin page HTML field on reload — mask it (show last 4 chars only, require re-entry to change). Encryption-at-rest (e.g., `openssl_encrypt` keyed off `wp_salt('auth')`) is a defensible *additional* hardening step but not strictly required given the above. |
| `mime_types` filter for restricting GLB/GLTF uploads to Media Library | `mime_types` is documented for ADDING types broadly (affects more than upload validation alone); `upload_mimes` is the correct, narrower filter specifically for the upload-allowlist check | `add_filter('upload_mimes', ...)` to register `glb` → `model/gltf-binary` and `gltf` → `model/gltf+json`, PLUS `add_filter('wp_check_filetype_and_ext', ...)` (5-arg signature) to patch WordPress's `wp_check_filetype_and_ext()` validation step, which independently re-derives the MIME type from the file's real extension/content and will reject the upload even after `upload_mimes` allows it, unless also patched. Both filters are required together — a commonly-missed two-filter requirement, not a single-filter fix. |
| A second, parallel "platform mode" code path built ad hoc inside this milestone | Out of scope per PROJECT.md — `khavee-app`'s API-key-gated ephemeral-token endpoint does not exist yet | Build the config-source/token-provider PHP classes as an interface (e.g., `interface Token_Provider { public function mint(): array; }`) with exactly one concrete implementation (`Custom_OpenAI_Token_Provider`) this milestone — the seam for a future `Platform_Token_Provider` is structural, not implemented |

## Stack Patterns by Variant

**If the plugin needs to be distributed on wordpress.org (public plugin directory):**
- Target `Requires PHP: 7.4` in the plugin header for max compatibility, even though development happens against 8.x
- Avoid bundling node_modules in the distributed zip — only the `build/` output of `@wordpress/scripts build` plus PHP files ship; `src/`, `node_modules/`, and dev tooling are excluded via `.distignore`
- All third-party JS libraries (React, Three.js) must still be bundled (wordpress.org review guidelines require not relying on external CDNs for core functionality)

**If the plugin is only ever self-hosted/distributed directly to clients (not wordpress.org):**
- Freer to target `Requires PHP: 8.0+` and use modern PHP syntax (enums, readonly properties, named arguments)
- Can skip the PHPCS/WPCS linting step (still good practice, but not gating)

**If `wordpress-plugin/` is added to the pnpm workspace (recommended for this monorepo):**
- Add `wordpress-plugin` to `pnpm-workspace.yaml`'s package globs so it can `import` `@khaveeai/react`/`@khaveeai/core`/`@khaveeai/providers-openai-realtime` via `workspace:*`, keeping the plugin's avatar bundle always in sync with in-repo SDK changes during this milestone — switch to published semver ranges only at release/packaging time
- This matches the project's existing convention (no sibling packages import via relative `../../` paths — always via `@khaveeai/*` package name)

**If the admin settings UI is built WITHOUT React (plain PHP-rendered HTML form via Settings API):**
- Skip bundling a second JS entry point for `wp-admin` entirely — only `@wordpress/scripts` needs to build the public-facing shortcode/block widget bundle
- This is the lower-complexity option and is recommended unless the settings page genuinely needs dynamic JS behavior (e.g., live voice preview, drag-drop avatar upload with progress) that a plain HTML form can't provide cheaply — a basic API-key/textarea/dropdown/Media-Library-button settings page does NOT need React; WP's native Settings API + the core Media Library uploader JS (`wp.media`) handles the avatar file picker without any custom bundle

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `react@^19.1.0` | `@khaveeai/react@0.2.9`, `@khaveeai/core@0.3.3`, `@khaveeai/providers-openai-realtime@0.3.13` | All three already declare `peerDependencies: { react: ">=18.0.0" }` or `"^18.0.0 || ^19.0.0"` — pin the plugin's own React copy to exactly 19.1.0 to match what's validated in the monorepo's demo app |
| `@wordpress/scripts@^32.4.0` | WordPress core 6.x (current), PHP 7.4–8.x | `wp-scripts` versions track Gutenberg/WP core release cadence; verify against the target site's actual WP core version if it's an older LTS-pinned install — `wp-env` lets you test against a pinned WP core version locally before assuming compatibility |
| `three@^0.180.0` + `@pixiv/three-vrm@^3.4.2` | Must match exactly what `@khaveeai/react` already pins | three.js has no semver stability guarantee across minor versions for its internal APIs that `@pixiv/three-vrm` depends on — a mismatched three.js version between the plugin's own `node_modules` and `@khaveeai/react`'s expected peer can produce duplicate-three.js-instance runtime errors (`multiple instances of three.js being imported`) inside `wp-admin` or the front-end widget. Resolve this via the pnpm workspace (single hoisted copy) rather than letting the plugin's standalone `node_modules` diverge. |

## Sources

- [@wordpress/scripts npm package](https://www.npmjs.com/package/@wordpress/scripts) — version verification (32.4.0 as of 2026-06-21)
- [@wordpress/build, the next generation of WordPress plugin build tooling – WordPress Developer Blog](https://developer.wordpress.org/news/2026/04/wordpress-build-the-next-generation-of-wordpress-plugin-build-tooling/) — confirmed `@wordpress/build` is esbuild-based, explicitly "not ready for every use case yet," gaps in block registration; fetched and verified directly (HIGH confidence, official WP source)
- [How webpack and WordPress packages interact – WordPress Developer Blog](https://developer.wordpress.org/news/2023/04/how-webpack-and-wordpress-packages-interact/) — `DependencyExtractionWebpackPlugin` behavior, auto-generated `*.asset.php` manifest
- [Get started with wp-scripts – Block Editor Handbook](https://developer.wordpress.org/block-editor/getting-started/devenv/get-started-with-wp-scripts/) — zero-config build setup, JSX/SCSS support (official docs, HIGH confidence)
- [upload_mimes – Hook, WordPress Developer Resources](https://developer.wordpress.org/reference/hooks/upload_mimes/) — official filter reference (HIGH confidence)
- [JimJ92120/wordpress-plugin-allow-models-upload](https://github.com/JimJ92120/wordpress-plugin-allow-models-upload/blob/main/allow-models-upload.php) — verified working code pattern for `upload_mimes` + `wp_check_filetype_and_ext` dual-filter requirement for `.glb`/`.gltf` (MEDIUM confidence — single community source, but pattern matches official hook documentation and is internally consistent)
- [Authentication – REST API Handbook](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/) — nonce mechanics, `X-WP-Nonce` header, anonymous request behavior (official docs, HIGH confidence)
- [Adding Custom Endpoints – REST API Handbook](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/) — `permission_callback`, `__return_true` for public routes (official docs, HIGH confidence)
- [Understand and use WordPress nonces properly – WordPress Developer Blog](https://developer.wordpress.org/news/2023/08/understand-and-use-wordpress-nonces-properly/) — nonce-vs-caching incompatibility for anonymous/public pages (official docs, HIGH confidence)
- [HTTP API – Plugin Handbook](https://developer.wordpress.org/plugins/http-api/) — `wp_remote_post`/`wp_remote_get`, default 3-second timeout (official docs, HIGH confidence)
- [register_setting() – Function Reference](https://developer.wordpress.org/reference/functions/register_setting/) — Settings API `sanitize_callback` pattern (official docs, HIGH confidence)
- OpenAI Realtime API ephemeral token endpoint (`POST /v1/realtime/client_secrets`, 1-minute token expiry) — verified via WebSearch against `platform.openai.com`/`developers.openai.com` references; cross-checked against this repo's own existing `src/app/api/negotiate/route.ts` pattern (MEDIUM confidence — training-data-adjacent but consistent with the codebase's already-working implementation)
- Repo inspection: `src/app/api/negotiate/route.ts`, `packages/providers/openai-realtime/package.json`, `packages/react/package.json`, `packages/core/package.json`, `wordpress-plugin/` directory listing (confirmed completely empty) — HIGH confidence, direct read

---
*Stack research for: WordPress plugin (PHP + bundled React/Three.js voice-avatar widget)*
*Researched: 2026-06-21*
