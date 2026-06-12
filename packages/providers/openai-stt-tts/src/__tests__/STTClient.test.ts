import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STTClient } from "../STTClient";

// ── SDK-04: STTClient.transcribe posts multipart and returns transcript ────────

describe("SDK-04: STTClient.transcribe posts multipart and returns transcript", () => {
  const client = new STTClient();
  const endpoint = "https://api.example.com/api/v1/projects/1/chat/stt";
  const authToken = "test-jwt-token";
  const wavBlob = new Blob(["x"], { type: "audio/wav" });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to the endpoint with Authorization Bearer header and FormData body with 'utterance.wav' filename, returns transcript on 200", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ transcript: "hello world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await client.transcribe(wavBlob, endpoint, authToken);

    expect(result).toBe("hello world");

    // Verify method and URL
    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(endpoint);
    expect(calledInit.method).toBe("POST");

    // Verify Authorization Bearer header
    const headers = calledInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${authToken}`);

    // Verify Content-Type was NOT manually set (browser sets multipart boundary)
    expect(headers["Content-Type"]).toBeUndefined();

    // Verify FormData body contains 'audio' entry with filename 'utterance.wav'
    const body = calledInit.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const audioEntry = body.get("audio");
    expect(audioEntry).toBeInstanceOf(File);
    expect((audioEntry as File).name).toBe("utterance.wav");
  });

  it("throws an Error with the status code when the proxy responds non-2xx", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response("Bad Request", {
        status: 400,
        statusText: "Bad Request",
      }),
    );

    await expect(
      client.transcribe(wavBlob, endpoint, authToken),
    ).rejects.toThrow("400");
  });

  it("appends language field to FormData when language is provided", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ transcript: "bonjour" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await client.transcribe(wavBlob, endpoint, authToken, "fr");

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = calledInit.body as FormData;
    expect(body.get("language")).toBe("fr");
  });
});
