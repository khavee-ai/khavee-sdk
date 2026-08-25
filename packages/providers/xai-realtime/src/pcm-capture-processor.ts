/**
 * PCM Capture AudioWorklet Processor
 *
 * Runs on the audio rendering thread. Copies raw mono PCM samples
 * from the microphone input to the main thread via MessagePort in
 * 4096-sample frames (matching typical AudioWorklet quantum size of
 * 128 samples, accumulated into larger frames for efficiency).
 *
 * Register via: audioContext.audioWorklet.addModule(url)
 * where url points to this file served from the consuming app's public/.
 *
 * NOTE: This file is compiled separately and must be served as a standalone
 * script. The provider dynamically creates it as a Blob URL at runtime to
 * avoid requiring consumers to manually copy it to their public/ directory.
 */

// The worklet processor source as a string (inlined for Blob URL creation)
export const PCM_CAPTURE_PROCESSOR_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(4096);
    this._bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];

    for (let i = 0; i < channelData.length; i++) {
      this._buffer[this._bufferIndex++] = channelData[i];

      if (this._bufferIndex >= 4096) {
        // Send full frame to main thread
        this.port.postMessage(this._buffer.slice(0));
        this._bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
`;
