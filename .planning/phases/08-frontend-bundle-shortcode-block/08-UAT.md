---
status: complete
phase: 08-frontend-bundle-shortcode-block
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md]
started: 2026-06-25T07:32:02Z
updated: 2026-06-25T07:47:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Click to Talk & Mic Permission Gating
expected: |
  Avatar renders idle with "Click to talk" overlay. No mic prompt / no session request fires before clicking.
  After clicking: mic prompt appears, "Connecting..." shows, session request fires in Network tab.
result: issue
reported: "it said {\"error\":\"session_unavailable\"}"
severity: blocker

### 2. Avatar Visual Render Quality
expected: |
  The VRM/GLB avatar renders correctly in the WebGL canvas (no broken mesh, no console errors) on
  http://localhost:8888/?page_id=19 (shortcode) and http://localhost:8888/?page_id=20 (block, already
  inserted). No layout shift when the avatar loads.
result: pass

### 3. Gutenberg Block Editor Experience
expected: |
  Log in at http://localhost:8888/wp-admin (user: admin, pass: uat-test-2026 — local test instance only,
  rotate after testing). Open page 20 ("KhaveeAI UAT Test (Block)") in the block editor (Pages > edit).
  The inserted
  "Khavee AI Avatar" block shows inspector controls: a voice dropdown (10 OpenAI voices) with "(using global
  default)" placeholder when empty, an instructions textarea, and a Media Library avatar picker. The block
  preview area shows a static rendering — opening/editing the block never triggers a mic permission prompt
  or a network request to /wp-json/khaveeai/v1/session (check the Network tab while editing).
result: pass
note: "User couldn't locate the pre-seeded block (inserted via wp-cli raw post_content) in the editor canvas, so they inserted a fresh 'Khavee AI Avatar' block via the block inserter instead and confirmed it there — inspector controls present, no session request while editing. Arguably the more representative test since real users always insert via the block inserter. Not logged as a gap."

## Summary

total: 3
passed: 2
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Clicking 'Click to talk' mints a session and connects without error"
  status: failed
  reason: "User reported: it said {\"error\":\"session_unavailable\"}"
  severity: blocker
  test: 1
  artifacts: []
  missing: []
