---
phase: 18-facial-performance-eyes-visemes-emotion
plan: 05
subsystem: animation
tags: [react-context, emotion, viseme, lip-sync, tool-calling, deprecation]

# Dependency graph
requires:
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 02
    provides: "normalizeEmotionHint/EmotionHint in packages/react/src/animation/emotion.ts"
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 03
    provides: "VisemeChannel/createVisemeChannel/TimedPhoneme in packages/react/src/animation/viseme.ts, PhonemeData.source in @khaveeai/core"
provides:
  - "KhaveeContext.emotionHint/setEmotionHint: validated LLM-driven emotion hint reachable from app code and VRMAvatar"
  - "KhaveeContext.visemeChannel: one stable VisemeChannel instance per provider mount, fed from both audio-analysis and provider timing events"
  - "useRealtime routes provider.onPhonemeDetected into the channel (timing -> timeline, else -> analysis) while preserving any upstream subscriber"
  - "useAudioLipSync formally @deprecated with zero runtime change"
affects: [18-06-demo-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mirrored the existing gestureHint/setGestureHint precedent exactly for a second LLM-writable, app-code-outside-the-tree context field (emotionHint/setEmotionHint)"
    - "Dual-feed event sink: same VisemeChannel instance fed from two independent call sites (analyzer's onPhonemeDetected for audio-analysis, provider's onPhonemeDetected for vendor timing) with a hard source-tag priority"

key-files:
  created: []
  modified:
    - packages/react/src/KhaveeProvider.tsx
    - packages/react/src/hooks/useRealtime.ts
    - packages/react/src/hooks/useAudioLipSync.ts

key-decisions:
  - "prevChatStatusRef starts at \"stopped\" (not null) so the very first onChatStatusChange call after mount can never spuriously read as \"leaving speaking\""
  - "The analyzer's onPhonemeDetected pushes into visemeChannel directly (not through the existing rAF-coalescing pending refs), matching the plan's explicit instruction that the channel is not React state and the viseme step (18-03) already debounces/smooths on its own per-frame cadence"
  - "provider.onPhonemeDetected preservation follows the exact same capture-then-chain pattern already used for onChatStatusChange/onError in this file, for consistency and to satisfy T-18-12 (any existing upstream subscriber is invoked first)"

requirements-completed: [EMO-01, VIS-01, VIS-04]

# Metrics
duration: ~6min
completed: 2026-09-21
---

# Phase 18 Plan 05: KhaveeProvider Emotion + Viseme Context Wiring Summary

**KhaveeProvider now exposes a validated emotionHint/setEmotionHint pair and one stable VisemeChannel; useRealtime feeds that channel from both the audio analyzer (fallback) and provider timing events (primary), and useAudioLipSync is formally deprecated with no behavior change.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-09-21T11:26:03+07:00 (branch base)
- **Completed:** 2026-09-21T11:32:18+07:00
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments

- `KhaveeProvider.tsx` gains `emotionHint`/`setEmotionHint` (delegates entirely to `normalizeEmotionHint` from 18-02: strict 6-name allow-list, `[0,1]` intensity clamp with a 0.7 default, never throws — T-18-03) and one stable `visemeChannel` instance per provider mount, held via `useState(() => createVisemeChannel())` so 80Hz lip-sync pushes never trigger a re-render. Both mirror the existing `gestureHint`/`setGestureHint` precedent (public setter, since the writer is an LLM tool's `execute` outside the React tree).
- `useRealtime.ts` feeds the channel from two independent sources with a hard priority: the audio analyzer's `onPhonemeDetected` pushes every sample as `source: "audio-analysis"` directly (not rAF-coalesced — the channel isn't React state), and `provider.onPhonemeDetected` is wrapped to route `source: "timing"` events into the timeline (`pushTimed`) and everything else into analysis (`pushAnalysis`), while invoking any pre-existing upstream subscriber first (T-18-12).
- Lifecycle clearing: the channel is cleared on `onDisconnect` and on `stopAutoLipSync` unconditionally, and in `onChatStatusChange` only when `chatStatus` transitions away from `"speaking"` (tracked via a new `prevChatStatusRef`) — never on entering a non-speaking state, since vendor timing visemes can legitimately arrive before playback flips `chatStatus` to `"speaking"`.
- The legacy `phonemeToMouthState` -> `pendingExpressionUpdateRef` -> `setMultipleExpressions`/`setCurrentPhoneme` path is left completely untouched for backward compatibility.
- `useAudioLipSync.ts` gains a full `@deprecated` JSDoc block above its export, explaining the superseding viseme lip-sync layer and that the hook keeps working unchanged — verified as a comment-only diff (0 non-comment-line changes).

## Task Commits

Each task was committed atomically:

1. **Task 1: KhaveeProvider emotionHint/setEmotionHint + stable visemeChannel** - `7b92393` (feat)
2. **Task 2: useRealtime feeds the viseme channel (hybrid) + deprecate useAudioLipSync** - `cc09ebb` (feat)

**Plan metadata:** committed as part of this Summary's final commit (see below)

## Files Created/Modified

- `packages/react/src/KhaveeProvider.tsx` - `emotionHint`/`setEmotionHint`/`visemeChannel` added to `KhaveeContextType`, state, and Provider value, mirroring `gestureHint`'s existing wiring
- `packages/react/src/hooks/useRealtime.ts` - destructures `visemeChannel` from `useKhavee()`; feeds it from the analyzer's `onPhonemeDetected` and from a wrapped `provider.onPhonemeDetected`; clears it on disconnect, on leaving `"speaking"`, and on `stopAutoLipSync`
- `packages/react/src/hooks/useAudioLipSync.ts` - `@deprecated` JSDoc block added above `useAudioLipSync`'s export; no runtime code changed

## Decisions Made

- `prevChatStatusRef` is initialized to `"stopped"` rather than `null`/`undefined`, so the first `onChatStatusChange` call after mount is guaranteed not to misread as "just left speaking" and spuriously clear the channel.
- The analyzer-fed `visemeChannel.pushAnalysis` call was placed directly inside the existing `onPhonemeDetected` callback (before the legacy mouth-state conversion), per the plan's explicit instruction that this push is NOT rAF-coalesced like the legacy path — the channel is a plain mutable sink, and 18-03's `stepViseme` already handles debouncing/smoothing on its own per-frame schedule.
- `provider.onPhonemeDetected`'s upstream-preservation wrapper follows the file's own established capture-then-chain convention (identical shape to the existing `upstreamChatStatusChange`/`upstreamOnError` handling a few lines above it) rather than introducing a new pattern.

## Deviations from Plan

None - plan executed exactly as written. All acceptance-criteria greps (setEmotionHint signature, visemeChannel type, normalizeEmotionHint call, createVisemeChannel useState init, Provider value fields, visemeChannel.pushAnalysis x2, visemeChannel.pushTimed, upstreamPhonemeDetected x3, visemeChannel.clear() x3, prevChatStatusRef check, legacy setMultipleExpressions path, @deprecated tag, comment-only diff on useAudioLipSync.ts) passed on first attempt.

## Issues Encountered

- The worktree's git history did not match the expected phase-plan base commit at spawn time (merge-base mismatch against `0fab5a9`); corrected via `git reset --hard` to the specified base commit per the mandatory worktree branch-check protocol before any file edits began.
- The worktree had no `node_modules` installed. Rather than a full `pnpm install`, symlinked `node_modules` (root, `packages/core`, `packages/react`) from the already-installed main checkout, matching 18-02's precedent — these symlinks are gitignored/untracked and were not staged or committed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `KhaveeProvider`'s `emotionHint`/`setEmotionHint`/`visemeChannel` are ready for 18-06's demo integration: an app can now call `createEmotionTool(setEmotionHint)` (from 18-02's `@khaveeai/core` export) and register it as a `RealtimeTool`, and `VRMAvatar`/the animation controller can read `visemeChannel` via `useKhavee()` to drive `stepViseme` (18-03) each frame.
- The channel is real and tested end-to-end from both feed sites (audio-analysis via `useRealtime`'s analyzer, timing via any provider that forwards vendor TTS timing per 18-03's `GenericPipelineProvider` wiring) but is not yet consumed by any per-frame stepper — that wiring (calling `useViseme().step()`/`useEmotion().step()` from the shared animation controller) is explicitly out of scope for this plan per its own objective and deferred to 18-04's controller (already merged) / 18-06's demo page.
- `packages/providers/openai-stt-tts` remains byte-for-byte untouched, confirmed via `git diff --quiet`. Plan 18-04's `AnimationStateEngine.ts`/`AnimationStateEngine.test.ts` (executed concurrently in a separate worktree) also remain byte-for-byte untouched, confirmed via `git diff --quiet`.
- No blockers for 18-06.

## Self-Check: PASSED

All 3 modified files verified present on disk with expected content; both commit hashes (`7b92393`, `cc09ebb`) verified present in `git log --oneline`.

---
*Phase: 18-facial-performance-eyes-visemes-emotion*
*Completed: 2026-09-21*
