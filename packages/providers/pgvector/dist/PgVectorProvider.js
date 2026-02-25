import { Pool } from "pg";
import OpenAI from "openai";
export class PgVectorProvider {
    constructor(config) {
        this.pool = new Pool({ connectionString: config.connectionString });
        this.openai = new OpenAI({ apiKey: config.openaiApiKey });
        this.tableName = config.tableName ?? "documents";
        this.embeddingModel = config.embeddingModel ?? "text-embedding-3-small";
        this.embeddingDimensions = config.embeddingDimensions ?? 1536;
        this.defaultTopK = config.defaultTopK ?? 5;
        this.defaultThreshold = config.defaultThreshold ?? 0.3;
        this.defaultConcurrency = config.defaultConcurrency ?? 5;
    }
    // ── Embedding ──────────────────────────────────────────────────────────────
    async embed(text) {
        const res = await this.openai.embeddings.create({
            model: this.embeddingModel,
            input: text,
        });
        return res.data[0].embedding;
    }
    toVectorLiteral(embedding) {
        return `[${embedding.join(",")}]`;
    }
    // ── Schema / migration ─────────────────────────────────────────────────────
    /**
     * Creates the pgvector extension, the documents table, and an HNSW index.
     * Safe to run multiple times (idempotent).
     */
    async migrate() {
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
        }
        finally {
            client.release();
        }
    }
    // ── Insert ─────────────────────────────────────────────────────────────────
    /**
     * Embed a single piece of text and insert it into the database.
     */
    async insertDocument(content, metadata = {}) {
        const embedding = await this.embed(content);
        const vec = this.toVectorLiteral(embedding);
        const { rows } = await this.pool.query(`INSERT INTO ${this.tableName} (content, metadata, embedding)
       VALUES ($1, $2, $3::vector)
       RETURNING id, content, metadata, created_at AS "createdAt"`, [content, JSON.stringify(metadata), vec]);
        return rows[0];
    }
    // ── Bulk insert ────────────────────────────────────────────────────────────
    /**
     * Embed and insert multiple documents. Processes rows in parallel batches.
     */
    async bulkInsertDocuments(rows, concurrency = this.defaultConcurrency) {
        const result = { inserted: 0, failed: 0, errors: [] };
        for (let i = 0; i < rows.length; i += concurrency) {
            const batch = rows.slice(i, i + concurrency);
            await Promise.all(batch.map(async (row, batchIdx) => {
                const rowNum = i + batchIdx + 1;
                try {
                    await this.insertDocument(row.content, row.metadata ?? {});
                    result.inserted++;
                }
                catch (err) {
                    result.failed++;
                    result.errors.push({ row: rowNum, reason: String(err) });
                }
            }));
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
    async importCSV(csvText, options = {}) {
        const contentCol = options.contentColumn ?? "content";
        const rows = this.parseCSV(csvText);
        if (rows.length === 0) {
            return { inserted: 0, failed: 0, errors: [] };
        }
        if (!(contentCol in rows[0])) {
            throw new Error(`CSV must have a "${contentCol}" column`);
        }
        const insertRows = rows.map(({ [contentCol]: content, ...rest }) => ({
            content: content,
            metadata: rest,
        }));
        return this.bulkInsertDocuments(insertRows, options.concurrency ?? this.defaultConcurrency);
    }
    /**
     * Minimal RFC-4180 compliant CSV parser (no external dependency).
     * Handles quoted fields, escaped quotes (""), and CRLF/LF line endings.
     */
    parseCSV(csvText) {
        const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        const nonEmpty = lines.filter((l) => l.trim() !== "");
        if (nonEmpty.length < 2)
            return [];
        const parseRow = (line) => {
            const fields = [];
            let current = "";
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQuotes) {
                    if (ch === '"' && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    }
                    else if (ch === '"') {
                        inQuotes = false;
                    }
                    else {
                        current += ch;
                    }
                }
                else {
                    if (ch === '"') {
                        inQuotes = true;
                    }
                    else if (ch === ",") {
                        fields.push(current.trim());
                        current = "";
                    }
                    else {
                        current += ch;
                    }
                }
            }
            fields.push(current.trim());
            return fields;
        };
        const headers = parseRow(nonEmpty[0]);
        return nonEmpty.slice(1).map((line) => {
            const values = parseRow(line);
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = values[idx] ?? ""; });
            return obj;
        });
    }
    // ── List / browse ──────────────────────────────────────────────────────────
    /**
     * Return the most recently inserted documents (no embeddings).
     */
    async listDocuments(limit = 20) {
        const { rows } = await this.pool.query(`SELECT id, content, metadata, created_at AS "createdAt"
       FROM ${this.tableName}
       ORDER BY id DESC
       LIMIT $1`, [limit]);
        return rows;
    }
    // ── Vector search ──────────────────────────────────────────────────────────
    /**
     * Cosine-similarity search. Embeds the query then finds the most similar
     * documents stored in the table.
     *
     * @param query     Natural language query string
     * @param topK      Max number of results (default: config.defaultTopK)
     * @param threshold Min cosine similarity 0–1 (default: config.defaultThreshold)
     */
    async search(query, topK = this.defaultTopK, threshold = this.defaultThreshold) {
        return this.searchDocuments(query, topK, threshold);
    }
    async searchDocuments(query, topK = this.defaultTopK, threshold = this.defaultThreshold) {
        const embedding = await this.embed(query);
        const vec = this.toVectorLiteral(embedding);
        const { rows } = await this.pool.query(`SELECT
         id,
         content,
         metadata,
         created_at AS "createdAt",
         1 - (embedding <=> $1::vector) AS similarity
       FROM ${this.tableName}
       WHERE 1 - (embedding <=> $1::vector) >= $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`, [vec, threshold, topK]);
        return rows;
    }
    // ── Delete ─────────────────────────────────────────────────────────────────
    async deleteDocument(id) {
        await this.pool.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id]);
    }
    // ── Cleanup ────────────────────────────────────────────────────────────────
    async destroy() {
        await this.pool.end();
    }
}
