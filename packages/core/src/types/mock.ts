// Core types and interfaces

export interface LegacyLLMProvider {
  streamChat(params: { messages: { role: string; content: string }[] }): AsyncIterable<{ type: string; delta: string }>;
}

export interface LegacyTTSProvider {
  speak(params: { text: string; voice?: string }): Promise<void>;
}

export interface KhaveeConfig {
  llm?: LegacyLLMProvider;
  tts?: LegacyTTSProvider;
  realtime?: import('./realtime').RealtimeProvider; // New realtime provider
  tools?: any[];
}