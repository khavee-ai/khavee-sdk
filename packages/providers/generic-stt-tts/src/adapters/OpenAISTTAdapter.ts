/**
 * OpenAISTTAdapter — wraps @khaveeai/providers-openai-stt-tts's STTClient
 * (a multipart Whisper proxy client) to conform to the vendor-neutral
 * STTProvider interface (packages/core/src/types/pipeline.ts).
 *
 * STTClient.transcribe() returns a bare string; STTProvider.transcribe()
 * must return STTResult ({ text, rejected? }). This adapter wraps the
 * string return in { text } and omits `rejected` since STTClient has no
 * rejection heuristic — per STTResult's doc comment, vendors that never
 * reject simply omit the field.
 */

import { STTProvider, STTResult } from "@khaveeai/core";
import { STTClient } from "@khaveeai/providers-openai-stt-tts";

/** Constructor config for OpenAISTTAdapter. */
export interface OpenAISTTAdapterConfig {
  /** Full URL of the backend STT proxy endpoint. */
  endpoint: string;
  /** JWT bearer token for authenticating with the proxy. */
  authToken: string;
}

/**
 * Adapts STTClient to the STTProvider interface.
 */
export class OpenAISTTAdapter implements STTProvider {
  readonly name = "openai-stt";
  readonly supportsStreaming = false;
  readonly supportsRejection = false;

  private readonly endpoint: string;
  private readonly authToken: string;
  private readonly sttClient: STTClient;

  constructor(config: OpenAISTTAdapterConfig, sttClient?: STTClient) {
    this.endpoint = config.endpoint;
    this.authToken = config.authToken;
    this.sttClient = sttClient ?? new STTClient();
  }

  async transcribe(
    audio: Blob,
    opts?: { language?: string }
  ): Promise<STTResult> {
    const text = await this.sttClient.transcribe(
      audio,
      this.endpoint,
      this.authToken,
      opts?.language
    );
    return { text };
  }
}
