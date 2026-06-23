---
status: resolved
phase: 06-php-backend-core-config-token-strategies-rest-contract
source: [06-VERIFICATION.md]
started: 2026-06-23T10:45:00Z
updated: 2026-06-23T11:30:00Z
---

## Current Test

[all tests resolved]

## Tests

### 1. CR-01 — Rate-limiter TOCTOU race condition: fix now or accept as tracked risk?
expected: Either (a) a follow-up plan is opened to make RateLimiter's check-and-record atomic (e.g. try_reserve()/release()), or (b) an explicit override is recorded in 06-VERIFICATION.md accepting the risk for this milestone with a documented reason.
result: resolved — option (a). User chose "fix both now". `SessionController::create_session()` now calls `record_mint()` immediately after `is_allowed()` passes, before the ~10s OpenAI network call, instead of after a successful mint. Shrinks the race window from the full network round-trip to in-process instructions, and as a side effect also closes the related gap where a flood of always-failing attempts never counted against the limiter. Regression test added (`rest-logic-harness.php` Case 8b: 5 failed attempts still exhaust the per-IP budget). Fixed in commit `bbb962f`. Re-verified live against the real WP install + real OpenAI key: REST-03 still passes (4 successes then 429s).

### 2. CR-02 — Silent vendor/autoload.php absence causing a sitewide fatal crash on fresh installs
expected: Either (a) khaveeai.php is patched to fail gracefully (admin notice + early return) instead of registering a doomed plugins_loaded callback, or (b) an explicit override is recorded accepting the risk because all current verification happens on a machine where composer install has already been run.
result: resolved — option (a). User chose "fix both now". `khaveeai.php` now shows an `admin_notices` warning and returns early when `vendor/autoload.php` is missing, instead of unconditionally registering `plugins_loaded` against an undefined class. Fixed in commit `bbb962f`. Re-verified live: plugin still loads and mints tokens correctly with `vendor/` present.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
