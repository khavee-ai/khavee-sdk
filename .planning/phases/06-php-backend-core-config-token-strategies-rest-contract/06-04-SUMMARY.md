---
phase: 06-php-backend-core-config-token-strategies-rest-contract
plan: 04
subsystem: api
tags: [wordpress, php, rest-api, openai, ephemeral-token, curl, wp-env, composer]

# Dependency graph
requires:
  - phase: 06-php-backend-core-config-token-strategies-rest-contract (plan 02)
    provides: TokenProviderInterface + OpenAiDirectTokenProvider
  - phase: 06-php-backend-core-config-token-strategies-rest-contract (plan 03)
    provides: RateLimiter + SessionController + Plugin.php composition root
provides:
  - "Reproducible curl script (wordpress-plugin/tests/curl-verify.sh) exercising all four observable REST success criteria against a live install"
  - "Live, human-approved end-to-end proof that the OpenAI ephemeral-token contract works against the real api.openai.com endpoint, not just standalone PHP harnesses"
  - "Two real wire-contract bugs found and fixed: unwrapped client_secrets request body, and an invalid top-level voice field"
  - "wordpress-plugin/.gitignore (vendor/ ignored) + tracked composer.lock"
affects: [07-admin-settings-media-upload, 08-render-layer-shortcode-block-bundle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Live curl verification as the final gate before downstream phases trust a wire contract proven only by mocked/stubbed unit harnesses"
    - "Standalone harnesses encode assumptions about the third-party API shape; a harness can pass 100% while the real call still 400s if the assumption itself (e.g. body wrapping, field placement) is wrong — live verification against the real vendor endpoint is the only thing that catches this class of bug"

key-files:
  created:
    - wordpress-plugin/tests/curl-verify.sh
    - wordpress-plugin/.gitignore
    - wordpress-plugin/composer.lock
  modified:
    - wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php
    - wordpress-plugin/includes/Rest/SessionController.php
    - wordpress-plugin/tests/rest-logic-harness.php

key-decisions:
  - "OpenAI's /v1/realtime/client_secrets endpoint requires the session config nested under a top-level `session` key — confirmed by direct curl against the real endpoint with a real key, bypassing WordPress entirely to isolate the bug to the request-body shape (not auth, not WP)"
  - "OpenAI's realtime session schema has no top-level `voice` field at all — voice only exists at `session.audio.output.voice`; SessionController now unsets any client-sent top-level `voice` and always forces the admin-configured voice into the nested `audio.output.voice` path, creating that structure if the client didn't send one"
  - "wordpress-plugin/vendor/ is gitignored (Composer-regenerable); composer.lock IS tracked despite zero third-party require entries today, because this is an application-type Composer package where lock-file reproducibility matters once dependencies are added"

requirements-completed: [REST-01, REST-02, REST-03, REST-04]

# Metrics
duration: ~45min (across initial authoring session + checkpoint resolution session)
completed: 2026-06-23
---

# Phase 6 Plan 4: Live REST Contract Verification Summary

**Live curl verification against a real WordPress install and a real OpenAI key surfaced two genuine wire-contract bugs (unwrapped client_secrets body, invalid top-level voice field) that 100%-passing standalone PHP harnesses had missed — both fixed and re-verified, all four REST-01..04 criteria now confirmed passing end-to-end.**

## Performance

- **Duration:** ~45 min total (Task 1 authoring + Task 2 checkpoint resolution across environment setup, bug discovery, fix, and re-verification)
- **Started:** 2026-06-21T20:50:00Z (approx, Task 1 start)
- **Completed:** 2026-06-23T17:32:00Z (final commit)
- **Tasks:** 2 (1 auto, 1 checkpoint:human-verify)
- **Files modified:** 6 (3 created across the plan, 3 modified for the bug fix)

## Accomplishments
- `wordpress-plugin/tests/curl-verify.sh` authored: a syntactically-valid, dependency-light bash script that exercises all four observable REST success criteria (anonymous 200+token, key absence, 429 past rate limit, Cache-Control: no-store) against any live WP base URL
- Live WP install (wp-env) stood up, plugin activated, and a real OpenAI API key configured — full environment friction resolved (see Issues Encountered)
- The FIRST live run against the real OpenAI endpoint surfaced two genuine code bugs in plans 06-02/06-03's wire-contract assumptions (see Deviations) — exactly the de-risking value Phase 6 was sequenced first to capture
- Both bugs fixed, standalone harnesses re-verified passing (the one harness assertion that encoded the same wrong assumption was corrected to match), and the live curl script re-run to a clean 4/4 PASS
- User independently re-ran the script after the fix and typed "ok passed. APPROVE" — the human-verify checkpoint is resolved
- `wordpress-plugin/.gitignore` added (Composer `vendor/` ignored) and `composer.lock` tracked, closing a gap exposed by the Composer-install environment issue

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the curl verification script** - `0edf76c` (feat) — merged to main via `acb3b16` (worktree merge)
2. **Task 2: Live WP + real OpenAI key end-to-end verification** - bug fix committed as `a378507` (fix); no separate "task" commit exists for the human-verify checkpoint itself since it is a verification gate, not a code-producing task

**Additional commits from checkpoint resolution and continuation:**
- `a378507` (fix) — wrap OpenAI client_secrets body under `session` key + fix SessionController's invalid top-level `voice` field; updated the one rest-logic-harness.php assertion that encoded the same wrong assumption
- `cb9bf89` (chore) — add `wordpress-plugin/.gitignore` (ignore `vendor/`), track `composer.lock`

**Plan metadata:** pending (this SUMMARY.md + STATE.md/ROADMAP.md update commit)

_Note: Task 2 (checkpoint:human-verify) produced no new feature code of its own beyond the bug-fix commit above — the checkpoint's job was verification, and the bug fix was the direct, necessary output of that verification finding a real defect._

## Files Created/Modified
- `wordpress-plugin/tests/curl-verify.sh` - Reproducible curl script exercising REST-01 through REST-04 against a live install
- `wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php` - Wraps the session config under a top-level `session` key before POSTing to `/v1/realtime/client_secrets` (was previously unwrapped, causing OpenAI to reject every field with `400 Unknown parameter`)
- `wordpress-plugin/includes/Rest/SessionController.php` - `apply_trust_model()` now `unset()`s any client-sent top-level `voice` and forces the admin-configured voice into `session.audio.output.voice` (creating the nested `audio`/`output` structure if absent), since OpenAI's schema has no top-level `voice` field
- `wordpress-plugin/tests/rest-logic-harness.php` - Updated Case 5 (trust-model) assertion to match the corrected nested-voice shape; harness had encoded the same wrong top-level-voice assumption and so never caught the bug
- `wordpress-plugin/.gitignore` - Ignores `/vendor/` (Composer-regenerable, must not be committed)
- `wordpress-plugin/composer.lock` - Tracked for reproducibility (application-type Composer package)

## Decisions Made
- Diagnosed both bugs via direct `curl` against the real `api.openai.com` endpoint, bypassing WordPress entirely each time — this isolated each bug to the request-body shape itself rather than auth, WP wiring, or the plugin's HTTP client, and is the reason the root cause was identified with certainty rather than guessed at
- Chose to fix the harness's Case 5 assertion (rather than leave it red or delete it) so the standalone harness continues to encode the correct contract going forward, preventing this exact class of regression from recurring silently
- Tracked `composer.lock` despite zero current third-party dependencies — application-type package convention, not library convention; matters once any dependency is added in a later phase

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] OpenAI client_secrets request body posted unwrapped at the top level**
- **Found during:** Task 2 (live verification checkpoint) — the first live curl-verify.sh run against the real OpenAI endpoint
- **Issue:** `OpenAiDirectTokenProvider::mint_session()` POSTed the session config as the top-level JSON body to `https://api.openai.com/v1/realtime/client_secrets`. OpenAI's real API requires the session config nested under a `"session"` key and returns `400 Unknown parameter` for every top-level field otherwise. Both standalone PHP harnesses (token-provider-harness.php, rest-logic-harness.php) had passed 100% because they stub the HTTP layer entirely — they assert on the PHP-side reshaping logic, not on the actual JSON body shape OpenAI expects.
- **Fix:** Changed the `wp_remote_post()` body to `wp_json_encode( array( 'session' => $session_config ) )`.
- **Verification:** Confirmed via direct curl against the real OpenAI endpoint with the user's real key (bypassing WordPress), then via the full curl-verify.sh run, which returned a real `ek_`-prefixed token.
- **Files modified:** wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php
- **Committed in:** a378507

**2. [Rule 1 - Bug] SessionController injected an invalid top-level `voice` field**
- **Found during:** Task 2 (live verification checkpoint), via a second isolated direct-curl test after fixing Bug 1 — confirmed this would 400 with `Unknown parameter: session.voice` even after the wrap fix.
- **Issue:** `SessionController::apply_trust_model()` unconditionally set a top-level `voice` key on the session config. OpenAI's realtime session schema does not recognize a top-level `voice` field at all — voice only exists at the nested path `session.audio.output.voice`.
- **Fix:** `apply_trust_model()` now `unset()`s any client-sent top-level `voice`, ensures `session_config['audio']['output']` exists as an array (creating it if absent), and always sets `session_config['audio']['output']['voice']` to the admin-configured value.
- **Verification:** `wordpress-plugin/tests/rest-logic-harness.php` Case 5 (the trust-model test) was updated to assert the corrected nested shape and re-confirmed passing; the live curl-verify.sh run confirmed a real 200 + token with the fix applied.
- **Files modified:** wordpress-plugin/includes/Rest/SessionController.php, wordpress-plugin/tests/rest-logic-harness.php
- **Committed in:** a378507

**3. [Rule 2 - Missing Critical] wordpress-plugin had no .gitignore; Composer's vendor/ was at risk of being committed wholesale**
- **Found during:** Task 2 environment setup — Composer had never been run on this machine, so `vendor/autoload.php` didn't exist and the plugin fatal-errored (`class "\Khavee\Plugin\Plugin" not found`) on every WP page load once `wp option update` triggered `plugins_loaded`. Installing Composer and running `composer install` generated `vendor/` and `composer.lock`, both previously untracked with no `.gitignore` to route them correctly.
- **Fix:** Added `wordpress-plugin/.gitignore` containing `/vendor/`; staged and committed `composer.lock` (tracked, per application-package convention) without `vendor/` (ignored, regenerable).
- **Files modified:** wordpress-plugin/.gitignore (created), wordpress-plugin/composer.lock (tracked)
- **Committed in:** cb9bf89

---

**Total deviations:** 3 auto-fixed (2 bug fixes essential to the wire contract working at all against the real vendor, 1 missing-critical repo hygiene gap)
**Impact on plan:** All three deviations were necessary corrections directly caused by live verification — no scope creep. The two bug fixes are the single most valuable outcome of this plan: they prove the standalone harnesses (06-02/06-03), while internally consistent, encoded a wrong assumption about OpenAI's actual wire shape that only live verification against the real endpoint could catch.

## Issues Encountered

Three environment-setup problems were diagnosed and resolved before the live verification could even begin — none were code bugs, all were local-machine friction:

1. **Stale wp-env Docker cache** — a leftover `~/.wp-env/wp-env-wordpress-plugin-*/WordPress` directory caused a git checkout conflict on `wp-env start`. Resolved by manually removing the stale cache directory, after which `wp-env start` succeeded.
2. **WP-CLI not on host PATH** (`zsh: command not found: wp`) — fixed by running WP-CLI inside the wp-env Docker container via `npx @wordpress/env run cli wp ...` instead of expecting a host-installed `wp` binary.
3. **Composer never installed on this machine** — `wordpress-plugin/vendor/autoload.php` didn't exist, causing a PHP fatal error (`class "\Khavee\Plugin\Plugin" not found`) on every WP page load once the plugin's `plugins_loaded` hook fired. Fixed by installing Composer via Homebrew and running `composer install` inside `wordpress-plugin/`.

A fourth non-bug surfaced during re-verification: the user's own re-run of curl-verify.sh immediately after the executor's verification run returned a false-looking 429 on REST-01/REST-03 (expected 200, got 429). This was rate-limit state bleed, not a bug — both runs originated from the same client IP within the same 10-minute per-IP window (D-01: 5 mints/IP/10min), so the executor's prior run had already consumed most of the budget. Cleared via `wp transient delete --all`; the user's subsequent clean run passed all four checks.

## User Setup Required

None further required for this plan. The live WordPress install (wp-env), Composer toolchain, and OpenAI API key used during this checkpoint were one-time local verification setup, not a persistent requirement carried into later phases — Phase 7/8 will need their own (likely overlapping) local WP setup, documented at that time.

## Next Phase Readiness
- The full PHP backend core (ConfigSource + TokenProvider + RateLimiter + SessionController + Plugin composition root) is now proven correct against the REAL OpenAI endpoint, not just mocked harnesses — all four ROADMAP Phase 6 success criteria (REST-01..04) are confirmed end-to-end with a live install and a real, billable OpenAI key, human-approved.
- Phase 6 is complete. Phase 7 (Admin Settings Page) and Phase 8 (Frontend Bundle, Shortcode & Block) can both build on this verified contract with confidence that the wire shape works against the real vendor, not just an assumed shape.
- No outstanding blockers. The Composer toolchain gap (no `vendor/`, no `.gitignore`) that caused setup friction is now closed for any future local verification on a fresh machine.

---
*Phase: 06-php-backend-core-config-token-strategies-rest-contract*
*Completed: 2026-06-23*

## Self-Check: PASSED

All claimed files verified present:
- wordpress-plugin/tests/curl-verify.sh — FOUND
- wordpress-plugin/.gitignore — FOUND
- wordpress-plugin/composer.lock — FOUND
- wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php — FOUND
- wordpress-plugin/includes/Rest/SessionController.php — FOUND
- wordpress-plugin/tests/rest-logic-harness.php — FOUND
- .planning/phases/06-php-backend-core-config-token-strategies-rest-contract/06-04-SUMMARY.md — FOUND

All claimed commits verified present in git log:
- 0edf76c (Task 1: curl-verify.sh) — FOUND
- acb3b16 (worktree merge) — FOUND
- a378507 (bug fix) — FOUND
- cb9bf89 (.gitignore + composer.lock) — FOUND

Both standalone PHP harnesses re-run and confirmed passing at SUMMARY time:
- `php wordpress-plugin/tests/rest-logic-harness.php` — exit 0, 11/11 PASS
- `php wordpress-plugin/tests/token-provider-harness.php` — exit 0, 4/4 PASS
