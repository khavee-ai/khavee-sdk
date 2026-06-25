---
phase: 08-frontend-bundle-shortcode-block
reviewed: 2026-06-25T15:56:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - packages/providers/openai-realtime/vitest.config.ts
  - packages/providers/openai-realtime/postcss.config.mjs
  - packages/providers/openai-realtime/src/__tests__/OpenAIRealtimeProvider.proxy.test.ts
  - packages/providers/openai-realtime/package.json
  - packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-06-25T15:56:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This is a narrow gap-closure fix: `connect()`'s inline proxy `sessionConfig` object literal was extracted into a new private `buildProxySessionConfig()` method, and the `temperature` field was deleted from that object because OpenAI's real `/v1/realtime/client_secrets` endpoint rejects it with a 400. I diffed this change against the prior commit (`3a522de`) and confirmed the extraction is a pure refactor plus the single intentional deletion — no other behavior in `connect()`, the direct (non-proxy) path, `configureSession()`, or the demo app's `src/app/api/negotiate/route.ts` (which only relays raw SDP for the direct path and never touches `sessionConfig`) was touched. `tsc --noEmit` is clean and the new regression test suite (4 tests) passes.

The fix itself is correct and narrowly scoped. The issues below are about what the fix left behind: `temperature` is now silently dead configuration on the proxy path with no signal to API consumers, and the extracted builder method is untyped (`any`), which weakens the type safety the refactor could have added for free. Neither blocks shipping, but both should be addressed before this drifts further.

## Warnings

### WR-01: `temperature` config is now silently swallowed on the proxy path with no consumer-facing signal

**File:** `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:73-80, 331-357`
**Issue:** `RealtimeConfig.temperature` (`packages/core/src/types/realtime.ts:42`) remains a public, documented constructor option, and the constructor still applies a default of `0.8` to `this.config.temperature` (line 77). However, `buildProxySessionConfig()` now never reads `this.config.temperature` at all — it is entirely absent from the object it returns. A developer who passes `{ temperature: 0.3, useProxy: true, proxyEndpoint: ... }` will have that value silently ignored with zero indication (no warning, no doc note, no error) that temperature control does not work in proxy mode. This is exactly the kind of "looks configurable, isn't" trap that produces confusing support requests. The comment at lines 337-339 explains *why* it was removed but only to someone reading the source — not to an SDK consumer.
**Fix:** Add a one-line `console.warn` (consistent with this file's existing `console.warn` pattern for non-fatal/expected-absence conditions, e.g. line 648) when `useProxy` is true and `config.temperature` was explicitly set by the caller, e.g.:
```ts
private buildProxySessionConfig(): any {
  if (this.config.temperature !== undefined && this.config.temperature !== 0.8) {
    console.warn(
      "OpenAIRealtimeProvider: `temperature` is not supported when useProxy is true " +
        "(OpenAI's /v1/realtime/client_secrets endpoint rejects session.temperature) — ignoring.",
    );
  }
  const sessionConfig: any = {
    ...
```
Alternatively (cleaner long-term), mark `temperature` as `@deprecated` in `RealtimeConfig` for proxy usage via a JSDoc comment, per this file's documented convention of single-line `/** ... */` doc comments above interface fields noting constraints.

### WR-02: `buildProxySessionConfig()` return type is `any`, discarding type safety the extraction could have provided

**File:** `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:331`
**Issue:** The method signature is `private buildProxySessionConfig(): any`. Per CLAUDE.md's Code Style section, `strict: true` is set project-wide and "write strict-mode-safe code (no implicit `any`, exhaustive null checks) even though some legacy files... still use explicit `any`." This is new code (not legacy), introduced specifically to be "independently testable" — extracting it into its own method was the ideal moment to give it a concrete return type, but instead it inherited the inline object literal's loose `any` typing wholesale. Because the regression test (`OpenAIRealtimeProvider.proxy.test.ts`) only asserts on a handful of fields via runtime property checks (`hasOwnProperty`, `JSON.stringify`), a future edit that silently reintroduces `temperature` (or any other invalid field) into this object would not be caught by the type system — only by the existing runtime test, which is the single line of defense against this regression recurring.
**Fix:** Define a local `ProxySessionConfig` type (or add it under `@khaveeai/core` if reused) that explicitly omits `temperature`, and have the method return that type instead of `any`:
```ts
type ProxySessionConfig = {
  type: "realtime";
  model: string;
  instructions: string;
  output_modalities: ["audio"];
  audio: {
    input: { transcription: { model: string; language: string } };
    output: { format: { type: "audio/pcm"; rate: 24000 }; voice: string; speed: number };
  };
  tools?: Array<{ type: "function"; name: string; description: string; parameters: any }>;
};

private buildProxySessionConfig(): ProxySessionConfig {
  const sessionConfig: ProxySessionConfig = { ... };
  ...
  return sessionConfig;
}
```

## Info

### IN-01: Inconsistent model-fallback literal duplicated across two call sites (pre-existing, untouched by this fix)

**File:** `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:74-80, 178-180, 334`
**Issue:** The constructor default for `config.model` is `"gpt-4o-realtime-preview"` (line 75), but both the direct-path `callsEndpoint` URL fallback (line 179) and `buildProxySessionConfig()`'s `model` fallback (line 334) independently fall back to a different literal, `"gpt-realtime-1.5"`, if `config.model` is falsy. Since the constructor always assigns a default via `{ model: "gpt-4o-realtime-preview", ...config }`, `config.model` can only be falsy if a caller explicitly passes `model: ""` or `model: undefined` after construction — an edge case, but the two different magic-string fallbacks (one in the constructor, two duplicated elsewhere) are a maintenance hazard if either model name changes. This predates the 08-05 fix (confirmed via `git show 3a522de`, both occurrences existed beforehand) and isn't a regression, but the new test (`OpenAIRealtimeProvider.proxy.test.ts:49-61`) directly exercises this fallback and reinforces it as load-bearing rather than flagging it for cleanup.
**Fix:** Not required for this fix, but consider hoisting `"gpt-realtime-1.5"` (or whichever is canonical) into a single module-level constant, e.g. `const DEFAULT_REALTIME_MODEL = "gpt-realtime-1.5";`, referenced by both the constructor default and both fallback sites, to remove the duplication and ambiguity about which is the "real" default.

### IN-02: Explanatory comment for the temperature removal is detached from any code it annotates

**File:** `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:336-339`
**Issue:** The comment block explaining why `temperature` was removed sits between the `instructions` and `output_modalities` properties, annotating the *absence* of a field rather than any present line. This is fine for someone reading top-to-bottom once, but a future contributor who reorders properties (e.g. an auto-formatter or another refactor) could easily relocate or strip this comment without realizing it documents a load-bearing omission, since there's no code construct it's anchored to.
**Fix:** Consider moving the explanation to the method-level JSDoc (lines 326-330) where it would survive property reordering, e.g. appending: `"Note: `temperature` is intentionally omitted — OpenAI's /v1/realtime/client_secrets schema rejects session.temperature with a 400."` This keeps the constraint visible regardless of how the object literal's internals are edited later.

---

_Reviewed: 2026-06-25T15:56:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
