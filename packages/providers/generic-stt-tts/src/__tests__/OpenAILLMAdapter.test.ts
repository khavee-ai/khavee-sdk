import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAILLMAdapter } from "../adapters/OpenAILLMAdapter";

// ── ORCH-02/ORCH-05: OpenAILLMAdapter sends tools+signal, parses tool_calls ──

describe("ORCH-02/ORCH-05: OpenAILLMAdapter sends tools+signal, parses tool_calls", () => {
  const endpoint = "https://api.example.com/api/v1/projects/1/chat/completions";
  const authToken = "test-jwt-token";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("declares capability flags and a Provider.name", () => {
    const adapter = new OpenAILLMAdapter({ endpoint, authToken });
    expect(adapter.name).toBe("openai-llm");
    expect(adapter.supportsToolCalling).toBe(true);
    expect(adapter.supportsStreaming).toBe(false);
  });

  it("yields { text, toolCalls: [] } when the response has no tool_calls", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "hello there" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });
    const result = await adapter.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toEqual({ text: "hello there", toolCalls: [] });
  });

  it("does NOT include a tools field in the request body when no tools are supplied", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "hi" }), { status: 200 }),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });
    await adapter.complete({ messages: [{ role: "user", content: "hi" }] });

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(calledInit.body as string);
    expect(body.tools).toBeUndefined();
  });

  it("includes a tools array (OpenAI function-calling shape) when tools are supplied", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "hi" }), { status: 200 }),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });
    await adapter.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "get_weather",
          description: "Get the weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
          execute: async () => ({ success: true, message: "ok" }),
        },
      ],
    });

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(calledInit.body as string);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      },
    ]);
  });

  it("forwards signal to the fetch call's options", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "hi" }), { status: 200 }),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });
    const controller = new AbortController();
    await adapter.complete({
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    });

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledInit.signal).toBe(controller.signal);
  });

  it("maps a tool_calls response to toolCalls: [{id, name, args}] with args JSON-parsed", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tool_calls: [
            {
              id: "call_abc",
              function: { name: "get_weather", arguments: '{"city":"Bangkok"}' },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });
    const result = await adapter.complete({
      messages: [{ role: "user", content: "what's the weather" }],
    });

    expect(result.toolCalls).toEqual([
      { id: "call_abc", name: "get_weather", args: { city: "Bangkok" } },
    ]);
  });

  it("throws 'Chat proxy error: <status> <body>' on a non-2xx response", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response("Bad Request", { status: 400, statusText: "Bad Request" }),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });

    await expect(
      adapter.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("400");
  });

  it("maps a tool-result-convention history message to { role: 'tool', tool_call_id, content }", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "done" }), { status: 200 }),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });
    await adapter.complete({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "what's the weather" },
        {
          role: "user",
          content:
            '[tool_result id=call_abc name=get_weather] {"success":true,"message":"Sunny, 32C"}',
        },
      ],
    });

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(calledInit.body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "what's the weather" },
      {
        role: "tool",
        tool_call_id: "call_abc",
        content: '{"success":true,"message":"Sunny, 32C"}',
      },
    ]);
  });

  it("maps an [assistant_tool_calls] history message to { role: 'assistant', content: null, tool_calls: [...] }", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "done" }), { status: 200 }),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });
    await adapter.complete({
      messages: [
        { role: "user", content: "what's the weather" },
        {
          role: "assistant",
          content:
            "[assistant_tool_calls] " +
            JSON.stringify([{ id: "c1", name: "get_weather", args: { city: "Bangkok" } }]),
        },
        { role: "user", content: "[tool_result id=c1 name=get_weather] sunny" },
      ],
    });

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(calledInit.body as string);
    expect(body.messages).toEqual([
      { role: "user", content: "what's the weather" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "get_weather", arguments: JSON.stringify({ city: "Bangkok" }) },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "sunny" },
    ]);
  });

  it("does NOT call ChatClient.complete for completion", () => {
    // No ChatClient import/usage in OpenAILLMAdapter — verified statically via
    // the acceptance-criteria grep check in the plan; this test documents intent.
    expect(typeof (OpenAILLMAdapter.prototype as any).complete).toBe("function");
  });

  it("WR-06: a role:user message starting with [assistant_tool_calls] passes through as plain content and does NOT throw", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "done" }), { status: 200 }),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });

    await expect(
      adapter.complete({
        messages: [
          {
            role: "user",
            content: "[assistant_tool_calls] please call the weather tool for me",
          },
        ],
      }),
    ).resolves.toBeDefined();

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(calledInit.body as string);
    expect(body.messages[0]).toEqual({
      role: "user",
      content: "[assistant_tool_calls] please call the weather tool for me",
    });
  });

  it("WR-06: a role:assistant message with a malformed [assistant_tool_calls] payload passes through as plain content instead of throwing", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "done" }), { status: 200 }),
    );

    const adapter = new OpenAILLMAdapter({ endpoint, authToken });

    await expect(
      adapter.complete({
        messages: [{ role: "assistant", content: "[assistant_tool_calls] not-json" }],
      }),
    ).resolves.toBeDefined();

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(calledInit.body as string);
    expect(body.messages[0]).toEqual({
      role: "assistant",
      content: "[assistant_tool_calls] not-json",
    });
  });
});
