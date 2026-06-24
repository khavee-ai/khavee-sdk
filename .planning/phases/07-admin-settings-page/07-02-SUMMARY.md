---
phase: 07-admin-settings-page
plan: 02
subsystem: wordpress-plugin/admin
tags: [php, wordpress, admin, settings-api, capability-gate, security]
requires:
  - "07-01 ConfigSourceInterface::is_configured()"
  - "07-01 settings-page-harness.php (Cases 1-6)"
  - "Phase 6 ConfigSourceInterface (get_api_key, get_runtime_config)"
  - "Phase 6 Plugin.php composition root + SessionController wiring pattern"
provides:
  - "Khavee\\Plugin\\Admin\\SettingsPage — top-level wp-admin menu, register_setting/add_settings_field form, defense-in-depth manage_options gate, masked-key sanitize, is_configured() banner"
  - "Marked avatar-field insertion point in SettingsPage::register_settings() for 07-03"
  - "SettingsPage wired into Plugin::boot() via the shared $config_source instance"
affects:
  - "07-03 avatar upload (inserts add_settings_field call at the marked comment, reuses the same capability gate, extends settings-page-harness.php further)"
  - "Phase 8 frontend embed (is_configured() contract already proven by both this page's banner and 07-01's harness)"
tech-stack:
  added: []
  patterns:
    - "Defense-in-depth capability gate: manage_options arg at add_menu_page() registration AND an independent current_user_can() re-check as the FIRST statement of render_page() (Pitfall 3)"
    - "Resave-safe masked-field sanitize_callback: compare submitted value against mask_api_key(existing) to detect 'untouched' resubmission vs a genuine new value vs a dedicated removal flag"
    - "Pure-function testability via parameterized instance methods (sanitize_api_key takes $existing/$remove_requested as args rather than resolving internally) — mirrors OpenAiDirectTokenProvider::mint_session's $api_key-parameter pattern"
key-files:
  created:
    - "wordpress-plugin/includes/Admin/SettingsPage.php"
  modified:
    - "wordpress-plugin/includes/Plugin.php"
    - "wordpress-plugin/tests/settings-page-harness.php"
decisions:
  - "D-05/D-07 implemented: mask_api_key() is a static public method (sk-••••••<last4>) so the harness exercises it without constructing a ConfigSourceInterface; the field's value attribute is always mask_api_key()'s output, never the raw key"
  - "D-06 implemented: a separate 'Remove key' checkbox (remove_key) is the only deletion signal; an emptied key field alone is explicitly NOT treated as deletion (sanitize_api_key returns existing unchanged in that case)"
  - "D-08 implemented: a genuinely new value that is empty-after-trim or lacks the sk- prefix is rejected via add_settings_error and the existing key is preserved — no overwrite with an invalid value"
  - "D-02 implemented: top-level wp-admin menu item 'Khavee AI Avatar', not a Settings submenu"
  - "D-03 honored: no model field rendered or written by this page — model stays at WpOptionsConfigSource::DEFAULT_MODEL"
  - "D-04 implemented: voice is a plain <select> over the hardcoded 10-value OpenAI voice enum, no live fetch, no preview/playback"
  - "D-14 implemented: render_page() emits a 'not configured' admin notice keyed off $config_source->is_configured()"
  - "Avatar field deliberately NOT added — a comment marker '// Avatar field added by 07-03 (SET-04/ASSET-01).' is the single insertion point register_settings() reserves for the next plan"
metrics:
  duration: ~35 min (includes mid-execution provider quota interruption and resumption)
  completed: 2026-06-24
  tasks_completed: 3
  files_created: 1
  files_modified: 2
  commits: 3
  test_cases_added: 7
  test_cases_total: 14
  deviations: 1
---

# Phase 7 Plan 02: Admin Settings Page Summary

Built `Khavee\Plugin\Admin\SettingsPage` — the top-level "Khavee AI Avatar" wp-admin menu page rendering a plain WP Settings API form (API key masked, personality textarea, voice dropdown, avatar slot reserved for 07-03), with a two-layer `manage_options` capability gate, a resave-safe masked-key sanitize callback with a dedicated Remove-key control, and the `is_configured()` "not configured" banner. Wired into `Plugin::boot()` sharing the same `$config_source` instance Phase 6's `SessionController` already uses.

## What Was Built

### Task 1 — RED harness cases for `mask_api_key` + `sanitize_api_key`
- Appended 7 `run_case()` entries (Cases 7-13) to `settings-page-harness.php` covering: `mask_api_key` format (D-07) and empty-input behavior; `sanitize_api_key` placeholder-preservation (D-05), fresh-key trim, format-rejection with a recorded settings error (D-08), empty-is-not-delete (D-06), and deliberate-remove via the flag (D-06).
- Added `function_exists()`-guarded stubs for `add_settings_error()` (records calls into `$GLOBALS['__khaveeai_settings_errors']`) and `__()` (passthrough), matching the harness's existing "stub only what the logic under test actually calls" convention.
- Added `__KhaveeaiHarnessStubConfig` (a minimal `ConfigSourceInterface` fixture) so the harness can construct a `SettingsPage` instance — `sanitize_api_key` takes `$existing`/`$remove_requested` as parameters, so the stub's own data is never read by these cases.
- The `require __DIR__ . '/../includes/Admin/SettingsPage.php'` line makes the harness fatal (RED) until Task 2 creates the class — the intended TDD ordering, documented inline.

### Task 2 — `SettingsPage.php` (menu, capability gate, fields, masked-key logic, banner)
- `final class SettingsPage` in namespace `Khavee\Plugin\Admin`, constructor-injected with `ConfigSourceInterface` (never constructs a concrete `WpOptionsConfigSource`).
- `register_hooks()` → `add_action('admin_menu', ...)` + `add_action('admin_init', ...)`.
- `add_menu_page()` registers the top-level menu (D-02) with `'manage_options'` as the capability arg — layer 1 of the SET-05 gate.
- `register_settings()` calls `register_setting()` with `sanitize_settings` as the callback, then `add_settings_section()` + four `add_settings_field()` calls (api_key, remove_key, instructions, voice). A comment marker (`// Avatar field added by 07-03 (SET-04/ASSET-01).`) reserves 07-03's insertion point.
- `sanitize_settings(array $input): array` orchestrates per-field sanitization: reads the existing option array (preserving any keys this page doesn't own, e.g. a future `avatar_attachment_id`), resolves the existing key via the injected `ConfigSourceInterface`, delegates to `sanitize_api_key()`, and applies `sanitize_textarea_field()`/`sanitize_text_field()` to instructions/voice. Never calls `update_option()` directly — the sanitize callback's return value is what WordPress persists.
- `mask_api_key(string $key): string` (static) — `''` for empty input, otherwise `'sk-••••••' . substr($key, -4)`.
- `sanitize_api_key($submitted, string $existing, bool $remove_requested = false): string` — decision order: (1) `$remove_requested` → `''` (D-06); (2) submitted equals `mask_api_key($existing)` → return `$existing` unchanged (D-05); (3) trimmed value is empty or lacks `sk-` prefix → `add_settings_error()` + return `$existing` (D-08); (4) otherwise return the trimmed new value.
- `render_page()` — **first statement** is `current_user_can('manage_options')` else `wp_die()` (SET-05 layer 2, Pitfall 3: the menu arg only hides the link, it does not block direct URL navigation). Then the D-14 `is_configured()` banner, `settings_errors()`, `wp_enqueue_media()` (loads wp.media JS ahead of 07-03's picker), and the Settings API form (`settings_fields` + `do_settings_sections` + `submit_button`).
- Field renderers (`render_api_key_field`, `render_remove_key_field`, `render_instructions_field`, `render_voice_field`) all escape output (`esc_attr`, `esc_html__`, `esc_textarea`) and the API key field's `value` attribute is always `mask_api_key()`'s output — never the raw key.

### Task 3 — Wire into `Plugin::boot()`
- Added `use Khavee\Plugin\Admin\SettingsPage;` import.
- After the existing `SessionController` wiring, constructs `new SettingsPage($config_source)` reusing the **same** `$config_source` instance (never a second `WpOptionsConfigSource`) and calls `register_hooks()`.
- Updated the class docblock to mention `SettingsPage` while preserving the "No DI container, no filter-hook-driven strategy selection" sentence verbatim.

## Verification Evidence

- `php -l` reports "No syntax errors detected" for `SettingsPage.php` and `Plugin.php`.
- `php wordpress-plugin/tests/settings-page-harness.php` exits 0, "All cases PASSED." — 14/14 (7 from 07-01 + 7 new from this plan).
- `php wordpress-plugin/tests/rest-logic-harness.php` (Phase 6 regression) exits 0, 11/11.
- `php wordpress-plugin/tests/token-provider-harness.php` (Phase 6 regression) exits 0, 4/4.
- Acceptance-criteria greps all pass: `current_user_can( 'manage_options' )` appears ≥2 times in `SettingsPage.php` (menu arg + render-callback re-check); `is_configured()` appears ≥1 time; the literal `sk-••••••` mask format appears ≥1 time; `'avatar_attachment_id'` appears 0 times (07-03 owns it); no `value="..."` attribute interpolates the raw key — only `mask_api_key()`'s output.
- `Plugin.php`: exactly one `new WpOptionsConfigSource` construction (shared, not duplicated); `new SettingsPage( $config_source )` present; `register_hooks` invoked; "No DI container" docblock sentence preserved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Minor] Missing `ConfigSourceInterface` use-import in `settings-page-harness.php`**
- **Found during:** Task 1 (resumed execution)
- **Issue:** The new `__KhaveeaiHarnessStubConfig implements ConfigSourceInterface` fixture referenced the interface by its short name but the harness file only had `use Khavee\Plugin\ConfigSource\WpOptionsConfigSource;` — no import for `ConfigSourceInterface` itself, even though the interface file is `require`d directly by path.
- **Fix:** Added `use Khavee\Plugin\ConfigSource\ConfigSourceInterface;` alongside the existing `WpOptionsConfigSource` import.
- **Files modified:** `wordpress-plugin/tests/settings-page-harness.php`
- **Rationale:** A one-line additive import fix with no behavioral change to any existing case; required for the new fixture class to resolve the interface name.

### Process note (non-deviation, documented for continuity)

This plan's execution was interrupted partway through Task 1 by a provider-side usage-limit (5-hour quota) rejection from the original subagent dispatch. The orchestrator resumed execution directly against the same worktree: verified the partially-completed Task 1 RED commit (`0a738a8`) and the uncommitted Task 2 draft of `SettingsPage.php` were both correct and harness-passing, applied the one missing import fix above, then completed Task 3 (Plugin.php wiring) and this SUMMARY. No work was discarded or redone; all three tasks' acceptance criteria were independently re-verified before commit.

## Known Stubs

None. This plan adds no stub patterns:
- `mask_api_key()`/`sanitize_api_key()` implement real masking/sanitize logic, not placeholders.
- `render_page()` renders a real, functional Settings API form (minus the avatar field, which is explicitly out of scope — owned by 07-03, not a stub).
- No TODOs, no "coming soon" text.

## TDD Gate Compliance

Task 1 and Task 2 are `tdd="true"` per the plan frontmatter. RED commit `0a738a8` (`test(07-02): ...`) precedes the GREEN commit `c93cc1b` (`feat(07-02): create SettingsPage ...`) — the harness's 7 new cases were demonstrably RED (require-fatal on a non-existent `SettingsPage.php`) before Task 2 created the class and turned them GREEN. Task 3 has no `tdd` attribute (pure wiring, no new test cases) and was executed as a conventional implement→verify→commit step.

## Security Notes

- **T-07B-01 (Elevation of Privilege — direct URL navigation):** Mitigated. `render_page()`'s first statement is an independent `current_user_can('manage_options')` check, separate from `add_menu_page()`'s capability arg (Pitfall 3).
- **T-07B-02 (CSRF — settings form POST):** Mitigated. Uses `register_setting()` + `settings_fields(OPTION_GROUP)` — WP core's `options.php` handler verifies the nonce automatically; no hand-rolled POST handling.
- **T-07B-03 (Information Disclosure — API key in HTML):** Mitigated. The key field's `value` attribute is always `mask_api_key()`'s output; verified by acceptance-criteria grep (no raw-key interpolation in any `value=` attribute).
- **T-07B-04 (Tampering — masked placeholder overwrites stored key):** Mitigated. `sanitize_api_key` compares submitted vs `mask_api_key(existing)`; equal → returns existing. Harness Case 9 proves this.
- **T-07B-05 (Tampering — empty field interpreted as delete):** Mitigated. D-06's dedicated `remove_key` checkbox is the only deletion signal; an emptied-but-not-masked field returns existing unchanged. Harness Case 12 proves this.
- **T-07B-06 (Spoofing/Tampering — malformed key format):** Mitigated. Non-`sk-`-prefixed or empty-after-trim new values are rejected via `add_settings_error()`, existing key preserved. Harness Case 11 proves both the return value and the settings-error side effect.
- **T-07B-07 (Stored XSS — instructions textarea):** Mitigated. `sanitize_textarea_field()` on save, `esc_textarea()` on output; voice field uses `sanitize_text_field()` + `esc_attr()`.
- **T-07B-SC (package installs):** Accepted — no packages installed.

No new threat surface beyond what the plan's `<threat_model>` registers.

## Self-Check: PASSED

- [x] `wordpress-plugin/includes/Admin/SettingsPage.php` exists, passes `php -l`, declares `namespace Khavee\Plugin\Admin` (1 occurrence)
- [x] `current_user_can( 'manage_options' )` appears ≥2 times in `SettingsPage.php`
- [x] `is_configured()` appears ≥1 time in `SettingsPage.php` (D-14 banner)
- [x] `sk-••••••` literal appears ≥1 time (D-07 mask format)
- [x] `'avatar_attachment_id'` appears 0 times (07-03 owns the avatar field)
- [x] No raw API key interpolated into any HTML `value=` attribute
- [x] `wordpress-plugin/includes/Plugin.php` passes `php -l`; exactly one `new WpOptionsConfigSource`; `new SettingsPage( $config_source )` present; `register_hooks` invoked; "No DI container" sentence preserved
- [x] `php wordpress-plugin/tests/settings-page-harness.php` exits 0 — 14/14 cases (7 from 07-01 + 7 new)
- [x] `php wordpress-plugin/tests/rest-logic-harness.php` exits 0 — 11/11 (Phase 6 regression)
- [x] `php wordpress-plugin/tests/token-provider-harness.php` exits 0 — 4/4 (Phase 6 regression)
- [x] Commit `0a738a8` exists (Task 1 — RED harness cases)
- [x] Commit `c93cc1b` exists (Task 2 — SettingsPage.php, GREEN)
- [x] Commit `f16157a` exists (Task 3 — Plugin.php wiring)
