import { describe, it, expect, vi } from "vitest";
import { OpenAIRealtimeProvider } from "../OpenAIRealtimeProvider";

// ── 08-05: regression test for the temperature-free proxy sessionConfig ────
// Root cause (see .planning/debug/session-unavailable-error.md): OpenAI's real
// /v1/realtime/client_secrets endpoint rejects a session-level `temperature`
// field with `400 Unknown parameter: 'session.temperature'`. This test
// exercises the extracted builder method directly — connect() itself requires
// stubbing getUserMedia/RTCPeerConnection/AudioContext, which would be brittle
// and not a deterministic gate for this specific regression.

describe("OpenAIRealtimeProvider proxy sessionConfig (buildProxySessionConfig)", () => {
  function buildConfig() {
    const provider = new OpenAIRealtimeProvider({
      useProxy: true,
      proxyEndpoint: "https://example.test/session",
      temperature: 0.5,
      voice: "marin",
      model: "gpt-realtime-1.5",
    });

    return (provider as any).buildProxySessionConfig();
  }

  it("does not include a temperature key (own property absent)", () => {
    const sessionConfig = buildConfig();

    expect(
      Object.prototype.hasOwnProperty.call(sessionConfig, "temperature"),
    ).toBe(false);
  });

  it("preserves the other fields the bundle relies on", () => {
    const sessionConfig = buildConfig();

    expect(sessionConfig.type).toBe("realtime");
    expect(sessionConfig.model).toBe("gpt-realtime-1.5");
    expect(sessionConfig.instructions).toBeTruthy();
    expect(sessionConfig.output_modalities).toEqual(["audio"]);
    expect(sessionConfig.audio.output.voice).toBe("marin");
  });

  it("does not serialize a temperature substring in the JSON body", () => {
    const sessionConfig = buildConfig();

    expect(JSON.stringify(sessionConfig)).not.toContain("temperature");
  });

  it("defaults model to gpt-realtime-1.5 when unset", () => {
    const provider = new OpenAIRealtimeProvider({
      useProxy: true,
      proxyEndpoint: "https://example.test/session",
    });
    // Constructor default for model is "gpt-4o-realtime-preview"; explicitly
    // unset model on the config object to exercise the builder's own
    // fallback ("gpt-realtime-1.5") used when building the proxy sessionConfig.
    (provider as any).config.model = undefined;

    const sessionConfig = (provider as any).buildProxySessionConfig();
    expect(sessionConfig.model).toBe("gpt-realtime-1.5");
  });

  it("does not warn when the caller never set temperature (constructor default only)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new OpenAIRealtimeProvider({
      useProxy: true,
      proxyEndpoint: "https://example.test/session",
    });

    (provider as any).buildProxySessionConfig();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns once when the caller explicitly sets temperature, since it is silently dropped", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new OpenAIRealtimeProvider({
      useProxy: true,
      proxyEndpoint: "https://example.test/session",
      temperature: 0.2,
    });

    (provider as any).buildProxySessionConfig();
    (provider as any).buildProxySessionConfig();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("temperature");
    warnSpy.mockRestore();
  });
});
