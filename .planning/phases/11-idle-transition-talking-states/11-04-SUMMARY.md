---
phase: 11-idle-transition-talking-states
plan: 04
subsystem: animation
tags: [three.js, animation-mixer, procedural-motion, react-hooks, tdd]

# Dependency graph
requires:
  - phase: 11-01
    provides: AvatarFormatAdapter interface and shared crossfade/blink module conventions this plan follows
provides:
  - "talkCycle.ts: pure, timer-free state machine (stepTalkCycle) that names the next talk-clip variant only at a loop-completion boundary past a ~2s minimum dwell, plus a useRef-backed useTalkCycle() hook wrapper"
  - "audioAmplitude.ts: pure volumeToAmplitudeScale(currentVolume, chatStatus) mapping, neutral (1) outside speaking, clamped+scaled while speaking"
affects: [11-05, talking-state-controller-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure state-machine + thin useRef hook wrapper for testability without React rendering (no renderHook/testing-library dependency needed)"
    - "Round-robin index advance via pure nextVariantIndex(currentIndex, length) helper, independently unit-tested"
    - "Loop-boundary detection via action.time vs getClip().duration comparison against a previous-frame value (wrap or duration-crossing), never a live clock"

key-files:
  created:
    - packages/react/src/animation/talkCycle.ts
    - packages/react/src/animation/talkCycle.test.ts
    - packages/react/src/animation/audioAmplitude.ts
    - packages/react/src/animation/audioAmplitude.test.ts
  modified: []

key-decisions:
  - "useTalkCycle() delegates all logic to an exported pure function (stepTalkCycle) operating on explicit TalkCycleState, since React hooks (useRef) cannot be invoked outside a component render and this codebase has no renderHook/testing-library setup — this keeps full behavior coverage testable without adding a new test dependency"
  - "Chose AMPLITUDE_GAIN = 1.25 for audioAmplitude's volume-to-scale mapping (within the plan's suggested ~1.0-1.5 range), giving a 1x-2.25x amplitude scale across the full volume range"
  - "Reworded file-header comments that originally quoted literal 'setTimeout(...)' / 'useState' text (to describe the removed anti-pattern and the never-useState convention) so the required grep -Ec 'setInterval|setTimeout' / grep -c 'useState' acceptance checks return 0 including comments, not just code"

patterns-established:
  - "Speaking-state helper modules (talkCycle, audioAmplitude) stay internal-only (not exported from index.ts), matching blink.ts/crossfade.ts precedent; Plan 05's controller is expected to import and wire them directly by relative path"

requirements-completed: [TALK-01, TALK-02]

# Metrics
duration: 5min
completed: 2026-07-13
---

# Phase 11 Plan 04: Talk-Cycle & Audio-Amplitude Speaking Systems Summary

**talkCycle.ts (loop-boundary + ~2s-dwell round-robin talk-variant cycler) and audioAmplitude.ts (pure speaking-only volume-to-amplitude-scale mapping), both timer-free and fully unit-tested**

## Performance

- **Duration:** ~5 min (execution only; file/context reads not counted)
- **Started:** 2026-07-13T00:35:00+07:00 (approx, first test run)
- **Completed:** 2026-07-13T00:37:38+07:00
- **Tasks:** 2 completed
- **Files modified:** 4 (all newly created)

## Accomplishments
- `talkCycle.ts`: pure `stepTalkCycle` state machine advances to the next talk-clip variant only when a loop-completion boundary is detected (via `action.time` vs `action.getClip().duration`, comparing against the previous frame — never a live clock) AND at least `MIN_TALK_DWELL_SECONDS` (~2.0s) has elapsed since the last switch. Round-robin advance via the independently-tested pure helper `nextVariantIndex`, which can never return the current index for a 2+-length list.
- `audioAmplitude.ts`: pure `volumeToAmplitudeScale(currentVolume, chatStatus)` returns exactly `1` (neutral) outside `speaking`, and while speaking clamps volume into `[0,1]` before mapping to `1 + clampedVolume * AMPLITUDE_GAIN` — monotonic, bounded, side-effect-free.
- Both modules have zero `setInterval`/`setTimeout`/`useState` occurrences (verified via grep, including comments — required a header-comment reword to satisfy the literal-text grep gate) and are not exported from `packages/react/src/index.ts`.
- Full `@khaveeai/react` test suite (44 tests across 4 files) and `tsc` build both pass clean after these additions.

## Task Commits

Each task followed the RED -> GREEN TDD cycle with separate commits:

1. **Task 1: talkCycle.ts — loop-boundary talk-variant selector with minimum dwell**
   - `75a65aa` test(11-04): add failing test for talkCycle loop-boundary variant selector
   - `eeb7865` feat(11-04): implement talkCycle loop-boundary talk-variant selector
2. **Task 2: audioAmplitude.ts — speaking-only volume-to-amplitude scale**
   - `653901d` test(11-04): add failing test for audioAmplitude speaking-only volume scale
   - `91ec668` feat(11-04): implement audioAmplitude speaking-only volume-to-amplitude scale

**Plan metadata:** committed alongside this SUMMARY.md (worktree mode — orchestrator finalizes STATE.md/ROADMAP.md after wave merge).

_Note: no REFACTOR commits were needed — GREEN implementations were minimal and clean on first pass._

## Files Created/Modified
- `packages/react/src/animation/talkCycle.ts` - `TalkCycleState`, `createTalkCycleState`, `nextVariantIndex`, `stepTalkCycle`, `useTalkCycle()` — timer-free loop-boundary + min-dwell talk-variant cycler
- `packages/react/src/animation/talkCycle.test.ts` - 9 tests covering all 6 behavior groups (not-speaking, <2 variants, boundary+dwell gate, early-boundary rejection, round-robin across 3 variants, first-frame safety) plus 3 `nextVariantIndex` unit tests
- `packages/react/src/animation/audioAmplitude.ts` - `volumeToAmplitudeScale(currentVolume, chatStatus)` pure function, `AMPLITUDE_GAIN` constant
- `packages/react/src/animation/audioAmplitude.test.ts` - 4 tests covering neutral-outside-speaking, monotonic-while-speaking, clamp, purity

## Decisions Made
- `useTalkCycle()`'s hook body is a thin `useRef` wrapper delegating to the exported pure `stepTalkCycle(state, params)`; tests exercise the pure function directly rather than the hook, since the codebase has no `renderHook`/`@testing-library/react` dependency and React hooks cannot legally run outside a component render. This achieves full behavior coverage of all 6 required behaviors without adding a new test dependency, and matches the plan's own instruction to "export the round-robin index helper as a pure function for testing" (extended here to the whole state machine).
- `AMPLITUDE_GAIN = 1.25`, within the plan's suggested "~1.0-1.5" discretion range, chosen as a moderate midpoint gain.
- File-header comments referencing the Phase-10-removed `setTimeout`-based loop-back anti-pattern and the "never `useState`" convention were reworded to avoid the literal substrings `setTimeout`/`useState` appearing anywhere in `talkCycle.ts`, so the mandated `grep -Ec "setInterval|setTimeout"` / `grep -c "useState"` acceptance checks return `0` including comments, not only executable code. Intent/meaning preserved, wording changed (e.g. "wall-clock-timeout-driven ... loop-back" instead of literal `setTimeout(...)`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reworded talkCycle.ts header comments to avoid literal setTimeout/useState text**
- **Found during:** Task 1, post-implementation acceptance-criteria verification
- **Issue:** The plan's own `<interfaces>` context and file-header guidance explicitly quote the anti-pattern being avoided (`setTimeout(3000 + Math.random()*2000)`) and the "never useState" convention, but the plan's acceptance criteria require `grep -Ec "setInterval|setTimeout"` and `grep -c "useState"` on `talkCycle.ts` to return `0`. Writing those literal strings into descriptive comments caused both grep checks to return `1`, failing the stated acceptance gate.
- **Fix:** Reworded the two comment passages to describe the same anti-pattern/convention in prose without using the literal token sequences `setTimeout(` / `useState`.
- **Files modified:** `packages/react/src/animation/talkCycle.ts`
- **Verification:** Re-ran both grep commands (`0` each) and re-ran `talkCycle.test.ts` (still 9/9 passing) after the edit.
- **Committed in:** `eeb7865` (Task 1 feat commit — the file was authored fresh with the corrected wording, no separate fix commit needed)

---

**Total deviations:** 1 auto-fixed (1 bug-class wording correction to satisfy a literal acceptance-criteria grep gate)
**Impact on plan:** No functional impact — comment wording only, no behavior change. Necessary for the plan's own stated acceptance criteria to pass as written.

## Issues Encountered
- `pnpm --filter @khaveeai/react exec vitest` initially failed with `vitest not found` because the worktree's `node_modules` symlinks were stale relative to the workspace lockfile; ran `pnpm install --frozen-lockfile` at the repo root to restore them, then all commands worked as expected. Not a plan deviation — standard worktree-freshness housekeeping, no files changed.

## User Setup Required

None - no external service configuration required. Both modules are pure/internal library code with no environment variables, secrets, or dashboard steps.

## Next Phase Readiness
- `useTalkCycle().step(...)` and `volumeToAmplitudeScale(...)` are both internal, unexported, and ready for Plan 05's controller to import by relative path and wire into `AnimationStateEngine.ts`'s `update(delta)` loop (per the plan objective: talkCycle names the next variant, Plan 05 performs the actual `beginCrossfade`; audioAmplitude scales procedural amplitude, never clip selection/timing).
- No blockers. `MIN_TALK_DWELL_SECONDS` and `AMPLITUDE_GAIN` are both named exported/module constants Plan 05 (or a future tuning pass) can reference or override without touching this plan's files.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-13*
