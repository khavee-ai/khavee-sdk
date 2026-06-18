---
phase: 02-generic-pipeline-orchestrator
verified: 2026-06-19T04:10:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/5
  gaps_closed:
    - "WR-05: trimHistory() is now marker-pair-aware — confirmed by direct read of GenericPipelineProvider.ts:648-671 (backward-walk while nonSystem[start].content.startsWith(\"[tool_result \")), by the new non-vacuous WR-05 regression test, and by this verifier independently reverting the fix to the original flat slice and confirming the test fails with the exact predicted assertion (`expected 0 to be greater than 0`), then restoring the fix and confirming 36/36 tests pass again."
    - "WR-06: OpenAILLMAdapter.mapMessage() now gates the ASSISTANT_TOOL_CALLS_PATTERN branch on message.role === \"assistant\" (wrapped in try/catch) and the TOOL_RESULT_PATTERN branch on message.role === \"user\" — confirmed by direct read of OpenAILLMAdapter.ts:176-209, by two new non-vacuous regression tests, and by this verifier independently reverting both role gates and confirming both tests fail with the exact predicted SyntaxError, then restoring the fix and confirming both pass."
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
human_verification:
  - test: "WR-07: runTurnFromText's catch block unconditionally calls resumeWithCooldown() even when the VAD was never paused for that turn (e.g. an early llm.complete() rejection before vad.pause() at the TTS step)"
    expected: "A product/scope decision — fix now via a new gap-closure plan (track whether vad.pause() actually ran this turn and only resume/cooldown conditionally, per the fix sketch in 02-REVIEW.md), or accept as backlog. This is a newly-discovered finding from the fresh full-phase 02-REVIEW.md pass (committed b8b91c2) — it was never named in any prior plan's must_haves and was not previously deferred, so per this task's instructions it must not block phase completion, only be surfaced as the next decision point."
    why_human: "Severity/scope-tolerance tradeoff: the bundled OpenAIVADAdapter's resume() is a no-op when already-resumed, so the observable effect today is only an unnecessary cooldown delay on pre-TTS errors, but a third-party VADProvider implementation that asserts pause/resume call-count invariants could behave incorrectly. Whether this crosses a fix-now bar is a judgment call, not a mechanical check."
  - test: "WR-08: connect() wires vad.onUtteranceReady/onSpeechStart and calls vad.connect() before this.micEnabled is set to true, so an utterance completed during the connect handshake is silently dropped with no onError/log"
    expected: "A product/scope decision — fix now (set this.micEnabled = true before awaiting vad.connect(), per 02-REVIEW.md's fix sketch) or accept as backlog. Newly discovered in the same fresh 02-REVIEW.md pass; not previously deferred, must not block phase completion."
    why_human: "This mirrors a structurally identical ordering already present in the existing OpenAISTTTTSProvider (not a new defect class introduced by this phase), so there is established precedent for treating this race as acceptable in the current codebase. Whether the generic orchestrator should hold itself to a stricter bar than the provider it generalizes is a risk-tolerance call for the developer."
---

# Phase 2: Generic Pipeline Orchestrator Verification Report

**Phase Goal:** Build the `{vad, stt, llm, tts, tools}`-composing orchestrator that implements `RealtimeProvider`
**Verified:** 2026-06-19T04:10:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap-closure plan 02-07 closed WR-05 and WR-06 (both Warning-tier defects confirmed real in the prior 02-VERIFICATION.md pass), and a fresh full-phase code-review pass (02-REVIEW.md, committed b8b91c2) which confirmed WR-05/WR-06 fixed and surfaced two NEW Warning-tier findings (WR-07, WR-08).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A developer can construct a working pipeline by passing `{vad, stt, llm, tts, tools}` to a single generic orchestrator class, INCLUDING functioning multi-round tool-calling that remains protocol-valid across history trimming (ORCH-01, D-04/D-05) | VERIFIED | CR-03's marker push (`GenericPipelineProvider.ts:514-527`) confirmed unregressed by direct read. WR-05 fix confirmed by direct read of `trimHistory()` (`GenericPipelineProvider.ts:648-671`): the slice-start boundary backward-walks while `nonSystem[start].content.startsWith("[tool_result ")`, pulling the `[assistant_tool_calls]` head back into the kept window. I independently reverted this fix to the original flat slice and re-ran the WR-05 test — it failed with the exact predicted assertion (`expected 0 to be greater than 0`); restored the fix and the test passed again. |
| 2 | The orchestrator implements `RealtimeProvider` and runs unmodified through `@khaveeai/react`'s existing hook (ORCH-02) | VERIFIED | `class GenericPipelineProvider implements RealtimeProvider` confirmed at `GenericPipelineProvider.ts:75`. `git diff $(git merge-base main HEAD) HEAD -- packages/react/` is empty (re-confirmed this pass, 0 lines). Build exits 0. ORCH-02 integration test (composing all four real adapters) passes. |
| 3 | Triggering new user speech mid-turn cancels in-flight LLM/TTS work via an `AbortSignal`-style hook, AND ordinary user/STT text that happens to collide with the internal marker-prefix convention does not crash a turn (ORCH-03 full barge-in D-03; WR-06 marker-collision hardening) | VERIFIED | CR-01/CR-02 abort guards unchanged and unregressed (`:478, 399-412, 505, 531, 547, 586, 592`). WR-06 fix confirmed by direct read of `mapMessage()` (`OpenAILLMAdapter.ts:176-209`): both marker branches gated on `message.role`, assistant branch's `JSON.parse` wrapped in `try/catch`. I independently reverted both role gates and re-ran the WR-06 tests — both failed with the exact predicted `SyntaxError`; restored the fix and both passed. |
| 4 | The VAD-to-mic-reopen cooldown is set via a constructor/config value (ORCH-04, D-08) | VERIFIED | Unchanged. `this.config = { micReopenCooldownMs: 500, ...config }` (`:139`); `resumeWithCooldown()` reads `this.config.micReopenCooldownMs ?? 500` (`:609`). Untouched by 02-07. |
| 5 | A provider throwing/rejecting with a non-Error value reaches the orchestrator's error callback as a normalized `Error` instance without crashing the active session (ORCH-05) | VERIFIED | Unchanged. `error instanceof Error ? error : new Error(String(error))` normalization confirmed present at 4 await boundaries (`:320, 331, 453, 594`). Untouched by 02-07. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` | `trimHistory()` marker-pair-aware — never strands a `[tool_result ...]` message without its `[assistant_tool_calls]` predecessor across the trim boundary | VERIFIED | Lines 648-671 confirmed by direct read: backward-walk loop present, tagged `(WR-05)`, doc comment updated (lines 624-647). CR-03 push, GAP-02-05 wiring, CR-01/CR-02 guards all confirmed unchanged. |
| `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts` | `mapMessage()` role-gates both marker branches with try/catch fallback on the assistant branch | VERIFIED | Lines 176-209 confirmed by direct read: `if (message.role === "user")` gates the tool-result branch, `if (message.role === "assistant")` gates the assistant branch with `try { ... } catch { ... }` around `JSON.parse`. Doc comment updated (lines 159-175), tagged `(WR-06)`. |
| `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` | Non-vacuous WR-05 regression test using a nonuniform tool-calling cadence | VERIFIED | `describe("WR-05: ...")` block at lines 487-594(approx) confirmed present with the exact nonuniform cadence (3-call first turn, then 1-call turns) and group-aware backward-walk assertion described in the plan. Independently demonstrated to fail against the flat slice and pass against the fix (see Behavioral Spot-Checks). |
| `packages/providers/generic-stt-tts/src/__tests__/OpenAILLMAdapter.test.ts` | Non-vacuous WR-06 regression tests (user-role passthrough + malformed assistant-role passthrough) | VERIFIED | Two tests at lines 230-277 confirmed present and substantive (asserts `body.messages[0]` deep-equals plain passthrough, not parsed). Independently demonstrated to fail against the ungated `mapMessage()` and pass against the fix. |
| All other Phase 2 artifacts (4 adapters, barrel exports, package.json) | Unchanged from prior verification | VERIFIED | `git log --oneline -- packages/providers/generic-stt-tts/src/` shows only `271a7a8` (WR-05/WR-06 fix) and `10b2fd5` (regression tests) added since the prior verification's commit baseline (`e882233`). No other phase artifact touched. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `GenericPipelineProvider.ts` (`trimHistory`) | `this.messages` (array sent to `llm.complete()` on the next turn) | marker-pair-aware backward-walk slice | WIRED | Confirmed by direct read (lines 648-671) and by independent revert/re-run: removing the backward-walk reproduces the exact stranding the WR-05 test catches; restoring it closes the gap. |
| `OpenAILLMAdapter.ts` (`mapMessage`) | OpenAI request body `messages` array | role-gated branches with try/catch fallback | WIRED | Confirmed by direct read (lines 176-209) and by independent revert/re-run: removing the role gates reproduces the exact `SyntaxError` the WR-06 tests catch; restoring them closes the gap. |
| `GenericPipelineProvider.ts` (CR-03 marker push, GAP-02-05 `pipelineToolList`, CR-01/CR-02 abort guards) | unchanged downstream consumers | unchanged code paths | WIRED | Re-confirmed unregressed via direct grep of all four mechanisms — byte-identical to prior verification pass. |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces a backend orchestrator class (no UI rendering of dynamic data). The relevant "data flow" is conversational/tool-call message-history construction across the trim boundary, traced above under Key Link Verification and independently confirmed by reverting and re-running both fixes.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build clean | `pnpm --filter @khaveeai/providers-generic-stt-tts build` | Exit 0 (`tsc`, no output) | PASS |
| Full new-package test suite | `pnpm --filter @khaveeai/providers-generic-stt-tts test --run` | 36/36 pass (4 files: GenericPipelineProvider 15, OpenAILLMAdapter 12, OpenAISTTAdapter 5, OpenAITTSAdapter 4) | PASS |
| Compatibility regression (openai-stt-tts untouched) | `pnpm --filter @khaveeai/providers-openai-stt-tts test --run` | 13/13 pass, unchanged | PASS |
| WR-05 fix is real, not just claimed — independent revert test | Reverted `trimHistory()` to the original flat `nonSystem.slice(-maxNonSystem)`, ran `vitest -t "WR-05"` | FAILED with `AssertionError: expected 0 to be greater than 0` at the `groupStart` assertion — exactly the predicted failure mode | CONFIRMED (genuine fix, not vacuous) |
| WR-05 fix restored — re-run | Restored the backward-walk fix, re-ran full suite | 36/36 pass | PASS |
| WR-06 fix is real, not just claimed — independent revert test | Reverted both role gates in `mapMessage()` to the original ungated branches, ran `vitest -t "WR-06"` | BOTH tests FAILED with `SyntaxError: Unexpected token...is not valid JSON` — exactly the predicted failure mode | CONFIRMED (genuine fix, not vacuous) |
| WR-06 fix restored — re-run | Restored the role-gated fix, re-ran full suite | 36/36 pass | PASS |
| `react` package zero-diff (ORCH-02 "no react changes" claim) | `git diff $(git merge-base main HEAD) HEAD -- packages/react/` | Empty diff (0 lines) | PASS |
| Commit history confirms scope | `git log --oneline -- .../GenericPipelineProvider.ts` | `271a7a8` (fix) + `10b2fd5` (test) are the only commits since the prior verification's `e882233` baseline | PASS |
| No debt markers in phase-modified files | `grep -rn -E "TBD\|FIXME\|XXX"` across the 4 files touched by 02-07 | No matches | PASS |
| Working tree clean after revert experiments | `git status --short` / `git diff` on the two reverted-then-restored files | No diff (byte-identical to committed state) | PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` files and none are referenced in any PLAN/SUMMARY for phase 02. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|--------------|----------------|--------------|--------|----------|
| ORCH-01 | 02-01, 02-02, 02-03, 02-05, 02-06, 02-07 | Construct pipeline from `{vad,stt,llm,tts,tools}`, including working tool-calling (single AND multi-round), robust across history trimming | SATISFIED | Single-round dispatch/visibility correct (GAP-02-05); multi-round message-history construction correct (CR-03); now robust across the trim boundary (WR-05 fix, independently confirmed) |
| ORCH-02 | 02-02, 02-03 | Implements `RealtimeProvider`, no react changes | SATISFIED | `implements RealtimeProvider`; zero diff in `packages/react/`; integration test passes |
| ORCH-03 | 02-01, 02-02, 02-03, 02-04, 02-07 | Barge-in cancels in-flight work via AbortSignal; marker-collision hardened against ordinary user input | SATISFIED | CR-01/CR-02 unchanged and correct; WR-06 fix independently confirmed |
| ORCH-04 | 02-03 | Config-driven cooldown, not hardcoded | SATISFIED | Confirmed unchanged and still correct this pass |
| ORCH-05 | 02-02, 02-03, 02-07 | Non-Error rejections normalized without crash; malformed marker payloads no longer crash a turn | SATISFIED | Error normalization confirmed unchanged; WR-06's try/catch fallback independently confirmed |

All five ORCH-01..05 IDs appear in REQUIREMENTS.md's Phase 2 row and are claimed by at least one plan's `requirements:` frontmatter (02-07 explicitly carries all five). No orphaned requirements. `.planning/REQUIREMENTS.md` still lists ORCH-01..05 as `[ ]` Pending in its checklist and "Pending" in its tracking table — this is a documentation-hygiene item (the requirements tracker checkboxes were never flipped), independent of the code-level evidence above, and was already noted in the prior two verification passes. It does not affect the must-have status of any truth.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `GenericPipelineProvider.ts` | 591-596 (WR-07, new — fresh full-phase 02-REVIEW.md pass) | `runTurnFromText`'s catch block unconditionally calls `resumeWithCooldown()` even when `vad.pause()` was never reached this turn | Warning | Unnecessary cooldown delay on pre-TTS failures (e.g. an `llm.complete()` rejection); could misbehave against a third-party `VADProvider` that asserts pause/resume invariants. Newly discovered this run, not previously deferred — surfaced as a human-decision item per this task's explicit instruction, does not block phase completion. |
| `GenericPipelineProvider.ts` | 291-335 (WR-08, new — fresh full-phase 02-REVIEW.md pass) | `connect()` calls `vad.connect()` before `this.micEnabled = true`, so an utterance completed during the connect handshake is silently dropped | Warning | Mirrors a structurally identical ordering already present in `OpenAISTTTTSProvider` (not a new defect class), but undocumented in the generic `VADProvider` contract. Newly discovered this run, surfaced as a human-decision item, does not block phase completion. |
| `generic-stt-tts/package.json` | 39-41 (WR-04, carried forward) | Unused `react` peerDependency | Info (carried forward, unaddressed, out of scope of 02-07) | Cosmetic/dependency-hygiene only |
| `GenericPipelineProvider.ts` | 153-154 (WR-01, carried forward) | Tool-result marker regex (`\S+` for name) breaks on whitespace in tool names | Info (carried forward, unaddressed, out of scope of 02-07) | Low-likelihood, same defect class WR-06 closed on the sibling marker |
| `GenericPipelineProvider.ts` | 399-412 (WR-03, carried forward) | No `isConnected` guard on `sendMessage()`/turn entry points | Info (carried forward, unaddressed, out of scope of 02-07) | Leaked browser audio resource in an edge case |
| `OpenAILLMAdapter.ts` | 92, 98, 108-113 (IN-06, new info-tier, fresh review) | `temperature` always present in request body shape with no explicit-omit test | Info, not user-reachable today (benign `JSON.stringify` drop of `undefined`) | Out of scope of 02-07; informational only |
| `GenericPipelineProvider.ts` | 197-222 (IN-07, new info-tier, fresh review) | `realtimeToolToTool()` includes `enum`/`description` keys with `undefined` values rather than omitting them | Info, no current consumer is affected | Out of scope of 02-07; informational only |

No `TBD`/`FIXME`/`XXX` debt markers found in any file modified by plan 02-07 (confirmed via direct grep this pass on `GenericPipelineProvider.ts`, `OpenAILLMAdapter.ts`, and both touched test files).

WR-05 and WR-06 are CONFIRMED RESOLVED this pass — re-verified by direct source read (not the SUMMARY's narration) plus an independent revert-and-rerun of both fixes that reproduced the exact predicted failure modes against the unfixed code and confirmed the fixes close them. CR-03, GAP-02-05, CR-01, and CR-02 remain CONFIRMED RESOLVED and unregressed.

### Human Verification Required

#### 1. WR-07: `runTurnFromText`'s catch block unconditionally resumes the VAD even when it was never paused this turn

**Test:** Decide whether to fix now (track whether `vad.pause()` actually ran this turn and only call `resumeWithCooldown()` conditionally, per the fix sketch in `02-REVIEW.md`) via a new gap-closure plan, or accept/backlog this as a known limitation.
**Expected:** A product/scope decision, not a pass/fail a verifier can determine. The mechanism is confirmed real by direct source read of `GenericPipelineProvider.ts:591-596` (the `catch` block unconditionally awaits `resumeWithCooldown()` regardless of whether `vad.pause()` at line 567 was ever reached).
**Why human:** This was discovered by the fresh full-phase `02-REVIEW.md` re-review (committed `b8b91c2`) — it is newly surfaced this run, was never named in any plan's must_haves, and was not previously deferred. Per this verification task's explicit instruction, it must not block phase completion; it is surfaced here as the next decision point.

#### 2. WR-08: `connect()` can silently drop an utterance spoken during the connect handshake

**Test:** Decide whether to fix now (set `this.micEnabled = true` before `await this.vad.connect()`, per the fix sketch in `02-REVIEW.md`) via a new gap-closure plan, or accept/backlog this as a known limitation.
**Expected:** A product/scope decision. The mechanism is confirmed real by direct source read of `GenericPipelineProvider.ts:291-335` (`this.micEnabled` is not set `true` until after `vad.connect()` resolves, so `onUtteranceReady` fires with `micEnabled` still `false` for any utterance completed in that window).
**Why human:** Newly discovered this run, not previously deferred, must not block phase completion per this task's instructions. Note this mirrors a structurally identical ordering already present in `OpenAISTTTTSProvider` (existing precedent in the codebase for this race being acceptable), which is relevant context for the developer's risk-tolerance decision but does not resolve the question mechanically.

## Gaps Summary

No FAILED truths remain. WR-05 and WR-06 — the two actionable gaps carried into this round from the prior `02-VERIFICATION.md` and `02-HUMAN-UAT.md` (both marked `status: failed`, pending gap-closure) — are genuinely closed by plan 02-07. I did not trust the SUMMARY's narration of the fix or the non-vacuity claim; I independently read the current source (`GenericPipelineProvider.ts:648-671` for WR-05, `OpenAILLMAdapter.ts:176-209` for WR-06) and, more importantly, independently reverted each fix back to its pre-02-07 form and re-ran the targeted regression tests — both reproduced the exact predicted failure (`expected 0 to be greater than 0` for WR-05; `SyntaxError: ... is not valid JSON` for WR-06), then I restored the fixes and confirmed both tests pass again and the full suite is 36/36 green. This rules out a self-confirming or vacuous test in either case. `02-HUMAN-UAT.md` has been updated in this verification pass: WR-05 and WR-06 are now marked `status: resolved` with `resolved_by: "02-07-PLAN.md / 02-07-SUMMARY.md"`, mirroring how `GAP-02-05` was previously resolved in the same file — the prior `status: failed` entries were stale (pre-fix) and have been corrected.

ORCH-01 through ORCH-05 were all re-confirmed unregressed by direct source read at their respective line numbers; the CR-03 marker push, GAP-02-05's `pipelineToolList` wiring, and the CR-01/CR-02 abort guards are byte-identical to the prior verification pass (confirmed via `git log` showing only the two expected 02-07 commits added since the prior baseline). The `openai-stt-tts` compatibility suite remains 13/13, and `packages/react` has a zero diff against `main`, confirming ORCH-02's "no react changes" claim still holds.

The fresh full-phase code-review pass (`02-REVIEW.md`, committed `b8b91c2`, scoped to the entire current state of Phase 2 — not just the WR-05/WR-06 delta) surfaced two NEW Warning-tier findings (WR-07, WR-08) and two new Info-tier notes (IN-06, IN-07), none of which existed in any prior review or verification pass and none of which were named in any plan's must_haves (they could not have been — they were discovered by review only after 02-07 was committed). Per this verification task's explicit instruction, these newly-discovered findings do NOT block this phase from being marked complete. They are surfaced here as `human_needed` items — the next decision point for the developer — rather than silently absorbed or deferred without an explicit record.

Because no truth FAILED, all prior gaps (WR-05, WR-06) are genuinely closed and independently re-verified, but two newly-discovered (not previously-deferred) human-decision items exist (WR-07, WR-08), phase status is `human_needed`, not `passed`. Per the gates taxonomy, this is the correct escalation-gate routing: all automated checks pass, all must-have truths are verified, and the open questions are judgment calls (severity/scope-tolerance tradeoffs for newly-emergent, review-discovered risk) that a grep or test cannot resolve — the developer should make an explicit, recorded decision on WR-07/WR-08 (fix now or backlog), but this decision is not a blocker for considering Phase 2's goal achieved.

---

_Verified: 2026-06-19T04:10:00Z_
_Verifier: Claude (gsd-verifier)_
