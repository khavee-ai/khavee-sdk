# Phase 2: Generic Pipeline Orchestrator - Research

**Researched:** 2026-06-18
**Domain:** TypeScript pipeline orchestration (composition of vendor-neutral interfaces into a `RealtimeProvider` implementation)
**Confidence:** HIGH

## Summary

This phase generalizes `OpenAISTTTTSProvider`'s hardcoded VAD→STT→Chat→TTS pipeline into a new `GenericPipelineProvider` class that composes Phase 1's `{VADProvider, STTProvider, LLMProvider, TTSProvider}` interfaces (`packages/core/src/types/pipeline.ts`) plus plain-object `Tool`s. All implementation mechanics are now well-understood from reading the existing code directly: `OpenAISTTTTSProvider.ts` is a complete behavioral template for connect/disconnect/runTurn/interrupt/error-normalization, and the four helper classes (`AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer`) are the exact concrete classes that this phase's adapter classes wrap to satisfy the new interfaces.

The two genuinely new mechanics this phase introduces — beyond what exists in `openai-stt-tts` today — are (1) threading an `AbortSignal` through `LLMProvider.complete()` and `TTSProvider.speak()` so that `fetch()` calls inside `ChatClient`/`TTSPlayer` can actually be aborted (today only `TTSPlayer.cancel()` aborts its own internal `AbortController`, created and owned inside the class, not passed in), and (2) a multi-round tool-calling loop, which has no precedent in `openai-stt-tts` (it has no tool-calling at all) but has a single-round precedent in `OpenAIRealtimeProvider.handleToolCall()` that must be extended into a `while` loop bounded by D-05's 5-iteration cap.

**Primary recommendation:** Build `GenericPipelineProvider` as a close structural port of `OpenAISTTTTSProvider` (same lifecycle, same status machine, same error-normalization, same `setChatStatus`/`trimHistory` helpers) but swap the four concrete dependencies for the four Phase 1 interfaces, add an internal `AbortController` per turn for barge-in, and insert a `while` loop around the LLM call for tool-calling. Ship the OpenAI-backed adapters (`OpenAISTTAdapter`, `OpenAILLMAdapter`, `OpenAITTSAdapter`) as real exported code in the new `packages/providers/generic-stt-tts` package, scaffolded identically to `packages/providers/openai-stt-tts`.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Barge-in / cancellation (ORCH-03)**
- **D-01:** `LLMProvider.complete()` and `TTSProvider.speak()` (`packages/core/src/types/pipeline.ts`) get an optional `signal?: AbortSignal` parameter added. This is a deliberate extension of the already-"Validated" Phase 1 interfaces — accepted because real cancellation (e.g. aborting an in-flight `fetch`) is otherwise impossible to express. The param is optional and best-effort (D-02), so this is additive and does not break Phase 1's existing contract or any current implementation.
- **D-02:** `signal` is **optional, best-effort** — not required on every implementation. Providers that read it (the new OpenAI stand-in adapters built this phase) get real cancellation; providers that ignore it keep running in the background, but the orchestrator discards their result once a newer turn has superseded them. No existing or future provider is broken by the new param.
- **D-03:** Barge-in is **full interruption, not cancel-and-idle**: when new speech arrives mid-turn, the orchestrator aborts the in-flight LLM/TTS work (via the `signal`) AND immediately starts a new turn using the utterance that triggered the barge-in — it is not dropped. This differs from today's `OpenAISTTTTSProvider` behavior, which silently drops new VAD utterances while `_isTurnActive` is true (`OpenAISTTTTSProvider.ts:356`).

**Tool-calling loop**
- **D-04:** The orchestrator runs a **multi-round tool-calling loop**: call LLM → if `toolCalls.length > 0`, execute each via the core `ToolExecutor` (`@khaveeai/core`), append results to the message history, call the LLM again → repeat until a completion returns zero tool calls (final text) or the iteration cap is hit.
- **D-05:** Max-iterations cap is **5 rounds**. If hit without a final non-tool-call response, the orchestrator treats it as an error path (normalized via D-08) rather than looping forever — prevents runaway agentic loops / cost blowups.

**Adapter package & verification (ORCH-02, success criterion 2)**
- **D-06:** Adapter classes wrapping the existing OpenAI helpers (`STTClient`, `ChatClient`, `TTSPlayer` from `openai-stt-tts`) to conform to `STTProvider`/`LLMProvider`/`TTSProvider` live in the **new `packages/providers/generic-stt-tts` package** as real, shippable code — not test-only fixtures. This matches PROJECT.md's plan for this package and means Phase 3/4's Thonburian/JaiTTS adapters land as siblings in the same package, and the OpenAI-backed ones double as a real usable provider rather than throwaway scaffolding. `openai-stt-tts` itself is not modified — these adapters wrap its exported pieces from the new package, one-directionally.

**Naming**
- **D-07:** The orchestrator class is named `GenericPipelineProvider` (not `PipelineOrchestrator`) — matches the existing `<Vendor><Stage>Provider` naming convention (`OpenAISTTTTSProvider`, `OpenAIRealtimeProvider`) while signaling it's the generic, composable one.

**Cooldown config (ORCH-04)**
- **D-08:** The VAD-to-mic-reopen cooldown becomes a config field named `micReopenCooldownMs`, default `500` — matches the existing camelCase + `Ms`-suffix convention (`silenceThresholdMs`) and preserves today's proven 500ms default (`OpenAISTTTTSProvider.ts:474,479`) so behavior doesn't change unless a future vendor adapter explicitly overrides it.

### Claude's Discretion
- Exact shape/naming of the orchestrator's constructor config object (e.g. `GenericPipelineConfig extends RealtimeConfig`) beyond requiring `{vad, stt, llm, tts, tools?}` plus `micReopenCooldownMs` — follow the existing `OpenAISTTTTSConfig extends RealtimeConfig` pattern.
- Error normalization mechanics for ORCH-05 — follow the established `error instanceof Error ? error : new Error(String(error))` pattern already used throughout the codebase (CLAUDE.md Error Handling conventions); no new pattern needed.
- Whether/how the tool-calling loop's per-round message history accumulation reuses `OpenAISTTTTSProvider`'s `trimHistory()` pattern — planner's call based on what's cleanest for the new class.
- Internal wiring details for VAD events (`onSpeechStart`/`onUtteranceReady`/`onError`) — `AudioRecorder`'s existing event shape (already matching `VADProvider`) is the direct analog; no open question here.
- Whether the 5-iteration-cap error is surfaced as a distinct `Error` message (e.g. "tool loop exceeded N rounds") vs. a generic one — planner's call, just must go through the same `onError` normalization as everything else.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. Real Thonburian/JaiTTS adapters and Bedrock/Gemini adapters are already tracked as Phase 3/4 and out-of-scope respectively in PROJECT.md/REQUIREMENTS.md, not new deferrals from this discussion.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORCH-01 | Developer can construct a working voice pipeline by passing `{vad, stt, llm, tts, tools}` to a single generic orchestrator class | "Recommended Project Structure" + "Pattern 1: Constructor Composition" below show the exact config shape and constructor wiring, modeled on `OpenAISTTTTSConfig`/`OpenAISTTTTSProvider`'s constructor |
| ORCH-02 | The generic orchestrator implements the existing `RealtimeProvider` interface, so no changes are required in `@khaveeai/react` to use it | "Architecture Patterns" confirms `RealtimeProvider`'s exact surface (`packages/core/src/types/realtime.ts`) and that `useRealtime.ts` only calls methods already on that interface — no react-layer changes needed if `GenericPipelineProvider implements RealtimeProvider` |
| ORCH-03 | User's in-progress speech cancels in-flight LLM/TTS work (barge-in/interruption) via an `AbortSignal`-style hook on the active providers | "Pattern 2: AbortSignal Threading" and "Pattern 3: Full-Interruption Barge-In" below give the concrete signal-creation/cancellation/supersession mechanics |
| ORCH-04 | The VAD-to-mic-reopen cooldown timing is a configurable value, not a hardcoded constant | "Code Examples" section shows the exact two call sites (`OpenAISTTTTSProvider.ts:474,479`) to generalize into `config.micReopenCooldownMs` |
| ORCH-05 | The orchestrator normalizes all provider errors to `Error` instances and forwards them via callback without crashing the active session | "Common Pitfalls" + existing normalization pattern (`error instanceof Error ? error : new Error(String(error))`) applied at every await boundary, matching `OpenAISTTTTSProvider.ts:282,376,480` |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| VAD / mic capture | Browser / Client | — | `AudioRecorder` wraps `MicVAD`, which requires `navigator.mediaDevices` and an audio worklet — browser-only, no server equivalent |
| STT transcription | API / Backend (via adapter) | Browser / Client (adapter call site) | The adapter class runs in the browser bundle but the actual transcription HTTP call targets a backend proxy/service; the adapter itself is a thin client-side wrapper |
| LLM completion + tool-calling loop | API / Backend (via adapter) | Browser / Client (orchestrator loop) | Same split as STT: the *loop* (multi-round tool dispatch) runs in the browser-side orchestrator; the actual completion call is proxied to a backend |
| Tool execution (`ToolExecutor`) | Browser / Client | — | Tools are registered with `execute` functions supplied by the consuming app (e.g. UI actions, fetches) — `ToolExecutor` dispatches them in-process, in the browser, not on a server |
| TTS synthesis + playback | API / Backend (synthesis) + Browser / Client (playback) | — | Synthesis is proxied to a backend exactly like STT/LLM; decoding (`AudioContext.decodeAudioData`) and playback (`AudioBufferSourceNode`) are unavoidably browser-only |
| Orchestration (turn lifecycle, barge-in, cooldown) | Browser / Client | — | `GenericPipelineProvider` is a plain TypeScript class instantiated and run entirely in the browser bundle, identical to `OpenAISTTTTSProvider` today — no server-side orchestration component exists or is being added |

**Note:** This phase has no "real" backend tier of its own — it produces only a browser-side orchestrator class plus browser-side adapter classes that call out to *existing* backend proxy endpoints (`sttProxyEndpoint`, `chatProxyEndpoint`, `ttsProxyEndpoint` — already present in `OpenAISTTTTSConfig` and reused by the adapters wrapping `STTClient`/`ChatClient`/`TTSPlayer`). No new backend code is built in Phase 2.

## Standard Stack

This phase adds **no new external npm dependencies**. It is pure composition of:
- `@khaveeai/core` (workspace package, Phase 1 deliverable) — `VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`, `Tool`, `ToolExecutor`, `RealtimeProvider`, `RealtimeConfig`
- The existing concrete classes inside `packages/providers/openai-stt-tts/src/` (`STTClient`, `ChatClient`, `TTSPlayer`, `AudioRecorder`) — wrapped, not copied, not modified

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@khaveeai/core` | `workspace:*` | Pipeline-stage interfaces, `ToolExecutor`, `RealtimeProvider` | Phase 1 deliverable; the only contract this phase's class must satisfy `[VERIFIED: codebase read]` |
| `typescript` | `^5.0.0` | Build tool, matches every sibling provider package `[VERIFIED: codebase read — packages/providers/openai-stt-tts/package.json]` |
| `vitest` + `@vitest/coverage-v8` | `^2.0.0` | Test framework, matches `openai-stt-tts`'s existing setup exactly `[VERIFIED: codebase read]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react` (peerDependency) | `^18.0.0 \|\| ^19.0.0` | Matches sibling provider packages' peerDependency declaration even though this package has no React code itself — consistency with `openai-stt-tts`'s `package.json` `[VERIFIED: codebase read]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `AudioRecorder`/`STTClient`/`ChatClient`/`TTSPlayer` via adapters (D-06) | Reimplementing equivalent VAD/HTTP logic directly in `generic-stt-tts` | Reimplementation would duplicate ~400 lines of already-tested, pitfall-hardened code (oversized-blob guard, AbortError swallowing, dual-path analyser wiring) for zero benefit — adapters are strictly better here |
| `AbortController` (native, used here) | A custom cancellation token class | `AbortSignal` is already the exact mechanism `TTSPlayer` uses internally (`this.abortController`) and what `fetch()` natively accepts — no custom abstraction needed, matches ORCH-03's literal wording ("AbortSignal-style hook") |

**Installation:**
No installation needed — this phase only adds a new workspace package referencing `@khaveeai/core` via `workspace:*`, identical to every existing provider package. `pnpm install` at the repo root after scaffolding `package.json` will link it automatically (pnpm workspace, confirmed via `pnpm-workspace.yaml`: `packages/providers/*`).

**Version verification:** `@khaveeai/core` is currently published at `0.3.3` on the npm registry (`npm view @khaveeai/core version` → `0.3.3`, checked 2026-06-18) `[VERIFIED: npm registry]`, but inside this monorepo the new package will depend on it via `workspace:*`, not a pinned semver range, exactly like `openai-stt-tts`'s own `package.json` (`"@khaveeai/core": "workspace:*"`).

## Package Legitimacy Audit

**Not applicable this phase.** No new external (non-workspace) npm packages are introduced. The only dependencies of the new `packages/providers/generic-stt-tts` package are `@khaveeai/core` (internal workspace package) and devDependencies (`typescript`, `vitest`, `@vitest/coverage-v8`) that are already present, pinned, and in active use elsewhere in this exact monorepo (`packages/providers/openai-stt-tts/package.json`). Re-running a registry/slopcheck audit on packages already vetted and running in production code in this repo would add no signal.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
                         ┌─────────────────────────────────────────┐
                         │        GenericPipelineProvider           │
                         │        (implements RealtimeProvider)      │
                         └─────────────────────────────────────────┘
                                          │
        ┌──────────────┬──────────────────┼──────────────────┬──────────────┐
        ▼              ▼                  ▼                  ▼              ▼
  ┌───────────┐  ┌────────────┐   ┌───────────────┐   ┌────────────┐  ┌───────────┐
  │ VADProvider│  │ STTProvider │   │  LLMProvider   │   │ TTSProvider│  │ToolExecutor│
  │ (injected) │  │ (injected)  │   │  (injected)    │   │ (injected) │  │(@khaveeai/ │
  └─────┬─────┘  └──────┬──────┘   └───────┬───────┘   └──────┬─────┘  │   core)    │
        │               │                  │                  │        └─────┬─────┘
        │ onSpeechStart │                  │                  │              │
        │ onUtteranceReady (wav: Blob)     │                  │              │
        │               │                  │                  │              │
        ▼               ▼                  │                  │              │
  ┌─────────────────────────────┐          │                  │              │
  │  runTurn(wav) — new utterance│         │                  │              │
  │  → IF barge-in: abort active │         │                  │              │
  │     turn's AbortController   │         │                  │              │
  └──────────────┬───────────────┘         │                  │              │
                 │ transcribe(wav, opts)    │                  │              │
                 └─────────────────────────▶│                  │              │
                                            │                  │              │
                 ┌──────────────────────────┘                  │              │
                 │ STTResult { text, rejected? }                │              │
                 ▼                                              │              │
   ┌───────────────────────────────────────────┐               │              │
   │ runTurnFromText(text)                       │              │              │
   │  appends user msg → tool-calling loop:      │              │              │
   │  ┌───────────────────────────────────────┐  │              │              │
   │  │ round = 0                             │  │              │              │
   │  │ loop:                                  │  │              │              │
   │  │   complete({messages, tools, signal}) ─┼──┼──────────────▶              │
   │  │   ◀── LLMCompletionResult{text,toolCalls}│              │              │
   │  │   if toolCalls.length === 0: break      │  │              │              │
   │  │   else: execute each via ToolExecutor ──┼──┼──────────────┼─────────────▶
   │  │         append results to messages       │  │              │   ◀── ToolResult
   │  │         round++; if round > 5: error      │  │              │
   │  └───────────────────────────────────────┘  │              │              │
   └──────────────────────┬───────────────────────┘              │              │
                          │ final text                            │              │
                          ▼                                        │              │
              speak(text, {audioContext, signal, onAudioData}) ────▶              │
                          │                                                       │
                          ◀── playback completes / aborted ──────────────────────┘
                          │
                          ▼
           resume VAD after micReopenCooldownMs (config, D-08)
                          │
                          ▼
                setChatStatus("ready") → onChatStatusChange
```

Entry point: VAD's `onUtteranceReady` (or `sendMessage(text)` for the text-only path, skipping STT). Decision points: barge-in check at turn start, tool-calls-present check inside the loop, 5-round cap check. External dependencies: whatever HTTP proxy endpoints the injected `STTProvider`/`LLMProvider`/`TTSProvider` adapters call internally (opaque to the orchestrator — it only sees the four interfaces).

### Recommended Project Structure
```
packages/providers/generic-stt-tts/
├── package.json              # @khaveeai/providers-generic-stt-tts, workspace:* on @khaveeai/core
├── tsconfig.json              # extends ../../../tsconfig.packages.json, same as openai-stt-tts
├── vitest.config.ts           # identical shape to openai-stt-tts's
├── .gitignore
├── src/
│   ├── GenericPipelineProvider.ts   # the orchestrator class (D-07 naming)
│   ├── adapters/
│   │   ├── OpenAISTTAdapter.ts      # wraps STTClient → STTProvider (D-06)
│   │   ├── OpenAILLMAdapter.ts      # wraps ChatClient → LLMProvider (D-06, adds signal threading)
│   │   ├── OpenAITTSAdapter.ts      # wraps TTSPlayer → TTSProvider (D-06, adds signal threading)
│   │   └── OpenAIVADAdapter.ts      # wraps AudioRecorder → VADProvider (near-direct; shapes already match)
│   ├── index.ts                     # exports GenericPipelineProvider, config type, all 4 adapters
│   └── __tests__/
│       ├── GenericPipelineProvider.test.ts
│       ├── OpenAILLMAdapter.test.ts
│       ├── OpenAITTSAdapter.test.ts
│       └── OpenAISTTAdapter.test.ts
```

This mirrors `packages/providers/openai-stt-tts/`'s exact layout (flat `src/`, `__tests__/` subfolder, `index.ts` barrel) with one addition: an `adapters/` subfolder, since D-06 requires 4 adapter classes that don't exist in the analog package. Importing `openai-stt-tts`'s helper classes from the new package requires that `openai-stt-tts` exports them — **verify/confirm in planning**: today `STTClient`, `ChatClient`, `TTSPlayer`, `AudioRecorder` are NOT exported from `packages/providers/openai-stt-tts/src/index.ts` (only `OpenAISTTTTSProvider`, its config type, and `ToolExecutor` are). D-06 says "wrap its exported pieces" — this means `openai-stt-tts/src/index.ts` needs new export lines added (additive only, does not modify existing exports or any class body) for the four helper classes the new package's adapters need to import as a published dependency. This is a small but necessary cross-package change the planner must include as an explicit task.

### Pattern 1: Constructor Composition (ORCH-01)
**What:** A single config object `{vad, stt, llm, tts, tools?, micReopenCooldownMs?, ...RealtimeConfig fields}` passed to one constructor, mirroring `OpenAISTTTTSConfig extends RealtimeConfig` but replacing concrete-class fields with interface-typed fields.
**When to use:** This is the only constructor shape — no alternate factory functions needed.
**Example:**
```typescript
// Source: packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:29-52 (analog),
// packages/core/src/types/pipeline.ts (interfaces being composed)
import { RealtimeConfig, VADProvider, STTProvider, LLMProvider, TTSProvider, Tool } from "@khaveeai/core";

export interface GenericPipelineConfig extends RealtimeConfig {
  vad: VADProvider;
  stt: STTProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  tools?: Tool[];
  /** VAD-to-mic-reopen cooldown (ms) after TTS playback ends. Default: 500 (D-08). */
  micReopenCooldownMs?: number;
}

export class GenericPipelineProvider implements RealtimeProvider {
  constructor(config: GenericPipelineConfig) {
    this.config = { micReopenCooldownMs: 500, ...config };
    this.vad = config.vad;
    this.stt = config.stt;
    this.llm = config.llm;
    this.tts = config.tts;
    this.toolExecutor = new ToolExecutor();
    config.tools?.forEach((t) => this.toolExecutor.register(t.name, t.execute));
    // RealtimeTool.execute and Tool.execute have the same shape — registerFunction(tool: RealtimeTool)
    // on the public interface stays usable for tools registered post-construction too.
  }
}
```
Note: `config.tools` here is typed `Tool[]` (the new vendor-neutral plain-object type from `@khaveeai/core`'s `tools.ts`), NOT `RealtimeTool[]` (the field's type on `RealtimeConfig` itself, since `RealtimeConfig.tools?: RealtimeTool[]`). Both `Tool` and `RealtimeTool` have an identical `{name, description, parameters, execute}` shape (confirmed by reading both interfaces side by side), so this is structurally compatible, but the planner must decide whether `GenericPipelineConfig` overrides the inherited `tools` field's type (TypeScript allows narrowing an inherited optional property to a compatible subtype) or introduces a differently-named field to avoid ambiguity. Given `Tool.parameters.properties` is a `Record` keyed object while `RealtimeTool.parameters` is also a keyed object with `required?` per-property (not a top-level `required: string[]`) — **these are NOT structurally identical**, just superficially similar. Re-verify exact field shapes before assuming interchangeability (see Open Questions).

### Pattern 2: AbortSignal Threading (ORCH-03, D-01/D-02)
**What:** Add `signal?: AbortSignal` to `LLMProvider.complete()`'s args and to `TTSProvider.speak()`'s `opts`. Inside the orchestrator, create one `AbortController` per turn; pass `controller.signal` into both calls; call `controller.abort()` on barge-in.
**When to use:** Every `runTurnFromText`-equivalent call in the new orchestrator.
**Example:**
```typescript
// Source: packages/core/src/types/pipeline.ts (interfaces to extend),
// packages/providers/openai-stt-tts/src/TTSPlayer.ts:61-88 (existing internal AbortController pattern to generalize)

// In pipeline.ts (Phase 2 modifies these Phase 1 interfaces per D-01):
export interface LLMProvider extends Provider {
  complete(args: {
    messages: Array<{ role: string; content: string }>;
    tools?: Tool[];
    signal?: AbortSignal;   // ← added this phase
  }): Promise<LLMCompletionResult>;
}

export interface TTSProvider extends Provider {
  speak(
    text: string,
    opts: {
      audioContext: AudioContext;
      onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;
      voice?: string;
      speed?: number;
      signal?: AbortSignal;   // ← added this phase
    }
  ): Promise<void>;
}

// Inside the new OpenAILLMAdapter (wraps ChatClient, which currently has NO signal param at all):
class OpenAILLMAdapter implements LLMProvider {
  constructor(private chatClient: ChatClient, private config: {...}) {}
  async complete(args: { messages: ...; tools?: Tool[]; signal?: AbortSignal }): Promise<LLMCompletionResult> {
    // ChatClient.complete() today has no signal param and no tool-calling support at all
    // (confirmed: packages/providers/openai-stt-tts/src/ChatClient.ts has no tools, no AbortSignal).
    // The adapter must either (a) extend ChatClient's own fetch call to accept+forward signal,
    // which requires modifying ChatClient.ts (allowed — ChatClient lives in openai-stt-tts but
    // D-06 only forbids modifying openai-stt-tts's *behavior*, not adding an optional param;
    // confirm with planner whether to treat this as in-bounds), OR (b) reimplement the fetch
    // call directly inside the adapter rather than delegating to ChatClient, bypassing it for
    // the new tool-calling + signal capabilities ChatClient was never built to support.
    // RECOMMENDATION: option (b) — ChatClient.complete() has zero tool-calling support and
    // adding it plus a signal contradicts "do not modify openai-stt-tts" more clearly than
    // building a parallel fetch call in the adapter. See Open Questions.
  }
}
```

**Critical finding:** `ChatClient.complete()` (today, in `openai-stt-tts/src/ChatClient.ts`) has **no tool-calling support whatsoever** — it POSTs `{messages, model, temperature}` only, with no `tools` field, and returns `{text, usage}` with no `toolCalls` field. This means `OpenAILLMAdapter` cannot be a thin wrapper that simply forwards to `ChatClient.complete()` and reshapes the response — there is no tool-calling data to reshape, because the backend Chat Completions proxy this client calls was never asked to send tools or return `tool_calls` in the first place. The adapter's `complete()` must independently construct and send an enhanced request body (including `tools` mapped to OpenAI's function-calling JSON shape, mirroring `OpenAIRealtimeProvider.configureSession()`'s parameter-mapping logic at lines 388-416) and parse `tool_calls` out of the proxy's response — meaning either (a) `ChatClient` itself needs new optional fields/method additions (additive, not breaking, similar to how D-01 treats `LLMProvider`), or (b) the adapter bypasses `ChatClient` and calls `fetch()` directly against the same `chatProxyEndpoint`. This is the single most consequential implementation-mechanics finding in this research — flagged for the planner under Open Questions.

### Pattern 3: Full-Interruption Barge-In (ORCH-03, D-03)
**What:** Unlike `OpenAISTTTTSProvider`'s `_isTurnActive` guard (which **drops** new utterances arriving mid-turn — `OpenAISTTTTSProvider.ts:356`, `if (this._isTurnActive) return;`), the new orchestrator must **abort the active turn's AbortController AND immediately start a new turn** with the utterance that triggered the barge-in.
**When to use:** Every time `onUtteranceReady` fires while a turn is already active.
**Example:**
```typescript
// Source: contrasts packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:355-381 (current drop behavior)
// with packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:359-363 (interrupt() precedent — but
// that only cancels, does not auto-restart with new content; D-03 goes further)

private activeTurnController: AbortController | null = null;

private async runTurn(wav: Blob): Promise<void> {
  // Full interruption, not drop (D-03): if a turn is active, abort it first.
  if (this.activeTurnController) {
    this.activeTurnController.abort();
    // Do NOT return here — D-03 requires immediately starting the NEW turn,
    // contrasting with OpenAISTTTTSProvider's `if (this._isTurnActive) return;`
  }
  const controller = new AbortController();
  this.activeTurnController = controller;
  try {
    this.setChatStatus("thinking");
    const sttResult = await this.stt.transcribe(wav, { language: this.config.language });
    if (!sttResult.text || !sttResult.text.trim() || sttResult.rejected) {
      this.setChatStatus("ready");
      return;
    }
    await this.runTurnFromText(sttResult.text, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return; // this turn was superseded — not a real error
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
    this.setChatStatus("ready");
  } finally {
    if (this.activeTurnController === controller) {
      this.activeTurnController = null;
    }
  }
}
```
Per D-02, providers that ignore `signal` (don't read it) keep running in the background after abort — the orchestrator must check `controller.signal.aborted` before acting on a stale result (e.g. before calling `setChatStatus`, before pushing to `conversation`/`messages`) to discard superseded work even when the underlying provider didn't actually stop early.

### Pattern 4: Multi-Round Tool-Calling Loop (D-04/D-05)
**What:** A bounded `while` loop around `llm.complete()`, dispatching each round's `toolCalls` through `ToolExecutor`, appending results to history, looping until zero tool calls or 5 rounds.
**When to use:** Inside `runTurnFromText`, replacing the single `chatClient.complete()` call in `OpenAISTTTTSProvider.ts:405-411`.
**Example:**
```typescript
// Source: packages/core/src/types/pipeline.ts (LLMCompletionResult.toolCalls, ToolCall{id,name,args}),
// packages/core/src/types/tools.ts (ToolExecutor.execute(name, args) → ToolResult{success,message}),
// contrasted with packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:577-599 (single-round precedent)

const MAX_TOOL_ROUNDS = 5; // D-05

let round = 0;
let result: LLMCompletionResult;
while (true) {
  result = await this.llm.complete({
    messages: this.messages,
    tools: this.config.tools,
    signal: controller.signal,
  });

  if (result.toolCalls.length === 0) break; // final text reply (D-04 terminal condition)

  round++;
  if (round > MAX_TOOL_ROUNDS) {
    throw new Error(`Tool-calling loop exceeded ${MAX_TOOL_ROUNDS} rounds`); // D-05 error path
  }

  // Execute each tool call (Anthropic/Gemini-style parallel calls supported since
  // toolCalls is always an array — see pipeline.ts's CORE-06 doc comment)
  for (const call of result.toolCalls) {
    const toolResult = await this.toolExecutor.execute(call.name, call.args);
    this.onToolCall?.(call.name, call.args, toolResult);
    // Append the tool result to history so the next round's complete() call sees it.
    // Exact message shape for "a tool result in history" is vendor-neutral here —
    // ChatMessage is {role, content}; encode the tool result as a string-content
    // message (e.g. role: "user" or a dedicated convention) since the core
    // LLMProvider.complete() signature only accepts {role: string; content: string}[]
    // — there is no role: "tool" union member and no `tool_call_id` field anywhere
    // in this vendor-neutral interface (CORE-06 constraint). The exact encoding
    // convention is an open question — see Open Questions below.
    this.messages.push({
      role: "user", // placeholder — exact convention TBD, see Open Questions
      content: `Tool ${call.name} result: ${JSON.stringify(toolResult)}`,
    });
  }
}
// result.text is now the final assistant reply.
```

### Anti-Patterns to Avoid
- **Reimplementing VAD/HTTP logic instead of wrapping the existing helpers (D-06 violation):** `AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer` already encode multiple hardened pitfall-fixes (oversized-blob rejection, AbortError swallowing, dual-path analyser, `arrayBuffer.slice(0)` before `decodeAudioData`). Adapters must wrap, not duplicate, this logic.
- **Treating `_isTurnActive`'s drop-behavior as a template for barge-in:** D-03 explicitly reverses this — the new orchestrator must *replace* the early-return guard with abort-and-restart, not copy it forward.
- **Assuming `Tool` and `RealtimeTool` are interchangeable without checking field shapes:** They look similar (`{name, description, parameters, execute}`) but `RealtimeTool.parameters` puts `required?: boolean` per-property while `Tool.parameters` puts a single top-level `required?: string[]` array — confirmed by direct comparison of `realtime.ts:7-22` and `tools.ts:29-45`. A naive cast will silently produce malformed parameter schemas.
- **Calling `setChatStatus`/mutating `conversation` from a superseded (aborted) turn:** Always check `controller.signal.aborted` (or compare a turn-generation counter) before any side effect once an `await` boundary has been crossed, per D-02's "discard superseded result" requirement.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool dispatch by name, not-found/throw normalization | A new dispatcher inside `GenericPipelineProvider` | `ToolExecutor` from `@khaveeai/core` (`packages/core/src/types/tools.ts`) | Already handles `{success: false, message: "Function '...' not found"}` and try/catch normalization (CORE-05); D-04 explicitly calls for using it directly |
| Cross-turn cancellation primitive | A custom cancellation-token class | Native `AbortController`/`AbortSignal` | Already the exact mechanism `TTSPlayer` uses internally and what `fetch()` natively accepts; ORCH-03 literally specifies "AbortSignal-style hook" |
| WAV-blob size guarding, MicVAD lifecycle | Reimplementing VAD wiring from scratch | Wrap `AudioRecorder` via a thin `VADProvider`-conformant adapter | `AudioRecorder`'s event shape (`onSpeechStart`/`onUtteranceReady`/`onError`) already matches `VADProvider`'s callback shape near-exactly; CONTEXT.md's `code_context` confirms this explicitly |
| Dual-path Web Audio analyser setup for lip-sync | New `AnalyserNode` wiring inside the orchestrator or adapter | Delegate to `TTSPlayer.speak()`'s existing `source.connect(analyser)` + `source.connect(destination)` pattern via the adapter | Already pitfall-hardened (resume-before-firing-onAudioData, AudioContext suspended-state handling) |

**Key insight:** This phase's entire value is in *generalizing* existing, working, pitfall-hardened code — not writing new pipeline mechanics from scratch. Every "Don't Hand-Roll" item above already exists in the codebase today; the task is adapter-wrapping and interface-conformance, not reimplementation.

## Common Pitfalls

### Pitfall 1: `ChatClient` has no tool-calling support to adapt
**What goes wrong:** Assuming `OpenAILLMAdapter.complete()` can be a thin pass-through to `ChatClient.complete()` that just reshapes the response.
**Why it happens:** `ChatClient.ts` was written before Phase 1's `LLMProvider`/tool-calling design existed — it only sends `{messages, model, temperature}` and returns `{text, usage}`, with zero tool-calling wire format.
**How to avoid:** The planner must explicitly decide whether the adapter (a) bypasses `ChatClient` and issues its own `fetch()` against the same `chatProxyEndpoint` with an OpenAI-shaped `tools` array + signal, parsing `tool_calls` from the response, or (b) extends `ChatClient` with new optional capability (additive method or params) before wrapping it. Either is viable; silently assuming (a-light, i.e. "just call `chatClient.complete()` and toolCalls will magically appear") is not.
**Warning signs:** A plan task that says "wrap ChatClient.complete() to satisfy LLMProvider" without separately calling out where `tools`/`signal`/`toolCalls` come from.

### Pitfall 2: Tool-result message encoding has no vendor-neutral convention yet
**What goes wrong:** `LLMProvider.complete()`'s `messages` param is typed `Array<{role: string; content: string}>` — there is no `role: "tool"` union member, no `tool_call_id` field anywhere (CORE-06 deliberately omits vendor-specific correlation field names from the interface). Appending tool results to history without a clear, documented convention risks each adapter inventing its own incompatible encoding.
**Why it happens:** Phase 1 intentionally kept `ToolCall.id` vendor-neutral but did not (and per its own doc comments, by design) specify how a *result* gets threaded back into the next round's `messages` array at the interface level — that mapping is left to each adapter, same as the request-side mapping documented in `pipeline.ts`'s file header.
**How to avoid:** The orchestrator (not the adapter) owns history accumulation, so it must pick ONE encoding convention (e.g. `{role: "user", content: "Tool result for <name>: <message>"}` or a structured JSON-stringified content) and use it uniformly — the `OpenAILLMAdapter` then needs to parse that same convention back out when constructing the next round's vendor-specific request (e.g. mapping back to OpenAI's `role: "tool", tool_call_id, content` shape). Document this convention clearly in the new code; it's effectively a Phase-2-local protocol since the core interface doesn't define one.
**Warning signs:** Tool round 2 producing a malformed/ignored OpenAI request because the adapter can't tell which prior message was a tool result vs. a real user message.

### Pitfall 3: Double-counting cancellation across two cooperating mechanisms
**What goes wrong:** D-02 says "best-effort" — a provider that doesn't read `signal` keeps running. If the orchestrator naively assumes `controller.abort()` always stops work synchronously, late-arriving results from an aborted turn can still mutate `conversation`/`messages`/`chatStatus` after a *newer* turn has already started, corrupting state (e.g. an old turn's assistant reply appearing after the new turn's).
**Why it happens:** `AbortController.abort()` only cancels things that explicitly check the signal (e.g. `fetch`'s `signal` option) — it does not retroactively prevent already-scheduled `.then()`/`await` continuations from running.
**How to avoid:** Track which `AbortController` (or a monotonic turn-generation counter) is "current" on the instance; before any side-effecting step after an `await`, check `controller === this.activeTurnController` (or `!controller.signal.aborted`) and bail out silently if it's stale — same pattern as `TTSPlayer.speak()`'s `AbortError` swallow but generalized to non-fetch-based providers too.
**Warning signs:** Flaky test failures where two rapid utterances produce conversation entries in the wrong order, or duplicate `setChatStatus("ready")` calls racing each other.

### Pitfall 4: Forgetting `openai-stt-tts/src/index.ts` needs new (additive) exports
**What goes wrong:** D-06's adapters need to `import { STTClient } from "@khaveeai/providers-openai-stt-tts"` (cross-package, per CLAUDE.md's "no relative `../../` imports across packages" convention), but today's `index.ts` only exports `OpenAISTTTTSProvider`, its config type, and `ToolExecutor` — not `STTClient`/`ChatClient`/`TTSPlayer`/`AudioRecorder`.
**Why it happens:** Those four classes were deliberately marked "internal — NOT exported" when `openai-stt-tts` was built (Phase 0/pre-milestone), because nothing outside the package needed them yet.
**How to avoid:** Add export lines to `packages/providers/openai-stt-tts/src/index.ts` for the four helper classes (and any types the adapters need, e.g. `ChatMessage`, `ChatResult` from `ChatClient.ts`). This is additive-only and does not violate "openai-stt-tts stays as-is, untouched" in spirit (no behavior changes, no existing export removed) — but it IS a file edit inside `openai-stt-tts`, so the planner should flag this explicitly as an exception to the "untouched" constraint and confirm it's acceptable, or alternatively, that the new package imports these via a deep relative path (worse — violates the "always via package name" convention) or that the classes get duplicated (worse — defeats the entire point of "wrap, don't reimplement").
**Warning signs:** A plan that says "import STTClient from openai-stt-tts" without a task to add the export.

### Pitfall 5: AudioContext double-creation/double-close across the new class
**What goes wrong:** Like `OpenAISTTTTSProvider`, the new orchestrator likely owns an `AudioContext` for TTS playback (since `TTSProvider.speak()`'s `opts.audioContext` must be supplied by the caller — i.e., the orchestrator, per the interface signature in `pipeline.ts:197-205`). Reusing a closed context, or closing an already-closed one, throws (documented as "RESEARCH Pitfall 1" in the existing code's comments).
**Why it happens:** `@khaveeai/react`'s `RealtimeAudioAnalyzer` may already have closed the context by the time `disconnect()` runs, exactly as already documented in `OpenAISTTTTSProvider.ts:295-297,311`.
**How to avoid:** Reuse the exact same guard: `if (this.audioOutputContext && this.audioOutputContext.state !== "closed") { await this.audioOutputContext.close(); }` and always create a fresh `AudioContext` per `connect()` call, never reused across reconnects.
**Warning signs:** Uncaught `InvalidStateError` exceptions on disconnect/reconnect cycles in manual testing.

## Code Examples

### Cooldown generalization (ORCH-04, D-08)
```typescript
// Source: packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:469-480 (the two hardcoded
// 500ms call sites being generalized)

// BEFORE (OpenAISTTTTSProvider — hardcoded):
await this.audioRecorder.resume();
this.micEnabled = true;
await new Promise<void>((resolve) => setTimeout(resolve, 500));   // ← hardcoded twice (success + catch paths)
this.setChatStatus("ready");

// AFTER (GenericPipelineProvider — config-driven, D-08):
await this.vad.resume();
await new Promise<void>((resolve) =>
  setTimeout(resolve, this.config.micReopenCooldownMs ?? 500)
);
this.setChatStatus("ready");
```
Both call sites (success path and catch path in `runTurnFromText`) must read from the same config field — copy-paste the constant into two places like the original does, or factor into a private `resumeWithCooldown()` helper (cleaner; recommended since this phase already changes this code substantially).

### Error normalization at every await boundary (ORCH-05)
```typescript
// Source: packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:281-285, 375-380, 476-482
// (the exact pattern to replicate at every new await boundary this phase introduces —
// connect(), runTurn(), the tool-calling loop, and speak())

try {
  // ... awaited provider call (vad.connect / stt.transcribe / llm.complete / tts.speak / toolExecutor.execute)
} catch (error) {
  if (controller?.signal.aborted) return; // superseded by barge-in — not a real error (D-02/D-03)
  this.onError?.(error instanceof Error ? error : new Error(String(error)));
  this.setChatStatus("ready");
}
```
This must be applied not just to `fetch`-based providers (which throw real `Error`/`DOMException` objects) but ALSO to vendor adapters that might `throw` a string or a vendor SDK's own non-Error error object — ORCH-05's success criterion 5 explicitly calls out "a string or vendor-specific error object" as a required test case.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| One turn-active boolean (`_isTurnActive`) that drops concurrent utterances | Per-turn `AbortController` that aborts-and-restarts on barge-in | This phase (D-03) | Requires re-deriving the entire turn-lifecycle state machine — `_isTurnActive` cannot simply be "kept" and reused, since its drop semantics are the opposite of what's needed |
| Single-round tool-calling sketch (`OpenAIRealtimeProvider.handleToolCall`) | Multi-round bounded loop (D-04/D-05) | This phase | `OpenAIRealtimeProvider`'s pattern handles exactly one tool call per turn, sends the result back, and lets the next `response.create` implicitly continue — the new orchestrator must explicitly loop in user-land since there's no equivalent implicit continuation in a request/response (non-realtime) LLM API |
| `ChatClient.complete()` with no tools/signal | (this phase introduces, via adapter) an OpenAI-shaped completion call with `tools` + `signal` + `tool_calls` parsing | This phase | `ChatClient` itself may or may not need modification — see Pitfall 1; this is new wire-format work, not just type-level adaptation |

**Deprecated/outdated:** None — Phase 1's interfaces (`pipeline.ts`, `tools.ts`) are brand new (validated this same milestone) and this phase is their first real consumer; nothing here is legacy except the `openai-stt-tts` patterns being generalized, which remain valid and untouched in their own package.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Tool` and `RealtimeTool` are NOT structurally interchangeable (per-property `required?` vs top-level `required: string[]`) | Pattern 1, Anti-Patterns | If wrong (i.e. if some other normalization already reconciles this elsewhere), the flagged risk is moot — but currently confirmed by direct side-by-side file read, not assumption, so this is actually `[VERIFIED: codebase read]` not `[ASSUMED]` — listed here only because the planner must explicitly design around it, not because the underlying claim is uncertain |
| A2 | `ChatClient.complete()` needs either a bypass or an additive extension to support tool-calling + signal (Pitfall 1) — exact resolution path is the planner's call, not pre-decided in CONTEXT.md | Pattern 2, Pitfall 1 | If the planner picks "extend ChatClient" without realizing this touches a file inside `openai-stt-tts` (nominally "untouched" this milestone), it could violate the compatibility constraint unless treated as an explicitly-approved additive exception |
| A3 | Adding exports to `packages/providers/openai-stt-tts/src/index.ts` is an acceptable additive exception to "openai-stt-tts stays as-is, untouched" | Pitfall 4 | If the user/planner intends "untouched" literally (zero file diffs, not just zero behavior diffs), this assumption is wrong and the new package would need an alternative (duplicate the 4 helper classes, or a deep relative import) — both worse outcomes; needs explicit confirmation |
| A4 | A turn-generation counter or per-instance `activeTurnController` reference (rather than e.g. a queue of pending turns) is sufficient to implement "abort old + immediately start new" (D-03) without losing barge-in events fired in rapid succession (3+ utterances before the first completes) | Pattern 3, Pitfall 3 | If users can legitimately barge in multiple times within milliseconds, a single-slot "latest wins" design (as sketched) silently drops the middle one(s) — this matches D-03's stated intent ("new utterance" singular) but the plan should confirm only the LATEST pending utterance needs to win, not that all are processed |

## Open Questions (RESOLVED)

1. **Does `ChatClient.complete()` get extended with `tools`/`signal` params, or does `OpenAILLMAdapter` bypass it entirely with its own `fetch()` call?**
   - What we know: `ChatClient.ts` today has zero tool-calling support and no `AbortSignal` param; D-06 says adapters wrap the existing helpers; D-01 says `LLMProvider.complete()` gets `signal` added.
   - What's unclear: Whether "wrap" tolerates extending `ChatClient` itself (a file inside the supposedly-untouched `openai-stt-tts` package) with new optional capability, vs. having the adapter reimplement the HTTP call independently.
   - Recommendation: Treat as a planning-time decision with two viable paths; lean toward bypass (adapter does its own `fetch()` against `chatProxyEndpoint`) since it keeps `openai-stt-tts` literally unmodified and is more defensible against the "untouched" constraint, at the cost of a small amount of duplicated fetch/auth-header boilerplate (already simple, ~15 lines, in `ChatClient.complete()`).
   - **RESOLVED:** Plan 02-02 Task 2 has `OpenAILLMAdapter` bypass `ChatClient` entirely with its own `fetch()` against `chatProxyEndpoint` — keeps `openai-stt-tts` literally unmodified.

2. **What vendor-neutral convention encodes a tool-call result back into the next round's `messages` history?**
   - What we know: `LLMProvider.complete()`'s `messages` type is `Array<{role: string; content: string}>` with no `role: "tool"` and no correlation-id field, per CORE-06's deliberate vendor-neutrality.
   - What's unclear: The exact string/JSON convention the orchestrator should use when appending a `ToolResult` to history, and how `OpenAILLMAdapter` should map that convention back to OpenAI's actual `{role: "tool", tool_call_id, content}` wire shape when building its next request.
   - Recommendation: Planner should pick one explicit convention (e.g. `role: "user"` with a clearly-prefixed content string, OR widen `ChatMessage`'s `role` union locally within the new package only, without touching the core `LLMProvider.complete()` signature) and document it as a code comment, since this is genuinely new design surface not resolved by either Phase 1 or CONTEXT.md.
   - **RESOLVED:** Plan 02-03 Task 2 (writer) and Plan 02-02 Task 2 (parser) both use the phase-2-local convention `[tool_result id=<id> name=<name>] <message>` inside a `role: "user"` message; `OpenAILLMAdapter` parses it back into OpenAI's `{role: "tool", tool_call_id, content}` wire shape.

3. **Is editing `packages/providers/openai-stt-tts/src/index.ts` (to export `STTClient`/`ChatClient`/`TTSPlayer`/`AudioRecorder`) within the "untouched" compatibility constraint?**
   - What we know: PROJECT.md's constraint says "Must not break the existing openai-stt-tts provider or its consumers — it stays as-is, untouched, this milestone." D-06 explicitly requires wrapping "its exported pieces."
   - What's unclear: Whether "exported pieces" implicitly assumes new exports will be added (i.e. the constraint is about behavior, not file diffs) or whether literally zero diffs are required (in which case D-06 as written is unsatisfiable without one of the worse alternatives in Pitfall 4).
   - Recommendation: Resolve this explicitly in planning/discuss-phase follow-up if not already implicitly settled by D-06's wording — current research treats "additive-only export lines, zero behavior change" as in-bounds, consistent with how D-01 treats adding an optional `signal` param to Phase 1's interfaces as compatible/non-breaking.
   - **RESOLVED:** Plan 02-01 Task 2 adds additive-only export lines (zero behavior change) to `packages/providers/openai-stt-tts/src/index.ts` — accepted as in-bounds per the recommendation above.

## Project Constraints (from CLAUDE.md)

- **Compatibility:** Must not break the existing `openai-stt-tts` provider or its consumers — stays as-is, untouched, this milestone (see Open Question 3 for the one place this phase's needs press against this constraint).
- **Language boundary:** Not directly relevant this phase (no Python service involved) — `generic-stt-tts` remains pure TypeScript, browser-targeted, like `openai-stt-tts`.
- **Beginner DX:** Tool-calling API must be usable with plain JS objects only — already satisfied by Phase 1's `Tool` interface; this phase must not reintroduce a schema library when building the tool-calling loop or adapters.
- **Vendor neutrality:** Core interfaces must support future Bedrock/Gemini adapters without redesign — directly relevant to Open Question 2 (tool-result history encoding must not bake in an OpenAI-only shape at the `GenericPipelineProvider` level, even though this phase's only real adapters are OpenAI-backed).
- **Naming conventions:** PascalCase classes matching `<Vendor><Stage>Provider` (D-07 follows this exactly with `GenericPipelineProvider`); camelCase methods/fields; `on<Event>` optional callback fields; private re-entrancy/mutation helpers prefixed with verbs; `Ms`-suffixed config fields for durations (D-08's `micReopenCooldownMs` follows this).
- **Error handling:** `error instanceof Error ? error : new Error(String(error))` normalization before every `onError?.()` call — mandatory per CLAUDE.md and explicitly required by ORCH-05.
- **Comments:** Preserve/extend "RESEARCH Pitfall N" / ticket-ID-style inline comments where copying patterns forward from `OpenAISTTTTSProvider.ts`; new pitfalls discovered this phase should get their own inline tags for future maintainers.
- **Import organization:** New package must import `@khaveeai/core` and (per D-06/Pitfall 4) `@khaveeai/providers-openai-stt-tts` via package name, never relative `../../` paths.
- **Test colocation:** Tests live under `src/__tests__/` named `<SourceClass>.test.ts`, using Vitest — matches `openai-stt-tts`'s existing setup exactly.

## Environment Availability

No external tools, services, or runtimes beyond what's already configured in this repo are required for this phase (no new CLI, no new database, no new service). Skipped per the stated skip condition — this is a pure TypeScript composition phase with all dependencies already present and verified (`@khaveeai/core` resolves via the pnpm workspace; `typescript`/`vitest` are already installed at the relevant package versions across sibling packages).

## Sources

### Primary (HIGH confidence)
- `packages/core/src/types/pipeline.ts` — exact `VADProvider`/`STTProvider`/`LLMProvider`/`TTSProvider`/`ToolCall`/`LLMCompletionResult`/`STTResult` shapes, read directly
- `packages/core/src/types/tools.ts` — exact `Tool`/`ToolResult`/`ExecutableTool`/`ToolExecutor` shapes and implementation, read directly
- `packages/core/src/types/realtime.ts` — exact `RealtimeProvider`/`RealtimeConfig`/`RealtimeEvents`/`RealtimeTool` shapes, read directly
- `packages/core/src/types/providers.ts`, `packages/core/src/types/conversation.ts` — `Provider`, `Conversation`, `ChatStatus`, `RealtimeMessage` shapes, read directly
- `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` — full source read, the direct behavioral analog
- `packages/providers/openai-stt-tts/src/{AudioRecorder,STTClient,ChatClient,TTSPlayer}.ts` — full source read, the concrete classes D-06's adapters wrap
- `packages/providers/openai-stt-tts/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}` — exact scaffolding template for the new package
- `packages/providers/openai-stt-tts/src/__tests__/OpenAISTTTTSProvider.test.ts` — confirms the `ProviderDeps`-style injection-seam testing pattern to replicate
- `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` (lines 340-600) — `interrupt()` and `handleToolCall()` precedents, read directly
- `packages/react/src/hooks/useRealtime.ts` (grep) — confirms which `RealtimeProvider` methods/fields the React layer actually calls, validating ORCH-02's "no react-layer changes" claim
- `.planning/phases/02-generic-pipeline-orchestrator/02-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/PROJECT.md` — locked decisions and project history, read directly
- `npm view @khaveeai/core version` — confirmed `0.3.3` published, 2026-06-18 `[VERIFIED: npm registry]`

### Secondary (MEDIUM confidence)
None used — all findings this phase came from direct codebase reads (HIGH confidence by nature, since the exact files in question are the implementation target) rather than external documentation, since this phase has no new third-party library surface to research.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new external dependencies; every class/interface cited was read directly from the working tree
- Architecture: HIGH — the orchestrator's required shape is fully determined by `RealtimeProvider` (read directly) and the locked CONTEXT.md decisions; remaining ambiguity (Open Questions 1-3) is genuine new design surface, not missing information
- Pitfalls: HIGH — every pitfall cited traces to a specific line/file read this session, not inferred or assumed

**Research date:** 2026-06-18
**Valid until:** Stable until Phase 1 interfaces or `openai-stt-tts` helper classes change — no external time-based decay (no third-party API/version drift risk in this phase's scope). Re-research only if Phase 1 interfaces are revised before Phase 2 planning begins.
