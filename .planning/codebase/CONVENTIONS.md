# Coding Conventions

**Analysis Date:** 2026-06-17

## Naming Patterns

**Files:**
- Provider/client classes use PascalCase matching the exported class: `packages/providers/openai-stt-tts/src/STTClient.ts`, `packages/providers/openai-stt-tts/src/ChatClient.ts`, `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`, `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`.
- React hooks use camelCase with `use` prefix matching the export: `packages/react/src/hooks/useRealtime.ts`, `packages/react/src/hooks/useAudioLipSync.ts`.
- React components use PascalCase: `packages/react/src/VRMAvatar.tsx`, `packages/react/src/GLBAvatar.tsx`, `packages/react/src/KhaveeProvider.tsx`.
- Type-only modules live under a `types/` directory and are named by domain: `packages/core/src/types/realtime.ts`, `packages/core/src/types/audio.ts`, `packages/core/src/types/conversation.ts`, `packages/core/src/types/providers.ts`, `packages/core/src/types/project.ts`, `packages/core/src/types/qdrant.ts`, `packages/core/src/types/mock.ts`.
- Barrel files are always `index.ts` and re-export the package's public surface: `packages/core/src/index.ts`, `packages/react/src/index.ts`, `packages/providers/*/src/index.ts`.
- Test files are colocated under `__tests__/` next to the source they cover and named `<SourceClass>.test.ts`: `packages/providers/openai-stt-tts/src/__tests__/STTClient.test.ts`.

**Functions:**
- camelCase for all functions and methods: `setChatStatus`, `trimHistory`, `resolveAuthToken`, `runTurnFromText` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`).
- Event handler fields use an `on<Event>` naming pattern and are optional (`?`) callback properties: `onConnect?`, `onChatStatusChange?`, `onUsageReport?`, `onAudioData?` (`packages/core/src/types/realtime.ts`).
- Boolean-returning toggles are named `toggle<Thing>()` / `is<Thing>()` / `enable<Thing>()` / `disable<Thing>()`: `toggleMicrophone()`, `isMicrophoneEnabled()`, `enableMicrophone()`, `disableMicrophone()`.
- Private helper methods that mutate internal state are prefixed with verbs (`set`, `trim`, `resolve`, `update`, `clear`): `setChatStatus`, `trimHistory`, `resolveAuthToken`, `updateEphemeralUserMessage`, `clearEphemeralUserMessage` (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`).

**Variables:**
- camelCase throughout; boolean flags prefixed with `is`/`has`: `isConnected`, `isTurnActive` (as `_isTurnActive`), `hasHeardFirstGreeting`, `micEnabled`.
- Internal/private flags that back a public toggle or guard against re-entrancy use a leading underscore: `_isTurnActive` in `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:92`.
- Constants for lookups/templates use camelCase (not SCREAMING_SNAKE_CASE), e.g. `phonemeTemplates`, `phonemeBoosts`, `minMovement` in `packages/react/src/hooks/useAudioLipSync.ts`. Module-level test fixtures use SCREAMING_SNAKE_CASE, e.g. `ENDPOINT`, `AUTH_TOKEN`, `MESSAGES` in `packages/providers/openai-stt-tts/src/__tests__/ChatClient.test.ts`.

**Types:**
- Interfaces use PascalCase without an `I` prefix: `RealtimeProvider`, `RealtimeConfig`, `RealtimeTool`, `RealtimeEvents` (`packages/core/src/types/realtime.ts`).
- Type aliases for plain object shapes also use PascalCase: `ChatMessage`, `ChatUsage`, `ChatResult`, `ProxyResponseFlat` (`packages/providers/openai-stt-tts/src/ChatClient.ts`).
- Discriminated/union string literals are inlined rather than enums: `role: "system" | "user" | "assistant"`, `voice?: "alloy" | "ash" | "ballad" | ... ` (`packages/core/src/types/realtime.ts`).
- Config types extend a base interface by name pattern `<Provider>Config extends RealtimeConfig`: `OpenAISTTTTSConfig extends RealtimeConfig` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:29`).

## Code Style

**Formatting:**
- No Prettier config detected (`.prettierrc*` absent). Formatting is enforced only by ESLint + TypeScript strictness; indentation is consistently 2 spaces and double quotes are used for string literals in newer provider code (`packages/providers/openai-stt-tts/src/*.ts`), while some older app/hook code mixes single quotes (`packages/providers/mock/src/index.ts`).
- Semicolons are used consistently.
- Trailing commas appear in multi-line function calls/object literals in newer files (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`).

**Linting:**
- ESLint flat config at `eslint.config.mjs` extends `next/core-web-vitals` and `next/typescript` via `FlatCompat`. No custom rule overrides beyond `ignores` for `node_modules`, `.next`, `out`, `build`, `next-env.d.ts`.
- Workspace packages under `packages/*` do not have their own eslint config; only the root `eslint.config.mjs` applies, and it is Next.js-oriented (primarily lints `src/app/**`). Treat ESLint as best-effort for SDK packages, not authoritative.
- TypeScript `strict: true` is set in both `tsconfig.json` (Next app) and `tsconfig.packages.json` (SDK packages) — write strict-mode-safe code (no implicit `any`, exhaustive null checks) even though some legacy files (`OpenAIRealtimeProvider.ts`, `useAudioLipSync.ts`) still use explicit `any` for OpenAI/Meyda payloads.

## Import Organization

**Order:**
1. External package imports first (`@khaveeai/core`, `react`, `uuid`, `meyda`).
2. Relative sibling imports next (`./ToolExecutor`, `./AudioRecorder`, `../KhaveeProvider`, `../VRMAvatar`).
3. Type-only imports use explicit `import type { ... }` when the import is types-only, e.g. `import type { ChatStatus, Conversation, RealtimeTool, PhonemeData, MouthState } from "@khaveeai/core";` (`packages/react/src/hooks/useRealtime.ts:2`).

**Path Aliases:**
- The Next.js app (`src/app/**`) uses `@/*` mapped to `./src/*` (`tsconfig.json`).
- SDK packages reference each other via published-style workspace package names (`@khaveeai/core`, `@khaveeai/react`, `@khaveeai/providers-*`), resolved through `tsconfig.json`'s `paths` map during development and through `workspace:*` / semver ranges in each package's `package.json` for build/publish.
- Packages never import across sibling packages via relative `../../` paths — always via the `@khaveeai/*` package name, even within the monorepo.

## Error Handling

**Patterns:**
- Async lifecycle methods (`connect`, `disconnect`, `runTurn`, `runTurnFromText`) wrap their body in `try { ... } catch (error) { this.onError?.(error instanceof Error ? error : new Error(String(error))); ... }` — always normalize unknown `catch` values to `Error` before passing to `onError` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:281-285`, `:375-380`, `:476-482`).
- Older provider code (`OpenAIRealtimeProvider.ts`) instead casts directly: `this.onError?.(error as Error);` — prefer the `instanceof Error` normalization pattern used in the newer `openai-stt-tts` provider for new code.
- Network/proxy client methods (`STTClient.transcribe`, `ChatClient.complete`) throw plain `Error` objects with the HTTP status code embedded in the message: `throw new Error(\`STT proxy error: ${res.status} ${body}\`)` (`packages/providers/openai-stt-tts/src/STTClient.ts:61`), `throw new Error(\`Chat proxy error: ${res.status} ${body}\`)` (`packages/providers/openai-stt-tts/src/ChatClient.ts:81`). Tests assert on this via `.rejects.toThrow("<status>")`.
- Errors are surfaced to consumers exclusively through the optional `onError?: (error: Error) => void` event callback on `RealtimeProvider` — methods do not generally reject/throw past their own boundary for foreseeable runtime failures (mic permission, network); they catch, notify `onError`, and reset state to a safe status (usually `"ready"` or `"stopped"`).
- Defensive guards return early instead of throwing for "should never happen but is not fatal" conditions, e.g. `disableMicrophone()`/`enableMicrophone()` log a `console.warn` and return when `audioStream` is null instead of throwing (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:634-637`).
- Resource cleanup (`AudioContext.close()`) always checks `state !== "closed"` first to avoid throwing on a double-close (documented inline as "RESEARCH Pitfall 1"): `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:311`.

## Logging

**Framework:** Plain `console.*` — no logging library/wrapper.

**Patterns:**
- `console.error` for caught exceptions that are also forwarded via `onError`: `console.error("Tool execution error:", error);` (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:602`).
- `console.warn` for non-fatal/expected-absence conditions (no audio stream, Meyda unavailable): `console.warn("No audio stream available - microphone cannot be toggled");`.
- `console.log` is used liberally in mock/demo code and lip-sync analyzers for development visibility, often with emoji prefixes for readability: `console.log(\`🔊 [Mock TTS] Speaking with ${voice}:\`)` (`packages/providers/mock/src/index.ts:56`), `console.error("❌ OpenAI Error:", msg);` (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:450`). New provider code (`openai-stt-tts`) avoids decorative logging — prefer plain, undecorated log messages for production-facing packages and reserve emoji-style logs for mock/demo-only code.
- No structured logging, log levels, or remote log shipping exist anywhere in the SDK packages.

## Comments

**When to Comment:**
- File-header block comments explain the module's role and any non-obvious security/lifecycle constraints, e.g. the header in `packages/providers/openai-stt-tts/src/STTClient.ts:1-16` documents why Content-Type is not set manually and why the filename must be `"utterance.wav"`.
- Inline comments call out "pitfalls" with explicit research traceability tags like `(RESEARCH Pitfall 1)`, `(T-03-08)`, `(SDK-08)` — these reference internal planning/ticket IDs and should be preserved or extended consistently when modifying that code (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:230-244, 311, 335`).
- Section-divider comments (`// ── Section Name ──...`) are used to group class members into logical blocks (state, public interface, event handlers, lifecycle, private helpers) in larger classes: `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:69, 94, 101, 118, 149, 222, 349`. Follow this divider style when adding new sections to large provider classes.
- Comments explain *why*, not *what*, for any non-obvious ordering/timing decision (e.g. why `disconnect()` checks `audioContext.state !== "closed"`, why VAD resume happens before `_isTurnActive` is cleared).

**JSDoc/TSDoc:**
- Public class methods and exported functions/types on `@khaveeai/core` and SDK provider classes use `/** ... */` JSDoc blocks with `@param`/`@returns`/`@throws` tags for non-trivial methods: `packages/providers/openai-stt-tts/src/STTClient.ts:24-34`.
- Interface/type fields use single-line `/** ... */` doc comments directly above the field to document units, defaults, and constraints: `/** Duration of silence (ms) before ending a speech turn. Default: 1500 */` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:40`).
- Simpler/legacy code (mock provider, lip-sync hooks) often omits JSDoc in favor of short `//` comments — JSDoc density correlates with how recently/carefully the code was written; new public SDK surface should have full JSDoc.

## Function Design

**Size:** Methods are generally kept under ~60 lines; large orchestration methods like `runTurnFromText` (~95 lines) and `handleDataChannelMessage` (a `switch` over message types, ~90 lines) are the largest, and are split into smaller `private` helper methods (`finalizeLastAssistantMessage`, `handleAssistantTranscript`, `handleToolCall`) for distinct steps.

**Parameters:** Methods with more than 2-3 parameters use a single options object instead of positional args, e.g. `ChatClient.complete(args: CompleteArgs)` taking `{ messages, endpoint, authToken, model, temperature }` (`packages/providers/openai-stt-tts/src/ChatClient.ts:52-58`) rather than 5 positional parameters. Exception: low-arity, well-ordered helpers keep positional params, e.g. `STTClient.transcribe(wavBlob, endpoint, authToken, language?)`.

**Return Values:** Async methods that perform side effects and don't need a result return `Promise<void>` (`connect`, `disconnect`, `sendMessage`). Methods returning data return a typed object/string directly rather than a wrapped `{ success, data }` envelope, e.g. `transcribe(): Promise<string>`, `complete(): Promise<ChatResult>`. Boolean toggles return the new resulting state synchronously: `toggleMicrophone(): boolean`.

## Module Design

**Exports:** Each package's `src/index.ts` is the only file that should be imported by consumers; internal helper classes are explicitly NOT re-exported and this is documented in their file header, e.g. `STTClient` and `ChatClient` in `openai-stt-tts` are "internal — NOT exported from index.ts" (`packages/providers/openai-stt-tts/src/STTClient.ts:4`, `packages/providers/openai-stt-tts/src/ChatClient.ts:2`). When adding new internal helpers to a provider package, do not add them to `src/index.ts` unless they are meant to be part of the public API.

**Barrel Files:** Every package and the `core` types directory use a flat `export * from "./module"` or named re-export barrel at `index.ts`. `packages/core/src/types/index.ts` re-exports all type modules with `export * from './realtime'` etc. `packages/react/src/index.ts` mixes named re-exports (`export { KhaveeProvider, useKhavee } from "./KhaveeProvider";`) with a wildcard re-export of hooks (`export * from "./hooks";`) — follow this same mixed pattern: export top-level components/providers by name, but barrel entire subdirectories (like `hooks/`) with `export *`.

---

*Convention analysis: 2026-06-17*
