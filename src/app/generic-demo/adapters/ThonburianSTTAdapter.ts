/**
 * ThonburianSTTAdapter — demo-local STT adapter that posts whole VAD-segmented
 * utterances to the local thonburian-stt FastAPI service (port 8001) and returns
 * the Thai transcription.
 *
 * This adapter implements the STTProvider interface from @khaveeai/core but lives
 * in the demo app (not exported from the SDK package) as proof that the generic
 * pipeline works with non-OpenAI vendors.
 *
 * Wire format (verified in 04-CONTEXT.md):
 * - Request: POST /transcribe with multipart/form-data, field name "file" (not "audio")
 * - Response: JSON {"text": "<Thai transcript>"}
 * - Input audio: 16kHz/mono/float32 WAV from MicVAD's encodeWAV()
 * - No auth (local demo service)
 * - No rejection heuristic (thonburian-stt returns whatever Whisper produces)
 * - 60s timeout via AbortSignal.timeout() + opts?.signal composition
 */

import { STTProvider, STTResult } from "@khaveeai/core";

/** Constructor config for ThonburianSTTAdapter. */
export interface ThonburianSTTAdapterConfig {
  /** Base URL of the thonburian-stt service. Default: http://localhost:8001 */
  baseUrl?: string;
}

/**
 * Demo-local STT adapter that posts to thonburian-stt (Thai Whisper service).
 */
export class ThonburianSTTAdapter implements STTProvider {
  readonly name = "thonburian-stt";
  readonly supportsStreaming = false;
  readonly supportsRejection = false; // Thonburian-stt has no rejection heuristic

  private readonly baseUrl: string;

  constructor(config: ThonburianSTTAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? "http://localhost:8001";
  }

  async transcribe(
    audio: Blob,
    opts?: { language?: string; signal?: AbortSignal }
  ): Promise<STTResult> {
    // Note: opts?.language is silently ignored per CONTEXT.md D-04
    // (thonburian-stt always transcribes as Thai)

    try {
      // Compose 60s timeout with caller-supplied signal (AbortSignal.any)
      const timeout = AbortSignal.timeout(60000); // 60 seconds
      const signal = opts?.signal
        ? AbortSignal.any([timeout, opts.signal].filter(Boolean))
        : timeout;

      // Create multipart form data with field name "file" (NOT "audio" per CONTEXT.md)
      const formData = new FormData();
      formData.append("file", audio, "utterance.wav");

      const response = await fetch(`${this.baseUrl}/transcribe`, {
        method: "POST",
        body: formData,
        signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`ThonburianSTT error: ${response.status} ${body}`);
      }

      const data = await response.json();
      const text = data.text;

      if (typeof text !== "string") {
        throw new Error(
          `ThonburianSTT invalid response: expected {text: string}, got ${JSON.stringify(data)}`
        );
      }

      // Return STTResult without `rejected` field (thonburian-stt never rejects)
      return { text };
    } catch (error) {
      // Normalize non-Error values to Error instances
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
