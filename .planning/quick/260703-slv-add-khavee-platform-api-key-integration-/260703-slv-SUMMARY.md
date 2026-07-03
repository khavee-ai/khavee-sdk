---
phase: quick-260703-slv
plan: 01
subsystem: wordpress-plugin
tags: [wordpress, config-source, decorator-pattern, php, http-client]

# Dependency graph
requires:
  - phase: N/A (quick task, not part of a planned phase)
    provides: Phase 6/8/9's ConfigSourceInterface, WpOptionsConfigSource, SettingsPage, Plugin.php composition root
provides:
  - "PlatformClient: cached wp_remote_get() client for the hosted Khavee Platform's project-preview endpoint, plus a pure map_platform_fields() field-mapping helper"
  - "PlatformConfigSource: ConfigSourceInterface decorator overlaying platform-sourced fields on WpOptionsConfigSource ('platform always wins')"
  - "A second, masked/removable 'Khavee Platform API Key' admin field with a post-save connection-status notice"
affects: [wordpress-plugin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ConfigSourceInterface decorator pattern (PlatformConfigSource wraps WpOptionsConfigSource) — a strategy-swap seam without touching the wrapped class or its consumers"
    - "Cached HTTP client with both-outcomes caching (ok=true and ok=false both cached behind a 5-minute WP transient keyed on md5(key)) to bound retry storms against a broken key"

key-files:
  created:
    - wordpress-plugin/includes/Platform/PlatformClient.php
    - wordpress-plugin/includes/ConfigSource/PlatformConfigSource.php
    - wordpress-plugin/tests/platform-config-harness.php
  modified:
    - wordpress-plugin/includes/Plugin.php
    - wordpress-plugin/includes/Admin/SettingsPage.php
    - wordpress-plugin/tests/settings-page-harness.php

key-decisions:
  - "Platform key is read via get_option('khaveeai_settings')['platform_api_key'] directly in both PlatformConfigSource and SettingsPage — deliberately NOT added to ConfigSourceInterface, per the plan's explicit instruction, keeping the interface's public-safe/secret-only two-method contract unchanged"
  - "fetch_preview() caches BOTH success and failure outcomes for 300s behind a transient keyed on md5(key) (never the raw key) so a broken/missing key cannot hammer the platform API on every render"
  - "Overlay presence check trims strings before testing for blank ('' or whitespace-only) so a platform value that is present-but-blank falls through to the wrapped/local value instead of blanking it"

patterns-established:
  - "Decorator-over-interface: a new ConfigSourceInterface implementation composes an existing one via constructor injection, with the composition root (Plugin.php) as the only wiring point — the pattern any future config-source strategy (e.g. a third source) should follow"

requirements-completed: [PLATFORM-KEY-01]

# Metrics
duration: 12min
completed: 2026-07-03
---

# Phase quick-260703-slv Plan 01: Khavee Platform API Key Integration Summary

**Added a PlatformClient + PlatformConfigSource decorator so a configured Khavee Platform API key overlays voice/instructions/avatar_url/light_intensity/background from the hosted dashboard onto WpOptionsConfigSource, with a masked/removable admin field and a connection-status notice that never leaks the raw key.**

## Performance

- **Duration:** ~12 min (commit-to-commit)
- **Started:** 2026-07-03T20:40:21+07:00
- **Completed:** 2026-07-03T20:52:29+07:00
- **Tasks:** 2/2 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `PlatformClient::map_platform_fields()` — pure, fully-tested mapping of the platform's `voiceProfile`/`model`/`lightIntensity`/`backgroundType`+`backgroundValue` envelope onto this plugin's flat runtime-config field names, correctly treating absent/blank platform values as "don't overlay" rather than blanking the local value.
- `PlatformClient::fetch_preview()` — cached (5-minute WP transient, keyed on a hash of the key, never the raw key) `wp_remote_get()` call to `https://api.platform.khavee.ai/api/v1/projects/sdk/preview`, normalizing every failure mode (WP_Error, non-200, malformed JSON, missing `data` envelope, unexpected Throwable) to a short generic `ok=false` reason.
- `PlatformConfigSource` — a `ConfigSourceInterface` decorator wrapping `WpOptionsConfigSource` in `Plugin.php`'s composition root: overlays mapped platform fields when a key is configured and the fetch succeeds ("platform always wins"), silently falls back to the wrapped config on any absent-key/failure/exception, and delegates `get_api_key()`/`is_configured()` straight through untouched.
- Second admin field "Khavee Platform API Key" (masked `khavee_••••••<last4>`, paired "Remove Platform Key" checkbox) mirroring the existing OpenAI key field's masking/sanitize/removal discipline exactly, gated on a `khavee_` prefix instead of `sk-`.
- Post-save connection-status notice on the settings page: "Connected to project: X" on success, a short generic failure reason on error — never the raw key or a stack trace.
- `AvatarRenderer`, `AvatarBlock`, `SessionController` required zero changes — confirmed via `git diff` against the pre-task commit, matching the plan's must-have.

## Task Commits

Each task was committed atomically:

1. **Task 1: PlatformClient + PlatformConfigSource decorator + composition-root wiring** - `0cdd839` (feat)
2. **Task 2: Platform key admin field (masked + removable) + post-save connection notice** - `ad3a937` (feat)

_Both tasks were TDD (`tdd="true"`): each commit bundles the RED test cases together with the GREEN implementation in a single atomic commit per the plan's task-level granularity (no separate test/feat split was requested by the plan's `<action>` blocks)._

## Files Created/Modified
- `wordpress-plugin/includes/Platform/PlatformClient.php` - Cached HTTP client (`fetch_preview()`) + pure field-mapping (`map_platform_fields()`) for the platform's project-preview endpoint
- `wordpress-plugin/includes/ConfigSource/PlatformConfigSource.php` - `ConfigSourceInterface` decorator overlaying platform-sourced fields on a wrapped source
- `wordpress-plugin/includes/Plugin.php` - Composition root now wires `new PlatformConfigSource( new WpOptionsConfigSource() )` as the shared `$config_source`
- `wordpress-plugin/includes/Admin/SettingsPage.php` - New masked/removable platform-key field, `mask_platform_key()`/`sanitize_platform_api_key()`, and the connection-status notice in `render_page()`
- `wordpress-plugin/tests/platform-config-harness.php` - New bare-PHP harness: 28 cases covering mapping, caching, HTTP-failure normalization, overlay/fallback semantics, delegation, and secret non-leak
- `wordpress-plugin/tests/settings-page-harness.php` - Extended with 6 new cases (mask/sanitize/removal for the platform key)
- `.planning/quick/260703-slv-add-khavee-platform-api-key-integration-/deferred-items.md` - Logged one pre-existing, out-of-scope test failure discovered while verifying (see Deviations)

## Decisions Made
- Platform key read directly via `get_option()` in both `PlatformConfigSource` and `SettingsPage`, never added to `ConfigSourceInterface` — keeps the interface's existing public-safe/secret-only two-method contract stable for all other consumers.
- `fetch_preview()` caches both `ok=true` and `ok=false` outcomes for 300s so a misconfigured/broken key cannot trigger a network call on every page render.
- Presence checks in `map_platform_fields()` trim before testing for blank, so a platform field that is present-but-whitespace-only is treated the same as absent (falls through to the local/wrapped value rather than overwriting it with blank).

## Deviations from Plan

### Auto-fixed Issues

None — Rules 1-3 were not triggered; the implementation followed the plan's `<action>` blocks directly.

### Out-of-Scope Discovery (logged, not fixed)

**1. Pre-existing stale shape assertion in `settings-page-harness.php`**
- **Found during:** Task 1's verification step (running the plan's stated "existing render-logic-harness.php and settings-page-harness.php still pass" done criterion)
- **Issue:** The case `'shape: get_runtime_config() returns exactly the keys {instructions, voice, avatar_url, model}'` fails because `WpOptionsConfigSource::get_runtime_config()` now returns additional Phase-9 STUDIO-05 keys (`container_width`, `bg_type`, `light_intensity`, `camera_preset`, `chat_show`, etc.) that this stale test case doesn't expect.
- **Confirmed pre-existing:** Ran the harness against the base commit (`80f1081`, before any of this task's changes) with the same single failure — `WpOptionsConfigSource.php` was not touched by this plan.
- **Action:** Left untouched per the scope boundary rule (only auto-fix issues directly caused by this task's own changes). Logged to `.planning/quick/260703-slv-add-khavee-platform-api-key-integration-/deferred-items.md`.

---

**Total deviations:** 0 auto-fixed; 1 out-of-scope pre-existing failure logged for awareness.
**Impact on plan:** None — the pre-existing failure is unrelated to any file this plan modified.

## Issues Encountered
None beyond the deferred pre-existing test-shape mismatch above.

## Next Phase Readiness
- The platform-key integration is self-contained: an admin can now optionally enter a Khavee Platform API key to drive avatar config from the hosted dashboard, with zero risk to the existing OpenAI-key-only path (absent key = byte-identical behavior to before this task).
- Future work: fix the stale `settings-page-harness.php` shape assertion (logged in deferred-items.md) in a task that touches `WpOptionsConfigSource`/that harness file.

---
*Phase: quick-260703-slv*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 8 claimed files exist on disk and both task commit hashes (`0cdd839`, `ad3a937`) resolve in `git log --oneline --all`.
