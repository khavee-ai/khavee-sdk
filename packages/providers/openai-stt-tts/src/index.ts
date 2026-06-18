export { OpenAISTTTTSProvider } from "./OpenAISTTTTSProvider";
export type { OpenAISTTTTSConfig } from "./OpenAISTTTTSProvider";
// Re-exported for backward compatibility — ToolExecutor moved to @khaveeai/core in phase 01.
export { ToolExecutor } from "@khaveeai/core";

// Additive exports for the @khaveeai/providers-generic-stt-tts adapters (D-06) — zero behavior change.
export { AudioRecorder } from "./AudioRecorder";
export { STTClient } from "./STTClient";
export { ChatClient } from "./ChatClient";
export type { ChatMessage, ChatUsage, ChatResult } from "./ChatClient";
export { TTSPlayer } from "./TTSPlayer";
