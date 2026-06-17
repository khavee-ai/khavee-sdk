---
phase: 01-core-interfaces-tool-calling
reviewed: 2026-06-18T01:30:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - packages/core/package.json
  - packages/core/src/__tests__/ToolExecutor.test.ts
  - packages/core/src/types/index.ts
  - packages/core/src/types/mock.ts
  - packages/core/src/types/pipeline.ts
  - packages/core/src/types/tools.ts
  - packages/core/tsconfig.json
  - packages/core/vitest.config.ts
  - packages/providers/mock/src/index.ts
  - packages/providers/openai-realtime/package.json
  - packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts
  - packages/providers/openai-realtime/src/index.ts
  - packages/providers/openai-stt-tts/package.json
  - packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts
  - packages/providers/openai-stt-tts/src/index.ts
  - packages/providers/openai/src/index.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-18T01:30:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Reviewed the promotion of `ToolExecutor` into `@khaveeai/core`, the new vendor-neutral `Tool`/`ToolResult`/`ExecutableTool` types and `VADProvider`/`STTProvider`/`LLMProvider`/`TTSProvider` pipeline interfaces, the `LegacyLLMProvider`/`LegacyTTSProvider` rename in `mock.ts`, and the deletion of the duplicated local `ToolExecutor.ts` files in `openai-stt-tts` and `openai-realtime` with import repointing to `@khaveeai/core`.

Verified by actually building each touched package (`@khaveeai/core`, `@khaveeai/providers-openai-realtime`, `@khaveeai/providers-openai-stt-tts`, `@khaveeai/providers-mock`, `@khaveeai/providers-openai`) with `tsc` and running `@khaveeai/core`'s vitest suite — all builds are clean and all 4 `ToolExecutor` unit tests pass. The rename of `LLMProvider`/`TTSProvider` to `LegacyLLMProvider`/`LegacyTTSProvider` in `mock.ts` is applied consistently everywhere it's consumed (`packages/providers/mock`, `packages/providers/openai`); no stale references to the old names remain. The deleted `ToolExecutor.ts` files left no dangling imports in either provider package.

The main substantive issues found are (1) an unflagged breaking change — `ToolExecutor` was previously a public export of both `@khaveeai/providers-openai-realtime` and `@khaveeai/providers-openai-stt-tts`, and this phase silently drops it from their public surface with no semver-major bump or compatibility re-export, and (2) the new `Tool.parameters` JSON-Schema shape (`required?: string[]` at the schema level) is incompatible with the older `RealtimeTool.parameters` shape (`required?: boolean` per-property) that the rest of the codebase still uses — these two "tool definition" shapes look interchangeable by name but are not structurally compatible, which will bite the first adapter author who tries to convert one into the other in a later phase.

## Warnings

### WR-01: `ToolExecutor` silently removed from provider packages' public API without a compatibility shim or major version bump

**File:** `packages/providers/openai-realtime/src/index.ts:1-2`, `packages/providers/openai-stt-tts/src/index.ts:1-3`
**Issue:** Prior to this phase, both packages re-exported their (now-deleted) local `ToolExecutor` class:
```ts
// openai-realtime/src/index.ts (before)
export { OpenAIRealtimeProvider } from './OpenAIRealtimeProvider';
export { ToolExecutor } from './ToolExecutor';
```
This phase deletes the local `ToolExecutor.ts` and removes the re-export line entirely, with no replacement re-export pointing at `@khaveeai/core`'s `ToolExecutor`. Any external consumer who previously did:
```ts
import { ToolExecutor } from '@khaveeai/providers-openai-realtime';
```
will now get a build error (`has no exported member 'ToolExecutor'`) after upgrading. `package.json` versions were bumped/left as patch-level changes (`0.3.13`, `0.1.4`) — neither indicates a breaking change per semver, and the published `package.json` "files"/"exports" fields give no signal that this is intentional. Since these packages are published to npm (per `.github/workflows/publish.yml`) and `publishConfig.access: public`, this is a real compatibility break for any downstream consumer, not just an internal refactor detail.
**Fix:** Either re-export `ToolExecutor` from `@khaveeai/core` in both packages' `index.ts` for one deprecation cycle:
```ts
export { ToolExecutor } from '@khaveeai/core'; // deprecated: import from @khaveeai/core directly
```
or bump both packages to the next minor/major version and call out the removal explicitly in release notes/CHANGELOG.

### WR-02: New `Tool.parameters` schema shape is structurally incompatible with `RealtimeTool.parameters`, despite both being "tool definitions" in the same codebase

**File:** `packages/core/src/types/tools.ts:32-43`, `packages/core/src/types/realtime.ts:10-17`
**Issue:** `RealtimeTool.parameters` (still used by `OpenAIRealtimeProvider`/`OpenAISTTTTSProvider` today) puts `required?: boolean` on each individual property:
```ts
parameters: {
  [key: string]: {
    type: "string" | "number" | "boolean" | "array" | "object";
    required?: boolean;
    enum?: string[];
    description?: string;
  };
};
```
The new `Tool.parameters` (intended as the vendor-neutral replacement, per CORE-03) instead nests properties under a `properties` key and uses real JSON-Schema-style top-level `required?: string[]`:
```ts
parameters: {
  type: "object";
  properties: Record<string, { type: ...; description?: string; enum?: string[] }>;
  required?: string[];
};
```
These are two different object shapes with the same field name (`parameters`) and superficially similar purpose, but a `RealtimeTool` cannot be assigned to `Tool` or vice versa — `tsc` would reject it. Both `OpenAIRealtimeProvider.configureSession()` and `OpenAISTTTTSProvider`'s tool-registration path build OpenAI's wire format by iterating `Object.entries(tool.parameters)` and stripping a per-property `required` flag (lines 172-178 and 393-404 of `OpenAIRealtimeProvider.ts` respectively) — that conversion logic only works for the old `RealtimeTool` shape, not the new `Tool` shape. Nothing in this phase converts between the two, so the `Tool` type is currently a parallel, unconnected definition that the next phase (LLMProvider implementations) will have to reconcile, likely by either (a) migrating `RealtimeTool` to match `Tool`'s shape, or (b) writing an adapter function. This is not flagged anywhere as an open question in the new file's doc comments.
**Fix:** Add an explicit doc-comment note in `tools.ts` (or `pipeline.ts`) calling out that `Tool.parameters` and `RealtimeTool.parameters` are intentionally different shapes and that an adapter is required when bridging the two, so the next phase doesn't assume drop-in compatibility. Alternatively, provide a small conversion helper (`toolToRealtimeTool(tool: Tool): RealtimeTool`) now, while the shape difference is fresh context.

### WR-03: `ToolResult` duplicated as a nominally separate type from `RealtimeTool.execute`'s inline return shape, with no shared source of truth

**File:** `packages/core/src/types/tools.ts:18-21`
**Issue:** The doc comment at `tools.ts:12-16` explicitly acknowledges this is "a deliberate duplication" of `RealtimeTool.execute`'s inline return type (`{success: boolean; message: string}` in `realtime.ts:18-21`). Both shapes are structurally identical today, so `tsc` doesn't complain, but there are now two independent definitions of the same `{success, message}` contract that must be kept in sync by hand. If either evolves independently (e.g. a future phase adds an optional `data` field to one but not the other), call sites that currently work by structural-typing coincidence will silently start failing only in one direction, and the mismatch will not be obvious from either file in isolation.
**Fix:** Consider having `RealtimeTool.execute` reference `ToolResult` directly once `tools.ts` exists (e.g. `execute: (args: any) => Promise<ToolResult>` in `realtime.ts`, importing from `./tools`), collapsing the duplication now rather than carrying two copies of the same contract forward.

## Info

### IN-01: `KhaveeConfig.tools` still typed as `any[]` despite the new `Tool` type now being available

**File:** `packages/core/src/types/mock.ts:15`
**Issue:** `KhaveeConfig.tools?: any[]` predates this phase and was not touched by the rename, but now that `packages/core/src/types/tools.ts` exports a proper `Tool` type, this field is a missed opportunity to tighten typing in the same package during a phase explicitly about "vendor-neutral tool types."
**Fix:** Not required for this phase's stated scope (legacy `KhaveeConfig`/`LegacyLLMProvider` path is called out elsewhere as dead weight to be retired), but worth a follow-up: `tools?: Tool[]`.

### IN-02: `ToolExecutor.test.ts` error-path test produces noisy `console.error` stderr output

**File:** `packages/core/src/__tests__/ToolExecutor.test.ts:25-37`
**Issue:** The "normalizes a thrown error" test triggers `ToolExecutor.execute`'s internal `console.error(...)` call (preserved byte-for-byte from the original implementation per the migration plan), which prints a full stack trace to stderr during `vitest run`. This is intentional/expected behavior of the executor, not a bug, but it adds visual noise to CI test output and could mask a real failure in adjacent tests if not mentally filtered out.
**Fix:** Optional: wrap this specific test with `vi.spyOn(console, "error").mockImplementation(() => {})` to keep CI output clean, while still allowing assertions on the call if desired.

### IN-03: `pipeline.ts`'s extensive vendor-mapping doc comment (lines 12-47) is unverifiable against any actual adapter implementation in this phase

**File:** `packages/core/src/types/pipeline.ts:12-47`
**Issue:** The file-header comment asserts detailed, specific claims about Anthropic's and Gemini's tool-calling wire formats (field names like `tool_use`, `functionCall`, `toolu_01...`) to justify the `ToolCall.id`/`args` design. No adapter for either vendor exists in this codebase yet, so these claims are unverifiable from the code itself and could go stale or be inaccurate without anyone noticing (no compile-time or test-time check ties the comment to a real implementation).
**Fix:** No action required now — flagging only so a future phase that implements an Anthropic/Gemini adapter cross-checks these claims against the real API docs rather than trusting the comment as ground truth.

---

_Reviewed: 2026-06-18T01:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
