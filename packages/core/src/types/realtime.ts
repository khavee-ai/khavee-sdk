import { RealtimeMessage, Conversation, ChatStatus } from "./conversation";
import { MouthState, PhonemeData } from "./audio";

/**
 * Tool definition for function calling
 */
export interface RealtimeTool {
  name: string;
  description: string;
  parameters: {
    [key: string]: {
      type: "string" | "number" | "boolean" | "array" | "object";
      required?: boolean;
      enum?: string[];
      description?: string;
    };
  };
  execute: (args: any) => Promise<{
    success: boolean;
    message: string;
  }>;
}

/**
 * Realtime provider configuration
 */
export interface RealtimeConfig {
  apiKey?: string;
  model?: string;
  voice?:
    | "alloy"
    | "ash"
    | "ballad"
    | "coral"
    | "echo"
    | "sage"
    | "shimmer"
    | "verse"
    | "marin"
    | "cedar";
  instructions?: string;
  temperature?: number;
  tools?: RealtimeTool[];
  turnServers?: RTCIceServer[];
  speed?: number;
  enableLipSync?: boolean;
  language?: string;
  /**
   * Turn-detection tuning. Uses OpenAI's semantic_vad — waits for a
   * semantically complete utterance instead of a fixed silence duration,
   * which is more robust to natural pauses and stray background noise than
   * threshold-based server_vad.
   */
  vad?: {
    /** How eagerly the model decides the user is done talking. "low" waits
     * for more context (fewer false cutoffs/triggers); "high" responds
     * faster. Defaults to "auto". */
    eagerness?: "low" | "medium" | "high" | "auto";
  };
  /** When true, fetch an ephemeral token from the backend before connecting. */
  useProxy?: boolean;
  /**
   * Full URL of the backend token endpoint.
   * e.g. `https://api.example.com/api/v1/projects/{projectId}/chat/token`
   * The endpoint must return `{ data: { ephemeralToken: string, sessionId: string } }`.
   */
  proxyEndpoint?: string;
}

/**
 * Token usage breakdown reported after each AI response
 */
export interface UsageReport {
  sessionId: string;
  inputTextTokens: number;
  inputAudioTokens: number;
  inputCachedTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
}

/**
 * Events from realtime provider
 */
export interface RealtimeEvents {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onMessage?: (message: RealtimeMessage) => void;
  onConversationUpdate?: (conversation: Conversation[]) => void;
  onChatStatusChange?: (status: ChatStatus) => void;
  onAudioStart?: () => void;
  onAudioEnd?: () => void;
  onVolumeChange?: (volume: number) => void;
  onMouthStateChange?: (state: MouthState) => void;
  onPhonemeDetected?: (phoneme: PhonemeData) => void;
  onToolCall?: (toolName: string, args: any, result: any) => void;
  /** Fired after each OpenAI response.done event with the token breakdown. */
  onUsageReport?: (usage: UsageReport) => void;
}

/**
 * Main realtime provider interface
 */
export interface RealtimeProvider extends RealtimeEvents {
  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Messaging
  sendMessage(text: string): Promise<void>;
  interrupt(): void;

  // Function registration
  registerFunction(tool: RealtimeTool): void;

  // State
  isConnected: boolean;
  chatStatus: ChatStatus;
  conversation: Conversation[];
  currentVolume: number;
  onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;

  // Audio analysis
  getAudioAnalyser(): {
    analyser: AnalyserNode;
    audioContext: AudioContext;
  } | null;

  // Microphone control
  // Async: if no mic stream exists yet (permission was denied/skipped when the
  // session first connected), these re-request permission and reconnect so the
  // session picks up the audio track — see OpenAIRealtimeProvider for details.
  toggleMicrophone(): Promise<boolean>;
  enableMicrophone(): Promise<void>;
  disableMicrophone(): void;
  isMicrophoneEnabled(): boolean;
}
