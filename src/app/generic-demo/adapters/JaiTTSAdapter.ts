/**
 * JaiTTSAdapter — demo-local TTS adapter that posts Thai text to the local
 * jai-tts FastAPI service (port 8002), receives raw WAV audio bytes, decodes
 * them via the caller-supplied AudioContext, and plays them through dual-path
 * nodes (analyser + destination) for lip-sync compatibility.
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
    opts: {
      audioContext: AudioContext;
      onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;
      voice?: string;
      speed?: number;
      signal?: AbortSignal;
    }
  ): Promise<void> {
    try {
      // POST text to jai-tts
      const response = await fetch(`${this.baseUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: opts.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`JaiTTS error: ${response.status} ${body}`);
      }

      // Get raw audio bytes and decode
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await opts.audioContext.decodeAudioData(arrayBuffer);

      // Create playback node
      const source = opts.audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Create analyser for lip-sync
      const analyser = opts.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;

      // Call onAudioData callback if provided
      if (opts.onAudioData) {
        opts.onAudioData(analyser, opts.audioContext);
      }

      // Connect and play
      source.connect(analyser);
      analyser.connect(opts.audioContext.destination);
      source.start();

      // Wait for playback to complete
      return new Promise((resolve) => {
        source.onended = () => resolve();
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
