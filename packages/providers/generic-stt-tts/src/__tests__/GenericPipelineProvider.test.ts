import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GenericPipelineProvider,
  GenericPipelineConfig,
} from "../GenericPipelineProvider";
import type {
  RealtimeProvider,
  VADProvider,
  STTProvider,
  LLMProvider,
  TTSProvider,
  LLMCompletionResult,
  ToolResult,
} from "@khaveeai/core";
import { OpenAIVADAdapter } from "../adapters/OpenAIVADAdapter";
import { OpenAISTTAdapter } from "../adapters/OpenAISTTAdapter";
import { OpenAILLMAdapter } from "../adapters/OpenAILLMAdapter";
import { OpenAITTSAdapter } from "../adapters/OpenAITTSAdapter";
import type { AudioRecorder } from "@khaveeai/providers-openai-stt-tts";
import type { STTClient } from "@khaveeai/providers-openai-stt-tts";
import type { TTSPlayer } from "@khaveeai/providers-openai-stt-tts";

// ── Minimal AudioContext polyfill ────────────────────────────────────────
// The vitest "node" test environment (matching openai-stt-tts's own
// vitest.config.ts) has no AudioContext global. connect() always creates
// one (this.audioOutputContext = new AudioContext()) and disconnect()
// closes it when state !== "closed" — both must not throw under test.
class FakeAudioContext {
  state: "running" | "closed" = "running";
  close = vi.fn(async () => {
    this.state = "closed";
  });
}
vi.stubGlobal("AudioContext", FakeAudioContext);

// ── Fake pipeline-stage builders ─────────────────────────────────────────

function makeFakeVAD(): VADProvider {
  return {
    name: "fake-vad",
    onSpeechStart: undefined,
    onUtteranceReady: undefined,
    onError: undefined,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    isListening: vi.fn().mockReturnValue(false),
  };
}

function makeFakeSTT(text = "hello world"): STTProvider {
  return {
    name: "fake-stt",
    supportsStreaming: false,
    supportsRejection: false,
    transcribe: vi.fn().mockResolvedValue({ text }),
  };
}

function makeFakeLLM(
  result: LLMCompletionResult = { text: "ok", toolCalls: [] }
): LLMProvider {
  return {
    name: "fake-llm",
    supportsToolCalling: true,
    supportsStreaming: false,
    complete: vi.fn().mockResolvedValue(result),
  };
}

function makeFakeTTS(): TTSProvider {
  return {
    name: "fake-tts",
    supportsStreaming: false,
    speak: vi.fn().mockResolvedValue(undefined),
  };
}

function makeBaseConfig(
  overrides: Partial<GenericPipelineConfig> = {}
): GenericPipelineConfig {
  return {
    vad: makeFakeVAD(),
    stt: makeFakeSTT(),
    llm: makeFakeLLM(),
    tts: makeFakeTTS(),
    ...overrides,
  };
}

// ── ORCH-01/02: Interface conformance ───────────────────────────────────

describe("ORCH-01/02: GenericPipelineProvider interface conformance", () => {
  it("is assignable to RealtimeProvider and has correct initial state", () => {
    const config = makeBaseConfig();
    const p: RealtimeProvider = new GenericPipelineProvider(config);

    expect(p.chatStatus).toBe("stopped");
    expect(p.isConnected).toBe(false);
    expect(p.conversation).toHaveLength(0);
    expect(p.currentVolume).toBe(0);
  });

  it("defaults micReopenCooldownMs to 500 when omitted", async () => {
    vi.useFakeTimers();
    try {
      const llm = makeFakeLLM({ text: "done", toolCalls: [] });
      const config = makeBaseConfig({ llm });
      const provider = new GenericPipelineProvider(config);
      await provider.connect();

      let resolved = false;
      const promise = provider.sendMessage("hi").then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(499);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await promise;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── ORCH-04: Cooldown is config-driven ──────────────────────────────────

describe("ORCH-04: micReopenCooldownMs is read from config, not hardcoded", () => {
  it("uses the configured cooldown duration instead of the 500ms default", async () => {
    vi.useFakeTimers();
    try {
      const llm = makeFakeLLM({ text: "done", toolCalls: [] });
      const config = makeBaseConfig({ llm, micReopenCooldownMs: 1234 });
      const provider = new GenericPipelineProvider(config);
      await provider.connect();

      let resolved = false;
      const promise = provider.sendMessage("hi").then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(1233);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await promise;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── ORCH-03: Full-interruption barge-in ─────────────────────────────────

describe("ORCH-03: mid-turn utterance aborts the active turn and starts a new one", () => {
  it("aborts the first turn's signal when a second utterance arrives mid-turn", async () => {
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;
    let callCount = 0;

    const llm: LLMProvider = {
      name: "fake-llm",
      supportsToolCalling: true,
      supportsStreaming: false,
      complete: vi.fn().mockImplementation(async (args: { signal?: AbortSignal }) => {
        callCount++;
        if (callCount === 1) {
          firstSignal = args.signal;
          // Yield so the second utterance can fire and abort this turn
          // before this first call resolves.
          await new Promise((resolve) => setTimeout(resolve, 10));
        } else {
          secondSignal = args.signal;
        }
        return { text: `reply-${callCount}`, toolCalls: [] };
      }),
    };

    const vad = makeFakeVAD();
    const config = makeBaseConfig({ vad, llm });
    const provider = new GenericPipelineProvider(config);
    await provider.connect();

    // Fire first utterance
    vad.onUtteranceReady?.(new Blob());
    // Poll until the first turn reaches llm.complete and registers its signal
    // (transcribe() resolves on a microtask; a single setTimeout(0) tick is
    // not always sufficient under load, so poll briefly instead of a fixed wait).
    for (let i = 0; i < 50 && firstSignal === undefined; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(firstSignal).toBeDefined();
    expect(firstSignal?.aborted).toBe(false);

    // Fire second utterance mid-turn (barge-in)
    vad.onUtteranceReady?.(new Blob());

    // First turn's signal must now be aborted
    expect(firstSignal?.aborted).toBe(true);

    // Wait for both turns to settle
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(secondSignal).toBeDefined();
    expect(secondSignal?.aborted).toBe(false);
  });
});

// ── ORCH-05: Non-Error rejection normalization ──────────────────────────

describe("ORCH-05: non-Error rejections are normalized to Error without crashing the session", () => {
  it("routes a thrown string to onError as an Error instance and returns chatStatus to ready", async () => {
    const llm: LLMProvider = {
      name: "fake-llm",
      supportsToolCalling: true,
      supportsStreaming: false,
      complete: vi.fn().mockRejectedValue("boom"),
    };
    const config = makeBaseConfig({ llm });
    const provider = new GenericPipelineProvider(config);
    await provider.connect();

    const onError = vi.fn();
    provider.onError = onError;

    await provider.sendMessage("hi");

    expect(onError).toHaveBeenCalledTimes(1);
    const receivedError = onError.mock.calls[0][0];
    expect(receivedError).toBeInstanceOf(Error);
    expect(receivedError.message).toContain("boom");
    expect(provider.chatStatus).toBe("ready");
  });
});

// ── D-04/D-05: Multi-round tool-calling loop ─────────────────────────────

describe("D-04/D-05: bounded multi-round tool-calling loop via ToolExecutor", () => {
  it("runs 2 rounds of tool calls then reaches a final text reply", async () => {
    let round = 0;
    const llm: LLMProvider = {
      name: "fake-llm",
      supportsToolCalling: true,
      supportsStreaming: false,
      complete: vi.fn().mockImplementation(async () => {
        round++;
        if (round <= 2) {
          return {
            toolCalls: [{ id: `c${round}`, name: "testTool", args: {} }],
          };
        }
        return { text: "done", toolCalls: [] };
      }),
    };

    const toolExecute = vi.fn().mockResolvedValue({
      success: true,
      message: "tool ran",
    } as ToolResult);

    const config = makeBaseConfig({
      llm,
      pipelineTools: [
        {
          name: "testTool",
          description: "a test tool",
          parameters: { type: "object", properties: {} },
          execute: toolExecute,
        },
      ],
    });
    const provider = new GenericPipelineProvider(config);
    await provider.connect();

    await provider.sendMessage("call the tool twice");

    expect(toolExecute).toHaveBeenCalledTimes(2);
    expect(provider.conversation.at(-1)?.text).toBe("done");
    expect(provider.chatStatus).toBe("ready");
  });

  it("routes an Error mentioning 'exceeded' to onError after more than 5 rounds", async () => {
    const llm: LLMProvider = {
      name: "fake-llm",
      supportsToolCalling: true,
      supportsStreaming: false,
      complete: vi.fn().mockResolvedValue({
        toolCalls: [{ id: "c", name: "loopTool", args: {} }],
      }),
    };

    const toolExecute = vi.fn().mockResolvedValue({
      success: true,
      message: "tool ran",
    } as ToolResult);

    const config = makeBaseConfig({
      llm,
      pipelineTools: [
        {
          name: "loopTool",
          description: "a tool that never stops being called",
          parameters: { type: "object", properties: {} },
          execute: toolExecute,
        },
      ],
    });
    const provider = new GenericPipelineProvider(config);
    await provider.connect();

    const onError = vi.fn();
    provider.onError = onError;

    await provider.sendMessage("loop forever");

    expect(onError).toHaveBeenCalledTimes(1);
    const receivedError = onError.mock.calls[0][0];
    expect(receivedError).toBeInstanceOf(Error);
    expect(receivedError.message).toContain("exceeded");
    expect(provider.chatStatus).toBe("ready");
  });
});

// ── ORCH-02 integration: real adapters compose into RealtimeProvider ────

describe("ORCH-02 integration: GenericPipelineProvider composed from the four real OpenAI adapters", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is assignable to RealtimeProvider and a driven turn produces an assistant conversation entry", async () => {
    // Fake the underlying AudioRecorder/STTClient/TTSPlayer instances each
    // adapter wraps via their constructor DI seam.
    const fakeAudioRecorder = {
      onSpeechStart: undefined,
      onUtteranceReady: undefined,
      onError: undefined,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      isListening: vi.fn().mockReturnValue(false),
    } as unknown as AudioRecorder;

    const fakeSTTClient = {
      transcribe: vi.fn().mockResolvedValue("hello from integration test"),
    } as unknown as STTClient;

    const fakeTTSPlayer = {
      speak: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
    } as unknown as TTSPlayer;

    const vadAdapter = new OpenAIVADAdapter({}, fakeAudioRecorder);
    const sttAdapter = new OpenAISTTAdapter(
      { endpoint: "https://api.example.com/stt", authToken: "tok" },
      fakeSTTClient
    );
    const llmAdapter = new OpenAILLMAdapter({
      endpoint: "https://api.example.com/chat",
      authToken: "tok",
    });
    const ttsAdapter = new OpenAITTSAdapter(
      { endpoint: "https://api.example.com/tts", authToken: "tok" },
      fakeTTSPlayer
    );

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "hello back from the assistant" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const provider: RealtimeProvider = new GenericPipelineProvider({
      vad: vadAdapter,
      stt: sttAdapter,
      llm: llmAdapter,
      tts: ttsAdapter,
    });

    await provider.connect();
    await provider.sendMessage("hello from integration test");

    const assistantEntry = provider.conversation.find((c) => c.role === "assistant");
    expect(assistantEntry).toBeDefined();
    expect(assistantEntry?.text).toBe("hello back from the assistant");
  });
});
