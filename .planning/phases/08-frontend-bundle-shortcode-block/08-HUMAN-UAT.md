---
status: partial
phase: 08-frontend-bundle-shortcode-block
source: [08-04-SUMMARY.md, 08-UAT.md]
started: 2026-06-24T22:50:00Z
updated: 2026-06-25T16:30:00Z
---

## Current Test

[awaiting human testing — item 1 only]

## Tests

### 1. Front-end click-to-talk mic permission gating (EMBED-05, front-end side)
expected: On a page with `[khaveeai_avatar]`, the avatar renders in idle pose with a "Click to talk" button. No mic permission prompt or network token request fires until the button is clicked. After clicking, the browser's mic permission dialog appears and a request to the token route fires and succeeds.
result: [pending]
note: "Two real blockers were found and fixed since this item was first opened: the session_unavailable bug (invalid temperature field) and a silently-dropped model setting (model_not_found). Server-side session minting is now independently confirmed live (curl + negative control), so this item is now narrowly about the actual browser click + mic-permission-dialog interaction, not the underlying connection."

### 2. Visual avatar render quality
expected: The VRM/GLB avatar renders correctly in the WebGL/Three.js canvas, with no console errors, on both the shortcode and Gutenberg block embeds.
result: pass
note: "Confirmed in 08-UAT.md Test 2 (2026-06-25) — passed by the user on both a shortcode page and a block page."

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
