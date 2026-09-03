/**
 * OpenAI Realtime API Provider for Khavee AI SDK
 * Based on your WebRTC implementation
 */

import {
  RealtimeProvider,
  RealtimeConfig,
  RealtimeConnectOptions,
  RealtimeTool,
  UsageReport,
  Conversation,
  ChatStatus,
  ToolExecutor,
  buildColdOpenPrompt,
} from "@khaveeai/core";
import { v4 as uuidv4 } from "uuid";

type ProxyTokenResponse = {
  data?: {
    ephemeralToken?: string;
    value?: string;
    sessionId?: string;
  };
  ephemeralToken?: string;
  value?: string;
  sessionId?: string;
};

export class OpenAIRealtimeProvider implements RealtimeProvider {
  private config: RealtimeConfig;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private audioContext: AudioContext | null = null;
  private audioStream: MediaStream | null = null;
  // The outbound audio transceiver, always negotiated sendrecv from the
  // very first offer regardless of whether a mic exists yet (see connect()).
  // enableMicrophone() swaps a real track in later via replaceTrack() on
  // THIS SAME transceiver — a local, renegotiation-free operation — instead
  // of reconnecting the whole session, which used to reset sessionId and
  // wipe `conversation`, silently losing the AI's context on every "enable
  // mic after starting text-only" click (found live).
  private audioTransceiver: RTCRtpTransceiver | null = null;
  private toolExecutor: ToolExecutor;

  // State
  public isConnected = false;
  public chatStatus: ChatStatus = "stopped";
  public conversation: Conversation[] = [];
  public currentVolume = 0;

  // Session tracking
  private sessionId: string | null = null;

  // Audio refs
  private volumeInterval: number | null = null;
  private ephemeralUserMessageId: string | null = null;
  private micEnabled = false;
  private hasHeardFirstGreeting = false;
  private skipGreeting = false;
  private _warnedTemperatureDropped = false;
  private _temperatureExplicitlySet = false;
  private audioOutputElement: HTMLAudioElement | null = null;

  // Audio streams for lip sync
  private audioOutputAnalyser: AnalyserNode | null = null;
  private audioOutputContext: AudioContext | null = null;

  // Event handlers
  public onConnect?: () => void;
  public onDisconnect?: () => void;
  public onError?: (error: Error) => void;
  public onMessage?: (message: any) => void;
  public onConversationUpdate?: (conversation: Conversation[]) => void;
  public onChatStatusChange?: (status: ChatStatus) => void;
  public onAudioStart?: () => void;
  public onAudioEnd?: () => void;
  public onVolumeChange?: (volume: number) => void;
  public onToolCall?: (toolName: string, args: any, result: any) => void;
  public onUsageReport?: (usage: UsageReport) => void;
  public onAudioData?: (
    analyser: AnalyserNode,
    audioContext: AudioContext,
  ) => void;

  constructor(config: RealtimeConfig) {
    this._temperatureExplicitlySet = config.temperature !== undefined;
    this.config = {
      // Matches buildProxySessionConfig()'s and the non-proxy calls-URL's
      // own "gpt-realtime-1.5" fallback below — "gpt-4o-realtime-preview"
      // was the prior default but is unavailable on some accounts
      // (model_not_found), discovered live during Phase 8 UAT.
      model: "gpt-realtime-1.5",
      voice: "shimmer",
      temperature: 0.8,
      speed: 1.4,
      ...config,
    };

    this.toolExecutor = new ToolExecutor();

    // Register initial tools
    if (this.config.tools) {
      this.config.tools.forEach((tool) => this.registerFunction(tool));
    }
  }

  /**
   * Start the realtime session
   */
  async connect(options?: RealtimeConnectOptions): Promise<void> {
    try {
      this.setChatStatus("starting");
      this.hasHeardFirstGreeting = false;
      this.skipGreeting = options?.skipGreeting ?? false;

      // Request microphone access. Denied/unavailable mics no longer abort the
      // whole session — the user can still type. `enableMicrophone()` re-prompts
      // and reconnects with audio if they change their mind later.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        this.audioStream = stream;
        // Mute mic initially (will be enabled after first greeting)
        stream.getAudioTracks().forEach((track) => (track.enabled = false));
      } catch (micError) {
        console.warn(
          "OpenAIRealtimeProvider: microphone unavailable, continuing in text-only mode",
          micError,
        );
        this.audioStream = null;
      }

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: this.config.turnServers || [
          { urls: "stun:stun.l.google.com:19302" },
        ],
      });
      this.peerConnection = pc;

      // Create data channel for messages
      const dataChannel = pc.createDataChannel("response");
      this.dataChannel = dataChannel;

      dataChannel.onopen = () => {
        this.configureSession();
      };
      dataChannel.onmessage = (event) => {
        this.handleDataChannelMessage(event);
      };

      // ALWAYS a sendrecv audio transceiver, with or without a mic track —
      // never addTrack()/recvonly-only. Two problems that fixes together:
      //
      // 1. Omitting audio media from the offer entirely (the original bug):
      //    OpenAI's Realtime API rejects it outright —
      //    `{"error":{"message":"Offer did not have an audio media
      //    section.","code":"invalid_offer"}}`.
      //
      // 2. A recvonly-negotiated transceiver (the first fix for #1) can
      //    only ever receive — WebRTC direction is negotiated per m-line,
      //    so upgrading to send audio later needs a NEW offer/answer, and
      //    it's undocumented whether OpenAI's one-shot POST
      //    /v1/realtime/calls endpoint even supports renegotiating an
      //    existing call. enableMicrophone() previously worked around that
      //    by disconnecting and reconnecting the whole session — which
      //    resets sessionId and wipes `conversation`, silently losing the
      //    AI's context every time text-only mode later enables the mic
      //    (found live).
      //
      // sendrecv from the start avoids needing an answer either way:
      // `sender.track` is simply null until a mic exists, so nothing is
      // actually sent (WebRTC sends silence/nothing for a null-track
      // sender, not an error) — ontrack for the assistant's voice fires
      // identically regardless of the local send state. enableMicrophone()
      // below then calls `audioTransceiver.sender.replaceTrack(...)`,
      // which — unlike changing a transceiver's negotiated DIRECTION —
      // is a purely local operation needing no renegotiation at all: the
      // m-line was already sendrecv-capable from the first offer/answer.
      this.audioTransceiver = pc.addTransceiver("audio", {
        direction: "sendrecv",
      });
      if (this.audioStream) {
        await this.audioTransceiver.sender.replaceTrack(
          this.audioStream.getTracks()[0],
        );
      }

      // Setup audio output analysis for lip sync
      this.setupAudioOutputAnalysis(pc);

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Resolve the bearer token — either via the backend proxy (ephemeral) or a direct API key.
      let bearerToken: string;
      const proxyEndpoint = this.config.proxyEndpoint;
      const usingProxy = Boolean(this.config.useProxy && proxyEndpoint);

      if (usingProxy && proxyEndpoint) {
        const sessionConfig = this.buildProxySessionConfig();

        const tokenRes = await fetch(proxyEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionConfig }),
        });
        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          throw new Error(
            `Failed to fetch ephemeral token: ${tokenRes.status} ${errText}`,
          );
        }
        const tokenData = (await tokenRes.json()) as ProxyTokenResponse;
        bearerToken =
          tokenData.data?.ephemeralToken ??
          tokenData.data?.value ??
          tokenData.ephemeralToken ??
          tokenData.value ??
          "";

        if (!bearerToken) {
          throw new Error("Proxy token response did not include a token value");
        }

        this.sessionId =
          tokenData.data?.sessionId ?? tokenData.sessionId ?? this.sessionId;
      } else if (this.config.apiKey) {
        bearerToken = this.config.apiKey;
      } else {
        throw new Error(
          "No authentication method provided: set useProxy+proxyEndpoint or apiKey.",
        );
      }

      // Send SDP offer directly to the OpenAI Realtime API using the resolved token.
      const callsEndpoint = usingProxy
        ? "https://api.openai.com/v1/realtime/calls"
        : `https://api.openai.com/v1/realtime/calls?model=${
            this.config.model || "gpt-realtime-1.5"
          }&voice=${this.config.voice || "coral"}`;

      const response = await fetch(callsEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to negotiate WebRTC session: ${response.status} ${errorText}`,
        );
      }

      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      this.isConnected = true;
      this.onConnect?.();
    } catch (error) {
      this.onError?.(error as Error);
      this.disconnect();
    }
  }

  /**
   * Stop the session and cleanup
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Tied to the now-closed peerConnection above — stale otherwise, since
    // a transceiver from a closed RTCPeerConnection throws if touched
    // (e.g. a later enableMicrophone() calling replaceTrack() on it).
    this.audioTransceiver = null;

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.audioOutputContext) {
      this.audioOutputContext.close();
      this.audioOutputContext = null;
    }

    this.audioOutputAnalyser = null;

    if (this.audioOutputElement) {
      this.audioOutputElement.srcObject = null;
      this.audioOutputElement.pause();
      this.audioOutputElement = null;
    }

    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }

    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }

    this.ephemeralUserMessageId = null;
    this.sessionId = null;
    this.currentVolume = 0;
    this.conversation = [];
    this.setChatStatus("stopped");
    this.hasHeardFirstGreeting = false;

    this.onDisconnect?.();
  }

  /**
   * Send a text message
   */
  async sendMessage(text: string): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      throw new Error("Connection not ready");
    }

    // If the AI is mid-response (speaking or generating), a typed message
    // should cut it off rather than queue behind it or cross-talk with it.
    if (this.chatStatus === "speaking" || this.chatStatus === "thinking") {
      this.interrupt();
      this.finalizeLastAssistantMessage();
    }

    const messageId = uuidv4();

    // Add to conversation
    const newMessage: Conversation = {
      id: messageId,
      role: "user",
      text,
      timestamp: new Date().toISOString(),
      isFinal: true,
      status: "final",
    };

    this.conversation.push(newMessage);
    this.onConversationUpdate?.(this.conversation);
    this.setChatStatus("thinking");

    // Send through data channel
    const message = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    };

    const response = { type: "response.create" };

    this.dataChannel.send(JSON.stringify(message));
    this.dataChannel.send(JSON.stringify(response));
  }

  /**
   * Interrupt current speech
   */
  interrupt(): void {
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.send(JSON.stringify({ type: "response.cancel" }));
    }
  }

  /**
   * Register a function/tool.
   *
   * Wires the local `execute` callback into `toolExecutor` AND ensures the
   * tool is present in `this.config.tools` — `buildProxySessionConfig()`
   * (sent at connect) and `configureSession()` (sent over the data channel)
   * both read tool declarations exclusively from `this.config.tools`.
   * Registering only the executor without this meant the model was never
   * told the tool exists and could never call it (confirmed live: a
   * `registerFunction()`-only registration, e.g. `toolGesture` wired via a
   * post-construction `useEffect` as both demo pages do, never appeared in
   * the session's tool list — nod/shake silently never fired).
   *
   * Call before `connect()` — tools registered after the session is
   * established are not retroactively re-sent.
   */
  registerFunction(tool: RealtimeTool): void {
    this.toolExecutor.register(tool.name, tool.execute);

    if (!this.config.tools) {
      this.config.tools = [];
    }
    const alreadyDeclared = this.config.tools.some((t) => t.name === tool.name);
    if (!alreadyDeclared) {
      this.config.tools.push(tool);
    }
  }

  /**
   * Return the current chat session ID (set after successful token fetch)
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Build the sessionConfig object POSTed to the proxy endpoint when
   * useProxy+proxyEndpoint are set. Extracted from connect() so it can be
   * exercised directly by a regression test (see Task 1 of 08-05).
   *
   * (gap 08-05) `config.temperature` is intentionally NOT included here.
   * OpenAI's /v1/realtime/client_secrets schema rejects session-level
   * temperature — confirmed via live 400 "Unknown parameter:
   * session.temperature". It remains a constructor option (for any future
   * non-proxy API surface that does accept it) but is silently dropped on
   * this path; warn once so a caller setting it doesn't wonder why it has
   * no effect.
   */
  private buildProxySessionConfig(): any {
    if (this._temperatureExplicitlySet && !this._warnedTemperatureDropped) {
      this._warnedTemperatureDropped = true;
      console.warn(
        "OpenAIRealtimeProvider: config.temperature is ignored in proxy mode — OpenAI's session-create endpoint rejects it (gap 08-05)."
      );
    }
    const sessionConfig: any = {
      type: "realtime" as const,
      model: this.config.model || "gpt-realtime-1.5",
      instructions:
        this.config.instructions || "You are a helpful AI assistant.",
      output_modalities: ["audio"] as const,
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-transcribe",
            // Omit `language` when not explicitly configured so the model
            // auto-detects per utterance — defaulting to "en" mistranscribed
            // any non-English speech (e.g. Thai visitors) as English phonemes.
            ...(this.config.language
              ? { language: this.config.language }
              : {}),
          },
          // semantic_vad waits for a semantically complete utterance rather
          // than a fixed silence window — more robust to stray background
          // noise/speech and natural pauses than threshold-based server_vad.
          turn_detection: {
            type: "semantic_vad" as const,
            eagerness: this.config.vadTuning?.eagerness ?? "auto",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          format: {
            type: "audio/pcm" as const,
            rate: 24000 as const,
          },
          voice: this.config.voice || "alloy",
          speed: this.config.speed || 1.0,
        },
      },
    };

    // If tools are configured locally, include their function descriptions
    // in the sessionConfig so the proxy/OpenAI session can register them.
    if (this.config.tools && this.config.tools.length > 0) {
      const tools = this.config.tools.map((tool) => {
        const properties: any = {};
        const requiredFields: string[] = [];

        Object.entries(tool.parameters).forEach(
          ([key, param]: [string, any]) => {
            const { required, ...paramSchema } = param;
            properties[key] = paramSchema;
            if (required === true) requiredFields.push(key);
          },
        );

        return {
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties,
            required: requiredFields,
          },
        };
      });

      sessionConfig.tools = tools;
      sessionConfig.tool_choice = this.config.toolChoice ?? "auto";
    }

    return sessionConfig;
  }

  /**
   * Configure the OpenAI session
   */
  private configureSession(): void {
    if (!this.dataChannel) return;

    // Only send a session.update when tools are present.
    // Session defaults (model, instructions, audio, etc.) are owned by the backend.
    if (this.config.tools && this.config.tools.length > 0) {
      const tools = this.config.tools.map((tool) => {
        // Build parameters object, removing the 'required' field from each property
        const properties: any = {};
        const requiredFields: string[] = [];

        Object.entries(tool.parameters).forEach(
          ([key, param]: [string, any]) => {
            // Extract 'required' flag before adding to properties
            const { required, ...paramSchema } = param;
            properties[key] = paramSchema;

            // Track which fields are required
            if (required === true) {
              requiredFields.push(key);
            }
          },
        );

        return {
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties,
            required: requiredFields,
          },
        };
      });

      const sessionUpdate = {
        type: "session.update",
        session: {
          type: "realtime",
          tools,
          tool_choice: this.config.toolChoice ?? "auto",
        },
      };

      this.dataChannel.send(JSON.stringify(sessionUpdate));
    }

    if (this.skipGreeting) {
      // Silent reconnect (e.g. idle-session reset): skip the greeting
      // entirely rather than just suppressing audio, since a suppressed
      // greeting still consumes a response and reads oddly in the
      // transcript. Manually perform what the greeting's completion
      // (output_audio_buffer.stopped) would normally do, since that event
      // never fires here.
      //
      // The mic must end up exactly as it was before this reconnect, never
      // forced back on (found live: idle-session reset always re-enabled a
      // mic the visitor had deliberately muted). `this.micEnabled` still
      // holds that pre-reconnect value here — nothing between the top of
      // connect() and this point touches it — but the brand-new audioStream
      // acquired in connect() was unconditionally muted, so the two are out
      // of sync and must be resynced directly rather than via enableMic()
      // (its `!this.micEnabled` guard is for "first enable this session,"
      // not "restore after reconnect," and would wrongly no-op here,
      // leaving an should-be-enabled mic silently muted).
      if (this.micEnabled && this.audioStream) {
        this.audioStream
          .getAudioTracks()
          .forEach((track) => (track.enabled = true));
      }
      this.hasHeardFirstGreeting = true;
      this.setChatStatus("ready");
      return;
    }

    // Anchor the greeting as a cold open (T-COLDOPEN-01): response.create
    // below has zero conversation history, so without this the model infers
    // "start of conversation" purely from `instructions` — which describe
    // ongoing-conversation behavior (e.g. tool-use conditionals), not what a
    // first line should sound like. Left unanchored, the greeting can read
    // like a reply to a question the user never asked. A "system" item (not
    // "user" — this must never look like real user speech) makes the cold
    // open explicit without overriding the session's real instructions, the
    // way response.create's own `response.instructions` override would.
    //
    // With `config.greeting` set, the same item instead pins the opening line
    // so the model says it word for word (see buildColdOpenPrompt). It stays a
    // system item rather than a `response.instructions` override because that
    // override *replaces* the session instructions for the response, which
    // would drop the persona, language and Thai speech rules from the greeting.
    this.dataChannel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: buildColdOpenPrompt(this.config.greeting),
            },
          ],
        },
      }),
    );

    this.dataChannel.send(JSON.stringify({ type: "response.create" }));
    // Do NOT setChatStatus("ready") here — the greeting response requested
    // above hasn't started streaming yet. Setting "ready" prematurely
    // produces a starting -> ready -> starting flap: this fires "ready",
    // then the greeting's first token/audio event re-sets "starting"
    // (hasHeardFirstGreeting is still false), retriggering the
    // welcome/greet clip crossfade mid-flight. `isConnected` (not
    // chatStatus) already reflects the WebRTC connection being live, so
    // nothing depends on "ready" firing here. chatStatus correctly settles
    // to "ready" later, in the `output_audio_buffer.stopped` handler, once
    // the greeting has actually finished.
  }

  /**
   * Handle incoming data channel messages
   */
  private async handleDataChannelMessage(event: MessageEvent): Promise<void> {
    try {
      const msg = JSON.parse(event.data);
      this.onMessage?.(msg);

      switch (msg.type) {
        case "session.updated":
          console.log("Session:", msg.session);
          break;
        case "session.created":
          console.log("Session created:", msg.session);
          break;
        case "error":
          console.error("❌ OpenAI Error:", msg);
          break;
        case "input_audio_buffer.speech_started":
          this.getOrCreateEphemeralUserId();
          this.updateEphemeralUserMessage({ status: "speaking" });
          this.setChatStatus("listening");
          break;
        case "input_audio_buffer.speech_stopped":
          this.updateEphemeralUserMessage({ status: "speaking" });
          this.setChatStatus("listening");
          break;
        case "input_audio_buffer.committed":
          this.updateEphemeralUserMessage({
            text: "Processing speech...",
            status: "processing",
          });
          this.setChatStatus("thinking");
          break;
        case "conversation.item.input_audio_transcription":
          const partialText =
            msg.transcript ?? msg.text ?? "User is speaking...";
          this.updateEphemeralUserMessage({
            text: partialText,
            status: "speaking",
            isFinal: false,
          });
          this.setChatStatus("listening");
          break;
        case "conversation.item.input_audio_transcription.completed":
          this.updateEphemeralUserMessage({
            text: msg.transcript || "",
            isFinal: true,
            status: "final",
          });
          this.clearEphemeralUserMessage();
          this.setChatStatus("thinking");
          break;
        case "response.output_text.delta":
          this.setChatStatus(
            this.hasHeardFirstGreeting ? "speaking" : "starting",
          );
          this.handleAssistantTranscript(msg.delta);
          break;
        case "response.output_audio_transcript.delta":
          this.handleAssistantTranscript(msg.delta);
          break;
        case "response.output_text.done":
        case "response.output_audio_transcript.done":
          this.finalizeLastAssistantMessage();
          break;
        case "output_audio_buffer.started":
          this.setChatStatus(
            this.hasHeardFirstGreeting ? "speaking" : "starting",
          );
          break;
        case "output_audio_buffer.stopped":
          if (!this.hasHeardFirstGreeting) {
            this.enableMic();
            this.hasHeardFirstGreeting = true;
          }
          this.setChatStatus("ready");
          break;
        case "response.done":
          if (msg.response?.usage && this.onUsageReport) {
            const u = msg.response.usage;
            this.onUsageReport({
              sessionId: this.sessionId ?? "",
              inputTextTokens: u.input_token_details?.text_tokens ?? 0,
              inputAudioTokens: u.input_token_details?.audio_tokens ?? 0,
              inputCachedTokens: u.input_token_details?.cached_tokens ?? 0,
              outputTextTokens: u.output_token_details?.text_tokens ?? 0,
              outputAudioTokens: u.output_token_details?.audio_tokens ?? 0,
            });
          }
          break;
        case "response.function_call_arguments.done":
          await this.handleToolCall(msg);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error("Error handling data channel message:", error);
      this.onError?.(error as Error);
    }
  }

  /**
   * Handle assistant transcript streaming
   */
  private handleAssistantTranscript(delta: string): void {
    const newMessage: Conversation = {
      id: uuidv4(),
      role: "assistant",
      text: delta,
      timestamp: new Date().toISOString(),
      isFinal: false,
    };

    const lastMsg = this.conversation[this.conversation.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && !lastMsg.isFinal) {
      // Append to existing message
      lastMsg.text += delta;
    } else {
      // Create new message
      this.conversation.push(newMessage);
    }

    this.onConversationUpdate?.(this.conversation);
  }

  /**
   * Finalize the last assistant message
   */
  private finalizeLastAssistantMessage(): void {
    if (this.conversation.length > 0) {
      const lastMsg = this.conversation[this.conversation.length - 1];
      if (lastMsg.role === "assistant") {
        lastMsg.isFinal = true;
      }
    }
    this.onConversationUpdate?.(this.conversation);
  }

  /**
   * Handle tool/function calls
   */
  private async handleToolCall(msg: any): Promise<void> {
    this.setChatStatus("thinking");

    try {
      const args = JSON.parse(msg.arguments);
      const result = await this.toolExecutor.execute(msg.name, args);

      this.onToolCall?.(msg.name, args, result);

      // Send result back to OpenAI
      const response = {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: msg.call_id,
          output: JSON.stringify(result),
        },
      };

      this.dataChannel?.send(JSON.stringify(response));

      const responseCreate = { type: "response.create" };

      this.dataChannel?.send(JSON.stringify(responseCreate));
    } catch (error) {
      console.error("Tool execution error:", error);
      this.onError?.(error as Error);
    }
  }

  /**
   * Set chat status and notify listeners
   */
  private setChatStatus(status: ChatStatus): void {
    if (this.chatStatus !== status) {
      this.chatStatus = status;
      this.onChatStatusChange?.(status);
    }
  }

  /**
   * Enable microphone after first greeting
   */
  private enableMic(): void {
    if (this.audioStream && !this.micEnabled) {
      this.audioStream
        .getAudioTracks()
        .forEach((track) => (track.enabled = true));
      this.micEnabled = true;
      console.log("Microphone enabled");
    }
  }

  /**
   * Toggle microphone on/off. If no mic stream exists yet (permission was
   * denied/skipped at connect time), delegates to enableMicrophone() to
   * re-request permission instead of silently no-opping.
   */
  async toggleMicrophone(): Promise<boolean> {
    if (!this.audioStream) {
      await this.enableMicrophone();
      return this.isMicrophoneEnabled();
    }

    const isEnabled = this.audioStream.getAudioTracks()[0]?.enabled ?? false;

    if (isEnabled) {
      this.disableMicrophone();
      return false;
    } else {
      this.enableMicrophone();
      return true;
    }
  }

  /**
   * Enable microphone manually. If the session started without a mic stream
   * (user denied/skipped permission at connect time), this re-requests
   * permission and swaps the new track into the ALREADY-CONNECTED session's
   * sendrecv audio transceiver via replaceTrack() — a local operation
   * needing no renegotiation, since connect() always negotiates that
   * transceiver as sendrecv up front (see its comment). Previously this
   * disconnected and reconnected the whole session to add a track, which
   * reset sessionId and wiped `conversation`, silently losing the AI's
   * context every time (found live) — now the session, and its context,
   * are never touched.
   */
  async enableMicrophone(): Promise<void> {
    if (!this.audioStream) {
      console.log("No audio stream — requesting microphone permission");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        this.audioStream = stream;
        if (this.audioTransceiver) {
          await this.audioTransceiver.sender.replaceTrack(
            stream.getTracks()[0],
          );
        }
      } catch (error) {
        // Still denied (or blocked outright — most browsers won't
        // re-prompt once a user has explicitly blocked an origin; the
        // caller needs to reset it in the browser's own site settings).
        this.onError?.(error as Error);
        return;
      }
    }

    this.audioStream
      .getAudioTracks()
      .forEach((track) => (track.enabled = true));
    this.micEnabled = true;
    console.log("Microphone enabled manually");
  }

  /**
   * Disable microphone manually
   */
  disableMicrophone(): void {
    if (!this.audioStream) {
      console.warn("No audio stream available - microphone cannot be disabled");
      return;
    }

    this.audioStream
      .getAudioTracks()
      .forEach((track) => (track.enabled = false));
    this.micEnabled = false;
    console.log("Microphone disabled manually");
  }

  /**
   * Get current microphone state
   */
  isMicrophoneEnabled(): boolean {
    if (!this.audioStream) {
      return false;
    }

    return this.audioStream.getAudioTracks()[0]?.enabled ?? false;
  }

  /**
   * Setup audio output analysis for lip sync
   */
  private setupAudioOutputAnalysis(peerConnection: RTCPeerConnection): void {
    try {
      // Listen for incoming audio tracks from OpenAI
      peerConnection.ontrack = (event) => {
        const [stream] = event.streams;
        const audioTrack = stream.getAudioTracks()[0];

        if (audioTrack) {
          // ── Reliable audio playback via HTMLAudioElement ──────────────────
          // AudioContext.destination alone is unreliable — browsers suspend the
          // context when it is created outside a direct user gesture. An
          // HTMLAudioElement with autoplay is the correct path for playback.
          if (!this.audioOutputElement) {
            this.audioOutputElement = document.createElement("audio");
            this.audioOutputElement.autoplay = true;
          }
          this.audioOutputElement.srcObject = stream;
          void this.audioOutputElement.play().catch(() => {
            // Silently ignore autoplay policy errors — the element will play
            // as soon as the user interacts with the page.
          });

          // ── AudioContext for lip-sync / volume analysis ───────────────────
          this.audioOutputContext = new AudioContext();
          const source =
            this.audioOutputContext.createMediaStreamSource(stream);

          // Create analyser for lip sync
          this.audioOutputAnalyser = this.audioOutputContext.createAnalyser();
          this.audioOutputAnalyser.fftSize = 2048;
          this.audioOutputAnalyser.smoothingTimeConstant = 0.6;

          // Connect source → analyser only (playback handled by the element)
          source.connect(this.audioOutputAnalyser);

          // Resume the context — it may start suspended if created outside
          // a synchronous click handler.
          void this.audioOutputContext.resume();

          // Notify listeners that audio analysis is available
          this.onAudioData?.(this.audioOutputAnalyser, this.audioOutputContext);
        }
      };
    } catch (error) {
      console.error("Failed to setup audio output analysis:", error);
    }
  }

  /**
   * Get audio analyser for lip sync
   */
  getAudioAnalyser(): {
    analyser: AnalyserNode;
    audioContext: AudioContext;
  } | null {
    if (this.audioOutputAnalyser && this.audioOutputContext) {
      return {
        analyser: this.audioOutputAnalyser,
        audioContext: this.audioOutputContext,
      };
    }
    return null;
  }

  /**
   * Ephemeral user message management
   */
  private getOrCreateEphemeralUserId(): string {
    let ephemeralId = this.ephemeralUserMessageId;
    if (!ephemeralId) {
      ephemeralId = uuidv4();
      this.ephemeralUserMessageId = ephemeralId;

      const newMessage: Conversation = {
        id: ephemeralId,
        role: "user",
        text: "",
        timestamp: new Date().toISOString(),
        isFinal: false,
        status: "speaking",
      };

      this.conversation.push(newMessage);
      this.onConversationUpdate?.(this.conversation);
    }
    return ephemeralId;
  }

  private updateEphemeralUserMessage(partial: Partial<Conversation>): void {
    const ephemeralId = this.ephemeralUserMessageId;
    if (!ephemeralId) return;

    this.conversation = this.conversation.map((msg) => {
      if (msg.id === ephemeralId) {
        return { ...msg, ...partial };
      }
      return msg;
    });

    this.onConversationUpdate?.(this.conversation);
  }

  private clearEphemeralUserMessage(): void {
    this.ephemeralUserMessageId = null;
  }
}
