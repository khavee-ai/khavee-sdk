---
phase: quick-260712-qvu
plan: 260712-qvu
subsystem: ui
tags: [vrm, glb, animation, shared-module]

requires:
  - phase: 10-shared-animation-architecture-crossfade-engine
    provides: resolveBaseClip / useAnimationController shared module
provides:
  - Naming-convention clip resolution for listening/thinking/starting/stopped chatStatus, extending the pattern speaking already used
affects: [phase-11-bone-masked-upper-body-animation-layering]

tech-stack:
  added: []
  patterns: ["Per-status clip-name regex table (STATUS_CLIP_PATTERNS) replacing the single-status hardcoded speaking check"]

key-files:
  created: []
  modified: [packages/react/src/animation/AnimationStateEngine.ts, packages/react/src/animation/AnimationStateEngine.test.ts]

key-decisions:
  - "Left 'ready' pattern-free (always falls through to currentAnimation/first-available) rather than inventing an idle-matching pattern — ready already behaves correctly as the default state, and adding a pattern risked overriding intentional manual animate() calls in that state"
  - "Chose to only extend the resolution mechanism, not source new clip files or modify the demo page — user explicitly picked 'extend the shared SDK module' over the demo-page-hack alternative, so no bundled clip in this repo will visually change today; this is foundational plumbing for future clip sets"

patterns-established:
  - "STATUS_CLIP_PATTERNS: Partial<Record<ChatStatus, RegExp>> — the reusable place to add naming-convention clip resolution for any future ChatStatus-driven behavior"

requirements-completed: []

duration: 7min
completed: 2026-07-12
---

# Quick Task 260712-qvu: Extend resolveBaseClip with per-status clip patterns Summary

**Generalized resolveBaseClip's single speaking-only clip-name pattern into a 5-status STATUS_CLIP_PATTERNS table (listening/thinking/starting/stopped added), with 7 new unit tests and zero regressions to the 9 pre-existing ones**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-12T19:20:00+07:00
- **Completed:** 2026-07-12T19:27:00+07:00
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Extracted the previously-hardcoded `if (chatStatus === "speaking") { .../talk|gesture|speak/i... }` check into a `STATUS_CLIP_PATTERNS: Partial<Record<ChatStatus, RegExp>>` table, then added 4 new entries: `listening: /listen/i`, `thinking: /think/i`, `starting: /welcome|greet|hello|intro/i`, `stopped: /stop|bye|goodbye|outro/i`
- `resolveBaseClip` now looks up the pattern for whatever `chatStatus` it's given, preferring a matching clip name over `currentAnimation` when one exists — exactly mirroring how `speaking` already worked, now shared across 5 statuses instead of 1
- `ready` intentionally left without a pattern — it already behaves correctly as the default/fallback state via `currentAnimation ?? availableNames[0] ?? null`
- Verified backward compatibility before implementing (documented in the plan's `<context>`): all 9 pre-existing tests were checked to still resolve to their exact original expected values under the new pattern table — confirmed true after implementation (all 9 pass unmodified)
- Added 7 new tests covering match-found and fallback-when-absent for each of the 4 new statuses (listening/thinking get both cases; starting/stopped's fallback case was effectively already covered by the pre-existing "returns currentAnimation when set" tests, so only match-found + one extra fallback were added where not already covered)

## Task Commits

1. **Task 1: Add a per-status clip-name pattern table to resolveBaseClip and cover it with unit tests** - `d304eee` (feat)

## Files Created/Modified
- `packages/react/src/animation/AnimationStateEngine.ts` - Added `STATUS_CLIP_PATTERNS`, rewrote `resolveBaseClip` to use it, updated docblocks
- `packages/react/src/animation/AnimationStateEngine.test.ts` - Added 7 new test cases; all 9 pre-existing cases unchanged

## Decisions Made
- Left `ready` without a pattern to avoid inventing an ambiguous idle-matching convention that could override intentional manual `animate()` calls while in the ready state
- Scoped strictly to the resolution mechanism per the user's explicit choice ("extend the shared SDK module") — did not source new clip files or touch the demo page, so `openai-avatar-test` will not show new visual states from this change alone

## Deviations from Plan
None - plan executed exactly as written, including the pre-verified backward-compatibility guarantee.

## Issues Encountered
None.

## User Setup Required
None.

## Next Phase Readiness
- The naming-convention mechanism is now ready for any future clip set: adding a file whose clip name contains "listen", "think", "welcome"/"greet", or "stop"/"bye" will automatically wire that status's animation with no further code changes.
- To get new visible states on `/openai-avatar-test` today, the user needs to source/add clips with those naming conventions (e.g. rename or add a clip containing "listen" for the listening state) and pass them in that page's `animations` config — this task deliberately did not do that, per the scope the user chose.
- Phase 11 (bone-masked-upper-body-animation-layering) remains the owner of richer per-state systems this task explicitly did not build: loop-boundary-driven cycling, minimum-duration enforcement for starting/stopped, multiple talk-clip variants.
