---
status: partial
phase: 08-frontend-bundle-shortcode-block
source: [08-04-SUMMARY.md]
started: 2026-06-24T22:50:00Z
updated: 2026-06-24T22:50:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Front-end click-to-talk mic permission gating (EMBED-05, front-end side)
expected: On a page with `[khaveeai_avatar]`, the avatar renders in idle pose with a "Click to talk" button. No mic permission prompt or network token request fires until the button is clicked. After clicking, the browser's mic permission dialog appears and a request to the token route fires.
result: [pending]

### 2. Visual avatar render quality
expected: The VRM/GLB avatar renders correctly in the WebGL/Three.js canvas, with no console errors, on both the shortcode and Gutenberg block embeds.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
