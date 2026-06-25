# @khaveeai/providers-pgvector

[![npm version](https://img.shields.io/npm/v/@khaveeai/providers-pgvector.svg)](https://www.npmjs.com/package/@khaveeai/providers-pgvector)
[![license](https://img.shields.io/npm/l/@khaveeai/providers-pgvector.svg)](../../../LICENSE)

`PgVectorProvider` is a vector-store provider backed by PostgreSQL + the [pgvector](https://github.com/pgvector/pgvector) extension: document storage, CSV bulk import, and cosine-similarity search over embedded text. Implements `VectorSearchProvider` — the building block for a RAG pipeline.

## Install

```bash
npm install @khaveeai/providers-pgvector
```

This package depends on `pg` and `openai` directly, and expects
`@khaveeai/core` as a peer dependency.

## Local setup

The repo's root `docker-compose.yml` spins up a local Postgres instance with
the pgvector extension pre-installed:

```bash
docker compose up -d
```

This starts:

| Setting | Value |
|---|---|
| Image | `pgvector/pgvector:pg16` |
| Container name | `vrm_postgres` |
| Host port → container port | `5434` → `5432` |
| Database | `vrm_vectors` |
| User / password | `postgres` / `postgres` |

Your connection string for local development is:

```
postgresql://postgres:postgres@localhost:5434/vrm_vectors
```

`PgVectorProvider` does not read `DATABASE_URL` (or any env var) itself — you
pass the connection string explicitly via `PgVectorConfig.connectionString`.
A common pattern is to read it from `process.env.DATABASE_URL` in your own
app code and pass it through.

## Quick start

```ts
import { PgVectorProvider } from "@khaveeai/providers-pgvector";

const db = new PgVectorProvider({
  connectionString: process.env.DATABASE_URL!, // e.g. the local URL above
  openaiApiKey: process.env.OPENAI_API_KEY!,
});

// 1. Create the pgvector extension, table, and HNSW index (safe to re-run)
await db.migrate();

// 2. Insert a document — this embeds the text via OpenAI, then stores it
const doc = await db.insertDocument("Hello my name is Non", {
  category: "greeting",
});
// doc → { id, content, metadata, createdAt }

// 3. Run a similarity search
const results = await db.search("what is your name?", 5, 0.3);
// results → PgVectorSearchResult[]
// each item: { id, content, metadata, createdAt, similarity }

console.log(results[0]?.content, results[0]?.similarity);

// 4. Clean up the connection pool when you're done (e.g. app shutdown)
await db.destroy();
```

## Configuration (`PgVectorConfig`)

| Option | Type | Default | Description |
|---|---|---|---|
| `connectionString` | `string` | **required** | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/mydb`. |
| `openaiApiKey` | `string` | **required** | OpenAI API key used to generate embeddings. |
| `embeddingModel` | `string` | `"text-embedding-3-small"` | Any OpenAI embedding model. |
| `embeddingDimensions` | `number` | `1536` | Must match the chosen model (`text-embedding-3-small` → 1536, `text-embedding-3-large` → 3072). Used when creating the `vector(N)` column. |
| `tableName` | `string` | `"documents"` | Table used to store documents. |
| `defaultTopK` | `number` | `5` | Default number of results returned by `search`/`searchDocuments` if not overridden per call. |
| `defaultThreshold` | `number` | `0.3` | Default minimum cosine similarity (0–1) for a result to be returned. |
| `defaultConcurrency` | `number` | `5` | Max parallel embedding requests during bulk insert / CSV import. |
| `ssl` | `boolean \| { rejectUnauthorized: boolean }` | `false` | SSL configuration passed through to the underlying `pg.Pool`. |

## What `migrate()` sets up

Call `await db.migrate()` once before using the provider (it is idempotent —
safe to call on every app start). It runs:

1. `CREATE EXTENSION IF NOT EXISTS vector` — enables the pgvector extension.
2. Creates the table (named by `tableName`, default `documents`) if it
   doesn't exist, with columns: `id SERIAL PRIMARY KEY`, `content TEXT NOT
   NULL`, `metadata JSONB NOT NULL DEFAULT '{}'`, `embedding vector(N)` where
   `N` is `embeddingDimensions`, and `created_at TIMESTAMPTZ NOT NULL DEFAULT
   now()`.
3. Drops and recreates an HNSW index (`<tableName>_embedding_idx`) on the
   `embedding` column using `vector_cosine_ops` (cosine distance) with `m =
   16, ef_construction = 64`.

Because the index uses `vector_cosine_ops`, all similarity scores returned by
search are cosine similarity (`1 - cosine_distance`), in the 0–1 range.

## API reference

All methods are async unless noted.

| Method | Signature | Description |
|---|---|---|
| `embed` | `embed(text: string): Promise<number[]>` | Generates an embedding vector for a string via the OpenAI embeddings API. |
| `migrate` | `migrate(): Promise<void>` | Creates the pgvector extension, table, and HNSW index. See above. |
| `insertDocument` | `insertDocument(content: string, metadata?: Record<string, unknown>): Promise<PgVectorDocument>` | Embeds `content` and inserts one row. Returns the inserted `{ id, content, metadata, createdAt }`. |
| `bulkInsertDocuments` | `bulkInsertDocuments(rows: BulkInsertRow[], concurrency?: number): Promise<BulkInsertResult>` | Embeds and inserts many rows in parallel batches (batch size = `concurrency`, default `defaultConcurrency`). Returns `{ inserted, failed, errors }`, where each error is `{ row, reason }` (1-indexed row number). |
| `importCSV` | `importCSV(csvText: string, options?: CSVImportOptions): Promise<BulkInsertResult>` | Parses a CSV string (must have a header row) and bulk-inserts every row. The column named by `options.contentColumn` (default `"content"`) becomes the embedded text; every other column becomes `metadata`. Throws if the content column is missing. |
| `parseCSV` | `parseCSV(csvText: string): Record<string, string>[]` | Minimal RFC-4180 CSV parser used internally by `importCSV`. Handles quoted fields, escaped quotes (`""`), and CRLF/LF line endings. Exposed as a public method if you need to parse CSV without inserting. |
| `listDocuments` | `listDocuments(limit?: number, metadataFilter?: Record<string, unknown>): Promise<PgVectorDocument[]>` | Returns the most recently inserted documents (`ORDER BY id DESC`), default `limit` 20. Pass `metadataFilter` (e.g. `{ userId: 'u1' }`) to scope results via a JSONB containment match. |
| `search` | `search(query: string, topK?: number, threshold?: number, metadataFilter?: Record<string, unknown>): Promise<PgVectorSearchResult[]>` | Alias for `searchDocuments` — satisfies the `VectorSearchProvider` interface. |
| `searchDocuments` | `searchDocuments(query: string, topK?: number, threshold?: number, metadataFilter?: Record<string, unknown>): Promise<PgVectorSearchResult[]>` | Embeds `query`, then returns the `topK` most similar documents with cosine similarity `>= threshold`, ordered by similarity descending. Optional `metadataFilter` restricts results via JSONB containment. |
| `deleteDocument` | `deleteDocument(id: number): Promise<void>` | Deletes a document row by `id`. |
| `destroy` | `destroy(): Promise<void>` | Closes the underlying `pg.Pool`. Call this when shutting down your app. |

### Types

```ts
interface PgVectorDocument {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface PgVectorSearchResult extends PgVectorDocument {
  similarity: number; // 0–1, cosine similarity
}

interface BulkInsertRow {
  content: string;
  metadata?: Record<string, unknown>;
}

interface BulkInsertResult {
  inserted: number;
  failed: number;
  errors: { row: number; reason: string }[];
}

interface CSVImportOptions {
  contentColumn?: string; // default: "content"
  concurrency?: number;   // default: defaultConcurrency
}

interface VectorSearchProvider {
  search(
    query: string,
    topK?: number,
    threshold?: number,
    metadataFilter?: Record<string, unknown>
  ): Promise<PgVectorSearchResult[]>;
}
```

`PgVectorProvider` implements `VectorSearchProvider`, so it can be passed
anywhere that interface is expected.

## CSV import format

The CSV **must** include a header row. The column named by `contentColumn`
(default `"content"`) is embedded; every other column is stored as
`metadata`.

```csv
content,category,author
"Hello my name is Non",greeting,Non
"The Eiffel Tower is in Paris",geography,system
```

```ts
await db.importCSV(csvString, { contentColumn: "content", concurrency: 5 });
```

## Next step: retrieval-augmented generation

`PgVectorProvider` only handles storage and similarity search. To build a
full RAG pipeline (retrieve relevant documents, then feed them to an LLM),
see `@khaveeai/providers-rag` — note its `RAGProvider` is currently hardcoded
to Qdrant directly and does not yet accept a `VectorSearchProvider` like
this package's `PgVectorProvider`; see that package's README for what
plugging this in would involve.
