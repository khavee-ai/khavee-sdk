---
status: complete
---

# Quick Task 260709-fq2: Platform Background Color Case-Mismatch Fix — Summary

## Problem

User report: "the bg color still be transparent or white. eventhough on platform is blue eventough i selected globaldefault."

## Root cause

`PlatformClient::map_platform_fields()` (`wordpress-plugin/includes/Platform/PlatformClient.php`) compared the platform API's `backgroundType` field against lowercase literals `'image'`/`'color'`. The actual khavee-app DB enum (`packages/db/src/schema.ts`: `pgEnum('background_type', ['COLOR', 'IMAGE'])` in the sibling `khavee-app` repo) is uppercase — the real `/sdk/preview` API response always sends `backgroundType: 'COLOR'` or `'IMAGE'`. The lowercase comparison never matched real data, so `bg_type`/`bg_color` were silently never overlaid from the platform — every site fell through to the WP-local (blank) values regardless of what was configured on the platform dashboard.

The existing test harness (`platform-config-harness.php`) only exercised this with lowercase fixture input, which passed the buggy code and hid the mismatch.

## Fix

Compare case-insensitively: `strtoupper((string) $data['backgroundType'])` against `'IMAGE'`/`'COLOR'`.

Also cleared the 5-minute transient cache (`wp transient delete --all` in wp-env) during verification — `PlatformConfigSource` caches both success and failure fetch results for 5 minutes, so a fix to the mapping logic doesn't take visible effect until the next uncached fetch.

## Files changed

- `wordpress-plugin/includes/Platform/PlatformClient.php`
- `wordpress-plugin/tests/platform-config-harness.php` (added a regression case using real uppercase `'COLOR'` input — the pre-existing cases only used lowercase fixtures and would have passed either way)

## Verification

- `php tests/platform-config-harness.php` — all 32 cases pass, including the new `backgroundType=COLOR (real platform casing)` case
- Live-verified in wp-env: after clearing the cached transient, a page with its block's Background Type left at "Global default" now renders the platform-configured blue (`#6386E9`) instead of blank/white
