/**
 * OpenAI STT/TTS Pipeline Provider for Khavee AI SDK
 *
 * Uses VAD + Whisper STT + Chat Completions + OpenAI TTS through backend proxies.
 * Implements RealtimeProvider from @khaveeai/core.
 */

import {
  RealtimeProvider,
  RealtimeConfig,
  RealtimeConnectOptions,
  RealtimeTool,
  UsageReport,
  Conversation,
  ChatStatus,
  MouthState,
  PhonemeData,
} from "@khaveeai/core";
import { RealtimeMessage } from "@khaveeai/core";
import { ToolExecutor } from "@khaveeai/core";
import { AudioRecorder } from "./AudioRecorder";
import { STTClient } from "./STTClient";
import { ChatClient } from "./ChatClient";
import { TTSPlayer } from "./TTSPlayer";

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
  /** Style/tone instructions for the TTS voice (gpt-4o-mini-tts supports this). */
  ttsInstructions?: string;
}

/** Shape of a chat message stored in the internal history buffer. */
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Optional dependency injection seam for unit testing. */
type ProviderDeps = {
  audioRecorder?: AudioRecorder;
  sttClient?: STTClient;
  chatClient?: ChatClient;
  ttsPlayer?: TTSPlayer;
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

  // Helper instances (injectable for testing)
  private audioRecorder: AudioRecorder;
  private sttClient: STTClient;
  private chatClient: ChatClient;
  private ttsPlayer: TTSPlayer;

  // Microphone state
  private micEnabled = false;

  // Prevents concurrent runTurn invocations from VAD double-fire
  private _isTurnActive = false;

  // Resolves when the configured greeting has finished playing (or was
  // cancelled). Non-null only while a greeting is in flight after connect().
  protected greetingInFlight: Promise<void> | null = null;

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

  constructor(config: OpenAISTTTTSConfig, deps?: ProviderDeps) {
    this.config = {
      sttModel: "gpt-4o-mini-transcribe",
      ttsModel: "gpt-4o-mini-tts",
      voice: "alloy",
      speed: 1.0,
      ...config,
    };

    this.toolExecutor = new ToolExecutor();

    // Dependency injection seam — use provided instances when testing,
    // otherwise create real ones.
    this.audioRecorder = deps?.audioRecorder ?? new AudioRecorder();
    this.sttClient = deps?.sttClient ?? new STTClient();
    this.chatClient = deps?.chatClient ?? new ChatClient();
    this.ttsPlayer = deps?.ttsPlayer ?? new TTSPlayer();

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
   */
  async toggleMicrophone(): Promise<boolean> {
    if (this.micEnabled) {
      this.disableMicrophone();
      return false;
    } else {
      await this.enableMicrophone();
      return true;
    }
  }

  /** Enable the microphone. */
  async enableMicrophone(): Promise<void> {
    await this.audioRecorder.resume();
    this.micEnabled = true;
  }

  /** Disable the microphone. */
  disableMicrophone(): void {
    void this.audioRecorder.pause();
    this.micEnabled = false;
  }

  /** Return whether the microphone is currently enabled. */
  isMicrophoneEnabled(): boolean {
    return this.micEnabled;
  }

  /**
   * Return the current session ID generated at connect() time.
   * This is a concrete-class-only method — NOT on the RealtimeProvider interface
   * (RESEARCH Pitfall 6). The web app retrieves it before casting to the interface.
   */
  public getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Resolve the bearer token to use for proxy calls.
   *
   * For direct SDK development: returns config.apiKey (fallback "").
   * When useProxy is true, Phase 5 will override this to return a JWT
   * obtained from the backend. Made `protected` so test subclasses can
   * call it without an `any` cast.
   */
  protected resolveAuthToken(): string {
    return this.config.apiKey ?? "";
  }

  // ── Lifecycle methods ────────────────────────────────────────────────────

  /**
   * Start the STT/TTS session.
   *
   * Lifecycle:
   *   1. Set status "starting"
   *   2. Generate a fresh session ID (crypto.randomUUID)
   *   3. Create a FRESH AudioContext (never reused — RESEARCH Pitfall 1)
   *   4. Wire AudioRecorder callbacks and start VAD
   *   5. Set status "ready" and fire onConnect
   *
   * On any error: fires onError, sets status "stopped", then calls disconnect().
   */
  async connect(options?: RealtimeConnectOptions): Promise<void> {
    try {
      this.setChatStatus("starting");

      // Generate a new session ID per connect (T-03-10 audit trail)
      this.sessionId = crypto.randomUUID();

      // Create a FRESH AudioContext every connect — never reuse across reconnects
      // (RESEARCH Pitfall 1). Closed by disconnect() when state !== "closed".
      this.audioOutputContext = new AudioContext();

      // Wire AudioRecorder VAD callbacks
      this.audioRecorder.onSpeechStart = () => {
        // Only switch to "listening" when idle and the mic is intentionally on.
        if (!this._isTurnActive && this.micEnabled) {
          this.setChatStatus("listening");
        }
      };

      this.audioRecorder.onUtteranceReady = (wav: Blob) => {
        // Discard buffered audio captured while the mic was disabled
        // (e.g. pressed the mute button, TTS playing, cooldown window).
        if (this.micEnabled) {
          void this.runTurn(wav);
        }
      };

      this.audioRecorder.onError = (error: Error) => {
        this.onError?.(error);
        this.setChatStatus("ready");
      };

      // Start VAD with the relevant config fields
      await this.audioRecorder.connect({
        baseAssetPath: this.config.baseAssetPath,
        onnxWASMBasePath: this.config.onnxWASMBasePath,
        silenceThresholdMs: this.config.silenceThresholdMs,
        positiveSpeechThreshold: this.config.positiveSpeechThreshold,
        negativeSpeechThreshold: this.config.negativeSpeechThreshold,
      });

      this.isConnected = true;
      // On a silent reconnect (idle-session reset, skipGreeting=true),
      // restore the mic to exactly what it was before disconnect() tore it
      // down instead of always turning it on — found live: idle reset
      // always re-enabled a mic the visitor had deliberately muted.
      // `this.micEnabled` survives disconnect() untouched specifically so
      // this read reflects the pre-reconnect state. audioRecorder.connect()
      // above always starts the VAD actively listening, so restoring
      // "disabled" needs an explicit pause() here too — mirroring what
      // disableMicrophone() itself does — not just the flag.
      const shouldEnableMic = options?.skipGreeting ? this.micEnabled : true;
      if (!shouldEnableMic) {
        await this.audioRecorder.pause();
      }
      this.micEnabled = shouldEnableMic;

      const greeting = this.config.greeting?.trim();
      if (greeting && !options?.skipGreeting) {
        // Speak the fixed greeting as the first assistant turn. Not awaited:
        // connect() resolves once the session is usable, matching the realtime
        // providers where the greeting streams after connect() returns.
        // chatStatus stays "starting" until audio begins ("speaking"), then
        // settles to "ready" when playback ends.
        this.onConnect?.();
        this.greetingInFlight = this.runGreeting(greeting).finally(() => {
          this.greetingInFlight = null;
        });
        return;
      }

      this.setChatStatus("ready");
      this.onConnect?.();
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.setChatStatus("stopped");
      await this.disconnect();
    }
  }

  /**
   * Stop the session and release all resources.
   *
   * Teardown order mirrors OpenAIRealtimeProvider:
   *   1. Mark disconnected
   *   2. Cancel any in-flight TTS
   *   3. Tear down AudioRecorder (VAD + mic)
   *   4. Close AudioContext if not already closed (RESEARCH Pitfall 1 — the
   *      @khaveeai/react RealtimeAudioAnalyzer.stop() may have closed it already;
   *      closing a closed context throws an error)
   *   5. Reset all state fields
   *   6. Fire onDisconnect
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;

    // Stop any TTS playback synchronously
    this.ttsPlayer.cancel();

    // Tear down the VAD recorder
    await this.audioRecorder.disconnect();

    // Close AudioContext only if it has not already been closed (Pitfall 1)
    if (this.audioOutputContext && this.audioOutputContext.state !== "closed") {
      await this.audioOutputContext.close();
    }
    this.audioOutputContext = null;
    this.audioOutputAnalyser = null;

    // Reset all session-scoped state
    this.sessionId = null;
    this.micEnabled = false;
    this.currentVolume = 0;

    // Reset conversation and message history back to just the system prompt
    this.conversation = [];
    const systemMessage = this.messages.find((m) => m.role === "system");
    this.messages = systemMessage ? [systemMessage] : [];

    this.setChatStatus("stopped");
    this.onDisconnect?.();
  }

  /**
   * Interrupt the current TTS playback.
   *
   * Synchronous per RESEARCH Pattern 8 — no await before setChatStatus so the
   * status resets within one frame (SDK-08).
   */
  interrupt(): void {
    this.ttsPlayer.cancel();
    this.setChatStatus("ready");
  }

  /**
   * Send a text message (skips STT — text is already known) and play TTS response.
   */
  async sendMessage(text: string): Promise<void> {
    // A typed message during the greeting cuts it short (the realtime
    // providers likewise interrupt a speaking bot) and waits for the mic /
    // status restore before the turn runs, so the two never overlap.
    if (this.greetingInFlight) {
      this.ttsPlayer.cancel();
      await this.greetingInFlight;
    }
    await this.runTurnFromText(text);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** TTS request options shared by normal turns and the greeting. */
  private buildSpeakConfig() {
    return {
      endpoint: this.config.ttsProxyEndpoint ?? "",
      authToken: this.resolveAuthToken(),
      voice: this.config.voice ?? "alloy",
      speed: this.config.speed ?? 1.0,
      model: this.config.ttsModel ?? "gpt-4o-mini-tts",
      instructions: this.config.ttsInstructions,
    };
  }

  /**
   * Speak the configured greeting as the assistant's first turn.
   *
   * The mic stays paused for the whole playback (the VAD must not hear the
   * bot), the greeting is recorded in `messages` so later Chat Completions
   * calls know it was already said, and `disconnect()` mid-greeting wins:
   * it cancels TTS, tears the VAD down and sets "stopped" — nothing here may
   * resurrect the mic or the status after that, hence the isConnected guards.
   * No Chat Completions call is made, so no usage report fires for it.
   */
  private async runGreeting(text: string): Promise<void> {
    try {
      await this.audioRecorder.pause();
      this.micEnabled = false;

      this.messages.push({ role: "assistant", content: text });
      const greetingEntry: Conversation = {
        id: crypto.randomUUID(),
        role: "assistant",
        text,
        timestamp: new Date().toISOString(),
        isFinal: true,
        status: "final",
      };
      this.conversation.push(greetingEntry);
      this.onConversationUpdate?.(this.conversation);

      let speakingStatusSet = false;
      await this.ttsPlayer.speak(
        text,
        this.buildSpeakConfig(),
        this.audioOutputContext ?? new AudioContext(),
        (analyser: AnalyserNode, ctx: AudioContext) => {
          if (!speakingStatusSet) {
            speakingStatusSet = true;
            this.setChatStatus("speaking");
          }
          this.audioOutputAnalyser = analyser;
          this.onAudioData?.(analyser, ctx);
        },
      );
    } catch (error) {
      // An aborted fetch / closed AudioContext after disconnect() is expected.
      if (this.isConnected) {
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (this.isConnected) {
        // Same post-playback sequence as a normal turn: resume the VAD, then
        // a short cooldown so any TTS echo the mic picks up is discarded.
        await this.audioRecorder.resume();
        this.micEnabled = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        if (this.isConnected) {
          this.setChatStatus("ready");
        }
      }
    }
  }

  /**
   * Full turn pipeline driven by a WAV blob from the VAD.
   * Transcribes via STT then delegates to runTurnFromText.
   */
  private async runTurn(wav: Blob): Promise<void> {
    if (this._isTurnActive) return;
    this._isTurnActive = true;
    try {
      this.setChatStatus("thinking");

      const transcript = await this.sttClient.transcribe(
        wav,
        this.config.sttProxyEndpoint ?? "",
        this.resolveAuthToken(),
        this.config.language,
      );

      // Ignore empty / whitespace-only utterances
      if (!transcript || !transcript.trim()) {
        this.setChatStatus("ready");
        return;
      }

      await this.runTurnFromText(transcript);
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.setChatStatus("ready");
    } finally {
      this._isTurnActive = false;
    }
  }

  /**
   * Turn pipeline from a known text string: append user message → Chat Completions
   * → usage report → append assistant message → TTS playback → ready.
   *
   * Shared by runTurn() (VAD path) and sendMessage() (text path).
   */
  private async runTurnFromText(text: string): Promise<void> {
    try {
      // 1. Append user message to history and conversation
      this.messages.push({ role: "user", content: text });
      const userEntry: Conversation = {
        id: crypto.randomUUID(),
        role: "user",
        text,
        timestamp: new Date().toISOString(),
        isFinal: true,
        status: "final",
      };
      this.conversation.push(userEntry);
      this.onConversationUpdate?.(this.conversation);

      // 2. Call Chat Completions proxy
      const result = await this.chatClient.complete({
        messages: this.messages,
        endpoint: this.config.chatProxyEndpoint ?? "",
        authToken: this.resolveAuthToken(),
        model: this.config.model,
        temperature: this.config.temperature,
      });

      // 3. Fire usage report with mapped token counts (RESEARCH mapping)
      if (this.onUsageReport) {
        const u = result.usage;
        this.onUsageReport({
          sessionId: this.sessionId ?? "",
          inputTextTokens: u?.prompt_tokens ?? 0,
          inputAudioTokens: 0,
          inputCachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
          outputTextTokens: u?.completion_tokens ?? 0,
          outputAudioTokens: 0,
        });
      }

      // 4. Append assistant message to history and conversation
      this.messages.push({ role: "assistant", content: result.text });
      const assistantEntry: Conversation = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.text,
        timestamp: new Date().toISOString(),
        isFinal: true,
        status: "final",
      };
      this.conversation.push(assistantEntry);
      this.onConversationUpdate?.(this.conversation);

      // 5. Trim history to prevent unbounded growth (T-03-08)
      this.trimHistory();

      // 6. TTS playback — await mic pause so VAD is fully stopped before audio plays
      await this.audioRecorder.pause();
      this.micEnabled = false;
      let speakingStatusSet = false;
      await this.ttsPlayer.speak(
        result.text,
        this.buildSpeakConfig(),
        // Use a fallback AudioContext if somehow called before connect()
        this.audioOutputContext ?? new AudioContext(),
        (analyser: AnalyserNode, ctx: AudioContext) => {
          // Set "speaking" only when audio actually starts, not when text is ready
          if (!speakingStatusSet) {
            speakingStatusSet = true;
            this.setChatStatus("speaking");
          }
          this.audioOutputAnalyser = analyser;
          this.onAudioData?.(analyser, ctx);
        },
      );

      // Resume VAD but keep _isTurnActive=true for a brief cooldown so any
      // TTS echo picked up by the mic after playback ends is discarded.
      // _isTurnActive is cleared by runTurn()'s finally block after this returns.
      await this.audioRecorder.resume();
      this.micEnabled = true;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      this.setChatStatus("ready");
    } catch (error) {
      await this.audioRecorder.resume();
      this.micEnabled = true;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.setChatStatus("ready");
    }
  }

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
