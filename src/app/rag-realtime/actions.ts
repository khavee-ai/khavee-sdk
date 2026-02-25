"use server";

import { PgVectorProvider } from "@khaveeai/providers-pgvector";

let _provider: PgVectorProvider | null = null;
function getProvider() {
  if (!_provider) {
    const connectionString = process.env.DATABASE_URL;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    if (!openaiApiKey) throw new Error("OPENAI_API_KEY is not set");
    _provider = new PgVectorProvider({ connectionString, openaiApiKey });
  }
  return _provider;
}

export async function searchKnowledgeBase(query: string, topK = 5) {
  const results = await getProvider().search(query, topK, 0.3);
  if (!results.length) return "No relevant information found.";
  return results
    .map((r, i) => `[${i + 1}] ${r.content} (score: ${(r.similarity ?? 0).toFixed(2)})`)
    .join("\n");
}
