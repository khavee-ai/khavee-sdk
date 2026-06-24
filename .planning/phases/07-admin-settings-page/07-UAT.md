---
status: partial
phase: 07-admin-settings-page
source: [07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md]
started: 2026-06-24T12:47:17Z
updated: 2026-06-24T13:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Save and mask API key
expected: In wp-admin, navigate to the "Khavee AI Avatar" settings menu item. Enter a fake OpenAI API key (e.g. sk-test1234567890abcdef) in the API Key field and save. On page reload, the field shows it masked (e.g. sk-••••••cdef) — never the full key.
result: pass

### 2. Re-saving without touching the key field does not wipe it
expected: After Test 1, change only the personality instructions text (leave the masked API key field untouched) and save. On reload, the API key is still masked and present (not blanked) — confirms the masked-placeholder isn't mistaken for a new (empty) key.
result: pass

### 3. Removing the key via the dedicated control
expected: Check the "Remove key" checkbox and save. On reload, the API key field is empty and the "not configured" banner (Test 6) reappears — confirms deletion only happens through this explicit control, never via an emptied field.
result: pass

### 4. Personality instructions and voice persist
expected: Enter text in the Personality/Instructions textarea and select a voice from the dropdown. Save and reload — both the instructions text and the selected voice are exactly as entered/selected (dropdown shows the same voice selected, not reset to a default).
result: pass

### 5. Avatar upload via Media Library (valid .vrm/.glb)
expected: Click the avatar "Choose/Upload Avatar" button, which opens the WP Media Library/uploader. Upload a real, valid .vrm or .glb file. After upload and save, the settings page shows the avatar filename and upload date, and this persists across a page reload.
result: issue
reported: "cannot upload glb/vrm file. it said This file cannot be processed by the web server."
severity: major

### 6. Disguised file upload is rejected (ASSET-01)
expected: Take a non-VRM/GLB file (e.g. a text file or PHP file) and rename it to have a ".glb" or ".vrm" extension. Attempt to upload it via the avatar picker. The upload is rejected (not accepted into the Media Library) — WordPress should show a "not allowed" type error rather than silently accepting it.
result: pass
note: "PASS with caveat — disguised file IS rejected (security property holds), but with the SAME generic 'This file cannot be processed by the web server' error as the valid file in Test 5. This rejection is NOT coming from our magic-byte validation; it's the same upstream bug rejecting everything (valid and disguised alike). So this pass does not confirm the ASSET-01 validation is wired correctly — only that nothing malicious sneaks through (fail-closed behavior). Root cause shared with Test 5."

### 7. Oversized avatar upload is rejected
expected: Attempt to upload a .glb/.vrm file larger than 50MB via the avatar picker. The upload is rejected for exceeding the size limit.
result: pass
note: "PASS with caveat — oversized file IS rejected, but with the same generic 'This file cannot be processed by the web server' error (Test 5 bug), not our 50MB size-limit message. Same upstream failure; does not independently confirm the size limit works."

### 8. Remove avatar control
expected: With an avatar already set (from Test 5), check the "Clear avatar" checkbox and save. On reload, the avatar is gone — "No avatar configured" (or equivalent) is shown instead of the prior filename.
result: blocked
blocked_by: prior-phase
reason: "blocked, no avatar set"

### 9. "Not configured" banner reflects API key state
expected: With the API key unset (e.g. after Test 3, or on a fresh install), the settings page shows a "not configured" status banner. After entering and saving a valid-looking key (Test 1), the banner disappears.
result: pass

### 10. Capability gate — menu visibility
expected: Log in as (or simulate) a user WITHOUT the manage_options capability (e.g. an Editor or Subscriber role). The "Khavee AI Avatar" menu item does NOT appear in their wp-admin sidebar.
result: pass
note: "Editor user 'uateditor' created via wp-cli in wp-env for this test; menu correctly hidden for the editor role."

### 11. Capability gate — direct URL navigation
expected: As the same non-admin user from Test 10, navigate directly to the settings page URL (e.g. wp-admin/admin.php?page=khaveeai-settings) by typing it into the browser. The page does NOT render — WordPress shows a "Sorry, you are not allowed to access this page" (wp_die) screen instead.
result: pass

### 12. Voice dropdown only offers allowlisted values
expected: Open the voice dropdown on the settings page. It shows exactly the supported voice options (e.g. alloy, verse, coral, etc.) — a fixed list, no free-text entry possible through the UI. (This is the user-facing surface of the CR-01 allowlist fix from 07-04 — the dropdown itself was always a closed list; 07-04 hardened the server-side enforcement behind it.)
result: pass

## Summary

total: 12
passed: 10
issues: 1
pending: 0
skipped: 0
blocked: 1

## Gaps

```yaml
- truth: "Uploading a valid .vrm or .glb avatar file via the settings-page Media Library picker succeeds and persists"
  status: failed
  reason: "User reported: cannot upload glb/vrm file. it said This file cannot be processed by the web server."
  severity: major
  test: 5
  artifacts: []
  missing: []
```
