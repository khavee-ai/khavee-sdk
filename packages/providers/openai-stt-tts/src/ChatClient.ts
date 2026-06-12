/**
 * ChatClient — Chat Completions proxy client (internal, not exported from index.ts)
 *
 * Sends a conversation messages array to the backend Chat Completions proxy and
 * returns normalized { text, usage }. All calls go through the backend proxy —
 * the OpenAI API key never reaches the browser.
 *
 * Do NOT import from "openai/helpers/audio" or use playAudio (Node-only).
 */

/** A single message in the chat conversation history. */
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Token usage returned by the Chat Completions proxy. */
export type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
};

/** Normalized result from a Chat Completions proxy call. */
export type ChatResult = {
  text: string;
  usage?: ChatUsage;
};

/**
 * Shape of the top-level proxy response (flat or wrapped in `data`).
 * Both shapes are normalized by `complete()`.
 */
type ProxyResponseFlat = {
  text?: string;
  usage?: ChatUsage;
  data?: undefined;
};

type ProxyResponseWrapped = {
  data: {
    text?: string;
    usage?: ChatUsage;
  };
};

type ProxyResponse = ProxyResponseFlat | ProxyResponseWrapped;

/** Arguments accepted by `ChatClient.complete()`. */
type CompleteArgs = {
  messages: ChatMessage[];
  endpoint: string;
  authToken: string;
  model?: string;
  temperature?: number;
};

/**
 * Sends a conversation messages array to the Chat Completions backend proxy
 * and returns the normalized { text, usage } result.
 *
 * Internal class — NOT re-exported from index.ts.
 */
export class ChatClient {
  async complete(args: CompleteArgs): Promise<ChatResult> {
    const { messages, endpoint, authToken, model, temperature } = args;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ messages, model, temperature }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Chat proxy error: ${res.status} ${body}`);
    }

    const json = (await res.json()) as ProxyResponse;

    // Normalize: support both flat { text, usage } and wrapped { data: { text, usage } }
    const payload: { text?: string; usage?: ChatUsage } =
      json.data !== undefined ? json.data : json;

    const { text, usage } = payload;

    if (typeof text !== "string") {
      throw new Error("Chat proxy response missing text");
    }

    return { text, usage };
  }
}
