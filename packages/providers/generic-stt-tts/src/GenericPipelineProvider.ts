/**
 * Generic Pipeline Provider for Khavee AI SDK
 *
 * Composes any combination of the Phase 1 vendor-neutral pipeline-stage
 * interfaces (VADProvider, STTProvider, LLMProvider, TTSProvider) plus
 * plain-object Tools into a single RealtimeProvider implementation
 * (D-07 naming). Structurally a port of OpenAISTTTTSProvider with the four
 * concrete OpenAI-specific helper classes swapped for the four Phase 1
 * interfaces, the `_isTurnActive` drop-guard replaced by full-interruption
 * abort-and-restart (D-03), and a bounded multi-round tool-calling loop
 * inserted (D-04/D-05).
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
  RealtimeMessage,
  ToolExecutor,
  VADProvider,
  STTProvider,
  LLMProvider,
  TTSProvider,
  Tool,
} from "@khaveeai/core";

/** Maximum tool-calling rounds before the loop is treated as an error (D-05). */
const MAX_TOOL_ROUNDS = 5;

/**
 * Configuration for the generic composable pipeline provider.
 *
 * Tool-calling tools are declared as `pipelineTools?: Tool[]` — NOT as a
 * narrowing of the inherited `RealtimeConfig.tools?: RealtimeTool[]` field.
 * `Tool` (top-level `parameters.required?: string[]`) and `RealtimeTool`
 * (per-property `parameters[key].required?: boolean`) are NOT structurally
 * identical (confirmed by tsc rejecting the narrowing: "Property 'type' is
 * incompatible with index signature" when `tools?: Tool[]` was attempted
 * here) — per the plan's documented fallback, this field is renamed to
 * `pipelineTools` and the inherited `tools?: RealtimeTool[]` field is left
 * unused on this config type.
 */
export interface GenericPipelineConfig extends RealtimeConfig {
  /** Voice Activity Detection stage implementation. */
  vad: VADProvider;
  /** Speech-to-Text stage implementation. */
  stt: STTProvider;
  /** LLM completion stage implementation (with tool-calling support). */
  llm: LLMProvider;
  /** Text-to-Speech stage implementation. */
  tts: TTSProvider;
  /** Plain-object tools the LLM may invoke (CORE-03). Renamed from `tools` — see interface doc comment for why this does not narrow RealtimeConfig.tools. */
  pipelineTools?: Tool[];
  /** VAD-to-mic-reopen cooldown (ms) after TTS playback ends. Default: 500 (D-08). */
  micReopenCooldownMs?: number;
}

/** Shape of a chat message stored in the internal history buffer. */
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * GenericPipelineProvider — the single composable orchestrator that takes
 * {vad, stt, llm, tts, tools?} and implements RealtimeProvider, proving any
 * combination of Phase 1's interfaces composes into a working voice
 * pipeline with no @khaveeai/react changes needed (ORCH-01/ORCH-02).
 */
export class GenericPipelineProvider implements RealtimeProvider {
  readonly name = "generic-pipeline";

  // ── Private state ────────────────────────────────────────────────────────

  protected config: GenericPipelineConfig;
  private toolExecutor: ToolExecutor;
  private sessionId: string | null = null;

  /** Internal chat history buffer (system + turns). */
  protected messages: ChatMessage[] = [];

  // Audio output nodes for lip-sync / volume analysis
  private audioOutputContext: AudioContext | null = null;
  private audioOutputAnalyser: AnalyserNode | null = null;

  // Composed pipeline-stage implementations (injected via constructor)
  private vad: VADProvider;
  private stt: STTProvider;
  private llm: LLMProvider;
  private tts: TTSProvider;

  // Microphone state
  private micEnabled = false;

  // Full-interruption barge-in (D-03): replaces _isTurnActive's drop guard.
  // A non-null controller means a turn is active; a NEW utterance aborts it
  // (does NOT drop) and immediately starts its own turn.
  private activeTurnController: AbortController | null = null;

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

  constructor(config: GenericPipelineConfig) {
    this.config = { micReopenCooldownMs: 500, ...config };

    this.vad = config.vad;
    this.stt = config.stt;
    this.llm = config.llm;
    this.tts = config.tts;

    this.toolExecutor = new ToolExecutor();
    config.pipelineTools?.forEach((tool) => this.toolExecutor.register(tool.name, tool.execute));

    // Seed conversation history with the system prompt when provided
    if (this.config.instructions) {
      this.messages.push({ role: "system", content: this.config.instructions });
    }
  }

  // ── Interface methods — real bodies ──────────────────────────────────────

  /**
   * Register a function/tool for function-calling post-construction.
   * RealtimeTool.execute and Tool.execute share the same
   * `(args) => Promise<{success, message}>` shape, so this is a direct
   * registration onto the same ToolExecutor used by config.pipelineTools.
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
  toggleMicrophone(): boolean {
    if (this.micEnabled) {
      this.disableMicrophone();
      return false;
    } else {
      this.enableMicrophone();
      return true;
    }
  }

  /** Enable the microphone. */
  enableMicrophone(): void {
    void this.vad.resume();
    this.micEnabled = true;
  }

  /** Disable the microphone. */
  disableMicrophone(): void {
    void this.vad.pause();
    this.micEnabled = false;
  }

  /** Return whether the microphone is currently enabled. */
  isMicrophoneEnabled(): boolean {
    return this.micEnabled;
  }

  /**
   * Return the current session ID generated at connect() time.
   * Concrete-class-only method — NOT on the RealtimeProvider interface,
   * mirroring OpenAISTTTTSProvider.getSessionId().
   */
  public getSessionId(): string | null {
    return this.sessionId;
  }

  // ── Lifecycle methods ────────────────────────────────────────────────────

  /**
   * Start the pipeline session.
   *
   * Lifecycle:
   *   1. Set status "starting"
   *   2. Generate a fresh session ID (crypto.randomUUID)
   *   3. Create a FRESH AudioContext (never reused — RESEARCH Pitfall 1/5)
   *   4. Wire VADProvider callbacks and start VAD
   *   5. Set status "ready" and fire onConnect
   *
   * On any error: fires onError (normalized to Error), sets status
   * "stopped", then calls disconnect().
   */
  async connect(): Promise<void> {
    try {
      this.setChatStatus("starting");

      // Generate a new session ID per connect (mirrors T-03-10 audit trail)
      this.sessionId = crypto.randomUUID();

      // Create a FRESH AudioContext every connect — never reuse across
      // reconnects (RESEARCH Pitfall 1/5). Closed by disconnect() when
      // state !== "closed".
      this.audioOutputContext = new AudioContext();

      // Wire VADProvider callbacks
      this.vad.onSpeechStart = () => {
        // Only switch to "listening" when idle and the mic is intentionally on.
        if (!this.activeTurnController && this.micEnabled) {
          this.setChatStatus("listening");
        }
      };

      this.vad.onUtteranceReady = (wav: Blob) => {
        // Discard buffered audio captured while the mic was disabled
        // (e.g. pressed the mute button, TTS playing, cooldown window).
        if (this.micEnabled) {
          void this.runTurn(wav);
        }
      };

      this.vad.onError = (error: Error) => {
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
        this.setChatStatus("ready");
      };

      await this.vad.connect();

      this.isConnected = true;
      this.micEnabled = true;
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
   * Teardown order mirrors OpenAISTTTTSProvider:
   *   1. Mark disconnected
   *   2. Abort any active turn (TTSProvider has no cancel() of its own —
   *      cancellation is solely via the per-turn AbortSignal)
   *   3. Tear down VADProvider (mic + listening state)
   *   4. Close AudioContext if not already closed (RESEARCH Pitfall 1/5)
   *   5. Reset all state fields
   *   6. Fire onDisconnect
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;

    // Abort any in-flight turn synchronously — TTSProvider/LLMProvider have
    // no cancel() of their own; cancellation is solely via the signal.
    this.activeTurnController?.abort();
    this.activeTurnController = null;

    // Tear down the VAD provider
    await this.vad.disconnect();

    // Close AudioContext only if it has not already been closed (Pitfall 1/5)
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
   * Interrupt the current turn (LLM/TTS work in flight).
   *
   * Synchronous — no await before setChatStatus so the status resets within
   * one frame, mirroring OpenAISTTTTSProvider.interrupt()'s SDK-08 pattern.
   */
  interrupt(): void {
    this.activeTurnController?.abort();
    this.setChatStatus("ready");
  }

  /**
   * Send a text message (skips STT — text is already known) and play the
   * TTS response. CR-02: owns the active turn controller exactly like
   * runTurn() — aborts any in-flight turn, registers a fresh controller for
   * this turn, and supersedes/is-superseded-by a concurrently-arriving
   * VAD-driven turn instead of racing it uncoordinated.
   */
  async sendMessage(text: string): Promise<void> {
    if (this.activeTurnController) {
      this.activeTurnController.abort();
    }
    const controller = new AbortController();
    this.activeTurnController = controller;
    try {
      await this.runTurnFromText(text, controller.signal);
    } finally {
      if (this.activeTurnController === controller) {
        this.activeTurnController = null;
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Full turn pipeline driven by a WAV blob from the VAD.
   *
   * Full-interruption barge-in (D-03): unlike OpenAISTTTTSProvider's
   * `_isTurnActive` guard (which DROPS new utterances arriving mid-turn —
   * `if (this._isTurnActive) return;`), this aborts the active turn's
   * controller AND immediately starts a new turn with the utterance that
   * triggered the barge-in. Do NOT early-return on the active-turn branch.
   */
  private async runTurn(wav: Blob): Promise<void> {
    if (this.activeTurnController) {
      this.activeTurnController.abort();
      // Do NOT return here — D-03 requires immediately starting the NEW
      // turn, contrasting with OpenAISTTTTSProvider's drop-and-return guard.
    }
    const controller = new AbortController();
    this.activeTurnController = controller;
    try {
      this.setChatStatus("thinking");

      const sttResult = await this.stt.transcribe(wav, { language: this.config.language });

      // Ignore empty/whitespace-only or vendor-rejected utterances.
      if (!sttResult.text || !sttResult.text.trim() || sttResult.rejected) {
        if (controller.signal.aborted) return; // superseded — discard quietly
        this.setChatStatus("ready");
        return;
      }

      // CR-01: re-check the signal after stt.transcribe() resolves — a turn
      // aborted while its STT call was in flight must not proceed into
      // runTurnFromText (mirrors the empty-text guard above).
      if (controller.signal.aborted) return;

      await this.runTurnFromText(sttResult.text, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return; // superseded by barge-in — not a real error (D-02/D-03)
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.setChatStatus("ready");
    } finally {
      if (this.activeTurnController === controller) {
        this.activeTurnController = null;
      }
    }
  }

  /**
   * Turn pipeline from a known text string: append user message → bounded
   * multi-round tool-calling loop (D-04/D-05) → append assistant message →
   * TTS playback → mic reopen with cooldown → ready.
   *
   * Shared by runTurn() (VAD path) and sendMessage() (text path). The
   * `signal` parameter threads the active turn's AbortController.signal
   * into both llm.complete() and tts.speak() (D-01) so barge-in can cancel
   * in-flight work. Every await boundary that precedes a side effect is
   * guarded by `signal?.aborted` to discard superseded results (Pitfall 3).
   */
  private async runTurnFromText(text: string, signal?: AbortSignal): Promise<void> {
    // CR-01: a turn superseded before its first side effect must be
    // discarded immediately — keeps the single-active-turn invariant by
    // guaranteeing zero mutation of this.messages/this.conversation for an
    // already-aborted signal.
    if (signal?.aborted) return;
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

      // 2. Bounded multi-round tool-calling loop (D-04/D-05).
      let round = 0;
      let result: { text?: string; toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> };
      while (true) {
        result = await this.llm.complete({
          messages: this.messages,
          tools: this.config.pipelineTools,
          signal,
        });

        if (signal?.aborted) return; // superseded — discard before any side effect

        if (result.toolCalls.length === 0) break; // final text reply (D-04 terminal condition)

        round++;
        if (round > MAX_TOOL_ROUNDS) {
          throw new Error(`Tool-calling loop exceeded ${MAX_TOOL_ROUNDS} rounds`); // D-05 error path
        }

        for (const call of result.toolCalls) {
          const toolResult = await this.toolExecutor.execute(call.name, call.args);
          if (signal?.aborted) return; // superseded — discard before any side effect
          this.onToolCall?.(call.name, call.args, toolResult);
          // Phase-2-local tool-result-to-history round-trip convention
          // (resolves RESEARCH Open Question 2): the vendor-neutral
          // LLMProvider.complete() messages type has no role:"tool" member
          // by design (CORE-06). Encode the result as a role:"user" message
          // marked with `[tool_result id=<id> name=<name>]`; OpenAILLMAdapter
          // parses this exact marker back into OpenAI's
          // {role:"tool", tool_call_id, content} wire shape.
          this.messages.push({
            role: "user",
            content: `[tool_result id=${call.id} name=${call.name}] ${toolResult.message}`,
          });
        }
      }

      if (signal?.aborted) return; // superseded — discard before any side effect

      // 3. Append assistant message to history and conversation
      const replyText = result.text ?? "";
      this.messages.push({ role: "assistant", content: replyText });
      const assistantEntry: Conversation = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: replyText,
        timestamp: new Date().toISOString(),
        isFinal: true,
        status: "final",
      };
      this.conversation.push(assistantEntry);
      this.onConversationUpdate?.(this.conversation);

      // 4. Trim history to prevent unbounded growth
      this.trimHistory();

      // 5. TTS playback — await mic pause so VAD is fully stopped before audio plays
      await this.vad.pause();
      this.micEnabled = false;
      let speakingStatusSet = false;
      await this.tts.speak(replyText, {
        audioContext: this.audioOutputContext ?? new AudioContext(),
        voice: this.config.voice,
        speed: this.config.speed,
        signal,
        onAudioData: (analyser: AnalyserNode, ctx: AudioContext) => {
          // Set "speaking" only when audio actually starts, not when text is ready
          if (!speakingStatusSet) {
            speakingStatusSet = true;
            this.setChatStatus("speaking");
          }
          this.audioOutputAnalyser = analyser;
          this.onAudioData?.(analyser, ctx);
        },
      });

      if (signal?.aborted) return; // superseded — discard before any side effect

      // 6. Resume VAD after the config-driven cooldown (D-08, ORCH-04) then ready.
      await this.resumeWithCooldown();
      this.setChatStatus("ready");
    } catch (error) {
      if (signal?.aborted) return; // superseded by barge-in — not a real error (D-02/D-03)
      await this.resumeWithCooldown();
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.setChatStatus("ready");
    }
  }

  /**
   * Resume the VAD and wait out the configured mic-reopen cooldown
   * (D-08, ORCH-04) before the caller proceeds. Config-driven — the
   * cooldown is never hardcoded; `500` appears only as the in-method
   * fallback default mirroring the constructor's own default.
   */
  private async resumeWithCooldown(): Promise<void> {
    await this.vad.resume();
    this.micEnabled = true;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, this.config.micReopenCooldownMs ?? 500)
    );
  }

  /**
   * Update chatStatus and fire onChatStatusChange only when the value changes.
   * Mirrors setChatStatus in OpenAISTTTTSProvider/OpenAIRealtimeProvider.
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
   * Strategy (ported verbatim from OpenAISTTTTSProvider):
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
