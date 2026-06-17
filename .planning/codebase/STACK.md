# Technology Stack

**Analysis Date:** 2026-06-17

## Languages

**Primary:**
- TypeScript 5.x - All packages (`packages/core`, `packages/react`, `packages/providers/*`) and the Next.js demo app (`src/app`)

**Secondary:**
- PHP - Scaffolded but empty WordPress plugin (`wordpress-plugin/includes`, `wordpress-plugin/src` contain no files yet)
- SQL - Raw SQL embedded in `packages/providers/pgvector/src/PgVectorProvider.ts` (DDL for pgvector schema/HNSW index)

## Runtime

**Environment:**
- Node.js v23.5.0 observed in dev environment (no `.nvmrc`/`.node-version` pinned in repo; CI (`.github/workflows/publish.yml`) uses Node 18)
- Browser runtime required for SDK packages (`@khaveeai/core`, `@khaveeai/react`, realtime/STT-TTS providers use `navigator.mediaDevices`, `RTCPeerConnection`, `AudioContext`, WebGL via three.js)

**Package Manager:**
- pnpm 10.12.1 (observed), workspace-driven monorepo
- Lockfile: present — `pnpm-lock.yaml` (lockfileVersion 9.0)
- Workspaces declared in `pnpm-workspace.yaml`: `packages/core`, `packages/react`, `packages/providers/*`

## Frameworks

**Core:**
- Next.js 15.5.3 (App Router, Turbopack) - demo/playground app at repo root, entry `src/app/`
- React 19.1.0 / React DOM 19.1.0 - UI layer for demo app and `@khaveeai/react` package
- Three.js ^0.180.0 + `@pixiv/three-vrm` ^3.4.2 - 3D rendering and VRM avatar model loading
- `@react-three/fiber` ^9.3.0, `@react-three/drei` ^10.7.6, `@react-three/postprocessing` ^3.0.4 - React bindings/helpers for three.js scenes (`src/app/components/Experience.tsx`, `src/app/components/VRMAvatarRef.tsx`)
- Tailwind CSS ^4 (via `@tailwindcss/postcss`) - styling for demo app, configured in `postcss.config.mjs`

**Testing:**
- Vitest ^2.0.0 + `@vitest/coverage-v8` - `packages/providers/openai-stt-tts` (`src/__tests__/*.test.ts`)
- Jest ^29.0.0 - `packages/providers/qdrant` (configured via `package.json` script `"test": "jest"`, no committed jest.config found)
- No test framework configured at repo root or in `packages/core`, `packages/react`, `packages/providers/{mock,openai,openai-realtime,pgvector,rag}`

**Build/Dev:**
- TypeScript compiler (`tsc`) - build tool for `packages/core`, `packages/react`, and most providers (`"build": "tsc"` in each package.json)
- tsup ^8.0.0 - build tool for `packages/providers/qdrant` only (dual ESM/CJS + `.d.ts` output)
- Turbopack - Next.js dev/build acceleration (`next dev --turbopack`, `next build --turbopack` in root `package.json`)
- ESLint 9 (flat config) - `eslint.config.mjs`, extends `next/core-web-vitals` and `next/typescript` via `FlatCompat`
- drizzle-kit ^0.31.9 - present as a devDependency at repo root but **no `drizzle.config.ts` or drizzle schema/migrations found** — appears to be an unused/leftover dependency

## Key Dependencies

**Critical:**
- `openai` (root ^6.24.0; providers use ^4.x — see version note below) - OpenAI SDK client for embeddings, chat completions, Whisper STT, TTS, and Realtime API token/session handling
- `@pixiv/three-vrm` ^3.4.2 - VRM avatar model parsing, expression/bone manipulation, lip-sync driving
- `three` ^0.180.0 - Core 3D engine underlying all avatar rendering
- `meyda` ^5.6.3 - Audio feature extraction (used for lip-sync/volume analysis in `packages/react` and root app)
- `@ricky0123/vad-web` ^0.0.30 (+ `onnxruntime-web` 1.26.0 transitively) - Browser-side voice activity detection for the STT/TTS pipeline provider (`packages/providers/openai-stt-tts/src/AudioRecorder.ts`)
- `uuid` ^13.0.0 - Session/message ID generation in `packages/providers/openai-realtime`

**Infrastructure:**
- `pg` ^8.18.0 - PostgreSQL client used by `packages/providers/pgvector`
- `pgvector` ^0.2.1 - Node helper types/utilities for pgvector at root (actual SQL vector extension calls are raw SQL in `PgVectorProvider.ts`)
- `@qdrant/js-client-rest` ^1.9–1.11 - Qdrant vector DB REST client used by `packages/providers/qdrant` and `packages/providers/rag`
- `axios` ^1.12.2 - HTTP client used in `packages/core/src/client/khavee-client.ts` for calling the hosted Khavee platform API
- `csv-parse` ^6.1.0 - CSV bulk-import parsing for pgvector document ingestion (`src/app/pgvector/actions.ts` flow)
- `drizzle-orm` ^0.45.1 - Declared at root but **not imported anywhere in source** (`grep` for `drizzle` in `src/` and `packages/` returns no hits) — dead/unused dependency, candidate for removal

**Version inconsistency note:**
- Root `package.json` pins `openai ^6.24.0`, but `packages/providers/openai` pins `openai ^4.0.0`, `pgvector` pins `^4.0.0`, `rag` and `qdrant` pin `^4.20–4.73`, and `openai-stt-tts` pins `^4.73.0`. Multiple major versions of the `openai` SDK coexist across the workspace (pnpm hoists per-package via the lockfile) — be aware of API differences between v4 and v6 when modifying providers.

## Configuration

**Environment:**
- No `.env*` files committed (`.gitignore` excludes `.env*`); environment variables are read via `process.env` at runtime, not validated by a schema library
- Key vars read in code: `OPENAI_API_KEY`, `DATABASE_URL`, `QDRANT_HOST`, `QDRANT_API_KEY` (see INTEGRATIONS.md for full list and call sites)

**Build:**
- `tsconfig.json` (root) — strict mode, ES2017 target, bundler module resolution, path aliases for `@/*` and all `@khaveeai/*` workspace packages mapped to their `src/index.ts`
- `tsconfig.packages.json` — shared base config referenced by individual package `tsconfig.json` files
- `next.config.ts` — minimal, no custom Next.js config options set
- `postcss.config.mjs` — Tailwind v4 plugin only
- `eslint.config.mjs` — flat config, ignores `node_modules`, `.next`, `out`, `build`, `next-env.d.ts`

## Platform Requirements

**Development:**
- Node.js (v18+ per CI, v23 observed locally) + pnpm 10.x
- Optional local Postgres+pgvector via Docker (`docker-compose.yml`: `pgvector/pgvector:pg16` image, exposed on host port 5434 mapped to container 5432, db `vrm_vectors`)
- Browser with WebGL, WebRTC, Web Audio API, and microphone access support for testing avatar/realtime features

**Production:**
- Deployment target not explicitly configured in-repo (no `vercel.json`, `Dockerfile` for the app, or deployment workflow beyond npm package publishing)
- `.github/workflows/publish.yml` automates npm publishing of workspace packages on `v*` tag push or manual dispatch (Node 18, `pnpm install` → `pnpm run build:packages` → `pnpm run test` (best-effort) → optional version bump → `pnpm run publish:all` using `NPM_TOKEN` secret → GitHub Release creation)
- No CI workflow runs lint/tests on pull requests — the only workflow present is the publish pipeline

---

*Stack analysis: 2026-06-17*
