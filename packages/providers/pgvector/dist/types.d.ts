/**
 * Types for PgVector Provider
 */
export interface PgVectorConfig {
    /**
     * PostgreSQL connection string.
     * e.g. "postgresql://user:pass@localhost:5432/mydb"
     * Ignored if a custom `db` driver is passed to the constructor.
     */
    connectionString: string;
    /** OpenAI API key used for generating embeddings */
    openaiApiKey: string;
    /** Embedding model (default: "text-embedding-3-small", 1536 dims) */
    embeddingModel?: string;
    /**
     * Embedding dimensions – must match the model used.
     * text-embedding-3-small → 1536 (default)
     * text-embedding-3-large → 3072
     */
    embeddingDimensions?: number;
    /** Table name to store documents (default: "documents") */
    tableName?: string;
    /** Default number of results returned by search (default: 5) */
    defaultTopK?: number;
    /** Default minimum similarity score 0–1 (default: 0.3) */
    defaultThreshold?: number;
    /** Max parallel embedding requests during bulk insert (default: 5) */
    defaultConcurrency?: number;
}
export interface PgVectorDocument {
    id: number;
    content: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
}
export interface PgVectorSearchResult extends PgVectorDocument {
    similarity: number;
}
export interface BulkInsertRow {
    content: string;
    metadata?: Record<string, unknown>;
}
export interface BulkInsertResult {
    inserted: number;
    failed: number;
    errors: {
        row: number;
        reason: string;
    }[];
}
export interface CSVImportOptions {
    /**
     * Column whose value becomes the embedded `content`.
     * Default: "content"
     */
    contentColumn?: string;
    /**
     * Number of parallel embed calls during CSV import (default: 5)
     */
    concurrency?: number;
}
export interface VectorSearchProvider {
    search(query: string, topK?: number, threshold?: number, metadataFilter?: Record<string, unknown>): Promise<PgVectorSearchResult[]>;
}
//# sourceMappingURL=types.d.ts.map