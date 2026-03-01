import { PgVectorConfig, PgVectorDocument, PgVectorSearchResult, BulkInsertRow, BulkInsertResult, CSVImportOptions, VectorSearchProvider } from "./types";
export declare class PgVectorProvider implements VectorSearchProvider {
    private pool;
    private openai;
    private tableName;
    private embeddingModel;
    private embeddingDimensions;
    private defaultTopK;
    private defaultThreshold;
    private defaultConcurrency;
    constructor(config: PgVectorConfig);
    embed(text: string): Promise<number[]>;
    private toVectorLiteral;
    /**
     * Creates the pgvector extension, the documents table, and an HNSW index.
     * Safe to run multiple times (idempotent).
     */
    migrate(): Promise<void>;
    /**
     * Embed a single piece of text and insert it into the database.
     */
    insertDocument(content: string, metadata?: Record<string, unknown>): Promise<PgVectorDocument>;
    /**
     * Embed and insert multiple documents. Processes rows in parallel batches.
     */
    bulkInsertDocuments(rows: BulkInsertRow[], concurrency?: number): Promise<BulkInsertResult>;
    /**
     * Parse a CSV string and bulk-insert all rows.
     *
     * The CSV **must** include a header row.
     * The column named by `contentColumn` (default: "content") is embedded.
     * All other columns are stored as metadata.
     *
     * Example CSV:
     * ```
     * content,category,author
     * "Hello my name is Non",greeting,Non
     * "The Eiffel Tower is in Paris",geography,system
     * ```
     */
    importCSV(csvText: string, options?: CSVImportOptions): Promise<BulkInsertResult>;
    /**
     * Minimal RFC-4180 compliant CSV parser (no external dependency).
     * Handles quoted fields, escaped quotes (""), and CRLF/LF line endings.
     */
    parseCSV(csvText: string): Record<string, string>[];
    /**
     * Return the most recently inserted documents (no embeddings).
     * Pass `metadataFilter` to scope results to a specific user/project.
     * Example: { userId: 'u1', projectId: 'p1' }
     */
    listDocuments(limit?: number, metadataFilter?: Record<string, unknown>): Promise<PgVectorDocument[]>;
    /**
     * Cosine-similarity search. Embeds the query then finds the most similar
     * documents stored in the table.
     *
     * @param query          Natural language query string
     * @param topK           Max number of results (default: config.defaultTopK)
     * @param threshold      Min cosine similarity 0–1 (default: config.defaultThreshold)
     * @param metadataFilter Optional JSONB containment filter, e.g. { userId, projectId }
     */
    search(query: string, topK?: number, threshold?: number, metadataFilter?: Record<string, unknown>): Promise<PgVectorSearchResult[]>;
    searchDocuments(query: string, topK?: number, threshold?: number, metadataFilter?: Record<string, unknown>): Promise<PgVectorSearchResult[]>;
    deleteDocument(id: number): Promise<void>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=PgVectorProvider.d.ts.map