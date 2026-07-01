---
status: partial
phase: 11-bone-masked-upper-body-animation-layering
source: [11-VERIFICATION.md]
started: 2026-07-01T00:00:00Z
updated: 2026-07-01T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Custom animate() immediately followed by a DIFFERENT status-driven gesture
expected: Trigger the sequence idle -> developer custom `animate('someCustomKey')` -> a different status-driven gesture than whatever was active before the custom call (e.g. idle -> custom -> listening, where listening's upper clip differs from idle's). The upper body should crossfade smoothly (~0.3s fadeIn) into the new gesture's upper-body pose — not snap instantly. This exact sequence is what code-review finding WR-01 was about; the fix (`fadeScheduledThisPass` guard in `packages/react/src/VRMAvatar.tsx`) was applied during the code-review-gate step (commit `fe3a332`), after the original checkpoint had already been approved — so this specific sequence was never visually exercised by a human, only verified by static code tracing.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
