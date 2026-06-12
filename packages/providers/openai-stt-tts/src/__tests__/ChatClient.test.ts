import { describe, it, expect, vi, afterEach } from "vitest";
import { ChatClient } from "../ChatClient";

const ENDPOINT = "https://api.example.com/api/v1/chat/completions";
const AUTH_TOKEN = "test-jwt-token";
const MESSAGES = [
  { role: "system" as const, content: "You are a helpful assistant." },
  { role: "user" as const, content: "Hello!" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

// ── SDK-05: ChatClient.complete() unit tests ────────────────────────────────

describe("ChatClient.complete", () => {
  it("posts to chatProxyEndpoint with correct headers and returns { text, usage } from top-level shape", async () => {
    const mockResponse = {
      text: "hi",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = new ChatClient();
    const result = await client.complete({
      messages: MESSAGES,
      endpoint: ENDPOINT,
      authToken: AUTH_TOKEN,
      model: "gpt-4o-mini",
      temperature: 0.7,
    });

    // Verify result shape
    expect(result.text).toBe("hi");
    expect(result.usage).toEqual(mockResponse.usage);

    // Verify request details
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${AUTH_TOKEN}`
    );

    // Verify request body contains the messages array
    const body = JSON.parse(init.body as string) as {
      messages: typeof MESSAGES;
    };
    expect(body.messages).toEqual(MESSAGES);
  });

  it("normalizes { data: { text, usage } } proxy response shape to { text, usage }", async () => {
    const innerData = {
      text: "hello there",
      usage: {
        prompt_tokens: 20,
        completion_tokens: 8,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: innerData }),
    }));

    const client = new ChatClient();
    const result = await client.complete({
      messages: MESSAGES,
      endpoint: ENDPOINT,
      authToken: AUTH_TOKEN,
    });

    expect(result.text).toBe("hello there");
    expect(result.usage).toEqual(innerData.usage);
  });

  it("throws an Error containing the status code when response is non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }));

    const client = new ChatClient();
    await expect(
      client.complete({
        messages: MESSAGES,
        endpoint: ENDPOINT,
        authToken: "bad-token",
      })
    ).rejects.toThrow("401");
  });
});
