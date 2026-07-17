---
phase: 12-gaze-gesture
plan: 05
subsystem: animation, demo
tags: [react, three.js, gaze, gesture, avatar-wiring, demo-page]

# Dependency graph
requires:
  - phase: 12-gaze-gesture
    plan: 01
    provides: toolGesture LLM tool-schema factory (set_gesture) in @khaveeai/core
  - phase: 12-gaze-gesture
    plan: 04
    provides: useAnimationController's camera/gestureHint/onGestureConsumed params + KhaveeProvider's gestureHint/setGestureHint
provides:
  - VRMAvatar.tsx and GLBAvatar.tsx both threading useThree().camera + gestureHint/onGestureConsumed into useAnimationController
  - openai-avatar-test demo page registering set_gesture end-to-end via registerFunction, plus manual nod/shake triggers
affects: [12-06 (human-verify checkpoint exercises this exact demo-page surface)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "R3F active-scene camera read once per render via useThree((state) => state.camera) at component scope, not inside useFrame (D-04)"
    - "App-supplied LLM tool execute callbacks bridge into React context state via a useEffect + registerFunction call inside a component rendered within the provider tree, never at module scope (RESEARCH Open Question 3)"

key-files:
  created: []
  modified:
    - packages/react/src/VRMAvatar.tsx
    - packages/react/src/GLBAvatar.tsx
    - src/app/openai-avatar-test/page.tsx

key-decisions:
  - "Camera and gestureHint wiring kept byte-for-byte symmetric between VRMAvatar and GLBAvatar (aside from GLB's pre-existing dampProceduralOnManualClip: true) so gaze/gesture behave identically on both formats (GAZE-02)"
  - "set_gesture registration happens inside a useEffect in the component rendered within KhaveeProvider (not at the module-scope openaiProvider construction), since only there is setGestureHint reachable via useKhavee() — matches RESEARCH Open Question 3's recommended bridge"
  - "Manual Nod/Shake buttons added alongside the LLM-tool path so plan 12-06's human-verify checkpoint can confirm gesture playback deterministically without depending on the LLM actually emitting a set_gesture tool call"

requirements-completed: [GAZE-01, GAZE-02, GEST-01, GEST-02]

# Metrics
duration: 25min
completed: 2026-07-18
---

# Phase 12 Plan 05: Wire Camera + Gesture Hint into Avatars and Demo Page Summary

**Both `VRMAvatar.tsx` and `GLBAvatar.tsx` now thread the R3F active scene camera and the `gestureHint`/`onGestureConsumed` signal into `useAnimationController`, and the `openai-avatar-test` demo page registers `set_gesture` end-to-end via `registerFunction` inside a `useEffect`, plus manual nod/shake buttons — completing GAZE-01/02 and GEST-01/02's runtime wiring for the plan 12-06 human-verify checkpoint.**

## Performance

- **Duration:** 25 min
- **Completed:** 2026-07-18
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments

- `VRMAvatar.tsx` and `GLBAvatar.tsx` both import `useThree` from `@react-three/fiber`, read `const camera = useThree((state) => state.camera)` once per render (D-04, not inside `useFrame`), and pass `camera` into `useAnimationController` — giving GAZE-01's camera-relative head-tracking a moving reference on both avatar formats.
- Both avatars extend their `useKhavee()` destructure to pull `gestureHint` and `setGestureHint`, and pass `gestureHint` + `onGestureConsumed: () => setGestureHint(null)` into the controller — completing GEST-01/02's runtime signal path from LLM tool call through to the shared animation controller.
- Symmetry preserved: GLB's pre-existing `dampProceduralOnManualClip: true` (11-17 gap closure) is untouched; the only intentional difference between the two avatars remains that flag.
- `src/app/openai-avatar-test/page.tsx` imports `toolGesture` from `@khaveeai/core`, and registers it on `openaiProvider` via `registerFunction({ ...toolGesture, execute: ... })` inside a `useEffect` in the component rendered within `KhaveeProvider` — the app-supplied `execute` calls `setGestureHint(args?.gesture ?? null)`, bridging the LLM tool call into React context state exactly as RESEARCH Open Question 3 recommended (module-scope provider construction untouched).
- Added manual "Nod"/"Shake" buttons calling `setGestureHint('nod')`/`setGestureHint('shake')` directly, and an on-page note explaining both gaze (automatic, no wiring needed by the app) and gesture (LLM-tool-driven, `set_gesture`) for the human verifier.

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread camera + gesture wiring through VRMAvatar and GLBAvatar** - `63ce8ca` (feat)
2. **Task 2: Register set_gesture end-to-end in the openai-avatar-test demo page** - `5a93fc9` (feat)

## Files Created/Modified

- `packages/react/src/VRMAvatar.tsx` - added `useThree` import, `camera` read at component scope, `gestureHint`/`setGestureHint` destructured from `useKhavee()`, and `camera`/`gestureHint`/`onGestureConsumed` passed into `useAnimationController`
- `packages/react/src/GLBAvatar.tsx` - same wiring as VRMAvatar.tsx, symmetric aside from the pre-existing `dampProceduralOnManualClip: true`
- `src/app/openai-avatar-test/page.tsx` - imports `toolGesture` + `useKhavee`; registers `set_gesture` via `registerFunction` in a `useEffect`; adds manual Nod/Shake buttons and an updated verification note

## Decisions Made

- Kept the two avatar components byte-for-byte symmetric in this wiring (matching the plan's explicit GAZE-02 instruction) — any future gaze/gesture behavior difference between VRM and GLB would need to be a deliberate, separately-justified change, not an artifact of this plan's wiring.
- Registered the tool inside `useEffect` in the inner component (rendered within `KhaveeProvider`), not by restructuring the module-scope `openaiProvider` construction — this was the plan's explicit instruction (RESEARCH Open Question 3) and preserves the existing module-scope provider pattern used elsewhere in the demo app.
- Added manual Nod/Shake buttons (optional per the plan's action block) since they give the 12-06 human-verify checkpoint a deterministic way to confirm gesture playback without depending on the LLM's own judgment about when to call `set_gesture`.

## Deviations from Plan

None - plan executed exactly as written. (Note: worktree had no `node_modules` — ran `pnpm install --prefer-offline` at the worktree root before running `tsc`/tests, consistent with 12-01/12-04's documented precedent; not a plan deviation, no code changed to address it.)

## Verification Results

- `cd packages/react && npx tsc --noEmit` — exits 0
- `cd packages/react && pnpm test` — 144/144 tests pass (no regressions, no new tests needed since this plan wires existing, already-tested params)
- `grep -c "useThree" packages/react/src/VRMAvatar.tsx` — 3 (import + usage + comment reference)
- `grep -c "useThree" packages/react/src/GLBAvatar.tsx` — 2
- `grep -c "onGestureConsumed: () => setGestureHint(null)" packages/react/src/VRMAvatar.tsx` — 1
- `grep -c "onGestureConsumed: () => setGestureHint(null)" packages/react/src/GLBAvatar.tsx` — 1
- `grep -c "gestureHint" packages/react/src/VRMAvatar.tsx` and GLBAvatar.tsx — 2 each
- `grep -c "dampProceduralOnManualClip: true" packages/react/src/GLBAvatar.tsx` — 1 (unchanged)
- `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "openai-avatar-test"` — no output (no errors originating in this plan's demo page; pre-existing, unrelated errors in `packages/providers/generic-stt-tts` and a vitest-type-resolution error in `src/app/generic-demo` remain, out of this plan's scope)
- `grep -c "toolGesture\|registerFunction\|setGestureHint"` on the demo page — toolGesture: 2, registerFunction: 1, setGestureHint: 7, useEffect: 2
- `npx eslint src/app/openai-avatar-test/page.tsx` — no output (clean)

## Issues Encountered

- Worktree had no `node_modules` (git worktrees don't carry gitignored directories) — ran `pnpm install --prefer-offline` at the worktree root (6.6s, using the existing pnpm content-addressable store) before running `tsc`/tests, matching 12-01/12-04's documented precedent.
- Root `npx tsc --noEmit -p tsconfig.json` reports pre-existing, unrelated errors in `packages/providers/generic-stt-tts` (missing `@khaveeai/providers-openai-stt-tts` module resolution) and `src/app/generic-demo/__tests__/roundtrip-audio-contract.test.ts` (missing `vitest` type declarations at the root tsconfig scope). Confirmed none originate in this plan's files (`VRMAvatar.tsx`, `GLBAvatar.tsx`, `src/app/openai-avatar-test/page.tsx`) — out of this plan's scope per the deviation rules' scope boundary, not fixed.

## User Setup Required

None - no new environment variables, services, or manual configuration needed. (The demo page's existing `OpenAIRealtimeProvider` still requires a real OpenAI-backed `/api/negotiate` proxy to actually connect, unchanged from before this plan.)

## Next Steps

- Plan 12-06 (human-verify checkpoint) exercises this exact demo page: gaze should be visible automatically as the camera orbits, and nod/shake gestures should play both via the manual buttons and via the LLM's own `set_gesture` tool calls during a live conversation.

## Self-Check: PASSED

- FOUND: packages/react/src/VRMAvatar.tsx (modified, useThree/camera/gestureHint/onGestureConsumed present)
- FOUND: packages/react/src/GLBAvatar.tsx (modified, useThree/camera/gestureHint/onGestureConsumed present)
- FOUND: src/app/openai-avatar-test/page.tsx (modified, toolGesture/registerFunction/setGestureHint/useEffect present)
- FOUND: commit 63ce8ca (feat(12-05): thread camera + gesture wiring into VRMAvatar and GLBAvatar)
- FOUND: commit 5a93fc9 (feat(12-05): register set_gesture end-to-end in openai-avatar-test demo)
