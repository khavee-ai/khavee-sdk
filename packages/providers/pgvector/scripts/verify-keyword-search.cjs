/**
 * Dependency-free verification script for `searchByKeyword` / trigram
 * keyword search.
 *
 * This package has no test runner configured (no vitest/jest devDependency,
 * no `test` script) and the plan for this change forbids adding any new npm
 * dependency. Rather than bring in a test framework just for this, this is a
 * plain Node script using only `node:assert/strict` against the built CJS
 * output (`dist/index.js`, per this package's `module: "commonjs"`
 * tsconfig). It is intentionally kept out of `package.json`'s `files` field
 * (only `dist/**\/*`, `package.json`, `README.md` are published) so it never
 * ships to consumers.
 *
 * SCOPE CAVEAT: this verifies ONLY the generated SQL shape and parameter
 * binding (via a mocked `pool.query`/`pool.connect`) — it does NOT and
 * CANNOT verify that trigram similarity actually produces good
 * Thai-language search results. That requires a live Postgres with
 * `pg_trgm` enabled and real Thai content, which is out of scope for this
 * script.
 *
 * It proves:
 *  - searchByKeyword's no-filter branch issues 1 query, correct SQL/params
 *  - the filter branch adds the metadata @> $4::jsonb clause correctly
 *  - an empty metadata filter object takes the no-filter branch
 *  - structural row passthrough (NOT ranking correctness)
 *  - migrate() issues the two new pg_trgm statements without regressing
 *    the pre-existing vector/table/HNSW statements, and without a DROP
 *    preceding the trigram index
 *  - defaultKeywordThreshold (0.15) is honored when threshold is omitted,
 *    and is overridable via config
 */

const assert = require("node:assert/strict");
const { PgVectorProvider } = require("../dist/index.js");

async function main() {
  // ── 1 & 2 & 3: param shape (no-filter / filter / empty-filter) ────────────

  const provider = new PgVectorProvider({
    connectionString: "postgresql://x:x@127.0.0.1:1/x",
    openaiApiKey: "test",
    embeddingDimensions: 3,
  });

  let queries = [];

  provider["pool"] = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return {
        rows: [
          {
            id: 1,
            content: "x",
            metadata: {},
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            similarity: 0.42,
          },
        ],
      };
    },
  };

  function reset() {
    queries = [];
  }

  // 1. No-filter param shape.
  reset();
  const noFilterResult = await provider.searchByKeyword("เสริมหน้าอก", 5, 0.2);
  assert.equal(queries.length, 1, "searchByKeyword (no filter) should issue exactly one pool query");
  assert.ok(
    queries[0].sql.includes("similarity(content, $1)"),
    "no-filter SQL must contain similarity(content, $1)"
  );
  assert.deepEqual(
    queries[0].params,
    ["เสริมหน้าอก", 0.2, 5],
    "no-filter params must be [query, threshold, topK]"
  );
  assert.ok(
    !queries[0].sql.includes("metadata @>"),
    "no-filter SQL must not contain a metadata @> clause"
  );

  // 4. Structural passthrough only — NOT proof of ranking correctness.
  // Real similarity-ranking behavior depends on a live Postgres with
  // pg_trgm enabled and real Thai content, which this script cannot verify.
  assert.deepEqual(
    noFilterResult,
    [
      {
        id: 1,
        content: "x",
        metadata: {},
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        similarity: 0.42,
      },
    ],
    "searchByKeyword must pass rows through unchanged"
  );

  // 2. Filter param shape.
  reset();
  await provider.searchByKeyword("เสริมหน้าอก", 5, 0.2, { userId: "u1" });
  assert.equal(queries.length, 1);
  assert.ok(
    queries[0].sql.includes("metadata @> $4::jsonb"),
    "filter branch SQL must contain the metadata @> $4::jsonb clause"
  );
  assert.equal(queries[0].params.length, 4, "filter branch must bind 4 params");
  assert.equal(queries[0].params[0], "เสริมหน้าอก");
  assert.equal(queries[0].params[1], 0.2);
  assert.equal(queries[0].params[2], 5);
  assert.equal(
    queries[0].params[3],
    JSON.stringify({ userId: "u1" }),
    "4th param must be the JSON-stringified metadata filter"
  );

  // 3. Empty metadataFilter object -> no-filter branch (matches hasFilter semantics).
  reset();
  await provider.searchByKeyword("เสริมหน้าอก", 5, 0.2, {});
  assert.equal(queries.length, 1);
  assert.equal(queries[0].params.length, 3, "empty filter object must take the no-filter branch");
  assert.ok(
    !queries[0].sql.includes("metadata @>"),
    "no-filter branch SQL must not contain a metadata @> clause"
  );

  // ── 5: migrate() issues the new pg_trgm statements, no regressions ────────

  const migrateProvider = new PgVectorProvider({
    connectionString: "postgresql://x:x@127.0.0.1:1/x",
    openaiApiKey: "test",
  });

  const clientQueries = [];
  migrateProvider["pool"] = {
    connect: async () => ({
      query: async (sql) => {
        clientQueries.push(sql);
        return { rows: [] };
      },
      release: () => {},
    }),
  };

  await migrateProvider.migrate();

  const joined = clientQueries.join("\n");

  // Pre-existing statements, unregressed:
  assert.ok(
    clientQueries.some((q) => q.includes("CREATE EXTENSION IF NOT EXISTS vector")),
    "migrate() must still create the vector extension"
  );
  assert.ok(
    clientQueries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS documents")),
    "migrate() must still create the documents table"
  );
  assert.ok(
    clientQueries.some((q) => q.includes("DROP INDEX IF EXISTS documents_embedding_idx")),
    "migrate() must still drop the pre-existing HNSW index before recreating it"
  );
  assert.ok(
    clientQueries.some((q) => q.includes("USING hnsw")),
    "migrate() must still create the HNSW index"
  );

  // New pg_trgm statements:
  assert.ok(
    clientQueries.some((q) => /CREATE EXTENSION IF NOT EXISTS pg_trgm/.test(q)),
    "migrate() must create the pg_trgm extension"
  );
  const trgmIndexQuery = clientQueries.find((q) =>
    /CREATE INDEX IF NOT EXISTS\s+documents_content_trgm_idx/.test(q)
  );
  assert.ok(trgmIndexQuery, "migrate() must create the content trigram GIN index");
  assert.ok(
    trgmIndexQuery.includes("gin (content gin_trgm_ops)"),
    "trigram index must use gin (content gin_trgm_ops)"
  );

  // Deliberate no-DROP decision: no DROP INDEX targeting the trigram index.
  assert.ok(
    !joined.includes("DROP INDEX IF EXISTS documents_content_trgm_idx"),
    "trigram index must NOT be preceded by a DROP — CREATE INDEX IF NOT EXISTS only"
  );

  // ── 6: default threshold honored, and overridable via config ─────────────

  const defaultThresholdProvider = new PgVectorProvider({
    connectionString: "postgresql://x:x@127.0.0.1:1/x",
    openaiApiKey: "test",
  });
  const defaultQueries = [];
  defaultThresholdProvider["pool"] = {
    query: async (sql, params) => {
      defaultQueries.push({ sql, params });
      return { rows: [] };
    },
  };
  await defaultThresholdProvider.searchByKeyword("q");
  assert.equal(defaultQueries.length, 1);
  assert.equal(defaultQueries[0].params[1], 0.15, "default keyword threshold must be 0.15");
  assert.equal(defaultQueries[0].params[2], 5, "default topK must be 5 (defaultTopK)");

  const customThresholdProvider = new PgVectorProvider({
    connectionString: "postgresql://x:x@127.0.0.1:1/x",
    openaiApiKey: "test",
    defaultKeywordThreshold: 0.05,
  });
  const customQueries = [];
  customThresholdProvider["pool"] = {
    query: async (sql, params) => {
      customQueries.push({ sql, params });
      return { rows: [] };
    },
  };
  await customThresholdProvider.searchByKeyword("q");
  assert.equal(customQueries.length, 1);
  assert.equal(
    customQueries[0].params[1],
    0.05,
    "custom defaultKeywordThreshold must be honored when threshold is omitted"
  );

  console.log("VERIFY_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
