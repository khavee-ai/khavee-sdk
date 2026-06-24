---
phase: 07-admin-settings-page
plan: 01
subsystem: wordpress-plugin/config-source
tags: [php, wordpress, contract, config-source, avatar, interface]
requires:
  - "Phase 6 ConfigSourceInterface (2-method contract)"
  - "Phase 6 WpOptionsConfigSource (read-side option blob)"
  - "Phase 6 rest-logic-harness.php FixtureConfigSource"
provides:
  - "ConfigSourceInterface::is_configured(): bool — single source of truth for 'is the API key set'"
  - "WpOptionsConfigSource reads avatar_attachment_id and resolves to a URL via wp_get_attachment_url() at read time"
  - "settings-page-harness.php — bare-PHP harness for is_configured() + avatar-ID resolution"
affects:
  - "07-02 SettingsPage 'not configured' banner (consumes is_configured(), D-14)"
  - "07-03 SettingsPage avatar write path (writes avatar_attachment_id, now the canonical field)"
  - "Phase 8 frontend embed admin-only notice (consumes is_configured(), SET-06/D-12)"
  - "Phase 6 SessionController (unaffected — get_runtime_config() return shape preserved)"
tech-stack:
  added: []
  patterns:
    - "Additive interface extension (D-13) — new method on existing contract, existing implementers must conform"
    - "Avatar attachment-ID storage + wp_get_attachment_url() resolution at read time (ARCHITECTURE.md 'second bottleneck', RESEARCH Pattern 3)"
    - "Bare-PHP test harness with function_exists()-guarded WP stubs (mirrors rest-logic-harness.php)"
key-files:
  created:
    - "wordpress-plugin/tests/settings-page-harness.php"
  modified:
    - "wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php"
    - "wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php"
    - "wordpress-plugin/tests/rest-logic-harness.php"
decisions:
  - "D-13 implemented: is_configured() is an additive method on ConfigSourceInterface (not a trait/default), composed over get_api_key() in the concrete — single source of truth for both the 07-02 settings banner and the Phase 8 frontend notice"
  - "D-12 honored: is_configured() checks only key emptiness, never key format/validity — wrong/revoked keys surface via the runtime REST error path (Phase 6 D-09), not via format heuristics here"
  - "Open Question 1 resolved toward attachment-ID storage (ARCHITECTURE.md-recommended): avatar_attachment_id replaces avatar_url as the canonical stored field, with wp_get_attachment_url() resolving to a URL at read time"
  - "PHP interface enforcement is at class-declaration time, not at call time (verified empirically) — adding is_configured() to the interface forces every implementer, including Phase 6's FixtureConfigSource test fixture, to add the method or fatal"
metrics:
  duration: 15 min
  completed: 2026-06-24
  tasks_completed: 3
  files_created: 1
  files_modified: 3
  commits: 3
  test_cases: 7
  deviations: 1
---

# Phase 7 Plan 01: ConfigSource is_configured() + Avatar Attachment-ID Resolution Summary

Extended Phase 6's `ConfigSourceInterface` with one additive `is_configured(): bool` method and migrated `WpOptionsConfigSource`'s avatar storage from a pre-resolved URL string to a Media Library attachment ID resolved via `wp_get_attachment_url()` at read time — the contract layer 07-02 (settings page), 07-03 (avatar write), and Phase 8 (frontend embed notice) all build against, with the `get_runtime_config()` return shape preserved so Phase 6's `SessionController` is unaffected.

## What Was Built

### Task 1 — `is_configured()` added to the contract and implementation
- `ConfigSourceInterface` gains `public function is_configured(): bool;` after `get_api_key()`, with a docblock naming the decisions it serves (D-13 additive, D-14 settings banner, SET-06/D-12 Phase 8 notice). No `@throws` (consistent with existing methods).
- `WpOptionsConfigSource::is_configured()` is a one-line composition over `get_api_key()`: `return '' !== $this->get_api_key();`. Does NOT do a fresh `get_option()` read — single source of truth for "what counts as configured" (D-12).
- Existing `get_runtime_config()` / `get_api_key()` signatures are byte-for-byte unchanged.

### Task 2 — Avatar storage migrated to attachment-ID resolution
- `get_runtime_config()` now reads `avatar_attachment_id` (int, default 0) instead of a pre-resolved `avatar_url` string.
- The ID is gated on `$attachment_id > 0` before calling `wp_get_attachment_url()` — no `wp_get_attachment_url(0)` is ever made, so the empty/unset case resolves to `''` via the guard, not via the false-return path.
- `wp_get_attachment_url()` returns `false` on an invalid/deleted ID — coerced to `''` via `is_string()` check so `avatar_url` stays a string (T-07A-02 mitigation).
- **Return shape preserved**: array keys are exactly `{instructions, voice, avatar_url, model}`. The key is still `avatar_url` (a URL string), only the internal read logic changed — `SessionController` and any other consumer see no shape change.
- Class-level docblock updated: dropped the stale "this phase only READS / Phase 7 will write" forward-reference now that Phase 7 exists; added the note that `avatar_url` is resolved from a stored attachment ID at read time (Pattern 3), and that the class still trusts `SettingsPage` to sanitize on write.

### Task 3 — Bare-PHP harness (`settings-page-harness.php`)
- Mirrors `rest-logic-harness.php`'s structure exactly: `$failures` counter, `run_case()` function, direct `require` by path (no Composer), verbatim exit-code block.
- Stubs `get_option()` (returns a staged fixture) and `wp_get_attachment_url()` (recognizable URL for a known valid ID, `false` on miss — matching WP core's false-on-miss behavior). All stubs `function_exists()`-guarded.
- 7 cases cover: `is_configured()` false on absent key, true on non-empty key; `avatar_url` `''` on absent/zero ID, the resolved URL on a valid ID, `''` (not `false`) on a stored-but-invalid ID via the strict coercion path; and the unchanged `{instructions, voice, avatar_url, model}` shape with all-string values.
- Case 5 (T-07A-02 false-coercion) is the load-bearing strict assertion: `'' === $result['avatar_url']`. A mutation test (removing the `is_string()` coercion from `WpOptionsConfigSource`) confirmed it flips the harness from exit 0 to exit 1.

## Verification Evidence

- `php -l` reports "No syntax errors detected" for both modified ConfigSource files.
- `php wordpress-plugin/tests/settings-page-harness.php` exits 0 and prints "All cases PASSED." with 7 PASS lines.
- `php wordpress-plugin/tests/rest-logic-harness.php` (Phase 6 regression) still exits 0 — all 11 original cases still pass after the interface contract change and the avatar read-logic change.
- Mutation test on case 5: temporarily removing the `is_string( $avatar_url ) ? $avatar_url : ''` coercion flipped case 5 to FAIL and the harness to exit 1, then restoring it returned the harness to exit 0. The strict assertion is real, not a no-op.
- `array_keys(get_runtime_config())` is exactly `['instructions', 'voice', 'avatar_url', 'model']` — Phase 6's SessionController contract is preserved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `is_configured()` to Phase 6's `FixtureConfigSource` in `rest-logic-harness.php`**
- **Found during:** Task 1 (interface contract change)
- **Issue:** The plan describes `is_configured()` as additive and backward-compatible at the *production* level, but PHP enforces interface conformance at **class-declaration time**, not at call time (verified empirically: `Class C contains 1 abstract method and must therefore be declared abstract or implement the remaining method`). Adding `is_configured()` to `ConfigSourceInterface` makes every existing implementer of the interface non-conformant — including `FixtureConfigSource` in Phase 6's `rest-logic-harness.php` (line 301). Without the fix, the Phase 6 harness would fatal-error on load before any of its 11 cases could run.
- **Fix:** Added a one-method `is_configured()` to `FixtureConfigSource` that mirrors the production composition (`return '' !== $this->api_key;`). This is a minimal, surgical, additive change — no existing Phase 6 test case behavior changes (the harness never calls `is_configured()`; it only needs the class to be declaration-valid). The fixture's `is_configured()` also correctly returns `false` when the harness constructs it with `''` for the empty-key case (Case 7), so it would behave correctly even if a future case exercised it.
- **Files modified:** `wordpress-plugin/tests/rest-logic-harness.php`
- **Commit:** `90dad6c`
- **Rationale:** This is squarely Rule 3 — the breakage is directly caused by the current task's interface-contract change, not pre-existing debt. The plan's own PATTERNS.md (line 347) explicitly anticipates this: "every existing/future `ConfigSourceInterface` implementer, including test fixtures, must add the method or fatal on the interface contract." Leaving Phase 6 red was not an option.

No other deviations. Tasks 2 and 3 executed exactly as written.

## Known Stubs

None. This plan adds no stub patterns:
- `is_configured()` returns a real bool derived from `get_api_key()`.
- `get_runtime_config()['avatar_url']` resolves to a real URL via `wp_get_attachment_url()` or to `''` (the correct value for an unconfigured/invalid avatar — not a placeholder).
- No TODOs, no "coming soon" text, no hardcoded mock data flowing to any UI.

## TDD Gate Compliance

Not applicable — this is a `type: execute` plan (frontmatter), not `type: tdd`. The plan's `<task type="auto">` elements have no `tdd="true"` attribute. Conventional task ordering was used (implement → verify → commit per task), and the bare-PHP harness in Task 3 is a verification harness, not a RED→GREEN→REFACTOR TDD cycle.

## Security Notes

- **T-07A-01 (Information Disclosure — is_configured / get_runtime_config):** Mitigated as specified. `is_configured()` returns only a bool derived from key presence — never returns or logs the key. `get_runtime_config()` continues to exclude `api_key` from its array (Phase 6 contract preserved).
- **T-07A-02 (Tampering — avatar_attachment_id read):** Mitigated. `(int)` cast + `$attachment_id > 0` guard + `wp_get_attachment_url()` false-coercion prevent a malformed stored ID from producing a non-string or `false` `avatar_url`. The harness's case 5 + mutation test prove the coercion is load-bearing.
- **T-07A-03 (Tampering — non-array wp_options value):** Accepted (existing `is_array()` guard unchanged).
- **T-07A-SC (package installs):** Accepted (no packages installed).

No new threat surface beyond what the plan's `<threat_model>` registers. The new `is_configured()` method returns only a bool and the avatar read change is an internal logic swap — neither introduces a new network endpoint, auth path, file access pattern, or trust-boundary schema change.

## Self-Check: PASSED

- [x] `wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php` exists and declares `is_configured(): bool` (1 occurrence)
- [x] `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` exists, implements `is_configured()` over `get_api_key()` (1 occurrence), and references `wp_get_attachment_url` + `avatar_attachment_id`
- [x] `wordpress-plugin/tests/settings-page-harness.php` exists, defines `run_case` once, runs under bare PHP, exits 0
- [x] `wordpress-plugin/tests/rest-logic-harness.php` (Rule 3 deviation file) still exits 0
- [x] Commit `90dad6c` exists (Task 1 — interface + implementation + fixture)
- [x] Commit `b22a42a` exists (Task 2 — avatar attachment-ID resolution)
- [x] Commit `c41c2b9` exists (Task 3 — bare-PHP harness)
