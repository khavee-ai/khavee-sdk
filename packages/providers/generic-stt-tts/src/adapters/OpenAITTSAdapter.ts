/**
 * OpenAITTSAdapter — wraps @khaveeai/providers-openai-stt-tts's TTSPlayer
 * (TTS fetch + Web Audio decode + dual-path lip-sync playback) to conform
 * to the vendor-neutral TTSProvider interface (packages/core/src/types/pipeline.ts).
 *
 * TTSProvider.speak(text, opts) takes a single opts object, while
 * TTSPlayer.speak() takes 4 positional args and creates its own internal
 * AbortController (no external signal support). This adapter reshapes the
 * call into TTSPlayer's positional form and bridges an external AbortSignal
 * to TTSPlayer.cancel() (approach (a) from RESEARCH/02-PATTERNS.md) rather
 * than reimplementing TTSPlayer's fetch to inject the signal directly —
 * TTSPlayer is pitfall-hardened code (AbortError swallow, dual-path analyser,
 * arrayBuffer.slice(0)) that must not be duplicated (D-06 "Don't Hand-Roll").
 */

import { TTSProvider } from "@khaveeai/core";
import { TTSPlayer } from "@khaveeai/providers-openai-stt-tts";

/** Constructor config for OpenAITTSAdapter. */
export interface OpenAITTSAdapterConfig {
  /** Full URL of the backend TTS proxy endpoint. */
  endpoint: string;
  /** JWT bearer token for authenticating with the proxy. */
  authToken: string;
  /** TTS model name. Default: "gpt-4o-mini-tts". */
  model?: string;
  /** Default voice identifier, used when speak() opts.voice is omitted. */
  voice?: string;
  /** Default playback speed multiplier, used when speak() opts.speed is omitted. */
  speed?: number;
  /** Optional voice style instructions for gpt-4o-mini-tts. */
  instructions?: string;
}

/**
 * Adapts TTSPlayer to the TTSProvider interface, bridging external
 * AbortSignal cancellation to TTSPlayer.cancel().
 */
export class OpenAITTSAdapter implements TTSProvider {
  readonly name = "openai-tts";
  readonly supportsStreaming = false;

  private readonly endpoint: string;
  private readonly authToken: string;
  private readonly model?: string;
  private readonly voice?: string;
  private readonly speed?: number;
  private readonly instructions?: string;
  private readonly player: TTSPlayer;

  constructor(config: OpenAITTSAdapterConfig, player?: TTSPlayer) {
    this.endpoint = config.endpoint;
    this.authToken = config.authToken;
    this.model = config.model;
    this.voice = config.voice;
    this.speed = config.speed;
    this.instructions = config.instructions;
    this.player = player ?? new TTSPlayer();
  }

  async speak(
    text: string,
    opts: {
      audioContext: AudioContext;
      onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;
      voice?: string;
      speed?: number;
      signal?: AbortSignal;
    }
  ): Promise<void> {
    // Pre-aborted signal: do not start playback at all.
    if (opts.signal?.aborted) {
      return;
    }

    // Bridge an external abort to TTSPlayer.cancel() — registered BEFORE
    // calling speak() so a mid-flight barge-in cancels the in-flight
    // fetch/playback via TTSPlayer's own AbortController.
    opts.signal?.addEventListener(
      "abort",
      () => {
        this.player.cancel();
      },
      { once: true }
    );

    await this.player.speak(
      text,
      {
        endpoint: this.endpoint,
        authToken: this.authToken,
        voice: opts.voice ?? this.voice ?? "alloy",
        speed: opts.speed ?? this.speed ?? 1.0,
        model: this.model ?? "gpt-4o-mini-tts",
        ...(this.instructions ? { instructions: this.instructions } : {}),
      },
      opts.audioContext,
      (analyser, ctx) => opts.onAudioData?.(analyser, ctx)
    );
  }
}
