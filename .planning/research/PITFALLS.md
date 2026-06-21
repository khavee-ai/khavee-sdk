# Pitfalls Research — WordPress Plugin (v2.0 Milestone)

**Domain:** WordPress plugin embedding a bundled React 19 + Three.js (VRM avatar) SPA, an anonymous-callable REST route that mints OpenAI Realtime ephemeral tokens using a server-held API key, and admin-uploaded VRM/GLB 3D model files via the Media Library
**Researched:** 2026-06-21
**Confidence:** MEDIUM — WordPress core API behavior (nonces, `upload_mimes`, `register_rest_route`, plugin-review guidelines) is HIGH confidence (official developer.wordpress.org docs). OpenAI Realtime-API-specific abuse/quota figures are LOW confidence (no official per-IP/proxy-specific guidance found — see Gaps). This plugin's exact design combination (anonymous ephemeral-token minting + WebRTC + VRM upload) has no directly comparable shipped precedent — pitfalls below are synthesized from the closest documented analogs (general WP REST API abuse patterns, GLB-supporting WP plugins, OpenAI client-secret guidance, this repo's own `src/app/api/negotiate/route.ts`) and applied to this specific architecture.

> **Note:** This file covers ONLY the WordPress-plugin-specific pitfalls for the v2.0 "WordPress Plugin (Custom Mode)" milestone. It does not duplicate or replace `PITFALLS.md`, which documents the prior milestone's `generic-stt-tts` pipeline + Python ML services pitfalls (2026-06-17) — that research remains valid and unrelated to this scope. See `STACK-wordpress-plugin.md` for the corresponding stack recommendations.

## Critical Pitfalls

### Pitfall 1: Anonymous ephemeral-token route becomes an unmetered OpenAI API-key proxy

**What goes wrong:**
The REST route's entire job is to let a visitor who is NOT logged into WordPress (and therefore cannot be gated by WP user capabilities, and cannot reliably receive a `wp_rest` cookie nonce) call a PHP endpoint that holds the site owner's real OpenAI API key and mints a Realtime ephemeral token. Because `permission_callback` must effectively be `__return_true` (or equivalent) for this to work for anonymous visitors, anyone who discovers the route (e.g. `/wp-json/khaveeai/v1/token`) can call it directly with no browser/avatar in the loop at all — repeatedly, in a scripted loop — and each call consumes the site owner's real OpenAI quota/billing, even if the resulting token is never used to open a WebRTC session.

**Why it happens:**
Developers conflate "must work for anonymous visitors" with "must have no auth." Those are not the same requirement. The ephemeral-token pattern already proven in this same repo (`src/app/api/negotiate/route.ts`) was built for a single trusted Next.js demo page; the WP version must additionally defend a publicly discoverable route on any site running this plugin, reachable by anyone, not just the plugin's own bundle.

**How to avoid:**
- Never ship bare `__return_true` with no other checks. Use a permission callback that still runs cheap mitigations: check `wp_get_referer()`/`Origin` roughly matches the site's own domain (spoofable, but stops casual scripted abuse — defense-in-depth, not real auth).
- Implement server-side rate limiting inside the route handler using WP transients keyed by `$_SERVER['REMOTE_ADDR']` (max N mints per IP per minute via `set_transient`/`get_transient`) — this must live in PHP shipped with the plugin itself, not depend on a separate security plugin, since the plugin must be self-contained.
- Add an admin-configurable daily mint ceiling (tracked via an option/transient counter) that hard-stops with HTTP 429 once exceeded, independent of OpenAI's own token expiry, so a single abused install cannot run up unbounded billing.
- Mint OpenAI ephemeral sessions with the shortest expiry/scope the API allows, minimizing blast radius even if a token is somehow exfiltrated.
- Log mint events (IP, timestamp, count) to a rotating option so the admin has visibility — this plugin has no centralized dashboard like the hosted platform does.

**Warning signs:**
- OpenAI usage dashboard shows token-mint rate disproportionate to actual realtime session/audio-minute usage (many tokens minted, few real WebRTC connections).
- Support reports of "my OpenAI bill spiked" with no corresponding traffic increase to pages containing the shortcode/block.

**Phase to address:**
REST/token-route design phase — rate limiting and scope-minimization must be architected into the route handler from its first implementation. Retrofitting auth onto an already-discoverable, already-documented route is a breaking change for existing embeds.

---

### Pitfall 2: Nonce-based auth is assumed to "just work" for anonymous visitors, then silently fails or is wrongly bypassed

**What goes wrong:**
WordPress's standard REST security pattern — `X-WP-Nonce` cookie-based nonces — only authenticates a request as a specific *logged-in* WP user. It provides no protection model for anonymous, never-logged-in front-end visitors at all (`wp_create_nonce('wp_rest')` for an anonymous visitor ties to user ID 0 and offers no real replay/forgery protection for a public widget). Developers either (a) try to force nonce auth and break the widget for non-logged-in visitors, or (b) give up on nonces entirely and drop ALL request validation, leaving the route wide open.

**Why it happens:**
Most WP REST API tutorials describe nonce auth in the context of admin-side or logged-in-user JS (e.g. the block editor itself), where `wp_localize_script` injects a valid per-user nonce. This plugin's front-end SPA is embedded on a public page for an anonymous visitor — that tutorial pattern does not transfer.

**How to avoid:**
- Treat the route as genuinely public/anonymous from the start; do not repurpose `wp_rest` cookie nonces as the real security boundary.
- Use referer/origin checks plus the rate limiting from Pitfall 1 instead, explicitly documented in code comments as "abuse mitigation," not "authentication" — be honest that this is not a true auth boundary, since the protected secret (the OpenAI key) never leaves the server regardless of what an attacker does to this route.
- If stronger validation is desired, generate a short-lived, single-use token server-side when the page first renders (via `wp_localize_script`, not the REST nonce system) and require it on the token-mint call, invalidating it after first use via a transient.

**Warning signs:**
- Intermittent "voice avatar doesn't connect" reports, especially on cached pages (see Pitfall 3) — a sign of nonce-expiry/caching interaction.
- Any code path calling `wp_verify_nonce()` against `is_user_logged_in()` for this specific public route — a sign the wrong auth model was applied.

**Phase to address:**
REST/token-route design phase — same phase as Pitfall 1; the "no real auth, only abuse mitigation" decision must be explicit and documented, not discovered as a bug later.

---

### Pitfall 3: Full-page cache or CDN caches the token route or embeds a per-visitor token in cached HTML

**What goes wrong:**
Many WP sites run page caching (WP Super Cache, W3 Total Cache, host-level full-page cache, Cloudflare) by default. If the token-mint endpoint is implemented as GET (cacheable by convention in many proxy/CDN configs) or if a developer embeds the token directly in server-rendered shortcode/block HTML, every visitor hitting a cached page receives the *same* stale or shared ephemeral token — broken at best (expired token), a security bug at worst (a live token shared across unrelated visitors).

**Why it happens:**
The shortcode's own output (mount-point div + static config JSON) is genuinely cache-safe, but the token-mint call is dynamic/per-session. This distinction is easy to blur when writing the PHP quickly, especially since the rest of the plugin's settings really are static and cacheable.

**How to avoid:**
- Implement the token-mint endpoint as `POST` only, with `Cache-Control: no-store` explicitly set on the response.
- Never embed an ephemeral token directly in server-rendered shortcode/block HTML — the front-end bundle must always fetch the token live, client-side, after the (cacheable) page has loaded.
- Document in the readme that the shortcode/block markup is cache-safe but the live `fetch()` for the token must not be proxied/cached by aggressive "cache everything" rules.

**Warning signs:**
- Avatar works on first load but fails to reconnect after the page is re-served from cache.
- Multiple visitors report identical, simultaneous connection failures — a sign of a shared cached token expiring for all of them at once.

**Phase to address:**
REST/token-route design phase for the `POST` + `no-store` decision; integration/QA phase for verifying behavior with a caching plugin (e.g. WP Super Cache) active.

---

### Pitfall 4: Multiple React copies / version mismatch between the bundled SPA and the active theme or another plugin

**What goes wrong:**
If the plugin bundles React 19 + ReactDOM as ordinary global scripts (not isolated, not declared against WordPress's own registered `react`/`react-dom` handles), and the active theme or another plugin also loads React (possibly an older version exposed globally) — or WordPress core's own bundled React loads on the same admin screen during block-editor previews — script execution order determines which `window.React` wins. Symptoms range from silent no-ops to "Invalid hook call" errors, or duplicate React instances rendering inconsistently into the same DOM tree.

**Why it happens:**
WordPress core has bundled `react`/`react-dom` (via `wp-element`) since WP 5.0. A plugin author unaware of this bundles their own copy via Vite/webpack as a normal dependency rather than marking it `external`, duplicating React on any page where WP-core's React also loads — common on Gutenberg-adjacent themes/plugins.

**How to avoid:**
- Decide explicitly: either (a) fully isolate the bundle (no leaked globals — an IIFE/module wrapper that never assigns `window.React`/`window.ReactDOM`), or (b) externalize against WP-core's bundled `react`/`react-dom` handles via `@wordpress/dependency-extraction-webpack-plugin` and enqueue with matching `$deps`. **Given this plugin specifically needs React 19** and WP-core's bundled version may lag, full isolation (option a) is the safer default — verify WP core's currently-bundled React version before ever choosing option (b).
- Test the embed on a wp-admin "Edit Page" screen (where Gutenberg's own React is loaded) and on a front-end page with a theme/plugin known to bundle its own React (e.g. a page builder), not just a vanilla theme.

**Warning signs:**
- Console errors: "Invalid hook call," "Cannot read properties of null (reading 'useState')," or React DevTools detecting two separate React instances on one page.
- Avatar renders fine in isolated dev testing but breaks only when a specific theme/plugin is also active.

**Phase to address:**
Build-tooling/bundling phase (initial webpack/Vite config decision) — a one-time architectural choice that's expensive to reverse once the enqueue contract becomes public API that site owners build custom CSS/JS around.

---

### Pitfall 5: Script enqueue ordering and missing dependency declarations break the bundle on real sites

**What goes wrong:**
The plugin's built JS (and any CSS/WASM/ONNX assets, if VAD is reused from elsewhere in this codebase) must load in a specific order. If enqueued with `wp_enqueue_script` without correct `$deps` arrays, or if a performance/caching plugin (Autoptimize, WP Rocket, LiteSpeed Cache) aggressively combines/defers/reorders scripts site-wide, the bundle can execute before its dependencies are ready, causing silent blank-mount failures.

**Why it happens:**
Vite/webpack produce a content-hashed, code-split asset graph; a developer enqueues by guessed filename rather than reading the build manifest, and the resulting `$deps` array omits transitive chunks — works in dev (single bundle) and breaks once code-splitting appears.

**How to avoid:**
- Generate and consume a build manifest (`@wordpress/scripts`' `*.asset.php` pattern, or a parsed Vite `manifest.json`) so `$deps`/version/hash are always derived from actual build output, never hand-maintained.
- Enqueue conditionally from the shortcode/block render callback itself — only on pages that actually contain the shortcode/block — rather than via a blanket `wp_enqueue_scripts` hook on every page load; this also reduces interference from "combine all JS" optimizer plugins.
- Explicitly test with a popular caching/optimization plugin active in JS-combine/defer mode — the most common real-world breakage source for embedded JS widgets.

**Warning signs:**
- Works on a clean install but breaks "for no reason" on a real client site — almost always a JS-optimization plugin or theme deferred-script handling.
- Intermittent failures correlated with load timing (mount point not yet in DOM when the bundle executes).

**Phase to address:**
Build-tooling/asset-pipeline phase for manifest-driven enqueue; front-end shortcode/block render phase for conditional per-page enqueue logic.

---

### Pitfall 6: Gutenberg block editor preview diverges from front-end render (mic/WebRTC/token calls fire inside wp-admin)

**What goes wrong:**
A Gutenberg block's `edit()` function runs inside the wp-admin editor canvas (an iframe since WP 6.x) — a different DOM/security/permissions-policy context than the public front-end, and one that re-renders on every attribute change. If `edit()` naively mounts the *same* full SPA (including mic access requests, WebRTC connection attempts, or the token-mint fetch), it will: trigger mic permission prompts inside wp-admin, mint real ephemeral tokens on every editor re-render while an admin is just typing (multiplying API costs), and likely behave inconsistently since iframe permissions policies differ from the front-end.

**Why it happens:**
The natural instinct for "one JS bundle shared by shortcode and block" is to call the exact same mount function in both contexts, without accounting for the editor canvas's different lifecycle and security context.

**How to avoid:**
- The block's `edit()` should render a static, inert preview (placeholder graphic + a text summary of configured settings) — never the live, connecting SPA. `save()`/the front-end render callback mounts the real interactive bundle only on the public page.
- If a live editor preview is wanted later, gate it behind an explicit user click ("Preview Avatar") — never auto-mount, never auto-fetch a token on render.
- Use `block.json`'s `viewScript` field (supported since WP 5.9+) to ship a genuinely separate front-end-only script from the editor's `editorScript`, rather than one file branching on context — the cleanest guarantee that no mic/WebRTC code path can ever load inside wp-admin.

**Warning signs:**
- OpenAI token-mint counts spike correlated with admin content-editing sessions, not visitor traffic.
- Mic permission prompts appear while editing a page in wp-admin.

**Phase to address:**
Gutenberg block implementation phase — the `editorScript`/`viewScript` split must be decided when the block is first scaffolded; merging them later means re-splitting an already-shared bundle.

---

### Pitfall 7: `upload_mimes` for `.glb`/`.gltf`/`.vrm` is too permissive, or content-sniffing rejects valid files (fileinfo false positive)

**What goes wrong:**
WordPress does not whitelist `.glb`/`.gltf`/`.vrm` by default. Two opposite failure modes occur: (a) the naive fix only widens the extension allowlist via `upload_mimes` without validating actual file content, letting a disguised malicious file (renamed to `.glb`) land in the Media Library; or (b) `.gltf` (the JSON-based, non-binary glTF variant) gets rejected even after MIME registration, because PHP's `finfo` sniffs its bytes as `text/plain`/`application/json` (it IS JSON under the hood), and `wp_check_filetype_and_ext()` flags the extension/content MIME mismatch — a documented WP core fileinfo inconsistency, not specific to this plugin.

**Why it happens:**
Developers copy an `upload_mimes` snippet that only adds the extension mapping and never test with content-sniffing filters active; behavior appears correct in dev (where fileinfo happens to align) but fails differently on other hosts (fileinfo's "incorrect/historical `application/*` answers" are documented as varying server-to-server). VRM files are themselves `.glb`-format binary glTF containers, so they avoid the JSON-sniff problem that plain `.gltf` has — but the `.glb`/`.vrm` binary signature still needs validating, not just trusting by extension.

**How to avoid:**
- Restrict the upload feature to `.glb` and `.vrm` (binary glTF containers) only — explicitly do NOT support plaintext `.gltf`, sidestepping the fileinfo JSON-sniff mismatch entirely; this milestone's use case (admin-uploaded avatar models) doesn't need `.gltf`.
- Register `model/gltf-binary` for both `.glb` and `.vrm` via `upload_mimes` (VRM has no IANA-registered MIME type; reusing `model/gltf-binary` for the same container format is the pattern other GLB-supporting WP plugins, e.g. `eldinor/babylon-wordpress-plugin`, already use).
- Additionally hook `wp_check_filetype_and_ext` to validate the binary glTF magic bytes (first 4 bytes must equal ASCII `glTF` = `0x67 0x6C 0x54 0x46`) before trusting the extension-derived MIME — `upload_mimes` alone only changes what extension is *permitted*, it does not validate *content*, and this magic-byte check is what actually blocks a "rename a PHP shell to `avatar.glb`" attack.
- Restrict the upload capability to `manage_options` (admins only) — never expose VRM/GLB upload to any public-facing form or non-admin role.
- Enforce an explicit max file size (e.g. 50MB) to prevent storage abuse even from a trusted admin's mistake.

**Warning signs:**
- "Sorry, this file type is not permitted for security reasons" reported specifically for `.gltf` (not `.glb`) — confirms the fileinfo JSON-sniff issue rather than a config bug.
- `upload_mimes` modified but `wp_check_filetype_and_ext` left untouched — a sign content validation was skipped and only the extension allowlist was widened.

**Phase to address:**
Avatar-upload feature phase — both the `upload_mimes` registration AND magic-byte content validation must ship together. Shipping the MIME allowlist alone is the classic "looks done but isn't" trap: legitimate test files pass, the vulnerability only surfaces under adversarial input.

---

### Pitfall 8: `upload_mimes` is a global filter — widening it for `.glb`/`.vrm` expands the site-wide upload attack surface, not just this plugin's own UI

**What goes wrong:**
`upload_mimes` is a blunt, global WordPress filter — there is no core mechanism to scope "allow `.glb` only when uploaded via this specific admin screen." Once registered, ANY user/role/plugin with upload capability anywhere on the site (the standard Media Library "Add New" screen, a contact-form file-attachment feature, any contributor-level upload) can now also upload `.glb`/`.vrm`, since the filter isn't scoped to this plugin's own upload action.

**Why it happens:**
Plugin authors test only their own upload UI and don't consider that the same global filter touches every other upload path on the site, including lower-trust roles or third-party plugins with lax upload forms.

**How to avoid:**
- Scope the `upload_mimes` filter callback narrowly: add it immediately before calling `wp_handle_upload`/`media_handle_upload` for this specific feature, and remove it immediately after, rather than registering it unconditionally for the entire request lifecycle.
- Document in the readme/security notes that enabling `.glb`/`.vrm` uploads is potentially site-wide if the filter cannot be scoped this tightly in practice, so site owners with open registration or contributor roles are aware.
- Since binary glTF/GLB files aren't executable in the traditional PHP-shell-upload sense, the remaining residual risk after content validation (Pitfall 7) is storage/quota abuse and parser-level vulnerabilities in whatever renders the file client-side (three.js/`@pixiv/three-vrm`) — treat uploaded VRM content as untrusted input in the existing `VRMAvatar`/`GLBAvatar` rendering code.

**Warning signs:**
- A site security scan flags `.glb` as a newly-permitted upload type site-wide immediately after plugin activation, surprising the admin.

**Phase to address:**
Avatar-upload feature phase — the decision to scope the filter narrowly (vs. leaving it globally registered) must be made when the upload handler is first written; narrowing it later requires re-testing every upload code path on the site.

---

### Pitfall 9: WordPress.org review rejection — undisclosed "phone home" to OpenAI, or bundled minified JS with no source

**What goes wrong (if/when distributed via WordPress.org):**
The plugin's core function calls an external third-party service (OpenAI) using a key the *site owner* supplies. WP.org reviewers still expect prominent readme disclosure of any external service contacted, what data is sent (audio, conversation text, the admin-configured personality/instructions), and a link to that service's Terms of Use/privacy policy — this disclosure obligation exists regardless of who owns the credential. Separately, the bundled React 19 + Three.js + `@pixiv/three-vrm` SPA, if shipped only as a minified production build with no accompanying source or link to a public repo, fails the "no obscured code" guideline outright.

**Why it happens:**
First-time WP plugin authors coming from an npm-only background ship exactly what they'd publish to npm (a minified `dist/` bundle) and assume "it's open source on GitHub" is implicitly sufficient, without realizing the *readme.txt itself* must state that and link to it.

**How to avoid:**
- Add an explicit "External services" section to `readme.txt`: this plugin sends visitor audio and admin-configured conversation context to OpenAI's Realtime API using the site owner's own API key; link OpenAI's API Terms of Use and Privacy Policy. No separate consent-flow is needed beyond the admin configuring their own key — but documenting the data flow is still mandatory.
- Keep a readme link to the plugin's public source repository (this monorepo or a dedicated mirror) so reviewers and future maintainers can always find unminified source; don't rely on the minified bundle alone being "inspectable enough."
- Re-confirm WP.org distribution is even the target before this phase — if this plugin is only ever privately distributed (direct zip), this pitfall category doesn't block ship, but documenting it now is good practice if WP.org distribution is wanted later.

**Warning signs:**
- WP.org review rejection citing "obscured code" or "undocumented external service" — the two most common first-submission rejection reasons for any plugin with a JS build step.

**Phase to address:**
Release/distribution phase for the actual submission — but the readme disclosure section and the WP.org-vs-private decision should be drafted in the documentation phase, since it affects what's safe to promise; the "no obscured code" requirement should inform the build-tooling phase decision to commit/publish unminified source alongside the production bundle from day one rather than retrofitting it under review pressure.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single shared JS bundle for both Gutenberg `edit()` and front-end render, branching on context at runtime | Faster initial build setup, one less webpack entry | Editor accidentally loads WebRTC/mic code paths (Pitfall 6); harder to tree-shake editor-only code out of the front-end bundle | Acceptable only as an early dev-spike to prove the SPA mounts at all — must split into `editorScript`/`viewScript` before any real mic/token testing |
| No server-side rate limiting on the token-mint route at launch ("add it if abuse happens") | Ships faster, simpler PHP | Site owner's OpenAI billing unprotected from day one; retrofitting auth onto a publicly-documented route risks breaking existing embeds | Never acceptable for a route holding a real billable secret — a crude IP+transient limit is cheap upfront |
| Mapping `.glb`/`.vrm`/`.gltf` all to one MIME via `upload_mimes` without magic-byte validation | Saves an extra filter/hook | Disguised-file upload risk persists indefinitely; "looks done" because legitimate test files always pass | Acceptable only for a purely local/dev build never exposed beyond a trusted admin upload path; never acceptable once shipped |
| Bundling React 19 as a normal dependency without checking for collision with WP-core's bundled React | Simpler build config, no externals setup | Conflicts only manifest on real-world sites with specific themes/plugins (Pitfall 4), hard to reproduce after the fact | Acceptable only if full bundle isolation (no global leak) is verified — otherwise never acceptable |
| Embedding the ephemeral token directly in server-rendered shortcode HTML instead of a live client fetch | Avoids one round-trip | Breaks under any page caching (Pitfall 3); bakes a session-specific secret into cacheable HTML | Never acceptable — the live-fetch pattern costs one extra request and is the only cache-safe approach |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenAI Realtime ephemeral token minting (PHP → OpenAI REST API) | Treating `wp_remote_post` to OpenAI as fire-and-forget with no timeout/error handling, leaving the visitor's front-end hanging if OpenAI is slow/down | Set an explicit timeout on `wp_remote_post` and verify WP's default HTTP timeout (often 5s) is sufficient; return a clear JSON error the front-end can surface ("voice service temporarily unavailable") rather than a silent hang |
| WordPress Media Library (`wp_handle_upload`/`media_handle_upload`) for VRM/GLB | Calling the upload handler before MIME/content-check filters are registered, causing inconsistent rejection depending on hook load order | Register `upload_mimes` and the magic-byte `wp_check_filetype_and_ext` filter on `init` (or `plugins_loaded`) unconditionally for the request lifecycle the upload runs in — not lazily only when the settings page itself loads |
| `@ricky0123/vad-web` (VAD) static asset serving, if reused for any client-side mic logic | Assuming ONNX/WASM assets resolve relative to the bundle's enqueue URL automatically, the way a Next.js `public/` folder would serve them | Copy ONNX/WASM files into the plugin's own `assets/` directory at build time and pass `plugins_url()`-derived absolute paths into the bundle's runtime config — WP's enqueue system doesn't auto-serve arbitrary build output |
| Gutenberg block registration (`block.json`) | Letting the block's `render_callback`/`render.php` drift from the shortcode's PHP, causing accepted attributes/config shape to diverge across releases | Have both the shortcode handler and the block's render callback call one shared internal PHP function that builds the config array passed to the front-end bundle — a single source of truth for the config shape the JS expects |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Token-mint route fires a synchronous blocking `wp_remote_post` to OpenAI automatically on page load, before any visitor interaction | Page (or first interaction) feels sluggish; PHP worker pool tied up waiting on an external call | Only mint a token on explicit user interaction (e.g. clicking "start talking"), never automatically on page load | Becomes visible on any shared/limited PHP-FPM hosting plan once traffic to the embedding page is non-trivial |
| Unbounded VRM/GLB file size accepted on admin upload | Slow Media Library; slow first paint for visitors (full model must download before the avatar renders); hosting storage/bandwidth costs | Enforce a max upload size (e.g. 50MB) and document recommended VRM optimization (texture compression, draco/meshopt) in the admin help text | Becomes a visitor-facing problem the moment any admin uploads an un-optimized, multi-hundred-MB raw export |
| No verified caching headers on the served VRM/GLB binary from `wp-content/uploads/` | Repeat visitors re-download the full avatar model every page view | Rely on standard WP/webserver static-file caching (usually correct out of the box) but verify hosting doesn't exclude `.glb`/`.vrm` from static-asset cache rules (some host configs whitelist by extension) | Low priority for v1; noticeable once a site has meaningful repeat-visitor traffic |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Using `__return_true` as the token route's `permission_callback` with zero other mitigation | Unmetered abuse of the site owner's OpenAI billing by anyone who discovers the route URL (Pitfall 1) | Layer referer/origin checks + IP-based rate limiting + a daily mint cap, even though none of these are "real" authentication |
| Trusting browser-claimed file extension/MIME without server-side content validation for `.glb`/`.vrm` | A disguised malicious file lands in the Media Library with a trusted-looking extension (Pitfall 7) | Validate the binary glTF magic bytes server-side, independent of the `upload_mimes` allowlist |
| Leaving the `upload_mimes` filter globally registered for the entire request lifecycle instead of scoping it to this plugin's own upload action | Expands the site's overall upload attack surface to every other upload path (Pitfall 8) | Add/remove the filter narrowly around this plugin's specific `wp_handle_upload`/`media_handle_upload` call |
| Embedding the OpenAI API key in the front-end JS bundle "temporarily for testing" | Even a dev-only leak into a built JS file can ship to production if dev/prod build config isn't airtight — this is exactly the failure the ephemeral-token architecture exists to prevent | Keep the real OpenAI key exclusively in a PHP-side option, never pass it to any JS bundle, build script, or `wp_localize_script` payload |
| No capability check (`current_user_can`) on the admin settings page that stores the OpenAI key / handles VRM upload | Any authenticated user, not just admins, could view/change the API key or upload arbitrary `.glb` files if the page only checks `is_user_logged_in()` | Gate the entire settings page and its handlers behind `current_user_can('manage_options')` (or a narrower custom capability), and verify standard WP admin nonces on the settings-save form (this DOES apply normal nonce patterns, since it's a logged-in-admin context, unlike the public token route) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|------------------|
| Microphone permission prompt fires immediately on page load (auto-connect) | Visitors are startled by an unexpected mic dialog before choosing to interact; many reflexively deny it, breaking the feature for the rest of the session (browsers don't always re-prompt) | Require an explicit "click to start talking" gesture before requesting mic access or minting a token — this also directly mitigates Pitfall 1's abuse surface and the performance trap above |
| Avatar shown but voice connection silently fails (missing/invalid key, rate limit hit) with no visible error | Visitor sees a frozen/static avatar with no explanation, assumes the site is broken | Surface a visible, non-technical status message in the widget ("Voice chat is temporarily unavailable") sourced from the token route's error response, distinct from a generic console error |
| Gutenberg editor preview attempts a live connection and visibly fails inside wp-admin (per Pitfall 6) | The admin configuring the block sees confusing errors/permission prompts unrelated to what visitors will actually experience, eroding trust before the plugin is even published | Static/inert editor preview only, as covered in Pitfall 6 |

## "Looks Done But Isn't" Checklist

- [ ] **Token-mint REST route:** Often missing rate limiting/abuse caps — verify by calling the route directly with `curl` in a tight loop, bypassing the front-end entirely, and confirming it gets throttled/blocked.
- [ ] **GLB/VRM upload validation:** Often missing magic-byte content verification — verify by renaming an arbitrary non-GLB file (e.g. `.php`/`.html`) to `.glb` and attempting upload; it must be rejected, not just files that legitimately fail the extension check.
- [ ] **Gutenberg block editor preview:** Often missing the editor/front-end script split — verify by opening the block in wp-admin's editor and confirming NO mic permission prompt or network call to the token route fires merely from inserting/viewing the block.
- [ ] **React bundle isolation:** Often missing verification against a real-world theme/plugin combo — verify by activating a popular page builder or caching/optimization plugin alongside this plugin and confirming the avatar still mounts and connects.
- [ ] **Cache-safety of the token route:** Often missing explicit `Cache-Control: no-store` and `POST`-only enforcement — verify by enabling a full-page caching plugin and confirming the token-mint call is never served from cache (check the Network tab on a second page load).
- [ ] **WP.org readme disclosure (if ever publicly distributed):** Often missing the "external services" section entirely — verify the readme explicitly names OpenAI, states what data is sent, and links to OpenAI's terms, even though the API key is the site owner's own.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|-----------------|
| Token route abused before rate limiting shipped | MEDIUM | Add IP+transient rate limiting and a daily mint cap retroactively; advise affected site owners to rotate their OpenAI API key immediately; communicate the fix via the plugin changelog |
| React version collision discovered post-launch on a specific theme | MEDIUM | Switch the build to full bundle isolation (no shared globals) and ship as a patch release; cannot be fixed via a runtime flag, requires a rebuild |
| `.gltf` (JSON variant) uploads silently rejected for some users due to fileinfo mismatch | LOW | Officially restrict supported formats to `.glb`/`.vrm` only in the UI/docs, removing `.gltf` entirely rather than chasing inconsistent server-level fileinfo behavior |
| WP.org review rejection for undisclosed external service or obscured code | LOW | Add the readme disclosure section and/or publish unminified source/link to the public repo, then resubmit — a documentation fix, not an architecture fix, in nearly all cases |
| Malicious file successfully uploaded disguised as `.glb` before magic-byte validation shipped | HIGH | Audit all existing Media Library uploads matching `.glb`/`.vrm` extension for actual `glTF` magic bytes; remove/quarantine any that fail; assume the uploading admin's credentials may also be compromised if the file wasn't uploaded via a known legitimate action |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|---------------|
| Anonymous token route = unmetered API proxy (Pitfall 1) | REST/token-route design phase | `curl` loop test against the route bypassing the browser; confirm 429s after threshold |
| Nonce model confusion for anonymous visitors (Pitfall 2) | REST/token-route design phase | Code review confirms no `wp_verify_nonce`/`is_user_logged_in` gating on the public route; referer/rate-limit checks present instead |
| Caching layer serves stale/shared tokens (Pitfall 3) | REST/token-route design phase; verified in integration/QA phase | Enable a page-caching plugin; confirm token route is `POST`-only with `Cache-Control: no-store` and never appears in cached HTML |
| Multiple React copies colliding with theme/plugin (Pitfall 4) | Build-tooling/bundling phase | Activate a known React-bundling theme/plugin alongside this one; confirm no console hook errors |
| Script enqueue order / optimizer-plugin interference (Pitfall 5) | Build-tooling/asset-pipeline phase; front-end render phase | Test with WP Rocket/Autoptimize JS-combine mode active; confirm avatar still mounts |
| Gutenberg editor preview triggers live mic/WebRTC/token calls (Pitfall 6) | Gutenberg block implementation phase | Insert block in wp-admin editor; confirm zero network calls to the token route and no mic permission prompt |
| `upload_mimes`/`wp_check_filetype_and_ext` too loose or too strict (Pitfall 7) | Avatar-upload feature phase | Attempt upload of a renamed non-GLB file (must reject) and a legitimate `.glb`/`.vrm` (must accept) |
| `upload_mimes` globally widens site-wide upload surface (Pitfall 8) | Avatar-upload feature phase | Confirm the MIME filter is scoped/conditionally added only around this plugin's own upload call, not registered unconditionally for the full request lifecycle |
| WP.org "phone home"/obscured-code rejection (Pitfall 9) | Release/distribution phase (readme drafted in documentation phase) | Readme contains an explicit "External services" section naming OpenAI and linking to its terms; unminified source is included or linked |

## Gaps to Address

- No official OpenAI documentation was found specifying per-IP or per-ephemeral-token-mint rate limits for the Realtime API client-secret endpoint specifically — the rate-limiting recommendations in Pitfall 1 are a defensive design pattern synthesized from general API-key abuse prevention, not a documented OpenAI-specific threshold. Validate actual OpenAI rate-limit behavior for the ephemeral-token endpoint against current OpenAI docs at implementation time, since rate-limit tiers are account-plan-dependent and may change.
- No existing public WordPress plugin combines anonymous ephemeral-token minting + WebRTC + VRM avatar upload in one package — pitfalls for the token route and Gutenberg-block/SPA interaction (Pitfalls 1, 2, 3, 6) are synthesized architectural risk analysis, not confirmed bug reports from a directly comparable shipped product. Treat as MEDIUM confidence accordingly.
- Could not verify the current (2026) version of React that WordPress core bundles via the registered `react` script handle — this matters for the Pitfall 4 decision between full bundle isolation vs. externalizing against WP-core's React. Check the current Gutenberg/WP core changelog at implementation time before deciding.

## Sources

- [Why wp_verify_nonce() Fails in WordPress REST API Endpoints](https://purpleturtlecreative.com/blog/2022/10/why-wp_verify_nonce-fails-in-wordpress-rest-api-endpoints/)
- [WordPress REST API Auth nonces in POST requests](https://rosswintle.uk/2024/08/wordpress-rest-api-auth-nonces-in-post-requests/)
- [Authentication – REST API Handbook](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [register_rest_route() – Function Reference](https://developer.wordpress.org/reference/functions/register_rest_route/)
- [Handling Permissions in your WordPress REST routes](https://dev.to/david_woolf/handling-permissions-in-your-wordpress-rest-routes-c6j)
- [How to Properly Restrict Access to WordPress REST API Routes – Plugin Vulnerabilities](https://www.pluginvulnerabilities.com/2022/12/13/how-to-properly-restrict-access-to-wordpress-rest-api-routes/)
- [How to Secure WordPress REST API (wp-json) from Attacks in 2026](https://wpthrill.com/how-to-protect-wordpress-rest-api-from-abuse/)
- [WordPress REST API Security Hardening (2026)](https://benryan.com.au/blog/wordpress-rest-api-security-hardening)
- [wp_check_filetype_and_ext() – Function Reference](https://developer.wordpress.org/reference/functions/wp_check_filetype_and_ext/)
- [#39550 Some Non-image files fail to upload after 4.7.1 – WordPress Trac](https://core.trac.wordpress.org/ticket/39550)
- [#40175 Upload Validation / MIME Handling – WordPress Trac](https://core.trac.wordpress.org/ticket/40175)
- [upload_mimes – Hook Reference](https://developer.wordpress.org/reference/hooks/upload_mimes/)
- [GitHub: eldinor/babylon-wordpress-plugin (GLTF/GLB/STL/OBJ upload support, `model/gltf-binary` MIME mapping precedent)](https://github.com/eldinor/babylon-wordpress-plugin)
- [Register MIME Type for GLB File Format · Issue #943 · KhronosGroup/glTF](https://github.com/KhronosGroup/glTF/issues/943)
- [Securing SVG Uploads in WordPress | Daryll Doyle](https://enshrined.co.uk/2018/04/29/securing-svg-uploads-in-wordpress/) (analogous content-sniffing bypass precedent)
- [Detailed Plugin Guidelines – Plugin Handbook](https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/)
- [Common issues – Plugin Handbook](https://developer.wordpress.org/plugins/wordpress-org/common-issues/)
- [guideline-07.md: external-site info vs Phone Home · Issue #53 · WordPress/wporg-plugin-guidelines](https://github.com/WordPress/wporg-plugin-guidelines/issues/53)
- [100,000+ Install Plugin Phoning Home for Over Two Years – Plugin Vulnerabilities](https://www.pluginvulnerabilities.com/2022/11/11/100000-install-wordpress-plugin-custom-permalinks-has-been-phoning-home-to-developer-for-over-two-years/)
- [Building a WordPress Plugin with React? Use @wordpress/scripts](https://itsmereal.com/building-a-wordpress-plugin-with-react-use-wordpress-scripts/)
- [JavaScript Packages and Interoperability in 5.0 and Beyond – Make WordPress Core](https://make.wordpress.org/core/2018/12/06/javascript-packages-and-interoperability-in-5-0-and-beyond/)
- [gutenberg react version conflict · Issue #62914 · WordPress/gutenberg](https://github.com/WordPress/gutenberg/issues/62914)
- [@wordpress/server-side-render – Block Editor Handbook](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-server-side-render/)
- [Isomorphic Gutenberg Blocks | Pantheon.io](https://pantheon.io/blog/isomorphic-gutenberg-blocks)
- [OpenAI API rate limits documentation](https://developers.openai.com/api/docs/guides/rate-limits)
- [OpenAI Realtime and audio guide](https://developers.openai.com/api/docs/guides/realtime)
- [Persistent Rate Limit Errors Despite Implementing Ephemeral Token Caching – OpenAI Community](https://community.openai.com/t/persistent-rate-limit-errors-despite-implementing-ephemeral-token-caching/1091837)
- Internal codebase reference: `src/app/api/negotiate/route.ts` (existing Next.js ephemeral-token proxy pattern this plugin's PHP route must replicate)

---
*Pitfalls research for: WordPress plugin (bundled React/Three.js SPA + anonymous OpenAI ephemeral-token route + VRM/GLB upload)*
*Researched: 2026-06-21*
