---
phase: 11-idle-transition-talking-states
plan: 02
subsystem: ui
tags: [react, context, khaveeprovider, volume, talk-02]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: RESEARCH.md / PATTERNS.md establishing D-02 (currentVolume sourced from useRealtime's onVolumeChange, not useAudioLipSync)
provides:
  - "currentVolume: number field on KhaveeContextType, readable via useKhavee()"
  - "realtimeProvider.onVolumeChange subscription inside KhaveeProvider, mirroring the existing onChatStatusChange pattern"
  - "[0,1] clamp on ingest, matching the setExpression clamp convention"
affects: [11-idle-transition-talking-states plan 05 (TALK-02 amplitude consumer wiring)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provider-level event subscription mirrors an existing sibling subscription (onChatStatusChange) rather than inventing a new wiring style"
    - "Scalar values crossing from provider callbacks into React context are clamped to their valid range at the point of ingestion (Math.max(0, Math.min(1, value)))"

key-files:
  created: []
  modified:
    - packages/react/src/KhaveeProvider.tsx

key-decisions:
  - "Bare (non-chaining) callback assignment on realtimeProvider.onVolumeChange, matching the existing onChatStatusChange pattern exactly — accepted the known coexistence collision with useRealtime()'s own onVolumeChange assignment (RESEARCH Pitfall 5) as pre-existing behavior, documented inline, not fixed in this plan (out of scope per plan objective)."

patterns-established:
  - "New RealtimeProvider event fields destined for React consumers get lifted into KhaveeProvider context via a dedicated useEffect keyed on [realtimeProvider], with any [0,1]-bounded values clamped before setState."

requirements-completed: [TALK-02]

# Metrics
duration: 12min
completed: 2026-07-12
---

# Phase 11 Plan 02: Thread currentVolume into KhaveeProvider context Summary

**Added a clamped `currentVolume: number` field to `KhaveeContextType`, subscribed to `realtimeProvider.onVolumeChange` the same way `chatStatus` already subscribes to `onChatStatusChange` — no consumers wired yet.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-12T14:35:00Z
- **Completed:** 2026-07-12T14:47:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- `currentVolume` is now readable from `useKhavee()` context, previously it existed only as local state inside `useRealtime()` and was completely absent from `KhaveeContextType`.
- Volume values are clamped to `[0,1]` via `Math.max(0, Math.min(1, value))` before being stored, mirroring the existing `setExpression` clamp so a malformed/out-of-range value from the provider cannot drive extreme procedural motion downstream (T-11-02 threat mitigation).
- Subscription wiring follows the exact structural pattern of the existing `onChatStatusChange` `useEffect`, keyed on `[realtimeProvider]`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add currentVolume to KhaveeContextType with a subscription and clamp** - `f542302` (feat)

**Plan metadata:** (pending — committed by orchestrator's final metadata commit step)

## Files Created/Modified
- `packages/react/src/KhaveeProvider.tsx` - Added `currentVolume: number` to `KhaveeContextType`, `useState(0)` state, a new `useEffect` subscribing to `realtimeProvider.onVolumeChange` with a `[0,1]` clamp, and `currentVolume` in the context value object.

## Decisions Made
- Used a bare (non-chaining) assignment for `realtimeProvider.onVolumeChange = (volume) => ...`, exactly matching the existing `onChatStatusChange` pattern in the same file. This means if a consumer also calls `useRealtime()` in the same component tree, that hook's own `onVolumeChange` assignment will overwrite this one (pre-existing coexistence collision risk documented as RESEARCH Pitfall 5). This is flagged inline via comment per the plan's explicit instruction, and intentionally not fixed — `useRealtime.ts` is out of scope for this plan.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The worktree had no `node_modules` installed (fresh git worktree checkout; `node_modules` is gitignored and not shared across worktrees). Ran `pnpm install --frozen-lockfile` at the repo root to hydrate dependencies from the existing lockfile before running the verification build — no new packages added, no lockfile changes, purely restoring what was already pinned. This was necessary to run the plan's mandated `pnpm --filter @khaveeai/react build` verification command.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `currentVolume` is available on `useKhavee()` context, clamped and live-updating, ready for Plan 05 to wire it into `VRMAvatar`/`GLBAvatar`'s `useFrame` for TALK-02's audio-reactive procedural amplitude.
- No consumers were wired in this plan by design — that is explicitly deferred to Plan 05.
- The `useRealtime()` coexistence collision (RESEARCH Pitfall 5) remains an open, documented risk for any future work that has both `KhaveeProvider`'s and `useRealtime()`'s subscriptions active simultaneously on `onVolumeChange`.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-12*
