/**
 * OpenAI STT/TTS Pipeline Provider for Khavee AI SDK
 *
 * Uses VAD + Whisper STT + Chat Completions + OpenAI TTS through backend proxies.
 * Implements RealtimeProvider from @khaveeai/core.
 */

import {
  RealtimeProvider,
  RealtimeConfig,
  RealtimeTool,
  UsageReport,
  Conversation,
  ChatStatus,
  MouthState,
  PhonemeData,
} from "@khaveeai/core";
import { RealtimeMessage } from "@khaveeai/core";
import { ToolExecutor } from "./ToolExecutor";

/**
 * Configuration for the OpenAI STT/TTS pipeline provider.
 * Extends RealtimeConfig with STT/TTS-specific options.
 */
export interface OpenAISTTTTSConfig extends RealtimeConfig {
  /** Whisper STT model to use. Default: "gpt-4o-mini-transcribe" */
  sttModel?: string;
  /** OpenAI TTS model to use. Default: "gpt-4o-mini-tts" */
  ttsModel?: string;
  /** Backend endpoint URL for STT (Whisper) requests */
  sttProxyEndpoint?: string;
  /** Backend endpoint URL for TTS requests */
  ttsProxyEndpoint?: string;
  /** Backend endpoint URL for Chat Completions requests */
  chatProxyEndpoint?: string;
  /** Duration of silence (ms) before ending a speech turn. Default: 1500 */
  silenceThresholdMs?: number;
  /** VAD positive speech threshold (0–1). Default: 0.5 */
  positiveSpeechThreshold?: number;
  /** VAD negative speech threshold (0–1). Default: 0.35 */
  negativeSpeechThreshold?: number;
  /** Base URL for serving VAD static assets (ONNX model files, WASM). */
  baseAssetPath?: string;
  /** Override path for onnxruntime-web WASM files. */
  onnxWASMBasePath?: string;
}

/** Shape of a chat message stored in the internal history buffer. */
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class OpenAISTTTTSProvider implements RealtimeProvider {
  // ── Private state ────────────────────────────────────────────────────────

  protected config: OpenAISTTTTSConfig;
  private toolExecutor: ToolExecutor;
  private sessionId: string | null = null;

  /** Internal chat history buffer (system + turns). */
  protected messages: ChatMessage[] = [];

  // Audio output nodes for lip-sync / volume analysis
  private audioOutputContext: AudioContext | null = null;
  private audioOutputAnalyser: AnalyserNode | null = null;

  // TTS playback handles (wired in Plan 03)
  private ttsAbortController: AbortController | null = null;
  private ttsSource: AudioBufferSourceNode | null = null;

  // Microphone state (full VAD wiring in Plan 02)
  private micEnabled = false;

  // ── Public interface state ───────────────────────────────────────────────

  public isConnected = false;
  public chatStatus: ChatStatus = "stopped";
  public conversation: Conversation[] = [];
  public currentVolume = 0;

  // ── Public event handlers (RealtimeEvents) ───────────────────────────────

  public onConnect?: () => void;
  public onDisconnect?: () => void;
  public onError?: (error: Error) => void;
  public onMessage?: (message: RealtimeMessage) => void;
  public onConversationUpdate?: (conversation: Conversation[]) => void;
  public onChatStatusChange?: (status: ChatStatus) => void;
  public onAudioStart?: () => void;
  public onAudioEnd?: () => void;
  public onVolumeChange?: (volume: number) => void;
  public onMouthStateChange?: (state: MouthState) => void;
  public onPhonemeDetected?: (phoneme: PhonemeData) => void;
  public onToolCall?: (toolName: string, args: unknown, result: unknown) => void;
  public onUsageReport?: (usage: UsageReport) => void;
  public onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;

  // ── Constructor ──────────────────────────────────────────────────────────

  constructor(config: OpenAISTTTTSConfig) {
    this.config = {
      sttModel: "gpt-4o-mini-transcribe",
      ttsModel: "gpt-4o-mini-tts",
      voice: "alloy",
      speed: 1.0,
      ...config,
    };

    this.toolExecutor = new ToolExecutor();

    // Register any tools provided at construction time
    if (this.config.tools) {
      this.config.tools.forEach((tool) => this.registerFunction(tool));
    }

    // Seed conversation history with the system prompt when provided
    if (this.config.instructions) {
      this.messages.push({ role: "system", content: this.config.instructions });
    }
  }

  // ── Interface methods — real bodies ──────────────────────────────────────

  /**
   * Register a function/tool for function-calling.
   */
  registerFunction(tool: RealtimeTool): void {
    this.toolExecutor.register(tool.name, tool.execute);
  }

  /**
   * Return the audio analyser + context, or null if no audio context is active.
   */
  getAudioAnalyser(): { analyser: AnalyserNode; audioContext: AudioContext } | null {
    if (this.audioOutputAnalyser && this.audioOutputContext) {
      return {
        analyser: this.audioOutputAnalyser,
        audioContext: this.audioOutputContext,
      };
    }
    return null;
  }

  /**
   * Toggle the microphone on/off.
   * Full VAD wiring lands in Plan 02 — this skeleton tracks the flag only.
   */
  toggleMicrophone(): boolean {
    if (this.micEnabled) {
      this.disableMicrophone();
      return false;
    } else {
      this.enableMicrophone();
      return true;
    }
  }

  /** Enable the microphone. Full VAD wiring in Plan 02. */
  enableMicrophone(): void {
    this.micEnabled = true;
  }

  /** Disable the microphone. Full VAD wiring in Plan 02. */
  disableMicrophone(): void {
    this.micEnabled = false;
  }

  /** Return whether the microphone is currently enabled. */
  isMicrophoneEnabled(): boolean {
    return this.micEnabled;
  }

  // ── Interface methods — stubs (filled by downstream plans) ───────────────

  /**
   * Start the STT/TTS session (VAD init, audio context setup).
   * Implemented in Plan 04.
   */
  async connect(): Promise<void> {
    throw new Error("not implemented: connect — Plan 04");
  }

  /**
   * Stop the session and release all resources.
   * Implemented in Plan 04.
   */
  async disconnect(): Promise<void> {
    throw new Error("not implemented: disconnect — Plan 04");
  }

  /**
   * Send a text message and get a TTS response.
   * Implemented in Plan 04.
   */
  async sendMessage(_text: string): Promise<void> {
    throw new Error("not implemented: sendMessage — Plan 04");
  }

  /**
   * Interrupt the current TTS playback.
   * Implemented in Plan 04.
   */
  interrupt(): void {
    throw new Error("not implemented: interrupt — Plan 04");
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Update chatStatus and fire onChatStatusChange only when the value changes.
   * Mirrors setChatStatus in OpenAIRealtimeProvider.
   */
  protected setChatStatus(status: ChatStatus): void {
    if (this.chatStatus !== status) {
      this.chatStatus = status;
      this.onChatStatusChange?.(status);
    }
  }

  /**
   * Trim the internal messages buffer to prevent unbounded growth.
   *
   * Strategy (RESEARCH Pitfall 5):
   * - The system message (index 0) is ALWAYS preserved.
   * - Only the last `maxTurns * 2` non-system messages are kept (each turn =
   *   one user message + one assistant message).
   *
   * With maxTurns = 10 the buffer holds at most 21 entries (1 system + 20 turn messages).
   */
  protected trimHistory(maxTurns = 10): void {
    const systemMessages = this.messages.filter((m) => m.role === "system");
    const nonSystem = this.messages.filter((m) => m.role !== "system");

    const maxNonSystem = maxTurns * 2;
    const trimmed = nonSystem.slice(-maxNonSystem);

    this.messages = [...systemMessages, ...trimmed];
  }
}
