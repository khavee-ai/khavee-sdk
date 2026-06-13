/**
 * TTSPlayer — TTS fetch + Web Audio decode + dual-path lip-sync playback (internal,
 * not exported from index.ts)
 *
 * Fetches TTS audio from the backend proxy, decodes it via the Web Audio API, and
 * plays it through an AudioBufferSourceNode connected to BOTH an AnalyserNode (for
 * lip-sync analysis) and audioContext.destination (for audible playback).
 *
 * IMPORTANT: Do NOT import anything from "openai/helpers/audio" or use playAudio —
 * those helpers are Node.js-only (they spawn ffplay via child_process). All audio
 * handling here uses the browser Web Audio API exclusively.
 *
 * No HTMLAudioElement, no createMediaElementSource — this uses AudioBufferSourceNode
 * connected directly to the destination (RESEARCH Anti-Patterns).
 */

/** Arguments describing a single TTS request. */
type SpeakConfig = {
  endpoint: string;
  authToken: string;
  voice: string;
  speed: number;
  model: string;
  /** Optional voice style instructions for gpt-4o-mini-tts. */
  instructions?: string;
};

/**
 * Fetches TTS audio from the backend proxy, decodes it in the browser, and plays
 * it back via Web Audio API with a dual-path analyser for lip-sync.
 *
 * Internal class — NOT re-exported from index.ts.
 */
export class TTSPlayer {
  private abortController: AbortController | null = null;
  private source: AudioBufferSourceNode | null = null;

  /**
   * Fetch TTS audio, decode it, and play it back.
   *
   * Dual-path setup (RESEARCH Pattern 4):
   *   source → analyser  (analysis path, feeds lip-sync)
   *   source → destination  (playback path, audible output)
   *
   * onAudioData is called only after await audioContext.resume() resolves AND
   * audioContext.state === "running" — this prevents the lip-sync from flat-lining
   * when the AudioContext starts in "suspended" state (RESEARCH Pitfall 4).
   *
   * arrayBuffer.slice(0) is required because AudioContext.decodeAudioData() detaches
   * (transfers) the underlying ArrayBuffer, making it unusable afterwards.
   *
   * If cancel() is called while the fetch is in-flight, the AbortError is caught
   * silently — an interrupted TTS is a normal operation, not a failure.
   */
  async speak(
    text: string,
    config: SpeakConfig,
    audioContext: AudioContext,
    onAudioData: (analyser: AnalyserNode, ctx: AudioContext) => void
  ): Promise<void> {
    // Step 1: create a fresh AbortController for this request
    this.abortController = new AbortController();

    let res: Response;
    try {
      // Step 2: fetch TTS audio from the backend proxy
      res = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.authToken}`,
        },
        body: JSON.stringify({
          text,
          voice: config.voice,
          speed: config.speed,
          model: config.model,
          ...(config.instructions ? { ttsInstructions: config.instructions } : {}),
        }),
        signal: this.abortController.signal,
      });
    } catch (err) {
      // Silently swallow AbortError — cancel() is a normal operation
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      throw err;
    }

    if (!res.ok) {
      throw new Error(`TTS proxy error: ${res.status}`);
    }

    // Step 3: read the binary audio response
    const arrayBuffer = await res.arrayBuffer();

    // Step 4: decode — use arrayBuffer.slice(0) because decodeAudioData() transfers
    // (detaches) the passed ArrayBuffer, making any further access throw a TypeError
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

    // Step 5: create buffer source and store a reference for cancel()
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    this.source = source;

    // Step 6: create analyser with the same parameters as OpenAIRealtimeProvider
    // (fftSize=2048, smoothingTimeConstant=0.6 — mirrors setupAudioOutputAnalysis)
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;

    // Step 7: dual-path connections
    //   Analysis path: source → analyser (feeds lip-sync via onAudioData)
    //   Playback path: source → destination (audible output)
    // NO HTMLAudioElement, NO createMediaElementSource (RESEARCH Anti-Patterns)
    source.connect(analyser);
    source.connect(audioContext.destination);

    // Step 8: resume the AudioContext (may be suspended when created outside a
    // synchronous user-gesture handler) — fire onAudioData AFTER resume() resolves
    await audioContext.resume();
    if (audioContext.state === "running") {
      onAudioData(analyser, audioContext);
    }

    // Step 9: start playback and resolve when the source finishes
    source.start();

    return new Promise<void>((resolve) => {
      source.onended = () => {
        this.source = null;
        resolve();
      };
    });
  }

  /**
   * Cancel any in-flight TTS fetch and stop current audio playback.
   *
   * This method NEVER throws — stopping an already-ended source throws
   * internally, which is silently swallowed.
   *
   * Called by OpenAISTTTTSProvider.interrupt() (Plan 04, SDK-08).
   */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;

    try {
      this.source?.stop();
    } catch {
      // source.stop() throws if the source has already ended — ignore
    }
    this.source = null;
  }
}
