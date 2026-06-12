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
