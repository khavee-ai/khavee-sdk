/**
 * xAI Realtime Provider for Khavee AI SDK
 *
 * Implements the RealtimeProvider interface over xAI's WebSocket-based
 * Realtime API (Grok voice). Audio is sent/received as base64-encoded PCM
 * in JSON messages, unlike OpenAI's WebRTC approach. The AnalyserNode is
 * configured identically (fftSize=2048, smoothingTimeConstant=0.6) so the
 * React layer's MFCC/DTW phoneme detection drives lip-sync identically.
 */

import {
  RealtimeProvider,
  RealtimeConnectOptions,
  RealtimeTool,
  UsageReport,
  Conversation,
  ChatStatus,
  RealtimeMessage,
  ToolExecutor,
  MouthState,
  PhonemeData,
} from "@khaveeai/core";
import { XAIRealtimeConfig, XAIServerEvent } from "./types";
import { AudioPlaybackEngine } from "./AudioPlaybackEngine";
import { MicCaptureEngine } from "./MicCaptureEngine";

// ── XAIRealtimeProvider ──────────────────────────────────────────────────────

export class XAIRealtimeProvider implements RealtimeProvider {
  // ── Configuration ──────────────────────────────────────────────────────────

  private config: XAIRealtimeConfig;

  // ── Connection State ───────────────────────────────────────────────────────

  private ws: WebSocket | null = null;
  private playbackEngine: AudioPlaybackEngine | null = null;
  private micEngine: MicCaptureEngine | null = null;
  private toolExecutor: ToolExecutor;

  // ── Public State (RealtimeProvider interface) ──────────────────────────────

  public isConnected = false;
  public chatStatus: ChatStatus = "stopped";
  public conversation: Conversation[] = [];
  public currentVolume = 0;

  // ── Private State ──────────────────────────────────────────────────────────

  private micEnabled = false;
  private hasEmittedAudioData = false;
  private tools: RealtimeTool[] = [];
  private pendingToolArgs: Map<string, { name: string; args: string }> =
    new Map();

  // ── Event Callbacks (RealtimeEvents interface) ─────────────────────────────

  public onConnect?: () => void;
  public onDisconnect?: () => void;
  public onError?: (error: Error) => void;
  public onMessage?: (message: RealtimeMessage) => void;
  public onConversationUpdate?: (conversation: Conversation[]) => void;
  public onChatStatusChange?: (status: ChatStatus) => void;
  public onAudioStart?: () => void;
  public onAudioEnd?: () => void;
  public onAudioData?: (
    analyser: AnalyserNode,
    audioContext: AudioContext,
  ) => void;
  public onVolumeChange?: (volume: number) => void;
  public onMouthStateChange?: (state: MouthState) => void;
  public onPhonemeDetected?: (phoneme: PhonemeData) => void;
  public onToolCall?: (toolName: string, args: unknown, result: unknown) => void;
  public onUsageReport?: (usage: UsageReport) => void;

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(config: XAIRealtimeConfig) {
    this.config = {
      model: "grok-voice-latest",
      baseUrl: "wss://api.x.ai/v1/realtime",
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      sampleRate: 24000,
      ...config,
    };
    this.toolExecutor = new ToolExecutor();
  }

  // ── Connection Lifecycle ───────────────────────────────────────────────────

  /**
   * Connect to the xAI Realtime API via WebSocket.
   * If tokenEndpoint is configured, fetches an ephemeral token first.
   */
  async connect(options?: RealtimeConnectOptions): Promise<void> {
    try {
      // Resolve authentication token
      let token = this.config.apiKey;
      if (this.config.tokenEndpoint) {
        token = await this.fetchEphemeralToken(this.config.tokenEndpoint);
      }

      // Build WebSocket URL
      const baseUrl = this.config.baseUrl ?? "wss://api.x.ai/v1/realtime";
      const model = this.config.model ?? "grok-voice-latest";
      const url = `${baseUrl}?model=${encodeURIComponent(model)}`;

      // Connect with auth — xAI uses WebSocket subprotocol for ephemeral tokens
      const protocols = token
        ? ["realtime", `openai-insecure-api-key.${token}`]
        : undefined;
      this.ws = new WebSocket(url, protocols);

      await this.waitForOpen(this.ws);

      this.isConnected = true;
      this.setChatStatus("ready");
      this.onConnect?.();

      // Initialize audio engines
      const sampleRate = this.config.sampleRate ?? 24000;
      this.playbackEngine = new AudioPlaybackEngine({ sampleRate });
      this.playbackEngine.onPlaybackStart = () => {
        this.setChatStatus("speaking");
      };
      this.playbackEngine.onPlaybackEnd = () => {
        if (this.chatStatus === "speaking") {
          this.setChatStatus("ready");
        }
      };

      // Initialize mic capture
      this.micEngine = new MicCaptureEngine(sampleRate);
      this.micEngine.onAudioFrame = (base64: string) => {
        this.sendEvent({ type: "input_audio_buffer.append", audio: base64 });
      };
      this.micEngine.onError = (error: Error) => {
        this.onError?.(error);
      };

      // Start mic capture
      try {
        await this.micEngine.initialize();
        await this.micEngine.enable();
        this.micEnabled = true;
      } catch (micError) {
        // Mic permission denied is non-fatal — text input still works
        console.warn("Mic capture initialization failed:", micError);
      }

      // Set up WebSocket message handling
      this.ws.onmessage = (event: MessageEvent) => {
        void this.handleServerEvent(event);
      };
      this.ws.onclose = () => {
        this.handleDisconnect();
      };
      this.ws.onerror = (event: Event) => {
        this.onError?.(
          new Error(`WebSocket error: ${(event as ErrorEvent).message ?? "connection failed"}`),
        );
      };

      // Send session.update with initial configuration
      this.sendSessionUpdate();

      // Handle skipGreeting option
      if (!options?.skipGreeting && this.config.instructions) {
        // Trigger initial greeting
        this.sendEvent({
          type: "response.create",
          response: {
            instructions:
              "This is the very start of the conversation. The user has not spoken or typed anything yet. Deliver your opening greeting now.",
          },
        });
      }
    } catch (error) {
      this.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Disconnect from the xAI Realtime API, release all resources.
   */
  async disconnect(): Promise<void> {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, "Client disconnect");
      }
      this.ws = null;

      this.micEngine?.destroy();
      this.micEngine = null;
      this.micEnabled = false;

      this.playbackEngine?.destroy();
      this.playbackEngine = null;

      this.handleDisconnect();
    } catch (error) {
      this.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  /**
   * Send a text message to the model and trigger a response.
   */
  async sendMessage(text: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.onError?.(new Error("Cannot send message: not connected"));
      return;
    }

    // Create user conversation item
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });

    // Trigger model response
    this.sendEvent({ type: "response.create" });

    // Add to local conversation
    const timestamp = new Date().toISOString();
    const id = this.generateId();
    const userMessage: Conversation = {
      id,
      role: "user",
      text,
      timestamp,
      isFinal: true,
      status: "final",
    };
    this.conversation.push(userMessage);
    this.onConversationUpdate?.(this.conversation);

    // Fire onMessage for user message
    this.onMessage?.({
      id,
      role: "user",
      text,
      timestamp,
      isFinal: true,
      status: "final",
    });

    this.setChatStatus("thinking");
  }

  /**
   * Interrupt the current model response (barge-in).
   */
  interrupt(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Cancel server-side response generation
    this.sendEvent({ type: "response.cancel" });

    // Stop local audio playback immediately
    this.playbackEngine?.cancel();

    this.setChatStatus("ready");
  }

  // ── Function/Tool Registration ─────────────────────────────────────────────

  /**
   * Register a function/tool for the model to call.
   */
  registerFunction(tool: RealtimeTool): void {
    this.tools.push(tool);
    this.toolExecutor.register(tool.name, tool.execute);

    // If already connected, update session with new tool list
    if (this.isConnected) {
      this.sendSessionUpdate();
    }
  }

  // ── Microphone Control ─────────────────────────────────────────────────────

  /**
   * Toggle microphone on/off. Returns the new mic state.
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

  /**
   * Enable microphone capture. Initializes mic if not yet done.
   */
  async enableMicrophone(): Promise<void> {
    if (!this.micEngine) {
      console.warn("No mic engine available — cannot enable microphone");
      return;
    }
    await this.micEngine.enable();
    this.micEnabled = true;
  }

  /**
   * Disable microphone capture (frames stop sending, tracks stay alive).
   */
  disableMicrophone(): void {
    if (!this.micEngine) {
      console.warn("No mic engine available — cannot disable microphone");
      return;
    }
    this.micEngine.disable();
    this.micEnabled = false;
  }

  /**
   * Check if microphone is currently enabled.
   */
  isMicrophoneEnabled(): boolean {
    return this.micEnabled;
  }

  // ── Audio Analysis ─────────────────────────────────────────────────────────

  /**
   * Get the AnalyserNode and AudioContext for lip-sync analysis.
   * Returns null if audio playback has not started.
   *
   * AnalyserNode settings: fftSize=2048, smoothingTimeConstant=0.6
   * (identical to OpenAIRealtimeProvider for MFCC/DTW parity).
   */
  getAudioAnalyser(): {
    analyser: AnalyserNode;
    audioContext: AudioContext;
  } | null {
    return this.playbackEngine?.getAnalyser() ?? null;
  }

  // ── Private: WebSocket Event Handling ──────────────────────────────────────

  /**
   * Route incoming WebSocket events by type.
   */
  private async handleServerEvent(event: MessageEvent): Promise<void> {
    try {
      const data = JSON.parse(event.data as string) as XAIServerEvent;

      switch (data.type) {
        case "session.created":
        case "session.updated":
          // Session confirmed ready — no action needed
          break;

        case "input_audio_buffer.speech_started":
          this.setChatStatus("listening");
          break;

        case "input_audio_buffer.speech_stopped":
          // VAD detected end of speech — keep "listening" until committed
          break;

        case "input_audio_buffer.committed":
          this.setChatStatus("thinking");
          break;

        case "conversation.item.input_audio_transcription.updated":
          // Cumulative transcript update — update the last user message
          this.updateUserTranscript(data.transcript);
          break;

        case "conversation.item.created":
          // New conversation item from server
          if (data.item.role === "assistant") {
            const id = data.item.id;
            const assistantMsg: Conversation = {
              id,
              role: "assistant",
              text: "",
              timestamp: new Date().toISOString(),
              isFinal: false,
            };
            this.conversation.push(assistantMsg);
            this.onConversationUpdate?.(this.conversation);
          }
          break;

        case "response.created":
          this.setChatStatus("thinking");
          break;

        case "response.output_item.added":
        case "response.content_part.added":
          // Structural events — no action needed
          break;

        case "response.text.delta":
          this.handleAssistantTextDelta(data.delta);
          break;

        case "response.text.done":
          this.finalizeAssistantText(data.text);
          break;

        case "response.audio.delta":
        case "response.output_audio.delta":
          // Feed audio chunk to playback engine
          this.playbackEngine?.appendChunk(data.delta);
          this.emitAudioDataOnce();
          break;

        case "response.audio.done":
        case "response.output_audio.done":
          // Audio stream complete — playbackEngine.onPlaybackEnd handles status
          break;

        case "response.audio_transcript.delta":
          this.handleAssistantTextDelta(data.delta);
          break;

        case "response.audio_transcript.done":
          this.finalizeAssistantText(data.transcript);
          break;

        case "response.function_call_arguments.delta":
          this.accumulateToolArgs(data.call_id, data.delta, data.item_id);
          break;

        case "response.function_call_arguments.done":
          await this.executeToolCall(data.call_id, data.name, data.arguments);
          break;

        case "response.done":
          this.handleResponseDone(data.response);
          break;

        case "error":
          this.onError?.(new Error(data.error.message));
          break;

        default:
          // Unknown event — silently ignore
          break;
      }
    } catch (error) {
      this.onError?.(
        error instanceof Error
          ? error
          : new Error(`Error handling server event: ${String(error)}`),
      );
    }
  }

  // ── Private: Chat Status Management ────────────────────────────────────────

  /**
   * Update chatStatus and fire relevant callbacks.
   * Manages audio start/end lifecycle events.
   */
  private setChatStatus(status: ChatStatus): void {
    if (this.chatStatus === status) return;

    const prevStatus = this.chatStatus;
    this.chatStatus = status;
    this.onChatStatusChange?.(status);

    // Fire audio lifecycle events on transitions
    if (status === "speaking" && prevStatus !== "speaking") {
      this.onAudioStart?.();
    }
    if (prevStatus === "speaking" && status !== "speaking") {
      this.onAudioEnd?.();
    }
  }

  /**
   * Fire onAudioData exactly ONCE when first audio chunk arrives.
   * Identical timing to OpenAIRealtimeProvider's ontrack handler.
   */
  private emitAudioDataOnce(): void {
    if (this.hasEmittedAudioData) return;
    const analyserData = this.playbackEngine?.getAnalyser();
    if (analyserData) {
      this.hasEmittedAudioData = true;
      this.onAudioData?.(analyserData.analyser, analyserData.audioContext);
    }
  }

  // ── Private: Conversation State ────────────────────────────────────────────

  /**
   * Append text delta to the last assistant message.
   */
  private handleAssistantTextDelta(delta: string): void {
    const lastMsg = this.conversation[this.conversation.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && !lastMsg.isFinal) {
      lastMsg.text += delta;
    } else {
      // Create new assistant message if none is pending
      const newMsg: Conversation = {
        id: this.generateId(),
        role: "assistant",
        text: delta,
        timestamp: new Date().toISOString(),
        isFinal: false,
      };
      this.conversation.push(newMsg);
    }
    this.onConversationUpdate?.(this.conversation);
  }

  /**
   * Finalize the last assistant message with complete text.
   */
  private finalizeAssistantText(text: string): void {
    const lastMsg = this.conversation[this.conversation.length - 1];
    if (lastMsg && lastMsg.role === "assistant") {
      lastMsg.text = text;
      lastMsg.isFinal = true;
      lastMsg.status = "final";
    }
    this.onConversationUpdate?.(this.conversation);

    // Fire onMessage with the final assistant text
    if (lastMsg) {
      this.onMessage?.({
        id: lastMsg.id,
        role: "assistant",
        text,
        timestamp: lastMsg.timestamp,
        isFinal: true,
        status: "final",
      });
    }
  }

  /**
   * Update the user transcript from cumulative transcription events.
   */
  private updateUserTranscript(transcript: string): void {
    // Find the last user message and update its text
    for (let i = this.conversation.length - 1; i >= 0; i--) {
      if (this.conversation[i].role === "user" && !this.conversation[i].isFinal) {
        this.conversation[i].text = transcript;
        this.onConversationUpdate?.(this.conversation);
        return;
      }
    }
    // If no pending user message, create one
    const userMsg: Conversation = {
      id: this.generateId(),
      role: "user",
      text: transcript,
      timestamp: new Date().toISOString(),
      isFinal: false,
      status: "speaking",
    };
    this.conversation.push(userMsg);
    this.onConversationUpdate?.(this.conversation);
  }

  // ── Private: Tool Calling ──────────────────────────────────────────────────

  /**
   * Accumulate function call argument deltas.
   */
  private accumulateToolArgs(
    callId: string,
    delta: string,
    _itemId: string,
  ): void {
    const existing = this.pendingToolArgs.get(callId);
    if (existing) {
      existing.args += delta;
    } else {
      this.pendingToolArgs.set(callId, { name: "", args: delta });
    }
  }

  /**
   * Execute a tool call and send the result back to the model.
   */
  private async executeToolCall(
    callId: string,
    name: string,
    argsJson: string,
  ): Promise<void> {
    this.setChatStatus("thinking");

    try {
      const args = JSON.parse(argsJson);
      const result = await this.toolExecutor.execute(name, args);

      this.onToolCall?.(name, args, result);

      // Send function call output back to the model
      this.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result),
        },
      });

      // Trigger model to continue generating
      this.sendEvent({ type: "response.create" });
    } catch (error) {
      console.error("Tool execution error:", error);
      this.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      this.pendingToolArgs.delete(callId);
    }
  }

  // ── Private: Response Done ─────────────────────────────────────────────────

  /**
   * Handle response.done — finalize state and report usage.
   */
  private handleResponseDone(response: {
    id: string;
    usage?: {
      input_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
        cached_tokens?: number;
      };
      output_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
      };
    };
  }): void {
    // Report usage if available
    if (response.usage && this.onUsageReport) {
      const u = response.usage;
      this.onUsageReport({
        sessionId: response.id,
        inputTextTokens: u.input_token_details?.text_tokens ?? 0,
        inputAudioTokens: u.input_token_details?.audio_tokens ?? 0,
        inputCachedTokens: u.input_token_details?.cached_tokens ?? 0,
        outputTextTokens: u.output_token_details?.text_tokens ?? 0,
        outputAudioTokens: u.output_token_details?.audio_tokens ?? 0,
      });
    }

    // If playback is not actively playing, set ready
    if (!this.playbackEngine?.isPlaying) {
      this.setChatStatus("ready");
    }
  }

  // ── Private: Session Management ────────────────────────────────────────────

  /**
   * Send a session.update event with the full current configuration.
   */
  private sendSessionUpdate(): void {
    const session: Record<string, unknown> = {
      modalities: ["text", "audio"],
      input_audio_format: this.config.inputAudioFormat ?? "pcm16",
      output_audio_format: this.config.outputAudioFormat ?? "pcm16",
    };

    if (this.config.voice) {
      session.voice = this.config.voice;
    }
    if (this.config.instructions) {
      session.instructions = this.config.instructions;
    }
    if (this.config.temperature !== undefined) {
      session.temperature = this.config.temperature;
    }
    if (this.config.turnDetection) {
      session.turn_detection = this.config.turnDetection;
    } else {
      // Default server VAD
      session.turn_detection = { type: "server_vad" };
    }

    // Include registered tools
    if (this.tools.length > 0) {
      session.tools = this.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters,
          required: Object.entries(tool.parameters)
            .filter(([, v]) => v.required)
            .map(([k]) => k),
        },
      }));
    }

    // Tool choice
    if (this.config.toolChoice) {
      session.tool_choice = this.config.toolChoice;
    }

    this.sendEvent({ type: "session.update", session });
  }

  // ── Private: WebSocket Utilities ───────────────────────────────────────────

  /**
   * Send a client event over WebSocket.
   */
  private sendEvent(event: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  /**
   * Wait for a WebSocket to reach OPEN state.
   */
  private waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener(
        "error",
        (event) =>
          reject(
            new Error(
              `WebSocket connection failed: ${(event as ErrorEvent).message ?? "unknown error"}`,
            ),
          ),
        { once: true },
      );
    });
  }

  /**
   * Handle WebSocket disconnect (intentional or unintentional).
   */
  private handleDisconnect(): void {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.setChatStatus("stopped");
    this.onDisconnect?.();
  }

  /**
   * Fetch an ephemeral token from the configured backend endpoint.
   */
  private async fetchEphemeralToken(endpoint: string): Promise<string> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `Token endpoint returned ${response.status}: ${await response.text()}`,
      );
    }

    const data = (await response.json()) as {
      client_secret?: { value?: string };
      data?: { ephemeralToken?: string; value?: string };
    };

    // Support multiple response shapes
    const token =
      data.client_secret?.value ??
      data.data?.ephemeralToken ??
      data.data?.value;

    if (!token) {
      throw new Error("Token endpoint did not return a valid token");
    }
    return token;
  }

  /**
   * Generate a random ID for conversation items.
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
