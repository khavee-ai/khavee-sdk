# Phase 2: Generic Pipeline Orchestrator - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 2-Generic Pipeline Orchestrator
**Areas discussed:** Cancellation/AbortSignal, Adapter package location, Tool-calling loop, Barge-in semantics, Max iterations, Signal optionality, Class naming, Cooldown config

---

## Cancellation (AbortSignal on Phase 1 interfaces)

| Option | Description | Selected |
|--------|-------------|----------|
| Extend Phase 1 interfaces with signal param | Add optional `signal?: AbortSignal` to `LLMProvider.complete()` and `TTSProvider.speak()` so providers can actually stop in-flight work | ✓ |
| Orchestrator-only abort, no interface change | Orchestrator races a local AbortController and discards stale results; no Phase 1 interface changes | |

**User's choice:** Extend Phase 1 interfaces with signal param
**Notes:** Accepted touching already-"Validated" Phase 1 types because real cancellation otherwise can't be expressed.

---

## Adapters (where OpenAI stand-in wrappers live)

| Option | Description | Selected |
|--------|-------------|----------|
| New package: packages/providers/generic-stt-tts | Adapters become real, reusable, shippable code; matches PROJECT.md's plan | ✓ |
| Test-only fixtures | Adapter classes live only inside the orchestrator package's test files | |

**User's choice:** New package: packages/providers/generic-stt-tts

---

## Tool loop (rounds of tool-call → execute → feed back)

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-round loop with a max-iterations cap | Keep calling the LLM with tool results appended until zero tool calls or cap hit | ✓ |
| Single round only | Execute once, append results, one more LLM call, treat as final | |

**User's choice:** Multi-round loop with a max-iterations cap

---

## Barge-in (what happens to the triggering utterance)

| Option | Description | Selected |
|--------|-------------|----------|
| Immediate new turn | Cancel in-flight work AND immediately start a new turn using the triggering utterance | ✓ |
| Cancel and idle | Cancel in-flight work, discard the new utterance too, return to ready | |

**User's choice:** Immediate new turn

---

## Max iterations (tool loop cap)

| Option | Description | Selected |
|--------|-------------|----------|
| 5 rounds | Generous enough for realistic multi-tool agentic flows without runaway cost/latency | ✓ |
| 3 rounds | Tighter cap, favors fast turn completion | |

**User's choice:** 5 rounds

---

## Signal required (AbortSignal param optionality)

| Option | Description | Selected |
|--------|-------------|----------|
| Optional, best-effort | `signal?: AbortSignal` optional; providers that ignore it just keep running, orchestrator discards stale results | ✓ |
| Required on every implementation | `signal: AbortSignal` non-optional, forces changes everywhere interfaces are used | |

**User's choice:** Optional, best-effort

---

## Class name

| Option | Description | Selected |
|--------|-------------|----------|
| GenericPipelineProvider | Matches existing `<Vendor><Stage>Provider` naming pattern | ✓ |
| PipelineOrchestrator | Emphasizes orchestration role, deviates from naming convention | |

**User's choice:** GenericPipelineProvider

---

## Cooldown config (ORCH-04 field name + default)

| Option | Description | Selected |
|--------|-------------|----------|
| micReopenCooldownMs, default 500 | Matches existing camelCase + Ms-suffix convention, keeps proven 500ms default | ✓ |
| Let Claude decide naming and default | No strong preference | |

**User's choice:** micReopenCooldownMs, default 500

---

## Claude's Discretion

- Exact shape/naming of the orchestrator's constructor config object beyond `{vad, stt, llm, tts, tools?, micReopenCooldownMs}`
- Error normalization mechanics for ORCH-05 (follow established `instanceof Error` pattern)
- Whether the tool-calling loop reuses `OpenAISTTTTSProvider`'s `trimHistory()` pattern
- Internal VAD event wiring details (AudioRecorder's existing shape is the direct analog)
- Whether the 5-iteration-cap error gets a distinct message or a generic one

## Deferred Ideas

None — discussion stayed within phase scope.
