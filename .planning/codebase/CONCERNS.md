# Codebase Concerns

**Analysis Date:** 2026-06-17

## Tech Debt

**Duplicated MFCC/DTW lip-sync analyzer (two ~600-line near-identical classes):**
- Issue: `RealtimeAudioAnalyzer` in `packages/react/src/hooks/useRealtime.ts` (lines 293-752) and `AudioFileAnalyzer` in `packages/react/src/hooks/useAudioLipSync.ts` (lines 192-522) implement the same MFCC feature comparison, DTW distance function, formant-peak detection, vowel classifiers (`classifyAA`/`classifyIH`/`classifyOU`/`classifyEE`/`classifyOH`), and `phonemeToMouthState` mapping. The `computeDTW` function and `phonemeToMouthState` function are copy-pasted verbatim in both files.
- Files: `packages/react/src/hooks/useRealtime.ts`, `packages/react/src/hooks/useAudioLipSync.ts`
- Impact: Any bug fix or tuning change to phoneme detection (thresholds, intensity curves, formant ranges) must be applied twice or behavior silently diverges between live TTS lip-sync and pre-recorded audio lip-sync. The phoneme templates already differ slightly between the two files (different magnitude values for `ee`/`aa`/`ou`/`oh`/`ih`), suggesting drift has already begun.
- Fix approach: Extract a shared `MFCCPhonemeAnalyzer` (or formant-fallback analyzer) module with a single audio-source abstraction (`AnalyserNode` + `AudioContext`) that both hooks consume, and a single shared `phonemeTemplates` / `phonemeToMouthState` module.

**Untyped `any` usage across provider and hook internals:**
- Issue: 39+ instances of `: any` / `as any` / `<any>` in core SDK code (excluding tests/dist), concentrated in `realtimeProvider: any` config fields, Meyda callback typings, and OpenAI session config builders.
- Files: `packages/react/src/hooks/useRealtime.ts` (lines 298, 304, 461, 498, 501), `packages/react/src/hooks/useAudioLipSync.ts` (lines 203, 246, 272), `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` (lines 60, 66, 140, 169, 390, 577), `packages/providers/qdrant/src/QdrantClient.ts` (lines 152, 515, 577, 582, 583), `packages/core/src/client/khavee-client.ts` (line 12), `packages/core/src/types/qdrant.ts` (lines 15, 141)
- Impact: Loses compile-time safety on tool-call argument shapes, Meyda feature payloads, and Qdrant filter conditions — increases risk of silent runtime type errors, especially around `RealtimeTool.execute(args: any)` which is part of the public SDK surface (`packages/core/src/types/realtime.ts:18`).
- Fix approach: Introduce a typed `MeydaFeatures` interface, type `RealtimeAudioAnalyzer.config.realtimeProvider` against the `RealtimeProvider` interface instead of `any`, and define discriminated-union types for Qdrant filter conditions.

**Empty/phantom `azure` provider package:**
- Issue: `packages/providers/azure` contains zero source files, no `package.json`, and only an empty `node_modules` directory, yet it is matched by the `packages/providers/*` glob in `pnpm-workspace.yaml`.
- Files: `packages/providers/azure/` (directory only), `pnpm-workspace.yaml`
- Impact: Dead scaffolding suggests an abandoned/planned provider. Harmless to builds today (pnpm skips packages without `package.json`) but misleads anyone exploring the `providers/` directory into thinking Azure TTS/STT support exists.
- Fix approach: Either implement the Azure provider or delete the empty directory to avoid confusion.

**Empty `wordpress-plugin` scaffolding:**
- Issue: `wordpress-plugin/includes/` and `wordpress-plugin/src/` are both completely empty directories with no PHP files, no plugin header, no `package.json`.
- Files: `wordpress-plugin/`
- Impact: Suggests a planned integration that never started; clutters repo root and the project README references SDK-only usage, not WordPress, creating a discoverability mismatch.
- Fix approach: Remove until there is actual plugin code, or add a `.gitkeep` + README stub explaining the planned scope if intentionally reserved.

**Near-total absence of automated tests:**
- Issue: Of 10 workspace packages, only `packages/providers/openai-stt-tts` has test files (`STTClient.test.ts`, `ChatClient.test.ts`, `OpenAISTTTTSProvider.test.ts` — 3 files, ~470 lines). `packages/core` (11 source files), `packages/react` (10 source files, including the 813-line `useRealtime.ts` and 772-line `VRMAvatar.tsx`), `packages/providers/openai-realtime` (801-line `OpenAIRealtimeProvider.ts`), `packages/providers/pgvector`, `packages/providers/qdrant` (624-line `QdrantClient.ts`), and `packages/providers/rag` have zero tests.
- Files: `packages/core/src/`, `packages/react/src/`, `packages/providers/openai-realtime/src/`, `packages/providers/pgvector/src/`, `packages/providers/qdrant/src/`, `packages/providers/rag/src/`
- Impact: The most complex, stateful, and bug-prone code (WebRTC session lifecycle, VAD turn-taking, lip-sync signal processing, vector search SQL construction) has no regression safety net. Recent commit history (`e127a84 fix(stt-tts): prevent double-fire and VAD loopback`, `2ea6e92 fix(stt-tts): fix mic disable, avatar lipsync...`, `1db618e fix(providers): delay speaking status until audio plays...`) shows this exact class of provider is actively accumulating hand-found bugs that tests would likely have caught earlier.
- Fix approach: Prioritize unit tests for `OpenAIRealtimeProvider` session/teardown lifecycle and `useRealtime.ts` effect cleanup (provider callback rewiring) before adding new features to those files, since they are both large and currently fragile (see Fragile Areas below).

**Inconsistent error-result conventions across providers:**
- Issue: `QdrantClient` swallows errors and logs to `console.error` then frequently returns empty arrays/defaults (e.g. `searchDocuments` catch blocks at `packages/providers/qdrant/src/QdrantClient.ts:328,357`), while `OpenAISTTTTSProvider` and `OpenAIRealtimeProvider` re-throw via `onError?.()` callbacks, and Next.js server actions in `src/app/pgvector/actions.ts` return `{ success: false, error: String(e) }` objects.
- Files: `packages/providers/qdrant/src/QdrantClient.ts`, `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`, `src/app/pgvector/actions.ts`
- Impact: Consumers of the SDK cannot rely on one error-handling pattern; some providers fail silently (returning empty data that looks like "no results found" instead of "request failed"), which can mask real failures (e.g. wrong Qdrant API key) as empty search results.
- Fix approach: Standardize on a `Result<T, E>`-style return or consistently throw typed errors across all `VectorSearchProvider` / `RealtimeProvider` implementations.

## Known Bugs

**VAD/TTS echo loopback requires manual cooldown timers:**
- Symptoms: Without an explicit 500ms delay after TTS playback ends, the microphone (VAD) can pick up the assistant's own voice through speaker leakage and re-trigger a turn ("loopback").
- Files: `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` (lines 469-474, 477-479) — `await new Promise<void>((resolve) => setTimeout(resolve, 500))` appears twice, once in the success path and once in the catch path of `runTurnFromText`.
- Trigger: Any system without headphones/echo-cancellation where the speaker output bleeds into the microphone input during/just after a TTS response.
- Workaround: A flat 500ms cooldown plus the `_isTurnActive` flag during this window. This is a heuristic, not a robust acoustic echo cancellation (AEC) solution — fixed in commit `e127a84` and `2ea6e92` but remains fragile for slow hardware or longer TTS audio tails.

**Speaking status timing was previously wrong (recently patched, watch for regression):**
- Symptoms: Avatar chat status (`"speaking"`) used to be set as soon as TTS text was ready rather than when audio actually started playing, causing the avatar to appear to "speak" before any audio was audible.
- Files: `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` (lines 445, 459-463) — uses a `speakingStatusSet` flag inside the `onAudioData` callback passed to `ttsPlayer.speak()` to defer the status transition until the first audio buffer arrives.
- Trigger: Any TTS playback path that doesn't go through the `onAudioData` callback would skip this guard.
- Workaround: Already fixed per commit `1db618e fix(providers): delay speaking status until audio plays, fix useRealtime callback chain`. Flagged here as a regression risk because the underlying fragility (manually wiring `speakingStatusSet` per call site) is easy to reintroduce in new TTS playback code paths.

**`useRealtime.ts` chat-status callback chaining is manually re-wired on every mount:**
- Symptoms: `useRealtime`'s effect captures `provider.onChatStatusChange` as `upstreamChatStatusChange` and wraps it so both `KhaveeProvider` and `useRealtime` receive updates, then restores the upstream callback on cleanup (lines 46-49, 66-75, 110-115). If multiple components call `useRealtime()` simultaneously, or if `KhaveeProvider` and `useRealtime` mount/unmount in an unexpected order, this manual callback-chaining pattern can silently drop one consumer's updates.
- Files: `packages/react/src/hooks/useRealtime.ts`
- Trigger: Multiple `useRealtime()` call sites in the same component tree, or out-of-order mount/unmount during fast navigation/HMR.
- Workaround: None — current design assumes a single `useRealtime()` consumer per provider instance and careful effect ordering (relies on documented "React runs parent effects before child effects" assumption in the inline comment at line 47-48).

## Security Considerations

**Client-side OpenAI API key usage path exists by design:**
- Risk: `OpenAIRealtimeProvider.connect()` (lines 220-221) and `OpenAISTTTTSProvider.resolveAuthToken()` (line 219) both support a fallback where `config.apiKey` is used directly as the bearer token from the browser when `useProxy`/`proxyEndpoint` is not configured. If a developer integrating the SDK passes a raw OpenAI API key into client-side config (e.g. via `NEXT_PUBLIC_*` env var or hardcoded), the key is exposed in the browser bundle/network requests.
- Files: `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:220-225`, `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts:218-220`
- Current mitigation: The proxy path (`useProxy: true` + `proxyEndpoint`) is the documented/preferred pattern and the Next.js demo app correctly uses server-side `process.env.OPENAI_API_KEY` in `src/app/api/negotiate/route.ts` and `src/app/pgvector/actions.ts`. The direct-apiKey path exists explicitly "for direct SDK development" per the docstring at `OpenAISTTTTSProvider.ts:212-214`.
- Recommendations: Add a runtime warning (`console.warn`) when `apiKey` is used without `useProxy`, and clearly flag this configuration as dev-only / non-production in the public README and TypeScript doc comments so SDK consumers don't accidentally ship a real API key to production.

**SQL table name interpolated without sanitization in `PgVectorProvider`:**
- Risk: `this.tableName` (from `config.tableName`, user-supplied at construction) is directly interpolated into raw SQL strings via template literals in `migrate()`, `insertDocument()`, `listDocuments()`, and `searchDocuments()`, rather than being parameterized or validated against an allowlist pattern.
- Files: `packages/providers/pgvector/src/PgVectorProvider.ts` (lines 62, 70, 72-73, 94, 223, 233, 280-284, 297)
- Current mitigation: None — `tableName` defaults to `"documents"` and is only attacker-controlled if an application passes untrusted input into `PgVectorConfig.tableName` (e.g. from a query param or user-configurable setting). All other query values (content, metadata, embeddings, limits) correctly use parameterized `$1`/`$2` placeholders.
- Recommendations: Validate `tableName` against `/^[a-zA-Z_][a-zA-Z0-9_]*$/` in the constructor and throw if it doesn't match, since Postgres identifiers cannot be parameterized normally.

**Unauthenticated Next.js Server Actions for destructive DB operations:**
- Risk: `src/app/pgvector/actions.ts` exposes `migrateAction`, `insertAction`, `bulkAction`, `csvAction`, `deleteAction` as Next.js Server Actions with no authentication/authorization check. Any client that can reach the deployed app's action endpoint can run schema migrations or delete arbitrary documents by ID.
- Files: `src/app/pgvector/actions.ts`, `src/app/rag-realtime/actions.ts`
- Current mitigation: This is demo/example code (`src/app/pgvector/page.tsx` is an interactive SDK playground), not part of the published `@khaveeai/*` packages, so it's lower risk if the demo app itself is not deployed publicly with production credentials.
- Recommendations: Add an explicit comment/README warning that this demo route must not be deployed without auth middleware if exposed publicly, since `DATABASE_URL` and `OPENAI_API_KEY` are wired directly to it.

**Negotiate API route has no rate limiting or origin checks:**
- Risk: `src/app/api/negotiate/route.ts` forwards arbitrary SDP bodies to `https://api.openai.com/v1/realtime` using the server's `OPENAI_API_KEY` with no validation of the request origin, no rate limiting, and no session/user identity check.
- Files: `src/app/api/negotiate/route.ts`
- Current mitigation: None visible.
- Recommendations: Add origin/CORS restriction and basic rate limiting before this is used in a production deployment, since an attacker could use this endpoint to make billed OpenAI Realtime API calls using the server's credentials.

## Performance Bottlenecks

**Dual-loop state synchronization via `setInterval` polling:**
- Problem: `useRealtime.ts` sets up a 100ms `setInterval` (`stateSyncInterval`, line 107) purely as a "fallback" to keep React state in sync with provider state, running continuously for the lifetime of any connected session in addition to the event-callback-based updates.
- Files: `packages/react/src/hooks/useRealtime.ts` (lines 92-107, 119-120)
- Cause: Defensive polling layered on top of an event-driven architecture, likely added to paper over missed callback firings rather than fixing the root cause.
- Improvement path: Audit why callback-driven updates can be missed and remove the polling fallback, or increase the interval significantly (100ms causes 10 re-renders/sec minimum while connected).

**MFCC/DTW phoneme analysis runs every audio frame on the main thread:**
- Problem: `analyzeWithMFCC()` in both `useRealtime.ts` and `useAudioLipSync.ts` performs a full DTW comparison (`computeDTW`) against every template variation (4-13 templates per phoneme × up to 5 phonemes) on every Meyda callback (bufferSize 512 → roughly every ~11ms at 44.1kHz), all synchronously on the JS main thread.
- Files: `packages/react/src/hooks/useRealtime.ts` (lines 501-571), `packages/react/src/hooks/useAudioLipSync.ts` (lines 272-342)
- Cause: No throttling beyond the `isProcessing` flag + 30ms `setTimeout` cooldown; DTW is O(n·m) per template comparison and there's no Web Worker offloading.
- Improvement path: Move MFCC/DTW analysis to a Web Worker or AudioWorklet, or increase Meyda `bufferSize` to reduce callback frequency, especially important on lower-end devices running the avatar + Three.js render loop concurrently.

**Three.js/VRM render loop and avatar files are large, undocumented for perf budget:**
- Problem: `packages/react/src/VRMAvatar.tsx` is 772 lines and combines VRM loading, animation remapping, expression blending, and per-frame update logic in one component with no apparent memoization boundaries documented.
- Files: `packages/react/src/VRMAvatar.tsx`
- Cause: Single large component handling many concerns (model loading, animation crossfade, lipsync application, idle drift) increases risk of unnecessary re-renders cascading into the R3F render loop.
- Improvement path: Profile with React DevTools Profiler under a real session; consider splitting into a loader hook + a pure per-frame update hook (`useFrame`) to isolate re-render scope.

## Fragile Areas

**`OpenAISTTTTSProvider` turn lifecycle (`runTurn` / `runTurnFromText`):**
- Files: `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` (lines 355-483)
- Why fragile: Coordinates VAD pause/resume, mic enable/disable, TTS playback, and a manual 500ms cooldown across both the success and error paths of an async pipeline with several mutable instance flags (`_isTurnActive`, `micEnabled`, `speakingStatusSet`). The same recovery logic (resume mic, set `micEnabled = true`, wait 500ms, reset status) is duplicated between the try block (lines 472-475) and catch block (lines 477-480) — any future change to this sequence must be applied in both places or behavior diverges between success and failure paths.
- Safe modification: Extract the "resume + cooldown + ready" sequence into a single private helper used by both the success and error paths; add unit tests for interrupted/error turns before changing timing values.
- Test coverage: Partial — `OpenAISTTTTSProvider.test.ts` covers interface conformance and basic turn flow but the file list doesn't indicate explicit test coverage for the error-path duplicate recovery logic or the VAD-loopback cooldown timing.

**`useRealtime.ts` effect-based callback rewiring:**
- Files: `packages/react/src/hooks/useRealtime.ts` (lines 43-127)
- Why fragile: A single `useEffect` wires seven different provider callbacks (`onConnect`, `onDisconnect`, `onConversationUpdate`, `onChatStatusChange`, `onVolumeChange`, `onAudioData`) plus a polling interval, and depends on `realtimeProvider` only — meaning `lipSyncAnalyzer`, captured by closure inside callbacks, can be stale relative to state updates (the comment at line 127 explicitly acknowledges removing `lipSyncAnalyzer` from the dependency array "to prevent recreation," a deliberate but fragile workaround for effect-dependency churn).
- Safe modification: Treat `lipSyncAnalyzer` as a `useRef` instead of `useState` if it must be read inside the effect without retriggering it, removing the need to suppress the exhaustive-deps lint rule implicitly.
- Test coverage: None — `packages/react` has zero test files.

**Duplicated lip-sync analyzer classes (cross-reference Tech Debt above):**
- Files: `packages/react/src/hooks/useRealtime.ts`, `packages/react/src/hooks/useAudioLipSync.ts`
- Why fragile: Two independently-evolving implementations of the same signal-processing algorithm with already-diverged phoneme template tables and divergent fallback paths (`useRealtime`'s analyzer attempts `getDisplayMedia` then `getUserMedia` as a fallback at lines 388-432, while `useAudioLipSync`'s analyzer has no such fallback since it processes a known `<audio>` element).
- Safe modification: Do not patch one file without checking whether the same fix is needed in the other.
- Test coverage: None.

**`QdrantClient` (624 lines) filter-condition building with `any` typing:**
- Files: `packages/providers/qdrant/src/QdrantClient.ts` (lines 577-624 area, filter condition construction)
- Why fragile: Filter conditions are built into an `any[]` array (line 577) from a loosely-typed `operation = value as any` cast (line 582), making it easy to construct malformed Qdrant filter payloads that fail only at runtime against the live Qdrant server.
- Safe modification: Define a typed `QdrantFilterCondition` union before extending filter operators.
- Test coverage: None.

## Scaling Limits

**Chat history trimming caps conversation context, not token budget:**
- Current capacity: `OpenAISTTTTSProvider.trimHistory()` keeps at most `maxTurns * 2` non-system messages (default `maxTurns = 10` → 20 messages + 1 system message).
- Limit: This trims by message *count*, not token count, so very long individual messages can still blow past the model's context window even with only 10 turns retained.
- Files: `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts` (lines 496-514)
- Scaling path: Switch to a token-budget-aware trimming strategy (e.g. using `tiktoken` or the OpenAI usage response) instead of a fixed turn count.

**pgvector bulk insert concurrency is a fixed in-process batch size:**
- Current capacity: `bulkInsertDocuments()` defaults to `concurrency = 5` parallel embedding+insert operations per batch, looping synchronously through batches.
- Limit: For large CSV imports (`importCSV`), this means N/5 sequential round-trips to the OpenAI Embeddings API and Postgres, each gated by `Promise.all` — no backpressure handling, retry/backoff, or batch embedding API usage (each row issues a separate `embeddings.create()` call rather than batching multiple texts per request).
- Files: `packages/providers/pgvector/src/PgVectorProvider.ts` (lines 39-45, 107-130, 148-169)
- Scaling path: Use OpenAI's batch embedding input (`input: string[]`) to embed multiple documents per API call, reducing request count and latency for large imports.

## Dependencies at Risk

**`openai` SDK at major version 6 alongside Realtime API features still evolving:**
- Risk: `package.json` pins `"openai": "^6.24.0"`, and `OpenAIRealtimeProvider` hardcodes Realtime API session shapes (`sessionConfig.audio.output.format.type: "audio/pcm"`, model name fallback `"gpt-realtime-1.5"`) that are tied to a specific, still-evolving preview API surface.
- Impact: OpenAI Realtime API session config schema has changed multiple times historically (evidenced by the dual-shape `ProxyTokenResponse` type at `OpenAIRealtimeProvider.ts:17-26` supporting both `data.ephemeralToken` and flat `ephemeralToken`/`value` fields to handle backend response shape drift). Future OpenAI API changes could break `connect()` silently until manually re-tested.
- Migration plan: Add an integration smoke test that calls the real (or mocked) negotiate endpoint and asserts the session negotiates successfully, to catch upstream API drift quickly.

**`meyda` loaded via dynamic `import()` with no version pin verification at runtime:**
- Risk: Both lip-sync hooks dynamically `import("meyda")` and silently fall back to a cruder formant-peak-based analyzer if the import fails (`packages/react/src/hooks/useRealtime.ts:474-481`, `packages/react/src/hooks/useAudioLipSync.ts:254-261`). This fallback path is rarely exercised in normal operation and may have its own undiscovered bugs since the project effectively depends on Meyda always being present.
- Impact: If `meyda` is ever removed from `package.json` or fails to load in production (e.g. CSP blocking dynamic imports, bundler tree-shaking issue), the SDK silently degrades to a much less accurate lip-sync without any user-facing warning beyond a `console.warn`.
- Migration plan: Add explicit monitoring/telemetry around fallback-path activation so silent degradation is visible.

## Missing Critical Features

**No authentication/authorization layer for proxy endpoints:**
- Problem: The `proxyEndpoint`/`useProxy` pattern documented throughout (`OpenAIRealtimeProvider`, `OpenAISTTTTSProvider`) assumes the SDK consumer's backend handles auth, but none of the example routes (`src/app/api/negotiate/route.ts`, `src/app/pgvector/actions.ts`) demonstrate session/user-scoped authorization — they only check for the presence of an API key/env var, not who is calling.
- Blocks: Multi-tenant deployments where different end-users should have isolated rate limits, usage quotas, or access scopes cannot rely on the example code as a security reference.

**No retry/backoff for transient network failures in STT/TTS/Chat clients:**
- Problem: `STTClient`, `ChatClient`, and `TTSPlayer` (per `packages/providers/openai-stt-tts/src/`) appear to perform single-attempt fetches based on the provider's straight-through error propagation (`onError?.()` immediately on any caught error in `runTurn`/`runTurnFromText`).
- Blocks: Flaky network conditions (mobile users, brief API rate-limit blips) will surface as full turn failures rather than being transparently retried, degrading UX more than necessary for transient issues.

## Test Coverage Gaps

**WebRTC session lifecycle in `OpenAIRealtimeProvider`:**
- What's not tested: Connection negotiation, ICE/peer connection teardown, ephemeral token resolution branching (proxy vs. direct apiKey vs. neither), tool-call argument marshalling.
- Files: `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` (801 lines, 0 test files)
- Risk: This is the primary realtime voice provider; regressions in session teardown or reconnection logic would only surface via manual QA or production user reports.
- Priority: High

**VRM avatar rendering and animation remap logic:**
- What's not tested: `VRMAvatar.tsx` (772 lines) and `remapMixamoAnimationToVrm.ts` (100 lines, uses loosely-typed bone-node access with inline object-shape typing rather than proper THREE/VRM types) have no tests.
- Files: `packages/react/src/VRMAvatar.tsx`, `packages/react/src/utils/remapMixamoAnimationToVrm.ts`
- Risk: Animation retargeting bugs (e.g. Y-axis drift, mentioned as fixed in commit `2ea6e92 fix(stt-tts): fix mic disable, avatar lipsync, TTS config, and animation Y drift`) are exactly the class of visual regression that's hard to catch without snapshot/visual tests, and currently relies entirely on manual verification.
- Priority: Medium (visual bugs are user-visible but not data-corrupting)

**Lip-sync phoneme detection accuracy:**
- What's not tested: Neither `RealtimeAudioAnalyzer` nor `AudioFileAnalyzer`'s MFCC/DTW classification logic, formant peak detection, or intensity boost curves have unit tests against known audio fixtures.
- Files: `packages/react/src/hooks/useRealtime.ts`, `packages/react/src/hooks/useAudioLipSync.ts`
- Risk: The hardcoded MFCC templates and frequency thresholds (e.g. `classifyAA` formant ranges) were clearly tuned by trial and error (inline comments like "Increased from 4.0", "Lower threshold from -40", "Reduced for more responsive"); without fixture-based tests, any refactor of this code risks silently degrading lip-sync quality with no automated signal.
- Priority: Medium

**`QdrantClient` and `PgVectorProvider` query construction:**
- What's not tested: Filter-condition building (`QdrantClient.ts` lines ~577+), CSV parsing edge cases (`PgVectorProvider.parseCSV` — custom RFC-4180 parser), and SQL string construction with `tableName` interpolation.
- Files: `packages/providers/qdrant/src/QdrantClient.ts`, `packages/providers/pgvector/src/PgVectorProvider.ts`
- Risk: Both are core to the RAG feature set; the custom CSV parser in particular (hand-rolled rather than using the project's own `csv-parse` dependency already listed in `package.json`) is a likely source of edge-case bugs (e.g. embedded newlines in quoted fields, BOM handling) with no tests to catch regressions.
- Priority: Medium-High (directly affects data correctness for ingested knowledge-base content)

---

*Concerns audit: 2026-06-17*
