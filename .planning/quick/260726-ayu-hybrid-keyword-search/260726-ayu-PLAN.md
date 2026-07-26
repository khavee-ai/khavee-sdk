---
phase: quick/260726-ayu-hybrid-keyword-search
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/providers/pgvector/src/types.ts
  - packages/providers/pgvector/src/PgVectorProvider.ts
  - packages/providers/pgvector/scripts/verify-keyword-search.cjs
  - packages/providers/pgvector/package.json
  - packages/providers/pgvector/README.md
autonomous: true
requirements: [HKS-01, HKS-02, HKS-03, HKS-04, HKS-05]
must_haves:
  truths:
    - "A consumer can call `db.searchByKeyword(query)` and get back PgVectorSearchResult[] ranked by trigram similarity"
    - "`migrate()` enables pg_trgm and creates a GIN trigram index on `content` without rebuilding it on every re-run"
    - "`defaultKeywordThreshold` is configurable via PgVectorConfig and defaults to 0.15"
    - "No existing method (search/searchDocuments/searchByEmbedding/runVectorQuery/embedBatch/insertDocumentWithEmbedding/bulkInsertDocuments) changes signature or behavior"
    - "`VectorSearchProvider` gains searchByKeyword as an OPTIONAL member, so existing implementors still typecheck"
  artifacts:
    - path: "packages/providers/pgvector/src/PgVectorProvider.ts"
      provides: "searchByKeyword public method + runKeywordQuery private helper + migrate() pg_trgm additions"
      contains: "searchByKeyword"
    - path: "packages/providers/pgvector/src/types.ts"
      provides: "defaultKeywordThreshold config field + optional searchByKeyword interface member"
      contains: "defaultKeywordThreshold"
    - path: "packages/providers/pgvector/scripts/verify-keyword-search.cjs"
      provides: "dependency-free node:assert verification of generated SQL + param binding shape"
    - path: "packages/providers/pgvector/package.json"
      provides: "0.4.0 minor version bump + verify:keyword script"
  key_links:
    - from: "PgVectorProvider.searchByKeyword"
      to: "PgVectorProvider.runKeywordQuery"
      via: "direct call, mirroring searchByEmbedding -> runVectorQuery"
      pattern: "runKeywordQuery"
    - from: "runKeywordQuery"
      to: "postgres pg_trgm"
      via: "SQL similarity(content, $1)"
      pattern: "similarity\\(content, \\$1\\)"
    - from: "migrate()"
      to: "pg_trgm GIN index"
      via: "CREATE INDEX IF NOT EXISTS ... USING gin (content gin_trgm_ops)"
      pattern: "gin_trgm_ops"
---

<objective>
Add a keyword-based (trigram) search path to `@khaveeai/providers-pgvector`, complementing the existing cosine/vector search, so a consuming app can fuse both ranked lists via Reciprocal Rank Fusion instead of hand-patching per-term synonym lists.

Purpose: A Thai-language query containing "เสริมหน้าอก" currently loses to an unrelated document sharing the substring "หน้าอก" under pure cosine similarity. Exact/fuzzy character-level term matching fixes this class of failure generically.

Output: New `searchByKeyword` public method + `runKeywordQuery` private helper, `migrate()` additions for `pg_trgm` + a GIN trigram index, a `defaultKeywordThreshold` config knob, a dependency-free verification script, a 0.4.0 minor version bump, and README docs.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md

@packages/providers/pgvector/src/PgVectorProvider.ts
@packages/providers/pgvector/src/types.ts
@packages/providers/pgvector/scripts/verify-search-dedupe.cjs
@packages/providers/pgvector/README.md

<design_decisions_already_made>
These were researched before planning. Do NOT re-derive or second-guess them:

1. **`pg_trgm`, NOT `tsvector`/`to_tsvector`/`ts_rank`.** Postgres full-text search tokenizes on whitespace/punctuation. Thai script is written without inter-word spaces, so tsvector-based FTS cannot segment Thai into meaningful word tokens without a Thai-aware text search configuration that stock Postgres does not ship. `pg_trgm` operates on fixed-length character trigrams regardless of word boundaries, making it language-agnostic. It is a standard contrib module bundled in the `pgvector/pgvector:pg16` image this project uses.

2. **Default keyword threshold `0.15`, not pg_trgm's own `0.3` operator default.** pg_trgm's 0.3 default was tuned for English word-level fuzzy matching; Thai character-run matching needs a lower floor.

3. **Reusing `PgVectorSearchResult` (with `similarity` holding a trigram score) is intentional.** The app-side consumer fuses lists via RRF, which uses only each list's internal rank order — cross-list score-scale comparability is irrelevant.

4. **`CREATE INDEX IF NOT EXISTS` for the trigram index, no DROP.** The existing vector index uses DROP-then-CREATE so re-running `migrate()` can pick up changed HNSW tuning params. The trigram index has no such tunable params, so a DROP would just pay a needless rebuild cost on every `migrate()` call.
</design_decisions_already_made>

<interfaces>
Existing shapes the executor builds against (already in the codebase — use directly, no exploration needed):

From `packages/providers/pgvector/src/types.ts`:
```ts
export interface PgVectorDocument {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface PgVectorSearchResult extends PgVectorDocument {
  similarity: number;
}
```

From `packages/providers/pgvector/src/PgVectorProvider.ts` — the private helper whose structure the new keyword helper must mirror (with/without-filter branching, `[value, threshold, topK]` then optional `JSON.stringify(metadataFilter)` param ordering):
```ts
private async runVectorQuery(
  vec: string,
  topK: number,
  threshold: number,
  metadataFilter?: Record<string, unknown>
): Promise<PgVectorSearchResult[]>
```

`packages/providers/pgvector/src/index.ts` already re-exports `PgVectorProvider` and every type from `./types`, so **no index.ts change is required** by this task.
</interfaces>

<verification_scope_limitation>
**State this honestly in the SUMMARY and in the verification script's header comment. Do not overclaim.**

This package has no test runner (no vitest/jest, no `test` script) and this task forbids adding one. Verification is a dependency-free `node:assert` script that mocks `this.pool.query` / `this.pool.connect` via bracket access — exactly like the two existing `verify-*.cjs` scripts.

That means this task can verify ONLY:
- the SHAPE of the generated SQL (which clauses/functions appear)
- the parameter binding (count, order, values)
- the call count and structural passthrough of returned rows
- that `migrate()` issues the two new statements

It CANNOT verify that trigram similarity actually produces good Thai-language search results. That requires a live Postgres with `pg_trgm` enabled and real Thai content, which is out of scope here. The user will verify real search quality against their dev database in a separate follow-up step, after the app-side consumer task wires this into the existing RRF fusion in `searchKnowledgeBase`.
</verification_scope_limitation>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add keyword-threshold config, optional interface member, and pg_trgm migration</name>
  <files>packages/providers/pgvector/src/types.ts, packages/providers/pgvector/src/PgVectorProvider.ts</files>
  <action>
In `types.ts`:

1. Add a `defaultKeywordThreshold?: number;` field to `PgVectorConfig`, placed directly after the existing `defaultThreshold` field. Give it a single-line `/** ... */` doc comment matching the file's existing field-doc style, stating: default 0.15, and that this is the minimum pg_trgm trigram similarity (0–1) for keyword search — deliberately lower than pg_trgm's own 0.3 operator default because that default was tuned for English word-level fuzzy matching, whereas Thai character-run matching needs a lower floor. Note that real-world tuning against actual query traffic may be needed.

2. Add `searchByKeyword?` as an OPTIONAL member of the `VectorSearchProvider` interface, immediately after the existing optional `searchByEmbedding?` member, following the identical non-breaking-additive pattern (including a `/** Optional: ... */` block comment above it):
   `searchByKeyword?(query: string, topK?: number, threshold?: number, metadataFilter?: Record<string, unknown>): Promise<PgVectorSearchResult[]>;`
   Optional is required here so no existing implementor of `VectorSearchProvider` breaks.

In `PgVectorProvider.ts`:

3. Add `private defaultKeywordThreshold: number;` to the class field block, directly after `private defaultThreshold: number;`.

4. In the constructor, add `this.defaultKeywordThreshold = config.defaultKeywordThreshold ?? 0.15;` directly after the existing `this.defaultThreshold = ...` line, keeping the same `?? ` default-assignment style as its neighbors. Add a brief inline `//` comment above it explaining WHY 0.15 rather than pg_trgm's 0.3 (Thai character-run matching, per the reasoning above) — a why-not-what comment, per this repo's comment conventions.

5. In `migrate()`, AFTER the existing HNSW index creation and still inside the same `try` block, append exactly two statements:
   `await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");`
   `await client.query(\`CREATE INDEX IF NOT EXISTS ${this.tableName}_content_trgm_idx ON ${this.tableName} USING gin (content gin_trgm_ops)\`);`
   Add a short inline comment noting that unlike the embedding index above, this one uses `IF NOT EXISTS` with no DROP because it has no tunable params that could change between `migrate()` runs — dropping and rebuilding a GIN index on every call would be pure waste.

6. Extend the `migrate()` JSDoc to mention the pg_trgm extension and trigram index alongside the existing pgvector/table/HNSW description.

Do NOT reorder, modify, or remove any existing statement in `migrate()`. Do NOT touch any other method.
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk && pnpm --filter @khaveeai/providers-pgvector run build && grep -q "pg_trgm" packages/providers/pgvector/dist/PgVectorProvider.js && grep -q "gin_trgm_ops" packages/providers/pgvector/dist/PgVectorProvider.js && grep -q "defaultKeywordThreshold" packages/providers/pgvector/dist/index.d.ts && echo TASK1_OK</automated>
  </verify>
  <done>`tsc` build passes with strict mode; compiled output contains both `CREATE EXTENSION IF NOT EXISTS pg_trgm` and the `gin_trgm_ops` GIN index statement; `defaultKeywordThreshold` appears in the emitted `.d.ts`; existing `migrate()` statements are byte-identical to before.</done>
</task>

<task type="auto">
  <name>Task 2: Add searchByKeyword public method and runKeywordQuery private helper</name>
  <files>packages/providers/pgvector/src/PgVectorProvider.ts</files>
  <action>
Add a new section-divider comment block (matching the existing `// ── Vector search ──...` style) titled `// ── Keyword search ──...`, placed directly after the existing vector-search section (i.e. after `runVectorQuery`, before `// ── Delete ──`).

Inside it, add exactly two members:

1. PUBLIC method with this exact signature:
```
async searchByKeyword(
  query: string,
  topK: number = this.defaultTopK,
  threshold: number = this.defaultKeywordThreshold,
  metadataFilter?: Record<string, unknown>
): Promise<PgVectorSearchResult[]>
```
Body: a single delegation to `this.runKeywordQuery(query, topK, threshold, metadataFilter)`.

Give it a full JSDoc block (this repo requires JSDoc on new public SDK surface) with `@param` tags for all four params, covering:
- It is a trigram (`pg_trgm`) keyword search, NOT vector/cosine and NOT Postgres full-text search — and WHY: tsvector-based FTS cannot segment Thai text, which has no inter-word spaces, whereas trigrams are character-level and language-agnostic.
- The returned `similarity` field holds a trigram similarity score, not cosine similarity. Scores from this method are NOT comparable in scale to `search`/`searchByEmbedding` results — the intended consumption pattern is Reciprocal Rank Fusion, which uses only each list's internal rank order.
- `threshold` defaults to `config.defaultKeywordThreshold` (0.15), and real-world tuning against actual query traffic may be needed.
- Requires `migrate()` to have been run so the `pg_trgm` extension exists.
- No `@throws` — unlike `searchByEmbedding` there is no pre-flight validation to perform; a plain string query needs none.

2. PRIVATE helper, mirroring `runVectorQuery`'s exact structure:
```
private async runKeywordQuery(
  query: string,
  topK: number,
  threshold: number,
  metadataFilter?: Record<string, unknown>
): Promise<PgVectorSearchResult[]>
```
Use the identical `const hasFilter = metadataFilter && Object.keys(metadataFilter).length > 0;` guard, then two branches with the same param-ordering convention as `runVectorQuery`.

Filter branch SQL — select `id, content, metadata, created_at AS "createdAt", similarity(content, $1) AS similarity` from `${this.tableName}`, `WHERE similarity(content, $1) >= $2 AND metadata @> $4::jsonb`, `ORDER BY similarity(content, $1) DESC`, `LIMIT $3`; params `[query, threshold, topK, JSON.stringify(metadataFilter)]`.

No-filter branch: the same minus the `metadata @> $4::jsonb` clause; params `[query, threshold, topK]`.

Both branches `return rows as PgVectorSearchResult[];`.

Add a short JSDoc/comment on the helper noting it is the single place the trigram SQL is built, mirroring the `runVectorQuery` extraction, so the pattern stays uniform across both search sides.

Do NOT build a `searchByKeywordPrecomputed`-style split — YAGNI, one public method plus one private SQL-building helper is the whole scope. Do NOT modify `runVectorQuery`, `searchByEmbedding`, `searchDocuments`, or `search`.
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk && pnpm --filter @khaveeai/providers-pgvector run build && grep -q "searchByKeyword" packages/providers/pgvector/dist/index.d.ts && grep -c "similarity(content, \$1)" packages/providers/pgvector/dist/PgVectorProvider.js && node -e "const{PgVectorProvider:P}=require('./packages/providers/pgvector/dist/index.js');const p=new P({connectionString:'postgresql://x:x@127.0.0.1:1/x',openaiApiKey:'t'});if(typeof p.searchByKeyword!=='function')throw new Error('searchByKeyword missing');console.log('TASK2_OK')"</automated>
  </verify>
  <done>Build passes; `searchByKeyword` is present in the emitted `.d.ts` and callable on a constructed instance; compiled SQL contains `similarity(content, $1)` in both branches; `runVectorQuery` and all other pre-existing methods are unchanged.</done>
</task>

<task type="auto">
  <name>Task 3: Verification script, version bump, and README docs</name>
  <files>packages/providers/pgvector/scripts/verify-keyword-search.cjs, packages/providers/pgvector/package.json, packages/providers/pgvector/README.md</files>
  <action>
**A. Create `scripts/verify-keyword-search.cjs`.** Follow the `verify-search-dedupe.cjs` convention exactly: `require("node:assert/strict")`, `require("../dist/index.js")`, mock `provider["pool"]` via bracket access, `console.log("VERIFY_OK")` on success, `main().catch(e => { console.error(e); process.exit(1); })` at the bottom. No new npm dependency, no live DB, no OpenAI calls.

Header block comment must state the same two things the sibling scripts state (no test runner in this package; script is excluded from `package.json`'s `files` so it never ships) PLUS an explicit scope caveat: this verifies only the generated SQL shape and parameter binding — it does NOT and CANNOT verify that trigram similarity produces good Thai-language search results, which requires a live Postgres with `pg_trgm` and real Thai content.

The pool mock must support BOTH `query` (used by `searchByKeyword`) and `connect` (used by `migrate()`, which calls `this.pool.connect()` then `client.query(...)` and `client.release()`). Have `connect` return an object recording its own `query` calls and exposing a no-op `release`.

Assertions to make:

1. **No-filter param shape.** `await provider.searchByKeyword("เสริมหน้าอก", 5, 0.2)` issues exactly 1 pool query; its SQL contains `similarity(content, $1)`; params are exactly `["เสริมหน้าอก", 0.2, 5]` (length 3, in that order); SQL does NOT contain `metadata @>`.

2. **Filter param shape.** Same call with `{ userId: "u1" }` as the 4th arg → SQL contains `metadata @> $4::jsonb`; params length 4; `params[3] === JSON.stringify({ userId: "u1" })`; `params[0..2]` unchanged.

3. **Empty filter object takes the no-filter branch** (params length 3), matching the existing `hasFilter` semantics asserted in `verify-search-dedupe.cjs`.

4. **Structural passthrough.** Have the pool mock return a fixed `rows` array (e.g. one row `{ id: 1, content: "x", metadata: {}, createdAt: <Date>, similarity: 0.42 }`) and `assert.deepEqual` the method's return value against it. Add an inline comment stating plainly that this proves passthrough only — real similarity-ranking correctness depends on a live Postgres with pg_trgm and is NOT verified here.

5. **`migrate()` issues the new statements.** Call `await provider.migrate()`, collect the recorded `client.query` SQL strings, and assert: one matches `/CREATE EXTENSION IF NOT EXISTS pg_trgm/`; one matches `/CREATE INDEX IF NOT EXISTS\s+documents_content_trgm_idx/` and contains `gin (content gin_trgm_ops)`. Also assert the pre-existing statements are still present and un-regressed: `CREATE EXTENSION IF NOT EXISTS vector`, `CREATE TABLE IF NOT EXISTS documents`, `DROP INDEX IF EXISTS documents_embedding_idx`, and the HNSW `CREATE INDEX ... USING hnsw`. Assert the trigram index statement does NOT have a preceding `DROP INDEX ... _content_trgm_idx` (the deliberate no-DROP decision).

6. **Default threshold.** Construct a provider with NO `defaultKeywordThreshold` in config, call `await provider.searchByKeyword("q")` with no threshold arg, and assert `params[1] === 0.15` and `params[2] === 5` (the `defaultTopK` default). Then construct a second provider with `defaultKeywordThreshold: 0.05` and assert the same call binds `params[1] === 0.05`.

Note: use `similarity` as a plain substring check on SQL — do not use a bare `grep`-style count gate anywhere; all assertions are in-script `node:assert`.

**B. `package.json`:** bump `"version"` from `0.3.4` to `0.4.0` (minor bump: this adds a new capability plus a schema-migration addition, not just an internal perf tweak — even though it is fully backward-compatible/additive). Add `"verify:keyword": "node scripts/verify-keyword-search.cjs"` to `scripts`, alongside the existing `verify:search` / `verify:batch`. Change nothing else in this file. **Do NOT run `git tag`, `git push`, or `npm publish`** — publishing remains a separate step the user authorizes afterward.

**C. `README.md`:** extend, matching existing structure and tone:
- Update the intro paragraph to mention trigram keyword search alongside cosine-similarity search.
- Add a `defaultKeywordThreshold` row to the Configuration table: type `number`, default `0.15`, describing it as the minimum pg_trgm trigram similarity for `searchByKeyword`, and noting it is deliberately below pg_trgm's own 0.3 default.
- Add items 4 and 5 to the "What `migrate()` sets up" numbered list for the pg_trgm extension and the `<tableName>_content_trgm_idx` GIN index, noting the index uses `IF NOT EXISTS` (no drop/recreate) unlike the HNSW index.
- Add a `searchByKeyword` row to the API reference table.
- Add a `searchByKeyword` entry to the `VectorSearchProvider` snippet in the Types section (as an optional member).
- Add a new `## Hybrid search: keyword + vector` section after the "Reusing an embedding across multiple searches" section, covering: why tsvector/FTS is unsuitable for Thai and trigrams are not; a short code example running `searchByEmbedding` and `searchByKeyword` and noting the two result lists should be fused by rank (RRF) rather than by raw score, because their `similarity` scales differ; that `migrate()` must be re-run on existing databases to create the pg_trgm extension and index; and that 0.15 is a starting point requiring tuning against real query traffic.
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk && pnpm --filter @khaveeai/providers-pgvector run build && pnpm --filter @khaveeai/providers-pgvector run verify:keyword && pnpm --filter @khaveeai/providers-pgvector run verify:search && pnpm --filter @khaveeai/providers-pgvector run verify:batch && node -e "const v=require('./packages/providers/pgvector/package.json').version;if(v!=='0.4.0')throw new Error('version is '+v);console.log('TASK3_OK')"</automated>
  </verify>
  <done>`verify:keyword` prints `VERIFY_OK`; both pre-existing verification scripts (`verify:search`, `verify:batch`) still pass unchanged, proving no regression to vector search or batch insert; `package.json` version is `0.4.0` with the new script registered; README documents the new method, config field, migrate() additions, and hybrid-search usage. Nothing has been tagged, pushed, or published.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| app code → `searchByKeyword(query)` | Caller-supplied query string, potentially derived from end-user chat input, reaches SQL |
| provider → Postgres | SQL text is constructed with template literals containing `this.tableName` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ayu-01 | Tampering | `runKeywordQuery` query param | mitigate | `query` is bound as `$1` via `pool.query(sql, params)` — never string-interpolated into SQL. Same parameterization the existing `runVectorQuery` uses. Verified by the param-shape assertions in `verify-keyword-search.cjs`. |
| T-ayu-02 | Tampering | `runKeywordQuery` / `migrate` table name | accept | `${this.tableName}` is interpolated, matching every pre-existing method in this class. It comes from `PgVectorConfig`, supplied by the developer at construction time, never from end-user input. Changing this pattern is out of scope for a purely additive task and would touch existing methods this plan must not modify. |
| T-ayu-03 | Denial of Service | GIN trigram index build on large tables | accept | `CREATE INDEX IF NOT EXISTS` (no DROP) means the build cost is paid once, not on every `migrate()` call — this is precisely why the no-DROP decision was made. First run on an existing large table will still block; documented in the README migrate() section. |
| T-ayu-04 | Information Disclosure | `metadataFilter` tenant scoping | mitigate | Filter is bound as `$4` and applied via JSONB containment in the same `WHERE` clause as the similarity floor, identical to `runVectorQuery` — a keyword search cannot bypass the tenant scope that a vector search enforces. Asserted in verification step 2. |
| T-ayu-SC | Tampering | npm/pip/cargo installs | n/a | No new dependencies are added by this task. `pg_trgm` is a first-party Postgres contrib module already bundled in the `pgvector/pgvector:pg16` image, not an npm package. |
</threat_model>

<verification>
1. `pnpm --filter @khaveeai/providers-pgvector run build` — strict-mode `tsc` passes.
2. `pnpm --filter @khaveeai/providers-pgvector run verify:keyword` — prints `VERIFY_OK`.
3. `pnpm --filter @khaveeai/providers-pgvector run verify:search` and `verify:batch` — both still print `VERIFY_OK`, proving no regression to the existing vector-search and batch-embedding paths.
4. `git diff` on `PgVectorProvider.ts` shows only ADDITIONS plus the two appended `migrate()` statements and its JSDoc — zero changes to `runVectorQuery`, `searchByEmbedding`, `searchDocuments`, `search`, `embedBatch`, `insertDocumentWithEmbedding`, or `bulkInsertDocuments`.
5. No new entry in `dependencies` / `devDependencies` in `packages/providers/pgvector/package.json`.
6. No changes outside `packages/providers/pgvector/` — in particular, nothing in khavee-app or any other repo.

**Not verified by this plan (deliberate):** actual Thai-language search quality. Trigram ranking behavior requires a live Postgres with `pg_trgm` enabled and real Thai content. The user will verify this separately against their dev database after the app-side RRF-fusion task lands.
</verification>

<success_criteria>
- `searchByKeyword(query, topK?, threshold?, metadataFilter?)` exists as a public method returning `Promise<PgVectorSearchResult[]>`, delegating to a private `runKeywordQuery` helper.
- Generated SQL uses `similarity(content, $1)` for the WHERE floor, the `ORDER BY ... DESC`, and the returned `similarity` column, with `LIMIT $3` — and contains no `tsvector`, `to_tsvector`, or `ts_rank`.
- Params bind as `[query, threshold, topK]` (no filter) or `[query, threshold, topK, JSON.stringify(metadataFilter)]` (with filter).
- `migrate()` additionally issues `CREATE EXTENSION IF NOT EXISTS pg_trgm` and `CREATE INDEX IF NOT EXISTS <table>_content_trgm_idx ... USING gin (content gin_trgm_ops)`, with no DROP for the trigram index, and no change to any pre-existing statement.
- `PgVectorConfig.defaultKeywordThreshold?: number` exists, defaults to `0.15`, and is honored when `threshold` is omitted.
- `VectorSearchProvider.searchByKeyword?` is optional — no existing implementor breaks.
- Package version is `0.4.0`; `verify:keyword` script registered; nothing tagged, pushed, or published.
- README documents the new method, config field, `migrate()` additions, and hybrid search + RRF usage.
</success_criteria>

<output>
Create `.planning/quick/260726-ayu-hybrid-keyword-search/260726-ayu-SUMMARY.md` when done.

The SUMMARY MUST include a "Verification scope" section stating plainly that only SQL shape and parameter binding were verified via mocks, and that real Thai-language trigram search quality was NOT verified and requires a live Postgres with `pg_trgm` and real content. Do not write any sentence implying search quality was validated.
</output>
