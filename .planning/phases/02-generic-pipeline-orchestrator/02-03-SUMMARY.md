---
phase: 02-generic-pipeline-orchestrator
plan: 03
subsystem: api
tags: [typescript, orchestrator, abortsignal, tool-calling-loop, vitest-tdd]

# Dependency graph
requires:
  - phase: 02-generic-pipeline-orchestrator
    plan: 01
    provides: "signal?: AbortSignal on LLMProvider/TTSProvider, additive exports of AudioRecorder/STTClient/ChatClient/TTSPlayer, scaffolded @khaveeai/providers-generic-stt-tts package"
  - phase: 02-generic-pipeline-orchestrator
    plan: 02
    provides: "Four D-06 adapter classes (OpenAIVADAdapter, OpenAISTTAdapter, OpenAILLMAdapter, OpenAITTSAdapter) implementing VADProvider/STTProvider/LLMProvider/TTSProvider, the [tool_result id=<id> name=<name>] convention parser in OpenAILLMAdapter"
provides:
  - "GenericPipelineProvider — the composable orchestrator implementing RealtimeProvider from {vad, stt, llm, tts, pipelineTools?, micReopenCooldownMs?} (ORCH-01/02)"
  - "Full-interruption barge-in (D-03): mid-turn utterances abort the active turn's AbortController and start a new turn instead of dropping"
  - "Bounded 5-round multi-round tool-calling loop via ToolExecutor (D-04/D-05), writing the [tool_result id=<id> name=<name>] convention that OpenAILLMAdapter parses"
  - "Config-driven mic-reopen cooldown via resumeWithCooldown()/config.micReopenCooldownMs, default 500 (D-08, ORCH-04)"
  - "Uniform error normalization to Error instances at every await boundary, with signal.aborted superseded-result guards (ORCH-05)"
  - "Completed package barrel (src/index.ts): GenericPipelineProvider, GenericPipelineConfig, and the four OpenAI adapters + their config types"
affects: [generic-pipeline-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config-field renaming over narrowing when an inherited optional property's type is NOT structurally compatible with a stricter local type (Tool[] vs RealtimeTool[]) — GenericPipelineConfig.pipelineTools instead of overriding RealtimeConfig.tools"
    - "AbortController per-turn full-interruption barge-in: abort the previous controller without returning, immediately proceed with a fresh controller for the new turn"
    - "signal?.aborted guard placed after every awaited provider call and before every side effect (conversation/messages mutation, setChatStatus) to discard superseded turn results"
    - "Minimal in-test AudioContext global stub (vi.stubGlobal) for exercising real connect()/disconnect() lifecycle code in a vitest node environment that has no browser AudioContext"

key-files:
  created:
    - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
    - packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts
  modified:
    - packages/providers/generic-stt-tts/src/index.ts

key-decisions:
  - "GenericPipelineConfig.tools narrowing to Tool[] does NOT compile (tsc: 'Property type is incompatible with index signature' — Tool.parameters.required is a top-level string[], RealtimeTool.parameters[key].required is a per-property boolean). Per the plan's documented fallback, renamed the field to pipelineTools?: Tool[] and left the inherited RealtimeConfig.tools?: RealtimeTool[] field unused on this config type."
  - "Tool-result-to-history round-trip uses the exact [tool_result id=<id> name=<name>] <message> convention Plan 02's OpenAILLMAdapter already implements a parser for — confirms the Phase-2-local protocol resolving RESEARCH Open Question 2 works end-to-end across both plans."
  - "ORCH-04 cooldown tests assert on promise-resolution timing (via vi.useFakeTimers + vi.advanceTimersByTimeAsync) rather than chatStatus, since chatStatus legitimately stays 'ready' throughout a fake-mocked turn with no real audio playback callback firing — testing the resumeWithCooldown() delay directly is the correct signal."
  - "Added a minimal FakeAudioContext class via vi.stubGlobal in the test file (not a deviation — required to exercise connect()/disconnect()'s real AudioContext lifecycle code, since vitest's node test environment, matching openai-stt-tts's own config, has no AudioContext global; openai-stt-tts's existing tests sidestep this by never calling connect())."

requirements-completed: [ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05]

# Metrics
duration: 48min
completed: 2026-06-18
---

# Phase 2 Plan 3: GenericPipelineProvider Orchestrator Summary

**Built the GenericPipelineProvider orchestrator class — composes {vad, stt, llm, tts, pipelineTools?} into a RealtimeProvider implementation with full-interruption barge-in, a bounded 5-round tool-calling loop, config-driven mic-reopen cooldown, and uniform error normalization — then proved it end-to-end with the four real OpenAI adapters from Plan 02.**

## Performance

- **Duration:** 48 min
- **Started:** 2026-06-18T13:30:00Z (approx, worktree branch checkout)
- **Completed:** 2026-06-18T14:19:10Z
- **Tasks:** 3
- **Files modified:** 3 (1 new orchestrator class, 1 new test file, 1 completed barrel)

## Accomplishments
- `GenericPipelineProvider implements RealtimeProvider`, constructed from `{vad, stt, llm, tts, pipelineTools?, micReopenCooldownMs?}` — a structural port of `OpenAISTTTTSProvider`'s entire lifecycle (`connect`/`disconnect`/`interrupt`/`sendMessage`/`setChatStatus`/`trimHistory`) with the four concrete OpenAI helper classes swapped for the four Phase 1 interfaces
- Full-interruption barge-in (D-03): `runTurn()` aborts the active turn's `AbortController` on a new utterance and immediately proceeds with a fresh turn — the opposite of `OpenAISTTTTSProvider`'s `_isTurnActive` drop-and-return guard
- Bounded multi-round tool-calling loop (D-04/D-05): `runTurnFromText()` loops `llm.complete()` → `ToolExecutor.execute()` per call → append `[tool_result id=<id> name=<name>] <message>` to history, capped at `MAX_TOOL_ROUNDS = 5`; exceeding the cap throws a normalized `Error` containing "exceeded"
- `resumeWithCooldown()` helper reads `this.config.micReopenCooldownMs ?? 500` (D-08, ORCH-04) — no hardcoded `setTimeout(resolve, 500)` independent of config anywhere; called from both the success and catch paths of `runTurnFromText`
- Every await boundary normalizes non-Error rejections (`error instanceof Error ? error : new Error(String(error))`) and every side-effecting step after an await checks `signal?.aborted` to discard superseded (barge-in'd) turn results
- 26 tests pass across the full package (18 carried from Plan 02's adapters + 8 new provider tests), including a real ORCH-02 integration test that composes all four `OpenAI*Adapter` classes into `GenericPipelineProvider`, drives a turn, and asserts an assistant `conversation` entry lands — proving the abstraction end-to-end with zero `@khaveeai/react` changes
- Completed `src/index.ts`: exports `GenericPipelineProvider`, `GenericPipelineConfig`, and all four adapters + their config types

## Task Commits

Each task was committed atomically, following the TDD-flavored structure the plan specified:

1. **Task 1 — GenericPipelineProvider lifecycle, config composition, cooldown, error normalization** - `79d5bc6` (feat)
2. **Task 2 — Turn pipeline: full barge-in + multi-round tool-calling loop** - `c1197b9` (feat)
3. **Task 3 — Tests (conformance, barge-in, cooldown, error-normalization, tool-loop, adapter integration) + barrel export** - `33dd0f4` (test)

_Note: worktree mode — STATE.md/ROADMAP.md plan-metadata commit is owned by the orchestrator, not this agent._

## Files Created/Modified
- `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` - The orchestrator class: `GenericPipelineConfig extends RealtimeConfig`, full lifecycle (connect/disconnect/interrupt/sendMessage), `runTurn`/`runTurnFromText` with D-03 barge-in and D-04/D-05 tool loop, `resumeWithCooldown()`, `setChatStatus`/`trimHistory` ported verbatim
- `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` - 8 tests: ORCH-01/02 conformance, ORCH-03 barge-in signal abortion, ORCH-04 cooldown timing (default + override), ORCH-05 non-Error normalization, D-04/D-05 tool-loop (2-round success + 5-round cap), ORCH-02 four-real-adapter integration
- `packages/providers/generic-stt-tts/src/index.ts` - Completed barrel: `GenericPipelineProvider`, `GenericPipelineConfig`, `OpenAIVADAdapter`/`OpenAISTTAdapter`/`OpenAILLMAdapter`/`OpenAITTSAdapter` + their config types

## Decisions Made
- Followed the plan's `Tool[]` vs `RealtimeTool[]` discretion explicitly: attempted the narrowing first (per Pattern 1's primary suggestion), confirmed via tsc that it does NOT compile, then applied the plan's own documented fallback (rename to `pipelineTools?: Tool[]`) and added an inline comment recording the exact tsc error encountered, so future maintainers don't re-attempt the same narrowing
- Chose to assert ORCH-04's cooldown behavior via promise-resolution timing under `vi.useFakeTimers()` rather than `chatStatus` transitions, since `chatStatus` legitimately never leaves `"ready"` in a fully-mocked turn where the TTS fake never invokes the `onAudioData` callback that would normally trigger the "speaking" transition — the cooldown's actual effect (delaying when `sendMessage()`'s promise resolves) is the correct, more direct signal to test
- Used the exact Phase-2-local tool-result convention plan 02 already built a parser for (`[tool_result id=<id> name=<name>] <message>`) with zero deviation, confirming both plans' independent implementations of the same documented protocol are compatible

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Worktree had no built `dist/` output for `@khaveeai/core` or `@khaveeai/providers-openai-stt-tts`**
- **Found during:** Task 1, first build attempt of `@khaveeai/providers-generic-stt-tts`
- **Issue:** This worktree had not yet run `pnpm install`/`pnpm build` for its dependencies (worktrees do not inherit installed node_modules or build artifacts from the main checkout), so `tsc` failed to resolve `@khaveeai/core` and `@khaveeai/providers-openai-stt-tts` imports.
- **Fix:** Ran `pnpm install` at the repo root, then `pnpm --filter @khaveeai/core build` and `pnpm --filter @khaveeai/providers-openai-stt-tts build` before proceeding — identical bootstrapping step Plans 01/02 also needed and documented.
- **Files modified:** None (build-artifact generation only; `dist/`/`node_modules/` remain untracked, matching every sibling provider package)
- **Commit:** N/A (no source change — pre-task environment bootstrap)

**2. [Rule 3 - Blocking issue] `Tool[]` narrowing of `RealtimeConfig.tools` does not compile**
- **Found during:** Task 1, first build attempt after writing `GenericPipelineConfig`
- **Issue:** `tsc` rejected `tools?: Tool[]` as an override of the inherited `RealtimeConfig.tools?: RealtimeTool[]` field: `Type 'Tool[]' is not assignable to type 'RealtimeTool[]'` because `Tool.parameters` has a top-level `required?: string[]` while `RealtimeTool.parameters[key]` has a per-property `required?: boolean` — confirming the exact incompatibility RESEARCH/PATTERNS flagged as a risk to verify.
- **Fix:** Applied the plan's own documented fallback: renamed the field to `pipelineTools?: Tool[]`, left `RealtimeConfig.tools` unused on this config type, updated all internal usages (`config.pipelineTools`, `this.config.pipelineTools`) and the test file's tool-loop test configs accordingly.
- **Files modified:** `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts`, `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts`
- **Commit:** `79d5bc6` (field rename), `33dd0f4` (test usages)

**3. [Rule 1 - Bug] Test commands run from the main repo path instead of the worktree path produced false negatives**
- **Found during:** Task 3, initial test-suite run after writing `GenericPipelineProvider.test.ts`
- **Issue:** Several of my own intermediate `cd /Users/whitemalt/Documents/khavee-sdk && ...` shell commands resolved to the main repository checkout, not this worktree (`/Users/whitemalt/Documents/khavee-sdk/.claude/worktrees/agent-a0fd791adc95bfa63`), since both paths share a literal prefix. This caused `pnpm --filter ... build/test` to silently operate on stale main-repo state that didn't contain the new test file, producing misleading "file not found" / "0 new tests" results.
- **Fix:** Switched to commands that rely on the tool's own per-call cwd reset (already anchored at the worktree root) instead of an explicit `cd` to a hardcoded main-repo-shaped path; re-ran all builds/tests from the correct worktree location, after which every command resolved correctly.
- **Files modified:** None (test-execution hygiene only, no source change)
- **Commit:** N/A

**4. [Rule 1 - Bug] vitest's node environment has no global `AudioContext`, causing `connect()` to silently fail in tests that exercise it**
- **Found during:** Task 3, debugging why `vad.onUtteranceReady` was never wired in the barge-in test
- **Issue:** `connect()` calls `new AudioContext()` unconditionally; vitest's `environment: "node"` config (copied verbatim from `openai-stt-tts`, which has the identical line in its own `connect()`) has no `AudioContext` global, so the call threw `ReferenceError: AudioContext is not defined`, was caught by `connect()`'s own catch block, silently routed to `onError` (no listener attached in the failing test), and `connect()` fell through to `disconnect()` — leaving `micEnabled` false and `vad.onUtteranceReady` unset. `openai-stt-tts`'s own test suite avoids this entirely by never calling `connect()` (it drives turns via `sendMessage()` only), but ORCH-03's barge-in test genuinely needs the VAD event wiring that only `connect()` performs.
- **Fix:** Added a minimal `FakeAudioContext` class (`state`, `close()`) registered via `vi.stubGlobal("AudioContext", FakeAudioContext)` at the top of the test file, scoped to this test file only — does not touch `openai-stt-tts` or any other package's test environment.
- **Files modified:** `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts`
- **Commit:** `33dd0f4`

No deviations beyond the four documented above — the orchestrator's structure, barge-in semantics, tool-loop bounds, cooldown wiring, and error normalization were all implemented per the plan's action blocks with no architectural changes.

## Issues Encountered
- See Deviation #3 above (cwd resolution) — resolved by avoiding hardcoded `cd` paths sharing a prefix with the worktree root; all subsequent commands ran correctly from the worktree.
- See Deviation #4 above (AudioContext global) — resolved with an in-test polyfill; no production code change was needed since `GenericPipelineProvider`'s `connect()`/`disconnect()` AudioContext lifecycle guard logic (ported verbatim from `OpenAISTTTTSProvider`) is correct as written, the gap was purely in the test environment.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `GenericPipelineProvider` is the phase deliverable: any combination of `VADProvider`/`STTProvider`/`LLMProvider`/`TTSProvider` implementations (the four `OpenAI*Adapter` classes today; Thonburian/JaiTTS adapters in later phases) composes into a working `RealtimeProvider` with zero `@khaveeai/react` changes
- The package barrel (`src/index.ts`) now exports the complete public surface: `GenericPipelineProvider`, `GenericPipelineConfig`, and all four OpenAI adapters + their config types — ready for a demo app page to import and wire up, or for Phase 3's Thonburian/JaiTTS adapters to be composed alongside the existing OpenAI ones
- `pipelineTools` (not `tools`) is the field name future adapter/config consumers must use for tool-calling — documented inline in `GenericPipelineConfig`'s doc comment with the exact tsc error that necessitated the rename, so this isn't rediscovered
- No blockers identified for subsequent phases

---
*Phase: 02-generic-pipeline-orchestrator*
*Completed: 2026-06-18*
