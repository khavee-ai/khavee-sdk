import { RealtimeMessage, Conversation, ChatStatus } from './conversation';
import { MouthState, PhonemeData } from './audio';

/**
 * Tool definition for function calling
 */
export interface RealtimeTool {
  name: string;
  description: string;
  parameters: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
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
  model?: 'gpt-4o-realtime-preview' | 'gpt-4o-mini-realtime-preview';
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'coral' | 'sage';
  instructions?: string;
  temperature?: number;
  tools?: RealtimeTool[];
  turnServers?: RTCIceServer[];
  speed?: number;
  enableLipSync?: boolean;
  language?: string;
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
  getAudioAnalyser(): { analyser: AnalyserNode; audioContext: AudioContext } | null;

  // Microphone control
  toggleMicrophone(): boolean;
  enableMicrophone(): void;
  disableMicrophone(): void;
  isMicrophoneEnabled(): boolean;
}