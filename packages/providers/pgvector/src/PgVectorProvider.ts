import { Pool, PoolClient } from "pg";
import OpenAI from "openai";
import {
  PgVectorConfig,
  PgVectorDocument,
  PgVectorSearchResult,
  BulkInsertRow,
  BulkInsertResult,
  CSVImportOptions,
  VectorSearchProvider,
} from "./types";

export class PgVectorProvider implements VectorSearchProvider {
  private pool: Pool;
  private openai: OpenAI;
  private tableName: string;
  private embeddingModel: string;
  private embeddingDimensions: number;
  private defaultTopK: number;
  private defaultThreshold: number;
  private defaultConcurrency: number;

  /**
   * Internal tuning constant — max texts sent per `embeddings.create` call.
   * Not exposed on `PgVectorConfig`: 100 texts per request stays well under
   * OpenAI's per-request array-size limit for `text-embedding-3-small`/
   * `-large` regardless of individual text length, so a single request can
   * never blow the array/token ceiling. This is an internal performance
   * knob, not something any consumer needs to tune.
   */
  private readonly embeddingBatchSize = 100;

  constructor(config: PgVectorConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      ssl: config.ssl ?? false,
    });
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.tableName = config.tableName ?? "documents";
    this.embeddingModel = config.embeddingModel ?? "text-embedding-3-small";
    this.embeddingDimensions = config.embeddingDimensions ?? 1536;
    this.defaultTopK = config.defaultTopK ?? 5;
    this.defaultThreshold = config.defaultThreshold ?? 0.3;
    this.defaultConcurrency = config.defaultConcurrency ?? 5;
  }

  // ── Embedding ──────────────────────────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    const res = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return res.data[0].embedding;
  }

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(",")}]`;
  }

  /**
   * Embed many texts in internally-chunked batches of `embeddingBatchSize`.
   * Makes one `embeddings.create` call per chunk instead of one call per
   * text, and returns embeddings in the same order as the input `texts`.
   *
   * @param texts Texts to embed, in order
   * @returns Embedding vectors, index-aligned with `texts`
   * @throws {Error} If a chunk's response returns a different number of
   *                 embeddings than texts sent — fails loudly rather than
   *                 silently misaligning every subsequent row's embedding
   */
  private async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.embeddingBatchSize) {
      const chunk = texts.slice(i, i + this.embeddingBatchSize);
      const res = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: chunk,
      });

      // Defensive: sort a copy by `index` rather than trusting response
      // order, and never mutate `res.data` in place.
      const sorted = [...res.data].sort((a, b) => a.index - b.index);

      if (sorted.length !== chunk.length) {
        throw new Error(
          `Embedding batch size mismatch: sent ${chunk.length} texts, received ${sorted.length} embeddings`
        );
      }

      for (const item of sorted) {
        results.push(item.embedding);
      }
    }

    return results;
  }

  // ── Schema / migration ─────────────────────────────────────────────────────

  /**
   * Creates the pgvector extension, the documents table, and an HNSW index.
   * Safe to run multiple times (idempotent).
   */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id         SERIAL PRIMARY KEY,
          content    TEXT        NOT NULL,
          metadata   JSONB       NOT NULL DEFAULT '{}',
          embedding  vector(${this.embeddingDimensions}),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await client.query(`DROP INDEX IF EXISTS ${this.tableName}_embedding_idx`);
      await client.query(`
        CREATE INDEX ${this.tableName}_embedding_idx
        ON ${this.tableName} USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);
    } finally {
      client.release();
    }
  }

  // ── Insert ─────────────────────────────────────────────────────────────────

  /**
   * Embed a single piece of text and insert it into the database.
   */
  async insertDocument(
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<PgVectorDocument> {
    const embedding = await this.embed(content);
    return this.insertDocumentWithEmbedding(content, metadata, embedding);
  }

  /**
   * Single place the INSERT SQL is built, so `insertDocument` and
   * `bulkInsertDocuments` can never drift apart (mirrors the `runVectorQuery`
   * extraction from quick task 260726-9cq).
   */
  private async insertDocumentWithEmbedding(
    content: string,
    metadata: Record<string, unknown>,
    embedding: number[]
  ): Promise<PgVectorDocument> {
    const vec = this.toVectorLiteral(embedding);

    const { rows } = await this.pool.query(
      `INSERT INTO ${this.tableName} (content, metadata, embedding)
       VALUES ($1, $2, $3::vector)
       RETURNING id, content, metadata, created_at AS "createdAt"`,
      [content, JSON.stringify(metadata), vec]
    );
    return rows[0] as PgVectorDocument;
  }

  // ── Bulk insert ────────────────────────────────────────────────────────────

  /**
   * Embed and insert multiple documents. Embeddings are generated in
   * batches of up to `embeddingBatchSize` texts per OpenAI API call (instead
   * of one call per row); `concurrency` now controls how many parallel
   * INSERT statements run per batch, not how many parallel embedding
   * requests are in flight.
   */
  async bulkInsertDocuments(
    rows: BulkInsertRow[],
    concurrency: number = this.defaultConcurrency
  ): Promise<BulkInsertResult> {
    const result: BulkInsertResult = { inserted: 0, failed: 0, errors: [] };

    // Guard against a zero/negative/NaN concurrency, which previously
    // produced an infinite loop.
    const insertConcurrency = Math.max(1, Math.floor(concurrency) || 1);

    for (let i = 0; i < rows.length; i += this.embeddingBatchSize) {
      const chunk = rows.slice(i, i + this.embeddingBatchSize);

      let embeddings: number[][];
      try {
        embeddings = await this.embedBatch(chunk.map((r) => r.content));
      } catch (err) {
        // One chunk's embedding failure must never abort the whole import —
        // attribute the failure to every row in this chunk and move on.
        for (let idx = 0; idx < chunk.length; idx++) {
          result.failed++;
          result.errors.push({ row: i + idx + 1, reason: String(err) });
        }
        continue;
      }

      for (let j = 0; j < chunk.length; j += insertConcurrency) {
        const slice = chunk.slice(j, j + insertConcurrency);
        await Promise.all(
          slice.map(async (row, k) => {
            const rowNum = i + j + k + 1;
            try {
              await this.insertDocumentWithEmbedding(
                row.content,
                row.metadata ?? {},
                embeddings[j + k]
              );
              result.inserted++;
            } catch (err) {
              result.failed++;
              result.errors.push({ row: rowNum, reason: String(err) });
            }
          })
        );
      }
    }

    return result;
  }

  // ── CSV import ─────────────────────────────────────────────────────────────

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
  async importCSV(
    csvText: string,
    options: CSVImportOptions = {}
  ): Promise<BulkInsertResult> {
    const contentCol = options.contentColumn ?? "content";
    const rows = this.parseCSV(csvText);

    if (rows.length === 0) {
      return { inserted: 0, failed: 0, errors: [] };
    }

    if (!(contentCol in rows[0])) {
      throw new Error(`CSV must have a "${contentCol}" column`);
    }

    const insertRows: BulkInsertRow[] = rows.map(({ [contentCol]: content, ...rest }) => ({
      content: content as string,
      metadata: rest as Record<string, unknown>,
    }));

    return this.bulkInsertDocuments(insertRows, options.concurrency ?? this.defaultConcurrency);
  }

  /**
   * Minimal RFC-4180 compliant CSV parser (no external dependency).
   * Handles quoted fields, escaped quotes (""), CRLF/LF line endings, and
   * newlines embedded inside quoted fields.
   *
   * Quote state is tracked across the whole input in a single pass — a
   * newline only ends a row when it occurs outside an open quote. Splitting
   * on "\n" up front (the previous implementation) breaks on any quoted
   * field containing a literal newline, shredding one logical row into one
   * row per physical line.
   */
  parseCSV(csvText: string): Record<string, string>[] {
    const text = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    const rows: string[][] = [];
    let fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
        continue;
      }

      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { fields.push(current.trim()); current = ""; }
      else if (ch === "\n") {
        fields.push(current.trim());
        rows.push(fields);
        fields = [];
        current = "";
      } else {
        current += ch;
      }
    }
    if (current !== "" || fields.length > 0) {
      fields.push(current.trim());
      rows.push(fields);
    }

    const nonEmptyRows = rows.filter((r) => !(r.length === 1 && r[0] === ""));
    if (nonEmptyRows.length < 2) return [];

    const [headerRow, ...dataRows] = nonEmptyRows;
    return dataRows.map((values) => {
      const obj: Record<string, string> = {};
      headerRow.forEach((h, idx) => { obj[h] = values[idx] ?? ""; });
      return obj;
    });
  }

  // ── List / browse ──────────────────────────────────────────────────────────

  /**
   * Return the most recently inserted documents (no embeddings).
   * Pass `metadataFilter` to scope results to a specific user/project.
   * Example: { userId: 'u1', projectId: 'p1' }
   */
  async listDocuments(
    limit: number = 20,
    metadataFilter?: Record<string, unknown>
  ): Promise<PgVectorDocument[]> {
    if (metadataFilter && Object.keys(metadataFilter).length > 0) {
      const { rows } = await this.pool.query(
        `SELECT id, content, metadata, created_at AS "createdAt"
         FROM ${this.tableName}
         WHERE metadata @> $1::jsonb
         ORDER BY id DESC
         LIMIT $2`,
        [JSON.stringify(metadataFilter), limit]
      );
      return rows as PgVectorDocument[];
    }
    const { rows } = await this.pool.query(
      `SELECT id, content, metadata, created_at AS "createdAt"
       FROM ${this.tableName}
       ORDER BY id DESC
       LIMIT $1`,
      [limit]
    );
    return rows as PgVectorDocument[];
  }

  // ── Vector search ──────────────────────────────────────────────────────────

  /**
   * Cosine-similarity search. Embeds the query then finds the most similar
   * documents stored in the table.
   *
   * @param query          Natural language query string
   * @param topK           Max number of results (default: config.defaultTopK)
   * @param threshold      Min cosine similarity 0–1 (default: config.defaultThreshold)
   * @param metadataFilter Optional JSONB containment filter, e.g. { userId, projectId }
   */
  async search(
    query: string,
    topK: number = this.defaultTopK,
    threshold: number = this.defaultThreshold,
    metadataFilter?: Record<string, unknown>
  ): Promise<PgVectorSearchResult[]> {
    return this.searchDocuments(query, topK, threshold, metadataFilter);
  }

  async searchDocuments(
    query: string,
    topK: number = this.defaultTopK,
    threshold: number = this.defaultThreshold,
    metadataFilter?: Record<string, unknown>
  ): Promise<PgVectorSearchResult[]> {
    const embedding = await this.embed(query);
    return this.runVectorQuery(this.toVectorLiteral(embedding), topK, threshold, metadataFilter);
  }

  /**
   * Cosine-similarity search using a caller-supplied, pre-computed embedding.
   * Runs the identical similarity query as `searchDocuments` but skips the
   * OpenAI embedding API call entirely.
   *
   * Intended usage: embed once with `embed(text)`, then call this method
   * repeatedly to avoid re-paying the embedding round-trip — e.g. a 0.3
   * threshold attempt followed by a 0.15 retry, or the same vector checked
   * against different metadata filters.
   *
   * @param embedding      Pre-computed embedding vector (must match
   *                       `embeddingDimensions` and contain only finite numbers)
   * @param topK           Max number of results (default: config.defaultTopK)
   * @param threshold      Min cosine similarity 0–1 (default: config.defaultThreshold)
   * @param metadataFilter Optional JSONB containment filter, e.g. { userId, projectId }
   * @throws {Error} If the embedding is empty, non-finite, or the wrong dimension count
   */
  async searchByEmbedding(
    embedding: number[],
    topK: number = this.defaultTopK,
    threshold: number = this.defaultThreshold,
    metadataFilter?: Record<string, unknown>
  ): Promise<PgVectorSearchResult[]> {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("searchByEmbedding requires a non-empty embedding array");
    }
    if (embedding.length !== this.embeddingDimensions) {
      throw new Error(
        `Embedding dimension mismatch: got ${embedding.length}, expected ${this.embeddingDimensions}`
      );
    }
    if (!embedding.every((n) => Number.isFinite(n))) {
      throw new Error("Embedding contains non-finite values (NaN/Infinity)");
    }

    return this.runVectorQuery(this.toVectorLiteral(embedding), topK, threshold, metadataFilter);
  }

  /**
   * Single place the similarity SQL is built, so `searchDocuments` and
   * `searchByEmbedding` can never drift apart.
   */
  private async runVectorQuery(
    vec: string,
    topK: number,
    threshold: number,
    metadataFilter?: Record<string, unknown>
  ): Promise<PgVectorSearchResult[]> {
    const hasFilter = metadataFilter && Object.keys(metadataFilter).length > 0;

    if (hasFilter) {
      const { rows } = await this.pool.query(
        `SELECT
           id,
           content,
           metadata,
           created_at AS "createdAt",
           1 - (embedding <=> $1::vector) AS similarity
         FROM ${this.tableName}
         WHERE 1 - (embedding <=> $1::vector) >= $2
           AND metadata @> $4::jsonb
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [vec, threshold, topK, JSON.stringify(metadataFilter)]
      );
      return rows as PgVectorSearchResult[];
    }

    const { rows } = await this.pool.query(
      `SELECT
         id,
         content,
         metadata,
         created_at AS "createdAt",
         1 - (embedding <=> $1::vector) AS similarity
       FROM ${this.tableName}
       WHERE 1 - (embedding <=> $1::vector) >= $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vec, threshold, topK]
    );

    return rows as PgVectorSearchResult[];
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async deleteDocument(id: number): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id]);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  async destroy(): Promise<void> {
    await this.pool.end();
  }
}
