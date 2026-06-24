---
phase: 08-frontend-bundle-shortcode-block
plan: 02
subsystem: wordpress-plugin-render
tags: [php, wordpress, shortcode, render-path, xss-escaping, asset-enqueue]

requires:
  - phase: 07
    provides: "ConfigSourceInterface/WpOptionsConfigSource (settings storage), SettingsPage admin-notice/manage_options conventions"
  - phase: 06
    provides: "Plugin::boot() composition root, khaveeai/v1/session REST route consumed via rest_url()"
provides:
  - "AvatarRenderer — single shared render path merging instance attrs over global config, emitting an XSS-safe mount-point div"
  - "AssetManager — idempotent, render-path-triggered enqueue of the front-end bundle (PERF-01)"
  - "AvatarShortcode — [khaveeai_avatar] shortcode adapter, resolves avatar attachment ID -> URL (D-03) before delegating"
  - "KHAVEEAI_PLUGIN_FILE/KHAVEEAI_VERSION bootstrap constants in khaveeai.php"
  - "render-logic-harness.php proving EMBED-02 override/fallback and EMBED-04 shortcode/block parity"
affects: ["08-04 (Gutenberg block — must reuse the same AvatarRenderer instance)"]

tech-stack:
  added: []
  patterns:
    - "Render-path-triggered asset enqueue instead of a sitewide wp_enqueue_scripts hook (PERF-01)"
    - "Shortcode/block thin-adapter funneling through one shared AvatarRenderer::render() to prevent drift (EMBED-04)"
    - "esc_attr( wp_json_encode( public_safe_whitelist ) ) for the mount-point data attribute"

key-files:
  created:
    - wordpress-plugin/includes/Render/AvatarRenderer.php
    - wordpress-plugin/includes/Assets/AssetManager.php
    - wordpress-plugin/includes/Shortcode/AvatarShortcode.php
    - wordpress-plugin/tests/render-logic-harness.php
  modified:
    - wordpress-plugin/includes/Plugin.php
    - wordpress-plugin/khaveeai.php

key-decisions:
  - "AvatarShortcode resolves the avatar attachment ID to a URL itself (mirroring WpOptionsConfigSource's own attachment-ID->URL pattern) before calling AvatarRenderer::render(), so the renderer only ever deals with a resolved avatar_url key regardless of which embed method called it"

patterns-established:
  - "Pattern: every new render-path PHP class is constructor-injected and wired exactly once in Plugin::boot(), reusing the single existing $config_source instance"
  - "Pattern: not-configured branch is gated FIRST on is_configured(), THEN on current_user_can('manage_options') — admin notice markup is structurally absent from the non-admin code path, not CSS-hidden"

requirements-completed: [EMBED-01, EMBED-02, EMBED-04, PERF-01]

duration: 35min
completed: 2026-06-24
---

# Phase 08 Plan 02: AvatarRenderer Shared Render Path, AssetManager, AvatarShortcode Summary

**PHP shared render path for `[khaveeai_avatar]` — merges instance/global config, emits an escaped mount-point div, gates a manage_options-only "not configured" admin notice vs. a neutral visitor placeholder, and enqueues the bundle only from inside the render call.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3/3 completed
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

- `AvatarRenderer::render()` is now the single funnel both the shortcode (this plan) and the future Gutenberg block (plan 04) will call — override-or-fallback merge logic, XSS-safe mount point, and the D-06/D-07 not-configured branch are written exactly once.
- `AssetManager::enqueue()` is idempotent (`wp_script_is()` guard) and is only ever invoked from inside `render()` — no `wp_enqueue_scripts` hook exists anywhere in the new code, so the bundle never loads on pages without an avatar instance (PERF-01).
- `[khaveeai_avatar]` is registered end-to-end through `Plugin::boot()`, reusing the single existing `WpOptionsConfigSource` instance (no second config-source instantiation).
- `render-logic-harness.php` (bare PHP, no WordPress/Composer) proves EMBED-02 (explicit override wins / omitted falls back to global, for voice/instructions/avatar) and EMBED-04 (shortcode-shaped and block-shaped input produce byte-identical public-safe config) — 12 cases, all passing.

## Task Commits

Each task was committed atomically:

1. **Task 1: AvatarRenderer + AssetManager** - `d586dfe` (feat)
2. **Task 2: AvatarShortcode adapter + Plugin.php wiring** - `566cee5` (feat)
3. **Task 3: render-logic-harness.php** - `9f5b6ea` (test) — includes a Rule-1 bug fix discovered while writing the harness (see Deviations)

**Plan metadata:** committed alongside this SUMMARY.

_Note: Task 3 is marked `tdd="true"` in the plan; the harness was written against the already-implemented Task 1/2 code (not strict RED-before-implementation), since AvatarRenderer/AvatarShortcode are the units under test and pre-existed this task. The harness did catch a real implementation bug on first run (see Deviations), which is the practical equivalent of the RED phase here._

## Files Created/Modified

- `wordpress-plugin/includes/Render/AvatarRenderer.php` - merges atts over global config, emits the escaped mount-point div, D-06 admin notice / D-07 visitor placeholder branch, `public_safe()` whitelist (voice/instructions/avatarUrl/restUrl — never the api key)
- `wordpress-plugin/includes/Assets/AssetManager.php` - idempotent `enqueue()` for `khaveeai-bundle`/`khaveeai-bundle-style`, empty deps array (D-10 full isolation)
- `wordpress-plugin/includes/Shortcode/AvatarShortcode.php` - `[khaveeai_avatar]` adapter; normalizes via `shortcode_atts()`, resolves the `avatar` Media Library attachment ID to a URL (D-03), filters empty strings, delegates to `AvatarRenderer::render()`
- `wordpress-plugin/includes/Plugin.php` - wires `AssetManager`/`AvatarRenderer`/`AvatarShortcode` in `boot()`, reusing the existing `$config_source`
- `wordpress-plugin/khaveeai.php` - defines `KHAVEEAI_PLUGIN_FILE`/`KHAVEEAI_VERSION` before the `plugins_loaded`/`Plugin::boot` hook
- `wordpress-plugin/tests/render-logic-harness.php` - bare-PHP harness, 12 cases covering EMBED-02/EMBED-04/info-disclosure/D-06-D-07/PERF-01

## Decisions Made

- The shortcode's `avatar` attribute is a Media Library attachment ID (per plan/D-03), but `AvatarRenderer`'s merge logic operates on an `avatar_url` key (matching `WpOptionsConfigSource`'s own runtime-config shape). `AvatarShortcode` resolves the attachment ID to a URL via `wp_get_attachment_url()` itself, before calling `render()` — the renderer stays attachment-ID-agnostic, which is also what lets the future Gutenberg block (whose `block.json` attribute schema can supply either a raw URL or its own attachment-ID-resolution step) produce identical output for identical logical inputs without `AvatarRenderer` needing to know which embed method called it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Shortcode `avatar` attribute key mismatch with AvatarRenderer's `avatar_url` key**
- **Found during:** Task 3 (writing the EMBED-04 parity case in `render-logic-harness.php`)
- **Issue:** The plan's Task 2 action describes `AvatarShortcode::render()` passing the raw `shortcode_atts()` output (keyed `avatar`) straight to `$this->renderer->render($atts)`. `AvatarRenderer::render()` (Task 1, written first) reads `avatar_url`, not `avatar` — so a shortcode instance with `avatar="123"` would silently never override the global avatar, since `wp_parse_args()` would just add an unused `avatar` key alongside the untouched `avatar_url` default. The EMBED-04 harness case caught this because the shortcode-shaped and block-shaped inputs produced different `avatarUrl` values.
- **Fix:** `AvatarShortcode::render()` now resolves the `avatar` attachment ID to a URL via `wp_get_attachment_url()` (mirroring `WpOptionsConfigSource`'s own attachment-ID→URL pattern) and passes the result to `AvatarRenderer::render()` under the `avatar_url` key the renderer actually merges on.
- **Files modified:** `wordpress-plugin/includes/Shortcode/AvatarShortcode.php`
- **Verification:** `render-logic-harness.php`'s EMBED-04 case now passes — shortcode-shaped (`avatar="123"` + a staged attachment-ID→URL fixture mapping) and block-shaped (`avatar_url="..."` directly) inputs with the same logical avatar produce `===`-identical public-safe config.
- **Committed in:** `9f5b6ea` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness — without this fix, every shortcode instance's avatar override would have been a silent no-op, directly breaking EMBED-02 for the avatar field. No scope creep; fix is scoped to the single mismatched key.

## Issues Encountered

None beyond the deviation above. The harness also needed `shortcode_atts()`, `add_shortcode()`, and `wp_get_attachment_url()` stubs not present in the existing `rest-logic-harness.php` (which never exercises shortcode-related WP functions) — added them following the same in-memory-stub style as the existing harnesses.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `AvatarRenderer`'s constructor-injected instance is fully wired in `Plugin::boot()` and held in a local `$renderer` variable explicitly kept available (per the plan's instruction) for plan 04 (Gutenberg block) to reuse via the same `AvatarBlock(renderer)` pattern `AvatarShortcode` already uses — no second `AvatarRenderer` should ever be constructed.
- `wordpress-plugin/build/khaveeai-bundle.js`/`.css` do not exist yet (the JS bundle itself is a separate plan in this phase) — `AssetManager::enqueue()` will currently enqueue a 404'ing script/style URL on a live WP install until the bundle build plan lands; this is expected and not a defect of this plan (PHP scaffolding intentionally precedes the JS bundle per the phase's plan sequencing).
- No blockers for plan 04.

---
*Phase: 08-frontend-bundle-shortcode-block*
*Completed: 2026-06-24*
