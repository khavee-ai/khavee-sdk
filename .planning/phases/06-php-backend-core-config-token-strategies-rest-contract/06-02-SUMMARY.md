---
phase: 06-php-backend-core-config-token-strategies-rest-contract
plan: 02
subsystem: api
tags: [php, wordpress, openai-realtime, token-minting, strategy-pattern]

# Dependency graph
requires:
  - phase: 06-php-backend-core-config-token-strategies-rest-contract (plan 01)
    provides: ConfigSourceInterface / WpOptionsConfigSource (sibling strategy seam, no direct code dependency — TokenProvider receives the API key as a parameter rather than reading config itself)
provides:
  - TokenProviderInterface — one-method `mint_session(array, string): array` strategy contract (ARCH-02)
  - OpenAiDirectTokenProvider — concrete implementation calling OpenAI's client_secrets endpoint via wp_remote_post
  - TokenMintException — detail-free failure signal consumed by plan 03's SessionController (maps to HTTP 502)
  - Standalone PHP test harness proving value->ephemeralToken reshaping and no-leaked-detail failure normalization
affects: [06-03-rest-contract, 06-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PHP strategy interface with DI seam (API key passed as parameter, never resolved internally) for future Platform-mode swap"
    - "Dedicated exception class (TokenMintException extends RuntimeException) for detail-free failure signaling across a trust boundary"
    - "Standalone PHP test harness with hand-rolled WP function stubs (no WP/Composer dependency) for testing wp_remote_post-based code"

key-files:
  created:
    - wordpress-plugin/includes/TokenProvider/TokenProviderInterface.php
    - wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php
    - wordpress-plugin/tests/token-provider-harness.php
  modified: []

key-decisions:
  - "Failure normalization uses a dedicated TokenMintException (not a sentinel array) — plan 03's SessionController should catch this and map to HTTP 502 with a generic body"
  - "error_log() is called exactly once per failure path (WP_Error, non-2xx, missing value) before throwing, satisfying D-10's 'one line per failure' requirement"
  - "sessionId/expiresAt are derived from OpenAI's session.id / session.expires_at fields when present, else null"

patterns-established:
  - "TokenProvider classes never read wp_options or any config store directly — the API key is always a constructor/method parameter (DI seam for future Platform mode)"
  - "Failure paths log real detail server-side via error_log() and throw/return only a detail-free signal to the caller — stronger than the TS SDK's leak-status-in-message pattern, appropriate for a public-facing PHP route"

requirements-completed: [ARCH-02]

# Metrics
duration: 13min
completed: 2026-06-21
---

# Phase 6 Plan 02: Token Provider Strategy Seam Summary

**TokenProviderInterface + OpenAiDirectTokenProvider mint OpenAI Realtime ephemeral tokens server-to-server via wp_remote_post, remapping `value`->`ephemeralToken` and normalizing all failures into a detail-free TokenMintException, proven by a standalone zero-dependency PHP harness.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-06-21T13:26:00Z
- **Completed:** 2026-06-21T13:39:26Z
- **Tasks:** 2 completed
- **Files modified:** 3 (all new)

## Accomplishments
- `TokenProviderInterface` defines the exact one-method DI-seam contract (`mint_session(array $session_config, string $api_key): array`), with the API key always passed in, never resolved internally — the seam a future Platform-mode provider will implement against without any caller changes.
- `OpenAiDirectTokenProvider` POSTs to `https://api.openai.com/v1/realtime/client_secrets` with an explicit 10s timeout, remaps OpenAI's top-level `value` field to `ephemeralToken`, and derives `sessionId`/`expiresAt` from OpenAI's `session` object.
- All three failure modes (WP_Error/network failure, non-2xx HTTP status, 2xx response missing `value`) are normalized into a single `TokenMintException` carrying no OpenAI response text — the real detail is logged once per failure via `error_log()`, satisfying D-09 and D-10.
- A standalone PHP harness (`wordpress-plugin/tests/token-provider-harness.php`) runs under bare PHP 8.x with zero WordPress/Composer dependencies, stubbing the five WP HTTP API functions the provider touches plus a minimal `WP_Error` class, and proves all four required behaviors end-to-end.

## Task Commits

Each task was committed atomically:

1. **Task 1: TokenProviderInterface + OpenAiDirectTokenProvider** - `748874b` (feat)
2. **Task 2: Standalone reshaping + failure-normalization harness** - `4a09aa0` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `wordpress-plugin/includes/TokenProvider/TokenProviderInterface.php` - One-method strategy interface; doc-block states the return shape and the DI rule (API key passed in, never read from wp_options)
- `wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php` - Concrete implementation: wp_remote_post to client_secrets endpoint, value->ephemeralToken reshaping, TokenMintException for all failure paths, error_log for server-side detail
- `wordpress-plugin/tests/token-provider-harness.php` - Standalone harness with WP function stubs proving reshaping + failure normalization across 4 cases

## Decisions Made
- Chose a dedicated exception class (`TokenMintException extends \RuntimeException`) over a sentinel `['error' => 'mint_failed']` array for the failure-normalization mechanism. This is cleaner for plan 03's `SessionController` to catch explicitly and map to HTTP 502, and avoids ambiguous return-type checking (`is_array($result) && isset($result['error'])`) at every call site.
- `TokenMintException` and `OpenAiDirectTokenProvider` live in the same file, both under `Khavee\Plugin\TokenProvider` namespace, since the exception has no meaning outside this provider's failure path and the plan explicitly allowed declaring it "in the same file or a sibling file."
- The harness fixture stubs return a PHP array shaped like WP's real `wp_remote_post()` response (`['response' => ['code' => N], 'body' => '...']`) rather than a custom shape, so the stub functions (`wp_remote_retrieve_response_code`, `wp_remote_retrieve_body`) mirror real WP semantics exactly — reduces risk of the harness passing against a stub shape that wouldn't match real WP behavior.

## Deviations from Plan

None - plan executed exactly as written. The failure-normalization mechanism (exception vs. sentinel array) was explicitly left as a choice in the plan ("Pick one and document it") — documented above, not a deviation.

## Issues Encountered

The `wordpress-plugin/` directory did not yet exist in this worktree (confirmed via `ls` — the directory is genuinely new, first PHP code in the repo per 06-PATTERNS.md). Created `wordpress-plugin/includes/TokenProvider/` and `wordpress-plugin/tests/` directories as part of normal task execution (not a deviation — this is exactly what plan 01, running in the same wave with no shared dependency on this plan's files, is also expected to do for `includes/ConfigSource/`). No conflict expected since the two plans touch disjoint subdirectories.

## User Setup Required

None - no external service configuration required. (A real `OPENAI_API_KEY`/admin-configured key is needed for live end-to-end testing against the real OpenAI endpoint, but that is plan 03/Phase 7's concern — this plan's harness fully validates the reshaping/failure-normalization logic without any real network call or API key.)

## Next Phase Readiness

`TokenProviderInterface` and `OpenAiDirectTokenProvider` are ready for plan 03's `SessionController` to consume via constructor injection. The controller should:
- Catch `Khavee\Plugin\TokenProvider\TokenMintException` and map it to HTTP 502 with a generic body (per D-09).
- Call `mint_session($session_config, $config_source->get_api_key())`, where `$session_config` has already had `instructions`/`voice` overridden by `ConfigSourceInterface::get_runtime_config()` per D-07 — this provider does not perform that sanitization itself (by design, per the plan's action notes).

No blockers identified for plan 03.

---
*Phase: 06-php-backend-core-config-token-strategies-rest-contract*
*Completed: 2026-06-21*

## Self-Check: PASSED

All claimed files verified present:
- wordpress-plugin/includes/TokenProvider/TokenProviderInterface.php
- wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php
- wordpress-plugin/tests/token-provider-harness.php
- .planning/phases/06-php-backend-core-config-token-strategies-rest-contract/06-02-SUMMARY.md

All claimed commits verified present in git log: 748874b, 4a09aa0, 3882d66
