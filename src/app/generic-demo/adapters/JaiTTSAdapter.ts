/**
 * JaiTTSAdapter — demo-local TTS adapter that posts Thai text to the local
 * jai-tts FastAPI service (port 8002), receives raw WAV audio bytes, decodes
 * them via the caller-supplied AudioContext, and plays them through dual-path
 * nodes (analyser + destination) for lip-sync compatibility.
 *
 * This adapter implements the TTSProvider interface from @khaveeai/core but lives
 * in the demo app (not exported from the SDK package) as proof that the generic
 * pipeline works with non-OpenAI vendors.
 *
 * Wire format (verified in 04-CONTEXT.md):
 * - Request: POST /synthesize with JSON {"text": "<Thai text>"}
 * - Response: raw audio/wav bytes (24kHz/mono/16-bit)
 * - No auth (local demo service)
 * - Voice and speed are hardcoded server-side (opts ignored per CONTEXT.md D-04)
 * - 60s timeout via AbortSignal.timeout() + opts?.signal composition
 *
 * Playback pattern replicates TTSPlayer.speak():
 * - decodeAudioData() → AudioBuffer
 * - AudioBufferSourceNode → dual AnalyserNode + destination
 * - source.start() to begin playback
 */

import { TTSProvider } from "@khaveeai/core";

/** Constructor config for JaiTTSAdapter. */
export interface JaiTTSAdapterConfig {
  /** Base URL of the jai-tts service. Default: http://localhost:8002 */
  baseUrl?: string;
}

/**
 * Demo-local TTS adapter that posts to jai-tts (Thai TTS service).
 */
export class JaiTTSAdapter implements TTSProvider {
  readonly name = "jai-tts";
  readonly supportsStreaming = false;

  private readonly baseUrl: string;

  constructor(config: JaiTTSAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? "http://localhost:8002";
  }

  async speak(
    text: string,
    audioContext: AudioContext,
    opts?: { voice?: string; speed?: number; signal?: AbortSignal }
  ): Promise<void> {
    // Note: opts?.voice and opts?.speed are silently ignored per CONTEXT.md D-04
    // (jai-tts hardcodes voice and speed server-side)

    try {
      // Compose 60s timeout with caller-supplied signal (AbortSignal.any)
      const timeout = AbortSignal.timeout(60000); // 60 seconds
      const signal = opts?.signal
        ? AbortSignal.any([timeout, opts.signal].filter(Boolean))
        : timeout;

      // POST text to jai-tts
      const response = await fetch(`${this.baseUrl}/synthesize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`JaiTTS error: ${response.status} ${body}`);
      }

      // Get raw audio bytes
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      // Decode via caller-supplied AudioContext (auto-resamples jai-tts's 24kHz)
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Create playback node with dual-path routing (analyser + destination)
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Create analyser for lip-sync (same pattern as TTSPlayer)
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;

      // Connect: source → analyser → destination (dual path)
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      // Start playback
      source.start();

      // Return promise that resolves when playback ends
      return new Promise((resolve, reject) => {
        source.onended = () => resolve();
        source.onerror = (e) => reject(new Error(`JaiTTS playback error: ${e}`));
      });
    } catch (error) {
      // Normalize non-Error values to Error instances
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
