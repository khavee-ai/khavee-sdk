---
phase: 18-facial-performance-eyes-visemes-emotion
plan: 02
subsystem: animation
tags: [tool-calling, vrm-expressions, react, emotion, gaze-bias, gesture]

# Dependency graph
requires:
  - phase: 12-gaze-gesture
    provides: gesture.ts consume-once hint pattern, easeInOutCubic in crossfade.ts
provides:
  - "createEmotionTool() zero-config set_emotion RealtimeTool + emotionSystemPrompt in @khaveeai/core"
  - "react emotion.ts: stepEmotion/useEmotion crossfade state machine, EmotionGazeBias, suggestedGesture outputs"
affects: [18-04-facial-performance-controller-wiring, 18-05-khaveeprovider-emotion-context, 18-06-demo-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tool factory that wires its own execute() (createEmotionTool), unlike toolGesture's app-supplied-execute shape"
    - "idle/in/hold/out phase state machine for a triggered, lingering, auto-releasing procedural layer"
    - "Local duplication of a core type/constant in packages/react to avoid a new @khaveeai/core import (published-package packaging constraint)"

key-files:
  created:
    - packages/core/src/tools/emotion.ts
    - packages/core/src/tools/__tests__/emotion.test.ts
    - packages/react/src/animation/emotion.ts
    - packages/react/src/animation/emotion.test.ts
  modified:
    - packages/core/src/index.ts

key-decisions:
  - "createEmotionTool() validates emotion via a strict case-sensitive allow-list and clamps intensity to [0,1] with a 0.7 default, never throwing and never calling the setter on invalid input (T-18-03)"
  - "react's emotion.ts duplicates EMOTION_NAMES/EmotionName locally instead of importing from @khaveeai/core, because packages/react resolves core from the published 0.1.5, not the workspace build"
  - "gazeBias is computed as bias-at-full-intensity scaled by presence*intensity, so it automatically equals the neutral {0,0,1,1} values whenever presence is 0 (idle) with no special-case branch needed"
  - "suggestedGesture is a per-call transient (not stored on state) so it is naturally null on every frame except the one that actually consumed a new hint"

requirements-completed: [EMO-01, EMO-02, EMO-03]

# Metrics
duration: 14min
completed: 2026-09-18
---

# Phase 18 Plan 02: Emotion Channel (Tool + React Crossfade) Summary

**createEmotionTool() zero-config `set_emotion` tool in `@khaveeai/core` plus a react `emotion.ts` module that crossfades the 6 core emotions into VRM expressions over expressionDrift, with gaze-bias and gesture-suggestion outputs.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-09-18T17:49:31+07:00 (branch base)
- **Completed:** 2026-09-18T18:02:51+07:00
- **Tasks:** 2/2
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `@khaveeai/core` now exports `createEmotionTool()`, a factory that returns a fully-wired `set_emotion` `RealtimeTool` (flat parameters shape, matching `toolGesture`'s precedent) plus a system-prompt addition coaching the LLM to call it once, before speaking, per turn.
- Tool-boundary validation treats LLM tool-call arguments as untrusted (T-18-03): case-sensitive allow-list on `emotion`, `Number.isFinite` + `[0,1]` clamp on `intensity` with a `0.7` default, never throwing.
- `packages/react/src/animation/emotion.ts` implements an idle/in/hold/out state machine that crossfades `EMOTION_EXPRESSION_MAP[emotion] * intensity` into VRM expressions over a 0.4s ease-in and 0.5s ease-out, running as a layer on top of (and yielding back to, via `expressionDrift.ts`'s own ownership guard) the untouched rest-state drift base layer (D-15).
- The same step function derives `EmotionGazeBias` (yaw/pitch offset, aversion/saccade scale, scaled by `presence * intensity`) and a one-shot `suggestedGesture` (`"nod"`/`"shake"`/`null`) that is non-null only on the frame a hint is actually consumed — both outputs 18-04 will fan out to the gaze and gesture modules.

## Task Commits

Each task was committed atomically:

1. **Task 1: createEmotionTool() + emotionSystemPrompt in @khaveeai/core** - `ca9fd81` (feat)
2. **Task 2: react emotion.ts crossfade + gaze bias + gesture suggestion** - `9df0865` (feat)

**Plan metadata:** committed as part of this Summary's final commit (see below)

## Files Created/Modified
- `packages/core/src/tools/emotion.ts` - `EMOTION_NAMES`, `DEFAULT_EMOTION_INTENSITY`, `emotionSystemPrompt`, `createEmotionTool()` factory dispatching through the shared `ToolExecutor`
- `packages/core/src/tools/__tests__/emotion.test.ts` - 13 tests covering shape, RealtimeTool conformance, ToolExecutor dispatch, intensity clamping/defaulting, and rejection of invalid/mis-cased/non-string/missing emotion input
- `packages/core/src/index.ts` - barrel-exports `createEmotionTool`, `emotionSystemPrompt`, `EMOTION_NAMES`, `DEFAULT_EMOTION_INTENSITY`, and the `EmotionName` type
- `packages/react/src/animation/emotion.ts` - `normalizeEmotionHint`, `EMOTION_EXPRESSION_MAP`, `EMOTION_GAZE_BIAS`, `EmotionState`/`createEmotionState`, `stepEmotion`/`useEmotion`, timing constants (`EMOTION_FADE_IN_S`, `EMOTION_FADE_OUT_S`, `EMOTION_LINGER_S`, `EMOTION_MAX_HOLD_S`, `EMOTION_NOD_MIN_INTENSITY`, `EMOTION_SHAKE_MIN_INTENSITY`)
- `packages/react/src/animation/emotion.test.ts` - 25 tests covering normalization, consume dedupe, crossfade-in timing, cross-emotion crossfade monotonicity, hold/linger/max-hold/neutral release paths, driftScale, gazeBias per-emotion signs, suggestedGesture thresholds and consume-frame-only behavior, a null-expression-manager (GLB) path, and the thinking dual-key blend

## Decisions Made
- `createEmotionTool`'s description text literally contains the substring `set_emotion` (not just implied by context) so both the tool description and `emotionSystemPrompt` satisfy the "mentions set_emotion and 'before'" acceptance check.
- The react module's one JSDoc reference to the core package by name was reworded to "the core package's EMOTION_NAMES" instead of the literal string `@khaveeai/core`, so the acceptance-check grep (which excludes only `//`/`*`-prefixed comment lines) correctly finds zero non-type-only references to `@khaveeai/core` outside the single `import type { ChatStatus }` line.
- `suggestedGesture` is computed as a local variable per `stepEmotion` call rather than stored on `EmotionState`, guaranteeing it is `null` on every frame except the exact consume frame without extra state bookkeeping.

## Deviations from Plan

None - plan executed exactly as written. Two minor self-corrections were made and verified within the same task's fix-attempt budget (not separate deviations against plan intent, both caught by the plan's own acceptance-criteria greps before commit):
- Reworded the `set_emotion` tool description to literally include "set_emotion" (Task 1, before commit `ca9fd81`).
- Reworded one JSDoc line in `emotion.ts` to avoid a literal `@khaveeai/core` substring outside the allowed `import type` line (Task 2, before commit `9df0865`).

## Issues Encountered
- The worktree's git history did not match the expected phase-plan base commit at spawn time (merge-base mismatch); corrected via `git reset --hard` to the specified base commit per the mandatory worktree branch-check protocol before any file edits began.
- The worktree had no `node_modules` installed. Rather than a full `pnpm install`, symlinked `node_modules` (root and for `packages/core`, `packages/react`, `packages/providers/openai-stt-tts`) from the already-installed main checkout — these symlinks are gitignored and were not staged/committed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `@khaveeai/core`'s `createEmotionTool()` is ready for `KhaveeProvider`/provider wiring in 18-05 (register `tool`, append `systemPromptAddition` to instructions).
- `packages/react`'s `emotion.ts` (`useEmotion`/`stepEmotion`) is ready for the controller wiring in 18-04, which will call `step()` after `expressionDrift`'s step in the shared per-frame update and fan `gazeBias`/`suggestedGesture` out to the gaze and gesture modules.
- No blockers. `packages/providers/openai-stt-tts` and `packages/react/src/animation/expressionDrift.ts` remain byte-for-byte untouched, confirmed via `git diff --quiet`.

---
*Phase: 18-facial-performance-eyes-visemes-emotion*
*Completed: 2026-09-18*
