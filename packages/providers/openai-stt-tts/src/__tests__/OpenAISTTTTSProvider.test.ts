import { describe, it, expect, vi } from "vitest";
import { OpenAISTTTTSProvider, OpenAISTTTTSConfig } from "../OpenAISTTTTSProvider";
import type { RealtimeProvider } from "@khaveeai/core";
import type { AudioRecorder } from "../AudioRecorder";
import type { STTClient } from "../STTClient";
import type { ChatClient } from "../ChatClient";
import type { TTSPlayer } from "../TTSPlayer";

/**
 * Test subclass that exposes protected internals for unit testing
 * without requiring type casts to `any`.
 */
class TestableProvider extends OpenAISTTTTSProvider {
  getMessages(): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    return this.messages;
  }

  pushMessage(role: "system" | "user" | "assistant", content: string): void {
    this.messages.push({ role, content });
  }

  callTrimHistory(maxTurns?: number): void {
    this.trimHistory(maxTurns);
  }

  callResolveAuthToken(): string {
    return this.resolveAuthToken();
  }
}

// ── SDK-02: Interface conformance ───────────────────────────────────────────

describe("SDK-02: OpenAISTTTTSProvider interface conformance", () => {
  it("is assignable to RealtimeProvider and has correct initial state", () => {
    const config: OpenAISTTTTSConfig = {};
    // Compile-time check: must satisfy RealtimeProvider
    const p: RealtimeProvider = new OpenAISTTTTSProvider(config);

    expect(p.chatStatus).toBe("stopped");
    expect(p.isConnected).toBe(false);
    expect(p.conversation).toHaveLength(0);
    expect(p.currentVolume).toBe(0);
  });
});

// ── SDK-02: trimHistory preserves system message ────────────────────────────

describe("SDK-02: trimHistory preserves system message", () => {
  it("keeps the system message and trims to maxTurns*2 non-system messages", () => {
    const provider = new TestableProvider({
      instructions: "You are a test assistant.",
    });

    // Push 12 user/assistant turn pairs (24 non-system messages)
    for (let i = 0; i < 12; i++) {
      provider.pushMessage("user", `user turn ${i}`);
      provider.pushMessage("assistant", `assistant turn ${i}`);
    }

    // Before trim: 1 system + 24 non-system = 25
    expect(provider.getMessages()).toHaveLength(25);

    // Trim to default maxTurns=10 → keep 1 system + 20 non-system
    provider.callTrimHistory();

    const messages = provider.getMessages();
    // System message is preserved as first entry
    expect(messages[0].role).toBe("system");
    // Total length: 1 system + 20 non-system = 21
    expect(messages).toHaveLength(21);
  });
});

// ── resolveAuthToken unit test ──────────────────────────────────────────────

describe("resolveAuthToken", () => {
  it("returns the apiKey when configured", () => {
    const provider = new TestableProvider({ apiKey: "sk-test" });
    expect(provider.callResolveAuthToken()).toBe("sk-test");
  });

  it("returns empty string when no apiKey is configured", () => {
    const provider = new TestableProvider({});
    expect(provider.callResolveAuthToken()).toBe("");
  });
});

// ── SDK-04 — tests now live in STTClient.test.ts (filled by Plan 02) ─────────

// ── SDK-05 (ChatClient unit tests live in ChatClient.test.ts; provider-level
//           messages-trim tests are in Plan 04) ─────────────────────────────

describe("SDK-05: multi-turn history accumulation and trim", () => {
  it("accumulates both turns and preserves system message at index 0 after two turns", async () => {
    // Fake STT: always returns a transcript
    const fakeAudioRecorder: AudioRecorder = {
      onSpeechStart: undefined,
      onUtteranceReady: undefined,
      onError: undefined,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      isListening: vi.fn().mockReturnValue(false),
    } as unknown as AudioRecorder;

    const fakeSttClient: STTClient = {
      transcribe: vi.fn()
        .mockResolvedValueOnce("hello turn one")
        .mockResolvedValueOnce("hello turn two"),
    } as unknown as STTClient;

    const fakeChatClient: ChatClient = {
      complete: vi.fn()
        .mockResolvedValueOnce({
          text: "reply one",
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        })
        .mockResolvedValueOnce({
          text: "reply two",
          usage: { prompt_tokens: 7, completion_tokens: 4 },
        }),
    } as unknown as ChatClient;

    const fakeTtsPlayer: TTSPlayer = {
      speak: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
    } as unknown as TTSPlayer;

    const provider = new TestableProvider(
      { instructions: "You are a test bot.", apiKey: "sk-test" },
      {
        audioRecorder: fakeAudioRecorder,
        sttClient: fakeSttClient,
        chatClient: fakeChatClient,
        ttsPlayer: fakeTtsPlayer,
      },
    );

    // Trigger two turns via sendMessage (same code path as VAD but skips STT)
    await provider.sendMessage("hello turn one");
    await provider.sendMessage("hello turn two");

    const msgs = provider.getMessages();

    // System message preserved at index 0
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are a test bot.");

    // Both user and assistant messages should be in history
    const userMsgs = msgs.filter((m) => m.role === "user");
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(userMsgs).toHaveLength(2);
    expect(assistantMsgs).toHaveLength(2);
  });
});

// ── SDK-08: interrupt() stops TTS and resets chatStatus ────────────────────

describe("SDK-08: interrupt() stops source and resets chatStatus to ready", () => {
  it("calls ttsPlayer.cancel() once and resets chatStatus to ready synchronously", () => {
    const cancelSpy = vi.fn();

    const fakeTtsPlayer: TTSPlayer = {
      speak: vi.fn().mockResolvedValue(undefined),
      cancel: cancelSpy,
    } as unknown as TTSPlayer;

    const provider = new OpenAISTTTTSProvider(
      { apiKey: "sk-test" },
      { ttsPlayer: fakeTtsPlayer },
    );

    // Manually set chatStatus to "speaking" to simulate active TTS
    // Using TestableProvider subclass to access setChatStatus via the public field
    provider.chatStatus = "speaking";

    // interrupt() must be synchronous — no await
    provider.interrupt();

    // cancel() must have been called exactly once
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    // chatStatus must be "ready" within the same tick (one frame)
    expect(provider.chatStatus).toBe("ready");
  });
});

// ── SDK-09: onUsageReport fires with mapped token counts ────────────────────

describe("SDK-09: onUsageReport fires with mapped token counts", () => {
  it("fires onUsageReport with correct token breakdown from API response", async () => {
    const fakeAudioRecorder: AudioRecorder = {
      onSpeechStart: undefined,
      onUtteranceReady: undefined,
      onError: undefined,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      isListening: vi.fn().mockReturnValue(false),
    } as unknown as AudioRecorder;

    const fakeSttClient: STTClient = {
      transcribe: vi.fn().mockResolvedValue("hello"),
    } as unknown as STTClient;

    const fakeChatClient: ChatClient = {
      complete: vi.fn().mockResolvedValue({
        text: "hi",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 2 },
        },
      }),
    } as unknown as ChatClient;

    const fakeTtsPlayer: TTSPlayer = {
      speak: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
    } as unknown as TTSPlayer;

    const provider = new OpenAISTTTTSProvider(
      { apiKey: "sk-test" },
      {
        audioRecorder: fakeAudioRecorder,
        sttClient: fakeSttClient,
        chatClient: fakeChatClient,
        ttsPlayer: fakeTtsPlayer,
      },
    );

    const usageReportSpy = vi.fn();
    provider.onUsageReport = usageReportSpy;

    // Drive one turn via sendMessage (text→chat→TTS, no STT step needed)
    await provider.sendMessage("hello");

    // onUsageReport must have been called exactly once
    expect(usageReportSpy).toHaveBeenCalledTimes(1);

    const report = usageReportSpy.mock.calls[0][0] as {
      sessionId: string;
      inputTextTokens: number;
      inputAudioTokens: number;
      inputCachedTokens: number;
      outputTextTokens: number;
      outputAudioTokens: number;
    };

    // sessionId must be non-empty (generated at connect time or fallback "")
    // Note: connect() was not called here, so sessionId is null → ""
    expect(typeof report.sessionId).toBe("string");

    // Token mapping verification (RESEARCH mapping)
    expect(report.inputTextTokens).toBe(10);
    expect(report.inputAudioTokens).toBe(0);
    expect(report.inputCachedTokens).toBe(2);
    expect(report.outputTextTokens).toBe(5);
    expect(report.outputAudioTokens).toBe(0);
  });
});

// ── Greeting: fixed opening line spoken via TTS right after connect() ────────

describe("greeting: spoken verbatim after connect()", () => {
  class GreetingProvider extends OpenAISTTTTSProvider {
    getMessages(): Array<{ role: "system" | "user" | "assistant"; content: string }> {
      return this.messages;
    }
    greetingPromise(): Promise<void> | null {
      return this.greetingInFlight;
    }
  }

  type SpeakImpl = (
    text: string,
    cfg: unknown,
    ctx: unknown,
    onAudioData?: (analyser: unknown, ctx: unknown) => void,
  ) => Promise<void>;

  function makeDeps(speakImpl?: SpeakImpl) {
    const calls: string[] = [];
    const audioRecorder = {
      onSpeechStart: undefined,
      onUtteranceReady: undefined,
      onError: undefined,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockImplementation(async () => {
        calls.push("pause");
      }),
      resume: vi.fn().mockImplementation(async () => {
        calls.push("resume");
      }),
      isListening: vi.fn().mockReturnValue(false),
    } as unknown as AudioRecorder;
    const sttClient = { transcribe: vi.fn() } as unknown as STTClient;
    const chatClient = {
      complete: vi.fn().mockResolvedValue({ text: "reply", usage: {} }),
    } as unknown as ChatClient;
    const defaultSpeak: SpeakImpl = async (_text, _cfg, _ctx, onAudioData) => {
      calls.push("speak");
      onAudioData?.({}, {});
    };
    const ttsPlayer = {
      speak: vi.fn().mockImplementation(speakImpl ?? defaultSpeak),
      cancel: vi.fn().mockImplementation(() => {
        calls.push("cancel");
      }),
    } as unknown as TTSPlayer;
    return { calls, audioRecorder, sttClient, chatClient, ttsPlayer };
  }

  function stubAudioContext() {
    vi.stubGlobal(
      "AudioContext",
      class {
        state = "running";
        close = vi.fn().mockResolvedValue(undefined);
      },
    );
  }

  it("speaks the greeting once with the mic paused, records it as the first assistant message, and settles to ready", async () => {
    stubAudioContext();
    const deps = makeDeps();
    const provider = new GreetingProvider(
      { instructions: "You are a test bot.", greeting: "  Hi! Welcome to Khavee.  " },
      deps,
    );
    const statuses: string[] = [];
    provider.onChatStatusChange = (s) => statuses.push(s);
    const onConnect = vi.fn();
    provider.onConnect = onConnect;

    await provider.connect();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(provider.chatStatus).not.toBe("ready"); // greeting still in flight
    await provider.greetingPromise();

    const speak = deps.ttsPlayer.speak as ReturnType<typeof vi.fn>;
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0]).toBe("Hi! Welcome to Khavee.");
    expect(deps.calls.indexOf("pause")).toBeLessThan(deps.calls.indexOf("speak"));
    expect(deps.calls.indexOf("speak")).toBeLessThan(deps.calls.indexOf("resume"));

    const nonSystem = provider.getMessages().filter((m) => m.role !== "system");
    expect(nonSystem).toEqual([{ role: "assistant", content: "Hi! Welcome to Khavee." }]);
    expect(provider.conversation).toHaveLength(1);
    expect(provider.conversation[0].role).toBe("assistant");
    expect(provider.conversation[0].text).toBe("Hi! Welcome to Khavee.");

    expect(statuses).toContain("speaking");
    expect(statuses[statuses.length - 1]).toBe("ready");
    expect(provider.isMicrophoneEnabled()).toBe(true);
    expect(provider.greetingPromise()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("does not greet on a skipGreeting reconnect", async () => {
    stubAudioContext();
    const deps = makeDeps();
    const provider = new GreetingProvider({ greeting: "Hi!" }, deps);

    await provider.connect({ skipGreeting: true });

    expect(deps.ttsPlayer.speak).not.toHaveBeenCalled();
    expect(provider.chatStatus).toBe("ready");
    expect(provider.greetingPromise()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("behaves exactly as before when no greeting is configured", async () => {
    stubAudioContext();
    const deps = makeDeps();
    const provider = new GreetingProvider({ instructions: "You are a test bot." }, deps);
    const order: string[] = [];
    provider.onChatStatusChange = (s) => order.push(`status:${s}`);
    provider.onConnect = () => order.push("connect");

    await provider.connect();

    expect(deps.ttsPlayer.speak).not.toHaveBeenCalled();
    expect(provider.chatStatus).toBe("ready");
    expect(order.slice(-2)).toEqual(["status:ready", "connect"]);
    expect(provider.conversation).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("lets disconnect() win mid-greeting: no resume, status stays stopped, history cleared", async () => {
    stubAudioContext();
    let finishSpeak: () => void = () => {};
    const deps = makeDeps(
      () =>
        new Promise<void>((resolve) => {
          finishSpeak = resolve;
        }),
    );
    const provider = new GreetingProvider({ greeting: "Hi!" }, deps);

    await provider.connect();
    const inFlight = provider.greetingPromise();
    expect(inFlight).not.toBeNull();

    await provider.disconnect();
    expect(deps.ttsPlayer.cancel).toHaveBeenCalled();
    finishSpeak();
    await inFlight;

    expect(provider.chatStatus).toBe("stopped");
    expect(deps.audioRecorder.resume).not.toHaveBeenCalled();
    expect(provider.conversation).toHaveLength(0);
    expect(provider.isMicrophoneEnabled()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("sendMessage during the greeting cancels it and then runs exactly one turn", async () => {
    stubAudioContext();
    let finishSpeak: () => void = () => {};
    let speakCount = 0;
    const deps = makeDeps(async () => {
      speakCount += 1;
      if (speakCount === 1) {
        // The greeting: stays pending until cancel() resolves it.
        await new Promise<void>((resolve) => {
          finishSpeak = resolve;
        });
      }
    });
    (deps.ttsPlayer.cancel as ReturnType<typeof vi.fn>).mockImplementation(() => finishSpeak());
    const provider = new GreetingProvider({ greeting: "Hi!" }, deps);

    await provider.connect();
    await provider.sendMessage("hello");

    expect(deps.ttsPlayer.cancel).toHaveBeenCalledTimes(1);
    expect(deps.chatClient.complete).toHaveBeenCalledTimes(1);
    expect(speakCount).toBe(2); // greeting + reply
    const roles = provider.conversation.map((c) => c.role);
    expect(roles).toEqual(["assistant", "user", "assistant"]);
    expect(provider.chatStatus).toBe("ready");
    vi.unstubAllGlobals();
  });
});
