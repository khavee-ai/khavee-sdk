import { describe, expect, it, vi } from "vitest";
import { XAIRealtimeProvider } from "../XAIRealtimeProvider";

function serverEvent(type, fields = {}) {
  return { data: JSON.stringify({ type, ...fields }) };
}

describe("XAIRealtimeProvider state guards", () => {
  it("ignores unmatched commits and duplicate speech starts", async () => {
    const provider = new XAIRealtimeProvider({});
    provider.isConnected = true;
    provider.chatStatus = "ready";
    provider.micEnabled = true;

    await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: "stale" }));
    expect(provider.chatStatus).toBe("ready");

    await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
    await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
    expect(provider.chatStatus).toBe("listening");
    expect(provider.conversation).toHaveLength(1);

    await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: "current" }));
    expect(provider.chatStatus).toBe("thinking");
    await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: "duplicate" }));
    expect(provider.chatStatus).toBe("thinking");
  });

  it("does not let an earlier response overwrite active listening", async () => {
    const provider = new XAIRealtimeProvider({});
    provider.isConnected = true;
    provider.chatStatus = "thinking";
    provider.micEnabled = true;

    await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
    await provider.handleServerEvent(serverEvent("response.created", { response: { id: "old" } }));
    await provider.handleServerEvent(serverEvent("response.done", { response: { id: "old" } }));
    expect(provider.chatStatus).toBe("listening");
  });

  it("recovers from speech_stopped without a commit", async () => {
    vi.useFakeTimers();
    try {
      const provider = new XAIRealtimeProvider({});
      provider.isConnected = true;
      provider.micEnabled = true;
      provider.chatStatus = "ready";

      await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
      await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_stopped"));
      expect(provider.chatStatus).toBe("listening");

      await vi.advanceTimersByTimeAsync(5000);
      expect(provider.chatStatus).toBe("ready");
      expect(provider.conversation).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns actual mic state when capture fails", async () => {
    const provider = new XAIRealtimeProvider({});
    const onError = vi.fn();
    provider.onError = onError;
    provider.isConnected = true;
    provider.micEngine = {
      enable: vi.fn().mockRejectedValue(new Error("Permission denied")),
      destroy: vi.fn(),
      isEnabled: false,
    };

    await expect(provider.toggleMicrophone()).resolves.toBe(false);
    expect(provider.isMicrophoneEnabled()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Microphone unavailable: Permission denied" }));
  });

  it("does not claim mic enabled when capture engine is absent", async () => {
    const provider = new XAIRealtimeProvider({});
    provider.isConnected = true;
    provider.onError = vi.fn();

    await expect(provider.toggleMicrophone()).resolves.toBe(false);
    expect(provider.isMicrophoneEnabled()).toBe(false);
    expect(provider.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Microphone unavailable: capture is not initialized" }));
  });
});
