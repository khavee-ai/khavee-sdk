/**
 * OpenAILLMAdapter — implements the vendor-neutral LLMProvider interface
 * (packages/core/src/types/pipeline.ts) by issuing its own fetch() against
 * the OpenAI-compatible Chat Completions backend proxy.
 *
 * This adapter deliberately BYPASSES ChatClient (@khaveeai/providers-openai-stt-tts)
 * for completion — ChatClient has zero tool-calling/signal support today
 * (it only POSTs { messages, model, temperature } and returns { text, usage }),
 * and extending it would touch the untouched openai-stt-tts package. Instead,
 * this adapter reuses ChatClient's exact auth-header + error-message SHAPE
 * (Authorization: Bearer <token>, "Chat proxy error: <status> <body>") in its
 * own independent fetch call.
 *
 * Tool-result round-trip convention (Phase-2-local protocol, resolves
 * RESEARCH Open Question 2 / Pitfall 2): the vendor-neutral LLMProvider
 * interface has no role:"tool" message member by design (CORE-06 — no
 * vendor-specific wire shape is baked into the core types). The orchestrator
 * encodes a tool's result back into history as a `role: "user"` message
 * whose content starts with the marker `[tool_result id=<id> name=<name>]`
 * followed by the JSON-stringified ToolResult. This adapter recognizes that
 * marker when building the outgoing request body and re-emits the message
 * as OpenAI's actual `{ role: "tool", tool_call_id, content }` wire shape;
 * every other message passes through with its role/content unchanged.
 *
 * Assistant/tool_calls round-trip convention (CR-03): the orchestrator
 * encodes the LLM's own tool_calls turn as a `role: "assistant"` message
 * whose content starts with the marker `[assistant_tool_calls]` followed by
 * the JSON-stringified ToolCall[] array (sibling convention to the
 * tool-result marker above, same CORE-06 vendor-neutral-message rule). This
 * adapter re-emits it as OpenAI's `{ role: "assistant", content: null,
 * tool_calls: [...] }` wire shape so the required assistant→tool message
 * ordering holds on round 2+ of a multi-round tool-calling conversation.
 */

import { LLMProvider, LLMCompletionResult, ToolCall, Tool } from "@khaveeai/core";

/** Regex recognizing the Phase-2 tool-result history-message convention. */
const TOOL_RESULT_PATTERN = /^\[tool_result id=(\S+) name=(\S+)\]\s*([\s\S]*)$/;

/** Regex recognizing the (CR-03) assistant/tool_calls history-message convention. */
const ASSISTANT_TOOL_CALLS_PATTERN = /^\[assistant_tool_calls\]\s*([\s\S]*)$/;

/** Constructor config for OpenAILLMAdapter. */
export interface OpenAILLMAdapterConfig {
  /** Full URL of the backend Chat Completions proxy endpoint. */
  endpoint: string;
  /** JWT bearer token for authenticating with the proxy. */
  authToken: string;
  /** Chat completion model name. Default: "gpt-4o-mini". */
  model?: string;
  /** Sampling temperature. */
  temperature?: number;
}

/** A single message in the conversation history, per LLMProvider.complete()'s args. */
type InputMessage = { role: string; content: string };

/** OpenAI wire-format message — either the standard role/content shape, a tool result, or an assistant/tool_calls turn (CR-03). */
type OutgoingMessage =
  | { role: string; content: string }
  | { role: "tool"; tool_call_id: string; content: string }
  | {
      role: "assistant";
      content: null;
      tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    };

/** Shape of the (possibly { data }-wrapped) Chat Completions proxy response. */
type ToolCallWire = { id: string; function: { name: string; arguments: string } };
type ProxyResponseFlat = {
  text?: string;
  tool_calls?: ToolCallWire[];
  data?: undefined;
};
type ProxyResponseWrapped = {
  data: { text?: string; tool_calls?: ToolCallWire[] };
};
type ProxyResponse = ProxyResponseFlat | ProxyResponseWrapped;

/**
 * Adapts an OpenAI-compatible Chat Completions backend proxy to the
 * LLMProvider interface, with tool-calling and best-effort cancellation.
 */
export class OpenAILLMAdapter implements LLMProvider {
  readonly name = "openai-llm";
  readonly supportsToolCalling = true;
  readonly supportsStreaming = false;

  private readonly endpoint: string;
  private readonly authToken: string;
  private readonly model: string;
  private readonly temperature?: number;

  constructor(config: OpenAILLMAdapterConfig) {
    this.endpoint = config.endpoint;
    this.authToken = config.authToken;
    this.model = config.model ?? "gpt-4o-mini";
    this.temperature = config.temperature;
  }

  async complete(args: {
    messages: InputMessage[];
    tools?: Tool[];
    signal?: AbortSignal;
  }): Promise<LLMCompletionResult> {
    const { messages, tools, signal } = args;

    const body: Record<string, unknown> = {
      messages: messages.map(mapMessage),
      model: this.model,
      temperature: this.temperature,
      ...(tools && tools.length > 0 ? { tools: tools.map(mapTool) } : {}),
    };

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.authToken}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const responseBody = await res.text();
      throw new Error(`Chat proxy error: ${res.status} ${responseBody}`);
    }

    const json = (await res.json()) as ProxyResponse;
    const payload: { text?: string; tool_calls?: ToolCallWire[] } =
      json.data !== undefined ? json.data : json;

    const toolCalls: ToolCall[] = (payload.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    }));

    return { text: payload.text, toolCalls };
  }
}

/** Maps a Tool's plain-object parameters into OpenAI's function-calling wire shape. */
function mapTool(tool: Tool): {
  type: "function";
  function: { name: string; description: string; parameters: Tool["parameters"] };
} {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * Maps a single history message into OpenAI's wire shape, recognizing the
 * Phase-2 tool-result convention (re-emitting it as { role: "tool", ... })
 * and the (CR-03) assistant/tool_calls convention (re-emitting it as
 * { role: "assistant", content: null, tool_calls: [...] }).
 *
 * (WR-06) Both marker branches are gated on the message's role before the
 * regex/JSON.parse runs: the tool-result branch only fires for role:"user"
 * messages, and the assistant/tool_calls branch only fires for
 * role:"assistant" messages. Without this gate, ordinary user text (or an
 * STT transcript) that happens to start with "[assistant_tool_calls]" would
 * be misrouted into JSON.parse and throw a SyntaxError, aborting an
 * otherwise-legitimate turn. The assistant branch additionally wraps its
 * JSON.parse in try/catch — a malformed marker payload on a genuine
 * assistant-role message falls through to plain passthrough rather than
 * crashing the turn.
 */
function mapMessage(message: InputMessage): OutgoingMessage {
  if (message.role === "user") {
    const toolResultMatch = TOOL_RESULT_PATTERN.exec(message.content);
    if (toolResultMatch) {
      const [, id, , content] = toolResultMatch;
      return { role: "tool", tool_call_id: id, content };
    }
  }

  if (message.role === "assistant") {
    const assistantToolCallsMatch = ASSISTANT_TOOL_CALLS_PATTERN.exec(message.content);
    if (assistantToolCallsMatch) {
      try {
        const parsed: Array<{ id: string; name: string; args: Record<string, any> }> = JSON.parse(
          assistantToolCallsMatch[1],
        );
        return {
          role: "assistant",
          content: null,
          tool_calls: parsed.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      } catch {
        // Malformed marker payload — fall through to passthrough rather
        // than crashing the turn. (WR-06)
      }
    }
  }

  return { role: message.role, content: message.content };
}
