/**
 * AudioRecorder — MicVAD lifecycle wrapper producing WAV blobs.
 *
 * This is an internal helper class and is NOT exported from index.ts.
 *
 * Next.js asset prerequisite:
 *   MicVAD fetches three files at runtime from `baseAssetPath`/`onnxWASMBasePath`:
 *     - vad.worklet.bundle.min.js   (audio worklet)
 *     - silero_vad_legacy.onnx / silero_vad_v5.onnx  (Silero VAD model)
 *     - ort-wasm*.wasm              (onnxruntime-web WASM binaries)
 *
 *   These files are copied into apps/web/public/ by Task 3 of Plan 03-02.
 *   Without them, MicVAD.new() rejects with the worklet-not-found error
 *   (RESEARCH Pitfall 2 warning sign).
 *
 *   The default baseAssetPath and onnxWASMBasePath are "/" (not "./") because
 *   Next.js serves public/ from the root URL, not relative to the page path.
 */

import { MicVAD, utils } from "@ricky0123/vad-web";
import { OpenAISTTTTSConfig } from "./OpenAISTTTTSProvider";

/** Maximum allowed WAV blob size in bytes (24 MB). Oversized blobs are rejected
 *  before any network call to prevent Denial-of-Service on the STT proxy (T-03-02). */
const MAX_WAV_BYTES = 24_000_000;

/** Subset of OpenAISTTTTSConfig fields consumed by AudioRecorder. */
type AudioRecorderConfig = Pick<
  OpenAISTTTTSConfig,
  | "baseAssetPath"
  | "onnxWASMBasePath"
  | "silenceThresholdMs"
  | "positiveSpeechThreshold"
  | "negativeSpeechThreshold"
>;

/**
 * Wraps @ricky0123/vad-web MicVAD for non-React (plain TypeScript) usage.
 * Fires `onSpeechStart` when the user starts speaking and `onUtteranceReady`
 * with a WAV Blob when the user stops speaking.
 *
 * Internal class — not exported from index.ts.
 */
class AudioRecorder {
  /** Called when MicVAD detects the start of speech. */
  public onSpeechStart?: () => void;

  /**
   * Called with a WAV Blob when MicVAD detects the end of an utterance.
   * Never fires for blobs exceeding MAX_WAV_BYTES — use onError instead.
   */
  public onUtteranceReady?: (wav: Blob) => void;

  /** Called when a non-recoverable error occurs (e.g. oversized blob, MicVAD init failure). */
  public onError?: (error: Error) => void;

  /** The underlying MicVAD instance, or null when not connected. */
  private vad: MicVAD | null = null;

  /**
   * Initialize MicVAD with the provided config and begin listening.
   *
   * @param config - Subset of OpenAISTTTTSConfig controlling VAD sensitivity
   *                 and asset serving paths.
   */
  async connect(config: AudioRecorderConfig): Promise<void> {
    try {
      this.vad = await MicVAD.new({
        onSpeechStart: () => {
          this.onSpeechStart?.();
        },
        onSpeechEnd: (audio: Float32Array) => {
          const wavBuffer = utils.encodeWAV(audio);
          const wav = new Blob([wavBuffer], { type: "audio/wav" });

          // Guard against oversized blobs before any network call (T-03-02).
          if (wav.size > MAX_WAV_BYTES) {
            this.onError?.(new Error("Recording too large"));
            return;
          }

          this.onUtteranceReady?.(wav);
        },
        positiveSpeechThreshold: config.positiveSpeechThreshold ?? 0.5,
        negativeSpeechThreshold: config.negativeSpeechThreshold ?? 0.35,
        redemptionMs: config.silenceThresholdMs ?? 1400,
        // Default "/" (not "./") because Next.js serves public/ from the root URL.
        baseAssetPath: config.baseAssetPath ?? "/",
        onnxWASMBasePath: config.onnxWASMBasePath ?? "/",
      });

      await this.vad.start();
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Tear down the MicVAD instance and release the microphone.
   * Safe to call when not connected.
   */
  async disconnect(): Promise<void> {
    if (this.vad) {
      await this.vad.destroy();
      this.vad = null;
    }
  }

  /**
   * Pause speech detection without releasing the microphone.
   * Used by disableMicrophone().
   */
  async pause(): Promise<void> {
    if (this.vad) {
      await this.vad.pause();
    }
  }

  /**
   * Resume speech detection after a pause.
   * Used by enableMicrophone().
   */
  async resume(): Promise<void> {
    if (this.vad) {
      await this.vad.start();
    }
  }

  /**
   * Returns true when a MicVAD instance is active (connected and not destroyed).
   */
  isListening(): boolean {
    return this.vad !== null;
  }
}

export { AudioRecorder };
