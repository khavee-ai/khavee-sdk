/**
 * sway.test.ts — unit tests for the ref-driven hips/spine weight-shift sway
 * delta (IDLE-01). Covers the pure sine math (`swayDeltaAngle`) and the
 * additive `stepSway` write via a stub `AvatarFormatAdapter` — no React
 * rendering required (see breathing.ts/sway.ts's Testability note).
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { swayDeltaAngle, createSwayState, stepSway } from "./sway";
import { breathingDeltaAngle, createBreathingState } from "./breathing";
import type { AvatarFormatAdapter } from "./types";

function makeStubAdapter(
  bones: Partial<Record<"hips" | "spine", THREE.Object3D | null>>,
): AvatarFormatAdapter {
  return {
    getMixer: () => new THREE.AnimationMixer(new THREE.Object3D()),
    getBoneNode: () => null,
    getHumanoidBoneNode: (role) => {
      if (role === "hips") return bones.hips ?? null;
      if (role === "spine") return bones.spine ?? null;
      return null;
    },
    getExpressionManager: () => null,
  };
}

describe("swayDeltaAngle", () => {
  it("at sine-phase peak (PI/2) produces a positive delta bounded by amplitude", () => {
    const result = swayDeltaAngle(Math.PI / 2, 0.025, 1);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(0.025);
  });

  it("amplitudeScale=0 produces zero delta", () => {
    expect(swayDeltaAngle(Math.PI / 2, 0.025, 0)).toBeCloseTo(0, 10);
  });

  it("amplitudeScale=2 produces roughly double the delta of amplitudeScale=1 at the same phase", () => {
    const scale1 = swayDeltaAngle(1.2, 0.025, 1);
    const scale2 = swayDeltaAngle(1.2, 0.025, 2);
    expect(scale2).toBeCloseTo(scale1 * 2, 10);
  });
});

describe("stepSway", () => {
  it("one step at sine-phase peak produces a non-identity bone quaternion bounded by amplitude", () => {
    const hips = new THREE.Object3D();
    const spine = new THREE.Object3D();
    const adapter = makeStubAdapter({ hips, spine });

    const state = createSwayState();
    state.period = 8.0;
    state.phase = Math.PI / 2 - (0.001 / state.period) * Math.PI * 2;

    stepSway(state, adapter, 0.001, 1);

    const identity = new THREE.Quaternion();
    const angle = hips.quaternion.angleTo(identity);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThanOrEqual(0.026); // amplitude ceiling with float margin
  });

  it("writes additively via multiply: preserves a pre-existing non-identity base orientation", () => {
    const hips = new THREE.Object3D();
    const baseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4);
    hips.quaternion.copy(baseQuat);
    const spine = new THREE.Object3D();
    const adapter = makeStubAdapter({ hips, spine });

    const state = createSwayState();
    state.phase = 1;
    stepSway(state, adapter, 0.3, 1);

    const deltaOnly = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      swayDeltaAngle(state.phase, 0.025, 1),
    );
    expect(hips.quaternion.equals(baseQuat)).toBe(false);
    expect(hips.quaternion.equals(deltaOnly)).toBe(false);
    const recovered = hips.quaternion.clone().multiply(deltaOnly.clone().invert());
    expect(recovered.angleTo(baseQuat)).toBeLessThan(1e-3);
  });

  it("has a default period band independent of (not equal to) breathing's default period band", () => {
    // Sample many instances of each; their period ranges must not overlap
    // at all (sway: 7.0-10.0s, breathing: 4.0-6.0s per file headers).
    for (let i = 0; i < 20; i++) {
      const swayState = createSwayState();
      const breathingState = createBreathingState();
      expect(swayState.period).toBeGreaterThanOrEqual(7.0);
      expect(swayState.period).toBeLessThanOrEqual(10.0);
      expect(breathingState.period).toBeGreaterThanOrEqual(4.0);
      expect(breathingState.period).toBeLessThanOrEqual(6.0);
      expect(swayState.period).not.toBeCloseTo(breathingState.period, 1);
    }
    // Sanity: swayDeltaAngle and breathingDeltaAngle both exist as distinct
    // pure helpers with independently-tunable amplitude/phase inputs.
    expect(typeof swayDeltaAngle).toBe("function");
    expect(typeof breathingDeltaAngle).toBe("function");
  });

  it("returns without throwing when adapter.getHumanoidBoneNode('hips') or ('spine') returns null", () => {
    const spine = new THREE.Object3D();
    const adapterNullHips = makeStubAdapter({ hips: null, spine });
    const stateA = createSwayState();
    expect(() => stepSway(stateA, adapterNullHips, 0.5)).not.toThrow();
    const identity = new THREE.Quaternion();
    expect(spine.quaternion.equals(identity)).toBe(true); // early-return before either bone is written

    const hips = new THREE.Object3D();
    const adapterNullSpine = makeStubAdapter({ hips, spine: null });
    const stateB = createSwayState();
    expect(() => stepSway(stateB, adapterNullSpine, 0.5)).not.toThrow();
    expect(hips.quaternion.equals(identity)).toBe(true);
  });
});
