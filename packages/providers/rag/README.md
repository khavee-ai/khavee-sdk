# @khaveeai/providers-rag

[![npm version](https://img.shields.io/npm/v/@khaveeai/providers-rag.svg)](https://www.npmjs.com/package/@khaveeai/providers-rag)
[![license](https://img.shields.io/npm/l/@khaveeai/providers-rag.svg)](../../../LICENSE)

Retrieval-augmented generation for Khavee SDK projects. `RAGProvider` embeds a query with OpenAI, searches a Qdrant collection for relevant chunks, and formats the results into a context string an LLM can use to ground its answer. `createRAGTool` wraps it into a tool object a tool-calling LLM can invoke mid-conversation instead of you calling it by hand.

> **Qdrant + OpenAI only.** The constructor takes connection details (URL, API keys, collection name), not a pre-built client instance — there's currently no way to plug in `@khaveeai/providers-pgvector` or another vector store without writing your own equivalent class. See [Using a different vector store](#using-a-different-vector-store).

## Install

```bash
npm install @khaveeai/providers-rag
```

`@qdrant/js-client-rest` and `openai` are installed automatically as dependencies.

## Quick start

```ts
import { RAGProvider } from "@khaveeai/providers-rag";

const rag = new RAGProvider({
  qdrantUrl: process.env.QDRANT_URL!,
  qdrantApiKey: process.env.QDRANT_API_KEY,        // optional, only if your Qdrant instance requires auth
  collectionName: "my-docs",
  openaiApiKey: process.env.OPENAI_API_KEY!,
});

const context = await rag.prepareContext("What is the refund policy?");

console.log(context.formattedContext);
// [1] Refunds are available within 30 days of purchase...
// (source: refund-policy.md)
// [Relevance: 87.3%]
```

`prepareContext(query)` is the main method: it embeds the query, searches Qdrant, and returns a `RAGContext` containing the retrieved documents and a single formatted string ready to drop into an LLM prompt.

To turn that into an actual prompt string in one call, use `createPromptWithContext` instead:

```ts
const prompt = await rag.createPromptWithContext("What is the refund policy?");
// "What is the refund policy?\n\nRelevant information:\n[1] Refunds are available..."

const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: prompt }],
});
```

Pass a custom `promptTemplate` as the second argument to control formatting:

```ts
const prompt = await rag.createPromptWithContext(
  "What is the refund policy?",
  (query, context) => `Question: ${query}\n\nDocs:\n${context}`
);
```

### Required Qdrant payload shape

`RAGProvider` expects each Qdrant point's payload to contain a `text` or `content` field:

```json
{
  "text": "Refunds are available within 30 days of purchase.",
  "metadata": { "title": "Refund Policy", "source": "refund-policy.md" }
}
```

It also handles a nested `_node_content` JSON-string field (a format produced by some document-indexing tools) — if present, it is parsed and used in place of the top-level payload.

## `createRAGTool`

`createRAGTool` wraps a `RAGProvider` instance into a `RealtimeTool` object (the plain-object tool shape defined in `@khaveeai/core`, with `name`, `description`, `parameters`, and an `execute` function) so a tool-calling LLM can decide on its own when to search your knowledge base, instead of you calling `prepareContext` by hand.

```ts
import { RAGProvider, createRAGTool } from "@khaveeai/providers-rag";

const rag = new RAGProvider({
  qdrantUrl: process.env.QDRANT_URL!,
  collectionName: "my-docs",
  openaiApiKey: process.env.OPENAI_API_KEY!,
});

const ragTool = createRAGTool({
  ragProvider: rag,
  toolName: "search_knowledge_base",       // optional, this is the default
  toolDescription: "Search the knowledge base for relevant information to answer user questions", // optional, this is the default
});
```

`ragTool.execute(args)` calls `rag.prepareContext(args.query)` internally and returns `{ success: boolean, message: string }` — `success: false` if the query argument is missing/invalid or the search throws, otherwise a message containing the formatted document context (or a "no relevant information found" message if nothing matched).

### Registering it with a tool-calling provider

`createRAGTool` returns a `RealtimeTool`, which is exactly the shape `RealtimeProvider.registerFunction()` accepts. With `@khaveeai/providers-generic-stt-tts`'s `GenericPipelineProvider`:

```ts
import { GenericPipelineProvider } from "@khaveeai/providers-generic-stt-tts";
import { RAGProvider, createRAGTool } from "@khaveeai/providers-rag";

const rag = new RAGProvider({
  qdrantUrl: process.env.QDRANT_URL!,
  collectionName: "my-docs",
  openaiApiKey: process.env.OPENAI_API_KEY!,
});

const ragTool = createRAGTool({ ragProvider: rag });

const provider = new GenericPipelineProvider({
  // ...stt/llm/tts config
});

provider.registerFunction(ragTool);
```

The LLM will now see `search_knowledge_base` as an available function and can call it mid-conversation when it decides the user's question needs grounding from your documents.

This same `RealtimeTool` object also works directly with `@khaveeai/providers-openai-realtime`'s `OpenAIRealtimeProvider`, passed via its `tools` constructor option.

## Using a different vector store

`RAGProvider` is hardcoded to Qdrant (`@qdrant/js-client-rest`) — its constructor builds a `QdrantClient` directly from `qdrantUrl`/`qdrantApiKey`, and `searchDocuments()` calls `qdrantClient.search()` directly. There is no constructor option to inject a different client or a `VectorSearchProvider`-style interface.

`@khaveeai/providers-pgvector` exports a separate, similarly self-contained `PgVectorProvider` class (Postgres + pgvector instead of Qdrant) that implements its own `VectorSearchProvider` interface (`search(query, topK?, threshold?, metadataFilter?)`), but `RAGProvider` does not accept a `VectorSearchProvider` and has no code path that would use it. Swapping vector stores today means writing your own RAG class modeled on `RAGProvider`'s `searchDocuments`/`formatDocument`/`formatContext` methods, but backed by `PgVectorProvider.search()` instead of a direct `@qdrant/js-client-rest` client.

## API reference

All types are exported from `@khaveeai/providers-rag` (re-exported via `src/types.ts`).

### `RAGConfig`

Constructor config for `RAGProvider`.

```ts
interface RAGConfig {
  // Qdrant connection
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionName: string;

  // OpenAI embeddings
  openaiApiKey: string;
  embeddingModel?: string;       // default: "text-embedding-3-small"

  // Search behavior
  topK?: number;                 // default: 10
  scoreThreshold?: number;       // default: 0.21

  // Context formatting
  includeMetadata?: boolean;     // default: true
  metadataFields?: string[];     // default: ["title", "source"]
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `qdrantUrl` | yes | — | Your Qdrant instance URL |
| `qdrantApiKey` | no | — | Only needed if the instance requires auth |
| `collectionName` | yes | — | Qdrant collection to search |
| `openaiApiKey` | yes | — | Used for `embeddings.create` calls |
| `embeddingModel` | no | `"text-embedding-3-small"` | Must match the dimensionality of your Qdrant collection's vectors |
| `topK` | no | `10` | Max number of search results returned |
| `scoreThreshold` | no | `0.21` | Minimum similarity score to include a result |
| `includeMetadata` | no | `true` | Whether to attach metadata to formatted documents |
| `metadataFields` | no | `["title", "source"]` | Which payload fields to surface as metadata in addition to `payload.metadata` |

### `SearchResult`

Raw result from `searchDocuments()`, one per matched Qdrant point.

```ts
interface SearchResult {
  id: string | number;
  score: number;
  payload: any;
}
```

### `RAGDocument`

A formatted document, derived from a `SearchResult`'s payload.

```ts
interface RAGDocument {
  content: string;
  metadata?: Record<string, any>;
  score?: number;
}
```

### `RAGContext`

Returned by `prepareContext()` — everything needed to ground an LLM prompt.

```ts
interface RAGContext {
  query: string;
  documents: RAGDocument[];
  formattedContext: string;
}
```

## `RAGProvider` methods

| Method | Signature | Description |
|---|---|---|
| `getEmbedding` | `(text: string) => Promise<number[]>` | Calls OpenAI's embeddings API and returns the embedding vector. |
| `searchDocuments` | `(query: string) => Promise<SearchResult[]>` | Embeds the query and searches Qdrant; returns raw `SearchResult[]`. |
| `prepareContext` | `(query: string) => Promise<RAGContext>` | Main method. Searches, formats documents, and builds a single context string. |
| `createPromptWithContext` | `(query: string, promptTemplate?: (query, context) => string) => Promise<string>` | Calls `prepareContext` then renders a full prompt string via the default or supplied template. |
| `updateConfig` | `(config: Partial<RAGConfig>) => void` | Mutates the provider's config in place (e.g. to change `topK` or `scoreThreshold` at runtime). |
| `getConfig` | `() => RAGConfig & { ...resolved defaults }` | Returns a shallow copy of the current resolved config. |

## `createRAGTool` options

```ts
interface CreateRAGToolOptions {
  ragProvider: RAGProvider;
  toolName?: string;                                     // default: "search_knowledge_base"
  toolDescription?: string;                              // default: "Search the knowledge base for relevant information to answer user questions"
  promptTemplate?: (query: string, context: string) => string;
}
```

`createRAGTool(options): RealtimeTool` — the returned `RealtimeTool` has a single required `query: string` parameter and an `execute` function that returns `{ success: boolean, message: string }`.

## License

MIT — see [LICENSE](../../../LICENSE) if present in the repository root.
