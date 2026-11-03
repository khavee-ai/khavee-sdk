/**
 * MicCaptureEngine — PCM Recording + Base64 Encoding
 *
 * Captures microphone audio via AudioWorklet, converts Float32 samples
 * to PCM16 (Int16), encodes to base64, and emits frames via callback.
 * Designed for xAI's Realtime API which expects base64-encoded PCM16
 * in `input_audio_buffer.append` messages.
 */

import { PCM_CAPTURE_PROCESSOR_SOURCE } from "./pcm-capture-processor";
import { RNNOISE_SAMPLE_RATE, createRnnoiseNode, destroyRnnoiseNode } from "./denoise";

export interface MicCaptureOptions {
  /** Input device id from enumerateDevices. Default: the system mic. */
  deviceId?: string;
  /**
   * "rnnoise" (default): RNNoise strips background noise in the browser.
   * "browser": the browser's built-in noiseSuppression only.
   */
  noiseReduction?: "rnnoise" | "browser";
  /**
   * Browser auto gain. Off by default: in a quiet room it turns the mic up,
   * which makes background chatter loud enough to open turns.
   */
  autoGainControl?: boolean;
}

// ── MicCaptureEngine ─────────────────────────────────────────────────────────

export class MicCaptureEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private _isEnabled = false;
  private sampleRate: number;
  private options: MicCaptureOptions;
  private denoiseNode: AudioWorkletNode | null = null;

  /** Fires with a base64-encoded PCM16 frame for each captured audio chunk. */
  public onAudioFrame?: (base64: string) => void;
  /** Fires on capture errors. */
  public onError?: (error: Error) => void;

  constructor(sampleRate: number = 24000, options: MicCaptureOptions = {}) {
    this.sampleRate = sampleRate;
    this.options = { noiseReduction: "rnnoise", autoGainControl: false, ...options };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Whether mic capture is actively sending frames. */
  get isEnabled(): boolean {
    return this._isEnabled;
  }

  /** The raw MediaStream, for potential reuse. */
  get stream(): MediaStream | null {
    return this.mediaStream;
  }

  /**
   * Initialize mic capture: request permission, set up AudioWorklet.
   * Must be called before enable(). Safe to call multiple times (no-op if
   * already initialized).
   */
  async initialize(): Promise<void> {
    if (this.audioContext) return;
    const useRnnoise = this.options.noiseReduction !== "browser";
    try {
      await this.setUpCapture(useRnnoise);
    } catch (error) {
      if (!useRnnoise) throw error;
      // RNNoise could not load (no AudioWorklet wasm support, blocked blob
      // URLs): fall back to the browser's own noise suppression.
      console.warn("RNNoise unavailable, using browser noise suppression:", error);
      this.teardown();
      await this.setUpCapture(false);
    }
  }

  private async setUpCapture(useRnnoise: boolean): Promise<void> {
    const contextRate = useRnnoise ? RNNOISE_SAMPLE_RATE : this.sampleRate;
    const deviceId = this.options.deviceId;

    // Request microphone access
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        sampleRate: contextRate,
        channelCount: 1,
        echoCancellation: true,
        // RNNoise replaces the browser's suppressor; stacking both muffles
        // speech.
        noiseSuppression: !useRnnoise,
        autoGainControl: this.options.autoGainControl ?? false,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: contextRate });

    // Register the worklet processor via Blob URL (avoids needing a static file)
    const blob = new Blob([PCM_CAPTURE_PROCESSOR_SOURCE], {
      type: "application/javascript",
    });
    const workletUrl = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    // Wire up: mic → source → [RNNoise] → capture worklet (→ 24 kHz frames)
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-capture-processor", {
      processorOptions: { decimate: contextRate / this.sampleRate },
    });

    // Listen for PCM frames from the worklet
    this.workletNode.port.onmessage = (event: MessageEvent) => {
      if (!this._isEnabled) return;
      const float32: Float32Array = event.data;
      const base64 = this.encodeFloat32ToBase64PCM16(float32);
      this.onAudioFrame?.(base64);
    };

    if (useRnnoise) {
      this.denoiseNode = await createRnnoiseNode(this.audioContext);
      this.sourceNode.connect(this.denoiseNode);
      this.denoiseNode.connect(this.workletNode);
    } else {
      this.sourceNode.connect(this.workletNode);
    }
    // Worklet does not connect to destination — capture only, no feedback loop
  }

  /**
   * Capture from another input device. A running capture is restarted on the
   * new device; a stopped one picks it up on its next enable().
   */
  async setDevice(deviceId?: string): Promise<void> {
    if (deviceId === this.options.deviceId) return;
    this.options.deviceId = deviceId;
    if (!this.audioContext) return;
    const wasEnabled = this._isEnabled;
    this.disable();
    if (wasEnabled) await this.enable();
  }

  /**
   * Start emitting audio frames. Calls initialize() if not yet done.
   */
  async enable(): Promise<void> {
    if (!this.audioContext) {
      await this.initialize();
    }
    if (this.audioContext && this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    this._isEnabled = true;
  }

  /**
   * Stop emitting audio frames and release mic tracks.
   */
  disable(): void {
    this._isEnabled = false;
    this.teardown();
  }

  /**
   * Release all resources: stop mic tracks, close AudioContext.
   */
  destroy(): void {
    this._isEnabled = false;
    this.teardown();
  }

  /** Stop mic tracks and release every audio node and the context. */
  private teardown(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.denoiseNode) {
      destroyRnnoiseNode(this.denoiseNode);
      this.denoiseNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
    }
    this.audioContext = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Convert Float32Array (range -1..1) to PCM16 Int16Array, then base64-encode.
   */
  private encodeFloat32ToBase64PCM16(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      // Clamp and scale to 16-bit range
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 32768 : s * 32767;
    }
    // Convert Int16Array to base64
    const bytes = new Uint8Array(int16.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
