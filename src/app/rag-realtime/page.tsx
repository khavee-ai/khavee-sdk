"use client";

import { useState } from "react";
import { OpenAIRealtimeProvider } from "@khaveeai/providers-openai-realtime";
import { KhaveeProvider, useRealtime } from "@khaveeai/react";
import { searchKnowledgeBase } from "./actions";

// ── Provider (created once, tool registered at init) ─────────────────────────
const provider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: "/api/negotiate",
  voice: "echo",
  instructions:
    "ตอบคำถามแบบใช้ a lot of emoji อย่างเดียวเท่านั้น"
    // "When the user asks a question, use the search_knowledge_base tool to find relevant information, " +
    // "then answer based on what you find. Be concise and conversational.",
//   tools: [
//     {
//       name: "search_knowledge_base",
//       description: "Search the knowledge base for relevant information to answer the user's question.",
//       parameters: {
//         query: {
//           type: "string",
//           required: true,
//           description: "The search query to find relevant documents.",
//         },
//       },
//       execute: async ({ query }: { query: string }) => {
//         const context = await searchKnowledgeBase(query);
//         console.log(context)
//         return { success: true, message: context };
//       },
//     },
//   ],
});

// ── Chat UI ───────────────────────────────────────────────────────────────────
function RAGChat() {
  const { connect, disconnect, sendMessage, conversation, isConnected, chatStatus } = useRealtime();
  const [input, setInput] = useState("");
  const [toolLog, setToolLog] = useState<string[]>([]);

  // Track tool calls
  provider.onToolCall = (_name, args, _result) => {
    setToolLog((prev) => [`🔍 Searched: "${args.query}"`, ...prev].slice(0, 5));
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input.trim());
      setInput("");
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Realtime + RAG Demo</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            OpenAI Realtime · pgvector knowledge base · search_knowledge_base tool
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <span className={`inline-flex items-center gap-1.5 text-xs ${
            isConnected ? "text-green-400" : "text-gray-600"
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-green-400 animate-pulse" : "bg-gray-700"
            }`} />
            {chatStatus === "thinking" ? "thinking…" : isConnected ? "connected" : "disconnected"}
          </span>
          {/* Connect / Disconnect */}
          {isConnected ? (
            <button
              onClick={disconnect}
              className="px-3 py-1.5 text-sm bg-red-600/80 hover:bg-red-500 rounded-lg transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
            >
              Connect
            </button>
          )}
        </div>
      </header>

      {/* Tool log */}
      {toolLog.length > 0 && (
        <div className="px-6 py-2 bg-yellow-950/30 border-b border-yellow-900/40 flex flex-wrap gap-2">
          {toolLog.map((entry, i) => (
            <span key={i} className="text-xs text-yellow-300/80 font-mono">{entry}</span>
          ))}
        </div>
      )}

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-3 max-w-2xl w-full mx-auto">
        {conversation.length === 0 ? (
          <div className="text-center text-gray-600 mt-20 text-sm">
            <p className="text-2xl mb-3">🎙️</p>
            <p>Connect and ask anything — the AI will search your knowledge base automatically.</p>
          </div>
        ) : (
          conversation.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm"
                    : "bg-gray-800 text-gray-100 rounded-bl-sm"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 px-6 py-4 max-w-2xl w-full mx-auto">
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!isConnected}
            placeholder={isConnected ? "Type a message or speak…" : "Connect to start chatting"}
            className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-xl text-sm outline-none focus:border-indigo-500 disabled:opacity-40 placeholder:text-gray-600"
          />
          <button
            type="submit"
            disabled={!isConnected || !input.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl text-sm transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function RAGRealtimePage() {
  return (
    <KhaveeProvider config={{ realtime: provider }}>
      <RAGChat />
    </KhaveeProvider>
  );
}
