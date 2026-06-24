---
phase: 07
slug: admin-settings-page
status: audited
threats_open: 0
asvs_level: 1
created: 2026-06-24
---

# Phase 7 — Admin Settings Page: Security Audit

**Audited:** 2026-06-24
**Auditor:** Claude (gsd-security-auditor)
**ASVS Level:** 1
**Block on:** critical (open threats)
**Scope:** Threat models declared in 07-01-PLAN.md, 07-02-PLAN.md, 07-03-PLAN.md, 07-04-PLAN.md `<threat_model>` blocks (21 threats total)

## Method

Every threat below was verified by reading the cited implementation files directly (not by trusting SUMMARY.md/REVIEW.md/VERIFICATION.md prose) and, where the disposition is `mitigate`, by grepping for the actual code construct in the file at the cited location. The bare-PHP test harness (`wordpress-plugin/tests/settings-page-harness.php`) and the two Phase 6 regression harnesses were independently re-executed by this auditor — not taken on faith from any prior report.

```
$ php -l wordpress-plugin/includes/Admin/SettingsPage.php
$ php -l wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php
$ php -l wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php
$ php -l wordpress-plugin/includes/Plugin.php
No syntax errors detected (x4)

$ php wordpress-plugin/tests/settings-page-harness.php
35/35 PASS, exit 0

$ php wordpress-plugin/tests/rest-logic-harness.php
exit 0 (Phase 6 regression intact)

$ php wordpress-plugin/tests/token-provider-harness.php
exit 0 (Phase 6 regression intact)
```

## Threat Register Verification

### 07-01 (ConfigSource contract)

| Threat ID | Category | Disposition | Verification | Result |
|-----------|----------|-------------|---------------|--------|
| T-07A-01 | Information Disclosure | mitigate | `WpOptionsConfigSource::is_configured()` (line 102-104) returns only `'' !== $this->get_api_key()` — a bool, never the key. `get_runtime_config()` (line 58-78) array literal contains no `api_key` key. | CLOSED |
| T-07A-02 | Tampering | mitigate | `get_runtime_config()` line 68-70: `(int) $settings['avatar_attachment_id']` cast, gated `$attachment_id > 0` before calling `wp_get_attachment_url()`, then `is_string($avatar_url) ? $avatar_url : ''` coerces a `false` return. Harness case "coerces a false wp_get_attachment_url() return to empty string" PASSES (re-run). | CLOSED |
| T-07A-03 | Tampering | accept | `get_runtime_config()` line 61-63: `if ( ! is_array( $settings ) ) { $settings = []; }` — pre-existing guard, unchanged. Accepted-risk entry recorded here. | CLOSED (accepted) |
| T-07A-SC | Supply chain | accept | No new dependencies added in this plan (verified: no package.json/composer.json diff in 07-01). Accepted-risk entry recorded here. | CLOSED (accepted) |

### 07-02 (Settings page core)

| Threat ID | Category | Disposition | Verification | Result |
|-----------|----------|-------------|---------------|--------|
| T-07B-01 | Elevation of Privilege | mitigate | `render_page()` line 691-694: `if ( ! current_user_can( 'manage_options' ) ) { wp_die(...); }` is the literal first statement, independent of `add_menu_page()`'s capability arg (line 250). | CLOSED |
| T-07B-02 | CSRF | mitigate | `register_settings()` line 417-421 calls `register_setting()`; `render_page()` line 711 calls `settings_fields( self::OPTION_GROUP )`. Form posts to `options.php` (line 710). Standard WP-core nonce verification path, not hand-rolled. | CLOSED |
| T-07B-03 | Information Disclosure | mitigate | `render_api_key_field()` line 738-745: `value` attribute is `esc_attr( $masked )` where `$masked = self::mask_api_key( $existing )` — never the raw key. `grep -nE 'value="[^"]*\$.*api_key'` returns no matches. | CLOSED |
| T-07B-04 | Tampering | mitigate | `sanitize_api_key()` line 661-663: `if ( $submitted === $masked ) { return $existing; }`. Harness case "submitted value === mask(existing) returns existing unchanged" PASSES (re-run). | CLOSED |
| T-07B-05 | Tampering | mitigate | `sanitize_api_key()` line 666-673: empty/non-`sk-` value falls to `add_settings_error()` + `return $existing`; deletion only via `$remove_requested` (line 653-655), set only from the dedicated `remove_key` checkbox (`sanitize_settings()` line 505). Harness case "an emptied field is NOT a deletion signal" PASSES. | CLOSED |
| T-07B-06 | Spoofing/Tampering | mitigate | `sanitize_api_key()` line 666: `'' === $submitted \|\| 0 !== strpos( $submitted, 'sk-' )` rejects and returns existing. Harness case "a non-sk- value returns existing AND registers a settings error" PASSES. | CLOSED |
| T-07B-07 | Stored XSS | mitigate | `sanitize_settings()` line 516: `sanitize_textarea_field( $submitted_instr )`. `render_instructions_field()` line 780: `esc_textarea( $value )`. | CLOSED |
| T-07B-SC | Supply chain | accept | No package installs in 07-02. | CLOSED (accepted) |

### 07-03 (Avatar upload)

| Threat ID | Category | Disposition | Verification | Result |
|-----------|----------|-------------|---------------|--------|
| T-07C-01 | Tampering (disguised upload, wp.media path) | mitigate | `khaveeai_validate_glb_vrm_content()` (line 87-116) reads first 4 bytes via `fopen`/`fread`, compares to literal `"glTF"` (line 105), sets `ext`/`type` to `false` on mismatch or unreadable file. Registered via `admin_init` + `is_khaveeai_upload_request()` (line 293-303), **not** `load-<hook_suffix>` (confirmed empirically falsified per 07-03-SUMMARY.md Deviation 2, and confirmed absent in current code — see T-07D-03 below). Harness cases "MALICIOUS renamed file" and "UNREADABLE file" both PASS (re-run). | CLOSED |
| T-07C-02 | Tampering (disguised upload, options.php path) | mitigate | Same filter (`wp_check_filetype_and_ext`) registered identically for both AJAX entry points since `admin_init` fires on `async-upload.php`/`admin-ajax.php` and on direct page loads alike (line 293-303). | CLOSED |
| T-07C-03 | Elevation of Privilege (filters left globally registered) | mitigate | `maybe_register_avatar_upload_filters()` gates registration on `is_khaveeai_upload_request()` (line 294-296); `remove_avatar_upload_filters()` (line 392-396) is hooked to `shutdown` (line 302), not `admin_footer` (which does not fire on AJAX-only lifecycles) — this is the corrected mechanism. | CLOSED |
| T-07C-04 | Elevation of Privilege (non-admin reaching upload) | mitigate | `render_page()` capability gate (inherited) + `render_avatar_field()` line 826-828: independent `current_user_can( 'manage_options' )` re-check, returns early if false. | CLOSED |
| T-07C-05 | Denial of Service (huge upload) | mitigate | `limit_avatar_upload_size()` (line 406-408): `min( (int) $bytes, self::MAX_AVATAR_BYTES )` where `MAX_AVATAR_BYTES = 52428800` (line 175). Registered as `upload_size_limit` filter (line 300). Harness boundary cases (exactly 50MB / over / under) PASS. | CLOSED |
| T-07C-06 | Tampering (garbage attachment ID) | mitigate | `sanitize_avatar_attachment_id()` (line 592-609): `filter_var( $submitted, FILTER_VALIDATE_INT )`; non-numeric input returns `$existing` unchanged (line 599-602). Harness case "non-numeric garbage returns existing unchanged" PASSES. | CLOSED |
| T-07C-07 | Stored XSS (avatar filename) | mitigate | `render_avatar_field()` line 855-856: `esc_html( $filename )`, `esc_html( $upload_date )`. Hidden input value also `esc_attr()`'d (line 846-848). | CLOSED |
| T-07C-08 | Information Disclosure (avatar URL) | accept (low) | `wp_get_attachment_url()` returns the intended public uploads URL by design — accepted-risk entry recorded here. | CLOSED (accepted) |
| T-07C-SC | Supply chain | accept | No package installs in 07-03. | CLOSED (accepted) |

### 07-04 (Gap closure — CR-01/CR-02)

| Threat ID | Category | Disposition | Verification | Result |
|-----------|----------|-------------|---------------|--------|
| T-07D-01 | Tampering / Input Validation Bypass (voice field, CR-01 + CR-01-NEW) | mitigate | **Both halves verified present together** in `sanitize_settings()`: (a) original allowlist check on the submission, line 538-540: `in_array( $submitted_voice, self::VOICES, true ) ? sanitize_text_field(...) : $existing_voice`; (b) CR-01-NEW fix re-validating the fallback/existing value BEFORE use as a fallback, line 534-536: `$existing_voice = isset(...) && in_array( $existing_option['voice'], self::VOICES, true ) ? $existing_option['voice'] : self::VOICES[0];`. A partial fix (only one of the two) would NOT have been accepted — both are present. Harness cases "valid voice persists", "out-of-allowlist voice rejected, prior voice preserved", "out-of-allowlist with no prior falls back to alloy", AND "already-poisoned existing voice ... normalized to self::VOICES[0], never re-persisted (CR-01-NEW)" all PASS (re-run directly, 4 cases total covering this threat). | CLOSED |
| T-07D-02 | Elevation of Privilege/Spoofing (upload-filter activation gate, CR-02) | mitigate | `is_upload_request_allowed( bool $page_or_referer_match, $nonce ): bool` (line 370-380) is a pure AND-gate: returns `false` if `! $page_or_referer_match`; returns `false` if `$nonce` is not a non-empty string; otherwise `(bool) wp_verify_nonce( $nonce, self::AVATAR_UPLOAD_NONCE_ACTION )`. `is_khaveeai_upload_request()` (line 331-349) computes the page/Referer condition and reads `$_REQUEST[self::AVATAR_UPLOAD_NONCE_FIELD]`, delegating to the pure predicate — fail-closed on every missing/invalid branch. Nonce is issued server-side via `wp_create_nonce( self::AVATAR_UPLOAD_NONCE_ACTION )` (line 895) and attached to the wp.media uploader params (line 911-921). 4 harness cases (valid→true, missing→false, invalid→false, no-match→false) all PASS (re-run). | CLOSED |
| T-07D-03 | Tampering (regression: reintroducing falsified `load-<hook_suffix>`) | mitigate | `grep -n "add_action.*'load-" wordpress-plugin/includes/Admin/SettingsPage.php` returns **zero matches** (independently re-run by this auditor). All 12 raw "load-" hits in the file are explanatory prose/comments describing why the mechanism was abandoned (lines 26, 178, 260, 263, 266, 269, 271, 308, 325, 352, 819, 826 region) — none is an actual filter/action registration. `grep -c "admin_init"` returns 8 — the shipped, live-verified mechanism is intact and is the one actually registering the hooks (`register_hooks()` line 230-234, `maybe_register_avatar_upload_filters()` hooked at line 233). | CLOSED |
| T-07D-SC | Supply chain | accept | No package installs — only `wp_verify_nonce`/`wp_create_nonce`/`in_array` (WP core + PHP builtins). Accepted-risk entry recorded here. | CLOSED (accepted) |

## Accepted Risks Log

The following threats are formally accepted (disposition `accept` in the source plans) and are logged here as the canonical accepted-risk record this audit's `accept` verification step checks against:

1. **T-07A-03** — A corrupted (non-array) `wp_options['khaveeai_settings']` value is normalized to `[]` by a pre-existing guard. No new attacker path is introduced by Phase 7. Accepted because the guard already existed pre-Phase-7 and Phase 7 does not weaken it.
2. **T-07A-SC, T-07B-SC, T-07C-SC, T-07D-SC** — No npm/pip/cargo/composer package installs occurred in any of the four Phase 7 plans. Only WordPress-core functions and PHP built-ins were used. No package legitimacy audit is required because there is no new supply-chain surface.
3. **T-07C-08** — `wp_get_attachment_url()` returns the Media Library's public-facing uploads URL for the avatar attachment by design; this is the intended, non-secret address Phase 8's frontend embed needs to render the avatar. Accepted as low-severity information disclosure (the URL only identifies a public asset, not a secret).

## Unregistered Flags (Informational — Not Blockers)

No SUMMARY.md in this phase contains a `## Threat Flags` section, so there is no executor-declared new-attack-surface list to cross-reference. However, this audit independently surfaces one item that the code review (07-REVIEW.md, WR-01) found and that has **no corresponding threat-register ID**:

- **WR-01 — wp.media `frame.uploader` nonce-attachment timing race (browser-only, untested by any harness or live checkpoint specific to this code path).** `render_avatar_field()`'s inline JS (line 915-922) attaches the CR-02 nonce to `frame.uploader` inside a `frame.on('ready', ...)` callback, but `frame.uploader` is not guaranteed to exist yet when `'ready'` fires in all wp.media internal-API versions. If it doesn't exist at that moment, the code silently no-ops (no error, no retry) and the nonce never reaches the upload POST — `is_khaveeai_upload_request()` would then correctly fail closed (per CR-02's design), but the practical effect is every real avatar upload via the picker silently rejected with WordPress's generic "not allowed" message. This is a **WARNING**, not a BLOCKER: (a) it degrades availability/UX, not confidentiality/integrity — the fail-closed behavior means no malicious upload can sneak through even if this race manifests; (b) it was already flagged by the code review and explicitly scoped as "browser-only, not gated on a fresh live check" before 07-04 shipped; (c) no Phase 7 declared threat ID maps to this specific JS-timing concern — it is new attack-surface-adjacent risk that emerged from the CR-02 implementation itself, not something the original threat model anticipated, and there is no test/checkpoint evidence either closing or reproducing it for this specific code path since 07-03's live checkpoint (which validated the magic-byte rejection, not the nonce-attachment JS timing).
  - **Recommendation:** Run a live wp-env smoke test of an actual file upload through the picker (not just the bare-PHP magic-byte assertion) to confirm `$_REQUEST[khaveeai_avatar_nonce]` is actually populated in practice, before or shortly after Phase 8 begins consuming this contract.
  - **Disposition:** Not a blocker under `block_on: critical` — no declared threat is open; this is new information surfaced during audit, logged per the adversarial-stance requirement to surface every unverified mitigation, even ones outside the formal register.

## Summary

All 21 threats across the four Phase 7 plans resolve to **CLOSED** — 17 via `mitigate` (code-verified directly, not taken from documentation) and 4 via `accept` (risk entries now formally logged in this file). The two security-relevant gap-closure items from the post-implementation code review (CR-01-NEW and CR-02) were independently re-confirmed present in the code on disk by this audit, not merely cited from VERIFICATION.md. The bare-PHP test harness was independently re-executed (35/35 PASS) along with both Phase 6 regression harnesses (both exit 0). One non-blocking WARNING (WR-01, browser-only JS timing race) is logged as an unregistered flag with no corresponding threat-register ID; it does not block this phase under the `block_on: critical` configuration since it represents a fail-closed availability risk, not an open security mitigation gap.

**No OPEN_THREATS. No BLOCKER findings.**
