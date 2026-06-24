---
phase: 07-admin-settings-page
plan: 03
subsystem: wordpress-plugin/admin
tags: [php, wordpress, upload, security, magic-bytes, wp-media, asset-01]
requires:
  - "07-02 SettingsPage.php (marked avatar-field insertion point in register_settings())"
  - "07-01 ConfigSourceInterface avatar_attachment_id read-side resolution"
provides:
  - "Khavee\\Plugin\\Admin\\SettingsPage::render_avatar_field() — wp.media picker, current-avatar display (filename+date), Remove-avatar control"
  - "khaveeai_validate_glb_vrm_content() — magic-byte (ASCII 'glTF') content validator, fail-closed"
  - "khaveeai_allow_glb_vrm_mimes() — .glb/.vrm extension allowlist (model/gltf-binary, IANA-correct)"
  - "maybe_register_avatar_upload_filters() — admin_init + Referer-scoped filter registration (replaces the broken load-<hook_suffix> approach)"
  - "khaveeai_enforce_avatar_size() / limit_avatar_upload_size() — 50MB upload cap (D-10)"
  - "sanitize_avatar_attachment_id() — fail-safe int sanitize for the avatar_attachment_id field (T-07C-06)"
affects:
  - "Phase 8 frontend embed (reads avatar_url via ConfigSourceInterface::get_runtime_config(), now populated end-to-end through a real upload UI)"
tech-stack:
  added: []
  patterns:
    - "Magic-byte content validation independent of file extension/MIME (wp_check_filetype_and_ext filter, fail-closed on unreadable files)"
    - "admin_init + HTTP Referer scoping for filters that must apply to wp.media's AJAX upload paths (admin-ajax.php/async-upload.php) — load-<hook_suffix> does NOT fire on those paths, only on the page's own render dispatch inside admin.php"
    - "shutdown (not admin_footer) for filter cleanup that must also run on AJAX-only request lifecycles"
key-files:
  modified:
    - "wordpress-plugin/includes/Admin/SettingsPage.php"
    - "wordpress-plugin/tests/settings-page-harness.php"
decisions:
  - "D-09 implemented: .glb/.vrm only, both the upload_mimes extension allowlist AND the wp_check_filetype_and_ext magic-byte check required together — the allowlist alone would have left ASSET-01 open (a renamed disguised file would pass the extension check)"
  - "D-10 implemented: avatar upload is manage_options-gated (inherited from 07-02's render_page() gate + render_avatar_field()'s own re-check) and capped at 50MB via upload_size_limit, scoped to the same admin_init+Referer condition as the content-validation filters"
  - "D-11 implemented (07-02 carried the decision, this plan delivers it): current avatar shown as filename + upload date text only — no live 3D preview"
  - "D-06-style mirror: a dedicated 'Clear avatar' checkbox (remove_avatar) is the only way to set avatar_attachment_id to 0 — the field itself is never inferred as a deletion signal"
  - "RESOLVED — Open Question 2 / Assumption A2, REVISED from the plan's original hypothesis: the plan's <key_links> and <threat_model> assumed load-<hook_suffix> screen-scoping would cover wp.media's async-upload.php/admin-ajax.php AJAX path. Empirical verification (Task 3 human checkpoint, live wp-env install) proved this FALSE — load-<hook_suffix> never fires for either AJAX endpoint, only for admin.php's own page-render dispatch. The actual resolution is admin_init (which DOES fire on both AJAX endpoints) gated by an HTTP-Referer check against the settings page URL. See Deviations below."
metrics:
  duration: ~50 min (includes 2 rounds of live wp-env checkpoint testing, bug discovery, and fix)
  completed: 2026-06-24
  tasks_completed: 3
  files_modified: 2
  commits: 4
  test_cases_added: 13
  test_cases_total: 27
  deviations: 2
---

# Phase 7 Plan 03: Avatar Upload + Two-Filter VRM/GLB Validation Summary

Added the avatar upload field to `SettingsPage.php` at 07-02's marked insertion point: a `wp.media` picker button, current-avatar display (filename + upload date, no 3D preview per D-11), a dedicated Remove-avatar control, and the two-filter content validation (`upload_mimes` extension allowlist + `wp_check_filetype_and_ext` magic-byte check) that closes ASSET-01's disguised-file-upload threat. The plan's central open question — whether `wp.media`'s AJAX upload path actually receives the validation filters — was empirically tested against a live wp-env install during the Task 3 human checkpoint, which **failed** on the first attempt (every upload, valid or disguised, was rejected) and again on the avatar-picker button itself (no click response). Both root causes were diagnosed and fixed live before the checkpoint was approved.

## What Was Built

### Task 1 — RED harness cases (magic-byte check + avatar field sanitize/remove logic)
- Added cases for `khaveeai_validate_glb_vrm_content()`: valid glTF-magic `.glb`/`.vrm` accepted, non-glb/vrm extensions pass through untouched, malicious renamed file rejected (ASSET-01), unreadable file fails closed.
- Added cases for `khaveeai_allow_glb_vrm_mimes()`: preserves existing mimes, adds both extensions mapped to the IANA-correct `model/gltf-binary` (not the common but unregistered `model/glb-binary` typo).
- Added cases for `sanitize_avatar_attachment_id()` and `khaveeai_enforce_avatar_size()` (50MB boundary, D-10).
- The harness's `require` of `SettingsPage.php`'s avatar-handling code makes these cases RED until Task 2 lands.

### Task 2 — Avatar field + dual-path content-validation filters (GREEN)
- `render_avatar_field()`: a hidden `avatar_attachment_id` input, current-avatar display (`esc_html()`-escaped filename + date, or "No avatar configured."), the `wp.media`-driven "Choose/Upload Avatar" button, and the "Clear avatar" checkbox. Re-asserts `current_user_can('manage_options')` as the first statement (T-07C-04, upload-surface-specific defense-in-depth on top of `render_page()`'s page-level gate).
- `khaveeai_validate_glb_vrm_content()` (free function, registered as the `wp_check_filetype_and_ext` filter): reads the first 4 bytes of the uploaded file on disk, rejects (sets `ext`/`type` to `false`) unless they are the literal ASCII `glTF` — fails closed on an unreadable file.
- `khaveeai_allow_glb_vrm_mimes()` (free function, `upload_mimes` filter): adds `glb`/`vrm` → `model/gltf-binary`.
- `sanitize_avatar_attachment_id()`: `FILTER_VALIDATE_INT`-based sanitize; non-numeric garbage returns the existing value unchanged (T-07C-06); the dedicated `remove_avatar` checkbox is the only path to `0`.
- `limit_avatar_upload_size()` / `khaveeai_enforce_avatar_size()`: caps the upload at `MAX_AVATAR_BYTES` (52428800, 50MB, D-10) without lowering it below the host's existing `upload_max_filesize`.
- The two content-validation filters were ORIGINALLY registered via `add_action('load-' . $hook_suffix, ...)` per the plan's `<key_links>` (mirroring 07-RESEARCH.md Pattern 1's `load-<hook_suffix>` recommendation), removed via `admin_footer`.

### Task 3 — Human checkpoint: live wp-env verification (revealed and fixed 2 bugs)

The checkpoint was run against a live wp-env install (`http://localhost:8888/wp-admin`) with the plugin active. It did **not** pass cleanly on the first or second attempt — both failures are documented as deviations below, since they directly falsified assumptions the plan's `<threat_model>` and `<key_links>` had taken as given.

**Round 1 — "Choose/Upload Avatar" button did nothing on click.**
Diagnosed live: `wp_enqueue_media()` correctly enqueues `wp.media`'s JS bundle, but WordPress prints enqueued admin scripts in the **footer**, which renders *after* this field's inline `<script>` (printed mid-form, in the page body). The inline script's click-listener attachment ran while `wp.media` was still `undefined`, so the early-return guard silently no-op'd — no error, just nothing happening. Fixed by deferring listener attachment to `DOMContentLoaded` (with an already-fired fallback for the rare case scripts beat the parser).

**Round 2 — every avatar upload rejected, including valid `.glb` files.**
Diagnosed live by inspecting WordPress core source inside the wp-env container: `load-<hook_suffix>` is fired exclusively by `wp-admin/admin.php`'s own page-render dispatch (`do_action("load-{$page_hook}")`, where `$page_hook` is resolved from the `page` query var). `wp.media`'s "Upload files" tab does **not** submit through `admin.php?page=khaveeai-settings` — it POSTs directly to `wp-admin/async-upload.php` or `wp-admin/admin-ajax.php` (`action=upload-attachment`). Both of those scripts `require wp-admin/admin.php` and fire `admin_init`, but neither resolves a `page_hook` or fires `load-{$hook_suffix}` — confirmed by `grep`-ing the actual WP core source mounted into the wp-env container. The result: the content-validation filters were never registered for the real upload request, and WordPress's own default pre-check rejected `.glb`/`.vrm` outright (a generic "you are not allowed to upload this file type" message, not even reaching our custom rejection logic) — for every file, valid or disguised alike.

Fixed by replacing `load-<hook_suffix>` with `admin_init` (confirmed to fire on `admin-ajax.php` and `async-upload.php` via the same source inspection) gated by a new `is_khaveeai_upload_request()` check: true when the `page` query var is the settings slug (covers a direct page render) OR the request's `HTTP_REFERER` resolves to that page (covers the AJAX path — the browser always sends the settings page's URL as Referer when `wp.media`'s frame, instantiated from a script on that page, fires the upload POST). Filter removal moved from `admin_footer` (never fires on AJAX-only request lifecycles) to `shutdown` (fires on every request type). The unused `$settings_page_hook` field was removed; `register_avatar_upload_filters()` was renamed to `maybe_register_avatar_upload_filters()` to reflect its new conditional nature.

After both fixes, the user re-tested and approved the checkpoint.

## Verification Evidence

- `php -l` reports "No syntax errors detected" for `SettingsPage.php`.
- `php wordpress-plugin/tests/settings-page-harness.php` exits 0, "All cases PASSED." — 27/27 (14 from 07-01/07-02 + 13 new from this plan). The magic-byte validation logic itself (`khaveeai_validate_glb_vrm_content`) was never the bug — both rounds of failure were hook-timing/script-timing issues the bare-PHP harness structurally cannot exercise (it tests the pure validation function, not WordPress's actual request-routing lifecycle), exactly as 07-RESEARCH.md's Environment Availability section predicted.
- `php wordpress-plugin/tests/rest-logic-harness.php` (Phase 6 regression) exits 0, 11/11.
- `php wordpress-plugin/tests/token-provider-harness.php` (Phase 6 regression) exits 0, 4/4.
- Live wp-env verification (user-approved): avatar picker opens; a real `.glb`/`.vrm` upload succeeds and persists across reload (filename + date display); the disguised `.glb` test fixture (`<?php evil-disguised-as-glb` renamed to `.glb`) is rejected; Remove-avatar clears the stored attachment and resolves `avatar_url` to `''`; non-admin direct navigation to the settings page is denied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Blocking, found via live checkpoint] Avatar picker click listener bound before `wp.media`'s footer-printed script loaded**
- **Found during:** Task 3 human checkpoint, round 1 (live wp-env, user reported "clicked Choose/Upload Avatar then nothing happened")
- **Issue:** The inline `<script>` in `render_avatar_field()` attached its click listener synchronously at parse time, but `wp_enqueue_media()`'s JS bundle prints in the admin footer — after this field's script in document order. The guard (`if (!wp || !wp.media) return;`) silently no-op'd with no visible error.
- **Fix:** Wrapped initialization in a `DOMContentLoaded` listener (with an already-fired fallback).
- **Files modified:** `wordpress-plugin/includes/Admin/SettingsPage.php`
- **Commit:** `ca3583f`

**2. [Rule 3 - Blocking, found via live checkpoint] `load-<hook_suffix>` never fires for `wp.media`'s actual upload AJAX request**
- **Found during:** Task 3 human checkpoint, round 2 (live wp-env, user reported every upload — valid and disguised — rejected with WordPress's generic "not allowed" message)
- **Issue:** This is the plan's own central open question (Open Question 2 / Assumption A2) resolving in the OPPOSITE direction from what `<key_links>` and `<threat_model>` (T-07C-01/T-07C-02/T-07C-03) assumed. The plan explicitly flagged this as needing live verification ("the SINGLE HIGHEST-RISK threat in the entire phase... do NOT mark the plan complete without it") — the verification ran, and falsified the `load-<hook_suffix>` hypothesis. Confirmed via direct inspection of WP core source (`wp-admin/admin.php`, `wp-admin/async-upload.php`, `wp-admin/admin-ajax.php`) inside the running wp-env container: `load-{$page_hook}` fires only from `admin.php`'s page-render dispatch; `async-upload.php`/`admin-ajax.php` bypass that dispatch entirely while still firing `admin_init`.
- **Fix:** Replaced `load-<hook_suffix>` registration with `admin_init` gated by `is_khaveeai_upload_request()` (page query var OR HTTP Referer match). Filter cleanup moved from `admin_footer` to `shutdown` for the same AJAX-coverage reason. Removed the now-dead `$settings_page_hook` field; renamed `register_avatar_upload_filters()` → `maybe_register_avatar_upload_filters()`.
- **Files modified:** `wordpress-plugin/includes/Admin/SettingsPage.php`
- **Commit:** `44c7bbe`
- **Rationale:** This is squarely the scenario the plan's checkpoint existed to catch (Rule 3 — the bare-PHP harness cannot exercise WordPress's request-routing lifecycle; this gap was structural, not a coding mistake in the magic-byte logic itself, which remained correct throughout). The fix does not touch `khaveeai_validate_glb_vrm_content()` or `khaveeai_allow_glb_vrm_mimes()` — only the hook that decides *when* those filters are active.

No other deviations. The magic-byte validation logic, the 50MB cap, the attachment-ID sanitize, and the Remove-avatar control all worked as designed on the first pass.

## Known Stubs

None. Both fixes are production-correct implementations, not workarounds:
- The `DOMContentLoaded` deferral is the standard fix for script-load-order races, not a polling/retry hack.
- `admin_init` + Referer scoping is a documented WordPress pattern for filters that must apply to both page renders and AJAX requests originating from that page — not a narrower or weaker substitute for the original screen-scoping intent.

## TDD Gate Compliance

Task 1 (`tdd="true"`) precedes Task 2's GREEN commit (`191d362`) — RED commit `49d7603` made the new magic-byte/sanitize/size cases fail (via the `require` of not-yet-existing avatar-handling code) before Task 2 turned them GREEN. The two checkpoint-discovered fixes (`ca3583f`, `44c7bbe`) are post-GREEN corrections to the GREEN implementation, made in response to live human verification — not part of the original RED→GREEN cycle, consistent with how `<task type="checkpoint:human-verify">` results feed back into the plan's implementation tasks per the checkpoint protocol.

## Security Notes

- **T-07C-01 (Tampering — disguised-file upload via wp.media Upload tab):** Mitigated, and the mitigation mechanism was corrected during this plan's own checkpoint. `khaveeai_validate_glb_vrm_content()`'s magic-byte check is unchanged and was never the issue; the hook that activates it during the actual AJAX upload (`admin_init` + Referer, not `load-<hook_suffix>`) was the fix. Live-verified: a disguised `.glb` (`<?php evil-disguised-as-glb` content) was rejected through the real wp.media Upload tab.
- **T-07C-02 (Tampering — disguised-file upload via the second AJAX path):** Mitigated by the same corrected `admin_init`+Referer registration, which covers both `async-upload.php` and `admin-ajax.php`.
- **T-07C-03 (Elevation of Privilege — filters left registered globally):** Mitigated. `is_khaveeai_upload_request()` only returns true for requests targeting or refererred-from the khaveeai settings page; `remove_avatar_upload_filters()` runs on `shutdown` of every request, so the filters never persist across requests. Live-verified: the standard Media Library "Add New" screen still rejects `.glb`.
- **T-07C-04 (Elevation of Privilege — non-admin reaching the upload flow):** Mitigated, inherited from 07-02's page-level gate plus `render_avatar_field()`'s own `current_user_can('manage_options')` re-check. Live-verified: non-admin direct navigation denied.
- **T-07C-05 (DoS — oversized upload):** Mitigated via `upload_size_limit` capped at 52428800 bytes (50MB), scoped identically to the content-validation filters. Harness proves the boundary (exactly 50MB accepted, one byte over rejected).
- **T-07C-06 (Tampering — malicious avatar_attachment_id):** Mitigated via `FILTER_VALIDATE_INT`-based sanitize; non-numeric input returns the existing value unchanged.
- **T-07C-07 (Stored XSS — avatar filename echoed):** Mitigated; all output passes through `esc_html()`.
- **T-07C-08 (Information Disclosure — avatar URL):** Accepted per plan — `wp_get_attachment_url()`'s public URL is the intended public-facing address Phase 8 needs.

## Self-Check: PASSED

- [x] `wordpress-plugin/includes/Admin/SettingsPage.php` exists, passes `php -l`, contains the avatar field, both content-validation filter functions, and the corrected `admin_init`+Referer scoping
- [x] `grep -c 'glTF'` returns ≥2 (valid-magic literal + assertion usage)
- [x] `php wordpress-plugin/tests/settings-page-harness.php` exits 0 — 27/27 cases (14 prior + 13 new)
- [x] `php wordpress-plugin/tests/rest-logic-harness.php` exits 0 — 11/11 (Phase 6 regression)
- [x] `php wordpress-plugin/tests/token-provider-harness.php` exits 0 — 4/4 (Phase 6 regression)
- [x] Live wp-env checkpoint approved by the user after both discovered bugs were fixed: avatar picker opens, valid upload persists, disguised upload rejected, Remove-avatar clears the stored attachment, non-admin denied
- [x] Commit `49d7603` exists (Task 1 — RED harness cases)
- [x] Commit `191d362` exists (Task 2 — avatar field + filters, GREEN)
- [x] Commit `ca3583f` exists (checkpoint fix 1 — DOMContentLoaded deferral)
- [x] Commit `44c7bbe` exists (checkpoint fix 2 — admin_init+Referer scoping)
