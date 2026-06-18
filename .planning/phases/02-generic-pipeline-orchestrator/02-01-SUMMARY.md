---
phase: 02-generic-pipeline-orchestrator
plan: 01
subsystem: api
tags: [typescript, pnpm-workspace, pipeline-interfaces, abortsignal]

# Dependency graph
requires:
  - phase: 01-core-interfaces-tool-calling
    provides: "VADProvider/STTProvider/LLMProvider/TTSProvider interfaces in packages/core/src/types/pipeline.ts, ToolExecutor promoted to @khaveeai/core"
provides:
  - "signal?: AbortSignal on LLMProvider.complete() args and TTSProvider.speak() opts (D-01), additive and best-effort (D-02)"
  - "Additive exports of AudioRecorder, STTClient, ChatClient (+ ChatMessage/ChatUsage/ChatResult types), TTSPlayer from @khaveeai/providers-openai-stt-tts barrel"
  - "New @khaveeai/providers-generic-stt-tts workspace package scaffold (package.json, tsconfig.json, vitest.config.ts, placeholder src/index.ts)"
affects: [02-02, 02-03, generic-pipeline-orchestrator, openai-stt-tts-adapters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-only interface extension: new optional fields appended after existing fields, never replacing/renaming (D-01/D-02 cancellation pattern)"
    - "Barrel re-export of internal helper classes by package name (not relative cross-package import) to unblock adapter packages"
    - "New workspace provider package scaffolded by copying package.json/tsconfig.json/vitest.config.ts verbatim from an existing sibling provider package"

key-files:
  created:
    - packages/providers/generic-stt-tts/package.json
    - packages/providers/generic-stt-tts/tsconfig.json
    - packages/providers/generic-stt-tts/vitest.config.ts
    - packages/providers/generic-stt-tts/src/index.ts
  modified:
    - packages/core/src/types/pipeline.ts
    - packages/providers/openai-stt-tts/src/index.ts
    - pnpm-lock.yaml

key-decisions:
  - "signal?: AbortSignal added to both LLMProvider.complete() and TTSProvider.speak() as optional/best-effort fields per locked D-01/D-02 decisions — no provider is required to honor it"
  - "openai-stt-tts barrel gets additive-only exports (AudioRecorder, STTClient, ChatClient, TTSPlayer, ChatClient's types) rather than being refactored, preserving the 'stays as-is, untouched' compatibility constraint while still letting generic-stt-tts adapters import by package name"
  - "generic-stt-tts package depends on @khaveeai/providers-openai-stt-tts via workspace:* (not just @khaveeai/core) so its future D-06 adapters can wrap the helper classes without duplicating ~400 lines"

patterns-established:
  - "New provider packages are scaffolded by copying an existing sibling's package.json/tsconfig.json/vitest.config.ts verbatim, then trimming dependencies to only what the new package actually needs"

requirements-completed: [ORCH-01, ORCH-03]

# Metrics
duration: 12min
completed: 2026-06-18
---

# Phase 2 Plan 1: Cross-Package Foundation Summary

**Added optional AbortSignal cancellation fields to LLMProvider/TTSProvider, exported openai-stt-tts's four helper classes by package name, and scaffolded the new @khaveeai/providers-generic-stt-tts workspace package.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-18T06:30:00Z
- **Completed:** 2026-06-18T06:42:34Z
- **Tasks:** 3
- **Files modified:** 7 (1 modified core type, 1 modified barrel, 4 created scaffold files, 1 lockfile)

## Accomplishments
- `LLMProvider.complete()` and `TTSProvider.speak()` now accept an optional `signal?: AbortSignal`, making ORCH-03 barge-in cancellation expressible without breaking any existing or future provider implementation
- `@khaveeai/providers-openai-stt-tts`'s barrel now additively exports `AudioRecorder`, `STTClient`, `ChatClient` (+ its `ChatMessage`/`ChatUsage`/`ChatResult` types), and `TTSPlayer` — unblocking the D-06 adapters from needing a banned relative cross-package import
- New `@khaveeai/providers-generic-stt-tts` workspace package scaffolded and linked via `pnpm install`, depending on both `@khaveeai/core` and `@khaveeai/providers-openai-stt-tts` via `workspace:*`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add optional signal?: AbortSignal to LLMProvider.complete and TTSProvider.speak (D-01)** - `38837de` (feat)
2. **Task 2: Add additive helper-class exports to openai-stt-tts barrel** - `4cc774d` (feat)
3. **Task 3: Scaffold the @khaveeai/providers-generic-stt-tts workspace package** - `562bdb5` (feat)

_Note: worktree mode — STATE.md/ROADMAP.md plan-metadata commit is owned by the orchestrator, not this agent._

## Files Created/Modified
- `packages/core/src/types/pipeline.ts` - Added `signal?: AbortSignal` (with doc comment) to `LLMProvider.complete()` args and `TTSProvider.speak()` opts; zero other changes
- `packages/providers/openai-stt-tts/src/index.ts` - Appended additive exports of `AudioRecorder`, `STTClient`, `ChatClient`, `ChatMessage`/`ChatUsage`/`ChatResult`, `TTSPlayer`; existing exports untouched
- `packages/providers/generic-stt-tts/package.json` - New package manifest, `workspace:*` deps on `@khaveeai/core` and `@khaveeai/providers-openai-stt-tts`
- `packages/providers/generic-stt-tts/tsconfig.json` - Copied verbatim from openai-stt-tts (extends `../../../tsconfig.packages.json`)
- `packages/providers/generic-stt-tts/vitest.config.ts` - Copied verbatim from openai-stt-tts
- `packages/providers/generic-stt-tts/src/index.ts` - Placeholder barrel, single comment documenting future exports (Plans 02-03)
- `pnpm-lock.yaml` - Updated by `pnpm install` to register the new workspace package and its dependency edges

## Decisions Made
- Followed the plan's locked decisions (D-01, D-02, D-06) verbatim — no new decisions required during execution
- Confirmed via diff inspection that both interface edits and the barrel edit are purely additive (no deletions of existing lines beyond the edit context)

## Deviations from Plan

None - plan executed exactly as written. The only non-code action taken beyond the plan's literal task text was running `pnpm install` at the repo root (explicitly required by Task 3's action) which also updated `pnpm-lock.yaml` — this is the expected/required side effect of linking a new workspace package, not a deviation.

## Issues Encountered
- Initial `pnpm --filter @khaveeai/core build` failed with `Cannot find module 'vitest'`/`'axios'` because the worktree had no `node_modules` yet (worktrees don't inherit installed dependencies from the main checkout). Resolved by running `pnpm install` once at the start of Task 1's verification — not a deviation rule trigger, just standard worktree setup, and the same install also covered Task 3's package-linking requirement.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The `signal?: AbortSignal` plumbing is in place for Plans 02-02/02-03 to wire actual cancellation logic into the generic pipeline orchestrator
- The four openai-stt-tts helper classes are now importable by package name, unblocking the D-06 OpenAI-wrapping adapters that Plans 02-02/02-03 are expected to add inside `packages/providers/generic-stt-tts/src/`
- `@khaveeai/providers-generic-stt-tts` exists, builds (trivially, single comment), and is linked in the workspace — ready to receive `GenericPipelineProvider`, `GenericPipelineConfig`, and the OpenAI adapters
- No blockers identified for 02-02/02-03

---
*Phase: 02-generic-pipeline-orchestrator*
*Completed: 2026-06-18*

## Self-Check: PASSED

All 7 created/modified files verified present on disk; all 4 commit hashes (38837de, 4cc774d, 562bdb5, a779d2a) verified present in git log.
