<!-- GSD:project-start source:PROJECT.md -->
## Project

**Khavee Generic Voice Pipeline**

khavee-sdk currently ships an `openai-stt-tts` provider that hardcodes the STT → LLM → TTS voice pipeline to OpenAI's APIs. This project adds a new `generic-stt-tts` provider package that decomposes the pipeline into swappable interfaces (VAD, STT, LLM/completion with tool-calling, TTS) — pipecat-style — so any vendor can be plugged into any stage. Two new lightweight backend services (Thonburian Whisper STT, JaiTTS voice-cloning TTS) are built to prove the abstraction end-to-end with real non-OpenAI vendors.

**Core Value:** A developer can assemble a full voice pipeline (STT + LLM + TTS, with tool-calling) from independently swappable vendor adapters — without being locked into OpenAI for every stage.

### Constraints

- **Compatibility**: Must not break the existing `openai-stt-tts` provider or its consumers — it stays as-is, untouched, this milestone
- **Language boundary**: `thonburian-stt` and `jai-tts` are Python ML services; khavee-sdk is TypeScript — integration is over HTTP, not in-process bindings
- **Beginner DX**: Tool-calling API must be usable by a beginner with no extra schema library — plain JS objects only
- **Vendor neutrality**: Core interfaces (STTProvider, TTSProvider, VADProvider, LLMProvider) must be vendor-agnostic enough to support future Bedrock/Gemini adapters without redesign, even though those adapters aren't built now
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.x - All packages (`packages/core`, `packages/react`, `packages/providers/*`) and the Next.js demo app (`apps/playground/src/app`)
- PHP - Scaffolded but empty WordPress plugin (`wordpress-plugin/includes`, `wordpress-plugin/src` contain no files yet)
- SQL - Raw SQL embedded in `packages/providers/pgvector/src/PgVectorProvider.ts` (DDL for pgvector schema/HNSW index)
## Runtime
- Node.js v23.5.0 observed in dev environment (no `.nvmrc`/`.node-version` pinned in repo; CI (`.github/workflows/publish.yml`) uses Node 18)
- Browser runtime required for SDK packages (`@khaveeai/core`, `@khaveeai/react`, realtime/STT-TTS providers use `navigator.mediaDevices`, `RTCPeerConnection`, `AudioContext`, WebGL via three.js)
- pnpm 10.12.1 (observed), workspace-driven monorepo
- Lockfile: present — `pnpm-lock.yaml` (lockfileVersion 9.0)
- Workspaces declared in `pnpm-workspace.yaml`: `apps/*`, `packages/core`, `packages/react`, `packages/providers/*`
## Frameworks
- Next.js 15.5.3 (App Router, Turbopack) - demo/playground app at `apps/playground`, entry `apps/playground/src/app/`
- React 19.1.0 / React DOM 19.1.0 - UI layer for demo app and `@khaveeai/react` package
- Three.js ^0.180.0 + `@pixiv/three-vrm` ^3.4.2 - 3D rendering and VRM avatar model loading
- `@react-three/fiber` ^9.3.0, `@react-three/drei` ^10.7.6, `@react-three/postprocessing` ^3.0.4 - React bindings/helpers for three.js scenes (`apps/playground/src/app/components/Experience.tsx`, `apps/playground/src/app/components/VRMAvatarRef.tsx`)
- Tailwind CSS ^4 (via `@tailwindcss/postcss`) - styling for demo app, configured in `postcss.config.mjs`
- Vitest ^2.0.0 + `@vitest/coverage-v8` - `packages/providers/openai-stt-tts` (`src/__tests__/*.test.ts`)
- Jest ^29.0.0 - `packages/providers/qdrant` (configured via `package.json` script `"test": "jest"`, no committed jest.config found)
- No test framework configured at repo root or in `packages/core`, `packages/react`, `packages/providers/{mock,openai,openai-realtime,pgvector,rag}`
- TypeScript compiler (`tsc`) - build tool for `packages/core`, `packages/react`, and most providers (`"build": "tsc"` in each package.json)
- tsup ^8.0.0 - build tool for `packages/providers/qdrant` only (dual ESM/CJS + `.d.ts` output)
- Turbopack - Next.js dev/build acceleration (`next dev --turbopack`, `next build --turbopack` in `apps/playground/package.json`; the root delegates via `pnpm --filter`)
- ESLint 9 (flat config) - `apps/playground/eslint.config.mjs`, extends `next/core-web-vitals` and `next/typescript` via `FlatCompat`
- drizzle-kit ^0.31.9 - present as a devDependency at repo root but **no `drizzle.config.ts` or drizzle schema/migrations found** — appears to be an unused/leftover dependency
## Key Dependencies
- `openai` (root ^6.24.0; providers use ^4.x — see version note below) - OpenAI SDK client for embeddings, chat completions, Whisper STT, TTS, and Realtime API token/session handling
- `@pixiv/three-vrm` ^3.4.2 - VRM avatar model parsing, expression/bone manipulation, lip-sync driving
- `three` ^0.180.0 - Core 3D engine underlying all avatar rendering
- `meyda` ^5.6.3 - Audio feature extraction (used for lip-sync/volume analysis in `packages/react` and root app)
- `@ricky0123/vad-web` ^0.0.30 (+ `onnxruntime-web` 1.26.0 transitively) - Browser-side voice activity detection for the STT/TTS pipeline provider (`packages/providers/openai-stt-tts/src/AudioRecorder.ts`)
- `uuid` ^13.0.0 - Session/message ID generation in `packages/providers/openai-realtime`
- `pg` ^8.18.0 - PostgreSQL client used by `packages/providers/pgvector`
- `pgvector` ^0.2.1 - Node helper types/utilities for pgvector at root (actual SQL vector extension calls are raw SQL in `PgVectorProvider.ts`)
- `@qdrant/js-client-rest` ^1.9–1.11 - Qdrant vector DB REST client used by `packages/providers/qdrant` and `packages/providers/rag`
- `axios` ^1.12.2 - HTTP client used in `packages/core/src/client/khavee-client.ts` for calling the hosted Khavee platform API
- `csv-parse` ^6.1.0 - CSV bulk-import parsing for pgvector document ingestion (`apps/playground/src/app/pgvector/actions.ts` flow)
- `drizzle-orm` ^0.45.1 - Declared at root but **not imported anywhere in source** (`grep` for `drizzle` in `src/` and `packages/` returns no hits) — dead/unused dependency, candidate for removal
- Root `package.json` pins `openai ^6.24.0`, but `packages/providers/openai` pins `openai ^4.0.0`, `pgvector` pins `^4.0.0`, `rag` and `qdrant` pin `^4.20–4.73`, and `openai-stt-tts` pins `^4.73.0`. Multiple major versions of the `openai` SDK coexist across the workspace (pnpm hoists per-package via the lockfile) — be aware of API differences between v4 and v6 when modifying providers.
## Configuration
- No `.env*` files committed (`.gitignore` excludes `.env*`); environment variables are read via `process.env` at runtime, not validated by a schema library
- Key vars read in code: `OPENAI_API_KEY`, `DATABASE_URL`, `QDRANT_HOST`, `QDRANT_API_KEY` (see INTEGRATIONS.md for full list and call sites)
- `apps/playground/tsconfig.json` — strict mode, ES2017 target, bundler module resolution, path aliases for `@/*` and all `@khaveeai/*` workspace packages mapped to their `src/index.ts`
- `tsconfig.packages.json` — shared base config referenced by individual package `tsconfig.json` files
- `apps/playground/next.config.ts` — minimal, no custom Next.js config options set
- `postcss.config.mjs` — Tailwind v4 plugin only
- `eslint.config.mjs` — flat config, ignores `node_modules`, `.next`, `out`, `build`, `next-env.d.ts`
## Platform Requirements
- Node.js (v18+ per CI, v23 observed locally) + pnpm 10.x
- Optional local Postgres+pgvector via Docker (`docker-compose.yml`: `pgvector/pgvector:pg16` image, exposed on host port 5434 mapped to container 5432, db `vrm_vectors`)
- Browser with WebGL, WebRTC, Web Audio API, and microphone access support for testing avatar/realtime features
- Deployment target not explicitly configured in-repo (no `vercel.json`, `Dockerfile` for the app, or deployment workflow beyond npm package publishing)
- `.github/workflows/publish.yml` automates npm publishing of workspace packages on `v*` tag push or manual dispatch (Node 18, `pnpm install` → `pnpm run build:packages` → `pnpm run test` (best-effort) → optional version bump → `pnpm run publish:all` using `NPM_TOKEN` secret → GitHub Release creation)
- No CI workflow runs lint/tests on pull requests — the only workflow present is the publish pipeline
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Provider/client classes use PascalCase matching the exported class: `packages/providers/openai-stt-tts/src/STTClient.ts`, `packages/providers/openai-stt-tts/src/ChatClient.ts`, `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`, `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`.
- React hooks use camelCase with `use` prefix matching the export: `packages/react/src/hooks/useRealtime.ts`, `packages/react/src/hooks/useAudioLipSync.ts`.
- React components use PascalCase: `packages/react/src/VRMAvatar.tsx`, `packages/react/src/GLBAvatar.tsx`, `packages/react/src/KhaveeProvider.tsx`.
- Type-only modules live under a `types/` directory and are named by domain: `packages/core/src/types/realtime.ts`, `packages/core/src/types/audio.ts`, `packages/core/src/types/conversation.ts`, `packages/core/src/types/providers.ts`, `packages/core/src/types/project.ts`, `packages/core/src/types/qdrant.ts`, `packages/core/src/types/mock.ts`.
- Barrel files are always `index.ts` and re-export the package's public surface: `packages/core/src/index.ts`, `packages/react/src/index.ts`, `packages/providers/*/src/index.ts`.
- Test files are colocated under `__tests__/` next to the source they cover and named `<SourceClass>.test.ts`: `packages/providers/openai-stt-tts/src/__tests__/STTClient.test.ts`.
- camelCase for all functions and methods: `setChatStatus`, `trimHistory`, `resolveAuthToken`, `runTurnFromText` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`).
- Event handler fields use an `on<Event>` naming pattern and are optional (`?`) callback properties: `onConnect?`, `onChatStatusChange?`, `onUsageReport?`, `onAudioData?` (`packages/core/src/types/realtime.ts`).
- Boolean-returning toggles are named `toggle<Thing>()` / `is<Thing>()` / `enable<Thing>()` / `disable<Thing>()`: `toggleMicrophone()`, `isMicrophoneEnabled()`, `enableMicrophone()`, `disableMicrophone()`.
- Private helper methods that mutate internal state are prefixed with verbs (`set`, `trim`, `resolve`, `update`, `clear`): `setChatStatus`, `trimHistory`, `resolveAuthToken`, `updateEphemeralUserMessage`, `clearEphemeralUserMessage` (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`).
- camelCase throughout; boolean flags prefixed with `is`/`has`: `isConnected`, `isTurnActive` (as `_isTurnActive`), `hasHeardFirstGreeting`, `micEnabled`.
- Internal/private flags that back a public toggle or guard against re-entrancy use a leading underscore: `_isTurnActive` in `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:92`.
- Constants for lookups/templates use camelCase (not SCREAMING_SNAKE_CASE), e.g. `phonemeTemplates`, `phonemeBoosts`, `minMovement` in `packages/react/src/hooks/useAudioLipSync.ts`. Module-level test fixtures use SCREAMING_SNAKE_CASE, e.g. `ENDPOINT`, `AUTH_TOKEN`, `MESSAGES` in `packages/providers/openai-stt-tts/src/__tests__/ChatClient.test.ts`.
- Interfaces use PascalCase without an `I` prefix: `RealtimeProvider`, `RealtimeConfig`, `RealtimeTool`, `RealtimeEvents` (`packages/core/src/types/realtime.ts`).
- Type aliases for plain object shapes also use PascalCase: `ChatMessage`, `ChatUsage`, `ChatResult`, `ProxyResponseFlat` (`packages/providers/openai-stt-tts/src/ChatClient.ts`).
- Discriminated/union string literals are inlined rather than enums: `role: "system" | "user" | "assistant"`, `voice?: "alloy" | "ash" | "ballad" | ... ` (`packages/core/src/types/realtime.ts`).
- Config types extend a base interface by name pattern `<Provider>Config extends RealtimeConfig`: `OpenAISTTTTSConfig extends RealtimeConfig` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:29`).
## Code Style
- No Prettier config detected (`.prettierrc*` absent). Formatting is enforced only by ESLint + TypeScript strictness; indentation is consistently 2 spaces and double quotes are used for string literals in newer provider code (`packages/providers/openai-stt-tts/src/*.ts`), while some older app/hook code mixes single quotes (`packages/providers/mock/src/index.ts`).
- Semicolons are used consistently.
- Trailing commas appear in multi-line function calls/object literals in newer files (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`).
- ESLint flat config at `apps/playground/eslint.config.mjs` extends `next/core-web-vitals` and `next/typescript` via `FlatCompat`. No custom rule overrides beyond `ignores` for `node_modules`, `.next`, `out`, `build`, `next-env.d.ts`.
- Workspace packages under `packages/*` do not have their own eslint config; only `apps/playground/eslint.config.mjs` applies, and it is Next.js-oriented (primarily lints `apps/playground/src/app/**`). Treat ESLint as best-effort for SDK packages, not authoritative.
- TypeScript `strict: true` is set in both `apps/playground/tsconfig.json` (Next app) and `tsconfig.packages.json` (SDK packages) — write strict-mode-safe code (no implicit `any`, exhaustive null checks) even though some legacy files (`OpenAIRealtimeProvider.ts`, `useAudioLipSync.ts`) still use explicit `any` for OpenAI/Meyda payloads.
## Import Organization
- The Next.js app (`apps/playground/src/app/**`) uses `@/*` mapped to `./src/*` (`apps/playground/tsconfig.json`).
- SDK packages reference each other via published-style workspace package names (`@khaveeai/core`, `@khaveeai/react`, `@khaveeai/providers-*`), resolved through `apps/playground/tsconfig.json`'s `paths` map during development and through `workspace:*` / semver ranges in each package's `package.json` for build/publish.
- Packages never import across sibling packages via relative `../../` paths — always via the `@khaveeai/*` package name, even within the monorepo.
## Error Handling
- Async lifecycle methods (`connect`, `disconnect`, `runTurn`, `runTurnFromText`) wrap their body in `try { ... } catch (error) { this.onError?.(error instanceof Error ? error : new Error(String(error))); ... }` — always normalize unknown `catch` values to `Error` before passing to `onError` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:281-285`, `:375-380`, `:476-482`).
- Older provider code (`OpenAIRealtimeProvider.ts`) instead casts directly: `this.onError?.(error as Error);` — prefer the `instanceof Error` normalization pattern used in the newer `openai-stt-tts` provider for new code.
- Network/proxy client methods (`STTClient.transcribe`, `ChatClient.complete`) throw plain `Error` objects with the HTTP status code embedded in the message: `throw new Error(\`STT proxy error: ${res.status} ${body}\`)` (`packages/providers/openai-stt-tts/src/STTClient.ts:61`), `throw new Error(\`Chat proxy error: ${res.status} ${body}\`)` (`packages/providers/openai-stt-tts/src/ChatClient.ts:81`). Tests assert on this via `.rejects.toThrow("<status>")`.
- Errors are surfaced to consumers exclusively through the optional `onError?: (error: Error) => void` event callback on `RealtimeProvider` — methods do not generally reject/throw past their own boundary for foreseeable runtime failures (mic permission, network); they catch, notify `onError`, and reset state to a safe status (usually `"ready"` or `"stopped"`).
- Defensive guards return early instead of throwing for "should never happen but is not fatal" conditions, e.g. `disableMicrophone()`/`enableMicrophone()` log a `console.warn` and return when `audioStream` is null instead of throwing (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:634-637`).
- Resource cleanup (`AudioContext.close()`) always checks `state !== "closed"` first to avoid throwing on a double-close (documented inline as "RESEARCH Pitfall 1"): `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:311`.
## Logging
- `console.error` for caught exceptions that are also forwarded via `onError`: `console.error("Tool execution error:", error);` (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:602`).
- `console.warn` for non-fatal/expected-absence conditions (no audio stream, Meyda unavailable): `console.warn("No audio stream available - microphone cannot be toggled");`.
- `console.log` is used liberally in mock/demo code and lip-sync analyzers for development visibility, often with emoji prefixes for readability: `console.log(\`🔊 [Mock TTS] Speaking with ${voice}:\`)` (`packages/providers/mock/src/index.ts:56`), `console.error("❌ OpenAI Error:", msg);` (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:450`). New provider code (`openai-stt-tts`) avoids decorative logging — prefer plain, undecorated log messages for production-facing packages and reserve emoji-style logs for mock/demo-only code.
- No structured logging, log levels, or remote log shipping exist anywhere in the SDK packages.
## Comments
- File-header block comments explain the module's role and any non-obvious security/lifecycle constraints, e.g. the header in `packages/providers/openai-stt-tts/src/STTClient.ts:1-16` documents why Content-Type is not set manually and why the filename must be `"utterance.wav"`.
- Inline comments call out "pitfalls" with explicit research traceability tags like `(RESEARCH Pitfall 1)`, `(T-03-08)`, `(SDK-08)` — these reference internal planning/ticket IDs and should be preserved or extended consistently when modifying that code (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:230-244, 311, 335`).
- Section-divider comments (`// ── Section Name ──...`) are used to group class members into logical blocks (state, public interface, event handlers, lifecycle, private helpers) in larger classes: `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:69, 94, 101, 118, 149, 222, 349`. Follow this divider style when adding new sections to large provider classes.
- Comments explain *why*, not *what*, for any non-obvious ordering/timing decision (e.g. why `disconnect()` checks `audioContext.state !== "closed"`, why VAD resume happens before `_isTurnActive` is cleared).
- Public class methods and exported functions/types on `@khaveeai/core` and SDK provider classes use `/** ... */` JSDoc blocks with `@param`/`@returns`/`@throws` tags for non-trivial methods: `packages/providers/openai-stt-tts/src/STTClient.ts:24-34`.
- Interface/type fields use single-line `/** ... */` doc comments directly above the field to document units, defaults, and constraints: `/** Duration of silence (ms) before ending a speech turn. Default: 1500 */` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:40`).
- Simpler/legacy code (mock provider, lip-sync hooks) often omits JSDoc in favor of short `//` comments — JSDoc density correlates with how recently/carefully the code was written; new public SDK surface should have full JSDoc.
## Function Design
## Module Design
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
```
## Component Responsibilities
| Component | Responsibility | File |
|-----------|----------------|------|
| `RealtimeProvider` interface | Single contract every voice/chat backend must implement (connect/disconnect, messaging, mic control, audio analyser, events) | `packages/core/src/types/realtime.ts` |
| `RealtimeEvents` interface | Event callback surface (onConnect, onMessage, onChatStatusChange, onAudioData, etc.) mixed into `RealtimeProvider` | `packages/core/src/types/realtime.ts` |
| `Provider` (base marker interface) | Minimal `{ name, version }` shape; not actually used by any current provider class | `packages/core/src/types/providers.ts` |
| `LLMProvider` / `TTSProvider` | Legacy non-realtime text-streaming / speak contracts, predate `RealtimeProvider`; only consumed by `KhaveeConfig.llm` / `.tts` and the mock/openai LLM packages | `packages/core/src/types/mock.ts` |
| `OpenAIRealtimeProvider` | Full-duplex WebRTC voice pipeline; talks directly to OpenAI's Realtime API (or via ephemeral-token proxy); owns peer connection, data channel, mic stream, audio element | `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` |
| `OpenAISTTTTSProvider` | Turn-based "VAD → STT → Chat → TTS" pipeline implementing the same `RealtimeProvider` interface but composed from 4 swappable helper classes | `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` |
| `AudioRecorder` | Wraps MicVAD; emits `onSpeechStart` / `onUtteranceReady(wav: Blob)` / `onError`; not exported from the package's public API | `packages/providers/openai-stt-tts/src/AudioRecorder.ts` |
| `STTClient` | POSTs a WAV blob (multipart/form-data) to a backend Whisper proxy, returns transcript string; not exported publicly | `packages/providers/openai-stt-tts/src/STTClient.ts` |
| `ChatClient` | POSTs `{messages, model, temperature}` JSON to a Chat Completions proxy, returns `{text, usage}`; not exported publicly | `packages/providers/openai-stt-tts/src/ChatClient.ts` |
| `TTSPlayer` | POSTs text to a TTS proxy, decodes audio via Web Audio API, plays through a dual-path `AudioBufferSourceNode` (analyser + destination) for lip-sync; not exported publicly | `packages/providers/openai-stt-tts/src/TTSPlayer.ts` |
| `ToolExecutor` (×2, duplicated) | Registry mapping tool name → `execute` fn; identical implementation exists separately in both `openai-realtime` and `openai-stt-tts` packages | `packages/providers/openai-realtime/src/ToolExecutor.ts`, `packages/providers/openai-stt-tts/src/ToolExecutor.ts` |
| `KhaveeProvider` | React context holding exactly one `RealtimeProvider` instance plus VRM/animation/expression state; the SDK has no concept of multiple simultaneous providers | `packages/react/src/KhaveeProvider.tsx` |
| `useRealtime` | The single hook that wires a `RealtimeProvider`'s callbacks into React state, and also contains a large embedded MFCC/DTW phoneme-detection class (`RealtimeAudioAnalyzer`) used for lip-sync | `packages/react/src/hooks/useRealtime.ts` |
| `VRMAvatar` / `GLBAvatar` | Render layer; consumes `chatStatus` from `KhaveeProvider` context to trigger talking animations | `packages/react/src/VRMAvatar.tsx`, `packages/react/src/GLBAvatar.tsx` |
| Example app (`apps/playground/src/app/openai/page.tsx`) | Only wires `OpenAIRealtimeProvider`; there is currently **no example wiring `OpenAISTTTTSProvider`** in the Next.js demo app — it is only exercised by its own unit tests | `apps/playground/src/app/openai/page.tsx`, `packages/providers/openai-stt-tts/src/__tests__/` |
## Pattern Overview
- One interface (`RealtimeProvider`) is the only seam the rest of the SDK (React layer) depends on. Anything implementing it is fully interchangeable from `KhaveeProvider`'s point of view.
- Internally, `OpenAISTTTTSProvider` already decomposes its pipeline into 4 single-purpose helper classes (`AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer`) — this is the natural seam to generalize into independent STT/LLM/TTS provider interfaces (pipecat-style), but today those helpers are concrete, OpenAI-specific classes, not interfaces.
- A constructor-level dependency-injection seam already exists for testing (`ProviderDeps` in `OpenAISTTTTSProvider.ts`), proving the helpers can already be swapped — they are just not yet typed as abstract contracts.
- `OpenAIRealtimeProvider` does NOT decompose into stages at all — it is a single ~800-line class because OpenAI's Realtime API is one full-duplex WebRTC session (no separate STT/LLM/TTS calls to make).
- There is no pipeline/transport orchestration layer comparable to pipecat's `Pipeline`/`FrameProcessor` — each provider class is both the orchestrator and the implementation.
- Tool/function-calling logic (`ToolExecutor`) is duplicated verbatim across provider packages instead of living in `@khaveeai/core`.
- Audio/lip-sync analysis is split awkwardly: `TTSPlayer` and `OpenAIRealtimeProvider` each independently create an `AnalyserNode` with identical settings (`fftSize=2048`, `smoothingTimeConstant=0.6`), and `useRealtime.ts` contains a large client-side MFCC/DTW phoneme classifier that operates on whatever analyser the active provider exposes via `getAudioAnalyser()`.
## Layers
- Purpose: Define every cross-package contract — `RealtimeProvider`, `RealtimeConfig`, `RealtimeEvents`, `RealtimeTool`, `Conversation`/`ChatStatus`, `MouthState`/`PhonemeData`/`AudioConfig`, plus a small HTTP client (`KhaveeClient`) and an `animate` tool factory.
- Location: `packages/core/src`
- Contains: Pure TypeScript interfaces/types (`src/types/*.ts`), one concrete utility class (`KhaveeClient` in `src/client/khavee-client.ts`), and one tool-factory helper (`src/tools/animate.ts`).
- Depends on: Nothing internal (depends on `axios`, `three`/`@pixiv/three-vrm` only for VRM-adjacent types).
- Used by: Every provider package and `@khaveeai/react`.
- Purpose: Each package is a swappable implementation of `RealtimeProvider` (or, for non-realtime ones, `LLMProvider`/vector-store-style interfaces).
- Location: `packages/providers/{openai-realtime,openai-stt-tts,openai,mock,azure,pgvector,qdrant,rag}`
- Contains: One main class per package implementing a core interface, plus package-private helper classes not exported from `index.ts`.
- Depends on: `@khaveeai/core` types only (no dependency on `@khaveeai/react` or other provider packages).
- Used by: Application code (e.g. `apps/playground/src/app/openai/page.tsx`) and `@khaveeai/react` (structurally, via the interface — `@khaveeai/react` never imports a concrete provider package directly).
- Purpose: Bridge a `RealtimeProvider` instance into React state/hooks, render the VRM/GLB avatar, and drive lip-sync animation from whatever `AnalyserNode` the active provider exposes.
- Location: `packages/react/src`
- Contains: `KhaveeProvider.tsx` (context), `VRMAvatar.tsx`/`GLBAvatar.tsx` (3D rendering + animation), `hooks/useRealtime.ts` (event wiring + embedded phoneme analyzer), `hooks/useAudioLipSync.ts`.
- Depends on: `@khaveeai/core` types, `three`/`@pixiv/three-vrm`/`@react-three/fiber`, `meyda` (MFCC feature extraction).
- Used by: Application code (`apps/playground/src/app/*`) and the WordPress plugin (`wordpress-plugin/src`).
- Purpose: Next.js app demonstrating SDK usage (`apps/playground/src/app`), plus a WordPress embed (`wordpress-plugin`).
- Location: `apps/playground/src/app`, `wordpress-plugin`
- Contains: Page components that instantiate one provider, wrap it in `KhaveeProvider`, and render `VRMAvatar`/`GLBAvatar` plus chat UI.
- Depends on: `@khaveeai/react`, `@khaveeai/providers-*`, `@khaveeai/core`.
- Used by: End users / nothing internal depends on this layer.
## Data Flow
### OpenAIRealtimeProvider path (full-duplex WebRTC)
### OpenAISTTTTSProvider path (turn-based VAD → STT → Chat → TTS)
- All conversational state (`conversation`, `chatStatus`, `isConnected`, `currentVolume`) lives as plain mutable fields on the concrete provider instance — there is no central store. `useRealtime` polls/mirrors this state into React via callbacks plus a 100ms `setInterval` fallback sync (`useRealtime.ts:107`).
- Conversation history sent to the LLM (`messages: ChatMessage[]`) is a provider-private field, separate from the public-facing `conversation: Conversation[]` array consumed by the UI; `trimHistory()` only trims the former.
## Key Abstractions
- Purpose: The only contract the React layer depends on; represents "a thing that can connect, accept text/voice turns, and emit conversation/audio/status events."
- Examples: `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`, `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`
- Pattern: Fat interface mixing connection lifecycle, messaging, mic control, audio analysis, and ~10 optional event callbacks (`RealtimeEvents`) into one type. Any new provider (e.g. a different STT/TTS vendor) must implement the entire surface even if most of it is irrelevant to that vendor's transport.
- Purpose: Single-responsibility units for one pipeline stage (mic capture+VAD, STT call, LLM call, TTS call+playback).
- Examples: `AudioRecorder.ts`, `STTClient.ts`, `ChatClient.ts`, `TTSPlayer.ts` (all in `packages/providers/openai-stt-tts/src/`)
- Pattern: Concrete classes, not interfaces. Each is instantiated directly in the provider constructor (`new AudioRecorder()`, etc.) with an injectable override via the `ProviderDeps` type for unit tests only — there is no public `STTProvider`/`TTSProvider`/`VADProvider` interface in `@khaveeai/core` that a different vendor's helper could implement and be swapped in. **This is the primary generalization point**: promoting these to core interfaces (e.g. `STTProvider.transcribe(audio): Promise<string>`, `TTSProvider.speak(text, opts): Promise<AudioResult>`) and having `OpenAISTTTTSProvider`-equivalent become a generic "pipeline provider" that takes STT/LLM/TTS implementations as constructor args is the direct analog to pipecat's `FrameProcessor` composition.
- Purpose: Name → async function registry for OpenAI function-calling.
- Examples: `packages/providers/openai-realtime/src/ToolExecutor.ts`, `packages/providers/openai-stt-tts/src/ToolExecutor.ts`
- Pattern: Byte-for-byte duplicate implementations. Should live once in `@khaveeai/core` and be imported by every provider.
- Purpose: Predates `RealtimeProvider`; a simpler "streamChat" / "speak" contract used by `KhaveeConfig.llm`/`.tts` and the `mock` / `openai` (non-realtime) packages.
- Examples: `packages/core/src/types/mock.ts`, `packages/providers/mock/src/index.ts` (`MockLLM`, `MockTTS`), `packages/providers/openai/src/index.ts` (`LLMOpenAI`)
- Pattern: This is a second, smaller, unrelated abstraction layer — it is NOT used by `KhaveeProvider`'s `realtimeProvider` state and is not wired into `useRealtime`. Any STT/TTS generalization effort needs to decide whether to retire this legacy path or fold it into the new pipeline-stage interfaces, since today it is dead weight alongside `RealtimeProvider`.
- Purpose: Single config object passed to a provider constructor; `OpenAISTTTTSConfig extends RealtimeConfig` and bolts on STT/TTS-specific fields (`sttModel`, `ttsProxyEndpoint`, `silenceThresholdMs`, VAD thresholds, etc.) directly onto one flat interface.
- Examples: `packages/core/src/types/realtime.ts` (`RealtimeConfig`), `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:29` (`OpenAISTTTTSConfig`)
- Pattern: Config inheritance/flattening rather than composition — a generalized SDK would likely need per-stage config objects (`sttConfig`, `llmConfig`, `ttsConfig`) instead of one ever-growing flat interface.
## Entry Points
- Location: e.g. `packages/providers/openai-stt-tts/src/index.ts`, `packages/providers/openai-realtime/src/index.ts`
- Triggers: `import { XProvider } from '@khaveeai/providers-x'` in app code.
- Responsibilities: Re-export only the public surface — the main provider class, its config type, and (inconsistently) `ToolExecutor`. Internal helper classes (`AudioRecorder`, `STTClient`, `ChatClient`, `TTSPlayer`) are intentionally NOT exported.
- Location: `packages/react/src/KhaveeProvider.tsx`
- Triggers: Wrapping the app's component tree; receives `config.realtime` (a `RealtimeProvider` instance constructed by app code).
- Responsibilities: Hold the single active provider in context, mirror its `chatStatus`, hold VRM/expression/animation state independent of any provider.
- Location: `packages/react/src/hooks/useRealtime.ts`
- Triggers: Called from any component needing chat state/actions (`connect`, `disconnect`, `sendMessage`, `interrupt`, mic toggles).
- Responsibilities: Subscribe to the active provider's event callbacks, mirror them into React state, own the lip-sync `RealtimeAudioAnalyzer` lifecycle.
- Location: `apps/playground/src/app/openai/page.tsx`, `apps/playground/src/app/glb/page.tsx`, `apps/playground/src/app/pgvector/page.tsx`, `apps/playground/src/app/rag-realtime/page.tsx`
- Triggers: Direct navigation in the demo app.
- Responsibilities: Construct one concrete provider, wrap in `KhaveeProvider`, render `VRMAvatar`/`GLBAvatar` + chat UI. `apps/playground/src/app/api/negotiate/route.ts` is the backend proxy endpoint the realtime provider's `useProxy` mode (or direct SDP relay) calls into.
## Architectural Constraints
- **Threading:** Single-threaded browser/event-loop model throughout; no workers. Audio processing (`AudioContext`, `AnalyserNode`, MicVAD's audio worklet) runs in the browser's audio thread/worklet under the hood but is not something this codebase manages explicitly beyond `AudioContext` lifecycle.
- **Global state:** None at module scope — all state is instance-scoped on provider classes or React context state. No singletons observed in `packages/core` or `packages/providers`.
- **One active provider at a time:** `KhaveeProvider`/`useRealtime` are hard-wired to a single `RealtimeProvider` instance (`config.realtime`). There is no concept of running STT from one vendor and TTS from another simultaneously without writing an entirely new monolithic provider class that internally composes them (as `OpenAISTTTTSProvider` does today for one vendor).
- **Browser-only APIs:** `AudioContext`, `AnalyserNode`, `MediaStream`, `RTCPeerConnection`, `crypto.randomUUID()` are used directly with no Node.js fallback — both realtime providers assume a browser runtime (`"use client"` boundary in React package files).
- **Backend proxy assumption:** `OpenAISTTTTSProvider` assumes a backend exists at `sttProxyEndpoint`/`chatProxyEndpoint`/`ttsProxyEndpoint` that holds the real OpenAI API key — the provider never embeds an API key for its proxied calls (`resolveAuthToken()` just returns `config.apiKey` for direct dev use, expected to be overridden when `useProxy` support is added). Any new provider should follow the same "no secret in the browser" pattern.
- **Static asset dependency:** `AudioRecorder` requires `@ricky0123/vad-web`'s ONNX/WASM assets to be served from the consuming app's `public/` directory (`baseAssetPath`/`onnxWASMBasePath`) — this is an external file-serving constraint, not just a code dependency.
## Anti-Patterns
### Monolithic provider classes instead of composed pipeline stages
### Duplicated `ToolExecutor` implementation
### Two parallel, unrelated provider abstractions (`RealtimeProvider` vs `LLMProvider`/`TTSProvider`)
### Config inheritance instead of per-stage config composition
## Error Handling
- `error instanceof Error ? error : new Error(String(error))` normalization appears in both provider classes before calling `onError?.()`.
- `TTSPlayer.speak()` distinguishes a deliberate `AbortError` (from `cancel()`) from a real failure — abort is swallowed silently, everything else is re-thrown to the caller (`OpenAISTTTTSProvider.runTurnFromText`'s catch block).
- A boolean re-entrancy guard (`_isTurnActive`) in `OpenAISTTTTSProvider` prevents overlapping `runTurn()` calls caused by VAD double-firing; cleared in a `finally` block.
- HTTP helper classes (`STTClient`, `ChatClient`) throw plain `Error` with the proxy's status code and response body text baked into the message rather than a typed error hierarchy.
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

## Agent skills

### Issue tracker

Issues live in GitHub Issues (khavee-ai/khavee-sdk), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
