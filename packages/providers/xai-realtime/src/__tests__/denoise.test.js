import { describe, expect, it, vi } from "vitest";
import { PCM_CAPTURE_PROCESSOR_SOURCE } from "../pcm-capture-processor";
import { RNNOISE_WASM_BASE64, RNNOISE_WASM_BYTES } from "../vendor/rnnoise-wasm";
import { RNNOISE_WORKLET_SOURCE } from "../vendor/rnnoise-worklet-source";
import { createRnnoiseNode } from "../denoise";
import { MicCaptureEngine } from "../MicCaptureEngine";

/** Evaluates the capture worklet source with a stand-in worklet global scope. */
function loadCaptureProcessor() {
  let Processor;
  const scope = {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: vi.fn() };
      }
    },
    registerProcessor: (_name, cls) => {
      Processor = cls;
    },
  };
  new Function("AudioWorkletProcessor", "registerProcessor", PCM_CAPTURE_PROCESSOR_SOURCE)(
    scope.AudioWorkletProcessor,
    scope.registerProcessor,
  );
  return Processor;
}

describe("PCM capture worklet", () => {
  it("averages 48 kHz input down to 24 kHz frames", () => {
    const Processor = loadCaptureProcessor();
    const p = new Processor({ processorOptions: { decimate: 2 } });
    const input = new Float32Array(8192).map((_, i) => (i % 2 === 0 ? 0.2 : 0.4));
    p.process([[input]]);
    expect(p.port.postMessage).toHaveBeenCalledTimes(1);
    const frame = p.port.postMessage.mock.calls[0][0];
    expect(frame).toHaveLength(4096);
    expect(frame[0]).toBeCloseTo(0.3);
  });

  it("passes samples through unchanged without decimation", () => {
    const Processor = loadCaptureProcessor();
    const p = new Processor(undefined);
    p.process([[new Float32Array(4096).fill(0.5)]]);
    expect(p.port.postMessage.mock.calls[0][0][10]).toBeCloseTo(0.5);
  });
});

describe("vendored RNNoise", () => {
  it("ships the wasm intact and the worklet that registers its processor", () => {
    expect(Buffer.from(RNNOISE_WASM_BASE64, "base64").length).toBe(RNNOISE_WASM_BYTES);
    expect(RNNOISE_WORKLET_SOURCE).toContain("@sapphi-red/web-noise-suppressor/rnnoise");
  });

  it("refuses a context that is not 48 kHz", async () => {
    await expect(createRnnoiseNode({ sampleRate: 24000 })).rejects.toThrow("48000");
  });
});

describe("MicCaptureEngine noise options", () => {
  function stubAudio(failRnnoise) {
    const constraints = [];
    const contexts = [];
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async (c) => {
          constraints.push(c.audio);
          return { getTracks: () => [] };
        }),
      },
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor({ sampleRate }) {
          this.sampleRate = sampleRate;
          this.state = "running";
          this.audioWorklet = {
            addModule: vi.fn(async () => {
              if (failRnnoise && this.sampleRate === 48000 && this.audioWorklet.addModule.mock.calls.length > 1) {
                throw new Error("blocked");
              }
            }),
          };
          contexts.push(this);
        }
        createMediaStreamSource() {
          return { connect: vi.fn(), disconnect: vi.fn() };
        }
        close() {
          this.state = "closed";
        }
      },
    );
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        constructor(_ctx, name, opts) {
          this.name = name;
          this.opts = opts;
          this.port = { postMessage: vi.fn() };
        }
        connect() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    return { constraints, contexts };
  }

  it("uses RNNoise at 48 kHz with browser suppression and auto gain off", async () => {
    try {
      const { constraints, contexts } = stubAudio(false);
      await new MicCaptureEngine(24000).initialize();
      expect(contexts[0].sampleRate).toBe(48000);
      expect(constraints[0]).toMatchObject({ noiseSuppression: false, autoGainControl: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to browser suppression when RNNoise can't load", async () => {
    try {
      const { constraints, contexts } = stubAudio(true);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await new MicCaptureEngine(24000).initialize();
      expect(contexts.at(-1).sampleRate).toBe(24000);
      expect(constraints.at(-1)).toMatchObject({ noiseSuppression: true });
      warn.mockRestore();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
