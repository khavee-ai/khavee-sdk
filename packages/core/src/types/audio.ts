/**
 * Audio analysis data for mouth/viseme animation
 */
export interface AudioData {
  volume: number;
  frequencies: Float32Array;
  timestamp: number;
}

/**
 * Mouth/viseme state for VRM lip sync
 */
export interface MouthState {
  aa: number;  // Open mouth (あ)
  ih: number;  // Smile mouth (い)
  ou: number;  // Pucker mouth (う)
  ee: number;  // Half open (え)
  oh: number;  // Round mouth (お)
}

/**
 * Phoneme data for lip sync (Japanese vowels)
 *
 * Phase 18 (VIS-01) extension: this same shape is reused for vendor timing
 * data instead of inventing a parallel VisemeEvent type (RESEARCH Pitfall 6).
 * When `source` is `"timing"`, `timestamp` is the absolute start time in ms
 * on the `performance.now()` clock and `duration` is in ms — adapters
 * convert vendor-relative offsets by adding the `performance.now()` value
 * captured at playback start. When `source` is absent or `"audio-analysis"`,
 * `timestamp` is whatever clock the client-side spectral classifier uses.
 */
export interface PhonemeData {
  phoneme: 'aa' | 'ih' | 'ou' | 'ee' | 'oh' | 'sil';
  intensity: number; // 0-1
  timestamp: number;
  duration?: number;
  /**
   * Origin of this viseme event (D-05). `"timing"` means vendor TTS timing
   * data (primary, most accurate). `"audio-analysis"` means the client-side
   * spectral classifier (fallback, used when no vendor timing exists).
   * Absent is treated the same as `"audio-analysis"`.
   */
  source?: 'timing' | 'audio-analysis';
  /** True on the first viseme of a word, when timing data provides word boundaries. */
  wordBoundary?: boolean;
}

/**
 * Audio stream configuration
 */
export interface AudioConfig {
  sampleRate?: number;
  bufferSize?: number;
  enableVolumeDetection?: boolean;
  enablePhonemeDetection?: boolean;
}