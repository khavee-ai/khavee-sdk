"use client";

import { useState, useRef } from "react";
import {
  migrateAction,
  insertAction,
  bulkAction,
  csvAction,
  listAction,
  searchAction,
  deleteAction,
} from "./actions";
import type {
  PgVectorDocument,
  PgVectorSearchResult,
  BulkInsertResult,
} from "@khaveeai/providers-pgvector";

// ── Types ─────────────────────────────────────────────────────────────────────
type Doc = PgVectorDocument & { createdAt: string | Date };
type SearchResult = PgVectorSearchResult;
type BulkResult = BulkInsertResult;

const SAMPLE_CSV = `content,category,source
"The Eiffel Tower is located in Paris, France",geography,wiki
"Python is a high-level, interpreted programming language",tech,docs
"Mount Everest is the highest mountain in the world at 8,849 m",geography,wiki
"React is a JavaScript library for building user interfaces",tech,docs
"The Amazon River is the largest river by discharge in the world",geography,wiki
"TypeScript adds static typing to JavaScript",tech,docs
"The Great Wall of China stretches over 21,000 km",history,wiki
"Node.js is a cross-platform JavaScript runtime environment",tech,docs`;

const SAMPLE_BULK = JSON.stringify(
  [
    { content: "Hello, my name is Non", metadata: { lang: "en" } },
    { content: "สวัสดี ฉันชื่อนน", metadata: { lang: "th" } },
    { content: "Bangkok is the capital city of Thailand", metadata: { tag: "geography" } },
  ],
  null,
  2
);

// ── Component ─────────────────────────────────────────────────────────────────
export default function PgVectorSdkDemo() {
  const [tab, setTab] = useState<"setup" | "insert" | "bulk" | "csv" | "browse" | "search">("setup");

  // — setup
  const [migrateStatus, setMigrateStatus] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);

  // — insert
  const [insertContent, setInsertContent] = useState("");
  const [insertMeta, setInsertMeta] = useState("");
  const [insertResult, setInsertResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [inserting, setInserting] = useState(false);

  // — bulk
  const [bulkJson, setBulkJson] = useState(SAMPLE_BULK);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [bulking, setBulking] = useState(false);

  // — csv
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [csvResult, setCsvResult] = useState<BulkResult | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // — browse
  const [docs, setDocs] = useState<Doc[]>([]);
  const [browseLimit, setBrowseLimit] = useState(20);
  const [browsing, setBrowsing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // — search
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [threshold, setThreshold] = useState(0.3);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleMigrate() {
    setMigrating(true);
    setMigrateStatus(null);
    const data = await migrateAction();
    setMigrating(false);
    setMigrateStatus(data.success ? "✓ Database migrated successfully" : "✗ " + (data.error ?? "Unknown error"));
  }

  async function handleInsert() {
    if (!insertContent.trim()) return;
    setInserting(true);
    setInsertResult(null);
    let metadata: Record<string, unknown> = {};
    try { if (insertMeta.trim()) metadata = JSON.parse(insertMeta); } catch { /* ignore */ }
    const data = await insertAction(insertContent.trim(), metadata);
    setInserting(false);
    if (data.success && data.document) {
      setInsertResult({ ok: true, msg: `Inserted document #${data.document!.id}` });
      setInsertContent("");
      setInsertMeta("");
    } else {
      setInsertResult({ ok: false, msg: data.error ?? "Failed" });
    }
  }

  async function handleBulk() {
    let rows: unknown;
    try { rows = JSON.parse(bulkJson); } catch { setBulkResult(null); return; }
    setBulking(true);
    const data = await bulkAction(rows as { content: string; metadata?: Record<string, unknown> }[]);
    setBulking(false);
    if (data.success && data.result) setBulkResult(data.result);
  }

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsvText(text);
  }

  async function handleCsvImport() {
    if (!csvText.trim()) return;
    setCsvLoading(true);
    const data = await csvAction(csvText);
    setCsvLoading(false);
    if (data.success && data.result) setCsvResult(data.result);
  }

  async function handleBrowse() {
    setBrowsing(true);
    const data = await listAction(browseLimit);
    setBrowsing(false);
    if (data.success && data.documents) setDocs(data.documents as Doc[]);
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    await deleteAction(id);
    setDeletingId(null);
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    const data = await searchAction(query, topK, threshold);
    setSearching(false);
    if (data.success && data.results) setSearchResults(data.results);
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

  const tabs: { id: typeof tab; label: string; badge?: string }[] = [
    { id: "setup",  label: "Setup",        badge: "migrate()" },
    { id: "insert", label: "Insert",       badge: "insertDocument()" },
    { id: "bulk",   label: "Bulk Insert",  badge: "bulkInsertDocuments()" },
    { id: "csv",    label: "CSV Import",   badge: "importCSV()" },
    { id: "browse", label: "Browse",       badge: "listDocuments()" },
    { id: "search", label: "Search",       badge: "search()" },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ── Header ── */}
      <header className="border-b border-gray-800 px-8 py-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                @khaveeai/providers-pgvector
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                Interactive demo — PostgreSQL + pgvector + OpenAI embeddings
              </p>
            </div>
            <a
              href="/vectors"
              className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-gray-400 transition-colors"
            >
              → Legacy page
            </a>
          </div>

          {/* Method pills */}
          <div className="flex flex-wrap gap-2 mt-4">
            {["migrate()", "insertDocument()", "bulkInsertDocuments()", "importCSV()", "listDocuments()", "search()", "deleteDocument()"].map((m) => (
              <span key={m} className="text-xs px-2 py-0.5 bg-indigo-900/50 text-indigo-300 rounded font-mono">
                {m}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── Tabs ── */}
      <div className="border-b border-gray-800 px-8">
        <div className="max-w-5xl mx-auto flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); if (t.id === "browse") handleBrowse(); }}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? "border-indigo-500 text-indigo-300"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t.label}
              {t.badge && (
                <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded font-mono hidden sm:inline">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <main className="max-w-5xl mx-auto px-8 py-8">

        {/* ════ Setup ════ */}
        {tab === "setup" && (
          <Section
            title="migrate()"
            description="Creates the pgvector extension, the documents table, and an HNSW index. Safe to run multiple times."
          >
            <CodeBlock>{`const provider = new PgVectorProvider({
  connectionString: process.env.DATABASE_URL,
  openaiApiKey: process.env.OPENAI_API_KEY,
});

await provider.migrate();`}</CodeBlock>

            <div className="flex items-center gap-4 mt-6">
              <Btn onClick={handleMigrate} loading={migrating} icon="⚡">
                Run migrate()
              </Btn>
              {migrateStatus && (
                <Status ok={migrateStatus.startsWith("✓")}>{migrateStatus}</Status>
              )}
            </div>
          </Section>
        )}

        {/* ════ Insert ════ */}
        {tab === "insert" && (
          <Section
            title="insertDocument(content, metadata?)"
            description="Embeds a single document with OpenAI and stores it in the database."
          >
            <CodeBlock>{`const doc = await provider.insertDocument(
  "Hello, my name is Non",
  { source: "manual", lang: "en" }
);
// → { id: 1, content: "...", metadata: {...}, createdAt: Date }`}</CodeBlock>

            <div className="mt-6 space-y-3 max-w-lg">
              <label className="block">
                <span className="text-xs text-gray-500 mb-1 block">content <span className="text-red-400">*</span></span>
                <textarea
                  rows={4}
                  value={insertContent}
                  onChange={(e) => setInsertContent(e.target.value)}
                  placeholder="Type any text to embed and store…"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm outline-none focus:border-indigo-500 resize-none"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 mb-1 block">metadata (JSON, optional)</span>
                <input
                  value={insertMeta}
                  onChange={(e) => setInsertMeta(e.target.value)}
                  placeholder='{"source": "manual", "lang": "en"}'
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm outline-none focus:border-indigo-500 font-mono"
                />
              </label>
              <div className="flex items-center gap-4">
                <Btn onClick={handleInsert} loading={inserting} disabled={!insertContent.trim()} icon="➕">
                  insertDocument()
                </Btn>
                {insertResult && <Status ok={insertResult.ok}>{insertResult.msg}</Status>}
              </div>
            </div>
          </Section>
        )}

        {/* ════ Bulk Insert ════ */}
        {tab === "bulk" && (
          <Section
            title="bulkInsertDocuments(rows[], concurrency?)"
            description="Embeds and inserts multiple documents in parallel batches. Failed rows are tracked individually."
          >
            <CodeBlock>{`const result = await provider.bulkInsertDocuments([
  { content: "Hello, my name is Non",      metadata: { lang: "en" } },
  { content: "สวัสดี ฉันชื่อนน",          metadata: { lang: "th" } },
  { content: "Bangkok is the capital ...", metadata: { tag: "geography" } },
]);
// → { inserted: 3, failed: 0, errors: [] }`}</CodeBlock>

            <div className="mt-6 space-y-3 max-w-2xl">
              <label className="block">
                <span className="text-xs text-gray-500 mb-1 block">rows (JSON array of {`{ content, metadata? }`})</span>
                <textarea
                  rows={10}
                  value={bulkJson}
                  onChange={(e) => setBulkJson(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm font-mono outline-none focus:border-indigo-500 resize-y"
                />
              </label>
              <Btn onClick={handleBulk} loading={bulking} icon="📦">
                bulkInsertDocuments()
              </Btn>
              {bulkResult && <BulkResultCard result={bulkResult} />}
            </div>
          </Section>
        )}

        {/* ════ CSV Import ════ */}
        {tab === "csv" && (
          <Section
            title="importCSV(csvText, options?)"
            description={`Parses a CSV string using the built-in parser and bulk-inserts all rows. The "content" column is embedded; all other columns become metadata.`}
          >
            <CodeBlock>{`const result = await provider.importCSV(csvText, {
  contentColumn: "content",   // default
  concurrency: 5,             // default
});
// → { inserted: 8, failed: 0, errors: [] }`}</CodeBlock>

            <div className="mt-6 space-y-3 max-w-2xl">
              <div className="flex gap-2 items-center">
                <label className="cursor-pointer text-xs px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors">
                  Upload CSV
                  <input ref={fileRef} type="file" accept=".csv" onChange={handleCsvFile} className="hidden" />
                </label>
                <button
                  onClick={() => setCsvText(SAMPLE_CSV)}
                  className="text-xs px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
                >
                  Use sample
                </button>
              </div>
              <textarea
                rows={12}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm font-mono outline-none focus:border-indigo-500 resize-y"
              />
              <Btn onClick={handleCsvImport} loading={csvLoading} disabled={!csvText.trim()} icon="📄">
                importCSV()
              </Btn>
              {csvResult && <BulkResultCard result={csvResult} />}
            </div>
          </Section>
        )}

        {/* ════ Browse ════ */}
        {tab === "browse" && (
          <Section
            title="listDocuments(limit?)"
            description="Returns the most recently inserted documents (no embeddings)."
          >
            <CodeBlock>{`const docs = await provider.listDocuments(20);
// → [{ id, content, metadata, createdAt }, ...]

// Delete a document:
await provider.deleteDocument(id);`}</CodeBlock>

            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  Limit
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={browseLimit}
                    onChange={(e) => setBrowseLimit(Number(e.target.value))}
                    className="w-16 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-sm outline-none focus:border-indigo-500"
                  />
                </label>
                <Btn onClick={handleBrowse} loading={browsing} icon="🔄">
                  listDocuments()
                </Btn>
              </div>

              {docs.length === 0 && !browsing && (
                <p className="text-gray-600 text-sm py-8 text-center">No documents loaded — hit the button above.</p>
              )}

              <div className="space-y-2">
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex gap-3 bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-sm items-start group"
                  >
                    <span className="text-indigo-400 font-mono text-xs pt-0.5 w-8 shrink-0">#{doc.id}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-200 leading-relaxed">{doc.content}</p>
                      {Object.keys(doc.metadata).length > 0 && (
                        <p className="text-gray-600 text-xs font-mono mt-1">
                          {JSON.stringify(doc.metadata)}
                        </p>
                      )}
                      <p className="text-gray-700 text-xs mt-1">
                        {new Date(doc.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                      className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 text-xs px-2 py-1 transition-opacity disabled:opacity-50"
                    >
                      {deletingId === doc.id ? "…" : "delete"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* ════ Search ════ */}
        {tab === "search" && (
          <Section
            title="search(query, topK?, threshold?)"
            description="Embeds the query with OpenAI and finds the most similar documents using cosine distance via HNSW index."
          >
            <CodeBlock>{`const results = await provider.search(
  "where is the Eiffel Tower?",
  5,    // topK
  0.3   // min cosine similarity
);
// → [{ id, content, metadata, createdAt, similarity }, ...]`}</CodeBlock>

            <div className="mt-6 space-y-4 max-w-lg">
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="e.g. where is the Eiffel Tower?"
                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm outline-none focus:border-indigo-500"
                />
                <Btn onClick={handleSearch} loading={searching} disabled={!query.trim()} icon="🔍">
                  search()
                </Btn>
              </div>

              <div className="flex items-center gap-6 text-sm text-gray-400">
                <label className="flex items-center gap-2">
                  topK
                  <input
                    type="number" min={1} max={20}
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                    className="w-14 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-sm outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="flex items-center gap-2 flex-1">
                  threshold
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="flex-1 accent-indigo-500"
                  />
                  <span className="text-indigo-300 font-mono w-8 text-right">{threshold}</span>
                </label>
              </div>

              {searchResults !== null && (
                <div className="space-y-2">
                  {searchResults.length === 0 ? (
                    <p className="text-gray-600 text-sm py-6 text-center">
                      No results above threshold {threshold}.
                    </p>
                  ) : (
                    searchResults.map((r) => (
                      <div
                        key={r.id}
                        className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-sm"
                      >
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <span className="text-indigo-400 font-mono text-xs">#{r.id}</span>
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded ${
                              r.similarity >= 0.8
                                ? "bg-green-900/60 text-green-300"
                                : r.similarity >= 0.5
                                ? "bg-yellow-900/60 text-yellow-300"
                                : "bg-gray-800 text-gray-400"
                            }`}
                          >
                            {(r.similarity * 100).toFixed(1)}%
                          </span>
                        </div>
                        <p className="text-gray-200 leading-relaxed">{r.content}</p>
                        {Object.keys(r.metadata).length > 0 && (
                          <p className="text-gray-600 text-xs font-mono mt-1">
                            {JSON.stringify(r.metadata)}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </Section>
        )}

      </main>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Section({
  title, description, children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold font-mono text-indigo-300 mb-1">{title}</h2>
      <p className="text-gray-400 text-sm mb-5">{description}</p>
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-gray-900 border border-gray-800 rounded-lg px-5 py-4 text-sm font-mono text-gray-300 overflow-x-auto leading-relaxed">
      {children}
    </pre>
  );
}

function Btn({
  children,
  onClick,
  loading,
  disabled,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
    >
      {loading ? (
        <span className="animate-pulse">Running…</span>
      ) : (
        <>
          {icon && <span>{icon}</span>}
          {children}
        </>
      )}
    </button>
  );
}

function Status({ children, ok }: { children: React.ReactNode; ok: boolean }) {
  return (
    <span className={`text-sm font-medium ${ok ? "text-green-400" : "text-red-400"}`}>
      {children}
    </span>
  );
}

function BulkResultCard({ result }: { result: BulkResult }) {
  const allOk = result.failed === 0;
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        allOk
          ? "bg-green-950/30 border-green-900 text-green-300"
          : "bg-yellow-950/30 border-yellow-900 text-yellow-300"
      }`}
    >
      <span className="font-semibold">{result.inserted} inserted</span>
      {result.failed > 0 && (
        <span className="ml-3 text-red-400">{result.failed} failed</span>
      )}
      {result.errors.map((e) => (
        <p key={e.row} className="text-xs text-red-400 mt-1">
          Row {e.row}: {e.reason}
        </p>
      ))}
    </div>
  );
}
