---
phase: 12-gaze-gesture
plan: 01
subsystem: core
tags: [tool-calling, llm, realtime-tool, barrel-export]

# Dependency graph
requires: []
provides:
  - toolGesture LLM tool-schema factory object (set_gesture) in @khaveeai/core
  - toolAnimate now re-exported from the core barrel (previously unexported)
affects: [12-gaze-gesture (later plans wiring set_gesture into a real provider/tool executor)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LLM tool-schema factories are plain exported const objects (name/description/parameters, no execute) matching the flat RealtimeTool['parameters'] map shape, not a nested JSON-Schema envelope"

key-files:
  created:
    - packages/core/src/tools/gesture.ts
    - packages/core/src/tools/__tests__/gesture.test.ts
  modified:
    - packages/core/src/index.ts

key-decisions:
  - "toolGesture.parameters uses the FLAT RealtimeTool shape (single 'gesture' key with type/enum/required/description), not toolAnimate's nested {type:'object', properties, required} envelope, per D-01/A2 — a naive copy of toolAnimate would not type-check against the real consumer interface"
  - "toolAnimate was added to the barrel export as a drive-by fix alongside toolGesture, since it was previously unexported and unimportable by any consuming app (RESEARCH Pitfall 2)"

patterns-established:
  - "Tool-schema factory modules live at packages/core/src/tools/<name>.ts and are re-exported by name from packages/core/src/index.ts"

requirements-completed: [GEST-01]

# Metrics
duration: 12min
completed: 2026-07-17
---

# Phase 12 Plan 01: toolGesture LLM Tool-Schema Summary

**Added a `set_gesture` LLM tool-schema factory (`toolGesture`) to `@khaveeai/core` with a flat `RealtimeTool`-conformant parameters shape and D-03 coaching description, and fixed the barrel-export gap (both `toolGesture` and the pre-existing `toolAnimate`) that would otherwise make it unimportable by consuming apps.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-17T18:23:25Z (approx, session pickup)
- **Completed:** 2026-07-17T18:30:19Z
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `toolGesture` exists with `name: "set_gesture"`, a flat `RealtimeTool["parameters"]`-shaped `gesture` param (`enum: ["nod", "shake", "none"]`, `required: true`), a D-03 affirm/deny/none coaching description, and no `execute` field (D-01)
- `toolGesture` is compile-time assignable to `Omit<RealtimeTool, "execute">`, verified via a typed local in the unit test
- Fixed the previously-unexported `toolAnimate` alongside `toolGesture` in the core barrel, closing the GEST-01 blocker RESEARCH flagged (an app importing `{ toolGesture } from '@khaveeai/core'` would otherwise fail to compile)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create toolGesture with RealtimeTool-compatible flat parameters shape** - `b3b9fb1` (feat)
2. **Task 2: Add toolGesture (and toolAnimate) to the core barrel export** - `5c22545` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `packages/core/src/tools/gesture.ts` - `toolGesture` factory object: `set_gesture` tool schema with flat parameters shape and coaching description
- `packages/core/src/tools/__tests__/gesture.test.ts` - vitest assertions for name, no-execute, flat parameter shape, enum order, coaching-text content, and `RealtimeTool` conformance
- `packages/core/src/index.ts` - added `export { toolGesture } from './tools/gesture'` and `export { toolAnimate } from './tools/animate'`

## Decisions Made
- Kept `toolGesture`'s parameters flat (single `gesture` key) rather than mirroring `toolAnimate`'s nested JSON-Schema envelope, per the plan's explicit A2/D-01 instruction — the nested shape does not type-check against `RealtimeTool`.
- Added `toolAnimate` to the barrel export in the same task as `toolGesture` (plan-directed drive-by fix), since it was the low-risk fix RESEARCH Pitfall 2 recommended and matches CLAUDE.md's barrel-export convention.

## Deviations from Plan

None - plan executed exactly as written. (Note: `pnpm install` had to be run in this worktree before tests/build could execute, since the worktree checkout had no `node_modules` — this is normal worktree setup, not a plan deviation, and is not tracked as a Rule 1-4 item since no code was changed to address it.)

## Verification Results

- `cd packages/core && pnpm test -- gesture` — 6/6 gesture tests pass
- `cd packages/core && pnpm test` (full suite) — 10/10 tests pass (4 pre-existing `ToolExecutor` tests + 6 new gesture tests)
- `cd packages/core && npx tsc --noEmit` — exits 0
- `cd packages/core && pnpm build` (tsc) — exits 0
- `grep -n 'name: "set_gesture"' packages/core/src/tools/gesture.ts` — matches
- `grep -n 'enum: \["nod", "shake", "none"\]' packages/core/src/tools/gesture.ts` — matches
- `grep -c "execute" packages/core/src/tools/gesture.ts` — 0 (no execute field present)
- `grep -n "export { toolGesture } from './tools/gesture'" packages/core/src/index.ts` — matches
- `grep -n "export { toolAnimate } from './tools/animate'" packages/core/src/index.ts` — matches

## Issues Encountered
None blocking. Worktree had no `node_modules`; ran `pnpm install --prefer-offline` at the repo root before running tests/build (fast, ~7s, using the existing pnpm content-addressable store).

## User Setup Required

None - no new environment variables, services, or manual configuration needed.

## Next Steps
- Later phase-12 plans (per PROJECT.md's "Target features") will wire `toolGesture` into a real `RealtimeConfig.tools` array and implement the consumer-side `setGestureHint` narrowing logic referenced in this plan's threat model (T-12-01), defaulting unrecognized `gesture` values to a no-op.

## Self-Check: PASSED

- FOUND: packages/core/src/tools/gesture.ts
- FOUND: packages/core/src/tools/__tests__/gesture.test.ts
- FOUND commit: b3b9fb1
- FOUND commit: 5c22545
