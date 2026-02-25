import { RealtimeMessage, Conversation, ChatStatus } from './conversation';
import { MouthState, PhonemeData } from './audio';

/**
 * Minimal interface a vector-search backend must satisfy to be used as a
 * RAG source inside OpenAIRealtimeProvider.
 * Both PgVectorProvider and the existing RAGProvider satisfy this contract.
 */
export interface VectorSearchProvider {
  search(query: string, topK?: number, threshold?: number): Promise<Array<{
    id: string | number;
    content?: string;
    /** Qdrant RAGProvider uses `payload` instead of `content` */
    payload?: Record<string, unknown>;
    similarity?: number;
    score?: number;
    metadata?: Record<string, unknown>;
  }>>;
}

/**
 * RAG configuration for OpenAIRealtimeProvider
 */
export interface RAGConfig {
  /** Any provider that implements VectorSearchProvider */
  provider: VectorSearchProvider;
  /** Max documents to retrieve per query (default: 5) */
  topK?: number;
  /** Min similarity score (default: 0.3) */
  threshold?: number;
  /**
   * Text prepended before the injected context in the system message.
   * Default: "Answer based on the following context:"
   */
  systemPromptPrefix?: string;
}

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
  
  /**
   * Security: Use server-side proxy to keep API key secure
   * When enabled, SDK sends SDP to your API endpoint instead of OpenAI directly
   */
  useProxy?: boolean;
  
  /**
   * Your server endpoint that proxies SDP negotiation to OpenAI
   * Defaults to '/api/negotiate'
   * Required when useProxy is true
   */
  proxyEndpoint?: string;

  /**
   * Optional RAG (Retrieval Augmented Generation) configuration.
   * When set, a `search_knowledge_base` tool is automatically registered
   * and context is injected into the conversation before each AI response.
   */
  rag?: RAGConfig;
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