---
phase: 02-generic-pipeline-orchestrator
verified: 2026-06-18T18:30:00Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/5
  gaps_closed:
    - "registerFunction() silent no-op (GAP-02-05) — tool registered post-construction via the public RealtimeProvider API is now BOTH dispatchable (ToolExecutor, unchanged) AND offered to the LLM (new pipelineToolList, seeded from config.pipelineTools, mutated idempotently-by-name by registerFunction, read by runTurnFromText's tools: field). Confirmed by reading GenericPipelineProvider.ts lines 89, 146-151, 180-222, 497-502 directly — not just trusting the SUMMARY. 31/31 tests pass, 3 new GAP-02-05 tests confirmed present and substantive (conversion-shape assertion, dedupe assertion, combined-list assertion)."
  gaps_remaining:
    - "CR-03 (NEW, discovered by code review AFTER GAP-02-05 was committed, never addressed by any subsequent commit): the multi-round tool-calling loop in GenericPipelineProvider.runTurnFromText never appends the LLM's assistant-role tool_calls message into history before pushing the tool-result message for the next round — a protocol violation that breaks any real OpenAI-compatible backend on round 2 of tool-calling."
  regressions: []
gaps:
  - truth: "ORCH-01: Developer can construct a working voice pipeline by passing {vad, stt, llm, tts, tools} to a single generic orchestrator class — including the multi-round tool-calling capability the phase's own plan (02-03, D-04/D-05) established and tested as part of this contract"
    status: failed
    reason: "The bounded multi-round tool-calling loop (GenericPipelineProvider.ts:493-530) executes tool calls and pushes only a role:\"user\" tool-result message into history; it never pushes the assistant's own role:\"assistant\" message carrying the tool_calls array that produced those results. Every OpenAI-compatible Chat Completions backend requires a role:\"tool\" message to be immediately preceded by the assistant message bearing the matching tool_calls entry; a request missing it is rejected with HTTP 400. Concretely: round 1's complete() call returns toolCalls, the tools execute, only a user-role tool-result message is appended, and round 2's complete() call sends a message array with the load-bearing assistant/tool_calls entry missing — guaranteeing rejection on any second round of any real tool-calling conversation. I independently confirmed this by reading GenericPipelineProvider.ts lines 493-530 directly (no this.messages.push({role:\"assistant\",...}) appears anywhere in the tool-calling loop) and by reading OpenAILLMAdapter.ts's mapMessage() (lines 146-153), which has no code path capable of emitting {role:\"assistant\", tool_calls:[...]} because the orchestrator never gives it an assistant/tool_calls message to map. This is invisible to GenericPipelineProvider.test.ts's D-04/D-05 tests because the fake LLM (complete: vi.fn().mockImplementation(async () => {...})) ignores args.messages entirely (confirmed by reading the test at lines 346-388) — round-counting is done via a closure variable, not by inspecting what was sent. Multi-round tool-calling was explicitly named as a must-have truth/tested behavior in plan 02-03 (D-04/D-05), making this a phase-scope defect, not an out-of-scope nice-to-have. It also directly threatens Phase 5's success criterion #2 (a registered tool the LLM calls, whose result is reflected in the next reply) since even a single tool call requires a round-2 complete() call that would carry the same missing assistant-message defect."
    artifacts:
      - path: "packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts"
        issue: "Lines 514-529: tool-calling loop pushes only the role:\"user\" tool-result message (`this.messages.push({role: \"user\", content: \`[tool_result id=... name=...] ...\`})`); never pushes a role:\"assistant\" message carrying the tool_calls the LLM emitted, before looping back to call llm.complete() again."
      - path: "packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts"
        issue: "mapMessage() (lines 146-153) has exactly two paths: the [tool_result ...] marker -> role:\"tool\", or passthrough. No path emits {role:\"assistant\", tool_calls:[...]}, because the orchestrator never produces an assistant/tool_calls history entry for it to recognize."
      - path: "packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts"
        issue: "D-04/D-05 tests (lines 346-388) use a fake LLM that ignores args.messages entirely (round-counting via closure variable), so they pass even though the message history sent on round 2 would be rejected by any real OpenAI-compatible backend. Green tests here are not evidence the multi-round loop works against a real vendor."
    missing:
      - "Push the assistant's tool-call-bearing turn into this.messages (e.g. an `[assistant_tool_calls] <json>` marker, or richer encoding carrying the full tool_calls array) immediately after receiving a result with result.toolCalls.length > 0, BEFORE executing the tools / pushing tool-result messages for that round."
      - "Update OpenAILLMAdapter.mapMessage() to recognize the new assistant/tool_calls marker and re-emit it as OpenAI's actual {role:\"assistant\", content:null, tool_calls:[...]} wire shape."
      - "Add a regression test that captures the messages array passed to the SECOND llm.complete() call in a 2+ round tool-calling turn and asserts it contains an assistant-role entry referencing the round-1 tool_call id, immediately followed by the matching tool-role entry — proving the fake LLM actually validates message shape instead of ignoring args.messages."
deferred: []
human_verification: []
---

# Phase 2: Generic Pipeline Orchestrator Verification Report

**Phase Goal:** A developer can assemble a complete voice pipeline from any combination of the Phase 1 interfaces using one orchestrator class, with no changes required in `@khaveeai/react`
**Verified:** 2026-06-18T18:30:00Z
**Status:** gaps_found
**Re-verification:** Yes — after gap-closure plan 02-05 (GAP-02-05: registerFunction() LLM-visibility fix) AND the subsequent fresh code-review pass (02-REVIEW.md) that discovered CR-03, a new and still-unaddressed Critical finding

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A developer can construct a working pipeline by passing `{vad, stt, llm, tts, tools}` to a single generic orchestrator class, INCLUDING functioning multi-round tool-calling (ORCH-01, D-04/D-05) | ✗ FAILED | Single-round tool-calling works (constructor wiring confirmed at `GenericPipelineProvider.ts:138-151`; GAP-02-05 fix for post-construction `registerFunction()` confirmed real by direct source read). But the multi-round loop (`GenericPipelineProvider.ts:493-530`) never appends the LLM's assistant/`tool_calls` message into history before the next round — confirmed by reading the loop body line-by-line: only `this.messages.push({role:"user", content: "[tool_result ...]"})` appears (line 525-528), no `role:"assistant"` push exists anywhere between receiving `result` (line 497) and the next loop iteration. Any real OpenAI-compatible backend rejects round 2 with HTTP 400 (missing required assistant/tool_calls predecessor message). See Gaps Summary / CR-03 below. |
| 2 | The orchestrator implements `RealtimeProvider` and runs unmodified through `@khaveeai/react`'s existing hook (ORCH-02) | ✓ VERIFIED | `class GenericPipelineProvider implements RealtimeProvider` confirmed (`GenericPipelineProvider.ts:75`). `git diff $(git merge-base main HEAD) HEAD -- packages/react/` is empty (re-confirmed this pass). Build exits 0. Integration test (`ORCH-02 integration` describe block) composes all four real adapters and passes. |
| 3 | Triggering new user speech mid-turn cancels in-flight LLM/TTS work via an `AbortSignal`-style hook (ORCH-03, full barge-in D-03) | ✓ VERIFIED | Unchanged from prior verification, re-confirmed by reading current source: CR-01 guard at `runTurnFromText`'s first statement (`GenericPipelineProvider.ts:478`, `if (signal?.aborted) return;`), CR-02 fix in `sendMessage()` (`:399-412`, abort-prior/register-fresh/finally-clear). Not touched by 02-05 or any commit since the prior re-verification; no regression risk introduced. |
| 4 | The VAD-to-mic-reopen cooldown is set via a constructor/config value (ORCH-04, D-08) | ✓ VERIFIED | Unchanged. `this.config = { micReopenCooldownMs: 500, ...config }` (`:139`); `resumeWithCooldown()` reads `this.config.micReopenCooldownMs ?? 500` (`:594`). Untouched by 02-05. |
| 5 | A provider throwing/rejecting with a non-Error value reaches the orchestrator's error callback as a normalized `Error` instance without crashing the active session (ORCH-05) | ✓ VERIFIED | Unchanged. Normalization pattern confirmed present at all await boundaries in current file (`:331`, `:453`, `:579`). Untouched by 02-05. |

**Score:** 4/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/types/pipeline.ts` | `signal?: AbortSignal` on `LLMProvider.complete` and `TTSProvider.speak` | VERIFIED | Unaffected by 02-05; confirmed present in prior pass, not re-derived this pass since untouched |
| `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` | Composable orchestrator implementing `RealtimeProvider`; multi-round tool-calling loop that produces a wire-protocol-valid message sequence | ⚠️ PARTIAL — implements `RealtimeProvider` correctly (VERIFIED); single-round tool dispatch/visibility correct (VERIFIED, GAP-02-05); **multi-round message-history construction is broken** (FAILED, CR-03) — see Gaps |
| `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts` | `implements LLMProvider`, maps history messages to OpenAI wire shape including assistant/tool_calls entries | ⚠️ PARTIAL — `mapMessage()` correctly handles the `[tool_result ...]` marker and plain passthrough (VERIFIED, 9/9 adapter tests pass) but has no code path for an assistant/tool_calls message because the orchestrator never produces one to map (gap traced to `GenericPipelineProvider.ts`, not this file) |
| `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` | Multi-round tool-calling loop tests that validate real backend-compatible message-history shape | ✗ STUB (for this specific concern) — D-04/D-05 tests exist and pass (31/31 total, confirmed by running `pnpm --filter @khaveeai/providers-generic-stt-tts test --run`), but the fake LLM never inspects `args.messages`, so these tests provide zero coverage of the actual defect; they are not evidence the multi-round loop works against a real vendor |
| All other Phase 2 artifacts (4 adapters, barrel exports, package.json) | Unchanged from prior verification | VERIFIED | Re-confirmed present via `ls`; 02-05 only touched `GenericPipelineProvider.ts` and its test file (confirmed via `git log` and SUMMARY's `key-files: modified` list) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `GenericPipelineProvider.ts` (`registerFunction`) | `this.pipelineToolList` (LLM-visibility list) | filter-then-push, idempotent-by-name | WIRED | Confirmed by direct read: lines 180-187, 197-222 (conversion helper), 89 (field decl), 151 (constructor seed), 501 (read at llm.complete() call site) |
| `GenericPipelineProvider.ts` (tool-calling loop, round N) | `GenericPipelineProvider.ts` (tool-calling loop, round N+1) | shared `this.messages` array carrying full conversational + tool-call context | ✗ NOT WIRED | The round-N assistant tool_calls message is never written to `this.messages`, so round N+1's `llm.complete({messages: this.messages, ...})` call is missing the wire-protocol-required predecessor message. This is the CR-03 defect — the link between "tools were called" and "the LLM is told what it called" is broken. |
| `OpenAILLMAdapter.ts` (`mapMessage`) | OpenAI wire shape `{role:"assistant", tool_calls:[...]}` | recognized marker pattern | ✗ NOT WIRED | No marker/pattern exists for this case (only `TOOL_RESULT_PATTERN` for `role:"tool"` exists); confirmed by reading the full `mapMessage()` function body (4 lines, two branches, neither matches this shape) |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces a backend orchestrator class (no UI rendering of dynamic data). The relevant "data flow" is conversational/tool-call message-history construction, traced above under Key Link Verification — and found broken for the multi-round case.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build clean | `pnpm --filter @khaveeai/providers-generic-stt-tts build` | Exit 0 (`tsc`, no output) | PASS |
| Full new-package test suite | `pnpm --filter @khaveeai/providers-generic-stt-tts test --run` | 31/31 pass (4 files: GenericPipelineProvider 13, OpenAILLMAdapter 9, OpenAISTTAdapter 5, OpenAITTSAdapter 4) | PASS (but does not cover CR-03 — see Gaps) |
| Compatibility regression (openai-stt-tts untouched) | `pnpm --filter @khaveeai/providers-openai-stt-tts test --run` | 13/13 pass, unchanged | PASS |
| GAP-02-05 fix is real (not just claimed) | Read `GenericPipelineProvider.ts` lines 89, 146-151, 180-222, 497-502 directly | `pipelineToolList` field exists, seeded in constructor, mutated idempotently-by-name in `registerFunction`, read (not `config.pipelineTools`) at the `llm.complete()` call site | PASS |
| CR-03 defect is real (not a stale/already-fixed review finding) | Read `GenericPipelineProvider.ts` lines 493-530 (the full tool-calling loop body) and `OpenAILLMAdapter.ts` lines 142-153 (`mapMessage`) directly; checked `git log` for any commit on this file after `4ea68df` (the GAP-02-05 fix commit) | No `role:"assistant"` push exists anywhere in the loop; no commit exists after `4ea68df` touching this file; `git status` shows the file is not currently modified | CONFIRMED PRESENT — this is a genuine, currently-unfixed gap, not a false alarm |
| `react` package zero-diff (ORCH-02 "no react changes" claim) | `git diff $(git merge-base main HEAD) HEAD -- packages/react/` | Empty diff | PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` files and none are referenced in any PLAN/SUMMARY for phase 02. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|--------------|----------------|--------------|--------|----------|
| ORCH-01 | 02-01, 02-02, 02-03, 02-05 | Construct pipeline from `{vad,stt,llm,tts,tools}`, including working tool-calling (single AND multi-round, per 02-03's own D-04/D-05 must-haves) | ✗ BLOCKED | Single-round dispatch/visibility correct; multi-round message-history construction broken (CR-03) — guarantees HTTP 400 from any real OpenAI-compatible backend on round 2 of any tool-calling conversation |
| ORCH-02 | 02-02, 02-03 | Implements `RealtimeProvider`, no react changes | SATISFIED | `implements RealtimeProvider`; zero diff in `packages/react/`; integration test with real adapters passes |
| ORCH-03 | 02-01, 02-02, 02-03, 02-04 | Barge-in cancels in-flight work via AbortSignal | SATISFIED | Confirmed unchanged and still correct this pass; CR-01/CR-02 fixes present in current source |
| ORCH-04 | 02-03 | Config-driven cooldown, not hardcoded | SATISFIED | Confirmed unchanged and still correct this pass |
| ORCH-05 | 02-02, 02-03 | Non-Error rejections normalized without crash | SATISFIED | Confirmed unchanged and still correct this pass |

All five ORCH-01..05 IDs appear in REQUIREMENTS.md's Phase 2 row and are claimed by at least one plan's `requirements:` frontmatter. No orphaned requirements. `.planning/REQUIREMENTS.md` still lists ORCH-01..05 as `[ ] Pending`/"Pending" — documentation hygiene item, not re-flagged as a blocker here since it was already noted in the prior verification pass and is independent of CR-03.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `GenericPipelineProvider.ts` | 493-530 | Multi-round tool-calling loop omits the assistant/tool_calls message from history before the next round's `llm.complete()` call | 🛑 BLOCKER (CR-03, new, discovered by 02-REVIEW.md's post-GAP-02-05 re-review, NOT yet fixed by any commit) | Guarantees HTTP 400 rejection from any real OpenAI-compatible backend on round 2+ of any tool-calling conversation; silently invisible to the test suite because the fakes never validate `args.messages` |
| `GenericPipelineProvider.test.ts` | 346-388 | D-04/D-05 fake LLM ignores `args.messages` entirely (round-counted via closure variable) | ⚠️ Warning (root cause of why CR-03 went undetected by automated tests) | Tests are green but provide zero protection against message-history corruption; "tests pass" is not evidence this loop works against a real vendor |
| `GenericPipelineProvider.ts` | 153-154 (WR-01, carried forward) | Tool-result marker regex (`\S+` for name) breaks on whitespace in tool names | ℹ️ Info (carried forward, unaddressed, out of 02-05's scope) | Low-likelihood but silent protocol break if triggered |
| `GenericPipelineProvider.ts` | ~577-578 (WR-02, carried forward) | catch block unconditionally calls `resumeWithCooldown()` even if mic was never paused | ℹ️ Info (carried forward, unaddressed, out of 02-05's scope) | Unnecessary cooldown delay on early-stage errors |
| `GenericPipelineProvider.ts` | 399-412, 556 (WR-03, carried forward) | No `isConnected` guard on `sendMessage()`/turn entry points; orphaned `AudioContext` possible | ℹ️ Info (carried forward, unaddressed, out of scope) | Leaked browser audio resource in an edge case |
| `generic-stt-tts/package.json` | 39-41 (WR-04, carried forward) | Unused `react` peerDependency | ℹ️ Info (carried forward, unaddressed) | Cosmetic/dependency-hygiene only |
| `openai-stt-tts/src/{STTClient,AudioRecorder,TTSPlayer}.ts` | header comments (IN-03, new) | Stale "NOT exported from index.ts" comments now factually wrong after additive exports | ℹ️ Info (new, low-priority documentation hygiene) | Could mislead a future maintainer about breaking-change risk |

No `TBD`/`FIXME`/`XXX` debt markers found in any phase-modified file. CR-03 is not marked with a debt marker in source — it is an undocumented, silent defect, which is more concerning than an acknowledged TODO would be.

The two CR-01/CR-02 BLOCKERs from the earlier review/verification cycle remain CONFIRMED RESOLVED (re-verified this pass by direct source read, not carried forward as open). GAP-02-05 is CONFIRMED RESOLVED (re-verified this pass by direct source read of the fix, plus running the full test suite). CR-03 is a NEW BLOCKER, discovered by the code-review pass that ran immediately after GAP-02-05 was committed, and has NOT been addressed by any subsequent commit (confirmed via `git log` showing no commits on `GenericPipelineProvider.ts` after the GAP-02-05 fix commit `4ea68df`).

## Gaps Summary

**GAP-02-05 is genuinely closed.** I independently verified this by reading the current `GenericPipelineProvider.ts` source directly (not trusting the SUMMARY): a `pipelineToolList: Tool[]` private field exists, is seeded from `config.pipelineTools` in the constructor, is mutated by `registerFunction()` via a filter-then-push that is idempotent-by-name, and is read (not `config.pipelineTools`) at the `llm.complete()` call site in `runTurnFromText`. All 31 tests pass, including 3 new GAP-02-05-specific tests that assert the conversion shape, the dedupe behavior, and the combined constructor-time + post-construction list. The fix matches the plan's five surgical edits exactly.

**CR-03 is a new, genuine, currently-unaddressed BLOCKER that breaks ORCH-01's tool-calling contract for any real vendor backend.** I independently confirmed this defect exists in the current codebase (not just in 02-REVIEW.md's narrative) by reading `GenericPipelineProvider.ts` lines 493-530 line-by-line: the bounded tool-calling loop receives `result.toolCalls` from `llm.complete()`, executes each tool, and pushes only a `role: "user"` tool-result message into `this.messages` — there is no `this.messages.push({role: "assistant", ...})` anywhere in this method. I also read `OpenAILLMAdapter.ts`'s `mapMessage()` function in full (lines 142-153) and confirmed it has exactly two branches (the `[tool_result ...]` marker, and passthrough) — no branch can produce `{role:"assistant", tool_calls:[...]}`, because the orchestrator never gives it an assistant/tool_calls message to recognize. I confirmed the test suite's blind spot is real by reading the D-04/D-05 test block (lines 346-388): the fake LLM's `complete` mock ignores `args.messages` entirely, counting rounds via a closure variable instead — so these tests cannot detect a missing or malformed message in the history, and their "31/31 passing" status is not evidence the multi-round loop is correct against a real backend. I confirmed no fix has landed since this was discovered: `git log` on `GenericPipelineProvider.ts` shows the GAP-02-05 commit (`4ea68df`) as the most recent change, and `git status` shows the file is clean (no uncommitted WIP fix either).

Against a real OpenAI-compatible Chat Completions API, this defect means: any tool-calling conversation that requires more than one round-trip (the LLM calls a tool, gets the result, and then either calls another tool or needs to reference the first tool's result while producing its final answer) will have its second `llm.complete()` request rejected with HTTP 400, because the request is missing the assistant message that the API requires to immediately precede a `role:"tool"` message. This is not a hypothetical edge case — it is the *normal* multi-round tool-calling path that the phase's own plan (02-03) explicitly named as a must-have truth and built dedicated tests for (D-04/D-05), and it is also directly in the critical path of Phase 5's planned end-to-end demo (success criterion #2: "at least one registered tool that the LLM calls and whose result is reflected in the assistant's next reply" — even a single tool call requires exactly the round-2 `complete()` call this defect corrupts).

Because multi-round tool-calling was an explicit, tested must-have of this phase (not an out-of-scope nice-to-have), and because the defect causes a guaranteed real-world failure that is currently masked by tests that don't validate the thing they claim to validate, ORCH-01 is marked FAILED and the phase status is `gaps_found`. ORCH-02 through ORCH-05 remain VERIFIED, all confirmed unaffected and unchanged by either the GAP-02-05 fix or the CR-03 discovery.

**This does not look like an intentional deviation** — it is an unintentional, undiscovered-until-now logic gap in code from plan 02-03, surfaced by a review pass that ran after GAP-02-05's narrower fix. No override is suggested; the recommended path is a new gap-closure plan (CR-03) scoped exactly as described in 02-REVIEW.md's "Fix" section: push an assistant/tool_calls marker message before executing tools each round, teach `OpenAILLMAdapter.mapMessage()` to recognize and re-emit it as `{role:"assistant", tool_calls:[...]}`, and add a regression test that actually inspects the message array sent on round 2 (rather than ignoring `args.messages` as the current fakes do).

---

_Verified: 2026-06-18T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
