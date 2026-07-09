"use client";
import type {
  ChatStatus,
  Conversation,
  RealtimeTool,
  PhonemeData,
  MouthState,
} from "@khaveeai/core";
import { useCallback, useEffect, useState } from "react";
import { useKhavee } from "../KhaveeProvider";
import { useVRMExpressions } from "../VRMAvatar";

/**
 * Hook for real-time chat with OpenAI Realtime API
 * Based on your WebRTC implementation
 */
export function useRealtime() {
  const { realtimeProvider } = useKhavee();
  const { setMultipleExpressions } = useVRMExpressions();

  // State from provider
  const [isConnected, setIsConnected] = useState(false);
  const [chatStatus, setChatStatus] = useState<ChatStatus>("stopped");
  const [conversation, setConversation] = useState<Conversation[]>([]);
  const [currentVolume, setCurrentVolume] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(false);

  // Connect-failure cooldown: after a failed connect() attempt, block retries
  // for a few seconds instead of letting rapid re-clicks race the same failure.
  const [connectError, setConnectError] = useState<Error | null>(null);
  const [retryCooldownSeconds, setRetryCooldownSeconds] = useState(0);

  // Lip sync state
  const [currentPhoneme, setCurrentPhoneme] = useState<PhonemeData | null>(
    null
  );
  const [lipSyncAnalyzer, setLipSyncAnalyzer] =
    useState<RealtimeAudioAnalyzer | null>(null);

  if (!realtimeProvider) {
    throw new Error(
      "useRealtime must be used within KhaveeProvider with realtime config"
    );
  }

  // Setup event listeners and automatic lip sync
  useEffect(() => {
    const provider = realtimeProvider;

    // Preserve any existing onChatStatusChange/onError (e.g. KhaveeProvider's,
    // or a consumer's own 402-handling) so both receive updates. React runs
    // parent effects before child effects, so upstream callbacks are already
    // set when this runs.
    const upstreamChatStatusChange = provider.onChatStatusChange;
    const upstreamOnError = provider.onError;

    provider.onConnect = () => {
      setIsConnected(true);
      setConnectError(null);
    };
    provider.onError = (error) => {
      upstreamOnError?.(error);
      setConnectError(error);
      setRetryCooldownSeconds(5);
    };
    provider.onDisconnect = () => {
      setIsConnected(false);
      if (lipSyncAnalyzer) {
        lipSyncAnalyzer.stop();
        setLipSyncAnalyzer(null);
      }
      setCurrentPhoneme(null);
      setMultipleExpressions({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
    };

    provider.onConversationUpdate = (conv) => setConversation(conv);

    provider.onChatStatusChange = (status) => {
      // Forward to upstream subscriber (KhaveeProvider) first
      upstreamChatStatusChange?.(status);
      setChatStatus(status);
      setIsThinking(status === "thinking");
      // Reset mouth expressions whenever TTS stops so the avatar closes its mouth
      if (status !== "speaking") {
        setMultipleExpressions({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
      }
    };

    provider.onVolumeChange = (volume) => setCurrentVolume(volume);

    // Handle audio data availability for lip sync (TTS output only — never the mic)
    provider.onAudioData = (
      analyser: AnalyserNode,
      audioContext: AudioContext
    ) => {
      if (lipSyncAnalyzer) {
        lipSyncAnalyzer.updateAudioSource(analyser, audioContext);
      } else {
        // Create the analyzer only when TTS audio is available — no mic fallback
        startAutoLipSync();
      }
    };

    // Sync with provider state and setup continuous updates
    const updateStates = () => {
      setIsConnected(provider.isConnected);
      setChatStatus(provider.chatStatus);
      setConversation(provider.conversation);
      setCurrentVolume(provider.currentVolume);
      // Sync mic state with provider
      if (provider.isMicrophoneEnabled) {
        setIsMicEnabled(provider.isMicrophoneEnabled());
      }
    };

    updateStates();

    // Set up interval to continuously sync state (fallback)
    const stateSyncInterval = setInterval(updateStates, 100);

    return () => {
      // Cleanup listeners — restore upstream callback so KhaveeProvider keeps
      // receiving status updates even after this hook unmounts.
      provider.onConnect = undefined;
      provider.onDisconnect = undefined;
      provider.onConversationUpdate = undefined;
      provider.onChatStatusChange = upstreamChatStatusChange;
      provider.onError = upstreamOnError;
      provider.onVolumeChange = undefined;
      provider.onAudioData = undefined;

      // Cleanup state sync interval
      clearInterval(stateSyncInterval);

      // Stop lip sync
      if (lipSyncAnalyzer) {
        lipSyncAnalyzer.stop();
      }
    };
  }, [realtimeProvider]); // Remove lipSyncAnalyzer from dependencies to prevent recreation

  // Count the retry cooldown down to 0, one second at a time.
  useEffect(() => {
    if (retryCooldownSeconds <= 0) return;
    const timer = setTimeout(
      () => setRetryCooldownSeconds((s) => Math.max(0, s - 1)),
      1000
    );
    return () => clearTimeout(timer);
  }, [retryCooldownSeconds]);

  // Actions
  const connect = useCallback(async () => {
    // Block re-clicks while a prior failure's cooldown is still counting down —
    // avoids hammering the same failing connect() attempt back-to-back.
    if (retryCooldownSeconds > 0) return;
    await realtimeProvider.connect();
  }, [realtimeProvider, retryCooldownSeconds]);

  const disconnect = useCallback(async () => {
    await realtimeProvider.disconnect();
  }, [realtimeProvider]);

  const sendMessage = useCallback(
    async (text: string) => {
      await realtimeProvider.sendMessage(text);
    },
    [realtimeProvider]
  );

  const interrupt = useCallback(() => {
    realtimeProvider.interrupt();
  }, [realtimeProvider]);

  const registerFunction = useCallback(
    (tool: RealtimeTool) => {
      realtimeProvider.registerFunction(tool);
    },
    [realtimeProvider]
  );

  // Microphone control functions. Both are async now: if no mic stream exists
  // yet (permission denied/skipped at connect time), the provider re-prompts
  // and reconnects, so these may take as long as a full reconnect.
  const toggleMicrophone = useCallback(async () => {
    const newState = await realtimeProvider.toggleMicrophone();
    setIsMicEnabled(newState);
    return newState;
  }, [realtimeProvider]);

  const enableMicrophone = useCallback(async () => {
    await realtimeProvider.enableMicrophone();
    setIsMicEnabled(realtimeProvider.isMicrophoneEnabled());
  }, [realtimeProvider]);

  const disableMicrophone = useCallback(() => {
    realtimeProvider.disableMicrophone();
    setIsMicEnabled(false);
  }, [realtimeProvider]);

  // Auto lip sync functions
  const startAutoLipSync = useCallback(async () => {
    if (!realtimeProvider) return;

    // If analyzer already exists, don't create new one
    if (lipSyncAnalyzer) {
      console.log("Lip sync analyzer already running");
      return;
    }

    try {
      const analyzer = new RealtimeAudioAnalyzer({
        sensitivity: 0.2,
        intensityMultiplier: 6.0,
        minIntensity: 0.1,
        realtimeProvider: realtimeProvider,
        onPhonemeDetected: (phoneme: PhonemeData) => {
          setCurrentPhoneme(phoneme);

          // Convert phoneme to mouth state and apply to VRM
          const newMouthState = phonemeToMouthState(phoneme, 6.0);
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

      setLipSyncAnalyzer(analyzer);
      await analyzer.start();
    } catch (error) {
      console.error("Auto lip sync failed:", error);
    }
  }, [realtimeProvider, setMultipleExpressions]);

  const stopAutoLipSync = useCallback(() => {
    if (lipSyncAnalyzer) {
      lipSyncAnalyzer.stop();
      setLipSyncAnalyzer(null);
    }
    setCurrentPhoneme(null);
    setMultipleExpressions({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
  }, [lipSyncAnalyzer, setMultipleExpressions]);

  return {
    // State
    isConnected,
    chatStatus,
    conversation,
    currentVolume,
    isThinking,
    currentPhoneme, // Add lip sync state
    isMicEnabled, // Add microphone state
    connectError, // Last connect() failure, if any
    retryCooldownSeconds, // Seconds remaining before connect() is allowed again

    // Actions
    connect,
    disconnect,
    sendMessage,
    interrupt,
    registerFunction,

    // Microphone controls
    toggleMicrophone,
    enableMicrophone,
    disableMicrophone,

    // Lip sync controls for debugging
    startAutoLipSync,
    stopAutoLipSync,
  };
}

// MFCC-based phoneme templates for realtime lip sync
const phonemeTemplates: Record<string, number[][]> = {
  ee: [
    [34.8, 20.6, 6.7, 9.2, 8.3, 1.9, -4.2, -5, -2.6, -2.7, -3.2, -2.6, -0.9],
  ],
  aa: [
    [15.8, 9.7, 2.5, 1.1, 0, -1.5, -3.1, -2.8, -0.7, -0.3, -1.3, -1.4, -0.6],
  ],
  ou: [
    [24.7, 15.8, 7.8, 6.3, 0.6, -1.8, -2.1, -2.7, -1.3, -1.9, -2.6, -2.1, -1.6],
  ],
  oh: [
    [25.9, 21.3, 12, 3.6, -1.8, -4.1, -4, -2.8, -1.6, -1.5, -1.7, -1.6, -1.2],
  ],
  ih: [
    [26.1, 17.5, 7.1, 5.2, 3.1, 0.1, -3, -5.2, -3.7, -2, -2.6, -2.4, -0.8],
  ],
   sil: [
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1] // Very quiet variation
  ],
};

// Dynamic Time Warping algorithm
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

// Realtime audio analyzer class
class RealtimeAudioAnalyzer {
  private config: {
    sensitivity: number;
    intensityMultiplier?: number;
    minIntensity?: number;
    realtimeProvider: any;
    onPhonemeDetected: (phoneme: PhonemeData) => void;
  };
  private isRunning = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meydaAnalyzer: any = null;
  private lastPhoneme = "sil";
  private lastIntensity = 0;
  private isProcessing = false;
  private fallbackInterval: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(config: RealtimeAudioAnalyzer["config"]) {
    this.config = config;
  }

  async start() {
    this.isRunning = true;
    this.reconnectAttempts = 0;


    try {
      await this.attemptConnection();
    } catch (error) {
      console.error("Failed to setup realtime audio capture:", error);
      this.isRunning = false;
      throw error;
    }
  }

  private async attemptConnection() {
    // Only use audio provided by the realtime provider (TTS output).
    // Never open the microphone here — that would cause the avatar to lip-sync
    // with the user's own voice and the bot's TTS audio would re-trigger STT.
    const providerAudio = this.config.realtimeProvider.getAudioAnalyser?.();

    if (providerAudio) {
      this.analyser = providerAudio.analyser;
      this.audioContext = providerAudio.audioContext;
      this.setupMeydaAnalyzer();
    }
    // If provider has no audio yet (e.g. TTS hasn't played), do nothing —
    // updateAudioSource() will be called when the first TTS response arrives.
  }

  updateAudioSource(analyser: AnalyserNode, audioContext: AudioContext) {

    // Stop current Meyda analyzer
    if (this.meydaAnalyzer) {
      this.meydaAnalyzer.stop();
      this.meydaAnalyzer = null;
    }

    // Clear fallback interval
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }

    // Update to use provider's audio stream
    this.analyser = analyser;
    this.audioContext = audioContext;

    // Restart analysis with new audio source
    if (this.isRunning) {
      this.setupMeydaAnalyzer();
    }
  }

  stop() {
    this.isRunning = false;

    if (this.meydaAnalyzer) {
      this.meydaAnalyzer.stop();
      this.meydaAnalyzer = null;
    }

    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }

    // The audioContext belongs to the provider — do NOT close it here.
    // The provider manages its own AudioContext lifecycle.
    this.audioContext = null;
    this.analyser = null;
  }

  private async setupAudioCapture() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: false,
        audio: true,
      });

      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.6;

      source.connect(this.analyser);
      this.setupMeydaAnalyzer();
      return;
    } catch (error) {
      console.warn("Display media not available, using microphone fallback");

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        const source = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.6;

        source.connect(this.analyser);
        this.setupMeydaAnalyzer();
      } catch (micError) {
        throw new Error(
          "Could not setup any audio capture method for realtime lip sync"
        );
      }
    }
  }

  private setupMeydaAnalyzer() {
    if (!this.analyser || !this.audioContext) {
      console.warn(
        "Cannot setup Meyda analyzer: missing analyser or audioContext"
      );
      return;
    }

    try {
      console.log("Setting up Meyda analyzer...");

      import("meyda")
        .then((Meyda) => {
          if (!this.isRunning || !this.analyser || !this.audioContext) {
            console.log("Analyzer stopped before Meyda setup completed");
            return;
          }

          // Create a gain node to connect to Meyda
          const source = this.audioContext.createGain();
          this.analyser.connect(source);

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

          // Clear any fallback interval since Meyda is working
          if (this.fallbackInterval) {
            clearInterval(this.fallbackInterval);
            this.fallbackInterval = null;
          }
        })
        .catch((error) => {
          console.warn(
            "Meyda not available, using basic frequency analysis:",
            error
          );
          this.startFallbackAnalysis();
        });
    } catch (error) {
      console.warn(
        "Failed to setup MFCC analysis, using basic frequency analysis:",
        error
      );
      this.startFallbackAnalysis();
    }
  }

  private startFallbackAnalysis() {
    if (this.fallbackInterval) return; // Already running

    this.fallbackInterval = setInterval(() => {
      if (this.isRunning) {
        this.analyze();
      }
    }, 50) as any; // Run every 50ms
  }

  private analyzeWithMFCC(features: any) {
    if (!features?.mfcc || this.isProcessing) return;

    this.isProcessing = true;

    try {
      const liveMFCC = features.mfcc;
      let bestMatch: PhonemeData["phoneme"] = "sil";
      let lowestDistance = Infinity;
      let secondBestDistance = Infinity;

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

      const confidence =
        secondBestDistance > 0
          ? Math.min(1.0, secondBestDistance / Math.max(lowestDistance, 0.1))
          : 1.0;

      const baseThreshold = (1.0 - this.config.sensitivity) * 60;
      const dynamicThreshold = baseThreshold * (2.0 - confidence);

      if (lowestDistance < dynamicThreshold) {
        let intensity = Math.max(0, Math.min(1, 1 - lowestDistance / 60));

        intensity = intensity * confidence * 1.2;
        intensity = intensity * (this.config.sensitivity + 0.7);
        intensity = intensity * (this.config.intensityMultiplier || 1.0);

        intensity = Math.max(intensity, this.config.minIntensity || 0);
        intensity = Math.min(intensity, 1.0);

        const shouldUpdate =
          bestMatch !== this.lastPhoneme ||
          Math.abs(intensity - (this.lastIntensity || 0)) > 0.1;

        if (shouldUpdate && intensity > 0.05) {
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
    } catch (error) {
      console.error("Error in MFCC analysis:", error);
    }

    setTimeout(() => {
      this.isProcessing = false;
    }, 30);
  }

  private analyze() {
    if (!this.isRunning || !this.analyser) return;

    try {
      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);
      this.analyser.getFloatFrequencyData(dataArray);

      const phoneme = this.detectPhoneme(dataArray);

      if (phoneme.phoneme !== "sil") {
        this.config.onPhonemeDetected(phoneme);
      }
    } catch (error) {
      console.error("Error in frequency analysis:", error);

      // If error occurs repeatedly, try to reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log("Attempting to reconnect due to analysis error...");
        this.attemptConnection();
      }
    }

    // Don't use requestAnimationFrame in interval-based fallback
    // The interval will handle the timing
  }

  private detectPhoneme(frequencyData: Float32Array): PhonemeData {
    const peaks = this.findFormantPeaks(frequencyData);
    const overallIntensity = this.calculateIntensity(frequencyData);

    if (peaks.length < 2 || overallIntensity < 0.01) {
      return {
        phoneme: "sil",
        intensity: 0,
        timestamp: Date.now(),
        duration: 50,
      };
    }

    const f1 = peaks[0];
    const f2 = peaks[1];
    let intensity = overallIntensity * (this.config.sensitivity + 0.3);

    intensity = intensity * (this.config.intensityMultiplier || 1.0);
    intensity = Math.max(intensity, this.config.minIntensity || 0);
    intensity = Math.min(intensity, 1.0);

    let phoneme: PhonemeData["phoneme"] = "sil";
    let maxConfidence = 0;

    const classifications = [
      { phoneme: "aa", confidence: this.classifyAA(f1, f2) },
      { phoneme: "ih", confidence: this.classifyIH(f1, f2) },
      { phoneme: "ou", confidence: this.classifyOU(f1, f2) },
      { phoneme: "ee", confidence: this.classifyEE(f1, f2) },
      { phoneme: "oh", confidence: this.classifyOH(f1, f2) },
    ];

    for (const cls of classifications) {
      if (cls.confidence > maxConfidence && cls.confidence > 0.3) {
        maxConfidence = cls.confidence;
        phoneme = cls.phoneme as PhonemeData["phoneme"];
      }
    }

    intensity = intensity * (1 + maxConfidence * 0.5);
    intensity = Math.min(intensity, 1.0);

    return {
      phoneme,
      intensity: intensity,
      timestamp: Date.now(),
      duration: 50,
    };
  }

  private classifyAA(f1: number, f2: number): number {
    if (f1 > 450 && f1 < 850 && f2 > 900 && f2 < 1800) {
      const f1Score = 1 - Math.abs(f1 - 650) / 400;
      const f2Score = 1 - Math.abs(f2 - 1350) / 900;
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
    const sampleRate = 44100;
    const freqPerBin = sampleRate / (data.length * 2);

    for (let i = 2; i < data.length - 2; i++) {
      if (
        data[i] > data[i - 1] &&
        data[i] > data[i + 1] &&
        data[i] > data[i - 2] &&
        data[i] > data[i + 2] &&
        data[i] > -50
      ) {
        const freq = i * freqPerBin;
        if (freq > 80 && freq < 4000) {
          const prominence = Math.min(
            data[i] - data[i - 1],
            data[i] - data[i + 1]
          );
          peaks.push({ freq, magnitude: data[i] + prominence });
        }
      }
    }

    return peaks
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 6)
      .map((p) => p.freq)
      .sort((a, b) => a - b);
  }

  private calculateIntensity(data: Float32Array): number {
    let sum = 0;
    let count = 0;
    let peakSum = 0;
    let peakCount = 0;

    for (let i = 0; i < data.length; i++) {
      if (data[i] > -80) {
        const linearValue = Math.pow(10, data[i] / 12);
        sum += linearValue;
        count++;

        const freq = (i * 44100) / (data.length * 2);
        if (freq > 200 && freq < 3000 && data[i] > -50) {
          peakSum += linearValue;
          peakCount++;
        }
      }
    }

    const baseIntensity = count > 0 ? Math.sqrt(sum / count) : 0;
    const peakIntensity = peakCount > 0 ? Math.sqrt(peakSum / peakCount) : 0;

    const combinedIntensity = baseIntensity * 0.3 + peakIntensity * 0.7;
    return Math.min(combinedIntensity * 3.0, 1.0);
  }
}

// Convert phoneme data to VRM mouth state
function phonemeToMouthState(
  phoneme: PhonemeData,
  intensityMultiplier: number = 1.0
): MouthState {
  const state: MouthState = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

  if (phoneme.phoneme !== "sil" && phoneme.intensity > 0.01) {
    let boostedIntensity = phoneme.intensity * intensityMultiplier;

    const phonemeBoosts = {
      aa: 2.2,
      ih: 1.8,
      ou: 2.0,
      ee: 1.7,
      oh: 1.9,
    };

    boostedIntensity *= phonemeBoosts[phoneme.phoneme] || 1.0;
    boostedIntensity *= 1.8;
    boostedIntensity = Math.pow(boostedIntensity, 0.7);
    boostedIntensity = Math.min(boostedIntensity, 1.0);

    const minMovement = {
      aa: 0.25,
      ih: 0.15,
      ou: 0.2,
      ee: 0.15,
      oh: 0.18,
    };

    const finalIntensity = Math.max(
      boostedIntensity,
      minMovement[phoneme.phoneme] || 0.12
    );

    state[phoneme.phoneme] = finalIntensity;

    const blendRatio = 0.15;
    switch (phoneme.phoneme) {
      case "aa":
        state.oh = finalIntensity * blendRatio;
        break;
      case "ih":
        state.ee = finalIntensity * blendRatio;
        break;
      case "ou":
        state.oh = finalIntensity * blendRatio;
        break;
      case "ee":
        state.ih = finalIntensity * blendRatio;
        break;
      case "oh":
        state.aa = finalIntensity * blendRatio;
        break;
    }
  }

  return state;
}
