---
phase: 02-generic-pipeline-orchestrator
verified: 2026-06-18T10:00:36Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Triggering new user speech mid-turn cancels in-flight LLM/TTS work via an AbortSignal-style hook, observable as the in-progress response stopping rather than completing (ORCH-03 / SC3, full barge-in D-03)"
    status: partial
    reason: >
      The narrow happy-path case (VAD utterance fires while llm.complete() is
      in flight) is genuinely demonstrated by the existing test
      (GenericPipelineProvider.test.ts, "ORCH-03: mid-turn utterance aborts
      the active turn") and is real: the AbortSignal IS forwarded into
      OpenAILLMAdapter's fetch() options and OpenAITTSAdapter's cancel()
      bridge, so in-flight network/playback work is genuinely interrupted.
      However, the phase's own code review (02-REVIEW.md CR-01, CR-02) found
      two concurrency defects in the barge-in mechanism that are NOT covered
      by any test and which I independently reproduced against the current
      code:
        (1) CR-01: runTurnFromText() mutates this.messages/this.conversation
            (pushing the user's utterance) with ZERO abort-signal check
            before that first side effect, and the caller runTurn() also
            does not check controller.signal.aborted between STT resolving
            and calling runTurnFromText(). Reproduced: a superseded Turn A
            whose STT call resolves after Turn B has already aborted it
            still lands "turn A stale utterance" in conversation, positioned
            AFTER Turn B's legitimate entry — corrupting LLM-visible history
            with an out-of-order/duplicate turn.
        (2) CR-02: sendMessage() never creates/registers its own
            AbortController — `await this.runTurnFromText(text,
            this.activeTurnController?.signal)`. When no turn is active
            (the common case), this passes signal=undefined and never sets
            activeTurnController, so a concurrent VAD-driven utterance does
            NOT abort it and instead runs fully independently. Reproduced:
            calling sendMessage() and firing a VAD utterance shortly after
            produces TWO uncoordinated llm.complete() calls and duplicate/
            corrupted conversation entries (4 entries from what should be a
            single coherant single-active-turn session).
      These are not edge cases outside the documented design surface — D-03
      ("full interruption barge-in") and the single-active-turn invariant
      are the explicit subject of ORCH-03/SC3, and sendMessage() is a
      first-class RealtimeProvider method exercised by @khaveeai/react's
      useRealtime hook. The existing test suite only exercises the
      VAD-vs-VAD happy path and does not assert on conversation/message
      integrity after a barge-in, so it passes (26/26 green) without
      catching either defect.
    artifacts:
      - path: "packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts"
        issue: "runTurnFromText (lines 391-404) has no signal.aborted guard before its first side effect (pushing to this.messages/this.conversation); runTurn (line 368) does not check controller.signal.aborted between STT resolving and calling runTurnFromText; sendMessage (lines 333-335) does not create/register its own AbortController, so it races with a concurrently-arriving VAD turn instead of superseding/being superseded by it."
    missing:
      - "Add `if (signal?.aborted) return;` as the very first statement inside runTurnFromText, before any messages/conversation mutation (per code review CR-01's documented fix)."
      - "Add the same abort guard in runTurn() immediately after stt.transcribe() resolves and before the non-empty-text call to runTurnFromText (CR-01)."
      - "Give sendMessage() the same turn-ownership semantics as runTurn(): abort any existing activeTurnController, create and register a fresh one, and clear it in a finally block (per code review CR-02's documented fix)."
      - "Add regression tests exercising: (a) a superseded turn's stale STT result does NOT appear in conversation after barge-in, (b) sendMessage() racing with a concurrent VAD-driven turn does not produce duplicate/concurrent llm.complete() calls."
human_verification: []
---

# Phase 2: Generic Pipeline Orchestrator Verification Report

**Phase Goal:** A developer can assemble a complete voice pipeline from any combination of the Phase 1 interfaces using one orchestrator class, with no changes required in `@khaveeai/react`
**Verified:** 2026-06-18T10:00:36Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A developer can construct a working pipeline by passing `{vad, stt, llm, tts, tools}` to a single generic orchestrator class (ORCH-01) | VERIFIED | `GenericPipelineProvider` constructor accepts `GenericPipelineConfig extends RealtimeConfig` with `vad/stt/llm/tts/pipelineTools` fields (`GenericPipelineProvider.ts:48-61`, `131-146`). Note: field is `pipelineTools` not `tools` due to a documented, tsc-confirmed structural-incompatibility fallback (see Anti-Patterns below) — functionally equivalent but a naming deviation from the literal SC1 wording. |
| 2 | The orchestrator implements `RealtimeProvider` and runs unmodified through `@khaveeai/react`'s existing hook, verified with adapted OpenAI helper classes as stand-ins (ORCH-02) | VERIFIED | `class GenericPipelineProvider implements RealtimeProvider` (`GenericPipelineProvider.ts:75`); `pnpm --filter @khaveeai/providers-generic-stt-tts build` exits 0 (tsc satisfied). Integration test (`GenericPipelineProvider.test.ts:326-393`) composes all four real `OpenAI*Adapter` classes, asserts `RealtimeProvider` assignability, drives a turn, and asserts an assistant `conversation` entry lands. `git diff` against merge-base shows zero commits touching `packages/react/` in this phase's branch. |
| 3 | Triggering new user speech mid-turn cancels in-flight LLM/TTS work via an `AbortSignal`-style hook, observable as the in-progress response stopping rather than completing (ORCH-03, full barge-in D-03) | FAILED | The narrow VAD-vs-VAD happy path is genuinely demonstrated and the signal IS forwarded into real fetch()/cancel() calls (verified by reading `OpenAILLMAdapter.ts`/`OpenAITTSAdapter.ts`). However, code review findings CR-01 and CR-02 — independently reproduced by this verifier against the current code — show the barge-in mechanism corrupts shared conversation/message history on a superseded STT-in-flight turn (CR-01), and that `sendMessage()` races uncoordinated with a concurrent VAD turn instead of superseding/being superseded (CR-02), violating the single-active-turn invariant the rest of the design depends on. See Gaps Summary. |
| 4 | The VAD-to-mic-reopen cooldown is set via a constructor/config value, and changing it changes observed mic-reopen timing (ORCH-04, D-08) | VERIFIED | `this.config = { micReopenCooldownMs: 500, ...config }` (line 132); `resumeWithCooldown()` reads `this.config.micReopenCooldownMs ?? 500` (line 505) — no hardcoded constant independent of config. Test `"uses the configured cooldown duration instead of the 500ms default"` (micReopenCooldownMs: 1234) passes under `vi.useFakeTimers()`, proving the override changes observed timing. |
| 5 | A provider throwing or rejecting with a non-Error value reaches the orchestrator's error callback as a normalized `Error` instance without crashing the active session (ORCH-05) | VERIFIED | Test `"routes a thrown string to onError as an Error instance and returns chatStatus to ready"` passes: fake `llm.complete` rejects with the bare string `"boom"`; `onError` receives an `Error` instance with `.message` containing `"boom"`; `provider.chatStatus === "ready"` afterward (session alive). `error instanceof Error ? error : new Error(String(error))` normalization is applied at all await boundaries in `GenericPipelineProvider.ts`. |

**Score:** 4/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/types/pipeline.ts` | `signal?: AbortSignal` added to `LLMProvider.complete` and `TTSProvider.speak` | VERIFIED | `grep -c "signal?: AbortSignal"` returns 2 (lines 177, 209) |
| `packages/providers/openai-stt-tts/src/index.ts` | Additive exports of 4 helper classes | VERIFIED | `AudioRecorder`, `STTClient`, `ChatClient` (+types), `TTSPlayer` all exported; original `OpenAISTTTTSProvider` export preserved |
| `packages/providers/generic-stt-tts/package.json` | New workspace package depending on core + openai-stt-tts | VERIFIED | `name: "@khaveeai/providers-generic-stt-tts"`; deps include `@khaveeai/core` and `@khaveeai/providers-openai-stt-tts` via `workspace:*` |
| `packages/providers/generic-stt-tts/src/adapters/OpenAIVADAdapter.ts` | `implements VADProvider`, wraps `AudioRecorder` | VERIFIED | `implements VADProvider` present; imports `AudioRecorder` from `@khaveeai/providers-openai-stt-tts` (package-name import, no relative) |
| `packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts` | `implements STTProvider`, wraps `STTClient` | VERIFIED | `implements STTProvider` present; tests pass (5 tests) |
| `packages/providers/generic-stt-tts/src/adapters/OpenAILLMAdapter.ts` | `implements LLMProvider`, sends tools+signal, parses tool_calls | VERIFIED | `implements LLMProvider` present; own `fetch()` (bypasses ChatClient per plan); tests pass (9 tests) including signal-forwarding and tool_calls parsing assertions |
| `packages/providers/generic-stt-tts/src/adapters/OpenAITTSAdapter.ts` | `implements TTSProvider`, signal→cancel bridge | VERIFIED | `implements TTSProvider` present; `addEventListener("abort", ...)` bridges to `TTSPlayer.cancel()`; tests pass (4 tests) |
| `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts` | Composable orchestrator implementing `RealtimeProvider`, min 250 lines | VERIFIED | 539 lines; `implements RealtimeProvider` confirmed; builds clean |
| `packages/providers/generic-stt-tts/src/index.ts` | Barrel exporting provider, config type, four adapters | VERIFIED | All names present: `GenericPipelineProvider`, `GenericPipelineConfig`, all four `OpenAI*Adapter` + their config types |
| `packages/providers/generic-stt-tts/src/__tests__/GenericPipelineProvider.test.ts` | Conformance + barge-in + cooldown + error-normalization + tool-loop + adapter-integration tests | ⚠️ PARTIAL | All 8 listed test scenarios exist and pass, BUT the barge-in describe block only covers the VAD-vs-VAD happy path — it does not assert on conversation/message integrity post-barge-in (CR-01) nor on `sendMessage()` vs concurrent VAD turn (CR-02), the two scenarios code review flagged as broken. Tests pass but do not fully prove the "full barge-in" claim. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `generic-stt-tts/package.json` | `@khaveeai/providers-openai-stt-tts` | `workspace:*` dependency | WIRED | Confirmed in package.json; `pnpm install` links without errors |
| `OpenAILLMAdapter.ts` | `chatProxyEndpoint` | own `fetch()` with tools+signal | WIRED | `signal` present in fetch options (line ~105); tools mapped to OpenAI function-calling shape when present |
| `OpenAITTSAdapter.ts` | `TTSPlayer.cancel` | `signal.addEventListener('abort', ...)` | WIRED | Confirmed at adapter line ~79; pre-aborted signal short-circuits before `speak()` is called (tested) |
| `GenericPipelineProvider.ts` | `ToolExecutor` | tool-calling loop dispatch | WIRED | `this.toolExecutor.execute(call.name, call.args)` inside bounded loop (line 426); `MAX_TOOL_ROUNDS = 5` enforced and tested |
| `GenericPipelineProvider.ts` | `activeTurnController.abort()` | barge-in on new utterance | ⚠️ PARTIAL | Wired for the VAD-vs-VAD case (tested), but NOT correctly wired for `sendMessage()` vs concurrent VAD turn (CR-02 — `sendMessage()` never creates/registers a controller of its own), and the abort does not prevent the superseded turn's STT result from mutating shared state before a guard fires (CR-01) |

### Behavioral Spot-Checks (independent reproduction beyond the existing test suite)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-01: superseded turn's stale STT result lands in conversation | Custom repro test: slow Turn A STT resolves after Turn B already aborted it, drives both turns, inspects `conversation` | "turn A stale utterance" appears in conversation AFTER Turn B's legitimate entry — confirmed corruption | ✗ FAIL (confirms code review finding) |
| CR-02: `sendMessage()` races with concurrent VAD turn instead of superseding | Custom repro test: call `sendMessage()` then fire a VAD utterance 5ms later, inspect `llm.complete` call count and conversation | `llm.complete` called twice independently (no coordination); conversation grew to 4 entries with duplicate "reply-2" text appearing twice | ✗ FAIL (confirms code review finding) |
| `pnpm --filter @khaveeai/providers-generic-stt-tts build` | tsc build | Exit 0 | ✓ PASS |
| `pnpm --filter @khaveeai/providers-generic-stt-tts test --run` | vitest | 26/26 tests pass (4 files) | ✓ PASS |
| `pnpm --filter @khaveeai/providers-openai-stt-tts test --run` (compatibility regression check) | vitest | 13/13 tests pass, unchanged | ✓ PASS |

Both repro tests were written and run as throwaway files inside `packages/providers/generic-stt-tts/src/__tests__/`, executed via `pnpm --filter @khaveeai/providers-generic-stt-tts exec vitest run`, and deleted after confirming the result (verified via `git status` showing no tracked changes).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|--------------|----------------|--------------|--------|----------|
| ORCH-01 | 02-01, 02-02, 02-03 | Construct pipeline from `{vad,stt,llm,tts,tools}` | SATISFIED | `GenericPipelineConfig` + constructor wiring; integration test passes |
| ORCH-02 | 02-02, 02-03 | Implements `RealtimeProvider`, no react changes | SATISFIED | `implements RealtimeProvider`; zero commits to `packages/react/`; integration test with real adapters passes |
| ORCH-03 | 02-01, 02-02, 02-03 | Barge-in cancels in-flight work via AbortSignal | BLOCKED | Happy-path demonstrated and signal genuinely reaches fetch()/cancel(), but CR-01/CR-02 (independently reproduced) show the cancellation mechanism corrupts shared state or fails to engage at all in two in-scope scenarios (STT-in-flight supersession, sendMessage racing a VAD turn) |
| ORCH-04 | 02-03 | Config-driven cooldown, not hardcoded | SATISFIED | Verified, tested with non-default override |
| ORCH-05 | 02-02, 02-03 | Non-Error rejections normalized without crash | SATISFIED | Verified, tested with string rejection |

No orphaned requirements — all five ORCH-01..05 IDs appear in REQUIREMENTS.md's Phase 2 row and are claimed by at least one plan's `requirements:` frontmatter.

Note: `.planning/REQUIREMENTS.md` still lists ORCH-01..05 as `[ ] Pending` in the checklist body and "Pending" in the Traceability table (not updated to reflect this phase's completion) — a documentation-hygiene gap, not itself a goal-achievement blocker, but should be updated once ORCH-03's gap is closed.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `GenericPipelineProvider.ts` | 391-404 | Missing abort-signal guard before first side effect in `runTurnFromText` | 🛑 Blocker | Confirmed root cause of CR-01; corrupts shared conversation/message history on barge-in |
| `GenericPipelineProvider.ts` | 333-335 | `sendMessage()` does not create/register its own `AbortController` | 🛑 Blocker | Confirmed root cause of CR-02; defeats single-active-turn invariant |
| `GenericPipelineProvider.ts` | 48-61 | `pipelineTools` field name silently diverges from inherited `RealtimeConfig.tools` (which remains assignable but unread) | ⚠️ Warning | A consumer setting `config.tools` (the natural migration path from `OpenAISTTTTSConfig`) gets silently ignored tools with no compile error (code review IN-01) |
| `GenericPipelineProvider.ts` | 237 | `connect()` doesn't guard against double-`connect()` AudioContext leak | ⚠️ Warning | Pre-existing pattern carried forward from `OpenAISTTTTSProvider` (code review WR-02), not a regression but not hardened either |
| `GenericPipelineProvider.ts` | 487-492 | catch block in `runTurnFromText` unconditionally calls `resumeWithCooldown()` even if mic was never paused | ⚠️ Warning | Pays unnecessary cooldown delay on early-stage errors (code review WR-03) |
| `adapters/OpenAILLMAdapter.ts` | 29 | Tool-result marker regex breaks on whitespace in tool names | ⚠️ Warning | Code review WR-01; low-likelihood (requires a hallucinated/malformed tool name) but breaks the round-trip protocol silently |
| `generic-stt-tts/package.json` | 39-41 | Unused `react` peerDependency | ℹ️ Info | Code review WR-04; cosmetic/dependency-hygiene only |

No `TBD`/`FIXME`/`XXX` debt markers found in any phase-modified file.

## Gaps Summary

The phase delivers a genuinely working, well-structured orchestrator: 4/5 success criteria are solidly verified with both static evidence and independent reproduction (ORCH-01, ORCH-02, ORCH-04, ORCH-05). The package builds cleanly, all 26 tests in the new package pass, and the pre-existing `openai-stt-tts` test suite (13 tests) is unaffected — the compatibility constraint holds.

The remaining gap is ORCH-03 (full barge-in, D-03) — the phase's own code review identified two Critical concurrency defects (CR-01, CR-02) in exactly this mechanism, and I independently reproduced both against the current code with throwaway test files (deleted afterward, no tracked changes remain):

1. **CR-01** — `runTurnFromText()` mutates shared `conversation`/`messages` state before checking whether its `AbortSignal` was already fired, and the caller (`runTurn()`) does not check the signal between STT resolving and invoking `runTurnFromText()`. A superseded turn's stale utterance lands in conversation history, out of order, after the turn that superseded it.

2. **CR-02** — `sendMessage()` never creates or registers its own `AbortController`. When no turn is currently active (the common case), it races fully independently against any concurrently-arriving VAD-driven turn — both turns mutate shared state with zero coordination, defeating the single-active-turn invariant the rest of the orchestrator (and the barge-in design itself) depends on.

The existing test suite's barge-in coverage (`"ORCH-03: mid-turn utterance aborts the active turn and starts a new one"`) only exercises VAD-utterance-vs-VAD-utterance timing on the `AbortSignal.aborted` flag itself — it does not assert on conversation/message integrity after the abort, and it never exercises `sendMessage()` against a concurrent VAD turn. This is why the suite is 26/26 green while the underlying invariant is broken: the tests check a necessary but insufficient condition (the signal *eventually* becomes `aborted`) rather than the full behavioral contract (state stays uncorrupted, single-active-turn holds across both entry points).

Both defects are pre-documented with exact fixes in `.planning/phases/02-generic-pipeline-orchestrator/02-REVIEW.md` (CR-01, CR-02) — closing this gap is implementing those two documented fixes plus adding regression tests for the two scenarios above.

---

_Verified: 2026-06-18T10:00:36Z_
_Verifier: Claude (gsd-verifier)_
