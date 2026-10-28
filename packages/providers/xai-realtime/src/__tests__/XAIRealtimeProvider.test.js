import { describe, expect, it, vi } from "vitest";
import { XAIRealtimeProvider } from "../XAIRealtimeProvider";
import { MicCaptureEngine } from "../MicCaptureEngine";

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

  it("sends paced silence when mic is disabled during speech and still accepts the commit", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    try {
      const provider = new XAIRealtimeProvider({ sampleRate: 24000 });
      const send = vi.fn();
      provider.ws = { readyState: 1, send };
      provider.isConnected = true;
      provider.micEnabled = true;
      provider.userSpeechActive = true;
      provider.chatStatus = "listening";
      provider.micEngine = { disable: vi.fn(), isEnabled: false };

      provider.disableMicrophone();
      expect(provider.chatStatus).toBe("listening");
      expect(provider.userSpeechActive).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(send).toHaveBeenCalledTimes(3);
      expect(JSON.parse(send.mock.calls[0][0]).type).toBe("input_audio_buffer.append");

      await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: "turn" }));
      expect(provider.chatStatus).toBe("thinking");
      await vi.advanceTimersByTimeAsync(2000);
      expect(send).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("ignores speech detection during assistant audio and holds speaking through audio gaps", async () => {
    const provider = new XAIRealtimeProvider({});
    provider.isConnected = true;
    provider.micEnabled = true;
    provider.chatStatus = "speaking";
    provider.assistantAudioStreaming = true;
    provider.playbackEngine = { isPlaying: false };

    await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
    expect(provider.chatStatus).toBe("speaking");
    expect(provider.conversation).toHaveLength(0);

    await provider.handleServerEvent(serverEvent("response.output_audio.done", { item_id: "reply" }));
    expect(provider.chatStatus).toBe("ready");
  });

  it("keeps speaking through playback gaps and suppresses captured speaker audio", async () => {
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      send = vi.fn();
      addEventListener = vi.fn();
      close = vi.fn();
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(MicCaptureEngine.prototype, "initialize").mockResolvedValue();
    try {
      const provider = new XAIRealtimeProvider({ apiKey: "test" });
      await provider.connect({ skipGreeting: true });
      provider.micEnabled = true;
      const send = provider.ws.send;
      provider.assistantAudioStreaming = true;
      provider.playbackEngine.onPlaybackStart();
      expect(provider.chatStatus).toBe("speaking");

      provider.micEngine.onAudioFrame("captured-speaker-audio");
      provider.playbackEngine.onPlaybackEnd();
      expect(provider.chatStatus).toBe("speaking");
      expect(send.mock.calls.some(([payload]) => JSON.parse(payload).type === "input_audio_buffer.append")).toBe(false);

      provider.assistantAudioStreaming = false;
      provider.playbackEngine.onPlaybackEnd();
      expect(provider.chatStatus).toBe("ready");
      await provider.disconnect();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
