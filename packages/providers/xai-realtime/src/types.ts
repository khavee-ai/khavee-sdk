/**
 * xAI Realtime Provider — Configuration and Event Types
 *
 * Extends @khaveeai/core's RealtimeConfig for xAI's WebSocket-based
 * Realtime API (Grok voice). The event schema is ~95% compatible with
 * OpenAI's Realtime API but uses WebSocket transport, not WebRTC.
 */

import { RealtimeConfig } from "@khaveeai/core";

// ── Configuration ────────────────────────────────────────────────────────────

export interface XAIRealtimeConfig extends RealtimeConfig {
  /** Ephemeral token (browser) or API key (server-side). */
  apiKey?: string;
  /** Model identifier. Default: "grok-voice-latest" */
  model?: string;
  /** WebSocket endpoint. Default: "wss://api.x.ai/v1/realtime" */
  baseUrl?: string;
  /** xAI voice name for TTS output. */
  voice?: string;
  /** System prompt / session instructions. */
  instructions?: string;
  /** Server-side VAD turn detection configuration. */
  turnDetection?: {
    type: "server_vad";
    threshold?: number;
    silence_duration_ms?: number;
    prefix_padding_ms?: number;
    idle_timeout_ms?: number;
  };
  /** Input audio encoding. Default: "pcm16" */
  inputAudioFormat?: "pcm16" | "opus" | "pcmu" | "pcma";
  /** Output audio encoding. Default: "pcm16" */
  outputAudioFormat?: "pcm16" | "opus" | "pcmu" | "pcma";
  /** Audio sample rate in Hz. Default: 24000 */
  sampleRate?: number;
  /**
   * Backend endpoint that mints ephemeral tokens for browser use.
   * e.g. "/api/xai-token" — called via POST, expects JSON response
   * with `{ client_secret: { value: string } }`.
   */
  tokenEndpoint?: string;
}

// ── Server → Client Events ───────────────────────────────────────────────────

export type XAIServerEvent =
  | { type: "session.created"; session: Record<string, unknown> }
  | { type: "session.updated"; session: Record<string, unknown> }
  | { type: "input_audio_buffer.speech_started"; item_id?: string }
  | { type: "input_audio_buffer.speech_stopped"; item_id?: string }
  | { type: "input_audio_buffer.committed"; item_id: string }
  | {
      type: "conversation.item.created";
      item: { id: string; type: string; role?: string; content?: unknown[] };
    }
  | {
      type: "conversation.item.input_audio_transcription.updated";
      item_id: string;
      transcript: string;
    }
  | { type: "response.created"; response: { id: string } }
  | {
      type: "response.output_item.added";
      output_index: number;
      item: { id: string; type: string; role?: string };
    }
  | {
      type: "response.content_part.added";
      item_id: string;
      content_index: number;
      part: { type: string };
    }
  | { type: "response.text.delta"; item_id: string; delta: string }
  | { type: "response.text.done"; item_id: string; text: string }
  | {
      type: "response.audio.delta";
      item_id: string;
      delta: string;
    }
  | {
      type: "response.output_audio.delta";
      item_id: string;
      delta: string;
    }
  | { type: "response.audio.done"; item_id: string }
  | { type: "response.output_audio.done"; item_id: string }
  | {
      type: "response.audio_transcript.delta";
      item_id: string;
      delta: string;
    }
  | {
      type: "response.audio_transcript.done";
      item_id: string;
      transcript: string;
    }
  | {
      type: "response.function_call_arguments.delta";
      item_id: string;
      call_id: string;
      delta: string;
    }
  | {
      type: "response.function_call_arguments.done";
      item_id: string;
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "response.done";
      response: {
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
      };
    }
  | { type: "error"; error: { message: string; type?: string; code?: string } };

// ── Client → Server Events ───────────────────────────────────────────────────

export type XAIClientEvent =
  | { type: "session.update"; session: Record<string, unknown> }
  | { type: "input_audio_buffer.append"; audio: string }
  | { type: "input_audio_buffer.commit" }
  | { type: "input_audio_buffer.clear" }
  | {
      type: "conversation.item.create";
      item: {
        type: string;
        role?: string;
        content?: { type: string; text?: string }[];
        call_id?: string;
        output?: string;
      };
    }
  | { type: "response.create"; response?: Record<string, unknown> }
  | { type: "response.cancel" };
