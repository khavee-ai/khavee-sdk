---
phase: 02-generic-pipeline-orchestrator
verified: 2026-06-18T23:15:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "CR-03 (multi-round tool-calling message-history protocol violation): GenericPipelineProvider.runTurnFromText now pushes a { role: \"assistant\", content: \"[assistant_tool_calls] <json>\" } marker into this.messages immediately after a round's toolCalls.length > 0 check and BEFORE executing any tool — confirmed by direct read of GenericPipelineProvider.ts:514-527 (push sits between the MAX_TOOL_ROUNDS guard and the per-call tool-execution for-loop, exactly where it must). OpenAILLMAdapter.mapMessage() gained a third branch (ASSISTANT_TOOL_CALLS_PATTERN, lines 41, 172-186) that re-emits the marker as OpenAI's { role: \"assistant\", content: null, tool_calls: [...] } wire shape with arguments correctly re-JSON.stringify'd. Two new regression tests (CR-03 describe block in GenericPipelineProvider.test.ts:435-482; adapter wire-shape test in OpenAILLMAdapter.test.ts:185-222) genuinely exercise the round-trip — confirmed substantive by reading both, not vacuous assertions. Independently reproduced the OpenAI wire-shape mapping in an isolated Node script outside the test suite to rule out a self-confirming test. 33/33 tests pass; build clean; openai-stt-tts compatibility suite still 13/13; packages/react diff still empty."
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
human_verification:
  - test: "WR-05: trimHistory()'s flat tail-slice can strand a [tool_result ...] message without its preceding [assistant_tool_calls] marker once accumulated non-system history exceeds 20 messages across multiple tool-calling turns in one session"
    expected: "Decide whether to fix now (make trimHistory marker-pair-aware, or trim by whole tool-calling-round units) or accept/backlog as a known limitation for long-running sessions with heavy tool use. No test currently exercises this path (confirmed: no trimHistory-related assertions exist in GenericPipelineProvider.test.ts)."
    why_human: "Not part of 02-06's must_haves (CR-03 was scoped to a single turn's round-to-round message ordering, not cross-turn history trimming); requires a product decision on whether long-session tool-calling robustness is in scope for Phase 2 or deferred to a later hardening pass. Likelihood/impact tradeoff (rare to hit 20+ messages in typical voice-turn sessions, but a real HTTP 400 reintroduction of CR-03's exact failure mode when it does happen) is a judgment call, not something a grep/test can resolve."
  - test: "WR-06: OpenAILLMAdapter.mapMessage()'s new ASSISTANT_TOOL_CALLS_PATTERN branch has no message.role === \"assistant\" gate, so a role:\"user\" message whose content literally starts with \"[assistant_tool_calls]\" (e.g. ordinary user/STT text) is misrouted into JSON.parse and throws synchronously, aborting the turn with a confusing JSON-syntax error"
    expected: "Decide whether to fix now (add the role==\"assistant\" gate + try/catch fallback, mirroring the suggested fix in 02-REVIEW.md) or accept the residual risk. I independently reproduced this crash in an isolated Node script outside the test suite: mapMessage({role:\"user\", content:\"[assistant_tool_calls] please call the weather tool for me\"}) throws SyntaxError: Unexpected token 'p', \"please cal\"... is not valid JSON — confirming this is a real, currently-reachable defect, not a hypothetical."
    why_human: "Not part of 02-06's must_haves; this is a newly-introduced collision-surface risk from the CR-03 fix itself, analogous to the already-accepted/carried-forward WR-01 (same defect class on the pre-existing [tool_result ...] marker, deferred across 4 prior verification rounds as Info-tier). Whether this crosses from Info to a must-fix-now bar is a product/risk-tolerance decision, not a mechanical check."
---

# Phase 2: Generic Pipeline Orchestrator Verification Report

**Phase Goal:** A developer can assemble a complete voice pipeline from any combination of the Phase 1 interfaces using one orchestrator class, with no changes required in `@khaveeai/react`
**Verified:** 2026-06-18T23:15:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap-closure plan 02-06 (CR-03 fix), and a fresh code-review pass (02-REVIEW.md, committed this run) scoped to the 4 files touched by 02-06, which confirmed CR-03 correctly fixed but surfaced two NEW Warning-tier findings (WR-05, WR-06).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A developer can construct a working pipeline by passing `{vad, stt, llm, tts, tools}` to a single generic orchestrator class, INCLUDING functioning multi-round tool-calling (ORCH-01, D-04/D-05) | VERIFIED | CR-03 fix confirmed by direct read of `GenericPipelineProvider.ts:514-527` — the `[assistant_tool_calls] <json>` marker push sits between the `MAX_TOOL_ROUNDS` guard and the per-call tool-execution loop, exactly as required. `OpenAILLMAdapter.ts:41,172-186` adds the third `mapMessage()` branch re-emitting OpenAI's `{role:"assistant", content:null, tool_calls:[...]}` wire shape. Two substantive regression tests (not vacuous) genuinely exercise the round-2 message ordering and the wire-shape mapping; I independently reproduced the wire-shape mapping logic in an isolated Node script outside the project's test runner to rule out a self-confirming test, and it matched the expected OpenAI shape exactly. Single-round tool dispatch/visibility (GAP-02-05) remains correct and unregressed. |
| 2 | The orchestrator implements `RealtimeProvider` and runs unmodified through `@khaveeai/react`'s existing hook (ORCH-02) | VERIFIED | `class GenericPipelineProvider implements RealtimeProvider` confirmed at `GenericPipelineProvider.ts:75`. `git diff $(git merge-base main HEAD) HEAD -- packages/react/` is empty (re-confirmed this pass). Build exits 0. ORCH-02 integration test (composing all four real adapters) passes. |
| 3 | Triggering new user speech mid-turn cancels in-flight LLM/TTS work via an `AbortSignal`-style hook (ORCH-03, full barge-in D-03) | VERIFIED | Unchanged and unregressed: CR-01 guard at `runTurnFromText`'s first statement (`:478`, `if (signal?.aborted) return;`), CR-02 fix in `sendMessage()` (`:399-412`, abort-prior/register-fresh/finally-clear). Confirmed present in current source, not touched by 02-06. |
| 4 | The VAD-to-mic-reopen cooldown is set via a constructor/config value (ORCH-04, D-08) | VERIFIED | Unchanged. `this.config = { micReopenCooldownMs: 500, ...config }` (`:139`); `resumeWithCooldown()` reads `this.config.micReopenCooldownMs ?? 500` (`:609`). Untouched by 02-06. |
| 5 | A provider throwing/rejecting with a non-Error value reaches the orchestrator's error callback as a normalized `Error` instance without crashing the active session (ORCH-05) | VERIFIED | Unchanged. `error instanceof Error ? error : new Error(String(error))` normalization confirmed present at 4 await boundaries (`:320, 331, 453, 594`). Untouched by 02-06. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` | Composable orchestrator implementing `RealtimeProvider`; multi-round tool-calling loop that produces a wire-protocol-valid message sequence | VERIFIED | `implements RealtimeProvider` confirmed (`:75`). CR-03 marker push confirmed correctly placed (`:514-527`), tagged `(CR-03)`, preserving the existing `[tool_result ...]` push and abort guards unchanged. |
| `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts` | `implements LLMProvider`, maps history messages to OpenAI wire shape including assistant/tool_calls entries | VERIFIED | `ASSISTANT_TOOL_CALLS_PATTERN` (line 41) and the third `mapMessage()` branch (lines 172-186) confirmed present and correct by direct read; existing `[tool_result ...]` branch and passthrough unchanged. |
| `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` | Multi-round tool-calling loop tests that validate real backend-compatible message-history shape | VERIFIED | `CR-03` describe block (lines 435-482) captures a shallow copy of `args.messages` per `complete()` call (correctly avoiding the live-reference pitfall) and asserts the round-2 array contains the assistant marker immediately before the matching tool-result entry. This is the opposite of the prior blind-spot fake (which ignored `args.messages`). 14 tests in this file, all passing. |
| `packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts` | Adapter unit test asserting the marker maps to OpenAI wire shape | VERIFIED | Test at lines 185-222 asserts `body.messages` deep-equals the expected sequence with `arguments` as a JSON string (not an object) — confirmed correct by direct read. 10 tests in this file, all passing. |
| All other Phase 2 artifacts (4 adapters, barrel exports, package.json) | Unchanged from prior verification | VERIFIED | Re-confirmed via `git log` — only `e882233` (CR-03 fix) added since the GAP-02-05 commit (`4ea68df`); no other phase artifact touched. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `GenericPipelineProvider.ts` (tool-calling loop, round N) | `GenericPipelineProvider.ts` (tool-calling loop, round N+1) | shared `this.messages` array carrying the assistant/tool_calls predecessor + matching tool-result | WIRED | Confirmed by direct read of lines 514-544: the assistant marker is pushed before the per-call for-loop; round N+1's `llm.complete({messages: this.messages})` call (line 497) reads the now-complete array. Test confirms round 2's captured array contains the marker at index `aIdx` immediately followed by the matching tool-result at `aIdx+1`. |
| `OpenAILLMAdapter.ts` (`mapMessage`) | OpenAI wire shape `{role:"assistant", content:null, tool_calls:[...]}` | `ASSISTANT_TOOL_CALLS_PATTERN` match → re-emit | WIRED | Confirmed by direct read (lines 172-186) and independently reproduced in an isolated Node script outside the test suite — the regex/JSON.parse/remap logic produces the exact expected OpenAI shape. |
| `GenericPipelineProvider.ts` (`registerFunction`) | `this.pipelineToolList` (LLM-visibility list, GAP-02-05) | filter-then-push, idempotent-by-name | WIRED | Re-confirmed unregressed: lines 89, 146-151, 180-222, 497-502 unchanged from the GAP-02-05 fix; not touched by 02-06. |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces a backend orchestrator class (no UI rendering of dynamic data). The relevant "data flow" is conversational/tool-call message-history construction, traced above under Key Link Verification, and now confirmed correct for the single-turn multi-round case.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build clean | `pnpm --filter @khaveeai/providers-generic-stt-tts build` | Exit 0 (`tsc`, no output) | PASS |
| Full new-package test suite | `pnpm --filter @khaveeai/providers-generic-stt-tts test --run` | 33/33 pass (4 files: GenericPipelineProvider 14, OpenAILLMAdapter 10, OpenAISTTAdapter 5, OpenAITTSAdapter 4) | PASS |
| Compatibility regression (openai-stt-tts untouched) | `pnpm --filter @khaveeai/providers-openai-stt-tts test --run` | 13/13 pass, unchanged | PASS |
| CR-03 fix is real (not just claimed) | Read `GenericPipelineProvider.ts:514-527` and `OpenAILLMAdapter.ts:41,172-186` directly | Marker push correctly positioned before tool execution; third mapMessage branch correctly re-emits OpenAI wire shape | PASS |
| CR-03 wire-shape mapping independently reproduced outside the test suite | Standalone Node script implementing `mapMessage`'s regex/parse/remap logic, run against the test's exact input | Produces the exact expected `{role:"assistant", content:null, tool_calls:[...]}` shape — not a self-confirming test artifact | PASS |
| WR-06 defect independently reproduced outside the test suite | Standalone Node script: `mapMessage({role:"user", content:"[assistant_tool_calls] please call the weather tool for me"})` | Throws `SyntaxError: Unexpected token 'p', "please cal"... is not valid JSON` — confirms WR-06 is real and reachable, not hypothetical | CONFIRMED (defect present, see human_verification) |
| WR-05 defect mechanism confirmed in source | Read `trimHistory()` at `GenericPipelineProvider.ts:634-642` | Flat `nonSystem.slice(-maxNonSystem)` with zero marker-pair awareness, confirming the mechanism WR-05 describes is real (though requires 20+ accumulated messages to trigger) | CONFIRMED (defect present, see human_verification) |
| `react` package zero-diff (ORCH-02 "no react changes" claim) | `git diff $(git merge-base main HEAD) HEAD -- packages/react/` | Empty diff | PASS |
| Commit history confirms scope | `git log --oneline -- .../GenericPipelineProvider.ts` | `e882233` (CR-03 fix) is the only commit since `4ea68df` (GAP-02-05) | PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` files and none are referenced in any PLAN/SUMMARY for phase 02. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|--------------|----------------|--------------|--------|----------|
| ORCH-01 | 02-01, 02-02, 02-03, 02-05, 02-06 | Construct pipeline from `{vad,stt,llm,tts,tools}`, including working tool-calling (single AND multi-round) | SATISFIED | Single-round dispatch/visibility correct (GAP-02-05); multi-round message-history construction now correct (CR-03 fix confirmed) |
| ORCH-02 | 02-02, 02-03 | Implements `RealtimeProvider`, no react changes | SATISFIED | `implements RealtimeProvider`; zero diff in `packages/react/`; integration test with real adapters passes |
| ORCH-03 | 02-01, 02-02, 02-03, 02-04 | Barge-in cancels in-flight work via AbortSignal | SATISFIED | Confirmed unchanged and still correct this pass |
| ORCH-04 | 02-03 | Config-driven cooldown, not hardcoded | SATISFIED | Confirmed unchanged and still correct this pass |
| ORCH-05 | 02-02, 02-03 | Non-Error rejections normalized without crash | SATISFIED | Confirmed unchanged and still correct this pass |

All five ORCH-01..05 IDs appear in REQUIREMENTS.md's Phase 2 row and are claimed by at least one plan's `requirements:` frontmatter. No orphaned requirements. `.planning/REQUIREMENTS.md` still lists ORCH-01..05 as `[ ] Pending`/"Pending" — this is a documentation-hygiene item (the requirements tracker checkboxes were never flipped), independent of the code-level evidence above, and was already noted in the prior verification pass.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `OpenAILLMAdapter.ts` | 172-186 | `ASSISTANT_TOOL_CALLS_PATTERN` branch in `mapMessage()` has no `message.role === "assistant"` gate before testing the regex/JSON.parse — a `role:"user"` message whose content literally starts with `[assistant_tool_calls]` (ordinary user text or an STT transcript artifact) is misrouted and crashes via uncaught `JSON.parse` (WR-06, new, introduced by the CR-03 fix) | Warning | Independently reproduced: aborts the turn with a confusing JSON-syntax error rather than a clear failure message; same defect class as the already-accepted WR-01 (carried forward 4+ verification rounds as Info-tier) but on the new marker and demonstrated concretely reachable by ordinary input |
| `GenericPipelineProvider.ts` | 634-642 (interacting with 514-527) | `trimHistory()`'s flat `nonSystem.slice(-maxNonSystem)` has no awareness of the new `[assistant_tool_calls]`/`[tool_result ...]` marker pairing — once cumulative history exceeds 20 non-system messages across multiple tool-calling turns, the tail-slice can strand a `[tool_result ...]` message without its preceding marker, reintroducing CR-03's exact protocol violation (WR-05, new) | Warning | No test coverage of this path (confirmed: no trimHistory+marker interaction test exists); requires sustained multi-turn tool-calling in one session to trigger, narrower than WR-06 but same HTTP-400 failure mode |
| `GenericPipelineProvider.test.ts` | — | No regression test exercises `trimHistory()` together with the new tool-calling markers (IN-04, new) | Info | Means WR-05 has no test confirming or denying the failure mode either way |
| `GenericPipelineProvider.ts` | 153-154 (WR-01, carried forward) | Tool-result marker regex (`\S+` for name) breaks on whitespace in tool names | Info (carried forward across 4+ rounds, unaddressed, out of scope) | Low-likelihood but silent protocol break if triggered — same defect class WR-06 newly demonstrates is concretely reachable on the sibling marker |
| `GenericPipelineProvider.ts` | ~592-593 (WR-02, carried forward) | catch block unconditionally calls `resumeWithCooldown()` even if mic was never paused | Info (carried forward, unaddressed, out of scope) | Unnecessary cooldown delay on early-stage errors |
| `GenericPipelineProvider.ts` | 399-412, ~571 (WR-03, carried forward) | No `isConnected` guard on `sendMessage()`/turn entry points; orphaned `AudioContext` possible | Info (carried forward, unaddressed, out of scope) | Leaked browser audio resource in an edge case |
| `generic-stt-tts/package.json` | 39-41 (WR-04, carried forward) | Unused `react` peerDependency | Info (carried forward, unaddressed) | Cosmetic/dependency-hygiene only |

No `TBD`/`FIXME`/`XXX` debt markers found in any phase-modified file (confirmed via direct grep this pass).

CR-03 is CONFIRMED RESOLVED — re-verified this pass by direct source read (not the SUMMARY's narration) plus an independent out-of-suite reproduction of the wire-shape mapping logic. GAP-02-05, CR-01, and CR-02 remain CONFIRMED RESOLVED and unregressed.

### Human Verification Required

#### 1. WR-05: trimHistory() can strand a tool-result marker without its assistant predecessor across long tool-calling sessions

**Test:** Decide whether `trimHistory()` needs to become marker-pair-aware (or trim by whole tool-calling-round units) before this phase is considered fully closed, or whether this is acceptable residual risk to backlog for a later hardening pass.
**Expected:** A product/scope decision — not a pass/fail the verifier can determine. The mechanism is confirmed real (flat tail-slice, zero marker awareness, confirmed by direct source read of `GenericPipelineProvider.ts:634-642`), but it only manifests once a single session's tool-calling history exceeds 20 non-system messages (e.g. many tool-calling turns or several multi-round turns in one continuous session) — a narrower trigger condition than WR-06.
**Why human:** This was discovered by code review after 02-06 was committed and was never named in any plan's must_haves; it's an emergent interaction between two pieces of correctly-functioning code (CR-03's new marker + the pre-existing trimHistory), not an incomplete implementation of a stated requirement. Whether long-session tool-calling robustness is in Phase 2's scope or a later phase's concern is a judgment call.

#### 2. WR-06: OpenAILLMAdapter.mapMessage() crashes on ordinary user input that happens to start with the literal marker text

**Test:** Decide whether to add the `message.role === "assistant"` gate (+ try/catch fallback) to `mapMessage()`'s new branch now, or accept the residual risk and backlog it, consistent with how the analogous WR-01 finding on the original `[tool_result ...]` marker has been treated across 4+ prior verification rounds.
**Expected:** A product/scope decision. I independently reproduced this crash outside the test suite: `mapMessage({role:"user", content:"[assistant_tool_calls] please call the weather tool for me"})` throws `SyntaxError: Unexpected token 'p', "please cal"... is not valid JSON` — confirming this is a real, currently-reachable defect (triggerable by ordinary user typing or an STT transcript artifact), not a hypothetical edge case.
**Why human:** Not part of 02-06's must_haves; it's a newly-introduced collision-surface risk from the CR-03 fix itself. The codebase has an established precedent (WR-01) of treating this exact defect class as acceptable Info-tier residual risk on the sibling marker across multiple verification cycles — whether WR-06 should be held to a different, stricter bar because review explicitly demonstrated it as user-reachable (rather than only LLM-hallucination-reachable, as WR-01 is) is a risk-tolerance call for the developer, not a mechanical pass/fail.

## Gaps Summary

No FAILED truths remain. CR-03 — the single actionable gap carried into this round from the prior `02-VERIFICATION.md` — is genuinely closed. I independently verified this by reading the current `GenericPipelineProvider.ts` and `OpenAILLMAdapter.ts` source directly (not trusting the SUMMARY or the 02-REVIEW.md narrative): the assistant/tool_calls marker push is correctly positioned in the tool-calling loop, the adapter's third `mapMessage()` branch correctly re-emits OpenAI's wire shape, and I additionally reproduced the wire-shape mapping logic in an isolated script outside the project's test runner to rule out a self-confirming test. All 33 tests pass (31 prior + 2 new CR-03 regression tests, both substantive — not vacuous assertions). The `openai-stt-tts` compatibility suite remains 13/13, and `packages/react` has a zero diff, confirming ORCH-02's "no react changes" claim still holds. ORCH-02 through ORCH-05 were re-confirmed unregressed by direct source read at their respective line numbers.

The fresh code-review pass (02-REVIEW.md, committed this run, scoped to exactly the 4 files touched by 02-06) surfaced two NEW Warning-tier findings (WR-05, WR-06) and one Info-tier note (IN-04), all emergent from the CR-03 fix itself rather than incomplete CR-03 work. I independently reproduced both WR-05's mechanism (via direct source read of `trimHistory()`) and WR-06's crash (via an isolated out-of-suite Node script) to confirm they are real, not narrative artifacts. Neither was named in 02-06's must_haves or acceptance criteria — they could not have been, since they were discovered by review only after 02-06 was committed. Per the established precedent already set within this exact phase (the analogous WR-01 finding on the sibling `[tool_result ...]` marker has been carried forward as accepted Info-tier residual risk across 4+ prior verification rounds without blocking phase completion), I am not treating WR-05/WR-06 as phase-blocking BLOCKERs. However, WR-06 in particular is concretely reachable by ordinary user input (not just an LLM hallucination, which is WR-01's narrower trigger), so I am surfacing both as `human_needed` items rather than silently downgrading them to carried-forward Info notes — the developer should make an explicit, recorded decision on whether to fix now or accept the residual risk, rather than have that decision made implicitly by a verifier choosing not to flag it.

Because no truth FAILED but two genuine human-decision items exist, phase status is `human_needed`, not `passed`. Per the gates taxonomy, this is the correct escalation-gate routing: automated checks all pass; the open questions are genuinely judgment calls (severity/scope-tolerance tradeoffs for emergent, review-discovered risk) that a grep or test cannot resolve.

---

_Verified: 2026-06-18T23:15:00Z_
_Verifier: Claude (gsd-verifier)_
