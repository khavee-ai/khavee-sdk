/**
 * Types for PgVector Provider
 */

// ── Config ────────────────────────────────────────────────────────────────────

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

  /**
   * Default minimum pg_trgm trigram similarity 0–1 for `searchByKeyword`
   * (default: 0.15). Deliberately lower than pg_trgm's own 0.3 operator
   * default, which was tuned for English word-level fuzzy matching — Thai
   * character-run matching needs a lower floor. Real-world tuning against
   * actual query traffic may be needed.
   */
  defaultKeywordThreshold?: number;

  /** Max parallel INSERT statements per embedding batch during bulk insert (default: 5) */
  defaultConcurrency?: number;

  /** SSL configuration for PostgreSQL connection (default: false) */
  ssl?: boolean | { rejectUnauthorized: boolean };
}

// ── Document ──────────────────────────────────────────────────────────────────

export interface PgVectorDocument {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface PgVectorSearchResult extends PgVectorDocument {
  similarity: number;
}

// ── Bulk insert ───────────────────────────────────────────────────────────────

export interface BulkInsertRow {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface BulkInsertResult {
  inserted: number;
  failed: number;
  errors: { row: number; reason: string }[];
}

// ── CSV ───────────────────────────────────────────────────────────────────────

export interface CSVImportOptions {
  /**
   * Column whose value becomes the embedded `content`.
   * Default: "content"
   */
  contentColumn?: string;

  /**
   * Max parallel INSERT statements per embedding batch during CSV import (default: 5)
   */
  concurrency?: number;
}

// ── RAG interface (for OpenAI Realtime integration) ───────────────────────────

export interface VectorSearchProvider {
  search(
    query: string,
    topK?: number,
    threshold?: number,
    metadataFilter?: Record<string, unknown>
  ): Promise<PgVectorSearchResult[]>;

  /**
   * Optional: run a similarity search against a pre-computed embedding,
   * reusing it across multiple calls instead of re-embedding the same text.
   */
  searchByEmbedding?(
    embedding: number[],
    topK?: number,
    threshold?: number,
    metadataFilter?: Record<string, unknown>
  ): Promise<PgVectorSearchResult[]>;

  /**
   * Optional: run a trigram (pg_trgm) keyword search alongside vector
   * search, for fusing the two ranked lists (e.g. via Reciprocal Rank
   * Fusion) instead of relying on cosine similarity alone.
   */
  searchByKeyword?(
    query: string,
    topK?: number,
    threshold?: number,
    metadataFilter?: Record<string, unknown>
  ): Promise<PgVectorSearchResult[]>;
}
