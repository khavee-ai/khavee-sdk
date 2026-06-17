---
phase: 01-core-interfaces-tool-calling
plan: 02
subsystem: api
tags: [typescript, interfaces, pipeline, tool-calling, vendor-neutral]

# Dependency graph
requires:
  - phase: 01-core-interfaces-tool-calling
    provides: "Plan 01-01's promoted Tool/ToolResult/ExecutableTool types and ToolExecutor in packages/core/src/types/tools.ts"
provides:
  - "VADProvider, STTProvider, LLMProvider, TTSProvider vendor-neutral pipeline-stage interfaces in @khaveeai/core"
  - "ToolCall/LLMCompletionResult/STTResult vendor-neutral result types"
  - "Written Anthropic/Gemini multi-tool-call mapping sketch proving no interface redesign is needed"
  - "Resolved LLMProvider/TTSProvider naming collision (legacy types renamed to LegacyLLMProvider/LegacyTTSProvider)"
affects: [phase-02-pipeline-orchestrator, phase-04-vendor-adapters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pipeline-stage interfaces extend Provider (name/version) for orchestrator diagnostics"
    - "Capability flags (supportsStreaming, supportsToolCalling, supportsRejection) are readonly properties each implementation sets, not interface defaults"
    - "Vendor-neutral correlation id field is always named `id`, never copying a vendor's own wire-format field name"

key-files:
  created:
    - packages/core/src/types/pipeline.ts
  modified:
    - packages/core/src/types/mock.ts
    - packages/core/src/types/index.ts
    - packages/providers/mock/src/index.ts
    - packages/providers/openai/src/index.ts

key-decisions:
  - "Legacy mock.ts LLMProvider/TTSProvider renamed to LegacyLLMProvider/LegacyTTSProvider (Option 1 rename, per RESEARCH.md Pitfall 1) rather than reconciling the two abstractions"
  - "LLMProvider.complete() is a clean-slate design, not a retrofit of ChatClient — toolCalls: ToolCall[] is net-new"
  - "VADProvider has no supportsStreaming flag — VAD is inherently event-driven, not streaming-vs-batch"

requirements-completed: [CORE-01, CORE-02, CORE-06]

# Metrics
duration: 25min
completed: 2026-06-18
---

# Phase 01 Plan 02: Pipeline-Stage Interfaces & Tool-Calling Types Summary

**Four vendor-neutral pipeline interfaces (VADProvider, STTProvider, LLMProvider, TTSProvider) with capability flags and an array-based, vendor-neutral ToolCall/LLMCompletionResult shape, validated against Anthropic and Gemini multi-tool-call response shapes via a written sketch.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-18 (worktree branch check)
- **Completed:** 2026-06-18
- **Tasks:** 2 completed
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- Resolved the `LLMProvider`/`TTSProvider` naming collision between legacy `mock.ts` and the new pipeline-stage interfaces by renaming the legacy exports to `LegacyLLMProvider`/`LegacyTTSProvider` and updating both downstream consumers (`@khaveeai/providers-mock`, `@khaveeai/providers-openai`)
- Created `packages/core/src/types/pipeline.ts` with `VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider` — each extending the existing `Provider` marker interface and declaring at least one `readonly` capability flag
- Defined vendor-neutral `ToolCall { id, name, args }`, `LLMCompletionResult { text?, toolCalls: ToolCall[] }`, and `STTResult { text, rejected? }` types satisfying D-04, D-05, D-06
- Wrote an inline multi-vendor mapping sketch demonstrating Anthropic `tool_use` blocks (parallel calls) and Gemini `functionCall` parts both funnel onto `{id, name, args}` without requiring an interface redesign
- Verified zero occurrences of any vendor-specific correlation-field name (avoided even in comments) anywhere in `pipeline.ts`, confirming CORE-06 compliance at the textual level, not just in type declarations

## Task Commits

Each task was committed atomically:

1. **Task 1: Resolve the LLMProvider/TTSProvider naming collision in mock.ts and its consumers** - `12d2faa` (fix)
2. **Task 2: Create pipeline.ts with the four provider interfaces, capability flags, ToolCall/LLMCompletionResult, and the multi-vendor sketch** - `5bdc849` (feat)

**Plan metadata:** (this commit, after SUMMARY.md)

## Files Created/Modified
- `packages/core/src/types/pipeline.ts` - New: VADProvider, STTProvider, LLMProvider, TTSProvider interfaces; ToolCall, LLMCompletionResult, STTResult types; written vendor-mapping sketch
- `packages/core/src/types/mock.ts` - Renamed `LLMProvider`→`LegacyLLMProvider`, `TTSProvider`→`LegacyTTSProvider`; updated `KhaveeConfig` field types
- `packages/core/src/types/index.ts` - Added `export * from './pipeline';` to the barrel
- `packages/providers/mock/src/index.ts` - `MockLLM`/`MockTTS` now implement `LegacyLLMProvider`/`LegacyTTSProvider`
- `packages/providers/openai/src/index.ts` - `LLMOpenAI` now implements `LegacyLLMProvider`

## Decisions Made
- Followed RESEARCH.md's recommended Option 1 (rename-at-definition) for the naming collision rather than attempting reconciliation between the legacy `streamChat`-based abstraction and the new pipeline-stage interfaces — this kept the change mechanical and zero-behavior-change, verified via `git diff` showing only identifier renames.
- `pipeline.ts`'s mapping-sketch comment deliberately avoids spelling out vendor-specific correlation field names verbatim (e.g. paraphrasing "the matching id on the tool result message" instead of naming the literal OpenAI/Anthropic field) so the file satisfies a strict zero-occurrence textual check for those vendor-specific names, not just the type declarations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Ran `pnpm install` in the worktree to enable build verification**
- **Found during:** Task 2 verification (`pnpm --filter @khaveeai/core build`)
- **Issue:** This git worktree had no `node_modules` installed at all (fresh worktree, gitignored), so `tsc` could not resolve any dependency, blocking every verification command in the plan.
- **Fix:** Ran `pnpm install --frozen-lockfile` to materialize the existing lockfile's dependency tree into this worktree. No `package.json` or `pnpm-lock.yaml` changes were made or needed — this only populated `node_modules`.
- **Files modified:** None (node_modules is gitignored; no tracked files changed by the install itself)
- **Verification:** `pnpm --filter @khaveeai/core build` and `pnpm --filter @khaveeai/providers-openai build` both succeeded after install.
- **Side-effect cleanup:** Per parallel-execution guidance, the install rewrote `packages/providers/qdrant/node_modules/.bin/*` shim symlinks to absolute paths inside this worktree. These were untracked-but-modified files; reverted via `git checkout -- packages/providers/qdrant/node_modules/.bin/{eslint,jest,openai,tsc,tsserver,tsup,tsup-node}` before the final commit so they would not corrupt the orchestrator's merge.
- **Committed in:** N/A (no tracked files changed by this fix)

**2. [Investigation only, no fix applied — documented for awareness] Stale dependency pin in `@khaveeai/providers-mock`'s package.json blocks its own `tsc` build, unrelated to this plan's changes**
- **Found during:** Task 2 verification (`pnpm --filter @khaveeai/providers-mock build`)
- **Issue:** `packages/providers/mock/package.json` declares `"@khaveeai/core": "^0.1.5"` (a stale semver pin, predating this phase — confirmed via `git log`/`git show` against commit `8b59f1e`) instead of `"workspace:*"` like the sibling `@khaveeai/providers-openai` package uses. This causes pnpm to resolve `@khaveeai/core` from a stale virtual-store snapshot (`@khaveeai+core@0.1.5`) instead of the live workspace source, so the package's own `tsc` build could not see the renamed `LegacyLLMProvider`/`LegacyTTSProvider` types and failed with `TS2305`.
- **Investigation:** Confirmed this is a pre-existing, out-of-scope issue (not introduced by this plan, not part of this plan's `files_modified`) by temporarily re-pointing `packages/providers/mock/node_modules/@khaveeai/core`'s symlink directly at the workspace `packages/core` source (a `node_modules`-only change, never committed) and re-running the build — it succeeded clean, proving the rename in Task 1 is correct and the `providers-mock` package's own build failure is solely due to its own stale dependency declaration.
- **Resolution:** Left `packages/providers/mock/package.json` untouched per the Scope Boundary rule (out-of-scope pre-existing issue, not directly caused by this plan's task changes) and reverted the temporary symlink override before committing. Logged here, not in `deferred-items.md`, since it directly affects future verification of this plan's acceptance criteria and the next plan/phase should be aware `providers-mock`'s build is not currently exercisable through the standard `pnpm --filter` path until its dependency pin is fixed.
- **Files modified:** None (investigation was reverted; no committed change)
- **Committed in:** N/A

---

**Total deviations:** 1 environmental fix (Rule 3, no tracked-file impact) + 1 investigation-only finding (no fix applied, out of scope)
**Impact on plan:** No scope creep. Both pipeline-stage interface tasks completed exactly as specified; the `@khaveeai/core` and `@khaveeai/providers-openai` builds (the two builds this plan's verification block actually requires to prove the collision is resolved) both pass clean.

## Issues Encountered
- `@khaveeai/providers-mock`'s build could not be verified through the normal `pnpm --filter` path due to a pre-existing stale dependency pin unrelated to this plan (see Deviation 2 above). The underlying rename (Task 1) was independently verified correct via a reverted symlink override. A future plan/phase should fix `packages/providers/mock/package.json`'s `@khaveeai/core` dependency to `workspace:*` to restore normal build verification for that package.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `@khaveeai/core` now exports `VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`, `ToolCall`, `LLMCompletionResult`, `STTResult` — ready for Phase 2's pipeline orchestrator to compose against.
- The vendor-neutral `ToolCall`/`LLMCompletionResult` shape is validated (via written sketch) against OpenAI (single-call), OpenAI Realtime (single-call), Anthropic (multi-call), and Gemini (multi-call) without requiring an interface redesign — de-risks Phase 4's adapter work.
- Known pre-existing blocker (not introduced this plan): `packages/providers/mock/package.json`'s stale `@khaveeai/core` semver pin should be corrected to `workspace:*` before that package's build is exercised in CI or future plans depend on it compiling cleanly.

---
*Phase: 01-core-interfaces-tool-calling*
*Completed: 2026-06-18*

## Self-Check: PASSED

- FOUND: packages/core/src/types/pipeline.ts
- FOUND: .planning/phases/01-core-interfaces-tool-calling/01-02-SUMMARY.md
- FOUND commit: 12d2faa (fix: rename legacy LLMProvider/TTSProvider)
- FOUND commit: 5bdc849 (feat: pipeline.ts interfaces)
- FOUND commit: f4045e7 (docs: SUMMARY.md)
