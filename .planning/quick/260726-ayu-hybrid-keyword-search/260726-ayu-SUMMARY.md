---
phase: quick-260726-ayu-hybrid-keyword-search
plan: 01
subsystem: packages/providers/pgvector
tags: [rag, hybrid-search, pg_trgm, thai-language]
requires: []
provides:
  - keyword-similarity-search
  - pg-trgm-migration
affects:
  - packages/providers/pgvector/src/PgVectorProvider.ts
  - packages/providers/pgvector/src/types.ts
tech-stack:
  added: []
  patterns:
    - "pg_trgm trigram similarity instead of tsvector/ts_rank, chosen specifically because Thai script has no word-boundary whitespace, which breaks stock Postgres FTS tokenization"
    - "runKeywordQuery private helper mirrors the existing runVectorQuery extraction pattern"
key-files:
  created:
    - packages/providers/pgvector/scripts/verify-keyword-search.cjs
  modified:
    - packages/providers/pgvector/src/PgVectorProvider.ts
    - packages/providers/pgvector/src/types.ts
    - packages/providers/pgvector/package.json
    - packages/providers/pgvector/README.md
decisions:
  - "Used pg_trgm (character-trigram similarity) instead of tsvector/ts_rank full-text search — Postgres FTS tokenizes on whitespace, and Thai script has no spaces between words, so stock FTS configs would fail to segment Thai text into meaningful tokens. pg_trgm is language-agnostic (character n-grams), works regardless of word boundaries."
  - "defaultKeywordThreshold defaults to 0.15, lower than pg_trgm's own 0.3 operator default, since that default was tuned for English word-level fuzzy matching, not Thai character-run matching — documented as needing empirical tuning against real query traffic, same as the app's cosine thresholds were tuned this session."
  - "Minor version bump (0.3.4 -> 0.4.0) rather than patch, since this adds a new capability + schema migration, even though fully additive/backward-compatible."
metrics:
  duration: "~20 minutes (executor session was interrupted by a platform rate limit after all 3 code commits landed; this summary was completed by the orchestrator after independently re-verifying build + all three verify scripts)"
  completed: "2026-07-26"
---

# Quick Task 260726-ayu: Hybrid Keyword Search (pg_trgm) Summary

Added a keyword-similarity search method to `@khaveeai/providers-pgvector`, to complement the existing pure-vector cosine search. This is the SDK half of RAG-improvement item #3 (hybrid keyword+vector search) — the app-side consumer task (wiring this into `searchKnowledgeBase`'s RRF fusion) is a separate, not-yet-started follow-up in khavee-app.

## What Was Done

### Task 1: Config + migration (commit `e03f0af`)

- Added `defaultKeywordThreshold?: number` to `PgVectorConfig`, defaulting to `0.15` in the constructor.
- Added optional `searchByKeyword?` member to the `VectorSearchProvider` interface (non-breaking — mirrors the `searchByEmbedding?` pattern from a prior task).
- `migrate()` now also runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and `CREATE INDEX IF NOT EXISTS ${tableName}_content_trgm_idx ON ${tableName} USING gin (content gin_trgm_ops)` — `IF NOT EXISTS`, no DROP (unlike the embedding HNSW index), since the trigram index has no tunable params to change across re-runs.

### Task 2: `searchByKeyword` + `runKeywordQuery` (commit `9b39e90`)

- New public `searchByKeyword(query, topK?, threshold?, metadataFilter?): Promise<PgVectorSearchResult[]>`.
- New private `runKeywordQuery` SQL-building helper, structurally mirroring `runVectorQuery` (with/without `metadataFilter` branches, same param-ordering convention), using `similarity(content, $1)` for both the threshold filter and `ORDER BY ... DESC`.
- Returns the same `PgVectorSearchResult` shape as vector search — the `similarity` field holds trigram score instead of cosine score. This is intentional: the app's RRF fusion only uses rank order within each list, not cross-list score comparability, so the scale difference doesn't matter for that consumer.

### Task 3: Verification + docs + version bump (commit `15dbb17`)

- `scripts/verify-keyword-search.cjs` (hand-rolled `node:assert`, no test framework, matching the existing `verify-search-dedupe.cjs`/`verify-batch-embedding.cjs` convention) — mocks both `pool.query` and `pool.connect`/`client.query` (needed since `migrate()` uses the connect+client pattern, not `pool.query` directly).
- `verify:keyword` script added to `package.json`.
- README updated with a hybrid-search section explaining the pg_trgm choice and the Thai-language rationale.
- Version bumped `0.3.4` → `0.4.0`.

## Verification Results

All three verify scripts pass (re-confirmed independently after the executor session was interrupted):
- `verify:keyword` — VERIFY_OK
- `verify:batch` — VERIFY_OK (prior task's work undisturbed)
- `verify:search` — VERIFY_OK (prior task's work undisturbed)
- `tsc` build — clean, zero errors, version confirmed `0.4.0` in build output

**What was verified:** SQL text and parameter shape only — that `searchByKeyword`/`runKeywordQuery` build the correct `similarity(content, $1)` query with correct param binding (3-arg no-filter, 4-arg with `metadata @> $4::jsonb`), that `migrate()` issues the expected `CREATE EXTENSION`/`CREATE INDEX` calls, and that the default threshold resolves to `0.15` when unset. All via mocked `pool`/`client`, no live database, no live OpenAI calls.

**What was explicitly NOT verified — and cannot be verified by this task:** actual trigram-matching search QUALITY on real Thai content (i.e., whether `similarity(content, query) >= 0.15` actually surfaces the right documents for real Thai queries against the real knowledge base). That requires a live Postgres with `pg_trgm` enabled and real content, which only exists once this is wired into khavee-app and `migrate()` is run against the actual dev database. Do not treat this quick task as proof the hybrid search actually works well — only that it is correctly wired at the SQL/interface level.

## Deviations from Plan

None in the code itself. Process deviation only: the gsd-executor subagent hit a platform API rate limit after all 3 commits landed but before writing this SUMMARY.md — the orchestrator (this session) independently re-verified the build and all three verify scripts before writing this summary, rather than trusting the interrupted agent's unfinished output.

## Commits

- `e03f0af` — feat(pgvector): add keyword-threshold config, optional interface member, pg_trgm migration (Task 1)
- `9b39e90` — feat(pgvector): add searchByKeyword public method and runKeywordQuery helper (Task 2)
- `15dbb17` — docs(pgvector): add keyword-search verification script, bump to 0.4.0, README hybrid-search docs (Task 3)

## Self-Check

- FOUND: packages/providers/pgvector/src/PgVectorProvider.ts (modified, searchByKeyword + runKeywordQuery present)
- FOUND: packages/providers/pgvector/src/types.ts (modified, defaultKeywordThreshold + searchByKeyword? present)
- FOUND: packages/providers/pgvector/scripts/verify-keyword-search.cjs (created, VERIFY_OK)
- FOUND: commit e03f0af
- FOUND: commit 9b39e90
- FOUND: commit 15dbb17
- FOUND: package.json version 0.4.0

## Self-Check: PASSED
