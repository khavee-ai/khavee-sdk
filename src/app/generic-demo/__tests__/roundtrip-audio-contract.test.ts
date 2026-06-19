/**
 * Round-trip audio contract test for Phase 4 generic demo.
 *
 * OPT-IN TEST: Not part of default `pnpm test` suite.
 * Requires both thonburian-stt (port 8001) and jai-tts (port 8002) running.
 *
 * Run explicitly:
 *   vitest run src/app/generic-demo/__tests__/roundtrip-audio-contract.test.ts
 *
 * Validates:
 * - STT leg: WAV → thonburian-stt → JSON transcript
 * - TTS leg: Text → jai-tts → WAV decode
 * - Round-trip: Utterance → transcript → synthesized audio (format validation only)
 */

import { describe, it, expect, beforeAll } from 'vitest';

// ── Test configuration ─────────────────────────────────────────────────────

const THONBURIAN_URL = 'http://localhost:8001';
const JAITTS_URL = 'http://localhost:8002';

// ── Test setup ───────────────────────────────────────────────────────────

describe('Round-trip audio contract validation', () => {
  beforeAll(async () => {
    // Fail fast if services aren't running
    await checkService(THONBURIAN_URL, '/transcribe', 'thonburian-stt');
    await checkService(JAITTS_URL, '/synthesize', 'jai-tts');
  });

  // ── STT leg: WAV → thonburian-stt → JSON transcript ───────────────────────

  it('STT: posts WAV to thonburian-stt and returns JSON transcript', async () => {
    // Generate a minimal valid WAV file (16kHz/mono/float32 per AUDIO_FORMAT.md)
    const wavBlob = generateFloat32WAV(16000, 1.0); // 1 second of silence

    const formData = new FormData();
    formData.append('file', wavBlob, 'utterance.wav');

    const response = await fetch(`${THONBURIAN_URL}/transcribe`, {
      method: 'POST',
      body: formData,
    });

    expect(response.ok).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('text');
    expect(typeof data.text).toBe('string');

    // Note: For silence input, Whisper may return empty string or hallucination
    // We're validating wire format here, not transcript quality
  });

  // ── TTS leg: Text → jai-tts → WAV decode ───────────────────────────────────

  it('TTS: posts text to jai-tts and returns decodable WAV audio', async () => {
    const response = await fetch(`${JAITTS_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'สวัสดีครับ' }),
    });

    expect(response.ok).toBeTruthy();
    expect(response.headers.get('content-type')).toMatch(/audio\/wav/);

    const arrayBuffer = await response.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(44); // At least WAV header

    // Verify it's a valid WAV by checking the header
    const view = new DataView(arrayBuffer);
    const riffHeader = view.getUint32(0, true); // Little-endian
    expect(riffHeader).toBe(0x46464952); // "RIFF" in ASCII

    // Note: Actual AudioContext decode requires browser environment
    // In Node/vitest, we validate header structure instead
  });

  // ── Round-trip: Format validation only (not content equality) ────────────────

  it('Round-trip: validates both directions produce valid formats', async () => {
    // STT direction: Generate WAV → POST → expect JSON response
    const wavBlob = generateFloat32WAV(16000, 0.5);

    const sttFormData = new FormData();
    sttFormData.append('file', wavBlob, 'utterance.wav');

    const sttResponse = await fetch(`${THONBURIAN_URL}/transcribe`, {
      method: 'POST',
      body: sttFormData,
    });

    expect(sttResponse.ok).toBeTruthy();
    const sttData = await sttResponse.json();
    expect(sttData).toHaveProperty('text');

    // TTS direction: Use transcript → POST → expect WAV response
    const textToSynthesize = sttData.text || 'ทดสอบ'; // Fallback if empty
    const ttsResponse = await fetch(`${JAITTS_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textToSynthesize }),
    });

    expect(ttsResponse.ok).toBeTruthy();
    expect(ttsResponse.headers.get('content-type')).toMatch(/audio\/wav/);

    const ttsArrayBuffer = await ttsResponse.arrayBuffer();
    expect(ttsArrayBuffer.byteLength).toBeGreaterThan(44);

    // Verify WAV header
    const ttsView = new DataView(ttsArrayBuffer);
    const ttsRiffHeader = ttsView.getUint32(0, true);
    expect(ttsRiffHeader).toBe(0x46464952); // "RIFF"
  });
});

// ── Helper functions ────────────────────────────────────────────────────────

/**
 * Check if a service is running before starting tests.
 */
async function checkService(baseUrl: string, path: string, name: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST', // Use POST since both services only accept POST
      body: new FormData(), // Empty body will error, but we just want to check connectivity
    });
  } catch (error) {
    throw new Error(
      `Service ${name} at ${baseUrl} is not running. ` +
      `Start it with: uvicorn main:app --reload --port ${baseUrl.split(':').pop()}`
    );
  }
}

/**
 * Generate a minimal WAV file with float32 PCM samples.
 *
 * @param sampleRate - Sample rate in Hz (e.g., 16000 for STT input)
 * @param durationSeconds - Duration in seconds
 * @returns WAV blob ready for multipart upload
 */
function generateFloat32WAV(sampleRate: number, durationSeconds: number): Blob {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 4; // 32-bit float = 4 bytes
  const dataSize = numSamples * bytesPerSample;
  const totalSize = 36 + dataSize; // WAV header + data

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // ── WAV header ─────────────────────────────────────────────────────────────

  // RIFF chunk descriptor
  view.setUint32(0, 0x46464952, true); // "RIFF"
  view.setUint32(4, 36 + dataSize, true); // File size - 8
  view.setUint32(8, 0x45564157, true); // "WAVE"

  // fmt sub-chunk
  view.setUint32(12, 0x20746d66, true); // "fmt "
  view.setUint32(16, 16, true); // Sub-chunk size (16 for PCM)
  view.setUint16(20, 3, true); // Audio format (3 = IEEE float)
  view.setUint16(22, 1, true); // Num channels (mono)
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, sampleRate * bytesPerSample, true); // Byte rate
  view.setUint16(32, bytesPerSample, true); // Block align
  view.setUint16(34, 32, true); // Bits per sample

  // data sub-chunk
  view.setUint32(36, 0x61746164, true); // "data"
  view.setUint32(40, dataSize, true); // Data size

  // ── PCM samples (silence: all zeros) ─────────────────────────────────────────

  const samples = new Float32Array(buffer, 44, numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = 0; // Silence
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
