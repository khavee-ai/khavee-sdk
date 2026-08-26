/**
 * MicCaptureEngine — PCM Recording + Base64 Encoding
 *
 * Captures microphone audio via AudioWorklet, converts Float32 samples
 * to PCM16 (Int16), encodes to base64, and emits frames via callback.
 * Designed for xAI's Realtime API which expects base64-encoded PCM16
 * in `input_audio_buffer.append` messages.
 */

import { PCM_CAPTURE_PROCESSOR_SOURCE } from "./pcm-capture-processor";

// ── MicCaptureEngine ─────────────────────────────────────────────────────────

export class MicCaptureEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private _isEnabled = false;
  private sampleRate: number;

  /** Fires with a base64-encoded PCM16 frame for each captured audio chunk. */
  public onAudioFrame?: (base64: string) => void;
  /** Fires on capture errors. */
  public onError?: (error: Error) => void;

  constructor(sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
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

    // Request microphone access
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: this.sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Create AudioContext matching the desired sample rate
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });

    // Register the worklet processor via Blob URL (avoids needing a static file)
    const blob = new Blob([PCM_CAPTURE_PROCESSOR_SOURCE], {
      type: "application/javascript",
    });
    const workletUrl = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    // Wire up: mic → source → worklet
    this.sourceNode = this.audioContext.createMediaStreamSource(
      this.mediaStream,
    );
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "pcm-capture-processor",
    );

    // Listen for PCM frames from the worklet
    this.workletNode.port.onmessage = (event: MessageEvent) => {
      if (!this._isEnabled) return;
      const float32: Float32Array = event.data;
      const base64 = this.encodeFloat32ToBase64PCM16(float32);
      this.onAudioFrame?.(base64);
    };

    this.sourceNode.connect(this.workletNode);
    // Worklet does not connect to destination — capture only, no feedback loop
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

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
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

  /**
   * Release all resources: stop mic tracks, close AudioContext.
   */
  destroy(): void {
    this._isEnabled = false;

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
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
