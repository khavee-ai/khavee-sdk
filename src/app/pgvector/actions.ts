"use server";

import { PgVectorProvider } from "@khaveeai/providers-pgvector";
import type {
  PgVectorDocument,
  PgVectorSearchResult,
  BulkInsertRow,
  BulkInsertResult,
  CSVImportOptions,
} from "@khaveeai/providers-pgvector";

// ── Singleton provider ────────────────────────────────────────────────────────
function getProvider(): PgVectorProvider {
  const connectionString = process.env.DATABASE_URL;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY is not set");
  return new PgVectorProvider({ connectionString, openaiApiKey });
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function migrateAction(): Promise<{ success: boolean; error?: string }> {
  try {
    await getProvider().migrate();
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function insertAction(
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<{ success: boolean; document?: PgVectorDocument; error?: string }> {
  try {
    const document = await getProvider().insertDocument(content, metadata);
    return { success: true, document };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function bulkAction(
  rows: BulkInsertRow[],
  concurrency?: number
): Promise<{ success: boolean; result?: BulkInsertResult; error?: string }> {
  try {
    const result = await getProvider().bulkInsertDocuments(rows, concurrency);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function csvAction(
  csvText: string,
  options?: CSVImportOptions
): Promise<{ success: boolean; result?: BulkInsertResult; error?: string }> {
  try {
    const result = await getProvider().importCSV(csvText, options);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function listAction(
  limit = 20
): Promise<{ success: boolean; documents?: PgVectorDocument[]; error?: string }> {
  try {
    const documents = await getProvider().listDocuments(limit);
    return { success: true, documents };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function searchAction(
  query: string,
  topK = 5,
  threshold = 0.3
): Promise<{ success: boolean; results?: PgVectorSearchResult[]; error?: string }> {
  try {
    const results = await getProvider().search(query, topK, threshold);
    return { success: true, results };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function deleteAction(
  id: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await getProvider().deleteDocument(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
