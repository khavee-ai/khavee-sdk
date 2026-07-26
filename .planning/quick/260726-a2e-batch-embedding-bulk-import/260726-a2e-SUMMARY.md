---
phase: quick-260726-a2e
plan: 01
subsystem: pgvector-provider
tags: [pgvector, embeddings, performance, bulk-insert]
dependency-graph:
  requires: []
  provides:
    - "PgVectorProvider.embedBatch (private, batched OpenAI embeddings)"
    - "PgVectorProvider.insertDocumentWithEmbedding (private, single INSERT code path)"
  affects:
    - "PgVectorProvider.bulkInsertDocuments"
    - "PgVectorProvider.insertDocument"
    - "PgVectorProvider.importCSV (indirectly, via bulkInsertDocuments)"
tech-stack:
  added: []
  patterns:
    - "Batched external API calls (chunk to array `input`, sort by response `index` before use, throw on count mismatch) instead of one call per item"
    - "Extract-and-delegate for shared SQL (mirrors runVectorQuery from 260726-9cq)"
key-files:
  created:
    - packages/providers/pgvector/scripts/verify-batch-embedding.cjs
  modified:
    - packages/providers/pgvector/src/PgVectorProvider.ts
    - packages/providers/pgvector/src/types.ts
    - packages/providers/pgvector/package.json
    - packages/providers/pgvector/README.md
decisions:
  - "embeddingBatchSize (100) is a private, non-configurable constant rather than a new PgVectorConfig field — no consumer need to tune it, and it keeps the public config surface from growing"
  - "concurrency's meaning changes from 'parallel embedding requests' to 'parallel INSERT statements per embedding batch' — a transparent internal reinterpretation since BulkInsertResult and timing characteristics for callers are unaffected"
metrics:
  duration: "~25 min"
  completed: "2026-07-26"
---

# Phase quick-260726-a2e Plan 01: Batch Embedding for Bulk Import Summary

Batches `bulkInsertDocuments`'s embedding calls into chunks of 100 texts per OpenAI `embeddings.create` request (down from one request per row), while keeping `BulkInsertResult`'s per-row error granularity and every public method signature unchanged.

## What Was Built

**Task 1 — Batch embedding in `bulkInsertDocuments`:**
- Added `private readonly embeddingBatchSize = 100` — an internal tuning constant, deliberately not exposed on `PgVectorConfig`.
- Added `private async embedBatch(texts: string[]): Promise<number[][]>` — chunks input into groups of 100, makes one `embeddings.create` call per chunk, sorts a copy of the response by `index` before mapping to embeddings (defensive against out-of-order API responses), throws `Embedding batch size mismatch: sent N texts, received M embeddings` if a chunk's response count doesn't match, and returns a flat array index-aligned to the input order. Errors are not caught here — the caller owns row-error attribution.
- Extracted `private async insertDocumentWithEmbedding(content, metadata, embedding): Promise<PgVectorDocument>` — the exact former body of `insertDocument` (verbatim SQL move), now the single place the INSERT is built.
- `insertDocument` now: embeds once via `embed()`, then delegates to `insertDocumentWithEmbedding`.
- Rewrote `bulkInsertDocuments` as an outer loop over `embeddingBatchSize`-sized chunks (one `embedBatch` call per chunk) and an inner loop over `concurrency`-sized slices for parallel INSERTs. A zero/negative/NaN `concurrency` is now guarded to `Math.max(1, Math.floor(concurrency) || 1)`, closing a pre-existing infinite-loop hazard. A chunk's embedding failure attributes `failed`/`errors` to every row in that chunk (correct 1-indexed row numbers against the original `rows` array) and `continue`s to the next chunk rather than aborting the whole import. Each row's INSERT stays individually try/caught, so one row's constraint violation doesn't take down its chunk siblings.
- Updated `PgVectorConfig.defaultConcurrency` and `CSVImportOptions.concurrency` doc comments to reflect the new meaning (parallel INSERTs per batch, not parallel embedding requests).

**Task 2 — Verification script:**
- Created `packages/providers/pgvector/scripts/verify-batch-embedding.cjs`, matching the header-comment/stub/`VERIFY_OK` convention of the sibling `verify-search-dedupe.cjs`. Stubs `pool.query` and `openai.embeddings.create` via bracket-access on the built `PgVectorProvider` instance (no source change needed for testability), with injectable `failOn(content)` and `failOnCall(n)` hooks and a `reverseData` flag.
- Six assertion groups cover: batching (250 rows -> 3 calls of 100/100/50), ordering/alignment under a reversed API response, per-chunk embedding-failure isolation (rows 101..200 fail, no INSERT attempted for them, other chunks unaffected), per-row INSERT-failure isolation (only row 7 fails, its chunk siblings insert), `insertDocument` unchanged behavior (1 string-input embed call + 1 pool query), and empty-input short-circuit (zero embed calls, zero pool queries).
- Wired `"verify:batch": "node scripts/verify-batch-embedding.cjs"` in `package.json` alongside the existing `verify:search`.

**Task 3 — Docs and version bump:**
- Updated the `bulkInsertDocuments`/`importCSV` API-reference rows, the `CSVImportOptions.concurrency` type comment, and `defaultConcurrency`'s config-table description to describe batched embedding and the new meaning of `concurrency`.
- Added a "Batched embedding during bulk import" README section stating the 267-row -> 3-call reduction, that the batch size is an internal non-configurable constant, that signatures/`BulkInsertResult` are unchanged, and the per-batch vs per-row failure semantics.
- Bumped `packages/providers/pgvector/package.json` version `0.3.3` -> `0.3.4`. No publish, tag, or push performed.

## Verification Results

- `pnpm --filter @khaveeai/providers-pgvector build` — clean `tsc` build under `strict: true`.
- `pnpm --filter @khaveeai/providers-pgvector verify:batch` — `VERIFY_OK`.
- `pnpm --filter @khaveeai/providers-pgvector verify:search` — `VERIFY_OK` (search path undisturbed).
- Grep gates: exactly one non-comment `INSERT INTO` occurrence in `PgVectorProvider.ts` (inside `insertDocumentWithEmbedding`); zero remaining internal `this.insertDocument(` call sites; `embedBatch` and `insertDocumentWithEmbedding` both present as private methods.
- `git diff --stat` across the three commits touches exactly the five files declared in the plan's `files_modified`: `PgVectorProvider.ts`, `types.ts`, `verify-batch-embedding.cjs` (new), `package.json`, `README.md`. `embed()`, `search`/`searchDocuments`/`searchByEmbedding`/`runVectorQuery`, `importCSV`, and `parseCSV` are untouched (spot-checked via diff and by confirming `insertDocument` is defined exactly once at line 137 with no other call sites).
- Version confirmed `0.3.4` via `node -e` check; README contains the new "batch" documentation.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None — this plan's threat model already anticipated the only new surface (the `embeddings.create` response -> row pairing, T-A2E-01) and it was mitigated exactly as specified (index-sort + count-mismatch throw). No other new network endpoints, auth paths, file access patterns, or schema changes were introduced.

## Known Stubs

None.

## Self-Check: PASSED

- `packages/providers/pgvector/src/PgVectorProvider.ts` — FOUND, contains `embedBatch` and `insertDocumentWithEmbedding`.
- `packages/providers/pgvector/src/types.ts` — FOUND, updated doc comments present.
- `packages/providers/pgvector/scripts/verify-batch-embedding.cjs` — FOUND, `verify:batch` script exits 0 with `VERIFY_OK`.
- `packages/providers/pgvector/package.json` — FOUND, version `0.3.4`, `verify:batch` script present.
- `packages/providers/pgvector/README.md` — FOUND, "Batched embedding during bulk import" section present.
- Commit `ab83133` (Task 1, `feat(pgvector): batch embeddings in bulkInsertDocuments`) — FOUND in `git log --oneline --all`.
- Commit `5177d5a` (Task 2, `test(pgvector): add verify-batch-embedding script`) — FOUND in `git log --oneline --all`.
- Commit `1140c0f` (Task 3, `docs(pgvector): document batched embedding, bump to 0.3.4`) — FOUND in `git log --oneline --all`.
