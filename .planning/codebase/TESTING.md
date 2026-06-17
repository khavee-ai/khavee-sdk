# Testing Patterns

**Analysis Date:** 2026-06-17

## Test Framework

**Runner:**
- Vitest `^2.0.0`, configured only in a single package: `packages/providers/openai-stt-tts/package.json`. No other package (`core`, `react`, `mock`, `openai-realtime`, `openai-stt-tts` siblings, `pgvector`, `qdrant`, `rag`, `azure`, `openai`) has a test runner, test script, or test files. This is the only tested package in the entire monorepo as of this analysis.
- Config: `packages/providers/openai-stt-tts/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  css: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
    },
  },
});
```

- `environment: "node"` is used even though the code under test exercises browser-only APIs (`fetch`, `FormData`, `Blob`, `File`, `AudioContext`). These globals are stubbed/constructed directly rather than via a DOM environment (see Mocking below) — there is no jsdom/happy-dom dependency.

**Assertion Library:**
- Vitest's built-in `expect` (Chai/Jest-compatible API) — no separate assertion library.

**Run Commands:**
```bash
cd packages/providers/openai-stt-tts
pnpm test                 # runs `vitest` (watch mode by default, per vitest CLI defaults)
pnpm vitest run            # single run, e.g. for CI
pnpm vitest run --coverage # coverage via @vitest/coverage-v8 (devDependency, not wired into a script)
```
There is no root-level `test` or `test:packages` script in the root `package.json` (`/Users/whitemalt/Documents/khavee-sdk/package.json`) — tests must be run from inside the `openai-stt-tts` package directory, or via `pnpm --filter @khaveeai/providers-openai-stt-tts test`. The CI workflow `/.github/workflows/publish.yml` runs `pnpm run test || echo "No tests defined"` at the repo root before publishing, which currently silently no-ops since no root script exists — running the actual vitest suite is not enforced by CI.

## Test File Organization

**Location:**
- Co-located under a `__tests__/` subdirectory of `src/`, one directory per package: `packages/providers/openai-stt-tts/src/__tests__/`.

**Naming:**
- `<SourceFileName>.test.ts` exactly mirroring the class/module under test: `STTClient.test.ts` tests `../STTClient`, `ChatClient.test.ts` tests `../ChatClient`, `OpenAISTTTTSProvider.test.ts` tests `../OpenAISTTTTSProvider`.

**Structure:**
```
packages/providers/openai-stt-tts/
├── src/
│   ├── AudioRecorder.ts
│   ├── ChatClient.ts
│   ├── OpenAISTTTTSProvider.ts
│   ├── STTClient.ts
│   ├── TTSPlayer.ts
│   ├── ToolExecutor.ts
│   ├── index.ts
│   └── __tests__/
│       ├── ChatClient.test.ts
│       ├── OpenAISTTTTSProvider.test.ts
│       └── STTClient.test.ts
└── vitest.config.ts
```
The package's `package.json` `files` array explicitly excludes the compiled test output from the npm tarball: `"!dist/__tests__/**"` (`packages/providers/openai-stt-tts/package.json`) — when adding tests to a new package, replicate this exclusion so test code never ships to consumers.

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STTClient } from "../STTClient";

// ── SDK-04: STTClient.transcribe posts multipart and returns transcript ────────

describe("SDK-04: STTClient.transcribe posts multipart and returns transcript", () => {
  const client = new STTClient();
  const endpoint = "https://api.example.com/api/v1/projects/1/chat/stt";
  const authToken = "test-jwt-token";
  const wavBlob = new Blob(["x"], { type: "audio/wav" });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to the endpoint with Authorization Bearer header and FormData body ...", async () => {
    // arrange mock, act, assert
  });
});
```
(`packages/providers/openai-stt-tts/src/__tests__/STTClient.test.ts:1-86`)

**Patterns:**
- `describe` block titles are prefixed with an internal ticket/spec ID (`SDK-04`, `SDK-05`, `SDK-08`, `SDK-09`) followed by a colon and a plain-English description of the behavior under test — preserve this `"<ID>: <behavior description>"` naming convention when adding new test suites so tests stay traceable to planning artifacts. A `// ── SDK-XX: ... ────` comment banner often precedes the `describe` block restating the same ID.
- `it(...)` descriptions are full sentences describing the exact expected behavior, written so the test name alone documents the contract (e.g. `"throws an Error with the status code when the proxy responds non-2xx"`).
- Setup uses `beforeEach`/`afterEach` at the suite level when a fresh stub is needed per test (`STTClient.test.ts`); simpler suites use a single top-level `afterEach(() => vi.restoreAllMocks())` for the whole file when there is no `beforeEach` requirement (`ChatClient.test.ts:11-13`).
- One test class subclasses the class under test to expose `protected` internals without `any`-casting, documented inline as the intended pattern:
```typescript
/**
 * Test subclass that exposes protected internals for unit testing
 * without requiring type casts to `any`.
 */
class TestableProvider extends OpenAISTTTTSProvider {
  getMessages(): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    return this.messages;
  }
  callTrimHistory(maxTurns?: number): void {
    this.trimHistory(maxTurns);
  }
  callResolveAuthToken(): string {
    return this.resolveAuthToken();
  }
}
```
(`packages/providers/openai-stt-tts/src/__tests__/OpenAISTTTTSProvider.test.ts:9-29`) — use this subclass-exposure pattern instead of `(instance as any).privateMethod()` when a unit test needs access to `protected`/internal state.

## Mocking

**Framework:** Vitest's built-in `vi` (no `jest`, `sinon`, or `msw`).

**Patterns:**
```typescript
// Stub a global (fetch) for the duration of a test
vi.stubGlobal("fetch", vi.fn());
const mockFetch = vi.mocked(fetch);
mockFetch.mockResolvedValueOnce(
  new Response(JSON.stringify({ transcript: "hello world" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
);
// ... assert on mockFetch.mock.calls[0]
```
(`packages/providers/openai-stt-tts/src/__tests__/STTClient.test.ts:13, 21-27, 35-38`)

```typescript
// Inline mock object for a collaborator interface, cast through `unknown` to satisfy the type
const fakeSttClient: STTClient = {
  transcribe: vi.fn()
    .mockResolvedValueOnce("hello turn one")
    .mockResolvedValueOnce("hello turn two"),
} as unknown as STTClient;
```
(`packages/providers/openai-stt-tts/src/__tests__/OpenAISTTTTSProvider.test.ts:107-111`)

- Always call `vi.restoreAllMocks()` in `afterEach` to avoid stub leakage between tests (every test file does this).
- `fetch` is stubbed via `vi.stubGlobal` rather than via a network-mocking library — the codebase has no `msw`/`nock` dependency.
- Collaborators (`AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer`) are injected via the constructor's optional `deps` parameter (`ProviderDeps` in `OpenAISTTTTSProvider`), which exists specifically as a dependency-injection seam for tests — see `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:60-66, 120, 131-136`. New providers that need unit tests should expose the same `deps?` constructor parameter pattern rather than requiring tests to monkey-patch private fields.
- Fake collaborator objects implement only the subset of the interface used by the test, then are cast `as unknown as <Interface>` to silence the TypeScript compiler about missing members — this is the accepted way to build partial fakes in this codebase (seen repeatedly in `OpenAISTTTTSProvider.test.ts`).
- `Response` (the real Fetch API `Response` constructor, available in Node's vitest `environment: "node"`) is used directly to build realistic mock HTTP responses instead of a hand-rolled mock object, in `STTClient.test.ts`. `ChatClient.test.ts` instead uses a plain object literal `{ ok: true, json: async () => mockResponse }` — both styles are present; prefer the real `Response` object when testing header/status parsing logic, and a plain object literal when only `.ok`/`.json()`/`.text()` are consumed.

**What to Mock:**
- The global `fetch` function for any client that talks to a backend proxy (`STTClient`, `ChatClient`).
- Constructor-injected collaborators (`AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer`) when testing `OpenAISTTTTSProvider` orchestration logic, so tests never perform real I/O, real audio capture, or real VAD.

**What NOT to Mock:**
- The class under test itself — `STTClient`, `ChatClient`, and `OpenAISTTTTSProvider` are instantiated for real; only their external dependencies (`fetch`, injected collaborators) are mocked.
- Pure data/transform logic (`trimHistory`, `phonemeToMouthState`, DTW classification helpers) — these are exercised directly through their real implementation, not mocked.

## Fixtures and Factories

**Test Data:**
```typescript
const ENDPOINT = "https://api.example.com/api/v1/chat/completions";
const AUTH_TOKEN = "test-jwt-token";
const MESSAGES = [
  { role: "system" as const, content: "You are a helpful assistant." },
  { role: "user" as const, content: "Hello!" },
];
```
(`packages/providers/openai-stt-tts/src/__tests__/ChatClient.test.ts:4-9`) — shared fixture constants are declared at module scope above the `describe` blocks (not in a separate fixtures file) and reused across multiple `it` blocks in the same test file.

**Location:** No dedicated fixtures/factories directory or file exists; all test data is defined inline at the top of each `*.test.ts` file. There are no factory functions (e.g. `makeProvider()`, `buildMessage()`) — each test constructs the object under test directly in its body or in `describe`-level setup.

## Coverage

**Requirements:** No coverage threshold is enforced (no `coverage.thresholds` block in `vitest.config.ts`, no CI gate checking coverage). `@vitest/coverage-v8` is installed as a devDependency and the v8 provider is configured, but no script runs coverage automatically.

**View Coverage:**
```bash
cd packages/providers/openai-stt-tts
pnpm vitest run --coverage
```

## Test Types

**Unit Tests:** All existing tests are unit tests targeting a single class/module in isolation (`STTClient`, `ChatClient`, `OpenAISTTTTSProvider`) with all I/O and collaborators mocked/stubbed. This is the only test type present in the codebase.

**Integration Tests:** Not used. There are no tests that exercise multiple real (unmocked) packages together, no tests against a real backend, and no database/integration test setup despite `pgvector`/`qdrant`/`drizzle-orm` dependencies existing in the codebase.

**E2E Tests:** Not used. No Playwright/Cypress/Puppeteer dependency exists; the Next.js app under `src/app/**` has no test coverage at all.

## Common Patterns

**Async Testing:**
```typescript
const result = await client.transcribe(wavBlob, endpoint, authToken);
expect(result).toBe("hello world");
```
Standard `async`/`await` test bodies (no `done` callbacks, no `.then()` chains in tests) — every `it` that calls an async method declares the test function `async` and `await`s the call before asserting.

**Error Testing:**
```typescript
await expect(
  client.transcribe(wavBlob, endpoint, authToken),
).rejects.toThrow("400");
```
(`packages/providers/openai-stt-tts/src/__tests__/STTClient.test.ts:66-68`) — error-path tests assert on `.rejects.toThrow("<substring>")` where the substring is the HTTP status code embedded in the thrown `Error`'s message, matching the `Error` message format documented in CONVENTIONS.md's Error Handling section.

**Synchronous side-effect testing:**
```typescript
// interrupt() must be synchronous — no await
provider.interrupt();
expect(cancelSpy).toHaveBeenCalledTimes(1);
expect(provider.chatStatus).toBe("ready");
```
(`packages/providers/openai-stt-tts/src/__tests__/OpenAISTTTTSProvider.test.ts:179-185`) — used to lock in timing guarantees (e.g. that a status reset happens within the same tick/frame, with no `await` in between) that would otherwise regress silently.

---

*Testing analysis: 2026-06-17*
