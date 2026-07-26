/**
 * Dependency-free verification script for the batched-embedding refactor to
 * `bulkInsertDocuments`/`insertDocument`.
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
 *  - a 250-row bulkInsertDocuments call makes exactly 3 embeddings.create
 *    calls (100/100/50), not 250
 *  - every row's embedding stays aligned to its own content, even when the
 *    stubbed API returns `res.data` out of order
 *  - a failed embedding call for one chunk fails exactly that chunk's rows
 *    (correct 1-indexed row numbers), while other chunks still import
 *  - a failed INSERT for one row fails exactly that row; its chunk
 *    siblings still insert
 *  - insertDocument still does exactly one string embed + one INSERT
 *  - an empty rows array does zero embedding calls and zero pool queries
 */

const assert = require("node:assert/strict");
const { PgVectorProvider } = require("../dist/index.js");

function embeddingFor(text) {
  // Deterministic 3-number vector uniquely traceable back to its content.
  return [text.length, text.charCodeAt(text.length - 1), text.length * 2];
}

function rowsOf(n) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({ content: `row-${i}` });
  }
  return rows;
}

function makeProvider() {
  const provider = new PgVectorProvider({
    connectionString: "postgresql://x:x@127.0.0.1:1/x",
    openaiApiKey: "test",
    embeddingDimensions: 3,
  });

  const state = {
    queries: [],
    embedCalls: [], // each entry: input.length for array input, or the raw string for single input
    failOn: null, // (content) => boolean; makes matching INSERT reject
    failOnCall: null, // number; makes the Nth embeddings.create call reject
    reverseData: false, // return res.data in reverse order (indices still correct)
  };

  provider["pool"] = {
    query: async (sql, params) => {
      if (state.failOn && state.failOn(params[0])) {
        throw new Error("insert boom");
      }
      state.queries.push({ sql, params });
      return {
        rows: [
          {
            id: state.queries.length,
            content: params[0],
            metadata: {},
            createdAt: new Date(),
          },
        ],
      };
    },
  };

  provider["openai"] = {
    embeddings: {
      create: async ({ input }) => {
        state.embedCalls.push(input);

        const callNum = state.embedCalls.length;
        if (state.failOnCall && callNum === state.failOnCall) {
          throw new Error("embed boom");
        }

        if (Array.isArray(input)) {
          const data = input.map((t, i) => ({ index: i, embedding: embeddingFor(t) }));
          if (state.reverseData) data.reverse();
          return { data };
        }

        // Single-string input path (insertDocument -> embed()).
        return { data: [{ index: 0, embedding: embeddingFor(input) }] };
      },
    },
  };

  return { provider, state };
}

async function main() {
  // 1. Batching: 250 rows -> 3 embedding calls with input lengths [100, 100, 50]
  {
    const { provider, state } = makeProvider();
    const result = await provider.bulkInsertDocuments(rowsOf(250));

    assert.equal(state.embedCalls.length, 3, "250 rows should make exactly 3 embedding calls");
    assert.deepEqual(
      state.embedCalls.map((c) => c.length),
      [100, 100, 50],
      "embedding call input lengths must be [100, 100, 50]"
    );
    assert.ok(
      state.embedCalls.every((c) => c.length <= 100),
      "every embedding call's input length must be <= 100"
    );
    assert.equal(state.queries.length, 250, "250 rows should issue 250 INSERT queries");
    assert.deepEqual(
      result,
      { inserted: 250, failed: 0, errors: [] },
      "all 250 rows should insert successfully"
    );
  }

  // 2. Ordering / alignment: reversed res.data must not misalign content <-> embedding
  {
    const { provider, state } = makeProvider();
    state.reverseData = true;
    await provider.bulkInsertDocuments(rowsOf(250));

    for (const q of state.queries) {
      const content = q.params[0];
      const expectedVec = `[${embeddingFor(content).join(",")}]`;
      assert.equal(
        q.params[2],
        expectedVec,
        `row with content "${content}" must be inserted with its own embedding even when API response order is reversed`
      );
    }
  }

  // 3. Chunk embedding failure isolation: failOnCall = 2 -> rows 101..200 fail
  {
    const { provider, state } = makeProvider();
    state.failOnCall = 2;
    const result = await provider.bulkInsertDocuments(rowsOf(250));

    assert.equal(result.inserted, 150, "chunks 1 and 3 (150 rows) should still insert");
    assert.equal(result.failed, 100, "chunk 2 (100 rows) should fail");
    assert.equal(result.errors.length, 100);

    const errorRows = result.errors.map((e) => e.row).sort((a, b) => a - b);
    const expectedRows = [];
    for (let r = 101; r <= 200; r++) expectedRows.push(r);
    assert.deepEqual(errorRows, expectedRows, "failed rows must be exactly 101..200");
    assert.ok(
      result.errors.every((e) => e.reason.includes("embed boom")),
      "every error reason must contain 'embed boom'"
    );

    const insertedContents = state.queries.map((q) => q.params[0]);
    for (let r = 101; r <= 200; r++) {
      assert.ok(
        !insertedContents.includes(`row-${r}`),
        `row-${r} must never reach an INSERT since its chunk's embedding call failed`
      );
    }
  }

  // 4. Single-row INSERT failure isolation: row-7 fails, siblings still insert
  {
    const { provider, state } = makeProvider();
    state.failOn = (content) => content === "row-7";
    const result = await provider.bulkInsertDocuments(rowsOf(250));

    assert.equal(result.inserted, 249, "249 rows should insert successfully");
    assert.equal(result.failed, 1, "only row-7 should fail");
    assert.deepEqual(result.errors.length, 1);
    assert.equal(result.errors[0].row, 7, "the failed row must be reported as row 7");
    assert.ok(
      result.errors[0].reason.includes("insert boom"),
      "reason must contain 'insert boom'"
    );
  }

  // 5. insertDocument unchanged: exactly 1 embed call (string input) + 1 pool query
  {
    const { provider, state } = makeProvider();
    const doc = await provider.insertDocument("hello", { a: 1 });

    assert.equal(state.embedCalls.length, 1, "insertDocument should call embed() exactly once");
    assert.equal(
      state.embedCalls[0],
      "hello",
      "insertDocument's embed call must send the raw string, not an array"
    );
    assert.equal(state.queries.length, 1, "insertDocument should issue exactly one pool query");
    assert.equal(doc.content, "hello", "insertDocument should return the stub's rows[0]");
  }

  // 6. Empty input: zero embedding calls, zero pool queries
  {
    const { provider, state } = makeProvider();
    const result = await provider.bulkInsertDocuments([]);

    assert.deepEqual(result, { inserted: 0, failed: 0, errors: [] });
    assert.equal(state.embedCalls.length, 0, "empty rows array must make zero embedding calls");
    assert.equal(state.queries.length, 0, "empty rows array must issue zero pool queries");
  }

  console.log("VERIFY_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
