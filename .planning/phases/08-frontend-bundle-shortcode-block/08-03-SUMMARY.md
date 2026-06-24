---
phase: 08-frontend-bundle-shortcode-block
plan: 03
subsystem: api
tags: [php, wordpress-rest, security, allowlist-validation, openai-realtime]

# Dependency graph
requires:
  - phase: 06-php-backend-rest-session
    provides: "SessionController::apply_trust_model() and the D-07 jailbreak-closure trust boundary"
  - phase: 07-admin-settings-page
    provides: "CR-01/CR-01-NEW strict in_array(..., true) allowlist-validation precedent in Admin/SettingsPage.php::sanitize_settings()"
provides:
  - "apply_trust_model() honors a per-instance voice/instructions candidate read out of the incoming sessionConfig when allowlist/cap-valid, else forces global config"
  - "ALLOWED_VOICES (10-voice allowlist) and MAX_INSTRUCTIONS_LENGTH (2000-char cap) constants on SessionController"
  - "rest-logic-harness.php D-05 regression coverage: honored-override and rejected-override cases for both voice and instructions, plus a no-usable-override regression guard for the unchanged Phase 6 D-07 path"
affects: [08-frontend-bundle-shortcode-block, 08-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Validate-candidate-first allowlist/cap pattern: read candidate value out of untrusted input, validate with strict in_array(..., true) or a length-cap predicate BEFORE branching on whether an override was requested, fallback re-validated source of truth is the admin global config (mirrors Admin/SettingsPage.php CR-01 precedent)"
    - "Per-instance overrides ride inside the SAME wire field already being forced (sessionConfig.audio.output.voice / sessionConfig.instructions) rather than introducing a new instanceOverrides field — minimizes attack surface and avoids a second untrusted-input parser"

key-files:
  created: []
  modified:
    - wordpress-plugin/includes/Rest/SessionController.php
    - wordpress-plugin/tests/rest-logic-harness.php

key-decisions:
  - "apply_trust_model() signature stays single-argument (array $session_config) — no instanceOverrides parameter, no new wire field; overrides are read out of the same sessionConfig fields the bundle already sends"
  - "Voice allowlist mirrors Admin/SettingsPage.php::VOICES exactly (10 OpenAI Realtime voices) rather than introducing a second list to maintain"
  - "Instructions cap set to 2000 chars per plan spec — reduces prompt-injection blast radius but does not content-filter within the cap (accepted residual risk, T-08-10)"
  - "Rejected overrides fail closed silently — no distinct error code/message is ever surfaced, preserving the existing generic-error convention (D-09-style)"

patterns-established:
  - "D-05 override validation pattern: candidate-extract -> strict-validate -> fallback-to-global, applied identically to both voice (allowlist) and instructions (length cap) inside apply_trust_model()"

requirements-completed: [EMBED-02]

# Metrics
duration: 24min
completed: 2026-06-24
---

# Phase 08 Plan 03: SessionController D-05 Override Validation Summary

**SessionController::apply_trust_model() now honors an allowlist/cap-validated per-instance voice/instructions override carried inside the bundle's existing sessionConfig payload, closing EMBED-02's security half while keeping the Phase 6 D-07 jailbreak protection byte-for-byte unchanged.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-06-24T21:49:00Z (approx, prior to file reads)
- **Completed:** 2026-06-24T22:13:21Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `apply_trust_model()` reads a candidate voice from `$session_config['audio']['output']['voice']` and a candidate instructions string from `$session_config['instructions']` — the exact fields `OpenAIRealtimeProvider.connect()` already populates from its `RealtimeConfig.voice`/`.instructions` — and honors each only when it passes strict validation (`in_array(..., self::ALLOWED_VOICES, true)` for voice; non-empty and `<= self::MAX_INSTRUCTIONS_LENGTH` for instructions).
- Added `ALLOWED_VOICES` (10-voice allowlist, source of truth `packages/core/src/types/realtime.ts`, mirroring `Admin/SettingsPage.php::VOICES`) and `MAX_INSTRUCTIONS_LENGTH = 2000` as private constants on `SessionController`.
- No new wire field introduced: `apply_trust_model()` keeps its single-argument signature; `create_session()` is unchanged in shape, still reading only `sessionConfig` and calling `apply_trust_model()` with one argument before `mint_session()`.
- Extended `rest-logic-harness.php` with 6 SessionController cases (1 regression rewrite + 5 new) proving: the no-usable-override path is unchanged from Phase 6, an allowlisted voice override is honored, a non-allowlisted/malicious voice override is rejected and falls back, a within-cap instructions override is honored, an over-cap instructions override is rejected and falls back, and a client-sent top-level `voice` is still dropped even alongside a valid `audio.output.voice` override.
- All 17 harness cases pass; `php -l` clean on the modified controller file.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend apply_trust_model() to honor allowlist/cap-valid voice & instructions read from the incoming sessionConfig** - `67b4b41` (feat)
2. **Task 2: Extend rest-logic-harness.php with D-05 sessionConfig-override-validation cases** - `55c7fb1` (test)

**Plan metadata:** (this commit, follows)

_Note: tasks were planned `tdd="true"` but executed in a feat-then-test order rather than strict RED-then-GREEN — see TDD Gate Compliance below._

## Files Created/Modified
- `wordpress-plugin/includes/Rest/SessionController.php` - Added `ALLOWED_VOICES`/`MAX_INSTRUCTIONS_LENGTH` constants; `apply_trust_model()` now reads, validates, and conditionally honors a per-instance voice/instructions candidate from the incoming `sessionConfig` before forcing the (validated-or-global) values into `audio.output.voice`/`instructions`
- `wordpress-plugin/tests/rest-logic-harness.php` - Rewrote Case 5 (D-07 regression) to use an over-cap instructions string and non-allowlisted voice (since 'echo' and short strings are now legitimately honored); added Cases 5b-5f covering honored/rejected voice override, honored/rejected instructions override, and the client top-level `voice` drop

## Decisions Made
- Followed the plan's explicit instruction that `apply_trust_model()`'s signature must stay single-argument and that no `instanceOverrides` wire field be introduced — this supersedes an earlier `$instance_overrides` second-parameter sketch that appeared in 08-PATTERNS.md/08-RESEARCH.md (those documents predate the plan's final, more specific design; the PLAN.md text is authoritative and was followed).
- Rewrote the pre-existing Case 5 test input rather than leaving it unchanged: its original "client-sent" values (`voice: 'echo'`, `audio.output.voice: 'echo'`, and a short instructions string) are all now legitimately honorable under D-05's allowlist/cap validation, so the original assertion (always global-forced) would have failed for the right reason — the test needed a non-allowlisted voice and an over-cap instructions string to remain a true regression guard for the no-usable-override path, distinct from the new honored-override cases.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing harness Case 5 would have failed against the new (correct) behavior**
- **Found during:** Task 2 (extending rest-logic-harness.php)
- **Issue:** The original Case 5 fixture sent `voice: 'echo'` / `audio.output.voice: 'echo'` (allowlisted) and a short instructions string (within-cap) as its "malicious client" input, asserting these would always be overwritten by the global config. Under the new D-05 validation those are exactly the inputs that SHOULD now be honored, so running the harness unmodified against the new SessionController.php failed Case 5 — not because the implementation was wrong, but because the test's own input no longer represented an "unusable" override under the new rules.
- **Fix:** Rewrote Case 5's input to use an over-cap (3000-char) instructions string and a non-allowlisted voice string, restoring it as a true no-usable-override regression guard, and added separate Cases 5b-5f to cover the newly-honorable allowlisted/within-cap paths explicitly.
- **Files modified:** wordpress-plugin/tests/rest-logic-harness.php
- **Verification:** `php wordpress-plugin/tests/rest-logic-harness.php` exits 0, "All cases PASSED." (17/17)
- **Committed in:** 55c7fb1 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug-class: stale test fixture invalidated by an intentional behavior change)
**Impact on plan:** Necessary correctness fix to keep the regression suite meaningful; no scope creep — the new cases were already specified by the plan's acceptance criteria, only the rewritten Case 5 input was not explicitly anticipated in the plan text.

## Issues Encountered
None beyond the Case 5 fixture rewrite documented above.

## TDD Gate Compliance

Both tasks were marked `tdd="true"` in the plan, but the plan structured them as two sequential tasks — Task 1 (implementation) then Task 2 (test harness extension) — rather than a single RED/GREEN/REFACTOR cycle. Git log for this plan shows:

```
55c7fb1 test(08-03): add D-05 sessionConfig override validation cases to rest harness
67b4b41 feat(08-03): honor allowlisted voice/instructions overrides from sessionConfig
```

This is `feat` then `test`, not the canonical `test` (RED) then `feat` (GREEN) order. The implementation (Task 1) was written and verified via `php -l` and manual behavior reasoning against the plan's `<behavior>` block before the harness cases (Task 2) were added; the harness cases were then run and passed on the first attempt against the already-written implementation (no RED phase was observed). This was a plan-structuring choice (each task is a complete, independently-committable unit per the plan's task breakdown) rather than an executor deviation from the plan's own task sequencing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- EMBED-02's security half (D-05 override validation) is complete and harness-verified; EMBED-02's client-side half (shortcode/block attribute parsing and the `wp_parse_args()` merge into per-instance config) remains in other 08-xx plans.
- No blockers introduced for subsequent Phase 8 plans. The `SessionController` change is additive and backward-compatible: any sessionConfig with no usable override produces identical output to Phase 6, so plans/bundles that don't yet send per-instance overrides are unaffected.

---
*Phase: 08-frontend-bundle-shortcode-block*
*Completed: 2026-06-24*

## Self-Check: PASSED

- FOUND: wordpress-plugin/includes/Rest/SessionController.php
- FOUND: wordpress-plugin/tests/rest-logic-harness.php
- FOUND: .planning/phases/08-frontend-bundle-shortcode-block/08-03-SUMMARY.md
- FOUND: commit 67b4b41 (Task 1 - feat)
- FOUND: commit 55c7fb1 (Task 2 - test)
- FOUND: commit e87e9ec (docs - SUMMARY.md)
- VERIFIED: `php -l wordpress-plugin/includes/Rest/SessionController.php` clean
- VERIFIED: `php wordpress-plugin/tests/rest-logic-harness.php` exits 0, 17/17 cases PASSED
