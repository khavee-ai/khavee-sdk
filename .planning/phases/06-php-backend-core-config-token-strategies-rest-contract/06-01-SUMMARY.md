---
phase: 06-php-backend-core-config-token-strategies-rest-contract
plan: 01
subsystem: infra
tags: [php, wordpress, composer, psr-4, strategy-pattern]

# Dependency graph
requires: []
provides:
  - "wordpress-plugin/ directory scaffold (includes/, src/)"
  - "Khavee\\Plugin\\ConfigSource\\ConfigSourceInterface (two-method config strategy contract)"
  - "Khavee\\Plugin\\ConfigSource\\WpOptionsConfigSource (concrete wp_options-backed implementation)"
  - "wordpress-plugin/khaveeai.php plugin bootstrap with guarded Composer autoload"
  - "wordpress-plugin/composer.json PSR-4 autoload map (Khavee\\Plugin\\ => includes/), zero runtime HTTP deps"
affects: [06-02, 06-03, 06-04, phase-07-admin-settings, phase-08-shortcode-block]

# Tech tracking
tech-stack:
  added: [PHP 8.0+, Composer PSR-4 autoloading]
  patterns:
    - "Strategy interface seam: ConfigSourceInterface separates public-safe get_runtime_config() from server-only get_api_key() so the API key never crosses the PHP-runtime -> REST/JS boundary"
    - "final class implementations of single-purpose strategy interfaces (no premature multi-implementation abstraction)"
    - "Guarded require for vendor/autoload.php so the bootstrap file still lints/loads before composer install runs"

key-files:
  created:
    - wordpress-plugin/khaveeai.php
    - wordpress-plugin/composer.json
    - wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php
    - wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php
  modified: []

key-decisions:
  - "wordpress-plugin/ directory did not exist yet (despite PATTERNS.md describing includes/ and src/ as pre-scaffolded empty dirs) — created it fresh as part of Task 1, matching the plan's expected file paths exactly"
  - "Used a private OPTION_NAME class constant ('khaveeai_settings') in WpOptionsConfigSource rather than inlining the literal string at each get_option() call site, for single-source-of-truth maintainability; the constant's value is the exact literal required by the plan"
  - "Plugin header fields use single-space-after-colon formatting (not column-aligned) so the 'Requires PHP: 8.0' substring matches the acceptance criterion exactly"

patterns-established:
  - "Pattern 1 (ConfigSourceInterface): the swappable strategy seam for config retrieval — any future Platform-mode source implements this same two-method contract"

requirements-completed: [ARCH-01]

# Metrics
duration: 8min
completed: 2026-06-21
---

# Phase 06 Plan 01: Plugin Bootstrap + ConfigSource Strategy Summary

**PHP plugin bootstrap (khaveeai.php), Composer PSR-4 autoload, and the ConfigSourceInterface/WpOptionsConfigSource strategy pair that keeps the OpenAI API key out of every REST response and JS bundle.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-21T13:31:00Z
- **Completed:** 2026-06-21T13:39:01Z
- **Tasks:** 2
- **Files modified:** 4 (all created)

## Accomplishments
- Created the `wordpress-plugin/` directory scaffold (`includes/`, `src/`) — this is the first PHP code in the repository
- `khaveeai.php` plugin bootstrap: valid WP plugin header, `ABSPATH` direct-access guard, guarded Composer autoload require, TODO marker for plan 03's `Plugin::boot()` wiring
- `composer.json`: PSR-4 autoload map `Khavee\Plugin\` → `includes/`, zero runtime HTTP-client dependencies (per STACK.md — the plugin uses `wp_remote_post()`, not Guzzle)
- `ConfigSourceInterface`: exactly two methods (`get_runtime_config(): array`, `get_api_key(): string`) per the normative shape from ARCHITECTURE.md Pattern 1
- `WpOptionsConfigSource`: reads `khaveeai_settings` from `wp_options`, returns `instructions`/`voice`/`avatar_url`/`model` with documented fallbacks (`"You are a helpful AI assistant."`, `"alloy"`, `""`, `"gpt-realtime-1.5"`), and structurally isolates `get_api_key()` from the runtime-config array (verified via grep — zero `api_key` references inside `get_runtime_config()`'s body)

## Task Commits

Each task was committed atomically:

1. **Task 1: Plugin bootstrap + Composer PSR-4 autoload** - `d7783d8` (feat)
2. **Task 2: ConfigSourceInterface + WpOptionsConfigSource** - `4943362` (feat)

## Files Created/Modified
- `wordpress-plugin/khaveeai.php` - Plugin header, ABSPATH guard, guarded autoload require
- `wordpress-plugin/composer.json` - PSR-4 autoload map, PHP >=8.0 requirement, no HTTP-client deps
- `wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php` - Two-method config strategy contract
- `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` - wp_options-backed concrete implementation

## Decisions Made
- The `wordpress-plugin/` directory tree did not actually exist on disk (PATTERNS.md's claim of pre-scaffolded empty `includes/`/`src/` directories did not hold in this worktree) — created it as part of Task 1 rather than treating it as a blocker, since the plan's file paths and acceptance criteria fully specify the expected structure.
- Plugin header formatting uses single-space-after-colon (not column-aligned with extra spaces) so the literal substring `Requires PHP: 8.0` matches the acceptance criterion exactly; column alignment would have broken the exact-substring check.
- `OPTION_NAME` is a private class constant rather than an inlined literal at each `get_option()` call site — same literal value (`khaveeai_settings`), better single-source-of-truth maintainability for the two call sites.

## Deviations from Plan

None — plan executed exactly as written. The directory-scaffolding gap (see Decisions above) was a discrepancy between PATTERNS.md's description of pre-existing state and actual disk state, not a deviation from the plan's instructions; the plan's task actions and acceptance criteria were followed verbatim.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. `composer install` will need to be run before WordPress loads the plugin (to generate `vendor/autoload.php`), but this is a standard build step for plan 03+ and the bootstrap file is written to lint/load cleanly even before that step runs.

## Next Phase Readiness

- `ConfigSourceInterface` and `WpOptionsConfigSource` are ready for `TokenProviderInterface`/`OpenAiDirectTokenProvider` (plan 06-02) to consume via `get_api_key()`.
- `khaveeai.php` and `composer.json` provide the autoload foundation plans 06-02 and 06-03 need for their own `Khavee\Plugin\*` namespaced classes to resolve.
- No blockers for the next plan in this wave.

---
*Phase: 06-php-backend-core-config-token-strategies-rest-contract*
*Completed: 2026-06-21*

## Self-Check: PASSED

All created files verified present on disk; all task commit hashes (d7783d8, 4943362) and the SUMMARY commit (013d340) verified present in git log.
