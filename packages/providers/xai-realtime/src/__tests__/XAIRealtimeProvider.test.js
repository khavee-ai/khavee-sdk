import { describe, expect, it, vi } from "vitest";
import { XAIRealtimeProvider, isStageDirectionOnly, mayBeStageDirection } from "../XAIRealtimeProvider";
import { MicCaptureEngine } from "../MicCaptureEngine";

function serverEvent(type, fields = {}) {
  return { data: JSON.stringify({ type, ...fields }) };
}

describe("XAIRealtimeProvider state guards", () => {
  it("ends a terminal tool turn without requesting another response", async () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    try {
      const provider = new XAIRealtimeProvider({});
      provider.registerFunction({
        name: "wait_for_user",
        description: "Wait for user",
        parameters: {},
        execute: async () => ({ success: true, message: "", continueResponse: false }),
      });
      const send = vi.fn();
      provider.ws = { readyState: 1, send };
      provider.isConnected = true;
      provider.hasHeardFirstGreeting = true; // mid-session: greeting already played

      await provider.executeToolCall("call-1", "wait_for_user", "{}");
      const types = send.mock.calls.map(([payload]) => JSON.parse(payload).type);
      expect(types).toEqual(["conversation.item.create"]);
      expect(provider.chatStatus).toBe("ready");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores unmatched commits and duplicate speech starts", async () => {
    const provider = new XAIRealtimeProvider({});
    provider.isConnected = true;
    provider.hasHeardFirstGreeting = true; // mid-session: greeting already played
    provider.chatStatus = "ready";
    provider.micEnabled = true;

    await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: "stale" }));
    expect(provider.chatStatus).toBe("ready");

    await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
    await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
    expect(provider.chatStatus).toBe("listening");
    expect(provider.conversation).toHaveLength(1);

    await provider.handleServerEvent(
      serverEvent("conversation.item.input_audio_transcription.updated", { transcript: "hello" }),
    );
    await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: "current" }));
    expect(provider.chatStatus).toBe("thinking");
    await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: "duplicate" }));
    expect(provider.chatStatus).toBe("thinking");
  });

  it("does not let an earlier response overwrite active listening", async () => {
    const provider = new XAIRealtimeProvider({});
    provider.isConnected = true;
    provider.hasHeardFirstGreeting = true; // mid-session: greeting already played
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
      provider.hasHeardFirstGreeting = true; // mid-session: greeting already played
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
    provider.hasHeardFirstGreeting = true; // mid-session: greeting already played
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
    provider.hasHeardFirstGreeting = true; // mid-session: greeting already played
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
      provider.hasHeardFirstGreeting = true; // mid-session: greeting already played
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

      provider.conversation.push({ id: "u1", role: "user", text: "hi", isFinal: false, timestamp: "" });
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
    provider.hasHeardFirstGreeting = true; // mid-session: greeting already played
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

  describe("transcript-less turns (noise / echo)", () => {
    function noiseReadyProvider() {
      vi.stubGlobal("WebSocket", { OPEN: 1 });
      const provider = new XAIRealtimeProvider({});
      provider.registerFunction({
        name: "wait_for_user",
        description: "Wait for user",
        parameters: {},
        execute: async () => ({ success: true, message: "", continueResponse: false }),
      });
      provider.ws = { readyState: 1, send: vi.fn() };
      provider.isConnected = true;
      provider.hasHeardFirstGreeting = true; // mid-session: greeting already played
      provider.chatStatus = "ready";
      provider.micEnabled = true;
      const statuses = [];
      provider.onChatStatusChange = (s) => statuses.push(s);
      return { provider, statuses };
    }

    it("never shows thinking when the model answers noise with wait_for_user", async () => {
      vi.useFakeTimers();
      try {
        const { provider, statuses } = noiseReadyProvider();
        for (let round = 0; round < 3; round++) {
          await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
          await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: `n${round}` }));
          await provider.handleServerEvent(serverEvent("response.created", { response: { id: `r${round}` } }));
          await provider.executeToolCall(`c${round}`, "wait_for_user", "{}");
          await provider.handleServerEvent(serverEvent("response.done", { response: { id: `r${round}` } }));
          await vi.advanceTimersByTimeAsync(1000);
        }
        expect(statuses).not.toContain("thinking");
        expect(provider.chatStatus).toBe("ready");
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    });

    it("promotes to thinking when a late transcript arrives", async () => {
      vi.useFakeTimers();
      try {
        const { provider } = noiseReadyProvider();
        await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
        await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: "t" }));
        expect(provider.chatStatus).toBe("ready");
        await provider.handleServerEvent(
          serverEvent("conversation.item.input_audio_transcription.updated", { transcript: "what time is it" }),
        );
        expect(provider.chatStatus).toBe("thinking");
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    });

    it("promotes to thinking after the grace window when a response is still being generated", async () => {
      vi.useFakeTimers();
      try {
        const { provider } = noiseReadyProvider();
        await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
        await provider.handleServerEvent(serverEvent("input_audio_buffer.committed", { item_id: "t" }));
        await provider.handleServerEvent(serverEvent("response.created", { response: { id: "r" } }));
        expect(provider.chatStatus).toBe("ready");
        await vi.advanceTimersByTimeAsync(700);
        expect(provider.chatStatus).toBe("thinking");
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    });
  });

  describe("greeting sequence (OpenAI parity)", () => {
    function greetingProvider() {
      const provider = new XAIRealtimeProvider({ instructions: "Be nice." });
      provider.isConnected = true;
      provider.micEnabled = true;
      provider.chatStatus = "starting";
      provider.ws = { readyState: 1, send: vi.fn() };
      return provider;
    }

    it("stays starting through the greeting response and ignores speech until it has played", async () => {
      const provider = greetingProvider();
      await provider.handleServerEvent(serverEvent("response.created", { response: { id: "greet" } }));
      expect(provider.chatStatus).toBe("starting");

      await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
      expect(provider.chatStatus).toBe("starting");
      expect(provider.conversation).toHaveLength(0);
    });

    it("goes ready once the greeting audio has finished, then opens turns normally", async () => {
      const provider = greetingProvider();
      provider.playbackEngine = { isPlaying: false, cancel: vi.fn() };
      await provider.handleServerEvent(serverEvent("response.created", { response: { id: "greet" } }));
      vi.useFakeTimers();
      try {
        await provider.handleServerEvent(serverEvent("response.output_audio.done"));
        expect(provider.chatStatus).toBe("ready");

        // Past the 300ms post-playback echo guard.
        vi.advanceTimersByTime(301);
        await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
        expect(provider.chatStatus).toBe("listening");
      } finally {
        vi.useRealTimers();
      }
    });

    it("still opens the mic when the greeting produces no audio", async () => {
      const provider = greetingProvider();
      await provider.handleServerEvent(serverEvent("response.created", { response: { id: "greet" } }));
      await provider.handleServerEvent(serverEvent("response.done", { response: { id: "greet" } }));
      expect(provider.chatStatus).toBe("ready");

      await provider.handleServerEvent(serverEvent("input_audio_buffer.speech_started"));
      expect(provider.chatStatus).toBe("listening");
    });

    it("resets to stopped on disconnect so the next session greets from starting again", () => {
      const provider = greetingProvider();
      provider.hasHeardFirstGreeting = true;
      provider.chatStatus = "ready";
      provider.handleDisconnect();
      expect(provider.chatStatus).toBe("stopped");
      expect(provider.hasHeardFirstGreeting).toBe(false);
    });
  });
});

describe("tool follow-ups", () => {
  function toolProvider() {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const provider = new XAIRealtimeProvider({});
    provider.registerFunction({
      name: "wait_for_user",
      description: "Wait for user",
      parameters: {},
      execute: async () => ({ success: true, message: "", continueResponse: false }),
    });
    provider.registerFunction({
      name: "set_emotion",
      description: "Set emotion",
      parameters: {},
      execute: async () => ({ success: true, message: "emotion set" }),
    });
    const send = vi.fn();
    provider.ws = { readyState: 1, send };
    provider.isConnected = true;
    provider.hasHeardFirstGreeting = true;
    provider.chatStatus = "thinking";
    const sent = () => send.mock.calls.map(([payload]) => JSON.parse(payload).type);
    return { provider, sent };
  }

  it("does not request a reply when a terminal tool shares the response", async () => {
    try {
      const { provider, sent } = toolProvider();
      await provider.handleServerEvent(serverEvent("response.created", { response: { id: "r" } }));
      await provider.executeToolCall("c1", "set_emotion", "{}");
      await provider.executeToolCall("c2", "wait_for_user", "{}");
      await provider.handleServerEvent(serverEvent("response.done", { response: { id: "r" } }));
      expect(sent()).not.toContain("response.create");
      expect(provider.chatStatus).toBe("ready");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends one follow-up after response.done for several continuing tools", async () => {
    try {
      const { provider, sent } = toolProvider();
      await provider.handleServerEvent(serverEvent("response.created", { response: { id: "r" } }));
      await provider.executeToolCall("c1", "set_emotion", "{}");
      await provider.executeToolCall("c2", "set_emotion", "{}");
      expect(sent()).not.toContain("response.create");
      await provider.handleServerEvent(serverEvent("response.done", { response: { id: "r" } }));
      expect(sent().filter((t) => t === "response.create")).toHaveLength(1);
      expect(provider.chatStatus).toBe("thinking");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waits for a tool still running when response.done arrives", async () => {
    try {
      const { provider, sent } = toolProvider();
      let finish;
      provider.registerFunction({
        name: "slow",
        description: "Slow",
        parameters: {},
        execute: () => new Promise((resolve) => (finish = resolve)),
      });
      await provider.handleServerEvent(serverEvent("response.created", { response: { id: "r" } }));
      const call = provider.executeToolCall("c1", "slow", "{}");
      await provider.handleServerEvent(serverEvent("response.done", { response: { id: "r" } }));
      expect(sent()).not.toContain("response.create");
      expect(provider.chatStatus).toBe("thinking");
      finish({ success: true, message: "done" });
      await call;
      expect(sent()).toContain("response.create");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("stage-direction replies", () => {
  it("recognizes bare stage directions", () => {
    expect(isStageDirectionOnly("(silent)")).toBe(true);
    expect(isStageDirectionOnly(" (waiting quietly). ")).toBe(true);
    expect(isStageDirectionOnly("[stays quiet] *nods*")).toBe(true);
    expect(isStageDirectionOnly("(laughs) That's funny!")).toBe(false);
    expect(isStageDirectionOnly("Hello (smiles)")).toBe(false);
    expect(isStageDirectionOnly("")).toBe(false);
  });

  it("treats partial transcripts as undecided until real words follow", () => {
    expect(mayBeStageDirection("(sil")).toBe(true);
    expect(mayBeStageDirection("(silent)")).toBe(true);
    expect(mayBeStageDirection("(laughs) Th")).toBe(false);
    expect(mayBeStageDirection("Hi")).toBe(false);
  });

  function replyProvider() {
    const provider = new XAIRealtimeProvider({});
    provider.isConnected = true;
    provider.hasHeardFirstGreeting = true;
    provider.chatStatus = "thinking";
    const played = [];
    provider.playbackEngine = {
      appendChunk: (c) => played.push(c),
      cancel: vi.fn(),
      isPlaying: false,
      getAnalyser: () => null,
    };
    return { provider, played };
  }

  async function reply(provider, parts, final) {
    await provider.handleServerEvent(serverEvent("response.created", { response: { id: "r" } }));
    await provider.handleServerEvent(
      serverEvent("conversation.item.created", { item: { id: "a", role: "assistant" } }),
    );
    for (const [text, audio] of parts) {
      await provider.handleServerEvent(serverEvent("response.output_audio_transcript.delta", { delta: text }));
      await provider.handleServerEvent(serverEvent("response.output_audio.delta", { delta: audio }));
    }
    await provider.handleServerEvent(serverEvent("response.output_audio_transcript.done", { transcript: final }));
    await provider.handleServerEvent(serverEvent("response.done", { response: { id: "r" } }));
  }

  it("drops a bare stage direction: no audio, no chat bubble", async () => {
    const { provider, played } = replyProvider();
    await reply(provider, [["(sil", "A"], ["ent)", "B"]], "(silent)");
    expect(played).toEqual([]);
    expect(provider.conversation).toHaveLength(0);
    expect(provider.chatStatus).toBe("ready");
  });

  it("plays a reply that opens with an aside once real words follow", async () => {
    const { provider, played } = replyProvider();
    await reply(provider, [["(laughs)", "A"], [" Sure thing", "B"]], "(laughs) Sure thing");
    expect(played).toEqual(["A", "B"]);
    expect(provider.conversation.map((m) => m.text)).toEqual(["(laughs) Sure thing"]);
  });

  it("passes ordinary replies straight through", async () => {
    const { provider, played } = replyProvider();
    await reply(provider, [["Hello", "A"], [" there", "B"]], "Hello there");
    expect(played).toEqual(["A", "B"]);
    expect(provider.conversation.map((m) => m.text)).toEqual(["Hello there"]);
  });
});
