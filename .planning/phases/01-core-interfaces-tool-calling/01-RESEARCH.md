# Phase 1: Core Interfaces & Tool-Calling - Research

**Researched:** 2026-06-18
**Domain:** TypeScript interface design / vendor-neutral abstraction layer (no runtime, no new dependencies)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tool field naming**
- **D-01:** The new `Tool` type's execution field stays named `execute` (not `handler`). This matches the existing `RealtimeTool` (`packages/core/src/types/realtime.ts`) and the `ToolExecutor`/`registerFunction` code being promoted from `openai-stt-tts` and `openai-realtime` — zero churn on working code. REQUIREMENTS.md CORE-03's "`handler`" wording is descriptive of the *shape* (plain object + callback), not a literal field-name requirement.

**Tool parameter schema shape**
- **D-02:** The new core `Tool` type is a **new type**, separate from `RealtimeTool` (which stays untouched per the compatibility constraint). `Tool.parameters` uses JSON-Schema-style shape (`{type: "object", properties: {...}, required: [...]}`) instead of `RealtimeTool`'s flat custom map (`{[key]: {type, required, enum, description}}`). This matches what OpenAI/Anthropic/Gemini tool-calling APIs actually expect, so no per-vendor parameter transform is needed and the Phase 1 success-criterion-5 sketch (Anthropic/Gemini mapping) has a direct target shape.
- **D-03:** The promoted core `ToolExecutor` is typed against a **minimal shared shape** — `{name: string, execute: (args) => Promise<{success, message}>}` — not against `RealtimeTool` or `Tool` specifically. `ToolExecutor` never reads `parameters` (confirmed by reading both existing `ToolExecutor.ts` files — `register`/`execute` only touch `name` and the execute function), so one executor implementation works unmodified for both the old `RealtimeTool`-based packages and the new `Tool`-based code. No generic/parameterized executor needed.

**Multi-tool-call support**
- **D-04:** `LLMProvider`'s completion result type carries `toolCalls: ToolCall[]` (zero or more), not a single optional tool call. Today's actual OpenAI Realtime behavior (`OpenAIRealtimeProvider.handleToolCall`, one `function_call_arguments.done` event at a time) is the `length === 1` case of this shape — no information is lost. This directly satisfies CORE-06 and gives the success-criterion-5 sketch (Anthropic/Gemini-shaped multi-tool-call round trip) a real target without a future interface redesign.
- **D-05:** Each `ToolCall`'s correlation identifier (used to send the tool's result back to the LLM in the next turn — OpenAI calls this `call_id`/`tool_call_id`) is named **`id`** on the vendor-neutral type, per CORE-06's explicit instruction to avoid OpenAI-specific field names. Each `LLMProvider` implementation is responsible for mapping its vendor's own field (OpenAI's `tool_call_id`, Anthropic's `id` on a `tool_use` block, Gemini's index-based correlation, etc.) to/from this single `id` string.

**STTProvider return shape**
- **D-06:** `STTProvider.transcribe()` returns a result object (e.g. `{text: string, rejected?: boolean}`), not a plain `string`. This lets Phase 4's `ThonburianSTTProvider` surface BACK-02's hallucination/no-speech rejection signal through the standard interface with no Phase 1 interface redesign later. Vendors that never reject (e.g. a hypothetical future OpenAI-Whisper-backed `STTProvider`) simply never set `rejected`. Input stays a `Blob` (WAV) — matches the existing `AudioRecorder.onUtteranceReady(wav: Blob)` / `STTClient.transcribe(wavBlob: Blob, ...)` pattern already used in the browser SDK; not in question, no vendor sends audio any other way today.

### Claude's Discretion
- Exact names and presence of capability flags per interface (e.g. `supportsStreaming`, `supportsToolCalling`) beyond what's needed to satisfy CORE-02 — researcher/planner should derive these from the two real vendors' actual capabilities (Thonburian STT and JaiTTS TTS are both whole-utterance, non-streaming; this should be reflected in the flags' defaults/usage, not contradicted).
- Exact shape of `VADProvider` (not discussed — no gray area surfaced; existing `AudioRecorder` is the closest analog and should inform it).
- Where the new `Tool`/`ToolCall`/`LLMProvider` types physically live within `packages/core/src/types/` (new file vs. extending an existing one) — follow existing per-domain file naming convention (`realtime.ts`, `audio.ts`, `conversation.ts`, etc.).
- The unit test required by success criterion 3 (tool-call results normalized to `{success, message}` across two differently-shaped mock vendor responses) — test structure and mock vendor shapes are implementation detail.
- How exactly the "written sketch" for success criterion 5 is delivered (code comment vs. design note doc) — both are acceptable per ROADMAP.md wording.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (Reconciling the legacy `LLMProvider`/`TTSProvider` in `mock.ts` and real Bedrock/Gemini adapters are already tracked as v2/out-of-scope in REQUIREMENTS.md and PROJECT.md, not new deferrals from this discussion.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|---------------------|
| CORE-01 | SDK exposes VADProvider, STTProvider, LLMProvider, and TTSProvider interfaces in `@khaveeai/core` that any vendor adapter can implement | Architecture Patterns > Pattern 1 (capability-flag pattern + `STTProvider` sketch); Recommended Project Structure (`pipeline.ts`); Open Question 2 (whether to extend the `Provider` marker interface) |
| CORE-02 | Each provider interface declares capability flags (e.g. `supportsStreaming`) so the orchestrator and consumers can branch correctly without redesigning the interface later | Architecture Patterns > Pattern 1 — flags as readonly properties, derived from Thonburian/JaiTTS's actual non-streaming behavior per CONTEXT.md's Claude's-Discretion note |
| CORE-03 | Developer can register a tool with a plain object `{name, description, parameters, handler}` — no schema library (Zod, decorators) required | Architecture Patterns > Pattern 2 (`Tool` type + worked example); Don't Hand-Roll (explicit exclusion of runtime schema validation) |
| CORE-04 | SDK normalizes tool-call results to one shape (`{success, message}`) regardless of which LLM vendor produced the call | Architecture Patterns > Pattern 2 (`ToolResult`) and Pattern 3 (`ToolExecutor.execute()` always returns this shape, confirmed already true in existing code via direct read) |
| CORE-05 | Tool-execution logic is defined once in `@khaveeai/core` and reused by both the new generic pipeline and existing realtime providers, removing the current byte-for-byte `ToolExecutor.ts` duplication | Architecture Patterns > Pattern 3 (promotion design); Common Pitfalls 1-2 (naming collision and self-import risks that must be resolved for this promotion to compile) |
| CORE-06 | The LLMProvider tool-calling interface avoids encoding OpenAI-specific field names (e.g. `tool_call_id`) so a future non-OpenAI LLM vendor adapter can implement it without an interface redesign | Architecture Patterns > Pattern 4 (verified OpenAI/Anthropic/Gemini field-name divergence table + neutral `ToolCall{id, name, args}` design + code sketch) |
</phase_requirements>

## Summary

This phase is pure interface design inside `@khaveeai/core` — no new npm packages, no network calls, no browser APIs beyond what's already typed in the codebase. The work has two halves: (1) define four new provider interfaces (`VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`) plus a vendor-neutral `Tool`/`ToolCall` type system, and (2) promote the existing byte-for-byte-duplicated `ToolExecutor` class out of `openai-stt-tts`/`openai-realtime` into `@khaveeai/core`.

The codebase already contains every pattern needed as a direct template: `RealtimeTool` (`packages/core/src/types/realtime.ts`) already returns `{success, message}` from `execute()`, matching CORE-04 exactly. The two `ToolExecutor.ts` files are confirmed byte-for-byte identical (`diff` returns no output) and only ever touch `.name` and `.execute` — never `.parameters` — which directly validates context decision D-03 (type the promoted executor against a minimal shared shape, not against `Tool` or `RealtimeTool`). The hardest real risk in this phase is the **naming collision**: `packages/core/src/types/mock.ts` already exports a `LLMProvider` interface (orphaned, used only by the legacy `KhaveeConfig.llm` field, explicitly out of scope per CLEAN-03). Since `mock.ts` is re-exported via `export *` in `packages/core/src/types/index.ts`, declaring a second `export interface LLMProvider` in a new file will cause a duplicate-export TypeScript compile error the moment both are barrel-exported — this MUST be resolved before any code is written, not discovered during implementation.

External verification (WebSearch + official docs) of OpenAI, Anthropic, and Gemini tool-calling shapes confirms context decision D-05 is well-founded: all three vendors use a different field name and structural position for the tool-call correlation ID (OpenAI: `tool_calls[].id` / reply `tool_call_id`; Anthropic: `tool_use` block's `id` / `tool_result`'s `tool_use_id`; Gemini: `functionCall.id` / `functionResponse.id`, same field name reused on both sides). This makes the planner's job concrete: the `ToolCall.id` field on the new vendor-neutral type needs zero vendor-specific naming, and the success-criterion-5 sketch should literally map all three onto one `{id, name, args}` shape.

**Primary recommendation:** Promote `ToolExecutor` unchanged (typed against a new minimal `ExecutableTool = {name: string; execute: (args: any) => Promise<{success: boolean; message: string}>}` shape per D-03), add a new `packages/core/src/types/tools.ts` file holding `Tool`, `ToolCall`, `ToolResult`, and the promoted `ToolExecutor` class, and resolve the `LLMProvider` naming collision by renaming/quarantining the legacy `mock.ts` export before the new pipeline-stage `LLMProvider` is declared.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Provider interface contracts (`VADProvider`, `STTProvider`, `LLMProvider`, `TTSProvider`) | SDK Core (browser-targeted library) | — | These are TypeScript type/interface declarations only, consumed at compile time by both browser SDK code and any future Node-side adapter; they have no runtime tier themselves |
| Tool registration (`Tool` type, `addTool()`-style API) | SDK Core | Browser/Client (eventual consumer: `OpenAISTTTTSProvider`/orchestrator) | Tool definitions are plain objects constructed by app/developer code (browser), but the *type* and the executor registry living in core is what makes them swappable |
| Tool execution (`ToolExecutor`) | SDK Core | Browser/Client (actual `fn()` call happens in whatever environment registered it — today always browser) | The dispatch/registry logic is vendor-agnostic and belongs in core; the executed function bodies are app-supplied and run wherever the provider instance lives (currently always browser, per CLAUDE.md's browser-only constraint) |
| Tool-call result normalization (`{success, message}`) | SDK Core | — | Normalization must happen once, centrally, regardless of which `LLMProvider` implementation produced the raw vendor-shaped call — this is the entire point of CORE-04 |
| Vendor field-name mapping (OpenAI `tool_call_id` / Anthropic `tool_use_id` / Gemini `functionCall.id`) | Vendor Adapter (future, Phase 4+ / not built this phase) | SDK Core (defines the target shape adapters map onto) | Per D-05, each `LLMProvider` *implementation* (not built in Phase 1) owns translating its vendor's own field name to/from the neutral `id` — core only defines the neutral shape |

## Standard Stack

### Core

No new runtime dependencies. This phase adds TypeScript source files only.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| typescript | ^5 (already pinned in `packages/core/package.json` devDependencies) | Interface/type declarations, strict-mode compilation | Already the project's compiler; `strict: true` already enforced via `tsconfig.packages.json` |

### Supporting (test infrastructure — new addition to `@khaveeai/core`)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|--------------|
| vitest | ^2.0.0 (match `openai-stt-tts`'s pinned version for monorepo consistency) [VERIFIED: npm registry] | Unit test runner for the success-criterion-3 test (two differently-shaped mock vendor tool-call responses normalizing to `{success, message}`) | `@khaveeai/core` currently has **no test framework configured at all** (confirmed: no `vitest.config.ts`, no `__tests__/` dir, no `test` script in `packages/core/package.json`) — this is a Wave 0 gap, not an existing capability |

**Version verification:** `npm view vitest version` returned `4.1.9` as latest-on-registry at research time [VERIFIED: npm registry], but the rest of the monorepo (`packages/providers/openai-stt-tts`) pins `^2.0.0`. Recommend matching the existing `^2.0.0` pin for consistency rather than introducing a second major version of vitest into the workspace — this is a judgment call for the planner, not a hard requirement either way.

**Installation:**
```bash
# Run from packages/core/
pnpm add -D vitest@^2.0.0 @vitest/coverage-v8@^2.0.0
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vitest | Jest (already used by `packages/providers/qdrant`) | Jest already exists in the monorepo too, so this isn't a new tool either way. vitest matches the sibling provider package (`openai-stt-tts`) that this phase's promoted `ToolExecutor` originates from, and ESM/Vite-native config is simpler for a `tsc`-built ESM package. Recommend vitest for consistency with the nearer-related package. |

## Package Legitimacy Audit

No external packages are introduced by this phase. `vitest` (and `@vitest/coverage-v8`) are devDependencies **already present and in active use** elsewhere in this exact monorepo (`packages/providers/openai-stt-tts/package.json`) — they are not a new supply-chain surface, merely a second `package.json` reference to a dependency already vetted and running in CI for this repository. The Package Legitimacy Gate (slopcheck, registry cross-check) is not required for "add an existing in-repo devDependency to one more workspace package." No disposition table is needed.

**Packages removed due to slopcheck [SLOP] verdict:** none (not applicable — no new packages)
**Packages flagged as suspicious [SUS]:** none (not applicable — no new packages)

## Architecture Patterns

### System Architecture Diagram

```text
                    ┌─────────────────────────────────────────┐
                    │         @khaveeai/core (this phase)       │
                    │                                            │
  Developer code    │  ┌──────────────┐    ┌──────────────────┐│
  constructs a      │  │  Tool (type) │    │ ToolCall (type)   ││
  plain object   ───┼─▶│ {name, desc, │    │ {id, name, args}  ││
  {name, desc,      │  │  parameters, │    │  (zero-or-more,   ││
   parameters,      │  │  execute}    │    │   per D-04)        ││
   execute}         │  └──────┬───────┘    └─────────┬─────────┘│
                    │         │                       │          │
                    │         ▼                       ▼          │
                    │  ┌──────────────────────────────────────┐ │
                    │  │   ToolExecutor (promoted, single copy) │ │
                    │  │   .register(name, fn)                  │ │
                    │  │   .execute(name, args)                 │ │
                    │  │     → always returns {success, message}│ │
                    │  └─────────────────┬────────────────────┘ │
                    │                    │                       │
                    │  ┌─────────────────▼────────────────────┐ │
                    │  │ VADProvider / STTProvider /            │ │
                    │  │ LLMProvider / TTSProvider (interfaces) │ │
                    │  │   each declares supports* flags        │ │
                    │  └─────────────────┬────────────────────┘ │
                    └────────────────────┼────────────────────────┘
                                          │  (compile-time contract only —
                                          │   no instances created this phase)
                       ┌──────────────────┼──────────────────────┐
                       ▼                  ▼                      ▼
            ┌─────────────────┐ ┌──────────────────┐  ┌──────────────────────┐
            │ openai-stt-tts   │ │ openai-realtime   │  │ (Phase 4, future)     │
            │ — imports        │ │ — imports         │  │ ThonburianSTTProvider │
            │ promoted         │ │ promoted          │  │ JaiTTSProvider        │
            │ ToolExecutor,    │ │ ToolExecutor,     │  │ implement STTProvider/│
            │ deletes its      │ │ deletes its       │  │ TTSProvider           │
            │ local copy       │ │ local copy        │  │                       │
            └─────────────────┘ └──────────────────┘  └──────────────────────┘
```

A reader can trace the primary flow: a developer-supplied plain object enters as `Tool`, is registered into the single promoted `ToolExecutor`, and any `LLMProvider` implementation that receives a vendor-shaped tool call converts it to the neutral `ToolCall{id, name, args}` shape before invoking the executor, which always normalizes its output to `{success, message}`.

### Recommended Project Structure

```
packages/core/src/types/
├── realtime.ts        # UNCHANGED — RealtimeTool, RealtimeProvider, RealtimeEvents (compatibility constraint)
├── providers.ts        # UNCHANGED or extended — existing unused `Provider` marker interface
├── tools.ts             # NEW — Tool, ToolCall, ToolResult, ExecutableTool, ToolExecutor class
├── pipeline.ts          # NEW — VADProvider, STTProvider, LLMProvider (pipeline-stage), TTSProvider, capability flag types
├── conversation.ts      # UNCHANGED
├── audio.ts             # UNCHANGED
├── mock.ts              # MODIFIED — legacy LLMProvider/TTSProvider renamed or quarantined (see Pitfall 1 below) to resolve naming collision
├── project.ts           # UNCHANGED
└── index.ts              # MODIFIED — barrel re-export updated to include tools.ts and pipeline.ts, and to NOT silently re-export two conflicting `LLMProvider` symbols
```

**Naming rationale:** Following the existing per-domain file convention (confirmed in CONTEXT.md and the existing `realtime.ts`/`audio.ts`/`conversation.ts` split), a new `tools.ts` cleanly separates the tool-calling type system (used by every pipeline stage and also still relevant to `RealtimeTool`-based code) from `pipeline.ts`, which holds only the four new provider interfaces and their capability flags. This is Claude's-discretion territory per CONTEXT.md — the planner may choose a single combined file instead, but two files keeps each under ~100 lines and matches the existing file-per-domain pattern more closely than one large file would.

### Pattern 1: Capability Flags on Provider Interfaces (CORE-02)

**What:** Each of the four new interfaces declares boolean (or literal-union) capability flags as properties, not methods — readable synchronously without an async call, so a consumer (Phase 2's orchestrator) can branch before invoking any provider method.

**When to use:** Any time a single interface must represent vendors with meaningfully different runtime behavior (e.g., a streaming STT vendor vs. a whole-utterance-only one) without the orchestrator needing per-vendor `instanceof` checks.

**Example (sketch — not yet implemented):**
```typescript
// New file: packages/core/src/types/pipeline.ts
// Source: derived from CLAUDE.md's documented AudioRecorder/STTClient/TTSPlayer
// patterns plus CONTEXT.md D-06 (STTProvider returns a result object, not a string)

export interface STTProvider {
  /** True if this vendor can emit partial transcripts before the utterance ends.
   *  Both real vendors built this milestone (Thonburian Whisper, and any future
   *  OpenAI-Whisper-backed STTProvider) are whole-utterance only — default false. */
  readonly supportsStreaming: boolean;

  /** True if this vendor can flag a transcript as likely hallucinated
   *  (e.g. BACK-02's silence/repetition-ratio check). */
  readonly supportsRejection: boolean;

  transcribe(audio: Blob, opts?: { language?: string }): Promise<STTResult>;
}

export interface STTResult {
  text: string;
  /** Present and true when the vendor's own heuristics flag this transcript
   *  as likely hallucinated/silent. Vendors that never reject simply omit this field. */
  rejected?: boolean;
}
```

This directly matches D-06 from CONTEXT.md and the existing `STTClient.transcribe(): Promise<string>` pattern, generalized to a result object so Phase 4's `ThonburianSTTProvider` doesn't need a future interface redesign.

### Pattern 2: Tool Definition as Plain Object, JSON-Schema-Shaped Parameters (CORE-03, D-02)

**What:** `Tool.parameters` uses the JSON-Schema `{type: "object", properties: {...}, required: [...]}` shape — the same shape OpenAI, Anthropic, and Gemini's tool-calling APIs all natively accept — rather than `RealtimeTool`'s flat custom map.

**When to use:** Any new tool-calling surface in this milestone. `RealtimeTool` itself is explicitly NOT touched (compatibility constraint).

**Example:**
```typescript
// New file: packages/core/src/types/tools.ts
// Source: pattern matches OpenAI/Anthropic/Gemini tool schema conventions
// (verified via WebSearch against official docs, June 2026)

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: "string" | "number" | "boolean" | "array" | "object";
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  /** D-01: field stays named `execute`, matching RealtimeTool — zero churn. */
  execute: (args: any) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  message: string;
}
```

A beginner registers a tool with zero imports beyond this type:
```typescript
const tool: Tool = {
  name: "get_weather",
  description: "Get current weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string", description: "City name" } },
    required: ["city"],
  },
  execute: async (args) => ({ success: true, message: `Sunny in ${args.city}` }),
};
```
This satisfies CORE-03's "no Zod, no decorators, plain object" requirement exactly — `Tool` is a plain TypeScript interface, not a class or a schema-builder function.

### Pattern 3: Promoted `ToolExecutor` Typed Against a Minimal Shared Shape (D-03, CORE-05)

**What:** The single promoted `ToolExecutor` is typed against `{name: string; execute: (args: any) => Promise<ToolResult>}`, not against `Tool` or `RealtimeTool` directly — because its `register`/`execute` methods never read `.parameters` or `.description` (confirmed by reading both existing duplicate files: only `.name` and `.execute` are ever touched).

**Why this matters:** This lets the same `ToolExecutor` class serve both legacy `RealtimeTool`-based callers (`openai-stt-tts`, `openai-realtime`) and any new `Tool`-based caller without a generic/parameterized executor or a breaking change to either existing package.

**Example:**
```typescript
// packages/core/src/types/tools.ts (continued)
// Source: lift-and-shift from packages/providers/{openai-stt-tts,openai-realtime}/src/ToolExecutor.ts
// (confirmed byte-for-byte identical via `diff`)

export type ExecutableTool = {
  name: string;
  execute: (args: any) => Promise<ToolResult>;
};

export class ToolExecutor {
  private functions: Map<string, ExecutableTool["execute"]> = new Map();

  register(name: string, fn: ExecutableTool["execute"]): void {
    this.functions.set(name, fn);
  }

  async execute(name: string, args: any): Promise<ToolResult> {
    const fn = this.functions.get(name);
    if (!fn) {
      return { success: false, message: `Function '${name}' not found` };
    }
    try {
      return await fn(args);
    } catch (error) {
      console.error(`Error executing function '${name}':`, error);
      return {
        success: false,
        message: `Error executing function: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  getRegisteredFunctions(): string[] {
    return Array.from(this.functions.keys());
  }
}
```
Both `openai-stt-tts/src/ToolExecutor.ts` and `openai-realtime/src/ToolExecutor.ts` are then deleted, and each package's import changes from a local relative import to `import { ToolExecutor } from "@khaveeai/core"`. Because `RealtimeTool["execute"]` and `ExecutableTool["execute"]` are structurally identical function signatures (`(args: any) => Promise<{success: boolean; message: string}>`), TypeScript's structural typing accepts `RealtimeTool` objects wherever `ExecutableTool` is expected with zero adapter code — this is the direct payoff of D-03's minimal-shape design.

### Pattern 4: Multi-Tool-Call Round Trip Sketch for Non-OpenAI Vendors (Success Criterion 5, D-04, D-05, CORE-06)

**What:** A written sketch (per CONTEXT.md, code comment or design doc — Claude's discretion) demonstrating that `LLMProvider`'s completion result carries `toolCalls: ToolCall[]` (zero or more, per D-04) where `ToolCall.id` is vendor-neutral (per D-05), and that this shape accommodates Anthropic and Gemini's actual multi-tool-call wire formats without OpenAI-specific naming.

**Verified vendor shapes (WebSearch + official docs, June 2026):**

| Vendor | Call-side field name | Reply-side correlation field | Multiple calls per turn? |
|--------|----------------------|-------------------------------|----------------------------|
| OpenAI Chat Completions | `tool_calls[].id` (each entry also has `.function.name`, `.function.arguments` as a JSON string) [CITED: developers.openai.com/api/docs/guides/function-calling] | reply message: `{role: "tool", tool_call_id, content}` — `tool_call_id` must equal the matching `tool_calls[].id` [CITED: OpenAI cookbook / community docs] | Yes — `tool_calls` is an array; model may call zero, one, or multiple in one response |
| OpenAI Realtime API (already in this codebase) | `response.function_call_arguments.done` event has `call_id`, `name`, `arguments` (JSON string) [VERIFIED: `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:577-602`, confirmed by direct code read] | reply: `{type: "function_call_output", call_id, output}` | One event per call (current codebase only handles one at a time — this is the `length === 1` case D-04 describes) |
| Anthropic Messages API | assistant message contains a `tool_use` content block: `{type: "tool_use", id, name, input}` [CITED: platform.claude.com/docs/en/agents-and-tools/tool-use/overview] | reply: a `tool_result` content block `{type: "tool_result", tool_use_id, content}` where `tool_use_id` must match the `tool_use` block's `id` [CITED: platform.claude.com docs + AWS Bedrock Anthropic docs] | Yes — multiple `tool_use` blocks can appear in one assistant message's `content` array; each needs its own matching `tool_result` block |
| Google Gemini API | a `functionCall` part: `{functionCall: {id, name, args}}` [CITED: ai.google.dev/gemini-api/docs/function-calling] | reply: a `functionResponse` part `{functionResponse: {id, name, response}}` — the API matches replies to calls via `id`, not array position [CITED: ai.google.dev/gemini-api/docs/function-calling] | Yes — "parallel function calls," each `functionCall` part has a unique `id`; "the Gemini API maps each result back to its corresponding call using the `id`" |

**Confidence:** MEDIUM-HIGH. All four rows are corroborated by at least one official-domain source (`platform.claude.com`, `ai.google.dev`, `developers.openai.com`) found via WebSearch, cross-checked against this codebase's own already-working OpenAI Realtime integration for the OpenAI row. Field names for Anthropic/Gemini were not independently re-verified via Context7 (not available/queried this session) — flag as MEDIUM confidence pending a second independent source if the planner wants HIGH before locking the sketch's exact prose.

**The sketch's core point:** Despite three different field names (`tool_call_id`, `tool_use_id`, the reused `id`) and two different structural positions (top-level array element vs. nested content-block vs. nested "part"), all three reduce to the same neutral triple once extracted: `{id: string, name: string, args: Record<string, any>}`. A vendor-neutral `LLMProvider` only needs to promise it will produce `ToolCall[]` with this shape and accept the same shape back — translation to/from the vendor's own field name is the adapter's job, never the core interface's.

```typescript
// packages/core/src/types/pipeline.ts (continued)
// Design note satisfying success criterion 5 — see table above for vendor source citations.

export interface ToolCall {
  /** Vendor-neutral correlation id. Maps from OpenAI's tool_calls[].id /
   *  Realtime API's call_id, Anthropic's tool_use.id, or Gemini's functionCall.id.
   *  Each LLMProvider implementation owns this mapping — core never sees a
   *  vendor-specific field name (CORE-06). */
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface LLMCompletionResult {
  text?: string;
  /** Zero or more — today's OpenAI Realtime integration only ever produces
   *  one at a time (the length === 1 case); Anthropic/Gemini can produce
   *  several in a single turn. No future redesign needed either way (D-04). */
  toolCalls: ToolCall[];
}
```

### Anti-Patterns to Avoid

- **Encoding a vendor's correlation-ID field name into the core type** (e.g. naming the field `tool_call_id` because that's OpenAI's name): violates CORE-06 explicitly; use the neutral `id` per D-05.
- **Making `ToolCall` a single optional field instead of an array**: loses information the moment any vendor that supports parallel/multi tool calls (Anthropic, Gemini, and even OpenAI itself) is adapted later, forcing an interface redesign exactly as CORE-06/D-04 are written to prevent.
- **Typing the promoted `ToolExecutor` against `RealtimeTool` or the new `Tool` type directly**: unnecessarily couples the executor to one tool-definition shape; D-03's minimal-shape typing is correct and should not be "simplified" back to a concrete type during implementation.
- **Reusing the bare name `LLMProvider` without resolving the `mock.ts` collision first**: will produce a TypeScript duplicate-export error the moment `packages/core/src/types/index.ts`'s `export *` barrel sees two same-named interfaces from two files. See Pitfall 1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Tool-call dispatch/registry | A second registry implementation, or a generic `ToolExecutor<T>` | The existing `ToolExecutor` class, lifted unchanged per D-03 | It already works, is already tested implicitly by both existing providers' passing test suites, and only needs a type-narrowing change, not new logic |
| Result normalization (`{success, message}`) | A new normalization function/class | `RealtimeTool`'s existing `execute()` return contract, copied verbatim onto `Tool` | CORE-04 is already solved today for the realtime case — the new types should match the proven shape, not invent a different one |
| JSON-Schema-shaped parameter validation | Any runtime validator (Zod, ajv, custom hand-rolled checker) | Nothing — per the explicit Out-of-Scope line in REQUIREMENTS.md ("Zod or other schema-library-based tool parameter validation... violates the beginner-DX constraint") | `Tool.parameters` is a type-level shape only this phase; no runtime validation of `args` against the schema is in scope or should be added |

**Key insight:** This entire phase is deliberately *type-level* work. The temptation to "also validate" tool arguments at runtime, or to "also build" a small schema-checking utility while touching this code, must be resisted — it's explicitly out of scope and would silently violate the beginner-DX constraint that drove the plain-object design in the first place.

## Common Pitfalls

### Pitfall 1: `LLMProvider` Naming Collision with `mock.ts`

**What goes wrong:** `packages/core/src/types/mock.ts` already exports `export interface LLMProvider { streamChat(...): AsyncIterable<...> }`. `packages/core/src/types/index.ts` re-exports everything from `mock.ts` via `export * from './mock'`. If a new file also exports `interface LLMProvider`, and that file is also barrel-re-exported, TypeScript raises a duplicate-export ambiguity error (`Module './pipeline' has already exported a member named 'LLMProvider'`) the first time both are pulled through the same `export *` barrel.

**Why it happens:** `mock.ts`'s `LLMProvider` is orphaned (CLEAN-03, "reconcile" deferred to v2) but was never removed, and CONTEXT.md confirms the new pipeline-stage interface needs the same conceptual name.

**How to avoid:** This MUST be resolved as an explicit Phase 1 task, not discovered mid-implementation. Two viable resolutions (planner should pick one, both compile-clean):
  1. Rename the legacy `mock.ts` export at the point of definition (e.g. `LegacyLLMProvider` or `StreamingLLMProvider`) and update its two consumers (`KhaveeConfig.llm` field in `mock.ts` itself, and `packages/providers/mock/src/index.ts`'s `MockLLM` if it references the type name directly — verify via grep before renaming).
  2. Do not add the new pipeline-stage `LLMProvider` to the `index.ts` barrel's blanket `export *` chain; instead export it under a distinct re-exported name, or restructure `index.ts` to use named re-exports (`export type { LLMProvider as PipelineLLMProvider }`) for one of the two.

Option 1 (rename the legacy one) is recommended — it's the orphaned, soon-to-be-deprecated type (CLEAN-03), so renaming it now reduces future confusion and the new vendor-neutral `LLMProvider` keeps the name everyone will actually mean going forward. CONTEXT.md's "Claude's Discretion" section doesn't explicitly call this out, but it falls under "Where the new Tool/ToolCall/LLMProvider types physically live" — the planner should treat the collision resolution as in-scope discretion, not a deferred item, since CLEAN-03 only defers full *reconciliation*, not blocking a same-milestone compile error.

**Warning signs:** `tsc` build of `@khaveeai/core` fails with a duplicate export/ambiguous member error immediately after adding the new interface — this will surface at build time, not at usage time, so it's caught early if `pnpm run build:packages` (or just `packages/core`'s own `tsc`) is run as a verification step right after the new file is added, before any other package starts consuming it.

### Pitfall 2: Assuming `ToolExecutor`'s Promotion is a Pure File Move

**What goes wrong:** Treating "promote `ToolExecutor` to core" as just `git mv` plus an import-path fix can silently miss that the *type it's parameterized against* must change from `RealtimeTool['execute']` to the new `ExecutableTool['execute']` per D-03 — otherwise the promoted version still imports `RealtimeTool` from `@khaveeai/core`, creating an awkward self-referential import inside the very package that defines `RealtimeTool`, and tying the "vendor-neutral" executor's public type signature to a realtime-specific tool type.

**Why it happens:** The two existing files literally say `import { RealtimeTool } from '@khaveeai/core';` at the top — a naive lift-and-shift preserves that import unchanged, which becomes circular once the file lives inside `@khaveeai/core` itself.

**How to avoid:** When writing the promoted `ToolExecutor`, change its internal typing to the new minimal `ExecutableTool` shape (no import needed — it can be a local type literal in the same file) rather than importing `RealtimeTool`. Verify post-promotion that `packages/core/src/types/tools.ts` has zero imports from `'@khaveeai/core'` itself.

**Warning signs:** A self-import (`from '@khaveeai/core'` inside a file that is itself part of `@khaveeai/core`'s public surface) appearing in `tools.ts`; or `tsc` reporting a circular reference warning during the core package's own build.

### Pitfall 3: `RealtimeTool` Compatibility Drift

**What goes wrong:** Editing `realtime.ts` "while in there" — e.g. changing `RealtimeTool.parameters`'s flat shape to match the new JSON-Schema shape "for consistency" — breaks the explicit compatibility constraint (`RealtimeTool` must NOT be modified) and risks regressing `openai-stt-tts`, the only currently-tested provider.

**Why it happens:** Once a developer is deep in tool-calling type design, the two shapes (`RealtimeTool.parameters`'s flat map vs. the new `Tool.parameters`'s JSON-Schema nesting) sitting side-by-side in the same codebase create pressure to "unify" them.

**How to avoid:** Treat `realtime.ts` as read-only this phase except for the one sanctioned change (if any) of adding the new tool/pipeline type imports elsewhere — never edit `RealtimeTool`'s own field definitions. Verify via `git diff` before considering any task in this phase complete that `realtime.ts` is either untouched or only has additive, non-breaking changes.

**Warning signs:** A diff touching `RealtimeTool.parameters`'s type definition, or any change to `RealtimeProvider`'s method signatures.

### Pitfall 4: Forgetting `@khaveeai/core` Has No Test Infrastructure Yet

**What goes wrong:** Success criterion 3 requires a unit test, but `packages/core` currently has zero test config (no `vitest.config.ts`, no `__tests__/`, no `test` script). A plan that says "add a unit test" without first scaffolding the test runner will stall or produce an untested claim of completion.

**Why it happens:** Every other package with tests (`openai-stt-tts`, `qdrant`) already has its runner configured; it's easy to assume `core` does too since it's the most foundational package.

**How to avoid:** Explicitly include a Wave 0 task to add `vitest` + `vitest.config.ts` + a `test` script to `packages/core/package.json` before writing the success-criterion-3 test. See Validation Architecture section below (or, since `nyquist_validation` is disabled for this project, ensure the plan itself calls this out as a prerequisite task).

**Warning signs:** Attempting to run `pnpm --filter @khaveeai/core test` and getting "missing script: test."

## Code Examples

### Verified pattern: Existing duplicate `ToolExecutor` (confirmed byte-for-byte identical via diff)

```typescript
// Source: packages/providers/openai-stt-tts/src/ToolExecutor.ts
// AND packages/providers/openai-realtime/src/ToolExecutor.ts (confirmed identical, `diff` empty)
import { RealtimeTool } from '@khaveeai/core';

export class ToolExecutor {
  private functions: Map<string, RealtimeTool['execute']> = new Map();

  register(name: string, fn: RealtimeTool['execute']): void {
    this.functions.set(name, fn);
  }

  async execute(name: string, args: any): Promise<{ success: boolean; message: string }> {
    const fn = this.functions.get(name);
    if (!fn) {
      return { success: false, message: `Function '${name}' not found` };
    }
    try {
      return await fn(args);
    } catch (error) {
      console.error(`Error executing function '${name}':`, error);
      return {
        success: false,
        message: `Error executing function: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  getRegisteredFunctions(): string[] {
    return Array.from(this.functions.keys());
  }
}
```

### Verified pattern: OpenAI Realtime's actual single-tool-call round trip (the `length === 1` case D-04 generalizes)

```typescript
// Source: packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:577-602
// (direct code read, this session)
private async handleToolCall(msg: any): Promise<void> {
  this.setChatStatus("thinking");
  try {
    const args = JSON.parse(msg.arguments);
    const result = await this.toolExecutor.execute(msg.name, args);
    this.onToolCall?.(msg.name, args, result);

    const response = {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: msg.call_id,           // OpenAI's vendor-specific correlation field
        output: JSON.stringify(result),
      },
    };
    this.dataChannel?.send(JSON.stringify(response));
    this.dataChannel?.send(JSON.stringify({ type: "response.create" }));
  } catch (error) {
    console.error("Tool execution error:", error);
    this.onError?.(error as Error);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|---------|
| Flat custom parameter map (`RealtimeTool.parameters: {[key]: {type, required, enum, description}}`) | JSON-Schema-shaped parameters (`{type: "object", properties: {...}, required: [...]}`) | This phase (D-02) | New `Tool` type aligns with what every major LLM vendor's tool-calling API already expects natively — removes the need for a per-vendor parameter transform layer in future adapter phases |
| Tool-call result handling assuming exactly one call per turn (current `OpenAIRealtimeProvider.handleToolCall`) | `toolCalls: ToolCall[]` (zero or more) on the completion result | This phase (D-04) | Anthropic and Gemini routinely return multiple tool calls in a single turn (confirmed via official docs, June 2026) — an array-shaped result avoids a second interface redesign when those vendors are adapted in a later phase |
| Vendor-specific correlation field names assumed in core types (none yet exist, but the risk is real per CORE-06) | Single neutral `id: string` field on `ToolCall`, vendor mapping pushed to the adapter layer | This phase (D-05) | Confirmed necessary: OpenAI uses `tool_call_id`, Anthropic uses `tool_use_id`, Gemini reuses `id` on both sides — no single one of these names is "the" correct generic name |

**Deprecated/outdated:** Nothing in this domain is being deprecated by this phase — `RealtimeTool` and `RealtimeProvider` remain fully intact and unmodified per the compatibility constraint; this phase only adds new, parallel types and removes the *duplicated* `ToolExecutor` files (not their behavior).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|-----------------|
| A1 | Anthropic's exact field names (`tool_use`, `id`, `input`, `tool_result`, `tool_use_id`) are current as of June 2026 and not superseded by a newer API version | Architecture Patterns > Pattern 4 | If Anthropic has since renamed fields, the success-criterion-5 sketch's specific field-name claims for Anthropic would need a one-line update — the *neutral `{id, name, args}` design itself* is unaffected since it doesn't encode any vendor's literal field name |
| A2 | Gemini's exact field names (`functionCall`, `functionResponse`, shared `id`) are current as of June 2026 | Architecture Patterns > Pattern 4 | Same as A1 — low risk to the core design, only to the illustrative sketch's prose accuracy |
| A3 | Recommending vitest `^2.0.0` (matching `openai-stt-tts`) rather than the latest registry version (`4.1.9`, confirmed via `npm view`) is the right call for monorepo consistency | Standard Stack | If the planner instead wants the newest vitest, config syntax may differ slightly (vitest 2.x → 4.x config API has had changes) — low risk, easily caught by `tsc`/test-run failure, not a silent bug |

**Resolution note:** A1 and A2 were verified via WebSearch against official-domain sources (`platform.claude.com`, `ai.google.dev`) during this research session, which is the standard verification path for this kind of claim — they are tagged `[CITED]` rather than `[ASSUMED]` in the body text above. They appear in this log only because no non-OpenAI vendor's API is directly testable from inside this codebase (no Anthropic/Gemini SDK or sandbox account available this session) — the planner/discuss-phase should treat the sketch's prose as MEDIUM confidence and welcome a second-source sanity check if available, but should NOT block the phase on this, since the sketch is illustrative documentation, not executable adapter code (no adapter is built until Phase 4+, out of scope here).

## Open Questions (RESOLVED)

1. **Should the legacy `mock.ts` `LLMProvider`/`TTSProvider` be renamed now, or worked around without touching `mock.ts` at all?**
   - What we know: CLEAN-03 (v2 backlog) defers full *reconciliation*, but says nothing about whether a same-milestone naming collision blocking compilation counts as "reconciliation." The two types are genuinely unrelated in shape and purpose.
   - What's unclear: Whether the project owner considers a rename of the legacy type an acceptable "this milestone" touch to `mock.ts`, given mock.ts is nominally "not in scope."
   - Recommendation: Treat the rename as in-scope and necessary (Pitfall 1) — it's the only way to add the new `LLMProvider` without a compile error, and a rename-only change (no behavior change, no consumer logic change) is a much smaller touch than "reconciliation." Flag this explicitly to the user/planner if they want a different resolution (e.g. namespacing).
   - **RESOLVED:** Plan 01-02 Task 1 adopts the rename approach (legacy type renamed, consumers repointed).

2. **Should `VADProvider`/`STTProvider`/`LLMProvider`/`TTSProvider` extend the existing unused `Provider` marker interface (`{name, version?}`) from `providers.ts`?**
   - What we know: CONTEXT.md flags this explicitly as worth checking but leaves it to Claude's discretion; `Provider` is currently dead code (confirmed: no concrete class implements it).
   - What's unclear: Whether giving every pipeline-stage interface a `name`/`version` field has value for Phase 2's orchestrator (e.g. logging which vendor is active) or is premature.
   - Recommendation: Low-risk either way since it's purely additive. Lean toward extending `Provider` — it costs nothing, gives Phase 2's orchestrator a free `name`/`version` for diagnostics, and finally gives the orphaned interface a purpose. Not a blocking decision for Phase 1 completion either way.
   - **RESOLVED:** Plan 01-02 Task 2 has all four interfaces extend `Provider`.

## Validation Architecture

> `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json` — this section is intentionally omitted per the skip condition in this agent's instructions. The planner should still ensure success criterion 3's required unit test is written and passing (see Pitfall 4 above for the Wave-0 test-infrastructure gap), but a full Nyquist-style requirement-to-test traceability map is not required for this phase.

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, defaulting to enabled. This phase has an unusually small security surface — it adds type declarations and a tool-call dispatcher, with no network calls, no auth, no persistence, and no new runtime input from untrusted sources beyond what already exists.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | No auth surface added this phase |
| V3 Session Management | No | No session surface added this phase |
| V4 Access Control | No | No access-control surface added this phase |
| V5 Input Validation | Marginal | `ToolExecutor.execute(name, args)` already wraps the user-supplied `fn(args)` call in try/catch (confirmed in existing code) — `args` is never validated against `Tool.parameters`'s schema at runtime (explicitly out of scope per REQUIREMENTS.md's Zod exclusion); this is an accepted, explicit scope boundary, not an oversight |
| V6 Cryptography | No | Not applicable — no secrets or crypto operations in this phase's surface |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| A registered tool's `execute` function throws an unexpected error and crashes the host pipeline | Denial of Service | Already mitigated in the existing `ToolExecutor.execute()` — wraps every call in try/catch and returns `{success: false, message}` instead of propagating the throw; the promoted version must preserve this behavior unchanged |
| A malicious or buggy tool's `args` contain unexpected types/shapes (no schema validation enforced) | Tampering (of internal data flow, not network) | Explicitly accepted risk this phase — the `Tool.parameters` JSON-Schema shape is descriptive only, not enforced at runtime; any validation is the tool author's own responsibility within their `execute` function body, consistent with the project's explicit "no schema library" constraint |

## Sources

### Primary (HIGH confidence)
- Direct codebase reads this session: `packages/core/src/types/realtime.ts`, `packages/core/src/types/providers.ts`, `packages/core/src/types/mock.ts`, `packages/core/src/types/index.ts`, `packages/providers/openai-stt-tts/src/{ToolExecutor,AudioRecorder,STTClient,ChatClient,TTSPlayer}.ts`, `packages/providers/openai-realtime/src/{ToolExecutor,OpenAIRealtimeProvider}.ts`, `packages/core/package.json`, `packages/providers/openai-stt-tts/{package.json,vitest.config.ts}`, `tsconfig.packages.json`
- `diff` command confirming the two `ToolExecutor.ts` files are byte-for-byte identical
- `npm view vitest version` — confirmed `4.1.9` is current registry latest

### Secondary (MEDIUM confidence)
- [Tool use with Claude - Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) — `tool_use`/`tool_result` block structure, `id`/`tool_use_id` field names
- [Function calling with the Gemini API - Google AI for Developers](https://ai.google.dev/gemini-api/docs/function-calling) — `functionCall`/`functionResponse` structure, shared `id` field, parallel call matching behavior
- [Function calling | OpenAI API](https://developers.openai.com/api/docs/guides/function-calling) — `tool_calls[].id`, multiple-calls-per-response behavior

### Tertiary (LOW confidence)
- None — all WebSearch findings for vendor field-name claims were cross-verified against an official domain (`platform.claude.com`, `ai.google.dev`, `developers.openai.com`) before inclusion in this report.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; vitest version/usage directly confirmed in-repo and via `npm view`
- Architecture: HIGH — every pattern in this report is either a direct lift from confirmed-working code in this repo, or a structural design (D-01 through D-06) already locked by the user in CONTEXT.md
- Pitfalls: HIGH for Pitfalls 1-4 (all derived from direct code/config inspection of this exact repo, not speculation) — MEDIUM for the vendor field-name specifics in Pattern 4 (externally sourced, not independently re-verified via a second tool)

**Research date:** 2026-06-18
**Valid until:** 30 days (stable domain — this phase's content is pure interface design against code already in the repo; only the external vendor API field-name table (Pattern 4) is subject to upstream API drift and should be spot-checked if this research is reused much later than 30 days out)
