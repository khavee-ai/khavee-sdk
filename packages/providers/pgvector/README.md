# @khaveeai/providers-pgvector

PostgreSQL + pgvector provider for the Khavee AI SDK. Bring your own Postgres database and get document storage, CSV import, and vector similarity search out of the box.

## Installation

```bash
npm install @khaveeai/providers-pgvector
# requires: pg, openai (peer)
```

## Quick start

```ts
import { PgVectorProvider } from "@khaveeai/providers-pgvector";

const db = new PgVectorProvider({
  connectionString: process.env.DATABASE_URL!,
  openaiApiKey:     process.env.OPENAI_API_KEY!,
});

// 1. Create schema on first run
await db.migrate();

// 2. Insert a document
await db.insertDocument("Hello my name is Non", { category: "greeting" });

// 3. Import a CSV
await db.importCSV(csvString); // must have a "content" column

// 4. Vector search
const results = await db.search("what is your name?", 5, 0.3);
// → [{ id, content, metadata, createdAt, similarity }]

// 5. Browse all
const docs = await db.listDocuments(20);
```

## CSV format

The CSV **must** have a `content` column (or set `contentColumn` in options).  
All other columns become `metadata`.

```csv
content,category,author
"Hello my name is Non",greeting,Non
"The Eiffel Tower is in Paris",geography,system
```

```ts
await db.importCSV(csvString, { contentColumn: "content", concurrency: 5 });
```

## Config

| Option | Type | Default | Description |
|---|---|---|---|
| `connectionString` | string | **required** | PostgreSQL connection URL |
| `openaiApiKey` | string | **required** | OpenAI key for embeddings |
| `embeddingModel` | string | `text-embedding-3-small` | Any OpenAI embedding model |
| `embeddingDimensions` | number | `1536` | Must match the model |
| `tableName` | string | `documents` | Table to read/write |
| `defaultTopK` | number | `5` | Default search results |
| `defaultThreshold` | number | `0.3` | Default min similarity |
| `defaultConcurrency` | number | `5` | Parallel embed calls |

## Use with OpenAI Realtime (RAG)

```ts
import { OpenAIRealtimeProvider } from "@khaveeai/providers-openai-realtime";
import { PgVectorProvider } from "@khaveeai/providers-pgvector";

const vectorDB = new PgVectorProvider({ connectionString, openaiApiKey });

const provider = new OpenAIRealtimeProvider({
  useProxy: true,
  rag: {
    provider: vectorDB,
    topK: 5,
    threshold: 0.3,
    systemPromptPrefix: "Use the following context to answer questions:",
  },
});
```
