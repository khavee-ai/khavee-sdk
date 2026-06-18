import { describe, it, expect, vi } from "vitest";
import { OpenAISTTAdapter } from "../adapters/OpenAISTTAdapter";

// ── ORCH-02: OpenAISTTAdapter wraps STTClient.transcribe into STTResult ────

describe("ORCH-02: OpenAISTTAdapter wraps STTClient.transcribe into STTResult", () => {
  const endpoint = "https://api.example.com/api/v1/projects/1/chat/stt";
  const authToken = "test-jwt-token";
  const wavBlob = new Blob(["x"], { type: "audio/wav" });

  it("wraps STTClient.transcribe's string return as { text } with rejected omitted", async () => {
    const fakeSttClient = {
      transcribe: vi.fn().mockResolvedValue("hello world"),
    };
    const adapter = new OpenAISTTAdapter(
      { endpoint, authToken },
      fakeSttClient as any,
    );

    const result = await adapter.transcribe(wavBlob);

    expect(result).toEqual({ text: "hello world" });
    expect(result.rejected).toBeUndefined();
  });

  it("exposes supportsStreaming === false and supportsRejection === false", () => {
    const fakeSttClient = { transcribe: vi.fn() };
    const adapter = new OpenAISTTAdapter(
      { endpoint, authToken },
      fakeSttClient as any,
    );

    expect(adapter.supportsStreaming).toBe(false);
    expect(adapter.supportsRejection).toBe(false);
  });

  it("declares a Provider.name", () => {
    const fakeSttClient = { transcribe: vi.fn() };
    const adapter = new OpenAISTTAdapter(
      { endpoint, authToken },
      fakeSttClient as any,
    );

    expect(adapter.name).toBe("openai-stt");
  });

  it("passes opts.language through to STTClient.transcribe's language arg", async () => {
    const fakeSttClient = {
      transcribe: vi.fn().mockResolvedValue("bonjour"),
    };
    const adapter = new OpenAISTTAdapter(
      { endpoint, authToken },
      fakeSttClient as any,
    );

    await adapter.transcribe(wavBlob, { language: "fr" });

    expect(fakeSttClient.transcribe).toHaveBeenCalledWith(
      wavBlob,
      endpoint,
      authToken,
      "fr",
    );
  });

  it("propagates STTClient's thrown 'STT proxy error: <status>' error unchanged", async () => {
    const fakeSttClient = {
      transcribe: vi.fn().mockRejectedValue(new Error("STT proxy error: 400 Bad Request")),
    };
    const adapter = new OpenAISTTAdapter(
      { endpoint, authToken },
      fakeSttClient as any,
    );

    await expect(adapter.transcribe(wavBlob)).rejects.toThrow("400");
  });
});
