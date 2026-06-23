# Phase 7: Admin Settings Page - Research

**Researched:** 2026-06-23
**Domain:** WordPress Settings API (plain PHP form), WP Media Library content validation, capability-gated admin UI
**Confidence:** HIGH

## Summary

This phase is pure WordPress-core PHP — no external packages, no JS build. The settings page is a `register_setting()`/`add_settings_field()` form rendered on a top-level admin menu page (`add_menu_page()`), gated by `manage_options` at both menu-registration and render-callback layers. It reads/writes through Phase 6's existing `ConfigSourceInterface`/`WpOptionsConfigSource`, which already defines the exact `wp_options['khaveeai_settings']` shape (`api_key`, `instructions`, `voice`, `model`, `avatar_url`) — this phase is the first code path that **writes** that option; Phase 6 only reads it.

Three WordPress-API mechanics are load-bearing and easy to get subtly wrong: (1) the masked-API-key resave bug — the `sanitize_callback` must detect "submitted value equals the masked placeholder" and fall back to the existing stored key, not silently wipe it; (2) the VRM/GLB upload requires **two** filters together (`upload_mimes` for the extension allowlist, `wp_check_filetype_and_ext` for binary magic-byte content validation) — the allowlist alone passes a renamed malicious file; (3) `wp_check_filetype_and_ext` must be scoped narrowly (added immediately before, removed immediately after the upload call) since it is a global filter that otherwise widens the site-wide upload surface for every other upload path. All three are already flagged in this milestone's pre-existing `PITFALLS.md`/`STACK.md`/CONTEXT.md decisions (D-05 through D-09) — this research confirms the exact WordPress API signatures needed to implement them correctly.

**Primary recommendation:** Build `includes/Admin/SettingsPage.php` as a single class using the plain WP Settings API (no React/JS bundle), wired into `Plugin.php`'s composition root the same way `SessionController` is. Use `register_setting()` with a `sanitize_callback` per field group, `add_filter('upload_mimes')` + `add_filter('wp_check_filetype_and_ext')` scoped narrowly around the avatar upload action only, and add one new `is_configured(): bool` method to `ConfigSourceInterface`.

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

**Settings Page Tech Approach**
- **D-01:** Plain WP Settings API HTML form (`register_setting()`/`add_settings_field()`), not a React/`wp-element` admin UI. No bundler/JS build needed for the page itself; the avatar file picker uses WordPress's built-in `wp.media` JS (already loaded via `wp_enqueue_media()`), not custom code.
- **D-02:** Settings page lives as its own top-level wp-admin menu item ("Khavee AI Avatar"), not a submenu under Settings — prioritizes discoverability for a non-power-user site owner over menu tidiness.
- **D-03:** No model dropdown. `model` stays a hardcoded default in `WpOptionsConfigSource` (`gpt-realtime-1.5`) — not exposed as a settings field. Keeps the page at exactly the 4 fields REQUIREMENTS.md specifies (API key, instructions, voice, avatar), consistent with Phase 6's anti-bloat stance (D-04 in `06-CONTEXT.md`).
- **D-04:** No voice preview/sample-playback button. The voice field is a plain `<select>` populated from the hardcoded OpenAI voice enum (`alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar` — see `packages/core/src/types/realtime.ts`). Adding live audio playback would require a client-side OpenAI TTS call, which is out of scope (matches REQUIREMENTS.md's deferral of "Test Connection" to v2/SETV2-02).

**API Key Re-Save Behavior**
- **D-05:** If the admin saves the form without touching the masked key field, the `sanitize_callback` detects the submitted value still equals the masked placeholder string and leaves the stored `api_key` untouched. This is the load-bearing fix for the classic "masked field wipes the secret on every unrelated save" bug.
- **D-06:** Clearing a saved key is a separate, deliberate action — a dedicated "Remove key" checkbox/control next to the masked field — rather than inferring removal from an emptied field (which risks accidental loss from browser autofill or a stray backspace).
- **D-07:** Mask format on reload: `sk-••••••` + last 4 characters (e.g. `sk-••••••1234`) — matches SET-01's exact example wording, gives the admin enough signal to recognize which key is saved without exposing it.
- **D-08:** When the admin enters a NEW key value (i.e., the field no longer equals the masked placeholder), apply a light format check before storing: reject empty-after-trim or anything not starting with `sk-`, surfaced as an inline WP Settings API error. Full validity (does the key actually work) is still only discoverable at runtime via the REST route's HTTP 502 path (Phase 6 D-09) — no live OpenAI ping from this page.

**Avatar Upload Scope & Limits**
- **D-09:** Accept `.glb` and `.vrm` only — both are binary glTF containers sharing the same magic-byte check (ASCII `glTF` = `0x67 0x6C 0x54 0x46`). `.gltf` (the plaintext/JSON glTF variant) is explicitly excluded — per `PITFALLS.md`, PHP's `finfo` mis-sniffs it as `text/plain`/`application/json`, causing a documented WP-core fileinfo mismatch unrelated to this plugin's own code. Both `upload_mimes` (extension allowlist) AND a `wp_check_filetype_and_ext` magic-byte hook are required together (ASSET-01) — the allowlist alone is the "looks done but isn't" trap PITFALLS.md flags.
- **D-10:** Max upload size: 50MB, enforced at the plugin level (not deferred to host `php.ini`/`upload_max_filesize` defaults, which vary widely and aren't a deliberate choice).
- **D-11:** The settings page displays the currently-configured avatar as filename + upload date text only — no live 3D model preview. (Discussion note: the user initially wanted a live 3D preview; on learning that even a minimal preview requires its own JS bundle — either a small standalone three.js + `@pixiv/three-vrm` viewer or reusing `@khaveeai/react`'s `VRMAvatar`/`GLBAvatar` components — both of which contradict the plain-PHP-form approach (D-01), the user downgraded to the bundle-free filename/date display. If a future phase wants a real preview, treat it as new scope, not an oversight here.)
- **Restrict avatar upload to `manage_options` only** (per PITFALLS.md) — never expose the VRM/GLB MIME allowlist to any public-facing or non-admin upload path. Same capability gate as the rest of the page (SET-05).

**"Invalid Key" Notice Criteria (SET-06)**
- **D-12:** The admin-only inline notice on the frontend embed (built in Phase 8) fires only on an empty/unset key (`get_api_key() === ''`). A key that's *wrong* (revoked, typo'd, wrong project) is only discoverable when the REST route's actual OpenAI call fails at runtime (HTTP 502, per Phase 6 D-09/D-10's "log server-side only, no detail leaked" pattern) — this phase does not attempt to guess validity via format heuristics for the embed notice.
- **D-13:** Expose the empty-key check as a small additive helper on `ConfigSourceInterface` (e.g. `is_configured(): bool`) rather than leaving Phase 8 to re-derive "is this configured" from `get_api_key()` directly. This is a deliberate, backward-compatible extension of Phase 6's interface — `WpOptionsConfigSource` gets the one new method; `SessionController`'s existing usage is unaffected.
- **D-14:** The settings page itself (separate from the Phase-8-built frontend embed notice) shows its own "not configured yet" status banner — standard WP admin-notice styling — at the top of the page whenever the key is empty, using the same `is_configured()` check.

### Claude's Discretion
- Exact settings page slug/option-group naming, field ID naming, and the precise PHP file/class name for the settings page (e.g. `Admin/SettingsPage.php`, matching `ARCHITECTURE.md`'s suggested structure) — implementation detail, not discussed.
- Exact wording/copy for the "Remove key" control, the format-validation error message, and the "not configured" status banner — left to implementation, should follow plain, undecorated WP admin conventions (no decorative emoji, per CLAUDE.md's logging/comment conventions extended to UI copy).
- Whether `is_configured()` is a new interface method (requiring `WpOptionsConfigSource` to implement it) vs. a default/trait-based implementation — implementation detail; either is fine as long as `ConfigSourceInterface` gains the capability.
- Exact admin notice/menu icon choice for the top-level menu item — cosmetic, not discussed.

### Deferred Ideas (OUT OF SCOPE)
- Live 3D model preview of the configured avatar directly in wp-admin — considered and explicitly declined (D-11) because it requires a JS rendering bundle that contradicts the plain-PHP-form approach chosen for this phase. Could resurface as its own small scoped addition in a later phase if there's real demand.
- Voice sample/preview playback on the settings page — declined (D-04), would need a live OpenAI TTS call; matches REQUIREMENTS.md's existing deferral of "Test Connection" (SETV2-02) to v2.
- Model selection as a settings field — declined (D-03), stays hardcoded; revisit only if a future requirement explicitly asks for it.
- Format-based "looks invalid" detection feeding the frontend embed notice (beyond empty-check) — declined (D-12); the project's existing pattern is to surface real failures via the REST route's runtime error path, not guess from the key's shape.

None — discussion stayed within phase scope otherwise.

</user_constraints>

## Phase Requirements

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| SET-01 | Admin can configure an OpenAI API key via a WP Settings API page; the saved key is redisplayed masked (e.g. `sk-••••••1234`), never in full | Masked-field `sanitize_callback` pattern (see Architecture Patterns, Pattern 2); `password`/`text` field type choice (Code Examples) |
| SET-02 | Admin can configure a personality/instruction system prompt via a textarea | `register_setting()` + `sanitize_textarea_field()`; field already shaped by `WpOptionsConfigSource::DEFAULT_INSTRUCTIONS` |
| SET-03 | Admin can select a voice from OpenAI's Realtime voice list via a dropdown | Hardcoded `<select>` from `packages/core/src/types/realtime.ts` voice enum (Code Examples) |
| SET-04 | Admin can upload a VRM or GLB avatar file via the WP Media Library | `wp_enqueue_media()` + `wp.media` JS frame restricted to `model/gltf-binary`; attachment ID stored in `wp_options`, resolved via `wp_get_attachment_url()` at render time (Architecture Patterns, Pattern 3) |
| SET-05 | Settings page is gated to users with the `manage_options` capability, checked both at menu registration and inside the render callback | `add_menu_page()`'s `$capability` arg + explicit `current_user_can('manage_options')` + `wp_die()` inside the render callback (Common Pitfalls, Pitfall 3) |
| SET-06 | Inline admin-only notice appears on the frontend embed when the API key is missing or invalid; regular visitors see a neutral placeholder | `is_configured()` new interface method (D-13); this phase only builds the settings-page-side "not configured" banner (D-14) and the interface method — the frontend embed notice itself is Phase 8 |
| ASSET-01 | VRM/GLB Media Library uploads are validated server-side beyond file extension (binary magic-byte check) before being accepted, in addition to the `upload_mimes` allowlist | `upload_mimes` + `wp_check_filetype_and_ext` dual-filter pattern, GLB/VRM 12-byte header magic-byte check (Architecture Patterns, Pattern 1; Common Pitfalls, Pitfall 1) |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

CLAUDE.md as committed documents the **TypeScript SDK monorepo** conventions (naming, error handling, logging). This phase is in `wordpress-plugin/`, a PHP codebase with its own emerging conventions established in Phase 6. The applicable cross-cutting directives that DO transfer:

- **No decorative logging/comments in production code** — CLAUDE.md's "new provider code avoids decorative logging" / "no emoji" convention is explicitly extended to UI copy by CONTEXT.md's Claude's Discretion section. Apply to all settings-page copy (error messages, status banners).
- **Comments explain why, not what**, with research/decision traceability tags (`(D-05)`, `(ASSET-01)`) — Phase 6 code already does this consistently (e.g. `OpenAiDirectTokenProvider.php`'s `(D-09, D-10, Backend Proxy Assumption)` docblock tags); continue the pattern in `SettingsPage.php`.
- **Error normalization discipline** ("never leak secret/detail to the caller") — Phase 6's `error_log()`-server-side / generic-response-to-caller pattern (`TokenMintException`, `respond()`) is the PHP-side instance of the TS SDK's `error instanceof Error` normalization philosophy. The settings page's own error surfaces (format-validation failures, upload rejections) should follow the same "user gets an actionable but non-leaky message" discipline — though this is a much lower-stakes surface than the REST route since it's already `manage_options`-gated.
- **PSR-4 namespacing under `Khavee\Plugin\`**, file-per-class, `includes/<Domain>/<ClassName>.php` structure — established by Phase 6 (`includes/ConfigSource/`, `includes/TokenProvider/`, `includes/Rest/`) and by `ARCHITECTURE.md`'s suggested structure (`includes/Admin/SettingsPage.php`). This phase's new class MUST follow this, not the TS SDK's camelCase/PascalCase file conventions verbatim (PHP class files use PascalCase matching the class name, consistent with both monorepo TS convention AND existing Phase 6 PHP files — no conflict here).
- **No DI container, composition root pattern** — `Plugin.php` constructs concretes and injects via constructor; `SettingsPage` must be wired the same way, not via a service locator or `apply_filters()`-based strategy selection.

No CLAUDE.md directive contradicts this phase's planned approach.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Settings form render (API key, instructions, voice, avatar fields) | Backend Server (WP Admin/PHP) | Browser (wp.media JS picker only) | WP Settings API is server-rendered HTML; the only client-side JS is WordPress core's own `wp.media` frame, not custom application code (D-01) |
| Settings persistence (`wp_options` read/write) | Database/Storage (`wp_options` table) | Backend Server (`ConfigSourceInterface`) | `WpOptionsConfigSource` is the sole read/write gateway; this phase adds the write path Phase 6 didn't need |
| API key masking on redisplay | Backend Server | — | Masking must happen server-side at render time (PHP formats `sk-••••••1234` from the stored value) — never send the raw key to the browser for client-side masking |
| Capability/permission gating (`manage_options`) | Backend Server | — | WP core's `current_user_can()` is a PHP-only check; no client-side enforcement is meaningful here (a non-admin who bypasses the menu link still hits the same PHP render-callback gate) |
| Avatar file upload + content validation | Backend Server (`upload_mimes`/`wp_check_filetype_and_ext` filters) | Browser (`wp.media` initiates the upload POST) | The browser only triggers the upload via WP core's existing Media Library AJAX handler; all binary-content validation (magic bytes) must happen server-side — a client-side-only check is trivially bypassable |
| Avatar URL resolution for rendering | Backend Server (`wp_get_attachment_url()`) | — | Store attachment ID only in `wp_options`; resolve to URL at render/read time, not at save time, so Media Library URL changes (CDN migration, multisite) don't require a settings re-save |
| "Is configured" check (`is_configured()`) | Backend Server (`ConfigSourceInterface`) | — | Single source of truth consumed by both this phase's settings-page banner and Phase 8's frontend embed notice — must not be duplicated client-side or in two separate PHP implementations |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| WordPress Settings API (`register_setting`, `add_settings_section`, `add_settings_field`, `settings_fields`, `do_settings_sections`) | WP core (no version — bundled since WP 2.7) | Render/persist the 4-field settings form through `options.php`'s standard save flow | `[CITED: developer.wordpress.org/reference/functions/register_setting]` — the only WP-core-native way to register an option for save via the standard `options.php` POST handler with built-in nonce verification and `sanitize_callback` hooks; D-01 explicitly chose this over a custom React admin UI |
| `wp.media()` JS API (`wp_enqueue_media()`) | WP core (bundled, current WP 6.x) | Avatar file picker restricted to the registered VRM/GLB MIME type | `[CITED: developer.wordpress.org/reference/functions/wp_enqueue_media + Codex Javascript_Reference/wp.media]` — no custom upload widget needed; `library: { type: 'model/gltf-binary' }` filters the attachment browser to only show already-uploaded matching files, while a separate "Upload New" flow still goes through the same `upload_mimes`/`wp_check_filetype_and_ext` filters |
| `upload_mimes` filter | WP core hook | Extension/MIME allowlist for `.glb`/`.vrm` | `[CITED: developer.wordpress.org/reference/hooks/upload_mimes]` — official, documented hook for adding non-default file types to the upload allowlist; required but NOT sufficient alone (Pitfall 1) |
| `wp_check_filetype_and_ext` filter | WP core hook | Binary magic-byte content validation, independent of the `upload_mimes` extension allowlist | `[CITED: developer.wordpress.org/reference/functions/wp_check_filetype_and_ext]` — the function WordPress core itself calls during `wp_handle_upload()` to re-derive MIME from actual content; filtering its return value is the documented extension point for adding custom binary-signature validation |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sanitize_text_field()` / `sanitize_textarea_field()` | WP core | Sanitize single-line (API key, voice) vs. multi-line (instructions) text input | Already referenced in `WpOptionsConfigSource.php`'s docblock as the expected sanitization Phase 7 performs on write |
| `current_user_can('manage_options')` | WP core | Capability check at both menu-registration and render-callback layers (SET-05) | Call once as the `$capability` arg to `add_menu_page()`, and again as the FIRST line inside the render callback — defense in depth, since `add_menu_page()`'s capability only hides the menu *link*, it does not block direct URL navigation |
| `wp_get_attachment_url( $attachment_id )` | WP core | Resolve the stored Media Library attachment ID to a usable URL at render time | Per `ARCHITECTURE.md`'s recommended pattern — store attachment ID (an int) in `wp_options`, not the raw URL or base64 binary, to avoid `wp_options` autoload bloat and to survive Media Library URL changes |
| `add_settings_error()` / `settings_errors()` | WP core | Surface the D-08 format-validation error ("key must start with sk-") inline on the settings page after a failed save | `[CITED: developer.wordpress.org/reference/functions/settings_errors]` — standard WP admin-notice-styled error display tied to the Settings API save flow, triggered from inside a `sanitize_callback` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain WP Settings API form | React admin UI via `@wordpress/element` + a custom REST settings endpoint | Locked out by D-01 — would require a JS bundle for the admin page alone, contradicting the "no bundler/JS build needed for the page itself" decision; only worth revisiting if a future phase needs genuinely dynamic UI (live preview, drag-drop with progress) |
| `upload_mimes` mapping `.glb`/`.vrm` → `model/gltf-binary` (IANA-registered) | Mapping to `model/glb-binary` (seen in one community example, `JimJ92120/wordpress-plugin-allow-models-upload`) | `model/glb-binary` is NOT an IANA-registered media type; `model/gltf-binary` is `[VERIFIED: IANA media-types registry, registered 2017-11-06]` — use the correct registered type, not the community example's typo-equivalent |
| Magic-byte check via a small hand-rolled `fread()` of the first 4 bytes | A general-purpose PHP file-validation library (e.g. composer package for magic-byte sniffing) | No library needed — GLB/VRM's magic-byte check is exactly "read 4 bytes, compare to the literal string `glTF`" (see Code Examples); pulling in a dependency for a 3-line check is unjustified (matches STACK.md's "no HTTP client, no validation library" minimalism stance) |

**Installation:**

No package installation required — this phase uses only WordPress core functions and PHP built-ins (`fopen`/`fread`/`bin2hex` or `file_get_contents` with a length limit for the magic-byte check). `composer.json` already exists with zero runtime dependencies (`wordpress-plugin/composer.json`); no new entries needed.

**Version verification:** Not applicable — no package versions to verify (WordPress core hook/function signatures are stable across the WP 6.x line targeted by this plugin's `Requires at least: 6.0` header in `khaveeai.php`).

## Package Legitimacy Audit

Not applicable. This phase installs zero external packages — only WordPress core PHP functions/hooks and PHP built-ins are used. `wordpress-plugin/composer.json` remains dependency-free (`"require": {"php": ">=8.0"}` only).

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  BROWSER (wp-admin, manage_options-gated)                            │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │ Settings form (server-rendered HTML, options.php POST)      │      │
│  │   - API key <input type=password> showing masked value      │      │
│  │   - Instructions <textarea>                                  │      │
│  │   - Voice <select> (hardcoded OpenAI voice enum)             │      │
│  │   - Avatar picker button → wp.media() frame                  │      │
│  │       (library.type = 'model/gltf-binary')                   │      │
│  └───────┬──────────────────────────────────────┬───────────────┘      │
│          │ POST options.php                     │ AJAX (WP core's own │
│          │ (settings save)                       │  async-upload.php) │
├──────────┼───────────────────────────────────────┼─────────────────────┤
│          ▼              WORDPRESS PHP (server)   ▼                    │
│  ┌────────────────────────────┐   ┌────────────────────────────────┐  │
│  │ SettingsPage::register()    │   │ upload_mimes filter (scoped)   │  │
│  │  → register_setting()       │   │  + wp_check_filetype_and_ext   │  │
│  │  → sanitize_callback per     │   │     filter (scoped, magic-byte │  │
│  │     field (mask-detect for   │   │     check on the 12-byte GLB   │  │
│  │     api_key, D-05/D-07/D-08) │   │     header)                    │  │
│  └──────────────┬───────────────┘   └───────────────┬─────────────────┘  │
│                 │                                    │                  │
│                 ▼                                    ▼                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ update_option('khaveeai_settings', [...])                         │  │
│  │   api_key | instructions | voice | model (untouched) | avatar_url │  │
│  └──────────────────────────────┬─────────────────────────────────────┘  │
└─────────────────────────────────┼──────────────────────────────────────┘
                                   ▼
                  wp_options['khaveeai_settings']  (Phase 6's read contract)
                                   │
                                   ▼
              WpOptionsConfigSource::get_runtime_config() / get_api_key() / is_configured()
                                   │
                                   ▼
                    SessionController (Phase 6, unmodified consumer)
```

A reader can trace: admin submits the form → `options.php` invokes each field's `sanitize_callback` → masked-placeholder detection either preserves the existing key or validates+stores a new one → `update_option()` writes the same `wp_options['khaveeai_settings']` shape Phase 6 already reads → `WpOptionsConfigSource` (now also exposing `is_configured()`) is the single read gateway for both this phase's own "not configured" banner and Phase 6's existing `SessionController`.

### Recommended Project Structure

```
wordpress-plugin/includes/Admin/
└── SettingsPage.php       # Single class: menu registration, register_setting() calls,
                           #   sanitize_callback methods (one per field group), render
                           #   callback (form HTML + status banner), upload filter
                           #   registration/removal scoped around the avatar field's
                           #   save handling
```

No additional files are needed — D-01's "plain PHP form" decision and the phase's narrow scope (4 fields + one upload action) do not justify splitting into multiple classes (e.g., a separate `Admin/Fields/ApiKeyField.php`). Keep `SettingsPage.php` as one cohesive class; revisit only if field count grows substantially (explicitly out of scope per REQUIREMENTS.md's "Multi-tab settings UI" deferral).

### Pattern 1: Two-filter VRM/GLB content validation, scoped narrowly around the upload action

**What:** Register `upload_mimes` (extension → MIME allowlist) and `wp_check_filetype_and_ext` (binary magic-byte re-validation) together, immediately before the Media Library upload call this settings page triggers, and remove both filters immediately after.

**When to use:** Any time this plugin accepts a `.glb`/`.vrm` upload via `wp.media`/`wp_handle_upload`. Required for ASSET-01.

**Example:**
```php
// Source: developer.wordpress.org/reference/hooks/upload_mimes,
//         developer.wordpress.org/reference/functions/wp_check_filetype_and_ext
//         (signature verified via WebFetch against the official function reference)

/**
 * Allow .glb and .vrm extensions through the upload allowlist.
 * IANA-registered MIME for binary glTF is `model/gltf-binary` — NOT
 * `model/glb-binary` (a typo seen in some community examples).
 */
function khaveeai_allow_glb_vrm_mimes( array $mimes ): array {
	$mimes['glb'] = 'model/gltf-binary';
	$mimes['vrm'] = 'model/gltf-binary'; // VRM is a GLB-format container; no distinct IANA type exists.
	return $mimes;
}

/**
 * Re-validate the file's actual binary content against the GLB/VRM
 * magic-byte signature, independent of what upload_mimes permitted by
 * extension alone (ASSET-01 — ext allowlist is NOT sufficient).
 *
 * wp_check_filetype_and_ext filter signature: ($data, $file, $filename, $mimes, $real_mime)
 */
function khaveeai_validate_glb_vrm_content( $data, $file, $filename, $mimes, $real_mime ) {
	$ext = strtolower( (string) pathinfo( $filename, PATHINFO_EXTENSION ) );

	if ( 'glb' !== $ext && 'vrm' !== $ext ) {
		return $data; // Not our file type — don't touch unrelated uploads.
	}

	// GLB/VRM 12-byte header: 4-byte magic "glTF" (0x67 0x6C 0x54 0x46),
	// 4-byte version (uint32 LE), 4-byte total length (uint32 LE).
	$handle = @fopen( $file, 'rb' );
	if ( false === $handle ) {
		$data['ext'] = false;
		$data['type'] = false;
		return $data; // Can't read it — reject, don't assume.
	}

	$header = fread( $handle, 4 );
	fclose( $handle );

	if ( "glTF" !== $header ) {
		// Wrong magic bytes — reject regardless of what the extension claimed.
		$data['ext']  = false;
		$data['type'] = false;
		return $data;
	}

	$data['ext']  = $ext;
	$data['type'] = 'model/gltf-binary';
	return $data;
}

// Scoped registration — add immediately before, remove immediately after
// the upload call this settings page itself triggers (Pitfall 8: never
// leave these registered for the full request lifecycle).
add_filter( 'upload_mimes', 'khaveeai_allow_glb_vrm_mimes' );
add_filter( 'wp_check_filetype_and_ext', 'khaveeai_validate_glb_vrm_content', 10, 5 );
// ... trigger wp_handle_upload() / media_handle_upload() here ...
remove_filter( 'upload_mimes', 'khaveeai_allow_glb_vrm_mimes' );
remove_filter( 'wp_check_filetype_and_ext', 'khaveeai_validate_glb_vrm_content', 10 );
```

**Note on `wp.media`'s own upload path:** When the avatar field uses the `wp.media` JS frame's built-in "Upload files" tab (not a custom form), the upload itself goes through WordPress core's own `async-upload.php`/`wp_ajax_upload_attachment` handler, which is a *different* code path than a manual `wp_handle_upload()` call from this plugin's own form handler. The `upload_mimes`/`wp_check_filetype_and_ext` filters must be registered on a hook that fires before that core AJAX handler runs (e.g. `admin_init` scoped to only the settings page's screen, or directly inside the `wp_ajax_upload_attachment` flow) — NOT only inside this plugin's own settings-save POST handler, since the actual binary upload happens via a separate AJAX request the moment the admin picks a file in the `wp.media` frame, before the settings form is ever submitted. Verify this hook-timing distinction during implementation; it is the most likely "looks done but isn't" gap (PITFALLS.md's checklist item: "verify by renaming an arbitrary non-GLB file... and attempting upload" must be tested through the actual `wp.media` picker UI, not just a direct `wp_handle_upload()` unit call).

### Pattern 2: Masked-field resave-safe `sanitize_callback`

**What:** The API key field's `sanitize_callback` compares the submitted value against the masked placeholder string; if they match (admin didn't touch the field), it returns the existing stored key unchanged instead of the placeholder text.

**When to use:** Required for SET-01/D-05/D-07. This is the single most important correctness detail in the phase — get it wrong and every unrelated settings save (e.g. just changing the voice) silently destroys the saved API key.

**Example:**
```php
// Source: pattern synthesized from developer.wordpress.org/reference/functions/register_setting
// (sanitize_callback mechanics) + community-verified "return get_option() to skip save"
// idiom (fsylum.net/blog/validate-options-on-custom-wordpress-settings-page,
// presscoders.com/wordpress-settings-api-explained) — MEDIUM confidence on the idiom
// itself (no single official WP doc states this exact pattern), HIGH confidence on
// the underlying sanitize_callback mechanics it relies on.

private function mask_api_key( string $key ): string {
	if ( '' === $key ) {
		return '';
	}
	$last_four = substr( $key, -4 );
	return 'sk-••••••' . $last_four; // D-07: literal SET-01 example format.
}

public function sanitize_api_key( $submitted ): string {
	$submitted = is_string( $submitted ) ? trim( $submitted ) : '';
	$existing  = $this->config_source->get_api_key();
	$masked    = $this->mask_api_key( $existing );

	// D-05: unchanged masked field → preserve existing key, don't overwrite.
	if ( $submitted === $masked ) {
		return $existing;
	}

	// D-06: deliberate "Remove key" checkbox is a SEPARATE field/control —
	// handled by its own checkbox value in the calling context, not inferred
	// from an emptied api_key field here.

	// D-08: light format check on a genuinely NEW value only.
	if ( '' === $submitted || 0 !== strpos( $submitted, 'sk-' ) ) {
		add_settings_error(
			'khaveeai_settings',
			'khaveeai_api_key_invalid_format',
			__( 'API key must start with "sk-" and cannot be empty.', 'khaveeai' )
		);
		return $existing; // Reject the bad value — keep the previously stored key.
	}

	return $submitted;
}
```

### Pattern 3: Avatar attachment ID storage + `wp_get_attachment_url()` resolution

**What:** Store only the Media Library attachment ID (an integer) in `wp_options['khaveeai_settings']['avatar_attachment_id']`, never the raw URL or binary. Resolve to a URL via `wp_get_attachment_url()` at render time (both in this settings page's own "filename + upload date" display, and downstream in Phase 6's `WpOptionsConfigSource::get_runtime_config()`'s `avatar_url` field).

**When to use:** Required for SET-04 and matches `ARCHITECTURE.md`'s explicit "Second bottleneck" scaling note (avoiding `wp_options` autoload bloat).

**Example:**
```php
// Source: ARCHITECTURE.md "Second bottleneck" recommendation; wp_get_attachment_url()
// is a well-documented WP core function (developer.wordpress.org/reference/functions/wp_get_attachment_url)

$attachment_id = (int) get_post_meta( $settings_option_id, '_khaveeai_avatar_attachment_id', true );
// OR, simpler for this phase's single-global-config shape, stored directly
// inside the khaveeai_settings option array:
$attachment_id = isset( $settings['avatar_attachment_id'] ) ? (int) $settings['avatar_attachment_id'] : 0;

$avatar_url  = $attachment_id > 0 ? wp_get_attachment_url( $attachment_id ) : '';
$attachment  = $attachment_id > 0 ? get_post( $attachment_id ) : null;
$filename    = $attachment ? basename( get_attached_file( $attachment_id ) ) : '';
$upload_date = $attachment ? $attachment->post_date : '';
```

**Important — Phase 6 compatibility note:** `WpOptionsConfigSource::get_runtime_config()` currently reads `avatar_url` directly as a string from the options array (`isset( $settings['avatar_url'] ) ? (string) $settings['avatar_url'] : ''`). If this phase stores only an attachment ID, `WpOptionsConfigSource` needs a corresponding small change to resolve `avatar_url` from the stored attachment ID via `wp_get_attachment_url()` at read time, rather than reading a pre-resolved URL string. This is a backward-compatible change to `WpOptionsConfigSource`'s internals only — `get_runtime_config()`'s **return shape** (`avatar_url: string`) does not change, so `SessionController` and any future consumer are unaffected. Flag this as a required adjustment to existing Phase 6 code, not just new code — confirm during planning whether to store the ID-only shape (recommended, matches ARCHITECTURE.md) or accept the simpler-but-discouraged "store the resolved URL string directly" shape Phase 6's current read path already assumes.

### Anti-Patterns to Avoid

- **Registering `upload_mimes`/`wp_check_filetype_and_ext` unconditionally for the whole request lifecycle:** Widens the upload attack surface to every other upload path on the site (any role, any plugin's upload form) — per PITFALLS.md Pitfall 8. Scope narrowly around this plugin's own upload action only.
- **Inferring "remove the key" from an emptied input field:** Browser autofill or a stray backspace could silently delete a saved secret. D-06 requires a separate, explicit "Remove key" control.
- **Storing the raw/full API key value in any HTML attribute, even `type="password"`:** A `type="password"` input still round-trips its `value` attribute in plaintext HTML if you ever set `value="<?php echo $api_key; ?>"` directly. Always populate the field with the masked string (`mask_api_key()`), never the raw key, when rendering the form on GET.
- **Treating `add_menu_page()`'s `$capability` argument as sufficient access control:** It only hides the menu *link* from users lacking the capability — it does NOT block direct navigation to the page's URL (`admin.php?page=...`). SET-05 explicitly requires the render callback to ALSO call `current_user_can('manage_options')` and `wp_die()` on failure.
- **Validating GLB/VRM magic bytes only inside this plugin's own form-submit handler:** Misses the upload that happens via `wp.media`'s built-in upload tab, which fires its own AJAX request independent of this settings page's POST submission (see Pattern 1's note).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Settings form save/nonce/redirect flow | A custom POST handler + manual `wp_verify_nonce()` + manual `update_option()` calls | WP's `register_setting()` + `settings_fields()` + `options.php` | `options.php` already handles nonce verification, the `Settings saved.` admin notice, and routing each registered option through its own `sanitize_callback` — reimplementing this is pure duplicated risk for zero benefit (D-01 already chose this) |
| Avatar file picker UI | A custom `<input type="file">` + manual AJAX upload + progress bar | `wp.media()` JS frame (`wp_enqueue_media()`) | WordPress core's Media Library JS already handles drag-drop, progress, thumbnail generation hooks, and attachment metadata storage — D-01 explicitly defers to this |
| File-type content sniffing infrastructure | A general-purpose "detect any file type from bytes" library | A literal 4-byte string comparison against `"glTF"` | GLB/VRM's signature check is exactly as complex as `substr($bytes, 0, 4) === "glTF"` — no library, however small, is justified for one fixed-offset literal comparison |
| Rate-limiting or abuse protection on this page | None needed | N/A | This page is already capability-gated to `manage_options` (logged-in admins only) — Phase 6's anonymous-route abuse concerns (rate limiting, IP throttling) do not apply here at all; do not import that pattern into this phase |

**Key insight:** Every "don't hand-roll" item in this phase already has a WordPress-core-native answer. The only genuinely custom logic this phase writes is the masked-key comparison (3-4 lines) and the magic-byte check (a 4-byte string compare) — both are correctly scoped as "too small to be worth a library," not "too complex to hand-roll safely."

## Common Pitfalls

### Pitfall 1: `upload_mimes` allowlist without `wp_check_filetype_and_ext` magic-byte validation

**What goes wrong:** A file renamed from `malicious.php` to `malicious.glb` (or any arbitrary binary with a `.glb`/`.vrm` extension but non-glTF content) is accepted into the Media Library because only the extension was checked.

**Why it happens:** `upload_mimes` only controls which *extensions* WordPress permits; it does not inspect file *content*. Developers commonly add only this one filter, see legitimate `.glb` test files upload successfully, and stop there — the gap only surfaces under adversarial input (success criterion 4 explicitly tests this).

**How to avoid:** Always pair `upload_mimes` with a `wp_check_filetype_and_ext` filter that reads the actual first bytes of the uploaded file and compares against the GLB/VRM magic-byte signature (`glTF` ASCII at offset 0), independent of whatever the extension claims.

**Warning signs:** A code review that finds `add_filter('upload_mimes', ...)` with no corresponding `add_filter('wp_check_filetype_and_ext', ...)` nearby.

### Pitfall 2: Masked API key field silently wipes the stored secret on unrelated saves

**What goes wrong:** Admin changes only the voice dropdown and saves. If the API key `<input>`'s value is the masked placeholder string and the sanitize callback blindly stores whatever was submitted, the real key is overwritten with the literal masked placeholder text (`sk-••••••1234`), permanently destroying the working key.

**Why it happens:** The most naive `sanitize_callback` implementation just does `return sanitize_text_field($value);` without any awareness that the displayed value is a masked placeholder, not the real data.

**How to avoid:** Pattern 2 above — compare the submitted value against the currently-computed mask string; if equal, return the existing stored value unchanged.

**Warning signs:** Testing the settings page by changing only the voice field (leaving the API key field visually untouched) and confirming, after save, that voice calls to the REST route still succeed (i.e., the key wasn't wiped) — this should be an explicit phase verification step.

### Pitfall 3: `manage_options` capability checked only at menu registration, not in the render callback

**What goes wrong:** `add_menu_page()`'s capability argument hides the menu link for non-admins, but a non-admin who already knows or guesses the page's `admin.php?page=khaveeai-settings` URL can still navigate directly to it and render the page — including, in the worst case, submitting the save form — if the render callback itself performs no capability check.

**Why it happens:** Developers assume the menu-registration capability is the only gate needed, not realizing it is purely a UI-visibility filter, not an access-control mechanism on its own.

**How to avoid:** The render callback's FIRST statement must be `if ( ! current_user_can( 'manage_options' ) ) { wp_die( ... ); }` — independent of, and in addition to, the menu registration capability (SET-05 explicitly requires checking at both layers).

**Warning signs:** Success criterion 3 explicitly tests this — log out, become a non-admin user, navigate directly to the settings page URL, and confirm rejection.

### Pitfall 4: `wp_check_filetype_and_ext`/`upload_mimes` filters registered for the entire request lifecycle, not scoped to this plugin's upload action

**What goes wrong:** Once registered unconditionally (e.g. on `init` or `plugins_loaded` with no removal), ANY upload path on the entire site — the standard Media Library "Add New" screen, a contact form's file attachment, a different plugin's upload feature — now also accepts `.glb`/`.vrm`, since `upload_mimes` is a global, unscoped filter.

**Why it happens:** It's simpler to register the filters once at plugin boot and forget about them than to thread scoped add/remove calls around the one specific upload action that needs them.

**How to avoid:** Add both filters immediately before triggering the avatar upload handling, remove both immediately after (Pattern 1). If the upload genuinely happens via `wp.media`'s own AJAX flow (not a direct call this plugin makes), scope the filters to fire only when the current admin screen is this plugin's own settings page (check `get_current_screen()`'s ID, or hook narrowly on the specific AJAX action).

**Warning signs:** A security scan or manual test that uploads a `.glb` file through the *standard* Media Library "Add New" screen (not this plugin's settings page) and finds it's now accepted there too — a sign the filter wasn't scoped.

### Pitfall 5: `.gltf` (plaintext JSON variant) silently rejected even after MIME registration

**What goes wrong:** If a future iteration or an admin's confusion leads to also allowlisting `.gltf` (not just `.glb`/`.vrm`), PHP's `finfo` will sniff the file's actual content as `text/plain`/`application/json` (since `.gltf` genuinely IS JSON under the hood), causing `wp_check_filetype_and_ext()`'s own internal re-derivation to disagree with the extension-claimed MIME type and reject the file — a documented WP-core fileinfo inconsistency, not a bug in this plugin's code.

**Why it happens:** Developers don't realize `.gltf` and `.glb` are fundamentally different container formats (JSON text vs. binary) despite sharing the "glTF" name.

**How to avoid:** D-09 already excludes `.gltf` entirely from scope — this phase only needs to support `.glb` and `.vrm` (both binary). Do not expand scope to `.gltf` without separately re-solving this fileinfo mismatch (out of scope for this phase).

**Warning signs:** A support report specifically calling out `.gltf` (not `.glb`) rejection — confirms the fileinfo mismatch rather than a configuration bug.

## Code Examples

### Settings page registration and field rendering skeleton

```php
// Source: developer.wordpress.org/reference/functions/register_setting,
//         developer.wordpress.org/reference/functions/add_menu_page
// (signatures verified via WebFetch against official function reference pages)

namespace Khavee\Plugin\Admin;

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;

final class SettingsPage {

	private const OPTION_GROUP = 'khaveeai_settings_group';
	private const OPTION_NAME  = 'khaveeai_settings'; // Matches WpOptionsConfigSource::OPTION_NAME exactly.
	private const PAGE_SLUG    = 'khaveeai-settings';

	public function __construct( private ConfigSourceInterface $config_source ) {}

	public function register_hooks(): void {
		add_action( 'admin_menu', [ $this, 'add_menu_page' ] );
		add_action( 'admin_init', [ $this, 'register_settings' ] );
	}

	public function add_menu_page(): void {
		add_menu_page(
			__( 'Khavee AI Avatar', 'khaveeai' ),
			__( 'Khavee AI Avatar', 'khaveeai' ),
			'manage_options',           // D-02/SET-05: capability gate at registration.
			self::PAGE_SLUG,
			[ $this, 'render_page' ],
			'dashicons-microphone'
		);
	}

	public function register_settings(): void {
		register_setting(
			self::OPTION_GROUP,
			self::OPTION_NAME,
			[ 'sanitize_callback' => [ $this, 'sanitize_settings' ] ]
		);
		// add_settings_section()/add_settings_field() calls per field
		// (api_key, instructions, voice, avatar_attachment_id, remove_key checkbox)
		// omitted here — straightforward Settings API boilerplate.
	}

	public function render_page(): void {
		// SET-05: render-callback-layer capability check — independent of
		// add_menu_page()'s capability arg above (Pitfall 3).
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'khaveeai' ) );
		}

		// D-14: "not configured" status banner, same is_configured() check
		// Phase 8's frontend embed notice will also consume.
		if ( ! $this->config_source->is_configured() ) {
			echo '<div class="notice notice-warning"><p>' .
				esc_html__( 'Khavee AI Avatar is not yet configured — enter an OpenAI API key below.', 'khaveeai' ) .
				'</p></div>';
		}

		settings_errors( 'khaveeai_settings' );

		wp_enqueue_media(); // D-01: loads wp.media JS for the avatar picker.

		// Form markup: settings_fields(self::OPTION_GROUP), do_settings_sections(self::PAGE_SLUG),
		// submit_button() — standard Settings API page skeleton.
	}
}
```

### `is_configured()` addition to `ConfigSourceInterface` (D-13)

```php
// Backward-compatible interface extension — existing get_runtime_config()/
// get_api_key() signatures unchanged; SessionController's usage unaffected.

interface ConfigSourceInterface {
	public function get_runtime_config(): array;
	public function get_api_key(): string;

	/**
	 * Whether the API key has been configured (non-empty). Does NOT
	 * verify the key is valid/working — only that one has been entered.
	 * Consumed by this phase's own "not configured" banner (D-14) and
	 * Phase 8's frontend embed admin-only notice (SET-06/D-12).
	 *
	 * @return bool
	 */
	public function is_configured(): bool;
}

// WpOptionsConfigSource implementation:
public function is_configured(): bool {
	return '' !== $this->get_api_key();
}
```

### Voice `<select>` options (D-04 — hardcoded enum, no model dropdown)

```php
// Source: packages/core/src/types/realtime.ts (authoritative OpenAI voice enum,
// per CONTEXT.md canonical_refs) — [CITED: internal TS source, cross-package contract]

private const VOICES = [
	'alloy', 'ash', 'ballad', 'coral', 'echo',
	'sage', 'shimmer', 'verse', 'marin', 'cedar',
];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `wp_localize_script()` for passing PHP config into JS | `wp_add_inline_script()` | Documented as the modern WP-core-recommended replacement when not localizing translatable strings | Not directly relevant to THIS phase (no JS bundle is built here per D-01) but relevant for Phase 8, which will read this phase's saved config to bootstrap the frontend embed — noted for continuity |
| Custom MIME validation via `mime_types` filter | `upload_mimes` filter specifically for upload allowlisting | `mime_types` is documented as a broader, less appropriate filter for this use case; `upload_mimes` is the correct narrow hook | Already correctly identified in STACK.md; no further state-of-the-art drift found during this phase's research |

**Deprecated/outdated:** None identified specific to this phase's scope — WordPress Settings API, `upload_mimes`, and `wp_check_filetype_and_ext` are all long-stable core APIs with no announced deprecation path.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The masked-field "compare to placeholder, fall back to `get_option()`" idiom is a community-verified pattern, not an official WordPress-documented API contract | Architecture Patterns, Pattern 2 | LOW — the underlying `sanitize_callback` mechanics are HIGH-confidence/official; only the specific "compare against mask string" idiom itself lacks a single canonical WP doc. If wrong, the worst case is a slightly different but equally safe implementation of the same defensive idea — no security regression, just a stylistic deviation |
| A2 | `wp.media`'s built-in upload tab triggers a *separate* AJAX request (`async-upload.php`/`wp_ajax_upload_attachment`) distinct from this plugin's settings-form POST, meaning the `upload_mimes`/`wp_check_filetype_and_ext` filters must be scoped to fire on that AJAX hook timing, not just inside the settings-save handler | Architecture Patterns, Pattern 1 (note) | MEDIUM — if the hook timing assumption is wrong, the magic-byte validation could silently not run for uploads initiated through the `wp.media` picker, reopening the exact disguised-file vulnerability ASSET-01 exists to close. This MUST be verified empirically against a real WP install during implementation (the "Looks Done But Isn't" checklist item from PITFALLS.md applies directly here) |
| A3 | Storing only a Media Library attachment ID (not a resolved URL string) in `wp_options['khaveeai_settings']` requires a corresponding small change to `WpOptionsConfigSource::get_runtime_config()`'s internal read logic (resolve via `wp_get_attachment_url()` at read time) | Architecture Patterns, Pattern 3 | MEDIUM — if the planner doesn't account for this, the most architecturally-correct storage shape (ID-only, per ARCHITECTURE.md) would be incompatible with Phase 6's existing read code without a follow-up patch. The simpler alternative (store the resolved URL string directly) avoids touching Phase 6 code at all, at the cost of not benefiting from attachment-ID indirection (URL survives CDN/multisite migration). This is a genuine open design choice the planner must resolve, not purely an implementation detail |

## Open Questions

1. **Does storing the avatar as an attachment ID require modifying `WpOptionsConfigSource.php` (Phase 6 code), or should this phase store a pre-resolved URL string to avoid touching existing code at all?**
   - What we know: `ARCHITECTURE.md` explicitly recommends attachment-ID storage + `wp_get_attachment_url()` resolution at render time as the scaling-correct pattern. `WpOptionsConfigSource::get_runtime_config()` currently reads `avatar_url` as a pre-stored string.
   - What's unclear: Whether the milestone considers a small, backward-compatible internal change to `WpOptionsConfigSource` (return shape unchanged, internal read logic changed) acceptable "Phase 6 code, NOT to be broken" territory, or whether this phase must work strictly around Phase 6's current string-based read without modifying it.
   - Recommendation: Treat the attachment-ID + `wp_get_attachment_url()` pattern as the correct approach (matches existing research, avoids future rework) and explicitly scope a small `WpOptionsConfigSource` adjustment as part of this phase's plan — the contract Phase 6 promises downstream (`get_runtime_config()`'s `avatar_url: string` return shape) is unaffected, only the option array's internal field name/type changes from `avatar_url: string` to `avatar_attachment_id: int`.

2. **Exact hook/timing for scoping `upload_mimes`/`wp_check_filetype_and_ext` around the `wp.media`-driven upload, given that the actual file upload happens via WordPress core's own AJAX handler, not this plugin's form-submit handler.**
   - What we know: `wp.media`'s "Upload files" tab POSTs to WP core's existing `async-upload.php` (or the `wp_ajax_upload_attachment` action), independent of and prior to this settings page's own `options.php` form submission.
   - What's unclear: The cleanest scoping mechanism — options include hooking on `current_screen` to detect "we're on the khaveeai settings page" before registering the filters (scoped per-admin-screen-load, broader than per-upload-call but still narrower than global), vs. hooking directly into the specific AJAX action.
   - Recommendation: Default to screen-scoped registration (`add_action('load-' . $hook_suffix, ...)` where `$hook_suffix` is what `add_menu_page()` returns) — register both filters when the khaveeai settings screen loads, remove them via `admin_footer` or screen-unload equivalent. This is narrower than "for the entire request" (Pitfall 4) while still reliably covering the AJAX upload that the `wp.media` frame triggers from that screen. Verify empirically during implementation — this is the single highest-uncertainty mechanical detail in the phase (see Assumption A2).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PHP | All plugin PHP code | ✓ | 8.5.7 (local dev machine) | Plugin declares `Requires PHP: 8.0` in header — compatible |
| Composer | PSR-4 autoloading | ✓ | 2.10.1 | — |
| WordPress core (actual WP install) | Runtime testing of Settings API, Media Library, capability checks | ✗ (no local WP install detected) | — | Use `wp-env`/Docker WP instance for manual verification, as already recommended in `STACK.md`'s Development Tools section; the existing Phase 6 pattern of standalone PHP harnesses with WP-function stubs (`tests/rest-logic-harness.php`, `tests/token-provider-harness.php`) can cover pure-logic units (e.g. `sanitize_api_key()`'s masking logic, the magic-byte check function) without a real WP install, but cannot exercise `register_setting()`/`options.php`/`wp.media` integration — those need either a real WP install or manual QA |
| `wp-cli` | Convenience for manual testing (e.g. `wp option get khaveeai_settings`) | ✗ | — | Not required; standard wp-admin UI testing works without it |

**Missing dependencies with no fallback:**
- None — all gaps have a documented fallback path.

**Missing dependencies with fallback:**
- Real WordPress install: use `wp-env` (already in `STACK.md`'s recommended dev tools) or any local WP install for end-to-end manual verification of the Settings API form, capability gating, and the `wp.media` upload flow — these cannot be fully exercised by the existing bare-PHP-with-stubs harness pattern alone, since that pattern stubs only the specific WP functions each class under test calls, not the full `options.php`/`wp.media` request lifecycle.

## Security Domain

`security_enforcement` is not present in `.planning/config.json` — treated as enabled per the default rule.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | This page relies on WordPress's existing logged-in-admin session; no new authentication mechanism is introduced |
| V3 Session Management | No | No new session handling — WP core's existing admin session cookie applies unchanged |
| V4 Access Control | Yes | `current_user_can('manage_options')` checked at BOTH menu-registration and render-callback layers (SET-05) — the two-layer pattern is itself the ASVS V4 control here (defense in depth against direct URL navigation bypassing menu-level hiding) |
| V5 Input Validation | Yes | `sanitize_text_field()`/`sanitize_textarea_field()` for text fields; explicit format check (`sk-` prefix, non-empty) for the API key (D-08); binary magic-byte content validation for file uploads (ASSET-01) — input validation here spans both string sanitization AND binary content verification, a broader scope than typical V5 guidance covers |
| V6 Cryptography | No (by design — see Out of Scope) | The OpenAI API key is stored in plaintext in `wp_options`, gated only by `manage_options` capability and never echoed in full to the browser (masked display). REQUIREMENTS.md's "Out of Scope" table explicitly declines encryption-at-rest beyond capability gating + masking, citing the conflict with "fully self-configured in WP admin" (a `wp-config.php` constant would be needed for true encryption-at-rest, which is deferred to SETV2-01). This is a documented, deliberate risk acceptance, not an oversight |

### Known Threat Patterns for WordPress Admin Settings + File Upload

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Disguised malicious file upload (correct extension, wrong/malicious binary content) | Tampering | `wp_check_filetype_and_ext` magic-byte validation (ASSET-01) — extension allowlist alone (`upload_mimes`) is insufficient and explicitly tested against by success criterion 4 |
| Direct URL navigation bypassing menu-hidden access control | Elevation of Privilege | Render-callback-layer `current_user_can()` check, independent of `add_menu_page()`'s capability argument (SET-05, Pitfall 3) |
| Masked secret field overwritten by its own placeholder string on unrelated form saves | Tampering (self-inflicted data loss, not an external attacker) | Mask-comparison `sanitize_callback` (D-05/D-07, Pattern 2) — not a classic STRIDE attacker scenario, but a correctness/availability risk worth tracking with the same rigor since the impact (locked-out voice pipeline) mirrors a DoS |
| Global `upload_mimes`/`wp_check_filetype_and_ext` filter widening the site-wide upload surface for unrelated upload paths | Elevation of Privilege (via scope creep, not direct exploitation) | Scoped filter registration/removal (Pitfall 4) — register only around this plugin's own upload action, never for the full request lifecycle |
| Secret (API key) leaking into HTML via a naive `value="<?php echo $raw_key ?>"` render | Information Disclosure | Always render the masked string (`mask_api_key()`'s output), never the raw stored key, in the field's HTML `value` attribute on page load |

## Sources

### Primary (HIGH confidence)
- [register_setting() – Function Reference](https://developer.wordpress.org/reference/functions/register_setting/) — official docs, `sanitize_callback`/`show_in_rest` mechanics, fetched directly
- [wp_check_filetype_and_ext() – Function Reference](https://developer.wordpress.org/reference/functions/wp_check_filetype_and_ext/) — official docs, filter signature and core-internal validation behavior
- [upload_mimes – Hook Reference](https://developer.wordpress.org/reference/hooks/upload_mimes/) — official docs
- [IANA media-types registry: model/gltf-binary](https://www.iana.org/assignments/media-types/model/gltf-binary) — official registry, confirms `model/gltf-binary` (registered 2017-11-06) is the correct MIME type, NOT `model/glb-binary`
- `/Users/whitemalt/Documents/khavee-sdk/wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php`, `WpOptionsConfigSource.php`, `Plugin.php`, `khaveeai.php`, `Rest/SessionController.php`, `TokenProvider/OpenAiDirectTokenProvider.php` — read directly, define the exact contract this phase writes through
- `/Users/whitemalt/Documents/khavee-sdk/wordpress-plugin/tests/rest-logic-harness.php`, `tests/token-provider-harness.php` — read directly, establish the existing bare-PHP-with-WP-stubs test harness convention this phase's unit-testable logic (masking, magic-byte check) should follow
- `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`, `.planning/research/STACK.md` — milestone-level research already covering this exact phase's domain in depth; read directly and cross-referenced throughout this document

### Secondary (MEDIUM confidence)
- [allow-models-upload.php — JimJ92120/wordpress-plugin-allow-models-upload](https://github.com/JimJ92120/wordpress-plugin-allow-models-upload/blob/main/allow-models-upload.php) — community-verified working `upload_mimes`+`wp_check_filetype_and_ext` dual-filter pattern; the example's `model/glb-binary` MIME mapping is NOT IANA-registered (cross-checked against the IANA registry directly, primary source above) — use `model/gltf-binary` instead, the filter STRUCTURE/signature from this example is still correctly representative
- [Validate Options on Custom WordPress Settings Page — fsylum.net](https://fsylum.net/blog/validate-options-on-custom-wordpress-settings-page/) — community source corroborating the "return `get_option()`'s existing value to skip an invalid save" idiom inside a `sanitize_callback`
- [settings_errors() – Function Reference](https://developer.wordpress.org/reference/functions/settings_errors/) — official docs (found via search, not independently WebFetched in this pass, but is the standard/well-known official reference for this function)
- GLB binary header structure (12-byte header: 4-byte magic `glTF`/0x46546C67 LE, 4-byte version, 4-byte length) — cross-verified across [docs.fileformat.com/3d/glb](https://docs.fileformat.com/3d/glb/), [formats.kaitai.io/gltf_binary](https://formats.kaitai.io/gltf_binary/), and the Khronos glTF specification references — multiple independent sources agree

### Tertiary (LOW confidence)
- The exact hook-timing mechanism for scoping `upload_mimes`/`wp_check_filetype_and_ext` specifically around `wp.media`'s AJAX-driven upload flow (vs. a form-submit-triggered `wp_handle_upload()` call) was not independently verified against a live WordPress install in this research pass — flagged explicitly as Open Question 2 / Assumption A2, requiring empirical verification during implementation

## Metadata

**Confidence breakdown:**
- Standard stack (WP Settings API, Media Library, upload filters): HIGH — all core WordPress APIs, verified against official developer.wordpress.org references and the IANA media-types registry
- Architecture (masked-key pattern, attachment-ID storage, scoped filter registration): MEDIUM-HIGH — core mechanics are HIGH confidence (official docs); the specific idioms (mask-comparison, screen-scoped filter timing) are MEDIUM confidence, community-corroborated but not single-canonical-source-documented
- Pitfalls: HIGH — this milestone's pre-existing `PITFALLS.md` already did deep synthesis on this exact phase's risk surface (Pitfalls 7, 8 map directly); this research's own findings (IANA MIME correction, two-AJAX-path upload timing) add to, not contradict, that existing work

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (30 days — WordPress core Settings API/Media Library/upload-filter APIs are stable; re-verify only if WP core version targeting changes or if implementation reveals the Open Questions resolve differently than assumed)
