/**
 * AudioPlaybackEngine — Streaming PCM Playback + AnalyserNode
 *
 * Receives base64-encoded PCM16 chunks over WebSocket, decodes them to
 * Float32 samples, and schedules gapless playback via queued
 * AudioBufferSourceNodes. Exposes an AnalyserNode with the exact same
 * settings as OpenAIRealtimeProvider (fftSize=2048, smoothingTimeConstant=0.6)
 * so the React layer's MFCC/DTW phoneme detection drives lip-sync identically.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface AudioPlaybackEngineConfig {
  sampleRate: number;
}

// ── AudioPlaybackEngine ──────────────────────────────────────────────────────

export class AudioPlaybackEngine {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private nextScheduledTime = 0;
  private sampleRate: number;
  private _isPlaying = false;
  private pendingBufferCount = 0;

  /** Fires when the first audio chunk is scheduled for playback. */
  public onPlaybackStart?: () => void;
  /** Fires when all queued audio buffers have finished playing. */
  public onPlaybackEnd?: () => void;

  constructor(config: AudioPlaybackEngineConfig) {
    this.sampleRate = config.sampleRate;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Whether audio is currently being played. */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * Append a base64-encoded PCM16 chunk for streaming playback.
   * Lazily initializes AudioContext + AnalyserNode on the first call.
   */
  appendChunk(base64: string): void {
    this.ensureAudioContext();
    if (!this.audioContext || !this.gainNode) return;

    // Decode: base64 → binary → Int16 → Float32
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    // Create AudioBuffer
    const audioBuffer = this.audioContext.createBuffer(
      1,
      float32.length,
      this.sampleRate,
    );
    audioBuffer.getChannelData(0).set(float32);

    // Schedule playback
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);

    const now = this.audioContext.currentTime;
    if (this.nextScheduledTime < now) {
      // First chunk or gap — schedule with small latency buffer
      this.nextScheduledTime = now + 0.05;
    }
    source.start(this.nextScheduledTime);
    this.nextScheduledTime += audioBuffer.duration;

    this.scheduledSources.push(source);
    this.pendingBufferCount++;

    source.onended = () => {
      this.pendingBufferCount--;
      const idx = this.scheduledSources.indexOf(source);
      if (idx !== -1) this.scheduledSources.splice(idx, 1);

      if (this.pendingBufferCount <= 0 && this._isPlaying) {
        this._isPlaying = false;
        this.onPlaybackEnd?.();
      }
    };

    // Fire playback start on first chunk
    if (!this._isPlaying) {
      this._isPlaying = true;
      this.onPlaybackStart?.();
    }
  }

  /**
   * Stop all scheduled audio immediately (barge-in / interrupt).
   * Resets the scheduling queue.
   */
  cancel(): void {
    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch {
        // Already stopped — ignore
      }
    }
    this.scheduledSources = [];
    this.pendingBufferCount = 0;
    this.nextScheduledTime = 0;

    if (this._isPlaying) {
      this._isPlaying = false;
      this.onPlaybackEnd?.();
    }
  }

  /**
   * Returns the AnalyserNode + AudioContext for lip-sync analysis,
   * or null if the engine has not been initialized yet.
   */
  getAnalyser(): { analyser: AnalyserNode; audioContext: AudioContext } | null {
    if (this.analyserNode && this.audioContext) {
      return {
        analyser: this.analyserNode,
        audioContext: this.audioContext,
      };
    }
    return null;
  }

  /**
   * Close AudioContext and release all resources.
   */
  destroy(): void {
    this.cancel();
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
    }
    this.audioContext = null;
    this.analyserNode = null;
    this.gainNode = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Lazily create AudioContext, AnalyserNode (fftSize=2048,
   * smoothingTimeConstant=0.6), and GainNode with correct routing.
   */
  private ensureAudioContext(): void {
    if (this.audioContext) return;

    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });

    // AnalyserNode — must match OpenAIRealtimeProvider settings exactly
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.6;

    // GainNode as the single merge point for all source nodes
    this.gainNode = this.audioContext.createGain();

    // Routing: sources → GainNode → AnalyserNode (analysis-only path)
    //                             → destination (playback path)
    this.gainNode.connect(this.analyserNode);
    this.gainNode.connect(this.audioContext.destination);

    // Resume if suspended (browser autoplay policy)
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }
  }
}
