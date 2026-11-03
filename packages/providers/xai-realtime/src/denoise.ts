/**
 * RNNoise denoising for mic capture, loaded on first use.
 *
 * RNNoise is a small recurrent network that strips background noise (crowds,
 * music, fans, keyboards) from speech far better than the browser's built-in
 * noiseSuppression. Its worklet and wasm are vendored inline (see
 * scripts/vendor-rnnoise.mjs) and dynamically imported, so apps that never
 * enable it don't download them and no static files need serving.
 */

/** Processor name the vendored worklet registers. */
const RNNOISE_PROCESSOR = "@sapphi-red/web-noise-suppressor/rnnoise";

/** RNNoise only works on 48 kHz audio. */
export const RNNOISE_SAMPLE_RATE = 48000;

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Creates an RNNoise node on a 48 kHz context. Connect mic → node → capture.
 * Call `destroyRnnoiseNode` when done to free its wasm memory.
 */
export async function createRnnoiseNode(context: AudioContext): Promise<AudioWorkletNode> {
  if (context.sampleRate !== RNNOISE_SAMPLE_RATE) {
    throw new Error(`RNNoise needs a ${RNNOISE_SAMPLE_RATE} Hz AudioContext (got ${context.sampleRate})`);
  }
  const [{ RNNOISE_WORKLET_SOURCE }, { RNNOISE_WASM_BASE64 }] = await Promise.all([
    import("./vendor/rnnoise-worklet-source"),
    import("./vendor/rnnoise-wasm"),
  ]);
  const url = URL.createObjectURL(new Blob([RNNOISE_WORKLET_SOURCE], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  return new AudioWorkletNode(context, RNNOISE_PROCESSOR, {
    processorOptions: { maxChannels: 1, wasmBinary: base64ToArrayBuffer(RNNOISE_WASM_BASE64) },
  });
}

export function destroyRnnoiseNode(node: AudioWorkletNode): void {
  node.port.postMessage("destroy");
  node.disconnect();
}
