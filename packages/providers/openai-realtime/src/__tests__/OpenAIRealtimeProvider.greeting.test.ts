import { describe, it, expect, vi } from "vitest";
import { DEFAULT_COLD_OPEN_PROMPT } from "@khaveeai/core";
import { OpenAIRealtimeProvider } from "../OpenAIRealtimeProvider";

// Exercises configureSession() — the point where the cold-open item and the
// greeting response.create are pushed over the data channel — directly, with
// a stubbed data channel. connect() itself needs getUserMedia /
// RTCPeerConnection / AudioContext and is not a deterministic unit target.

function configureWithStub(config: Record<string, unknown>) {
  const provider = new OpenAIRealtimeProvider({
    useProxy: true,
    proxyEndpoint: "https://example.test/session",
    ...config,
  });
  const send = vi.fn();
  (provider as any).dataChannel = { send, readyState: "open" };
  (provider as any).configureSession();
  return { provider, send };
}

describe("OpenAIRealtimeProvider greeting cold open (configureSession)", () => {
  it("pins the configured greeting in a system cold-open item, then requests a response", () => {
    const { send } = configureWithStub({ greeting: "Hi there! Welcome to Khavee." });

    expect(send).toHaveBeenCalledTimes(2);
    const first = JSON.parse(send.mock.calls[0][0]);
    expect(first.type).toBe("conversation.item.create");
    expect(first.item.role).toBe("system");
    expect(first.item.content[0].type).toBe("input_text");
    expect(first.item.content[0].text).toContain('"Hi there! Welcome to Khavee."');
    expect(first.item.content[0].text).toContain("word for word");

    const second = JSON.parse(send.mock.calls[1][0]);
    expect(second).toEqual({ type: "response.create" });
  });

  it("falls back to the improvise-per-instructions cold open when no greeting is set", () => {
    const { send } = configureWithStub({});

    const first = JSON.parse(send.mock.calls[0][0]);
    expect(first.item.role).toBe("system");
    expect(first.item.content[0].text).toBe(DEFAULT_COLD_OPEN_PROMPT);
    expect(JSON.parse(send.mock.calls[1][0]).type).toBe("response.create");
  });

  it("treats a blank greeting as unset", () => {
    const { send } = configureWithStub({ greeting: "   " });

    const first = JSON.parse(send.mock.calls[0][0]);
    expect(first.item.content[0].text).toBe(DEFAULT_COLD_OPEN_PROMPT);
  });

  it("sends nothing and marks the session ready on a skipGreeting reconnect, even with a greeting", () => {
    const provider = new OpenAIRealtimeProvider({
      useProxy: true,
      proxyEndpoint: "https://example.test/session",
      greeting: "Hi there!",
    });
    const send = vi.fn();
    (provider as any).dataChannel = { send, readyState: "open" };
    (provider as any).skipGreeting = true;

    (provider as any).configureSession();

    expect(send).not.toHaveBeenCalled();
    expect(provider.chatStatus).toBe("ready");
  });
});
