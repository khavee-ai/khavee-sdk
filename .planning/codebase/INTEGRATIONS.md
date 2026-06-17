# External Integrations

**Analysis Date:** 2026-06-17

## APIs & External Services

**AI / LLM:**
- OpenAI Platform - chat completions, embeddings, Whisper STT, TTS, and Realtime (WebRTC) voice API
  - SDK/Client: `openai` npm package (mixed versions: root `^6.24.0`; providers pin `^4.0.0`–`^4.73.0` — see STACK.md version note)
  - Auth: `OPENAI_API_KEY` env var (server-side only) or per-call `apiKey`/`openaiApiKey` config field passed into provider constructors
  - Direct REST calls (no SDK) to `https://api.openai.com/v1/realtime/calls` for WebRTC SDP negotiation in `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:229-242`
  - Demo app also calls the legacy `https://api.openai.com/v1/realtime?model=...` endpoint directly from `src/app/api/negotiate/route.ts:12-22` (forwards browser SDP offer, server holds the API key)
  - Embeddings model defaults: `text-embedding-3-small` (`packages/providers/pgvector/src/PgVectorProvider.ts:30`), `text-embedding-3-small`/`text-embedding-3-large` (`packages/providers/rag/src/RAGProvider.ts:28,50`)
  - Realtime model defaults: `gpt-4o-realtime-preview` / `gpt-realtime-1.5` depending on provider version (`OpenAIRealtimeProvider.ts:75`, `:142`)
  - STT model default: `gpt-4o-mini-transcribe`; TTS model default: `gpt-4o-mini-tts` (`packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:31-33`)

**Khavee Platform API (hosted backend, external to this repo):**
- `https://api.platform.khavee.ai/api/v1` - default base URL for `KhaveeClient` (`packages/core/src/client/khavee-client.ts:36`)
  - Used for fetching project/preview data (`ProjectPreviewData` type) and presumably issuing ephemeral realtime tokens / STT/TTS/chat proxy endpoints referenced by the STT-TTS and realtime providers (`sttProxyEndpoint`, `ttsProxyEndpoint`, `chatProxyEndpoint`, `proxyEndpoint` config fields)
  - Client: `axios` instance with request interceptor injecting either `X-API-Key` (API key auth) or `Authorization: Bearer <jwt>` (JWT auth) — `packages/core/src/client/khavee-client.ts:30-60`
  - This is the production proxy layer that keeps the OpenAI API key off the browser for the STT/TTS pipeline provider (per inline comments in `STTClient.ts`, `ChatClient.ts`, `TTSPlayer.ts`: "OpenAI API key never reaches the browser")

**Vector Search:**
- Qdrant (self-hosted or Qdrant Cloud) - vector database for RAG document storage/search
  - SDK/Client: `@qdrant/js-client-rest` (`packages/providers/qdrant/src/QdrantClient.ts`, `packages/providers/rag/src/RAGProvider.ts`)
  - Auth: `QDRANT_API_KEY` env var; host via `QDRANT_HOST` env var (default `http://localhost:6333`) — read in `packages/providers/qdrant` config defaults
  - Supports `:memory:` mode for in-process/testing usage (`QdrantClient.ts:52-53`)

## Data Storage

**Databases:**
- PostgreSQL with pgvector extension - primary vector store for the `pgvector` provider's RAG/document-search flow
  - Connection: `DATABASE_URL` env var (read in `src/app/pgvector/actions.ts:14`, `src/app/rag-realtime/actions.ts:8`, and constructor of `PgVectorProvider`)
  - Client: `pg` (`Pool`/`PoolClient`) - raw SQL, no ORM (`packages/providers/pgvector/src/PgVectorProvider.ts:1,24-27`)
  - Schema managed by hand-written `migrate()` method that runs `CREATE EXTENSION IF NOT EXISTS vector`, creates a `documents` table (configurable name), and an HNSW cosine-similarity index (`PgVectorProvider.ts:57-79`)
  - Local dev instance provided via `docker-compose.yml`: image `pgvector/pgvector:pg16`, container `vrm_postgres`, host port `5434` → container `5432`, db name `vrm_vectors`, default user/password `postgres`/`postgres`
  - Note: `drizzle-orm`/`drizzle-kit` are declared as dependencies at the repo root but have zero usage in source (no `drizzle.config.ts`, no imports) — not an active integration

**Vector Database (alternative/parallel path):**
- Qdrant - see "Vector Search" above; used as an alternative to pgvector for RAG (`packages/providers/rag`, `packages/providers/qdrant`)

**File Storage:**
- Local filesystem only — VRM/GLB avatar models served as static assets from `public/models/`, audio assets from `public/audio/`. No cloud object storage (S3/GCS/etc.) integration detected.

**Caching:**
- None detected — no Redis/Memcached client or cache layer found in dependencies or source.

## Authentication & Identity

**Auth Provider:**
- Custom — no third-party auth provider (no Auth0/Clerk/NextAuth/Firebase Auth dependency found)
  - `KhaveeClient` (`packages/core/src/client/khavee-client.ts`) supports two auth schemes for talking to the hosted Khavee platform API: static API key (`X-API-Key` header) or JWT bearer token (`Authorization: Bearer`)
  - STT/TTS provider client classes (`STTClient.ts`, `ChatClient.ts`, `TTSPlayer.ts`) all forward a JWT `authToken` as `Authorization: Bearer` to backend proxy endpoints — the JWT issuance/validation logic itself lives outside this repo (consumed, not implemented, here)
  - The demo Next.js app's own `/api/negotiate` route has no auth — it only checks for the presence of `OPENAI_API_KEY` server-side env var

## Monitoring & Observability

**Error Tracking:**
- None detected — no Sentry/Bugsnag/Datadog dependency found.

**Logs:**
- `console.error`/`console.log` only, scattered throughout providers and demo app (e.g., `src/app/api/negotiate/route.ts:26`). No structured logging library.

## CI/CD & Deployment

**Hosting:**
- Not configured in-repo. No `vercel.json`, `Dockerfile` for the Next.js app, or hosting-specific config detected. The `docker-compose.yml` only provisions a local Postgres dev dependency, not app deployment.

**CI Pipeline:**
- GitHub Actions — single workflow `.github/workflows/publish.yml`:
  - Trigger: push of `v*` tags, or manual `workflow_dispatch` with a version-bump choice
  - Steps: checkout → Node 18 setup → pnpm setup → `pnpm install` → `pnpm run build:packages` → `pnpm run test` (best-effort, falls through on failure) → optional version bump → `pnpm run publish:all` (publishes all workspace packages to npm using `NPM_TOKEN` secret) → creates a GitHub Release
  - No PR-triggered lint/test/build workflow exists — quality gates only run at publish time

## Environment Configuration

**Required env vars (collected from source):**
- `OPENAI_API_KEY` - OpenAI authentication; read server-side in `src/app/api/negotiate/route.ts`, `src/app/pgvector/actions.ts`, `src/app/rag-realtime/actions.ts`, and passed into `PgVectorProvider`/`RAGProvider` constructors
- `DATABASE_URL` - PostgreSQL connection string for pgvector-backed flows (`src/app/pgvector/actions.ts`, `src/app/rag-realtime/actions.ts`)
- `QDRANT_HOST` - Qdrant server URL, defaults to `http://localhost:6333` if unset
- `QDRANT_API_KEY` - Qdrant authentication token (optional, required for Qdrant Cloud)

**Secrets location:**
- No `.env*` files are committed (`.gitignore` excludes `.env*`). Secrets are expected to be supplied via the deployment environment (e.g., process env, hosting platform secrets) or, for CI publishing, the `NPM_TOKEN` GitHub Actions secret.

## Webhooks & Callbacks

**Incoming:**
- `POST /api/negotiate` (`src/app/api/negotiate/route.ts`) — receives a raw WebRTC SDP offer from the browser-side OpenAI Realtime client, forwards it server-side to OpenAI with the API key attached, and returns the SDP answer. This is the only HTTP route in the demo app; it acts as a thin SDP-relay proxy, not a generic webhook receiver.

**Outgoing:**
- None — no outbound webhook dispatch (e.g., to Slack, Stripe-style event delivery) detected in source.

---

*Integration audit: 2026-06-17*
