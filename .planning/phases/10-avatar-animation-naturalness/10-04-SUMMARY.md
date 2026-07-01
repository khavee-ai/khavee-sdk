---
phase: 10-avatar-animation-naturalness
plan: 04
subsystem: ui
tags: [react-three-fiber, vrm, three.js, avatar-animation, procedural-animation]

# Dependency graph
requires:
  - phase: 10-avatar-animation-naturalness (waves 1-3)
    provides: chatStatus auto-mapping, procedural breathing/head-noise/gaze-drift/finger-curl layers, micro-expression scheduler
provides:
  - Procedural nodding system during 'listening' (SHORT/LONG/LONG_P nod types)
  - Thinking pose head tilt during 'thinking'
  - Gaze aversion state machine during 'thinking' (additive on wave-2 gaze drift)
  - Volume-reactive head movement amplitude scaling during 'speaking'
  - Keyword gesture override for speaking animation selection
affects: [10-avatar-animation-naturalness, future avatar/lip-sync phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive procedural bone-delta layers stacked in a fixed useFrame order (mixer.update -> breathing -> head noise -> nod -> thinking tilt -> gaze drift -> gaze aversion -> finger curl -> expressions -> blink -> micro-expressions -> vrm.update)"
    - "Reuse of module-scope scratch THREE.Quaternion/Vector3 objects (headQuatX/headQuatY/scratchX/scratchY) across multiple animation layers within the same frame to avoid per-frame allocations"
    - "4-phase state machine (idle/averting/hold/returning) driven entirely by useRef counters for timed, self-resetting behaviors"

key-files:
  created: []
  modified:
    - packages/react/src/VRMAvatar.tsx

key-decisions:
  - "Reused wave-2's headQuatX/headQuatY scratch quaternions and scratchX/scratchY axis vectors for nodding and thinking-tilt deltas instead of allocating new ones, since each usage sets-then-immediately-applies within the same synchronous frame"
  - "Used Conversation.text (not .content) for the keyword gesture override, matching the actual @khaveeai/core Conversation type rather than the plan's placeholder field name"
  - "currentVolume and conversation are both directly typed on RealtimeProvider (no cast needed), simpler than the plan's suggested type-cast fallback"

patterns-established:
  - "Wave-4 additive animation layers pattern: each new procedural layer is a self-contained if-block using only useRef state, inserted at a precise point in the existing useFrame pipeline documented via wave-order comments"

requirements-completed: []

# Metrics
duration: ~15min
completed: 2026-07-01
---

# Phase 10 Plan 04: Nodding, Thinking Pose, Gaze Aversion, Volume-Reactive Movement & Keyword Gestures Summary

**Five additive research-backed VRMAvatar animation layers (nodding, thinking-pose tilt, gaze aversion, volume-reactive head scaling, keyword-driven gesture override) stacked on top of waves 1-3's procedural life layer, all state in useRef with zero new THREE.\* allocations inside useFrame.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-01T17:02:46+07:00 (after hard-reset to wave-3 baseline commit 7d063f3)
- **Completed:** 2026-07-01T17:15:42+07:00
- **Tasks:** 5/5
- **Files modified:** 1

## Accomplishments
- Avatar now nods probabilistically (SHORT 40%/LONG 40%/LONG_P 20%) every 2-4s while `chatStatus === 'listening'`
- Avatar's head smoothly tilts sideways (±0.13 rad, direction randomised once per turn) while `chatStatus === 'thinking'`
- Avatar's gaze occasionally drifts off-centre and returns (4-phase state machine, 4-7s cadence) during `thinking`, stacking additively on the existing wave-2 gaze drift
- Avatar's head micro-movement amplitude now scales up to 1.45x based on `realtimeProvider.currentVolume` while speaking
- Speaking animation selection now checks the last assistant message for keyword hints (agree/disagree/self-reference/thinking) and overrides the random pick when a matching FBX animation key exists

## Task Commits

Each task was committed atomically:

1. **Task 1: Add realtimeProvider to useKhavee destructure + all wave-4 refs** - `938dbd1` (feat)
2. **Task 2: Nodding delta in useFrame (listening state)** - `9c7d875` (feat)
3. **Task 3: Thinking pose + gaze aversion in useFrame** - `a748b9d` (feat)
4. **Task 4: Volume-reactive head movement during speaking** - `b9fc997` (feat)
5. **Task 5: Keyword gesture — enhance speaking animation selection** - `c83251b` (feat)

**Plan metadata:** (this commit, see below)

## Files Created/Modified
- `packages/react/src/VRMAvatar.tsx` - Added `realtimeProvider` to context destructure, 9 new wave-4 `useRef`s, nodding/thinking-pose/gaze-aversion useFrame blocks, `volumeFactor` computation and application to head-noise amplitudes, and the module-level `gestureKeywords` constant plus keyword-override logic in the chatStatus useEffect

## Decisions Made
- Reused the existing wave-2 scratch quaternions (`headQuatX`, `headQuatY`) and axis vectors (`scratchX`, `scratchY`) for the new nodding and thinking-tilt bone deltas rather than declaring new module-level scratch objects, since the plan's `<scratchQuat>`/`<axisX>`/`<axisY>` placeholders map 1:1 onto these already-established names in the file
- Discovered the `Conversation` type (`@khaveeai/core`) uses a `text` field, not `content` as the plan's pseudocode assumed — used the correct field name (`lastAI.text`) to keep `tsc --noEmit` clean
- `RealtimeProvider.currentVolume` and `.conversation` are both directly declared on the interface (no `as { currentVolume?: number }` cast needed as the plan hedged) — used them directly with optional chaining

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected Conversation field name from `content` to `text`**
- **Found during:** Task 5 (keyword gesture override)
- **Issue:** Plan's pseudocode used `lastAI.content`, but the actual `Conversation` interface (`packages/core/src/types/conversation.ts`) declares the message body as `text`, not `content`. Using `.content` would have been a TypeScript compile error (property does not exist).
- **Fix:** Used `lastAI.text` instead of `lastAI.content` throughout the keyword-override block.
- **Files modified:** `packages/react/src/VRMAvatar.tsx`
- **Verification:** `npx tsc --noEmit` in `packages/react` passes with zero errors
- **Committed in:** `c83251b` (Task 5 commit)

**2. [Rule 3 - Blocking] Worktree HEAD was on wrong branch history at startup**
- **Found during:** Pre-execution worktree branch check
- **Issue:** The worktree's `worktree-agent-a5a84a3eb88c8413f` branch had diverged onto an unrelated commit history (docs rewrite, provider package removal, generic-demo fixes) that did not include the plan's anchor commit `7d063f3` (wave-3 completion). `git merge-base HEAD 7d063f3` did not equal `7d063f3`, and `7d063f3` was not an ancestor of HEAD.
- **Fix:** Per the mandatory `<worktree_branch_check>` step, hard-reset the worktree branch to `7d063f3b37810518e4b0cb5b4ebc2131d59349ea` before making any edits.
- **Files modified:** None (branch pointer only)
- **Verification:** `git rev-parse HEAD` == `7d063f3b37810518e4b0cb5b4ebc2131d59349ea` after reset
- **Committed in:** N/A (git reset, not a content commit)

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 blocking/environment fix)
**Impact on plan:** Both fixes were necessary — the type-name fix was required for `tsc` to pass, and the branch reset was required to execute on the correct plan baseline. No scope creep.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 5 wave-4 procedural animation layers are additive on top of waves 1-3; FBX playback remains at weight 1.0
- `packages/react` type-checks cleanly (`npx tsc --noEmit` exit 0)
- Phase 10 (avatar-animation-naturalness) waves 1-4 are now all complete; ready for phase completion review

## Self-Check: PASSED

- FOUND: packages/react/src/VRMAvatar.tsx
- FOUND: 938dbd1 (git log)
- FOUND: 9c7d875 (git log)
- FOUND: a748b9d (git log)
- FOUND: b9fc997 (git log)
- FOUND: c83251b (git log)

---
*Phase: 10-avatar-animation-naturalness*
*Completed: 2026-07-01*
