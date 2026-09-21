---
phase: 18-facial-performance-eyes-visemes-emotion
plan: 03
subsystem: animation
tags: [viseme, lip-sync, vrm-expressions, react, tts, coarticulation, jaw-motion]

# Dependency graph
requires:
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 01
    provides: "additiveBone.ts (createAdditiveBoneSlot/applyAdditiveDelta), types.ts jaw role"
provides:
  - "PhonemeData.source/wordBoundary in @khaveeai/core, and a vendor-neutral TTSProvider.speak onViseme callback"
  - "GenericPipelineProvider forwards TTS onViseme events to onPhonemeDetected tagged source 'timing', dropped once the turn is aborted"
  - "react viseme.ts: VisemeChannel, sampleTimeline (coarticulation + anticipation), stepViseme (hybrid selection, debounce/carryover, additive jaw), useViseme"
affects: [18-04-facial-performance-controller-wiring, 18-05-khaveeprovider-emotion-context]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chained-contiguous lookahead for a boost/effect that must stay continuous across a boundary shorter than the effect's own window (findAnticipationBoost), rather than a single-immediate-neighbor check"
    - "Hybrid vendor-timing-vs-audio-analysis selection with a hard priority order (timing wins whenever it covers now) plus a debounce+decaying-carryover fallback for the always-available analysis path"
    - "Plain mutable event-sink object (VisemeChannel) fed at analyzer frequency, never React state — mirrors gaze.ts/eyeGaze.ts's state-object convention"

key-files:
  created:
    - packages/react/src/animation/viseme.ts
    - packages/react/src/animation/viseme.test.ts
  modified:
    - packages/core/src/types/audio.ts
    - packages/core/src/types/pipeline.ts
    - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
    - packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts

key-decisions:
  - "Lip-rounding anticipation walks forward through a chain of mutually contiguous timeline entries (stopping at a real >50ms gap) instead of checking only the immediate next entry, because the immediate-neighbor version produced a real discontinuity when a short segment's own duration is less than ANTICIPATION_MS (120ms) — the boost would snap on the instant a short segment began instead of ramping in continuously from the segment before it"
  - "react's viseme.ts imports only PhonemeData/MouthState from @khaveeai/core (both exist in the published 0.1.5 this package resolves) and defines the Phase 18 timing fields locally as TimedPhoneme, per the plan's packaging constraint"
  - "GenericPipelineProvider's onViseme forwarder is tested via provider.interrupt() to simulate barge-in rather than the VAD onUtteranceReady path, because micEnabled is already false by the time tts.speak() runs, so a second VAD utterance is silently dropped and never exercises the abort-drop behavior the test targets"

requirements-completed: [VIS-01, VIS-02, VIS-03]
requirements-partial: [VIS-04]  # ownership rule proven by tests here; @deprecated marker lands in 18-05

# Metrics
duration: ~24min
completed: 2026-09-21
---

# Phase 18 Plan 03: Viseme Lip-Sync Layer (Timing Interface + Hybrid Channel) Summary

**Vendor-neutral TTS viseme-timing interface threaded end-to-end to GenericPipelineProvider's onPhonemeDetected, plus a react viseme.ts module that blends timing/audio-analysis mouth shapes with continuous coarticulation, debounced fallback, and additive capped jaw motion.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-09-21T10:57:32+07:00 (branch base)
- **Completed:** 2026-09-21T11:20:45+07:00
- **Tasks:** 2/2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- `PhonemeData` (in `@khaveeai/core`) gains optional `source: "timing" | "audio-analysis"` and `wordBoundary` fields — no parallel `VisemeEvent`/`VisemeData` type was invented (RESEARCH Pitfall 6), verified by a repo-wide grep returning zero matches.
- `TTSProvider.speak`'s options gain a vendor-neutral `onViseme?: (viseme: PhonemeData) => void` callback (Phase 18 VIS-01). No adapter was touched — none has timing data today (RESEARCH Pitfall 1) — verified by `openai-stt-tts`/`openai-realtime` diffing empty and no adapter file referencing `onViseme`.
- `GenericPipelineProvider` forwards `tts.speak`'s `onViseme` events to its own `onPhonemeDetected`, tagging `source: "timing"` when the adapter didn't set one, and drops any event that arrives after the turn's `AbortSignal` is aborted (T-18-08) — proven by 4 new tests, including a real barge-in scenario via `interrupt()`.
- `packages/react/src/animation/viseme.ts`: a hybrid mouth-shape channel — `VisemeChannel` (plain mutable event sink, capped at 256 timeline entries, pruned per frame), `sampleTimeline` (coarticulated boundary blending with a continuous cosine window and lip-rounding anticipation), and `stepViseme` (hybrid timing-vs-analysis selection, 40ms debounce + decaying carryover for the analysis fallback, and additive non-accumulating jaw rotation capped at 10°). 22 new tests cover every specified behavior.
- Found and fixed a real discontinuity in the anticipation design during TDD: a single-immediate-neighbor lookahead made the "ou" anticipation boost snap on/off abruptly at the aa/ee boundary in the plan's own 3-phoneme fixture, because `ee`'s 100ms duration is shorter than the 120ms anticipation window. Fixed by chaining the lookahead through contiguous entries (stopping only at a real >50ms gap) so the same upcoming "ou" is found — and the same distance-based boost applied — on both sides of the boundary.
- Full verification green: `@khaveeai/core` build + 23 tests, `generic-stt-tts` 19/19 tests + `tsc --noEmit` clean, `@khaveeai/react` 279/279 tests (22 new) + `tsc --noEmit` clean, `openai-stt-tts`/`openai-realtime` untouched (`git diff --quiet`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Vendor-neutral timing interface in core + GenericPipelineProvider forwarding** - `ac3b080` (feat)
2. **Task 2: viseme.ts hybrid channel, coarticulation, analysis debouncing, additive jaw** - `9acc7ae` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `packages/core/src/types/audio.ts` - `PhonemeData.source`/`wordBoundary`, with JSDoc documenting the absolute `performance.now()`-clock convention for timing timestamps
- `packages/core/src/types/pipeline.ts` - `TTSProvider.speak`'s `opts.onViseme` callback, vendor-neutral per the file's own header rule
- `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` - forwards `tts.speak`'s `onViseme` to `onPhonemeDetected`, dropping post-abort events (T-18-08)
- `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` - 4 new tests: single-event forwarding, field preservation, no-timing fallback, abort-drop via `interrupt()`
- `packages/react/src/animation/viseme.ts` - `TimedPhoneme`, `VISEME_KEYS`, `VISEME_SHAPES`, `timedToMouthTarget`, `analysisToMouthTarget` (verbatim-ported loudness curve), `VisemeChannel`/`createVisemeChannel`, `sampleTimeline` (+ `findAnticipationBoost` chained lookahead), `VisemeState`/`createVisemeState`, `stepViseme`, `useViseme`
- `packages/react/src/animation/viseme.test.ts` - 22 tests covering channel activity/sorting/capping/pruning, coarticulation boundary math (mid-segment, exact-boundary 50/50, continuity, anticipation, gap-silence, [0,1] bounds), hybrid selection, debounce, carryover decay, stale-analysis decay, jaw bounds/direction/non-accumulation/no-bone-fallback, and ownership (never-pushed, release-writes-zero-once, null-expression-manager)

## Decisions Made

- Lip-rounding anticipation uses a chained-contiguous-entry lookahead (`findAnticipationBoost`) instead of checking only the immediate next timeline entry, to guarantee continuity across a boundary immediately preceding a short segment whose own duration is less than the anticipation window. Documented in the module's JSDoc with the exact discontinuity scenario it fixes.
- `viseme.ts` imports only `PhonemeData`/`MouthState` from `@khaveeai/core` (both present in the published npm 0.1.5 this package resolves) and locally defines `TimedPhoneme` with the Phase 18 timing fields, per the plan's packaging constraint — it does not depend on this same plan's `audio.ts` core change reaching react at runtime.
- The `GenericPipelineProvider` abort-drop test drives barge-in via `provider.interrupt()` rather than a second VAD `onUtteranceReady` call, because `micEnabled` is already set `false` before `tts.speak()` runs (mirroring existing provider behavior), so a second VAD utterance during TTS playback is silently dropped by the VAD-callback's own `micEnabled` guard and would never reach the code path under test.

## Deviations from Plan

None outside the two self-corrected TDD findings below (both caught by the plan's own behavior specification before either commit, not scope creep):

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a real coarticulation-anticipation discontinuity found via TDD**

- **Found during:** Task 2, writing `sampleTimeline`'s continuity test (T+99.9 vs T+100.1)
- **Issue:** The initial anticipation implementation checked only the immediate next timeline entry for `"ou"/"oh"`. With the plan's own 3-phoneme fixture (`aa[0,100) -> ee[100,200) -> ou[200,300)`), `ee`'s 100ms duration is shorter than `ANTICIPATION_MS` (120ms), so the boost snapped on abruptly the instant `now` crossed into the `ee` segment (whose immediate next is `ou`) while being one tick earlier — still in `aa`, whose immediate next is `ee`, not `ou` — saw no boost at all. Continuity test failed: diff of 0.0502 at the aa/ee boundary versus the required < 0.02.
- **Fix:** Replaced the single-neighbor check with `findAnticipationBoost`, which walks forward through a chain of mutually contiguous entries (stopping at a real >50ms gap) to find the nearest upcoming `"ou"/"oh"` entry regardless of how many non-rounding entries lie between "now" and it. The same upcoming `ou` is now found — and the same distance-based boost applied — on both sides of the aa/ee boundary.
- **Files modified:** `packages/react/src/animation/viseme.ts`
- **Verification:** `viseme.test.ts`'s continuity test now passes (diff ~0.0005); the anticipation-boost test (T+190) and the gap-silence test are unaffected (the early-return for real >50ms gaps still fires before the anticipation lookahead is ever reached).
- **Committed in:** `9acc7ae` (part of Task 2's single commit — found and fixed before commit, not a separate follow-up commit)

---

**Total deviations:** 1 auto-fixed (1 bug, found and fixed within Task 2 before its commit)
**Impact on plan:** Necessary for correctness against the plan's own literal continuity requirement. No scope creep — the fix stayed entirely within `sampleTimeline`'s existing responsibility.

## Issues Encountered

None beyond the anticipation discontinuity documented above, which TDD caught before any commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `viseme.ts`'s `VisemeChannel`/`stepViseme`/`useViseme` are fully built and unit-tested but **not yet instantiated or wired** into `KhaveeProvider`/`useRealtime`/the animation controller — per this plan's objective, that integration (feeding the channel from `useRealtime`'s existing analyzer output plus the new `onPhonemeDetected` timing events, and calling `useViseme().step()` from the shared per-frame controller update) is explicitly deferred to 18-04/18-05.
- The timing path (`pushTimed`/`sampleTimeline`/`hasTimingAt`) is real, tested code but not yet exercised end-to-end with a live vendor — no TTS adapter in this repo emits phoneme timing today (RESEARCH Pitfall 1). The audio-analysis path is the one that will visibly improve lip-sync once wired.
- `packages/providers/openai-stt-tts` and `packages/providers/openai-realtime` remain byte-for-byte untouched, confirmed via `git diff --quiet` in this plan's own verification.
- No blockers for 18-04/18-05.

## Self-Check: PASSED

All 6 created/modified files verified present on disk; both commit hashes
(`ac3b080`, `9acc7ae`) verified present in `git log --oneline`.

---
*Phase: 18-facial-performance-eyes-visemes-emotion*
*Completed: 2026-09-21*
