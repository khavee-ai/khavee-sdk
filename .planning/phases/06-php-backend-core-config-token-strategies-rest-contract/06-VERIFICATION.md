---
phase: 06-php-backend-core-config-token-strategies-rest-contract
verified: 2026-06-23T10:45:00Z
resolved: 2026-06-23T11:30:00Z
status: passed
score: 5/5 must-haves verified (roadmap success criteria); 2/2 escalated code-review findings fixed
overrides_applied: 0
human_verification:
  - test: "Decide whether the CR-01 TOCTOU rate-limiter race condition (concurrent requests bypass per-IP/daily caps) must be fixed before Phase 6 is considered fully closed, or accepted as a tracked follow-up risk."
    expected: "Either: (a) a follow-up plan is opened to make RateLimiter's check-and-record atomic (e.g. try_reserve()/release()), or (b) an explicit override is recorded in this VERIFICATION.md accepting the risk for this milestone with a documented reason."
    why_human: "The live curl-verify.sh checkpoint only exercises sequential requests and cannot exercise concurrent-request races; whether this gap is acceptable for a v1/custom-mode milestone is a product risk-tolerance decision, not something grep/static analysis can resolve."
  - test: "Decide whether CR-02 (silent vendor/autoload.php absence leading to a sitewide fatal error on a fresh plugin install/distribution) must be fixed before Phase 7/8 build on top of this plugin, or tracked as a packaging follow-up."
    expected: "Either: (a) khaveeai.php is patched to fail gracefully (admin notice + early return) instead of registering a doomed plugins_loaded callback, or (b) an explicit override is recorded accepting the risk because all current verification happens on a machine where composer install has already been run."
    why_human: "This is a distribution/operations concern (what happens when a real site owner installs the zip without running composer install) that the phase's REST-01..04 success criteria do not directly test, but it does affect whether the plugin is safe to actually ship — a product/process decision."
---

# Phase 6: PHP Backend Core — Config/Token Strategies + REST Contract Verification Report

**Phase Goal:** A WordPress site can mint a real OpenAI Realtime ephemeral token for an anonymous visitor over a `curl`-testable REST route, with the OpenAI API key never leaving the server, and the config/token logic structured so a future platform-driven implementation can swap in later without touching this contract

**Verified:** 2026-06-23T10:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Anonymous curl POST to the WP REST token route returns a valid ephemeral OpenAI Realtime token, no login/nonce required | VERIFIED | `SessionController::register_routes()` registers `POST khaveeai/v1/session` with `'permission_callback' => '__return_true'` (no `wp_verify_nonce`/`is_user_logged_in`) — `wordpress-plugin/includes/Rest/SessionController.php:75-85`. Live-verified via `curl-verify.sh` against a real wp-env install + real OpenAI key during the 06-04 human checkpoint; user typed "APPROVE" after the fix in commit `a378507`. `wordpress-plugin/tests/rest-logic-harness.php` independently re-run by the verifier (not just trusted from SUMMARY) — exits 0, 11/11 PASS, including the success-response-shape case. |
| 2 | The OpenAI API key never appears in any REST response body, header, or page source | VERIFIED | `get_api_key()` is structurally isolated from `get_runtime_config()`'s return array (`WpOptionsConfigSource.php:54-85`); `SessionController::create_session()` only ever passes `$api_key` as a `mint_session()` argument, never into `$this->respond()` (`SessionController.php:139-177`). Harness case "API key string never appears in any response data or header (REST-02)" re-run by verifier — PASS. Live-verified in the 06-04 checkpoint via `curl-verify.sh` Check 2 against the real key. |
| 3 | Repeated rapid requests from the same IP are throttled (429) once a per-IP limit and daily cap are exceeded | VERIFIED (sequential) — **see escalation below for concurrent-request gap** | `RateLimiter::is_allowed()`/`record_mint()` implement two independent transient counters (`khaveeai_rl_{ip}` 5/10min, `khaveeai_daily_mints` 200/day) — `RateLimiter.php:73-106`. Harness re-run by verifier confirms 6th sequential request denied and daily-cap-at-200 denies regardless of per-IP count. Live-verified via `curl-verify.sh` Check 3 (7-request sequential loop, at least one 429) during the 06-04 checkpoint, user-approved. **However**, code review (06-REVIEW.md CR-01) found and the verifier independently confirmed in `SessionController.php:142-166` that `is_allowed()` is checked, then a ~10s network call to OpenAI happens, and only afterward is `record_mint()` called — no atomic reservation exists, so concurrent requests from the same IP (or many IPs against the sitewide cap) can all pass the check before any of them record a mint. The sequential curl test cannot exercise this race. This is escalated to human verification below rather than silently waved through, since it bears directly on this criterion's stated purpose ("rather than minting unlimited tokens"). |
| 4 | The token route's HTTP response includes `Cache-Control: no-store` | VERIFIED | `SessionController::respond()` sets `$response->header('Cache-Control', 'no-store')` on every success/error path — `SessionController.php:188-192`. Harness case re-run by verifier — PASS. Live-verified via `curl-verify.sh` Check 4 during the 06-04 checkpoint. |
| 5 | Config retrieval and token minting are each behind a swappable interface with exactly one concrete implementation each; REST controller depends only on interfaces | VERIFIED | `ConfigSourceInterface` (2 methods) and `TokenProviderInterface` (1 method) exist; exactly one concrete implementation of each found (`grep -rl "implements ConfigSourceInterface"` → `WpOptionsConfigSource.php` only; same for `TokenProviderInterface` → `OpenAiDirectTokenProvider.php` only). `SessionController.php` constructor type-hints `ConfigSourceInterface`/`TokenProviderInterface` and contains zero `new WpOptionsConfigSource`/`new OpenAiDirectTokenProvider` calls (grep confirms 0 matches). Concretes are instantiated only in `Plugin.php` (the composition root), which is the only file containing `new WpOptionsConfigSource()`/`new OpenAiDirectTokenProvider()`. |

**Score:** 5/5 roadmap success criteria VERIFIED as literally stated. Criterion 3's *sequential* behavior is proven; its *concurrent* robustness has a real, independently-confirmed gap that is escalated below rather than silently accepted.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php` | Two-method config strategy contract | VERIFIED | `php -l` clean; declares exactly `get_runtime_config(): array` and `get_api_key(): string`, no more |
| `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` | wp_options-backed concrete config source | VERIFIED | `php -l` clean; `implements ConfigSourceInterface`; reads `get_option('khaveeai_settings', [])`; `get_runtime_config()` body contains zero references to `api_key` |
| `wordpress-plugin/includes/TokenProvider/TokenProviderInterface.php` | One-method token-mint strategy contract | VERIFIED | `php -l` clean; declares exactly `mint_session(array $session_config, string $api_key): array` |
| `wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php` | wp_remote_post-based OpenAI minter | VERIFIED | `php -l` clean; posts to `https://api.openai.com/v1/realtime/client_secrets` wrapped under `session` key (fixed post-live-verification bug); `timeout => 10`; remaps `value` → `ephemeralToken`; throws detail-free `TokenMintException` on failure with one `error_log()` line |
| `wordpress-plugin/includes/RateLimit/RateLimiter.php` | Two-level transient counter, filterable thresholds | VERIFIED — with a wired but imperfect implementation (see CR-01 escalation) | `php -l` clean; `set_transient`/`get_transient`/`apply_filters` all present; per-IP key `khaveeai_rl_{ip}`, daily key `khaveeai_daily_mints`; `apply_filters` count = 2 (≥2 required) |
| `wordpress-plugin/includes/Rest/SessionController.php` | Public POST /khaveeai/v1/session controller | VERIFIED | `php -l` clean; `register_rest_route('khaveeai/v1', '/session', ...)` with POST-only + `__return_true`; constructor depends only on interfaces |
| `wordpress-plugin/includes/Plugin.php` | Composition root | VERIFIED | `php -l` clean; instantiates all three concretes, constructs `SessionController` with 3 args, registers `rest_api_init`; contains zero `apply_filters` for strategy selection |
| `wordpress-plugin/khaveeai.php` | Plugin bootstrap | VERIFIED — with a packaging-readiness gap (see CR-02 escalation) | `php -l` clean; `Plugin Name:`/`Requires PHP: 8.0` present; ABSPATH guard present; `Plugin::boot` wired to `plugins_loaded` |
| `wordpress-plugin/tests/token-provider-harness.php` | Standalone reshaping/failure harness | VERIFIED | Independently re-run by verifier: exit 0, 4/4 PASS, including the `LEAK_MARKER_SHOULD_NOT_APPEAR` absence assertion |
| `wordpress-plugin/tests/rest-logic-harness.php` | Standalone rate-limit + controller harness | VERIFIED | Independently re-run by verifier: exit 0, 11/11 PASS |
| `wordpress-plugin/tests/curl-verify.sh` | Live REST contract verification script | VERIFIED | `bash -n` clean; references `khaveeai/v1/session`, `no-store`, `429`, `ek_`-prefixed token check; cannot be re-executed by this verifier (no live WP+OpenAI environment available in this session), but was executed live during the 06-04 human checkpoint with a documented PASS-after-fix and explicit user "APPROVE" |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `Plugin.php` | `SessionController::register_routes` | `rest_api_init` hook | WIRED | `add_action('rest_api_init', array($session_controller, 'register_routes'))` present |
| `SessionController.php` | `TokenProviderInterface::mint_session` | constructor-injected interface call | WIRED | `$this->token_provider->mint_session($session_config, $api_key)` called inside try/catch on `TokenMintException` |
| `SessionController.php` | `ConfigSourceInterface::get_runtime_config` | trust-model instructions/voice injection | WIRED | `apply_trust_model()` calls `get_runtime_config()` and overwrites `instructions` + nested `audio.output.voice` before `mint_session()` is called — order confirmed by direct file read (line 100 inside `apply_trust_model`, called at line 157, before `mint_session` at line 160) |
| `WpOptionsConfigSource.php` | `get_option('khaveeai_settings')` | WP options read | WIRED | Literal `get_option(self::OPTION_NAME, [])` with `OPTION_NAME = 'khaveeai_settings'` |
| `OpenAiDirectTokenProvider.php` | `https://api.openai.com/v1/realtime/client_secrets` | `wp_remote_post` | WIRED | Literal endpoint constant; live-verified to actually round-trip a real `ek_`-prefixed token during the 06-04 checkpoint |
| `khaveeai.php` | `Plugin::boot` | `plugins_loaded` hook | WIRED — but fragile (see CR-02) | `add_action('plugins_loaded', array('\Khavee\Plugin\Plugin', 'boot'))` always registered, regardless of whether the preceding `vendor/autoload.php` require actually succeeded |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 8 production PHP files lint clean | `php -l` on each file | "No syntax errors detected" ×8 | PASS |
| Standalone rate-limit + controller harness | `php wordpress-plugin/tests/rest-logic-harness.php` | exit 0, 11/11 PASS (independently re-run, not trusted from SUMMARY) | PASS |
| Standalone token-provider harness | `php wordpress-plugin/tests/token-provider-harness.php` | exit 0, 4/4 PASS (independently re-run, not trusted from SUMMARY) | PASS |
| curl-verify.sh syntax | `bash -n wordpress-plugin/tests/curl-verify.sh` | no syntax errors | PASS |
| curl-verify.sh live execution against real WP+OpenAI | N/A | SKIP — no live WP/OpenAI environment available in this verification session; already executed live during the 06-04 human checkpoint (documented in 06-04-SUMMARY.md, commit `a378507`, user "APPROVE") | SKIP (substituted by prior human-verify checkpoint evidence, not re-faked) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| ARCH-01 | 06-01 | Config retrieval behind `ConfigSourceInterface` w/ one concrete implementation | SATISFIED | `ConfigSourceInterface.php` + `WpOptionsConfigSource.php` exist, exactly one concrete impl, `get_api_key()` never merged into `get_runtime_config()`. **Note:** `.planning/REQUIREMENTS.md` line 41/104 still shows this as unchecked `[ ]` / "Pending" in the traceability table — this is a stale tracking-doc inconsistency, not a code gap. Code evidence overrides the stale checkbox. |
| ARCH-02 | 06-02 | Token minting behind `TokenProviderInterface` w/ one concrete implementation | SATISFIED | `TokenProviderInterface.php` + `OpenAiDirectTokenProvider.php` exist, exactly one concrete impl, API key passed as parameter (never read from wp_options by the provider itself). Same stale-checkbox note as ARCH-01 applies (REQUIREMENTS.md line 42/105). |
| REST-01 | 06-03, 06-04 | Anonymous token mint, no login/nonce | SATISFIED | `permission_callback => '__return_true'`; live-verified | 
| REST-02 | 06-03, 06-04 | API key never transmitted to browser | SATISFIED | Structural isolation + harness + live verification |
| REST-03 | 06-03, 06-04 | Per-IP + daily cap rate limiting | SATISFIED for sequential traffic; **gap for concurrent traffic, escalated** | See Success Criterion 3 above and CR-01 escalation |
| REST-04 | 06-03, 06-04 | `Cache-Control: no-store` | SATISFIED | Header set on every response path; live-verified |

**Orphaned requirements check:** `.planning/REQUIREMENTS.md` maps exactly ARCH-01, ARCH-02, REST-01, REST-02, REST-03, REST-04 to Phase 6 (lines 98-105). All six appear in at least one plan's `requirements:` frontmatter field (06-01: ARCH-01; 06-02: ARCH-02; 06-03 and 06-04: REST-01..04). No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any Phase 6 PHP file | — | Clean — debt-marker gate does not trigger |
| `wordpress-plugin/includes/Rest/SessionController.php:142-166` | 142, 160, 166 | Check-then-act race: `is_allowed()` → ~10s network call → `record_mint()`, no atomic reservation | CRITICAL (carried forward from 06-REVIEW.md CR-01, independently re-confirmed by this verifier reading the file directly) | Concurrent requests from one IP (or many IPs against the sitewide cap) can all pass the rate-limit check before any records a mint, defeating the cost/abuse control the criterion exists to enforce |
| `wordpress-plugin/khaveeai.php:25-33` | 25-33 | Silent `file_exists()` guard around `vendor/autoload.php` require, followed by an unconditional `add_action('plugins_loaded', ['\Khavee\Plugin\Plugin', 'boot'])` | CRITICAL (carried forward from 06-REVIEW.md CR-02, independently re-confirmed: `vendor/` is `.gitignore`'d per `wordpress-plugin/.gitignore`, and `vendor/` is present locally only because `composer install` was run during the 06-04 live-verification session) | A fresh distribution of this plugin (zip upload or git checkout without a separate `composer install` step) will fatal-error the entire WordPress site on `plugins_loaded`, not just the avatar feature |
| `wordpress-plugin/includes/Rest/SessionController.php:152-157` | 152-157 | No payload size/depth cap on the public `sessionConfig` body (06-REVIEW.md WR-01) | WARNING | Defense-in-depth gap, not a contradiction of any stated success criterion — noted, not escalated |
| `wordpress-plugin/includes/Rest/SessionController.php:140`, `RateLimiter.php:114-116` | 140 | Empty/unset `REMOTE_ADDR` collapses into one shared rate-limit bucket (06-REVIEW.md WR-02) | WARNING | Edge-case correctness issue under proxy misconfiguration, not contradicted by any roadmap criterion — noted, not escalated |
| `wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php:83-97` | 83-97 | `ephemeralToken` returned without an explicit `string` cast despite documented contract (06-REVIEW.md WR-03) | WARNING | Type-contract looseness, not currently exploitable given OpenAI's actual response shape — noted, not escalated |
| `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php:54-85` | 54, 78 | `get_option()` called twice per request (06-REVIEW.md WR-04) | WARNING (minor) | Maintainability/perf smell only — noted, not escalated |

## Human Verification Required

### 1. CR-01 — Rate-limiter TOCTOU race condition: fix now or accept as tracked risk?

**Test:** Review `wordpress-plugin/includes/Rest/SessionController.php:142-166` and `wordpress-plugin/includes/RateLimit/RateLimiter.php`. Confirm whether the current check-then-act pattern (`is_allowed()` → network call → `record_mint()`) is an acceptable risk for this milestone, or must be closed before Phase 6 is considered done.
**Expected:** A decision recorded either as (a) a follow-up plan to make the rate-limit check+record atomic, or (b) an explicit override added to this VERIFICATION.md's frontmatter accepting the residual risk with a documented reason and acceptor.
**Why human:** This is a risk-tolerance/product decision about acceptable abuse exposure on a billable, anonymous, public endpoint — not something that can be resolved by reading code or running a script. The live curl-verify.sh checkpoint already passed (sequential traffic only) and the user already typed "APPROVE" for that scope; this finding emerged afterward in code review and was never weighed against the original approval.

### 2. CR-02 — Silent vendor/autoload.php absence causing a sitewide fatal crash on fresh installs

**Test:** Review `wordpress-plugin/khaveeai.php:22-33`. Confirm whether the current behavior (silent no-op on missing `vendor/autoload.php`, followed by an unconditional `plugins_loaded` registration that will fatal-error) is acceptable to carry into Phase 7/8, or must be patched first.
**Expected:** A decision recorded either as (a) a quick follow-up fix making the bootstrap fail gracefully with an admin notice instead of fatal-erroring, or (b) an explicit override accepting the risk because all verification to date has happened on a machine where `composer install` was already run, and packaging/distribution hardening is explicitly out of scope until a later milestone.
**Why human:** This is a packaging/release-process decision (does the plugin need to "just work" when site owners install it via the normal WP flow, today, or is that deferred) that the phase's stated success criteria don't directly address, but which materially affects whether Phase 7/8 are building on a deployable foundation.

## Gaps Summary

Both escalated items are genuine, independently-reproduced findings from `06-REVIEW.md` (not narrative claims) — I read `SessionController.php` and `khaveeai.php` directly and confirmed both code patterns exist exactly as the review describes. Neither is contradicted by any later-phase roadmap goal (Phase 7 = admin settings page; Phase 8 = frontend bundle/shortcode/block — neither phase's stated success criteria touch rate-limiter concurrency or plugin packaging), so neither qualifies as a "deferred" item under Step 9b.

At the same time, neither finding falsifies the *literal* wording of the five ROADMAP success criteria as stated and tested: the live curl checkpoint (sequential traffic) genuinely passed and was genuinely human-approved, and "future platform-driven implementation can swap in... without touching this contract" is genuinely true today (interfaces exist, single concrete impls, controller depends only on interfaces). This is why the status is `human_needed` rather than `gaps_found`/BLOCKER — the gaps are real and consequential, but they sit in the space between "did the phase literally achieve what the roadmap asked" (yes) and "is this production-hardened against concurrent abuse and zero-touch distribution" (not yet, and that's a judgment call the developer should make explicitly rather than have silently waved through or silently blocked).

Separately, `.planning/REQUIREMENTS.md` has a stale tracking inconsistency: ARCH-01/ARCH-02 are shown as unchecked `[ ]` and "Pending" in the traceability table (lines 41-42, 104-105) even though the code evidence in this report shows both are genuinely implemented. This is a documentation-sync issue, not a code gap, and does not block phase completion — but the traceability table should be updated to "Complete" alongside REST-01..04 when this phase closes.

## Resolution

Both escalated items were resolved by user direction ("fix both now") rather than deferred. Full detail in `06-HUMAN-UAT.md`.

- **CR-01:** `SessionController::create_session()` now calls `RateLimiter::record_mint()` immediately after `is_allowed()` passes, before the OpenAI network call, instead of only after a successful mint. Shrinks the check-then-act race window from the full ~10s round-trip to in-process instructions, and closes the related gap where always-failing flood traffic never counted against the cap. Regression test added (`rest-logic-harness.php` Case 8b). Fixed in commit `bbb962f`.
- **CR-02:** `khaveeai.php` now shows an `admin_notices` warning and returns early when `vendor/autoload.php` is missing, instead of registering `plugins_loaded` against an undefined class. Fixed in commit `bbb962f`.
- Both standalone harnesses re-run after the fix: 11/11 and 4/4 PASS.
- Live `curl-verify.sh` re-run against the real WP install + real OpenAI key after the fix: 5/5 PASS, no regression (REST-03 still throttles correctly at the 5-mint per-IP boundary).
- `.planning/REQUIREMENTS.md` ARCH-01/ARCH-02 stale checkboxes corrected to `[x]`/"Complete".

Status updated to `passed`.

---

_Verified: 2026-06-23T10:45:00Z_
_Resolved: 2026-06-23T11:30:00Z_
_Verifier: Claude (gsd-verifier)_
