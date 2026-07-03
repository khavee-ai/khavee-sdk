# Deferred Items — Quick Task 260703-slv

Out-of-scope discoveries logged during plan execution. Not fixed; tracked for awareness only.

## 260703-slv-01: Pre-existing stale shape assertion in settings-page-harness.php

**Found during:** Task 1 verification (running `php wordpress-plugin/tests/settings-page-harness.php` as part of the plan's "existing render-logic-harness.php and settings-page-harness.php still pass" done criterion).

**Issue:** The case `'shape: get_runtime_config() returns exactly the keys {instructions, voice, avatar_url, model}'` (settings-page-harness.php, ~line 429) fails because `WpOptionsConfigSource::get_runtime_config()` has returned many more keys (`container_width`, `bg_type`, `light_intensity`, `camera_preset`, `chat_show`, etc., added by Phase 9 STUDIO-05) since before this quick task. Confirmed pre-existing by running the harness against the base commit (`80f1081`, prior to this task's changes) with no files under test modified — same single failure.

**Action:** Left untouched — out of scope for this task (scope boundary: only auto-fix issues directly caused by this task's changes; `WpOptionsConfigSource.php` was not modified by this plan).

**Recommendation:** Update the stale case's expected-key assertion to match the current `WpOptionsConfigSource::get_runtime_config()` return shape (or scope the assertion to a subset of "Phase 6 SessionController-relevant" keys) in a future task that touches `WpOptionsConfigSource`/`settings-page-harness.php`.
