import { describe, expect, it } from "vitest";
import { oculusToMouth, isHeadAudioSupported } from "./headAudio";
import { HEADAUDIO_MODEL_BASE64, HEADAUDIO_MODEL_BYTES } from "./vendor/model-en-mixed";
import { HEADWORKLET_SOURCE } from "./vendor/headworklet-source";

describe("oculusToMouth", () => {
  it("maps vowels 1:1 and normalizes so the largest key is 1", () => {
    const { shape, closure } = oculusToMouth({ O: 0.65 });
    expect(shape.oh).toBeCloseTo(1);
    expect(shape.aa + shape.ih + shape.ou + shape.ee).toBe(0);
    expect(closure).toBe(0);
  });

  it("blends mixed visemes proportionally", () => {
    const { shape } = oculusToMouth({ aa: 0.6, U: 0.3 });
    expect(shape.aa).toBeCloseTo(1);
    expect(shape.ou).toBeCloseTo(0.5);
  });

  it("turns PP (p/b/m) into lip closure, not a mouth shape", () => {
    const { shape, closure } = oculusToMouth({ PP: 0.75 });
    expect(closure).toBeCloseTo(1);
    expect(Math.max(shape.aa, shape.ih, shape.ou, shape.ee, shape.oh)).toBe(0);
  });

  it("returns an all-zero shape for silence and ignores unknown or non-positive values", () => {
    const { shape, closure } = oculusToMouth({ sil: 0.65, bogus: 1, aa: -1, I: Number.NaN });
    expect(Object.values(shape).every((v) => v === 0)).toBe(true);
    expect(closure).toBe(0);
  });
});

describe("vendored HeadAudio assets", () => {
  it("ships the model intact", () => {
    expect(Buffer.from(HEADAUDIO_MODEL_BASE64, "base64").length).toBe(HEADAUDIO_MODEL_BYTES);
  });

  it("ships the worklet that registers the processor HeadAudio's node expects", () => {
    expect(HEADWORKLET_SOURCE).toContain('registerProcessor("headworklet"');
  });
});

describe("server safety", () => {
  it("imports and feature-detects without AudioWorkletNode (SSR/Node)", () => {
    expect(typeof AudioWorkletNode).toBe("undefined");
    expect(isHeadAudioSupported({ audioWorklet: {} } as unknown as BaseAudioContext)).toBe(false);
  });
});
