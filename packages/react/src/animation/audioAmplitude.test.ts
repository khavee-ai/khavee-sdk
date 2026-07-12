/**
 * audioAmplitude.test.ts — unit tests for the pure, speaking-only
 * volume -> amplitude-scale mapping (TALK-02).
 */

import { describe, expect, it } from "vitest";
import { volumeToAmplitudeScale } from "./audioAmplitude";

describe("volumeToAmplitudeScale", () => {
  it("returns exactly 1 (neutral) when chatStatus is not 'speaking', regardless of volume", () => {
    expect(volumeToAmplitudeScale(0.9, "listening")).toBe(1);
    expect(volumeToAmplitudeScale(1, "thinking")).toBe(1);
    expect(volumeToAmplitudeScale(0, "ready")).toBe(1);
    expect(volumeToAmplitudeScale(0.5, "starting")).toBe(1);
    expect(volumeToAmplitudeScale(0.5, "stopped")).toBe(1);
  });

  it("returns a monotonically increasing scale as clamped volume rises from 0 to 1 while speaking", () => {
    const atZero = volumeToAmplitudeScale(0, "speaking");
    const atQuarter = volumeToAmplitudeScale(0.25, "speaking");
    const atHalf = volumeToAmplitudeScale(0.5, "speaking");
    const atFull = volumeToAmplitudeScale(1, "speaking");

    expect(atZero).toBe(1); // neutral at zero volume
    expect(atQuarter).toBeGreaterThan(atZero);
    expect(atHalf).toBeGreaterThan(atQuarter);
    expect(atFull).toBeGreaterThan(atHalf);
    expect(atFull).toBeGreaterThan(1); // 1+K at full volume
  });

  it("clamps out-of-range volume inputs into [0, 1] before mapping, never returning an unbounded scale", () => {
    expect(volumeToAmplitudeScale(2, "speaking")).toBe(volumeToAmplitudeScale(1, "speaking"));
    expect(volumeToAmplitudeScale(100, "speaking")).toBe(volumeToAmplitudeScale(1, "speaking"));
    expect(volumeToAmplitudeScale(-1, "speaking")).toBe(volumeToAmplitudeScale(0, "speaking"));
    expect(volumeToAmplitudeScale(-50, "speaking")).toBe(volumeToAmplitudeScale(0, "speaking"));
  });

  it("is a pure function: identical inputs always produce identical output", () => {
    const a = volumeToAmplitudeScale(0.42, "speaking");
    const b = volumeToAmplitudeScale(0.42, "speaking");
    expect(a).toBe(b);

    const c = volumeToAmplitudeScale(0.7, "listening");
    const d = volumeToAmplitudeScale(0.7, "listening");
    expect(c).toBe(d);
  });
});
