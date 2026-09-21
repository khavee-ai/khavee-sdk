"use client";
import type { MouthState, PhonemeData } from "@khaveeai/core";
import { useCallback, useState } from "react";
import { useVRMExpressions } from "../VRMAvatar";

/**
 * Hook for lip-sync analysis from audio files
 * Analyzes pre-recorded audio for phoneme detection and mouth states
 *
 * @deprecated Since Phase 18, this hook is superseded by the viseme
 * lip-sync layer: VRMAvatar's built-in viseme step, fed automatically by
 * useRealtime's auto lip-sync, with coarticulation smoothing, debounced
 * analysis and additive jaw motion (VIS-04, D-08). This hook keeps working
 * unchanged — VRMAvatar only takes over mouth expressions while the viseme
 * channel is actively receiving data, so a consumer of this hook that never
 * wires up the viseme channel is unaffected. Removal is planned for a
 * future major version.
 */
export function useAudioLipSync() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentPhoneme, setCurrentPhoneme] = useState<PhonemeData | null>(
    null
  );
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(
    null
  );

  const { setMultipleExpressions } = useVRMExpressions();

  /**
   * Analyze audio file and sync lip movements
   */
  const analyzeLipSync = useCallback(
    async (
      audioUrl: string,
      options?: {
        sensitivity?: number; // 0.1 to 1.0
        smoothing?: number; // 0.1 to 1.0
        intensityMultiplier?: number; // 1.0 to 8.0 - boost mouth movement intensity (increased max)
        minIntensity?: number; // 0.0 to 1.0 - minimum intensity threshold
        onPhonemeChange?: (phoneme: PhonemeData) => void;
      }
    ) => {
      setIsAnalyzing(true);

      try {
        const audio = new Audio(audioUrl);
        setAudioElement(audio);

        const audioContext = new AudioContext();
        const source = audioContext.createMediaElementSource(audio);
        const analyser = audioContext.createAnalyser();

        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = options?.smoothing || 0.6; // Reduced for more responsive
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        // Start MFCC-based analysis with higher sensitivity
        const analyzer = new AudioFileAnalyzer(analyser, audioContext, {
          sensitivity: options?.sensitivity || 0.2, // Increased default sensitivity from 0
          intensityMultiplier: options?.intensityMultiplier || 6.0, // Increased from 4.0
          minIntensity: options?.minIntensity || 0.1, // Reduced from 0.3 for more movement
          audioSource: source, // Pass the audio source for Meyda
          onPhonemeDetected: (phoneme: PhonemeData) => {
            setCurrentPhoneme(phoneme);
            options?.onPhonemeChange?.(phoneme);

            // Convert phoneme to mouth state and apply to VRM with intensity boost
            const newMouthState = phonemeToMouthState(
              phoneme,
              options?.intensityMultiplier || 4.0 // Increased default multiplier
            );
            // Apply to VRM expressions - try both common VRM expression names
            const expressionUpdate = {
              aa: newMouthState.aa,
              ih: newMouthState.ih,
              ou: newMouthState.ou,
              ee: newMouthState.ee,
              oh: newMouthState.oh,
            };
            setMultipleExpressions(expressionUpdate);
          },
        });

        // Play audio and start analysis
        await audio.play();
        analyzer.start();

        // Stop analysis when audio ends
        audio.onended = () => {
          analyzer.stop();
          setIsAnalyzing(false);
          setCurrentPhoneme(null);
          setMultipleExpressions({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
        };
      } catch (error) {
        console.error("Audio lip-sync analysis failed:", error);
        setIsAnalyzing(false);
      }
    },
    []
  );

  /**
   * Stop current lip-sync analysis
   */
  const stopLipSync = useCallback(() => {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    setIsAnalyzing(false);
    setCurrentPhoneme(null);
  }, [audioElement]);

  return {
    analyzeLipSync,
    stopLipSync,
    isAnalyzing,
    currentPhoneme,
    audioElement,
  };
}

// Enhanced MFCC-based phoneme templates for VRM lip-sync
// Multiple variations per phoneme to account for different speakers and contexts
const phonemeTemplates: Record<string, number[][]> = {
  // "ee" / "i" sound - High frequency, bright vowel
  ee: [
    [45.2, 28.5, 12.8, 8.3, 4.1, -1.2, -6.8, -8.2, -5.1, -3.8, -4.2, -3.9, -2.1],
    [42.8, 25.9, 11.2, 7.6, 3.8, -0.8, -5.9, -7.8, -4.8, -3.2, -3.9, -3.6, -1.8],
    [48.1, 31.2, 14.5, 9.1, 4.8, -1.8, -7.5, -9.1, -5.8, -4.4, -4.8, -4.2, -2.6],
    [39.5, 23.8, 10.6, 6.9, 3.2, -0.5, -5.2, -6.9, -4.2, -2.9, -3.5, -3.1, -1.5],
  ],

  // "aa" / "a" sound - Open mouth, low frequency emphasis
  aa: [
    [18.5, 12.8, 4.2, 2.1, 1.2, -0.8, -4.5, -3.9, -1.8, -0.9, -1.5, -1.2, -0.4],
    [15.2, 10.5, 3.8, 1.8, 0.9, -1.2, -3.8, -3.5, -1.5, -0.7, -1.3, -1.1, -0.3],
    [21.8, 14.9, 5.1, 2.8, 1.8, -0.5, -5.2, -4.5, -2.2, -1.1, -1.8, -1.5, -0.6],
    [16.9, 11.2, 4.5, 2.3, 1.1, -1.0, -4.1, -3.8, -1.9, -0.8, -1.4, -1.3, -0.5],
  ],

  // "ou" / "u" sound - Rounded lips, mid-low frequency
  ou: [
    [32.1, 20.2, 9.8, 7.2, 2.8, -0.9, -3.5, -4.8, -2.1, -1.8, -2.9, -2.3, -1.4],
    [28.5, 17.8, 8.5, 6.1, 2.1, -0.6, -3.1, -4.2, -1.8, -1.5, -2.5, -2.0, -1.2],
    [35.8, 22.9, 11.2, 8.5, 3.5, -1.3, -4.2, -5.5, -2.6, -2.2, -3.4, -2.8, -1.8],
    [30.2, 18.9, 9.1, 6.8, 2.5, -0.8, -3.3, -4.5, -1.9, -1.6, -2.7, -2.2, -1.3],
  ],

  // "oh" / "o" sound - Rounded, mid frequency emphasis
  oh: [
    [38.5, 26.8, 15.2, 5.8, -1.2, -4.5, -5.2, -3.9, -2.2, -1.8, -2.1, -1.9, -1.5],
    [35.2, 24.1, 13.8, 4.9, -1.8, -3.8, -4.8, -3.5, -1.9, -1.5, -1.8, -1.6, -1.2],
    [41.8, 29.5, 16.8, 6.8, -0.8, -5.2, -5.8, -4.5, -2.6, -2.1, -2.5, -2.2, -1.8],
    [36.9, 25.2, 14.5, 5.2, -1.5, -4.1, -5.0, -3.8, -2.0, -1.7, -1.9, -1.7, -1.4],
  ],

  // "ih" / "ɪ" sound - Short front vowel, higher frequencies
  ih: [
    [35.8, 22.5, 8.9, 6.2, 4.2, 1.2, -3.5, -5.8, -4.1, -2.3, -2.8, -2.6, -1.1],
    [32.5, 19.8, 7.8, 5.5, 3.5, 0.8, -2.9, -5.2, -3.6, -1.9, -2.4, -2.1, -0.8],
    [38.9, 24.8, 10.1, 7.1, 5.1, 1.8, -4.2, -6.5, -4.8, -2.8, -3.3, -3.0, -1.5],
    [34.2, 21.1, 8.5, 5.8, 3.8, 1.0, -3.2, -5.5, -3.9, -2.1, -2.6, -2.3, -0.9],
  ],

  // Silence with multiple realistic variations including background noise patterns
  sil: [
    // Complete silence
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],

  ],
};


// Dynamic Time Warping algorithm for comparing MFCC sequences
function computeDTW(seq1: number[], seq2: number[]): number {
  const n = seq1.length;
  const m = seq2.length;
  const dtw: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(Infinity)
  );
  dtw[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = Math.abs(seq1[i - 1] - seq2[j - 1]);
      dtw[i][j] =
        cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
    }
  }

  return dtw[n][m];
}

/**
 * MFCC-based audio analyzer for lip-sync from file
 */
class AudioFileAnalyzer {
  private analyser: AnalyserNode;
  private audioContext: AudioContext;
  private isRunning = false;
  private config: {
    sensitivity: number;
    intensityMultiplier?: number;
    minIntensity?: number;
    audioSource?: AudioNode;
    onPhonemeDetected: (phoneme: PhonemeData) => void;
  };
  private meydaAnalyzer: any = null;
  private lastPhoneme = "sil";
  private lastIntensity = 0;
  private isProcessing = false;

  constructor(
    analyser: AnalyserNode,
    audioContext: AudioContext,
    config: AudioFileAnalyzer["config"]
  ) {
    this.analyser = analyser;
    this.audioContext = audioContext;
    this.config = config;
  }

  start() {
    this.isRunning = true;
    this.setupMeydaAnalyzer();
  }

  stop() {
    this.isRunning = false;
    if (this.meydaAnalyzer) {
      this.meydaAnalyzer.stop();
    }
  }

  private setupMeydaAnalyzer() {
    try {
      // Import Meyda dynamically to avoid SSR issues
      import("meyda")
        .then((Meyda) => {
          if (!this.isRunning) return;

          // Use provided audio source or create a gain node as fallback
          const source =
            this.config.audioSource || this.audioContext.createGain();

          this.meydaAnalyzer = Meyda.default.createMeydaAnalyzer({
            audioContext: this.audioContext,
            source: source,
            bufferSize: 512,
            featureExtractors: ["mfcc"],
            callback: (features: any) => {
              if (!this.isRunning || this.isProcessing) return;
              this.analyzeWithMFCC(features);
            },
          });

          this.meydaAnalyzer.start();
        })
        .catch((error) => {
          // Fallback to basic frequency analysis if Meyda is not available
          console.warn(
            "Meyda not available, using basic frequency analysis:",
            error
          );
          this.analyze();
        });
    } catch (error) {
      // Fallback to basic frequency analysis
      console.warn(
        "Failed to setup MFCC analysis, using basic frequency analysis:",
        error
      );
      this.analyze();
    }
  }

  private analyzeWithMFCC(features: any) {
    if (!features?.mfcc || this.isProcessing) return;

    this.isProcessing = true;

    const liveMFCC = features.mfcc;
    let bestMatch: PhonemeData["phoneme"] = "sil";
    let lowestDistance = Infinity;
    let secondBestDistance = Infinity;

    // Compare with phoneme templates using DTW
    for (const [phoneme, templateList] of Object.entries(phonemeTemplates)) {
      for (const templateMFCC of templateList) {
        const minLen = Math.min(templateMFCC.length, liveMFCC.length);
        const distance = computeDTW(
          liveMFCC.slice(0, minLen),
          templateMFCC.slice(0, minLen)
        );
        if (distance < lowestDistance) {
          secondBestDistance = lowestDistance;
          lowestDistance = distance;
          bestMatch = phoneme as PhonemeData["phoneme"];
        } else if (distance < secondBestDistance) {
          secondBestDistance = distance;
        }
      }
    }

    // Enhanced confidence calculation using distance ratio
    const confidence = secondBestDistance > 0 ? 
      Math.min(1.0, secondBestDistance / Math.max(lowestDistance, 0.1)) : 1.0;

    // Apply more aggressive sensitivity threshold
    const baseThreshold = (1.0 - this.config.sensitivity) * 60; // Reduced from 80
    const dynamicThreshold = baseThreshold * (2.0 - confidence); // Lower threshold for high confidence
    
    if (lowestDistance < dynamicThreshold) {
      let intensity = Math.max(0, Math.min(1, 1 - lowestDistance / 60)); // Reduced divisor

      // Enhanced intensity calculation with confidence boost
      intensity = intensity * confidence * 1.2; // Confidence boost
      intensity = intensity * (this.config.sensitivity + 0.7); // Increased base boost
      intensity = intensity * (this.config.intensityMultiplier || 1.0);
      
      // Ensure minimum movement for detected phonemes
      intensity = Math.max(intensity, this.config.minIntensity || 0);
      intensity = Math.min(intensity, 1.0);

      // Only update if significant change or new phoneme
      const shouldUpdate = bestMatch !== this.lastPhoneme || 
                          Math.abs(intensity - (this.lastIntensity || 0)) > 0.1;

      if (shouldUpdate && intensity > 0.05) { // Lower minimum intensity
        const phonemeData: PhonemeData = {
          phoneme: bestMatch,
          intensity: intensity,
          timestamp: Date.now(),
          duration: 50,
        };

        this.config.onPhonemeDetected(phonemeData);
        this.lastPhoneme = bestMatch;
        this.lastIntensity = intensity;
      }
    }

    // Reduced delay for more responsive updates
    setTimeout(() => {
      this.isProcessing = false;
    }, 30); // Reduced from 50ms
  }

  // Fallback method using basic frequency analysis
  private analyze() {
    if (!this.isRunning) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    this.analyser.getFloatFrequencyData(dataArray);

    // Detect phoneme from frequency data
    const phoneme = this.detectPhoneme(dataArray);

    if (phoneme.phoneme !== "sil") {
      this.config.onPhonemeDetected(phoneme);
    }

    // Continue analysis
    requestAnimationFrame(() => this.analyze());
  }

  private detectPhoneme(frequencyData: Float32Array): PhonemeData {
    const peaks = this.findFormantPeaks(frequencyData);
    const overallIntensity = this.calculateIntensity(frequencyData);

    if (peaks.length < 2 || overallIntensity < 0.01) { // Lower threshold
      return {
        phoneme: "sil",
        intensity: 0,
        timestamp: Date.now(),
        duration: 50,
      };
    }

    const f1 = peaks[0];
    const f2 = peaks[1];
    let intensity = overallIntensity * (this.config.sensitivity + 0.3); // Base boost

    // Apply intensity multiplier and minimum threshold for fallback analysis
    intensity = intensity * (this.config.intensityMultiplier || 1.0);
    intensity = Math.max(intensity, this.config.minIntensity || 0);
    intensity = Math.min(intensity, 1.0);

    // Enhanced Japanese vowel classification with overlapping ranges
    let phoneme: PhonemeData["phoneme"] = "sil";
    let maxConfidence = 0;

    // Multiple classification attempts with confidence scoring
    const classifications = [
      { phoneme: "aa", confidence: this.classifyAA(f1, f2) },
      { phoneme: "ih", confidence: this.classifyIH(f1, f2) },
      { phoneme: "ou", confidence: this.classifyOU(f1, f2) },
      { phoneme: "ee", confidence: this.classifyEE(f1, f2) },
      { phoneme: "oh", confidence: this.classifyOH(f1, f2) },
    ];

    for (const cls of classifications) {
      if (cls.confidence > maxConfidence && cls.confidence > 0.3) { // Lower confidence threshold
        maxConfidence = cls.confidence;
        phoneme = cls.phoneme as PhonemeData["phoneme"];
      }
    }

    // Boost intensity based on classification confidence
    intensity = intensity * (1 + maxConfidence * 0.5);
    intensity = Math.min(intensity, 1.0);

    return {
      phoneme,
      intensity: intensity,
      timestamp: Date.now(),
      duration: 50,
    };
  }

  // Enhanced classification methods with confidence scoring
  private classifyAA(f1: number, f2: number): number {
    if (f1 > 450 && f1 < 850 && f2 > 900 && f2 < 1800) {
      const f1Score = 1 - Math.abs(f1 - 650) / 400; // Ideal around 650Hz
      const f2Score = 1 - Math.abs(f2 - 1350) / 900; // Ideal around 1350Hz
      return Math.max(0, Math.min(1, (f1Score + f2Score) / 2));
    }
    return 0;
  }

  private classifyIH(f1: number, f2: number): number {
    if (f1 > 250 && f1 < 500 && f2 > 1700 && f2 < 2400) {
      const f1Score = 1 - Math.abs(f1 - 375) / 250;
      const f2Score = 1 - Math.abs(f2 - 2050) / 700;
      return Math.max(0, Math.min(1, (f1Score + f2Score) / 2));
    }
    return 0;
  }

  private classifyOU(f1: number, f2: number): number {
    if (f1 > 250 && f1 < 500 && f2 > 600 && f2 < 1200) {
      const f1Score = 1 - Math.abs(f1 - 375) / 250;
      const f2Score = 1 - Math.abs(f2 - 900) / 600;
      return Math.max(0, Math.min(1, (f1Score + f2Score) / 2));
    }
    return 0;
  }

  private classifyEE(f1: number, f2: number): number {
    if (f1 > 350 && f1 < 700 && f2 > 1500 && f2 < 2200) {
      const f1Score = 1 - Math.abs(f1 - 525) / 350;
      const f2Score = 1 - Math.abs(f2 - 1850) / 700;
      return Math.max(0, Math.min(1, (f1Score + f2Score) / 2));
    }
    return 0;
  }

  private classifyOH(f1: number, f2: number): number {
    if (f1 > 350 && f1 < 700 && f2 > 700 && f2 < 1500) {
      const f1Score = 1 - Math.abs(f1 - 525) / 350;
      const f2Score = 1 - Math.abs(f2 - 1100) / 800;
      return Math.max(0, Math.min(1, (f1Score + f2Score) / 2));
    }
    return 0;
  }

  private findFormantPeaks(data: Float32Array): number[] {
    const peaks: { freq: number; magnitude: number }[] = [];
    const sampleRate = 44100; // Assume standard sample rate
    const freqPerBin = sampleRate / (data.length * 2);

    // Find peaks in frequency spectrum with improved detection
    for (let i = 2; i < data.length - 2; i++) {
      // Use wider peak detection window
      if (data[i] > data[i - 1] && data[i] > data[i + 1] && 
          data[i] > data[i - 2] && data[i] > data[i + 2] && 
          data[i] > -50) { // Lowered threshold from -40
        const freq = i * freqPerBin;
        if (freq > 80 && freq < 4000) { // Extended upper range
          // Calculate peak prominence
          const prominence = Math.min(
            data[i] - data[i - 1],
            data[i] - data[i + 1]
          );
          peaks.push({ freq, magnitude: data[i] + prominence });
        }
      }
    }

    // Sort by magnitude and return top formants
    return peaks
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 6) // Increased from 4 to get more formants
      .map((p) => p.freq)
      .sort((a, b) => a - b); // Sort by frequency for F1, F2, F3 order
  }

  private calculateIntensity(data: Float32Array): number {
    let sum = 0;
    let count = 0;
    let peakSum = 0;
    let peakCount = 0;

    for (let i = 0; i < data.length; i++) {
      if (data[i] > -80) { // Even lower threshold to catch more audio
        const linearValue = Math.pow(10, data[i] / 12); // More sensitive conversion
        sum += linearValue;
        count++;
        
        // Track peak energy in speech frequencies
        const freq = (i * 44100) / (data.length * 2);
        if (freq > 200 && freq < 3000 && data[i] > -50) {
          peakSum += linearValue;
          peakCount++;
        }
      }
    }

    const baseIntensity = count > 0 ? Math.sqrt(sum / count) : 0;
    const peakIntensity = peakCount > 0 ? Math.sqrt(peakSum / peakCount) : 0;
    
    // Combine base and peak intensity with bias toward peaks
    const combinedIntensity = (baseIntensity * 0.3 + peakIntensity * 0.7);
    return Math.min(combinedIntensity * 3.0, 1.0); // Increased multiplier from 2.0
  }
}

/**
 * Convert phoneme data to VRM mouth state with enhanced intensity boost
 */
function phonemeToMouthState(
  phoneme: PhonemeData,
  intensityMultiplier: number = 1.0
): MouthState {
  const state: MouthState = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

  if (phoneme.phoneme !== "sil" && phoneme.intensity > 0.01) { // Even lower threshold
    // Enhanced intensity calculation with multiple boost stages
    let boostedIntensity = phoneme.intensity * intensityMultiplier;
    
    // Apply progressive intensity boosts based on phoneme type
    const phonemeBoosts = {
      aa: 2.2, // Open mouth - most dramatic
      ih: 1.8, // Smile - moderate boost
      ou: 2.0, // Pucker - dramatic
      ee: 1.7, // Half open - moderate
      oh: 1.9, // Round - dramatic
    };
    
    boostedIntensity *= phonemeBoosts[phoneme.phoneme] || 1.0;
    boostedIntensity *= 1.8; // Additional global boost
    
    // Apply exponential curve for more dramatic movement
    boostedIntensity = Math.pow(boostedIntensity, 0.7); // Slightly compress peaks
    boostedIntensity = Math.min(boostedIntensity, 1.0);
    
    // Ensure minimum dramatic movement for detected phonemes
    const minMovement = {
      aa: 0.25, // Open mouth needs significant movement
      ih: 0.15, // Smile can be subtle
      ou: 0.20, // Pucker needs good visibility
      ee: 0.15, // Half open moderate
      oh: 0.18, // Round good visibility
    };
    
    const finalIntensity = Math.max(
      boostedIntensity, 
      minMovement[phoneme.phoneme] || 0.12
    );
    
    state[phoneme.phoneme] = finalIntensity;
    
    // Add subtle movement to adjacent phonemes for more natural look
    const blendRatio = 0.15;
    switch (phoneme.phoneme) {
      case "aa":
        state.oh = finalIntensity * blendRatio; // aa blends with oh
        break;
      case "ih":
        state.ee = finalIntensity * blendRatio; // ih blends with ee
        break;
      case "ou":
        state.oh = finalIntensity * blendRatio; // ou blends with oh
        break;
      case "ee":
        state.ih = finalIntensity * blendRatio; // ee blends with ih
        break;
      case "oh":
        state.aa = finalIntensity * blendRatio; // oh blends with aa
        break;
    }
  }

  return state;
}
