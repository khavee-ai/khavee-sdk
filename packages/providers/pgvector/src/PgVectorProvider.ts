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
   * Embed and insert multiple documents. Processes rows in parallel batches.
   */
  async bulkInsertDocuments(
    rows: BulkInsertRow[],
    concurrency: number = this.defaultConcurrency
  ): Promise<BulkInsertResult> {
    const result: BulkInsertResult = { inserted: 0, failed: 0, errors: [] };

    for (let i = 0; i < rows.length; i += concurrency) {
      const batch = rows.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (row, batchIdx) => {
          const rowNum = i + batchIdx + 1;
          try {
            await this.insertDocument(row.content, row.metadata ?? {});
            result.inserted++;
          } catch (err) {
            result.failed++;
            result.errors.push({ row: rowNum, reason: String(err) });
          }
        })
      );
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
   * Handles quoted fields, escaped quotes (""), and CRLF/LF line endings.
   */
  parseCSV(csvText: string): Record<string, string>[] {
    const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const nonEmpty = lines.filter((l) => l.trim() !== "");
    if (nonEmpty.length < 2) return [];

    const parseRow = (line: string): string[] => {
      const fields: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
          else if (ch === '"') { inQuotes = false; }
          else { current += ch; }
        } else {
          if (ch === '"') { inQuotes = true; }
          else if (ch === ",") { fields.push(current.trim()); current = ""; }
          else { current += ch; }
        }
      }
      fields.push(current.trim());
      return fields;
    };

    const headers = parseRow(nonEmpty[0]);
    return nonEmpty.slice(1).map((line) => {
      const values = parseRow(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => { obj[h] = values[idx] ?? ""; });
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
    const vec = this.toVectorLiteral(embedding);

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
