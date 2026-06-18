import { describe, it, expect, vi } from "vitest";
import { OpenAITTSAdapter } from "../adapters/OpenAITTSAdapter";

// ── ORCH-02/ORCH-03: OpenAITTSAdapter bridges external signal to TTSPlayer.cancel() ──

describe("ORCH-02/ORCH-03: OpenAITTSAdapter bridges external signal to TTSPlayer.cancel()", () => {
  const endpoint = "https://api.example.com/api/v1/projects/1/chat/tts";
  const authToken = "test-jwt-token";

  function makeFakePlayer() {
    return {
      speak: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
    };
  }

  function makeFakeAudioContext() {
    return {} as AudioContext;
  }

  it("forwards positional args/config correctly to TTSPlayer.speak", async () => {
    const fakePlayer = makeFakePlayer();
    const adapter = new OpenAITTSAdapter(
      { endpoint, authToken, voice: "alloy", speed: 1.0 },
      fakePlayer as any,
    );
    const audioContext = makeFakeAudioContext();
    const onAudioData = vi.fn();

    await adapter.speak("hello world", { audioContext, onAudioData });

    expect(fakePlayer.speak).toHaveBeenCalledOnce();
    const [text, config, ctx, dataCallback] = fakePlayer.speak.mock.calls[0];
    expect(text).toBe("hello world");
    expect(config).toMatchObject({
      endpoint,
      authToken,
      voice: "alloy",
      speed: 1.0,
    });
    expect(ctx).toBe(audioContext);
    expect(typeof dataCallback).toBe("function");
  });

  it("calls the player's cancel when the signal fires abort", async () => {
    const fakePlayer = makeFakePlayer();
    // Make speak() hang so we can fire abort mid-flight.
    let resolveSpeak: () => void = () => {};
    fakePlayer.speak = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveSpeak = resolve; }),
    );
    const adapter = new OpenAITTSAdapter(
      { endpoint, authToken },
      fakePlayer as any,
    );
    const controller = new AbortController();

    const speakPromise = adapter.speak("hi", {
      audioContext: makeFakeAudioContext(),
      signal: controller.signal,
    });

    controller.abort();
    expect(fakePlayer.cancel).toHaveBeenCalledOnce();

    resolveSpeak();
    await speakPromise;
  });

  it("does not start playback when the signal is already aborted", async () => {
    const fakePlayer = makeFakePlayer();
    const adapter = new OpenAITTSAdapter(
      { endpoint, authToken },
      fakePlayer as any,
    );
    const controller = new AbortController();
    controller.abort();

    await adapter.speak("hi", {
      audioContext: makeFakeAudioContext(),
      signal: controller.signal,
    });

    expect(fakePlayer.speak).not.toHaveBeenCalled();
  });

  it("supportsStreaming === false", () => {
    const fakePlayer = makeFakePlayer();
    const adapter = new OpenAITTSAdapter(
      { endpoint, authToken },
      fakePlayer as any,
    );
    expect(adapter.supportsStreaming).toBe(false);
  });
});
