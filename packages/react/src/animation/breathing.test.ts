/**
 * breathing.test.ts — unit tests for the ref-driven chest/spine breathing
 * delta (IDLE-01). Covers the pure sine math (`breathingDeltaAngle`) and the
 * additive `stepBreathing` write via a stub `AvatarFormatAdapter` — no React
 * rendering required (see breathing.ts's Testability note).
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { breathingDeltaAngle, createBreathingState, stepBreathing } from "./breathing";
import type { AvatarFormatAdapter } from "./types";

function makeStubAdapter(
  bones: Partial<Record<"chest" | "spine", THREE.Object3D | null>>,
): AvatarFormatAdapter {
  return {
    getMixer: () => new THREE.AnimationMixer(new THREE.Object3D()),
    getBoneNode: () => null,
    getHumanoidBoneNode: (role) => {
      if (role === "chest") return bones.chest ?? null;
      if (role === "spine") return bones.spine ?? null;
      return null;
    },
    getExpressionManager: () => null,
  };
}

describe("breathingDeltaAngle", () => {
  it("at sine-phase peak (PI/2) produces a positive delta bounded by amplitude", () => {
    const result = breathingDeltaAngle(Math.PI / 2, 0.03, 1);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(0.03);
  });

  it("amplitudeScale=0 produces zero delta", () => {
    expect(breathingDeltaAngle(Math.PI / 2, 0.03, 0)).toBeCloseTo(0, 10);
  });

  it("amplitudeScale=2 produces roughly double the delta of amplitudeScale=1 at the same phase", () => {
    const scale1 = breathingDeltaAngle(1.2, 0.03, 1);
    const scale2 = breathingDeltaAngle(1.2, 0.03, 2);
    expect(scale2).toBeCloseTo(scale1 * 2, 10);
  });
});

describe("stepBreathing", () => {
  it("one step at sine-phase peak produces a non-identity bone quaternion bounded by amplitude", () => {
    const chest = new THREE.Object3D();
    const spine = new THREE.Object3D();
    const adapter = makeStubAdapter({ chest, spine });

    // Force the state directly to phase PI/2 minus one step's worth of
    // advance, so after stepBreathing's internal advance the phase lands at
    // the sine peak.
    const state = createBreathingState();
    state.period = 4.0;
    state.phase = Math.PI / 2 - (0.001 / state.period) * Math.PI * 2;

    stepBreathing(state, adapter, 0.001, 1);

    const identity = new THREE.Quaternion();
    const angle = chest.quaternion.angleTo(identity);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThanOrEqual(0.031); // amplitude ceiling with float margin
  });

  it("writes additively via multiply: preserves a pre-existing non-identity base orientation", () => {
    const chest = new THREE.Object3D();
    const baseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
    chest.quaternion.copy(baseQuat);
    const spine = new THREE.Object3D();
    const adapter = makeStubAdapter({ chest, spine });

    const state = createBreathingState();
    state.phase = 1; // arbitrary non-zero phase so the delta is non-trivial
    stepBreathing(state, adapter, 0.3, 1);

    const deltaOnly = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      breathingDeltaAngle(state.phase, 0.03, 1),
    );
    // Result differs from both the base alone and the delta alone.
    expect(chest.quaternion.equals(baseQuat)).toBe(false);
    expect(chest.quaternion.equals(deltaOnly)).toBe(false);
    // But the base contribution is still present: composing the inverse of
    // the delta back out should approximately restore the base.
    const recovered = chest.quaternion.clone().multiply(deltaOnly.clone().invert());
    expect(recovered.angleTo(baseQuat)).toBeLessThan(1e-3);
  });

  it("amplitudeScale=0 produces (near) zero net delta on the bone", () => {
    const chest = new THREE.Object3D();
    const spine = new THREE.Object3D();
    const adapter = makeStubAdapter({ chest, spine });

    const state = createBreathingState();
    state.phase = 1;
    stepBreathing(state, adapter, 0.5, 0);

    const identity = new THREE.Quaternion();
    expect(chest.quaternion.angleTo(identity)).toBeCloseTo(0, 5);
  });

  it("amplitudeScale=2 produces roughly double the delta of amplitudeScale=1 at the same phase", () => {
    const chest1 = new THREE.Object3D();
    const spine1 = new THREE.Object3D();
    const state1 = createBreathingState();
    state1.phase = 1;
    stepBreathing(state1, makeStubAdapter({ chest: chest1, spine: spine1 }), 0, 1);

    const chest2 = new THREE.Object3D();
    const spine2 = new THREE.Object3D();
    const state2 = createBreathingState();
    state2.phase = 1;
    stepBreathing(state2, makeStubAdapter({ chest: chest2, spine: spine2 }), 0, 2);

    const identity = new THREE.Quaternion();
    const angle1 = chest1.quaternion.angleTo(identity);
    const angle2 = chest2.quaternion.angleTo(identity);
    expect(angle2).toBeCloseTo(angle1 * 2, 3);
  });

  it("returns without throwing when adapter.getHumanoidBoneNode('chest') returns null", () => {
    const spine = new THREE.Object3D();
    const adapter = makeStubAdapter({ chest: null, spine });

    const state = createBreathingState();
    expect(() => stepBreathing(state, adapter, 0.5)).not.toThrow();

    const identity = new THREE.Quaternion();
    expect(spine.quaternion.equals(identity)).toBe(true); // early-return before either bone is written
  });
});
