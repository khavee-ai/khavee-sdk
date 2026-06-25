---
status: complete
phase: 08-frontend-bundle-shortcode-block
source: [08-04-SUMMARY.md, 08-UAT.md]
started: 2026-06-24T22:50:00Z
updated: 2026-06-25T16:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Front-end click-to-talk mic permission gating (EMBED-05, front-end side)
expected: On a page with `[khaveeai_avatar]`, the avatar renders in idle pose with a "Click to talk" button. No mic permission prompt or network token request fires until the button is clicked. After clicking, the browser's mic permission dialog appears and a request to the token route fires and succeeds.
result: pass
note: "Confirmed by the user on 2026-06-25 after the session_unavailable and model_not_found fixes — click-to-talk now connects end-to-end in a real browser."

### 2. Visual avatar render quality
expected: The VRM/GLB avatar renders correctly in the WebGL/Three.js canvas, with no console errors, on both the shortcode and Gutenberg block embeds.
result: pass
note: "Confirmed in 08-UAT.md Test 2 (2026-06-25) — passed by the user on both a shortcode page and a block page."

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
