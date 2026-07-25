/**
 * Dependency-free verification script for the searchByEmbedding refactor.
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
 * It proves:
 *  - searchDocuments still makes exactly 1 embedding call + 1 pool query
 *  - searchByEmbedding makes 0 embedding calls + 1 pool query
 *  - both produce byte-identical SQL + params for identical arguments
 *    (i.e. there is truly one shared code path, not two that happen to match)
 *  - the no-filter / filter branch selection and param shapes are unchanged
 *  - invalid embeddings reject with a clear Error before any DB round-trip
 */

const assert = require("node:assert/strict");
const { PgVectorProvider } = require("../dist/index.js");

async function main() {
  const provider = new PgVectorProvider({
    connectionString: "postgresql://x:x@127.0.0.1:1/x",
    openaiApiKey: "test",
    embeddingDimensions: 3,
  });

  let embedCalls = 0;
  let queries = [];

  // pg.Pool connects lazily — replacing it here means no real DB is ever
  // contacted, and we can record exactly what SQL/params were sent.
  provider["pool"] = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };

  provider["openai"] = {
    embeddings: {
      create: async () => {
        embedCalls++;
        return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
      },
    },
  };

  function reset() {
    embedCalls = 0;
    queries = [];
  }

  // 1. searchDocuments("hello", 4, 0.3) -> embed count 1, pool query count 1
  reset();
  await provider.searchDocuments("hello", 4, 0.3);
  assert.equal(embedCalls, 1, "searchDocuments should call embed() exactly once");
  assert.equal(queries.length, 1, "searchDocuments should issue exactly one pool query");
  const searchDocumentsQuery = queries[0];

  // 2. searchByEmbedding([0.1, 0.2, 0.3], 4, 0.3) -> embed count 0, pool query count 1
  reset();
  await provider.searchByEmbedding([0.1, 0.2, 0.3], 4, 0.3);
  assert.equal(embedCalls, 0, "searchByEmbedding should never call embed()");
  assert.equal(queries.length, 1, "searchByEmbedding should issue exactly one pool query");
  const searchByEmbeddingQuery = queries[0];

  // 3. Byte-identical SQL + params for identical topK/threshold/no filter
  assert.deepEqual(
    searchDocumentsQuery,
    searchByEmbeddingQuery,
    "searchDocuments and searchByEmbedding must produce identical SQL + params for identical args"
  );

  // 4. metadataFilter present -> filter branch, params.length === 4, params[3] is the JSON filter
  reset();
  await provider.searchByEmbedding([0.1, 0.2, 0.3], 4, 0.3, { userId: "u1" });
  assert.equal(queries.length, 1);
  assert.ok(
    queries[0].sql.includes("metadata @> $4::jsonb"),
    "filter branch SQL must contain the metadata @> $4::jsonb clause"
  );
  assert.equal(queries[0].params.length, 4, "filter branch must bind 4 params");
  assert.equal(
    queries[0].params[3],
    JSON.stringify({ userId: "u1" }),
    "4th param must be the JSON-stringified metadata filter"
  );

  // 5. Empty metadataFilter object -> no-filter branch (existing hasFilter semantics preserved)
  reset();
  await provider.searchByEmbedding([0.1, 0.2, 0.3], 4, 0.3, {});
  assert.equal(queries.length, 1);
  assert.equal(queries[0].params.length, 3, "empty filter object must take the no-filter branch");
  assert.ok(
    !queries[0].sql.includes("metadata @>"),
    "no-filter branch SQL must not contain a metadata @> clause"
  );

  // 6. Two-threshold fallback pattern (the khavee-app RAG use case this exists for):
  //    same vector, thresholds 0.3 then 0.15 -> 0 embed calls across both, 2 pool queries,
  //    differing only in params[1] (the threshold).
  reset();
  const vec = [0.1, 0.2, 0.3];
  await provider.searchByEmbedding(vec, 5, 0.3);
  await provider.searchByEmbedding(vec, 5, 0.15);
  assert.equal(embedCalls, 0, "two-threshold fallback must make zero embedding calls");
  assert.equal(queries.length, 2, "two-threshold fallback must issue exactly two pool queries");
  assert.equal(queries[0].sql, queries[1].sql, "SQL must be identical across the two threshold attempts");
  assert.equal(queries[0].params[0], queries[1].params[0], "vector param must be unchanged");
  assert.equal(queries[0].params[1], 0.3);
  assert.equal(queries[1].params[1], 0.15);
  assert.equal(queries[0].params[2], queries[1].params[2], "topK param must be unchanged");

  // 7. Rejection cases: zero pool queries issued, each rejects with an Error
  reset();
  await assert.rejects(
    () => provider.searchByEmbedding([]),
    Error,
    "empty embedding array must reject"
  );
  assert.equal(queries.length, 0, "empty embedding must not reach the DB");

  await assert.rejects(
    () => provider.searchByEmbedding([0.1, Number.NaN, 0.3]),
    Error,
    "non-finite embedding must reject"
  );
  assert.equal(queries.length, 0, "non-finite embedding must not reach the DB");

  await assert.rejects(
    () => provider.searchByEmbedding([0.1, 0.2]), // configured embeddingDimensions is 3
    Error,
    "dimension-mismatched embedding must reject"
  );
  assert.equal(queries.length, 0, "dimension-mismatched embedding must not reach the DB");

  console.log("VERIFY_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
