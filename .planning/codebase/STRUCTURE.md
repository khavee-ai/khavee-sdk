# Codebase Structure

**Analysis Date:** 2026-06-17

## Directory Layout

```
khavee-sdk/                          # pnpm workspace root (also a Next.js demo app)
├── packages/                        # publishable SDK packages (the actual product)
│   ├── core/                        # @khaveeai/core — shared types + base client
│   │   └── src/
│   │       ├── types/                # all cross-package interfaces (the contracts)
│   │       ├── client/                # KhaveeClient (REST helper, axios-based)
│   │       └── tools/                 # tool-factory helpers (e.g. animate.ts)
│   ├── react/                       # @khaveeai/react — context, hooks, 3D rendering
│   │   └── src/
│   │       ├── hooks/                 # useRealtime, useAudioLipSync
│   │       ├── types/                 # animation.ts
│   │       └── utils/                 # mixamo→VRM rig remapping
│   └── providers/                   # one subpackage per swappable provider
│       ├── openai-realtime/         # @khaveeai/providers-openai-realtime
│       ├── openai-stt-tts/          # @khaveeai/providers-openai-stt-tts
│       ├── openai/                  # @khaveeai/providers-openai (legacy LLMProvider impl)
│       ├── mock/                    # @khaveeai/providers-mock (legacy LLM/TTS mocks)
│       ├── pgvector/                 # @khaveeai/providers-pgvector (vector store, unrelated to voice)
│       ├── qdrant/                   # @khaveeai/provider-qdrant (vector store, unrelated to voice)
│       ├── rag/                      # @khaveeai/providers-rag (RAG helper, unrelated to voice)
│       └── azure/                    # EMPTY placeholder — no src/, no package.json yet
├── src/                              # Next.js demo app (consumes the packages above)
│   └── app/
│       ├── api/negotiate/            # backend proxy route for OpenAI Realtime SDP
│       ├── components/                # demo-only React components (Experience, UI)
│       ├── openai/                    # demo page wiring OpenAIRealtimeProvider
│       ├── glb/                       # demo page for GLBAvatar
│       ├── pgvector/, rag-realtime/   # demo pages for RAG/vector-store packages
│       └── utils/                     # duplicate copy of mixamo rig-remap utils
├── public/                           # static assets served by the demo app (VRM/GLB models, animations)
├── wordpress-plugin/                  # separate distribution target embedding the SDK in WordPress
│   ├── includes/                      # PHP plugin scaffolding
│   └── src/                           # JS bundle entry consuming @khaveeai/react
├── docs/                              # misc standalone docs (not generated API docs)
├── .planning/codebase/                 # generated codebase-map docs (this file's home)
├── pnpm-workspace.yaml                 # declares packages/core, packages/react, packages/providers/*
├── tsconfig.json                       # demo-app tsconfig; path-aliases map @khaveeai/* → packages/*/src
└── tsconfig.packages.json              # shared base tsconfig extended by each package's own tsconfig
```

## Directory Purposes

**`packages/core/src/types/`:**
- Purpose: Single source of truth for every interface/type shared across provider packages and the React layer.
- Contains: `realtime.ts` (`RealtimeProvider`, `RealtimeConfig`, `RealtimeEvents`, `RealtimeTool`, `UsageReport`), `providers.ts` (base `Provider` marker interface, currently unused by concrete classes), `conversation.ts` (`Conversation`, `ChatStatus`, `RealtimeMessage`), `audio.ts` (`MouthState`, `PhonemeData`, `AudioConfig`), `mock.ts` (legacy `LLMProvider`/`TTSProvider`/`KhaveeConfig`), `project.ts`, `qdrant.ts`, `index.ts` (barrel re-export).
- Key files: `packages/core/src/types/realtime.ts` (the interface that matters most for STT/TTS generalization).

**`packages/providers/<name>/src/`:**
- Purpose: One implementation of a core interface per directory; each is an independently versioned/published npm package.
- Contains: A main class file matching the provider's purpose (e.g. `OpenAISTTTTSProvider.ts`), an `index.ts` barrel that re-exports only the public surface, and zero-or-more package-private helper classes not re-exported.
- Key files: see "Key File Locations" below for the voice-pipeline-relevant ones.

**`packages/providers/openai-stt-tts/src/`:**
- Purpose: The turn-based VAD→STT→Chat→TTS pipeline provider — the one explicitly called out for generalization.
- Contains: `OpenAISTTTTSProvider.ts` (orchestrator + public interface impl), `AudioRecorder.ts` (VAD wrapper), `STTClient.ts` (Whisper proxy client), `ChatClient.ts` (Chat Completions proxy client), `TTSPlayer.ts` (TTS proxy client + Web Audio playback), `ToolExecutor.ts` (function-calling registry), `__tests__/` (vitest specs for `ChatClient`, `STTClient`, `OpenAISTTTTSProvider`), `index.ts` (barrel — exports only `OpenAISTTTTSProvider`, `OpenAISTTTTSConfig`, `ToolExecutor`).
- Key files: `OpenAISTTTTSProvider.ts` is the orchestration logic to generalize; `AudioRecorder.ts`/`STTClient.ts`/`ChatClient.ts`/`TTSPlayer.ts` are the four concrete stage implementations to lift into interfaces.

**`packages/providers/openai-realtime/src/`:**
- Purpose: WebRTC full-duplex provider talking directly to OpenAI's Realtime API; not staged/decomposable the same way (single vendor session, not separate STT/LLM/TTS calls).
- Contains: `OpenAIRealtimeProvider.ts` (the entire pipeline in one class), `ToolExecutor.ts` (duplicate of the one in `openai-stt-tts`), `index.ts`.

**`packages/react/src/`:**
- Purpose: React bindings — context provider, hooks, and 3D avatar rendering components.
- Contains: `KhaveeProvider.tsx` (context holding the single active `RealtimeProvider` plus VRM/expression/animation state), `VRMAvatar.tsx`/`GLBAvatar.tsx` (rendering + animation triggering based on `chatStatus`), `hooks/useRealtime.ts` (wires provider callbacks into React state; also contains the embedded `RealtimeAudioAnalyzer` MFCC/DTW lip-sync engine), `hooks/useAudioLipSync.ts`, `hooks/index.ts` (barrel), `types/animation.ts`, `utils/remapMixamoAnimationToVrm.ts` + `utils/mixamoVRMRigMap.ts`.
- Key files: `hooks/useRealtime.ts` is the only file that imports/depends on the `RealtimeProvider` shape from the React side — any new generalized provider must keep satisfying this hook's expectations (`getAudioAnalyser()`, `isMicrophoneEnabled()`, the `RealtimeEvents` callbacks).

**`src/app/` (demo Next.js app):**
- Purpose: Living example/integration test bed for the published packages; also the project actually built/deployed by `npm run dev`/`npm run build` at the repo root.
- Contains: `api/negotiate/route.ts` (backend SDP-relay proxy for `OpenAIRealtimeProvider`), `openai/page.tsx` (only demo wiring a realtime provider — note: **no demo page currently wires `OpenAISTTTTSProvider`**), `glb/page.tsx`, `pgvector/page.tsx` + `pgvector/actions.ts`, `rag-realtime/page.tsx` + `rag-realtime/actions.ts`, `components/Experience.tsx` + `UI.tsx` + `VRMAvatarRef.tsx`, `utils/` (duplicate of the mixamo remap utils also present in `packages/react/src/utils/`).
- Key files: `src/app/api/negotiate/route.ts` is the only backend proxy route present in this repo — `OpenAISTTTTSProvider`'s `sttProxyEndpoint`/`chatProxyEndpoint`/`ttsProxyEndpoint` have no corresponding demo route here (they're expected to be implemented by consuming applications).

**`public/`:**
- Purpose: Static assets the demo app serves — VRM/GLB models (`public/models/female`, `public/models/male`, `public/models/animations`), phoneme audio fixtures (`public/audio/phoneme`). Also where a consuming app must copy `@ricky0123/vad-web`'s ONNX/WASM files for `AudioRecorder` to function (per `baseAssetPath`/`onnxWASMBasePath` config).

**`wordpress-plugin/`:**
- Purpose: A separate, parallel distribution channel — embeds the same React SDK inside a WordPress plugin shell.
- Contains: `includes/` (PHP plugin registration code), `src/` (JS entry point bundling `@khaveeai/react` components for the WP block/shortcode).

## Key File Locations

**Entry Points:**
- `packages/core/src/index.ts`: Barrel — re-exports all of `types/*` and `client/khavee-client.ts`.
- `packages/react/src/index.ts`: Barrel — `KhaveeProvider`, `useKhavee`, `VRMAvatar`, `GLBAvatar`, all of `hooks/*`.
- `packages/providers/openai-stt-tts/src/index.ts`: Exports `OpenAISTTTTSProvider`, `OpenAISTTTTSConfig`, `ToolExecutor` (only — helper classes stay private).
- `packages/providers/openai-realtime/src/index.ts`: Exports `OpenAIRealtimeProvider` and its config/tool types.
- `src/app/api/negotiate/route.ts`: The one backend proxy endpoint implemented in this repo (relays SDP to OpenAI Realtime API using a server-side `OPENAI_API_KEY`).

**Configuration:**
- `pnpm-workspace.yaml`: Declares the 3 workspace globs (`packages/core`, `packages/react`, `packages/providers/*`).
- `package.json` (repo root): Declares the demo Next.js app's scripts AND the root-level runtime deps (note: some provider packages like `@khaveeai/providers-openai-realtime` are listed here as a dependency of the demo app, not just devDependency of the monorepo).
- `tsconfig.json` (repo root): Demo app's TS config; `paths` maps every `@khaveeai/*` import to that package's `src/index.ts` directly (so the demo app always builds against source, not `dist/`).
- `tsconfig.packages.json`: Shared compiler options (`target: es2020`, `declaration: true`, `jsx: react-jsx`) each package's own `tsconfig.json` extends when compiling to `dist/`.
- Each package's own `package.json` (`packages/*/package.json`, `packages/providers/*/package.json`): Declares `exports`/`main`/`types` pointing at `dist/`, and the package's own dependency list — provider packages depend only on `@khaveeai/core`, never on each other or on `@khaveeai/react`.

**Core Logic (voice pipeline, the focus of generalization):**
- `packages/core/src/types/realtime.ts`: The `RealtimeProvider` contract every provider implements today.
- `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`: Turn orchestration logic (`connect`, `runTurn`, `runTurnFromText`, `trimHistory`).
- `packages/providers/openai-stt-tts/src/AudioRecorder.ts`, `STTClient.ts`, `ChatClient.ts`, `TTSPlayer.ts`: The four concrete pipeline-stage implementations (VAD, STT, LLM/chat, TTS) to generalize into interfaces.
- `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`: The alternative, non-staged full-duplex implementation (kept as-is; not staged into VAD/STT/LLM/TTS because the vendor API doesn't separate those concerns).
- `packages/react/src/hooks/useRealtime.ts`: React-side consumer of the `RealtimeProvider` contract — any redesign must keep this hook's expectations satisfied (or update it alongside the interface change).

**Testing:**
- `packages/providers/openai-stt-tts/src/__tests__/*.test.ts`: vitest specs (`ChatClient.test.ts`, `STTClient.test.ts`, `OpenAISTTTTSProvider.test.ts`); this is the only package with tests in the entire `packages/` tree.
- `packages/providers/openai-stt-tts/vitest.config.ts`: Test runner config for that package (vitest + `@vitest/coverage-v8`).

## Naming Conventions

**Files:**
- Provider implementation classes: `PascalCase.ts` named after the class they export (e.g. `OpenAISTTTTSProvider.ts` exports `OpenAISTTTTSProvider`, `AudioRecorder.ts` exports `AudioRecorder`).
- Type-only modules: `lowercase.ts` grouped by domain inside `src/types/` (e.g. `realtime.ts`, `conversation.ts`, `audio.ts`).
- React hooks: `useXxx.ts` inside `src/hooks/`, one hook per file, with a matching `hooks/index.ts` barrel.
- Barrels: every package and every `types/`/`hooks/` subdirectory has an `index.ts` that re-exports its public surface.
- Tests: `<SubjectClassName>.test.ts` inside a sibling `__tests__/` directory.

**Directories:**
- Provider packages are named after the **vendor + capability**, hyphenated: `openai-realtime`, `openai-stt-tts`. A future generalized "any vendor" pipeline provider should follow the same `<vendor>-<capability>` convention per concrete implementation (e.g. `azure-stt-tts`, `elevenlabs-tts`) while the orchestration/interfaces live in `@khaveeai/core` (not a provider package).
- `packages/providers/*` is flat — no nesting by category (voice vs. vector-store vs. LLM-only all sit as siblings); the only signal of a package's role is its name and its `package.json` `dependencies`.

## Where to Add New Code

**New STT/TTS vendor (generalizing the pattern):**
- If following the *current* (pre-generalization) pattern exactly: create `packages/providers/<vendor>-stt-tts/src/` mirroring `openai-stt-tts`'s file set (`<Vendor>STTTTSProvider.ts`, `AudioRecorder.ts` or reuse a shared VAD util, `STTClient.ts`, `ChatClient.ts`, `TTSPlayer.ts`, `index.ts`), add the package to `pnpm-workspace.yaml` (already covered by the `packages/providers/*` glob) and to `tsconfig.json`'s `paths` map at the repo root.
- If generalizing first (recommended given the stated goal): add new stage interfaces to `packages/core/src/types/` (e.g. a new `pipeline.ts` defining `STTStage`, `TTSStage`, `VADStage`, `LLMStage`), add a generic orchestrator (either inside `@khaveeai/core` or a new `packages/providers/pipeline/` package) that takes those interfaces as constructor args and implements `RealtimeProvider`, then implement only the small vendor-specific stage classes per new package (e.g. `packages/providers/azure-stt/src/AzureSTT.ts` implementing `STTStage` only).

**New core type/interface:**
- Add to the appropriate file under `packages/core/src/types/` (or a new file, re-exported from `packages/core/src/types/index.ts`).

**New React hook:**
- Add `packages/react/src/hooks/useXxx.ts`, export it from `packages/react/src/hooks/index.ts`.

**Shared utility used by multiple providers (e.g. de-duplicating `ToolExecutor`):**
- Move into `packages/core/src/` (a new subfolder, e.g. `src/tools/` already exists for `animate.ts`) so every provider package imports one copy instead of maintaining local duplicates.

**Demo/example page for a new provider:**
- Add `src/app/<name>/page.tsx` in the Next.js app, following the pattern in `src/app/openai/page.tsx` (construct provider → wrap `KhaveeProvider` → render UI via `useRealtime()`). If the provider needs a backend proxy, add a matching route under `src/app/api/<name>/route.ts` similar to `src/app/api/negotiate/route.ts`.

## Special Directories

**`packages/providers/azure/`:**
- Purpose: Reserved/placeholder package name (referenced in `tsconfig.json` path aliases as `@khaveeai/providers-azure`) with no actual source or `package.json` yet — only a stray `node_modules` symlink exists on disk.
- Generated: No.
- Committed: Effectively empty; do not assume any implementation exists here without checking first.

**`packages/*/dist/`:**
- Purpose: TypeScript build output (`tsc` per package, per each package's `build` script) — this is what gets published to npm (`files: ["dist/**/*", ...]` in each `package.json`).
- Generated: Yes (via `pnpm build:packages` / `pnpm -r build`).
- Committed: Not verified here, but standard pnpm/npm packages convention is to gitignore `dist/`; treat as build output, never hand-edit.

**`.next/`:**
- Purpose: Next.js build cache/output for the demo app.
- Generated: Yes.
- Committed: No (build artifact).

**`public/models/`, `public/audio/`:**
- Purpose: Binary asset fixtures (VRM/GLB 3D models, FBX animations, phoneme audio) consumed by the demo app's pages at runtime.
- Generated: No (hand-authored/sourced assets).
- Committed: Yes.

---

*Structure analysis: 2026-06-17*
