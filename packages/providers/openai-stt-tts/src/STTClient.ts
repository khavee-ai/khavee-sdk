/**
 * STTClient — multipart Whisper proxy client.
 *
 * This is an internal helper class and is NOT exported from index.ts.
 *
 * Posts a WAV Blob as multipart/form-data to the backend STT proxy endpoint
 * and returns the transcript string. The OpenAI API key never reaches the
 * browser — all requests go through the backend proxy (T-03-03).
 *
 * Security notes:
 *   - JWT is sent via `Authorization: Bearer` header (not URL query param).
 *   - Content-Type is NOT set manually — the browser sets the multipart
 *     boundary automatically when `body` is a FormData instance.
 *   - The filename "utterance.wav" is always used so Whisper can infer the
 *     correct MIME type regardless of browser (T-03-04, RESEARCH Pitfall 3).
 */

/**
 * Handles transcription requests to the backend Whisper STT proxy.
 *
 * Internal class — not exported from index.ts.
 */
class STTClient {
  /**
   * Transcribe a WAV blob by posting it to the STT proxy endpoint.
   *
   * @param wavBlob    - WAV audio blob produced by AudioRecorder (audio/wav).
   * @param endpoint   - Full URL of the backend STT proxy (e.g. /api/v1/.../chat/stt).
   * @param authToken  - JWT bearer token for authenticating with the proxy.
   * @param language   - Optional BCP-47 language code forwarded to Whisper.
   * @returns The transcript text returned by the proxy.
   * @throws Error if the proxy responds with a non-2xx status or if the
   *         response body is missing the `transcript` field.
   */
  async transcribe(
    wavBlob: Blob,
    endpoint: string,
    authToken: string,
    language?: string,
  ): Promise<string> {
    const form = new FormData();

    // filename MUST be "utterance.wav" so Whisper matches extension to MIME type.
    form.append("audio", wavBlob, "utterance.wav");

    if (language) {
      form.append("language", language);
    }

    // Do NOT set Content-Type — the browser sets the multipart boundary.
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`STT proxy error: ${res.status} ${body}`);
    }

    type STTResponse =
      | { transcript: string }
      | { data: { transcript: string } };

    const json = (await res.json()) as STTResponse;

    // Accept both { transcript } and { data: { transcript } } shapes.
    let transcript: string | undefined;

    if ("transcript" in json) {
      transcript = json.transcript;
    } else if ("data" in json && "transcript" in json.data) {
      transcript = json.data.transcript;
    }

    if (transcript === undefined) {
      throw new Error("STT proxy response missing transcript");
    }

    return transcript;
  }
}

export { STTClient };
