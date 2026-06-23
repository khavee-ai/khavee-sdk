# Phase 7: Admin Settings Page - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the WordPress plugin's admin-facing settings page: a WP Settings API page (under `manage_options` capability) where the site admin configures the OpenAI API key, personality/instruction text, voice selection, and a VRM/GLB avatar upload via the Media Library. The page reads and writes exclusively through Phase 6's `ConfigSourceInterface`/`WpOptionsConfigSource` — no new config storage mechanism. No shortcode, Gutenberg block, or frontend JS bundle is built in this phase — those are Phase 8. This phase also makes one small additive change to `ConfigSourceInterface` (an `is_configured()`-style helper) so Phase 8 can detect "API key missing" without duplicating logic.

</domain>

<decisions>
## Implementation Decisions

### Settings Page Tech Approach
- **D-01:** Plain WP Settings API HTML form (`register_setting()`/`add_settings_field()`), not a React/`wp-element` admin UI. No bundler/JS build needed for the page itself; the avatar file picker uses WordPress's built-in `wp.media` JS (already loaded via `wp_enqueue_media()`), not custom code.
- **D-02:** Settings page lives as its own top-level wp-admin menu item ("Khavee AI Avatar"), not a submenu under Settings — prioritizes discoverability for a non-power-user site owner over menu tidiness.
- **D-03:** No model dropdown. `model` stays a hardcoded default in `WpOptionsConfigSource` (`gpt-realtime-1.5`) — not exposed as a settings field. Keeps the page at exactly the 4 fields REQUIREMENTS.md specifies (API key, instructions, voice, avatar), consistent with Phase 6's anti-bloat stance (D-04 in `06-CONTEXT.md`).
- **D-04:** No voice preview/sample-playback button. The voice field is a plain `<select>` populated from the hardcoded OpenAI voice enum (`alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar` — see `packages/core/src/types/realtime.ts`). Adding live audio playback would require a client-side OpenAI TTS call, which is out of scope (matches REQUIREMENTS.md's deferral of "Test Connection" to v2/SETV2-02).

### API Key Re-Save Behavior
- **D-05:** If the admin saves the form without touching the masked key field, the `sanitize_callback` detects the submitted value still equals the masked placeholder string and leaves the stored `api_key` untouched. This is the load-bearing fix for the classic "masked field wipes the secret on every unrelated save" bug.
- **D-06:** Clearing a saved key is a separate, deliberate action — a dedicated "Remove key" checkbox/control next to the masked field — rather than inferring removal from an emptied field (which risks accidental loss from browser autofill or a stray backspace).
- **D-07:** Mask format on reload: `sk-••••••` + last 4 characters (e.g. `sk-••••••1234`) — matches SET-01's exact example wording, gives the admin enough signal to recognize which key is saved without exposing it.
- **D-08:** When the admin enters a NEW key value (i.e., the field no longer equals the masked placeholder), apply a light format check before storing: reject empty-after-trim or anything not starting with `sk-`, surfaced as an inline WP Settings API error. Full validity (does the key actually work) is still only discoverable at runtime via the REST route's HTTP 502 path (Phase 6 D-09) — no live OpenAI ping from this page.

### Avatar Upload Scope & Limits
- **D-09:** Accept `.glb` and `.vrm` only — both are binary glTF containers sharing the same magic-byte check (ASCII `glTF` = `0x67 0x6C 0x54 0x46`). `.gltf` (the plaintext/JSON glTF variant) is explicitly excluded — per `PITFALLS.md`, PHP's `finfo` mis-sniffs it as `text/plain`/`application/json`, causing a documented WP-core fileinfo mismatch unrelated to this plugin's own code. Both `upload_mimes` (extension allowlist) AND a `wp_check_filetype_and_ext` magic-byte hook are required together (ASSET-01) — the allowlist alone is the "looks done but isn't" trap PITFALLS.md flags.
- **D-10:** Max upload size: 50MB, enforced at the plugin level (not deferred to host `php.ini`/`upload_max_filesize` defaults, which vary widely and aren't a deliberate choice).
- **D-11:** The settings page displays the currently-configured avatar as filename + upload date text only — no live 3D model preview. (Discussion note: the user initially wanted a live 3D preview; on learning that even a minimal preview requires its own JS bundle — either a small standalone three.js + `@pixiv/three-vrm` viewer or reusing `@khaveeai/react`'s `VRMAvatar`/`GLBAvatar` components — both of which contradict the plain-PHP-form approach (D-01), the user downgraded to the bundle-free filename/date display. If a future phase wants a real preview, treat it as new scope, not an oversight here.)
- **Restrict avatar upload to `manage_options` only** (per PITFALLS.md) — never expose the VRM/GLB MIME allowlist to any public-facing or non-admin upload path. Same capability gate as the rest of the page (SET-05).

### "Invalid Key" Notice Criteria (SET-06)
- **D-12:** The admin-only inline notice on the frontend embed (built in Phase 8) fires only on an empty/unset key (`get_api_key() === ''`). A key that's *wrong* (revoked, typo'd, wrong project) is only discoverable when the REST route's actual OpenAI call fails at runtime (HTTP 502, per Phase 6 D-09/D-10's "log server-side only, no detail leaked" pattern) — this phase does not attempt to guess validity via format heuristics for the embed notice.
- **D-13:** Expose the empty-key check as a small additive helper on `ConfigSourceInterface` (e.g. `is_configured(): bool`) rather than leaving Phase 8 to re-derive "is this configured" from `get_api_key()` directly. This is a deliberate, backward-compatible extension of Phase 6's interface — `WpOptionsConfigSource` gets the one new method; `SessionController`'s existing usage is unaffected.
- **D-14:** The settings page itself (separate from the Phase-8-built frontend embed notice) shows its own "not configured yet" status banner — standard WP admin-notice styling — at the top of the page whenever the key is empty, using the same `is_configured()` check.

### Claude's Discretion
- Exact settings page slug/option-group naming, field ID naming, and the precise PHP file/class name for the settings page (e.g. `Admin/SettingsPage.php`, matching `ARCHITECTURE.md`'s suggested structure) — implementation detail, not discussed.
- Exact wording/copy for the "Remove key" control, the format-validation error message, and the "not configured" status banner — left to implementation, should follow plain, undecorated WP admin conventions (no decorative emoji, per CLAUDE.md's logging/comment conventions extended to UI copy).
- Whether `is_configured()` is a new interface method (requiring `WpOptionsConfigSource` to implement it) vs. a default/trait-based implementation — implementation detail; either is fine as long as `ConfigSourceInterface` gains the capability.
- Exact admin notice/menu icon choice for the top-level menu item — cosmetic, not discussed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone planning artifacts
- `.planning/ROADMAP.md` (Phase 7 section) — phase goal, success criteria 1-5, requirement IDs
- `.planning/REQUIREMENTS.md` (SET-01..06, ASSET-01) — exact requirement wording for this phase
- `.planning/PROJECT.md` — milestone context, constraints, Key Decisions table

### Architecture & pitfalls research (this milestone)
- `.planning/research/ARCHITECTURE.md` — suggested `includes/Admin/SettingsPage.php` location and structure, `wp_get_attachment_url()` avatar-storage pattern (store attachment ID, not raw URL/base64, in `wp_options`), composition-root wiring convention
- `.planning/research/PITFALLS.md` — Pitfall 7 (GLB/VRM disguised-file-upload risk, two-filter requirement), Pitfall 8 (`upload_mimes` is a global filter, not scoped to this plugin), the API-key-masking guidance, and the WP.org "external services" readme disclosure note (relevant if this plugin is ever submitted to WordPress.org)
- `.planning/research/STACK.md` — Settings API `sanitize_callback` pattern, "plain PHP form, no React needed" recommendation, the masked-key-display guidance (D-05/D-07 directly implement this), the `upload_mimes` + `wp_check_filetype_and_ext` two-filter requirement

### Existing code this phase builds on (Phase 6, NOT to be broken)
- `wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php` — gains the new `is_configured()` (or equivalent) method per D-13; existing `get_runtime_config()`/`get_api_key()` contracts must not change shape
- `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` — reads/writes `wp_options['khaveeai_settings']` (keys: `api_key`, `instructions`, `voice`, `model`, `avatar_url`); this phase is the FIRST code that WRITES this option (Phase 6 only reads it) — sanitize/validate on write per D-05/D-06/D-08
- `wordpress-plugin/includes/Plugin.php` — composition root; if `SettingsPage` needs the `ConfigSourceInterface` instance, wire it through here the same way `SessionController` is wired (constructor injection, no DI container)
- `wordpress-plugin/khaveeai.php` — autoload bootstrap; new `Admin/SettingsPage.php` class must be added to the PSR-4 autoload map (already covers `Khavee\Plugin\` → `includes/`, so no composer.json change needed if namespaced correctly)

### Contract this phase's notice criteria feeds into (Phase 8, NOT built yet)
- `.planning/codebase/INTEGRATIONS.md` — confirms the existing TS-side "backend proxy assumption" pattern this PHP-side key-masking decision mirrors
- `packages/core/src/types/realtime.ts` — authoritative OpenAI voice enum list (`alloy | ash | ballad | coral | echo | sage | shimmer | verse | marin | cedar`) for the voice `<select>` (D-04)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `wp.media` (WordPress core JS, loaded via `wp_enqueue_media()`) — the avatar file picker; no custom upload widget needs to be built.
- `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` — already defines the exact option shape (`api_key`, `instructions`, `voice`, `model`, `avatar_url`) and defaults this settings page must write into; the settings page is the write-side counterpart to this existing read-side class.

### Established Patterns
- `Plugin.php` composition root pattern (constructor injection, no DI container, no filter-hook-driven strategy selection) — if `SettingsPage` needs `ConfigSourceInterface`, wire it the same way `SessionController` already is.
- "Backend proxy assumption" / never-leak-the-secret pattern, already established in Phase 6's `OpenAiDirectTokenProvider` and `SessionController` (D-09/D-10's "generic error, log server-side only") — this phase's masked-key-display and format-validation decisions are the settings-page-side instance of the same "never expose the secret" discipline.

### Integration Points
- `ConfigSourceInterface` gains one new method (`is_configured()` or equivalent) — Phase 8's frontend embed render path and this phase's own settings-page status banner both consume it.
- `wp_options['khaveeai_settings']` — this phase is the first WRITE path; Phase 6's `WpOptionsConfigSource::get_runtime_config()`/`get_api_key()` are the existing READ path and must keep working unchanged against whatever shape this phase writes.

</code_context>

<specifics>
## Specific Ideas

- Mask format must literally match SET-01's example: `sk-••••••1234` (prefix + 6 dots + last 4 chars).
- "Remove key" should be a clearly separate, deliberate UI action (e.g. a checkbox labeled "Clear saved API key") — not an implicit consequence of an emptied field.
- The settings-page "not configured" banner and Phase 8's frontend embed notice are two distinct surfaces sharing one underlying check (`is_configured()`) — don't conflate them into one implementation.

</specifics>

<deferred>
## Deferred Ideas

- Live 3D model preview of the configured avatar directly in wp-admin — considered and explicitly declined (D-11) because it requires a JS rendering bundle that contradicts the plain-PHP-form approach chosen for this phase. Could resurface as its own small scoped addition in a later phase if there's real demand.
- Voice sample/preview playback on the settings page — declined (D-04), would need a live OpenAI TTS call; matches REQUIREMENTS.md's existing deferral of "Test Connection" (SETV2-02) to v2.
- Model selection as a settings field — declined (D-03), stays hardcoded; revisit only if a future requirement explicitly asks for it.
- Format-based "looks invalid" detection feeding the frontend embed notice (beyond empty-check) — declined (D-12); the project's existing pattern is to surface real failures via the REST route's runtime error path, not guess from the key's shape.

None — discussion stayed within phase scope otherwise.

</deferred>

---

*Phase: 7-admin-settings-page*
*Context gathered: 2026-06-23*
