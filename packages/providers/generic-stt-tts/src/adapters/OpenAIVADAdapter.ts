/**
 * OpenAIVADAdapter — wraps @khaveeai/providers-openai-stt-tts's AudioRecorder
 * (a MicVAD lifecycle wrapper) to conform to the vendor-neutral VADProvider
 * interface (packages/core/src/types/pipeline.ts).
 *
 * This is a near-direct wrap (D-06 "Don't Hand-Roll") — AudioRecorder already
 * implements the MAX_WAV_BYTES oversized-blob guard and MicVAD start/stop
 * lifecycle; this adapter does not reimplement any of that, it only reshapes
 * the constructor-config call site (VADProvider.connect() takes no arguments,
 * while AudioRecorder.connect(config) does) and forwards events 1:1.
 */

import { VADProvider } from "@khaveeai/core";
import { AudioRecorder } from "@khaveeai/providers-openai-stt-tts";

/** Constructor config for OpenAIVADAdapter — forwarded to AudioRecorder.connect(). */
export interface OpenAIVADAdapterConfig {
  /** Base path MicVAD's worklet bundle is served from. Default: "/" (Next.js public/ root). */
  baseAssetPath?: string;
  /** Base path onnxruntime-web's WASM binaries are served from. Default: "/" (Next.js public/ root). */
  onnxWASMBasePath?: string;
  /** Duration of silence (ms) before ending a speech turn. Default: 1400 (AudioRecorder's own default). */
  silenceThresholdMs?: number;
  /** MicVAD positive speech probability threshold. Default: 0.5 (AudioRecorder's own default). */
  positiveSpeechThreshold?: number;
  /** MicVAD negative speech probability threshold. Default: 0.35 (AudioRecorder's own default). */
  negativeSpeechThreshold?: number;
}

/**
 * Adapts AudioRecorder to the VADProvider interface.
 */
export class OpenAIVADAdapter implements VADProvider {
  readonly name = "openai-vad";

  private readonly recorder: AudioRecorder;
  private readonly config: OpenAIVADAdapterConfig;

  constructor(config: OpenAIVADAdapterConfig = {}, recorder?: AudioRecorder) {
    this.config = config;
    this.recorder = recorder ?? new AudioRecorder();
  }

  /** Fired when the underlying recorder detects the start of speech. */
  get onSpeechStart(): (() => void) | undefined {
    return this.recorder.onSpeechStart;
  }
  set onSpeechStart(handler: (() => void) | undefined) {
    this.recorder.onSpeechStart = handler;
  }

  /** Fired with a WAV Blob when the underlying recorder detects the end of an utterance. */
  get onUtteranceReady(): ((wav: Blob) => void) | undefined {
    return this.recorder.onUtteranceReady;
  }
  set onUtteranceReady(handler: ((wav: Blob) => void) | undefined) {
    this.recorder.onUtteranceReady = handler;
  }

  /** Fired when a non-recoverable error occurs (e.g. oversized blob, MicVAD init failure). */
  get onError(): ((error: Error) => void) | undefined {
    return this.recorder.onError;
  }
  set onError(handler: ((error: Error) => void) | undefined) {
    this.recorder.onError = handler;
  }

  /**
   * Begin listening for speech. VADProvider.connect() takes no arguments —
   * the config supplied to this adapter's constructor is forwarded to
   * AudioRecorder.connect(config) here.
   */
  async connect(): Promise<void> {
    await this.recorder.connect(this.config);
  }

  async disconnect(): Promise<void> {
    await this.recorder.disconnect();
  }

  async pause(): Promise<void> {
    await this.recorder.pause();
  }

  async resume(): Promise<void> {
    await this.recorder.resume();
  }

  isListening(): boolean {
    return this.recorder.isListening();
  }
}
