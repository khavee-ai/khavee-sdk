---
phase: quick-260709-g4v
plan: 01
subsystem: wordpress-plugin/Platform
tags: [wordpress-plugin, platform-sync, personality-instructions, php-port]
dependency-graph:
  requires: []
  provides:
    - "PlatformClient::build_personality_instructions()"
  affects:
    - "wordpress-plugin/includes/Platform/PlatformClient.php"
    - "wordpress-plugin/tests/platform-config-harness.php"
tech-stack:
  added: []
  patterns:
    - "PHP port of a TypeScript composition function, kept in explicit parity via PHPDoc cross-reference"
key-files:
  created: []
  modified:
    - "wordpress-plugin/includes/Platform/PlatformClient.php"
    - "wordpress-plugin/tests/platform-config-harness.php"
decisions:
  - "Read personality['displayName'] (not personality['name']) since the platform API's sdk/preview endpoint already resolves that fallback server-side (project.controller.ts's displayName: p.displayName ?? p.personality?.name ?? null)"
  - "instructions key is emitted when EITHER personality is present OR voiceProfile.instructionPrompt is non-blank -- broadens the existing 'never blank a field' guard from a single source to two, but keeps the same intent"
metrics:
  duration: "~25 min"
  completed: "2026-07-09"
---

# Quick Task 260709-g4v: Platform Instructions Full Composition Fix Summary

Ported `khavee-app`'s `buildPersonalityInstructions()` composition logic into a new `PlatformClient::build_personality_instructions()` PHP method, fixing a bug where the WordPress plugin's synced "Instructions" field only ever reflected `voiceProfile.instructionPrompt` (a short voice-tone fragment) instead of the full personality+voice composed system prompt the platform actually uses for its own live sessions.

## What Was Built

### Task 1: `build_personality_instructions()` port + wiring (commit `10a8069`)

Added a new private static method to `PlatformClient` that composes the same 12-section instructions string as the TS source (`khavee-app/apps/web/src/utils/personalityInstructions.ts`'s `buildPersonalityInstructions()`), reading from `$data['personality']`, `$data['voiceProfile']`, and `$data['model']['displayName']`:

- Identity, Memory, Language & Voice, Thai Speech Rules (conditional on `voiceProfile.language === 'thai'`), Response Length, Personality, How to Talk, Hard Rules, If Someone Is Rude, Opening, Knowledge, Examples.
- All derived values (`personality_name`, `traits`, `mood`, `formality_style`, `emoji_rule`, `response_length_style`, `voice_instruction`, `background_story`, `examples`) mirror the TS source's nullish-coalescing/default logic exactly, using PHP's `isset()` (which is nullish-equivalent for array access) rather than falsy-checks.
- Section text was verified byte-for-byte against the actual sibling-repo source file (`/Users/whitemalt/Documents/khavee-app/apps/web/src/utils/personalityInstructions.ts`, read directly during this session) — not just the plan's `<interfaces>` excerpt — confirming the port is exact, including the Thai-language number/time/date rules block.
- `map_platform_fields()` now calls `self::build_personality_instructions($data)` and assigns it to `$fields['instructions']` only when `$personality` is non-null OR `voiceProfile.instructionPrompt` is non-blank — preserving the existing "never blank out a locally-configured field" contract, just with a broadened source check.
- The `$fields['voice']` mapping (from `voiceProfile.openaiVoice`) was left completely untouched.

### Task 2: Harness test updates (commit `305a627`)

- Rewrote the existing `'map_platform_fields: voiceProfile.instructionPrompt maps to instructions'` case (the confirmed-bug assertion) to assert composed behavior instead: contains the voice fragment, contains default markers (`Assistant`, `not specified`), and is NOT literally equal to the raw instructionPrompt string.
- Added 4 new cases: full composition with personality + Thai voiceProfile (asserts personality fields, voice fragment, and Thai Speech Rules marker all present); personality-only (voiceProfile absent, asserts the "Follow the voice settings naturally." default and that `instructions` is still emitted); neither present (asserts no `instructions` key); non-Thai language (asserts the Thai Speech Rules marker is absent).
- Also updated the `PlatformConfigSource: platform key set AND fetch ok` case, which independently asserted the old raw-passthrough value for `instructions` — this was a direct regression caused by the Task 1 change (not explicitly called out in the plan's task list, but squarely in scope per Rule 1) — to assert substring containment of the voice fragment instead of exact-match.
- Updated the file's header docblock line describing `map_platform_fields()`'s field-mapping table to reflect the new composed-instructions behavior.

## Verification

- `php -l wordpress-plugin/includes/Platform/PlatformClient.php` — clean.
- `php wordpress-plugin/tests/platform-config-harness.php` — all 31 cases pass, including the rewritten and 4 new `map_platform_fields:` cases and the updated `PlatformConfigSource` overlay case.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a second pre-existing harness test also asserting the raw-passthrough bug**
- **Found during:** Task 2 (running the harness after Task 1's change)
- **Issue:** `PlatformConfigSource: platform key set AND fetch ok -> mapped fields override, unmapped fields stay wrapped-unchanged` (line ~563) independently asserted `'From platform' === $result['instructions']` — an exact-match assertion of the same raw-passthrough behavior being fixed, in a section of the file the plan didn't explicitly name.
- **Fix:** Changed the assertion to `false !== strpos($result['instructions'], 'From platform')`, matching the same substring-containment pattern used for the Task 2 cases the plan did specify.
- **Files modified:** `wordpress-plugin/tests/platform-config-harness.php`
- **Commit:** `305a627`

## Live Verification (performed by orchestrator via Chrome browser automation)

Cleared the stale 5-minute platform-response transient (`wp transient delete khaveeai_platform_<hash>`) so the reload would reflect the new code, then confirmed in wp-env at `http://localhost:8888/wp-admin/admin.php?page=khaveeai-settings`:

- "Personality / Instructions" (Synced from Platform) now renders the full multi-section composed prompt — visibly starting with "## Identity You are zx. An energetic and positive personality. Traits: Energetic, Optimistic, Encouraging Mood: neutral..." through "## Language & Voice" (folding in the original short voice-tone line as one sentence, not the whole field), "### Thai Speech Rules" (confirmed present since this project's `voiceProfile.language === 'thai'`), Response Length, Personality, How to Talk, Hard Rules, If Someone Is Rude sections all visible in the textarea.
- This is a real, substantive change from the pre-fix behavior (previously showed only the one-line voice-tone fragment: "a friendly and approachable Thai man...") — confirms the bug is fixed, not just automated-test-passing.
- No PHP fatal errors or warnings on the page. Rest of the Settings page (Connection, Avatar, Floating Widget incl. the user's saved custom offset/scale/color values) renders normally — the fix is correctly scoped to the one field.

**Verdict: bug fixed and confirmed live**, in addition to full automated coverage (php -l, 31/31 harness cases).

## Self-Check: PASSED

- FOUND: wordpress-plugin/includes/Platform/PlatformClient.php (build_personality_instructions present)
- FOUND: wordpress-plugin/tests/platform-config-harness.php (updated cases present)
- FOUND: commit 10a8069
- FOUND: commit 305a627
