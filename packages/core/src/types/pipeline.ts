/**
 * Vendor-neutral pipeline-stage interfaces (VAD, STT, LLM, TTS).
 *
 * These four interfaces generalize the OpenAI-specific helper classes in
 * packages/providers/openai-stt-tts/src/{AudioRecorder,STTClient,ChatClient,TTSPlayer}.ts
 * into pipecat-style swappable contracts (CORE-01) — any vendor adapter
 * (Thonburian STT, JaiTTS, future Bedrock/Gemini adapters) can implement one
 * of these without redesign. Each interface declares at least one `readonly`
 * capability flag so consumers can branch synchronously without invoking the
 * provider (CORE-02).
 *
 * Tool-calling vendor-neutral mapping sketch (CORE-06, RESEARCH Pattern 4):
 *
 * Every vendor's tool-calling response shape funnels into the same
 * `ToolCall[]` array with the neutral `{ id, name, args }` shape below. No
 * OpenAI-specific reply-correlation field name appears anywhere in this
 * file (this file deliberately avoids spelling out those vendor wire field
 * names verbatim — see ToolCall.id's doc comment for the mapping table).
 *
 *   OpenAI (Chat Completions):
 *     response.tool_calls = [{ id: "call_abc", function: { name, arguments } }]
 *     -> reply correlates back via the matching id on the tool result message
 *     -> maps to: { id: "call_abc", name, args: JSON.parse(arguments) }
 *
 *   OpenAI Realtime API:
 *     event carries its own correlation id alongside name/arguments
 *     -> reply correlates back via that same id on the function output event
 *     -> maps to: { id: event's correlation id, name: event.name, args: JSON.parse(event.arguments) }
 *
 *   Anthropic (Messages API):
 *     response.content = [{ type: "tool_use", id: "toolu_01...", name, input }, ...]
 *     -> MULTIPLE tool_use blocks can appear in a single turn (parallel calls)
 *     -> reply correlates back via a tool-result block referencing each block's id
 *     -> each block maps to: { id: block.id, name: block.name, args: block.input }
 *     -> the array of mapped blocks IS toolCalls: ToolCall[] — no redesign needed,
 *        this is exactly the `length > 1` case D-04's array shape was built for.
 *
 *   Gemini (generateContent / functionCalling):
 *     response.candidates[0].content.parts = [{ functionCall: { id, name, args } }, ...]
 *     -> parallel functionCall parts are matched back to function-response parts by id
 *     -> each part maps to: { id: part.functionCall.id, name: part.functionCall.name, args: part.functionCall.args }
 *     -> again funnels into the same toolCalls: ToolCall[] array with zero interface changes.
 *
 * In all four cases the adapter author's only job is to read the vendor's
 * own id/name/args-shaped field and re-key it onto { id, name, args } —
 * proving the interface holds for single-call (OpenAI) and multi-call
 * (Anthropic, Gemini) vendors alike without redesign.
 */

import { Provider } from "./providers";
import { Tool, ToolResult } from "./tools";

// ── Tool-calling result types ───────────────────────────────────────────

/**
 * A single vendor-neutral tool invocation requested by an LLM.
 *
 * `id` is the vendor-neutral correlation field (D-05) used to match this
 * call back to its result in a follow-up turn. This field is intentionally
 * never named after any vendor's own wire-format correlation field — those
 * are vendor-specific names that must be mapped onto `id` by the adapter,
 * not baked into this interface (CORE-06). Maps from:
 *   - OpenAI Chat Completions: the id on each entry of the tool_calls array
 *   - OpenAI Realtime API: the function-call event's own correlation id
 *   - Anthropic: a tool_use content block's id
 *   - Gemini: a functionCall part's id
 */
export interface ToolCall {
  /** Vendor-neutral correlation id (see field doc above for vendor mapping). */
  id: string;
  /** Name of the tool being invoked, matching a registered Tool.name. */
  name: string;
  /** Parsed arguments for the tool call, already decoded from the vendor's wire format (e.g. JSON.parse'd). */
  args: Record<string, any>;
}

/**
 * Normalized result of one LLM completion call.
 *
 * `toolCalls` is always an array (zero-or-more) per D-04 — never a single
 * optional field — so multi-tool-call vendors (Anthropic, Gemini) map on
 * without an interface redesign. The `length === 1` case is today's OpenAI
 * Realtime single-call behavior; `length === 0` is a plain text-only reply.
 */
export interface LLMCompletionResult {
  /** Plain text portion of the completion, if any. May be omitted when the reply is tool-calls-only. */
  text?: string;
  /** Zero or more tool calls requested by the LLM in this completion (D-04). Empty array when no tools were invoked. */
  toolCalls: ToolCall[];
}

/**
 * Normalized result of one STT transcription call.
 */
export interface STTResult {
  /** Transcribed text. May be an empty string when rejected is true. */
  text: string;
  /**
   * Present and true when the vendor's own heuristics flag this transcript
   * as likely hallucinated/silence (D-06). Vendors that never reject simply
   * omit this field — consumers must treat `undefined` the same as `false`.
   */
  rejected?: boolean;
}

// ── Pipeline-stage provider interfaces ──────────────────────────────────

/**
 * Voice Activity Detection stage. Generalized from
 * packages/providers/openai-stt-tts/src/AudioRecorder.ts's MicVAD wrapper.
 *
 * VAD is inherently event-driven (speech start/end boundaries), not a
 * streaming-vs-batch distinction, so no `supportsStreaming` capability flag
 * is declared here — see STTProvider/TTSProvider for that flag instead.
 */
export interface VADProvider extends Provider {
  /** Begin listening for speech and start emitting onSpeechStart/onUtteranceReady events. */
  connect(): Promise<void>;
  /** Stop listening and release any underlying audio resources (e.g. microphone). */
  disconnect(): Promise<void>;
  /** Pause speech detection without releasing underlying audio resources. */
  pause(): Promise<void>;
  /** Resume speech detection after a pause(). */
  resume(): Promise<void>;
  /** Returns true when this provider is actively listening (connected and not paused/destroyed). */
  isListening(): boolean;
  /** Fired when the provider detects the start of speech. */
  onSpeechStart?: () => void;
  /** Fired with a WAV Blob when the provider detects the end of a speech utterance. */
  onUtteranceReady?: (wav: Blob) => void;
  /** Fired when a non-recoverable error occurs (e.g. oversized blob, initialization failure). */
  onError?: (error: Error) => void;
}

/**
 * Speech-to-Text stage. Generalized from
 * packages/providers/openai-stt-tts/src/STTClient.ts.
 */
export interface STTProvider extends Provider {
  /** True when this vendor can stream partial transcripts incrementally. Default intent for whole-utterance vendors (e.g. Thonburian Whisper) is false — this is a property each implementation sets, not an interface default. */
  readonly supportsStreaming: boolean;
  /** True when this vendor can flag a transcript as likely hallucinated/silence via STTResult.rejected. Vendors that never reject set this to false. */
  readonly supportsRejection: boolean;
  /**
   * Transcribe a whole-utterance audio blob.
   *
   * @param audio - Audio blob to transcribe (e.g. WAV produced by a VADProvider).
   * @param opts - Optional transcription hints.
   * @returns The normalized transcription result.
   */
  transcribe(audio: Blob, opts?: { language?: string }): Promise<STTResult>;
}

/**
 * LLM completion stage with tool-calling support. Clean-slate design (not a
 * retrofit of packages/providers/openai-stt-tts/src/ChatClient.ts, which has
 * no tool-calling today) — net-new `toolCalls` field per CORE-06.
 */
export interface LLMProvider extends Provider {
  /** True when this vendor's completion API supports tool/function calling. */
  readonly supportsToolCalling: boolean;
  /** True when this vendor can stream partial completion tokens incrementally. */
  readonly supportsStreaming: boolean;
  /**
   * Request a completion for the given conversation, optionally offering a
   * set of tools the LLM may invoke.
   *
   * @param args.messages - Conversation history in role/content pairs.
   * @param args.tools - Optional plain-object tool definitions (CORE-03) the LLM may call.
   * @param args.signal - Optional best-effort cancellation signal (D-01/D-02): providers may ignore it; the orchestrator discards superseded results.
   * @returns Normalized completion result with zero-or-more tool calls (D-04).
   */
  complete(args: {
    messages: Array<{ role: string; content: string }>;
    tools?: Tool[];
    /** Optional best-effort cancellation signal (D-01/D-02): providers may ignore it; the orchestrator discards superseded results. */
    signal?: AbortSignal;
  }): Promise<LLMCompletionResult>;
}

/**
 * Text-to-Speech stage. Generalized from
 * packages/providers/openai-stt-tts/src/TTSPlayer.ts. Retains the browser
 * Web Audio API coupling (AudioContext/AnalyserNode) per CLAUDE.md's
 * "Browser-only APIs" architectural constraint — this is not a Node.js-
 * targeted interface.
 */
export interface TTSProvider extends Provider {
  /** True when this vendor can stream synthesized audio incrementally. Default intent for whole-utterance vendors (e.g. JaiTTS) is false. */
  readonly supportsStreaming: boolean;
  /**
   * Synthesize and play speech for the given text.
   *
   * @param text - Text to synthesize.
   * @param opts.audioContext - Web Audio context to decode/play through.
   * @param opts.onAudioData - Optional callback fired with the analyser node once playback begins, for lip-sync.
   * @param opts.voice - Optional vendor-specific voice identifier.
   * @param opts.speed - Optional playback speed multiplier.
   * @param opts.signal - Optional best-effort cancellation signal (D-01/D-02): providers may ignore it; the orchestrator discards superseded results.
   */
  speak(
    text: string,
    opts: {
      audioContext: AudioContext;
      onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;
      voice?: string;
      speed?: number;
      /** Optional best-effort cancellation signal (D-01/D-02): providers may ignore it; the orchestrator discards superseded results. */
      signal?: AbortSignal;
    }
  ): Promise<void>;
}

// Re-export ToolResult's sibling type for convenience to adapter authors
// reading this file in isolation (Tool/ToolResult themselves are defined
// and owned by ./tools — not redefined here).
export type { Tool, ToolResult };
