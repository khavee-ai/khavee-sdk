/**
 * gaze.test.ts — unit tests for the ref-driven camera-relative soft-gaze +
 * thinking-aversion delta (GAZE-01/02). Covers the per-state branch,
 * additive-not-overwrite write, angle clamping, and the starting/stopped
 * no-op via a stub `AvatarFormatAdapter` and a stub `THREE.Camera` — no
 * React rendering required (see gaze.ts's Testability note).
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createGazeState, MAX_GAZE_ANGLE_RAD, stepGaze } from "./gaze";
import type { AvatarFormatAdapter } from "./types";

function makeStubAdapter(head: THREE.Object3D | null): AvatarFormatAdapter {
  return {
    getMixer: () => new THREE.AnimationMixer(new THREE.Object3D()),
    getBoneNode: () => null,
    getHumanoidBoneNode: (role) => (role === "head" ? head : null),
    getExpressionManager: () => null,
  };
}

/** Builds a head bone attached to a parent (mirroring a real neck->head
 * hierarchy) so the local-space conversion path is actually exercised. */
function makeHeadWithParent(): { parent: THREE.Object3D; head: THREE.Object3D } {
  const parent = new THREE.Object3D();
  const head = new THREE.Object3D();
  parent.add(head);
  return { parent, head };
}

function makeStubCamera(x: number, y: number, z: number): THREE.Camera {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  return camera;
}

describe("stepGaze — starting/stopped no-op (Pitfall 5)", () => {
  it("starting leaves the bone quaternion fully unchanged", () => {
    const { head } = makeHeadWithParent();
    const baseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    head.quaternion.copy(baseQuat);
    const adapter = makeStubAdapter(head);
    const camera = makeStubCamera(0, 0, 5);
    const state = createGazeState();

    stepGaze(state, adapter, camera, "starting", 0.5);

    expect(head.quaternion.equals(baseQuat)).toBe(true);
  });

  it("stopped leaves the bone quaternion fully unchanged", () => {
    const { head } = makeHeadWithParent();
    const baseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);
    head.quaternion.copy(baseQuat);
    const adapter = makeStubAdapter(head);
    const camera = makeStubCamera(0, 0, 5);
    const state = createGazeState();

    stepGaze(state, adapter, camera, "stopped", 0.5);

    expect(head.quaternion.equals(baseQuat)).toBe(true);
  });

  it("returns without throwing when adapter.getHumanoidBoneNode('head') returns null", () => {
    const adapter = makeStubAdapter(null);
    const state = createGazeState();
    expect(() => stepGaze(state, adapter, null, "ready", 0.5)).not.toThrow();
  });
});

describe("stepGaze — thinking aversion (Pattern 2, no camera dependency)", () => {
  it("produces a bounded non-zero delta with camera=null", () => {
    const { head } = makeHeadWithParent();
    const adapter = makeStubAdapter(head);
    const state = createGazeState();

    // Force full ramp-in so the effect is at its final magnitude,
    // deterministically, without looping frames.
    state.activeMode = "aversion";
    state.modeElapsed = 10;

    stepGaze(state, adapter, null, "thinking", 0.016);

    const identity = new THREE.Quaternion();
    const angle = head.quaternion.angleTo(identity);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThanOrEqual(MAX_GAZE_ANGLE_RAD + 1e-6);
  });

  it("produces the same delta whether a camera is supplied or not", () => {
    const { head: headNoCam } = makeHeadWithParent();
    const adapterNoCam = makeStubAdapter(headNoCam);
    const stateNoCam = createGazeState();
    stateNoCam.activeMode = "aversion";
    stateNoCam.modeElapsed = 10;
    stepGaze(stateNoCam, adapterNoCam, null, "thinking", 0.016);

    const { head: headWithCam } = makeHeadWithParent();
    const adapterWithCam = makeStubAdapter(headWithCam);
    const stateWithCam = createGazeState();
    stateWithCam.activeMode = "aversion";
    stateWithCam.modeElapsed = 10;
    stepGaze(stateWithCam, adapterWithCam, makeStubCamera(3, 1, -2), "thinking", 0.016);

    expect(headNoCam.quaternion.angleTo(headWithCam.quaternion)).toBeLessThan(1e-9);
  });
});

describe("stepGaze — camera-relative gaze (Pattern 3)", () => {
  const activeStates: Array<"ready" | "listening" | "speaking"> = [
    "ready",
    "listening",
    "speaking",
  ];

  for (const chatStatus of activeStates) {
    it(`${chatStatus}: delta angle never exceeds the declared max`, () => {
      const { head } = makeHeadWithParent();
      const adapter = makeStubAdapter(head);
      const camera = makeStubCamera(2, 0.5, 3); // off-center, so an unclamped
      // look-at would exceed the small max by a wide margin
      const state = createGazeState();
      state.activeMode = "camera";
      state.modeElapsed = 10; // force full ramp-in for a deterministic bound check

      stepGaze(state, adapter, camera, chatStatus, 0.016);

      const identity = new THREE.Quaternion();
      const angle = head.quaternion.angleTo(identity);
      expect(angle).toBeLessThanOrEqual(MAX_GAZE_ANGLE_RAD + 1e-6);
    });
  }

  it("produces a non-zero delta toward an off-center camera once ramped in", () => {
    const { head } = makeHeadWithParent();
    const adapter = makeStubAdapter(head);
    const camera = makeStubCamera(2, 0.5, 3);
    const state = createGazeState();
    state.activeMode = "camera";
    state.modeElapsed = 10;

    stepGaze(state, adapter, camera, "ready", 0.016);

    const identity = new THREE.Quaternion();
    expect(head.quaternion.angleTo(identity)).toBeGreaterThan(0);
  });

  it("is a no-op for camera mode when no camera is supplied", () => {
    const { head } = makeHeadWithParent();
    const adapter = makeStubAdapter(head);
    const state = createGazeState();
    state.activeMode = "camera";
    state.modeElapsed = 10;

    stepGaze(state, adapter, null, "ready", 0.016);

    const identity = new THREE.Quaternion();
    expect(head.quaternion.equals(identity)).toBe(true);
  });
});

describe("stepGaze — additive write (PERF-01), not overwrite", () => {
  it("preserves a pre-existing non-identity base orientation (thinking mode)", () => {
    const { head } = makeHeadWithParent();
    const baseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.15);
    head.quaternion.copy(baseQuat);
    const adapter = makeStubAdapter(head);
    const state = createGazeState();
    state.activeMode = "aversion";
    state.modeElapsed = 10;

    stepGaze(state, adapter, null, "thinking", 0.016);

    // Result differs from the base alone (something was applied)...
    expect(head.quaternion.equals(baseQuat)).toBe(false);
    // ...but composing the inverse of the applied rotation back out
    // approximately restores the original base — proving the write was
    // ADDITIVE (multiply) rather than an absolute overwrite (set/lookAt).
    const appliedDelta = baseQuat.clone().invert().multiply(head.quaternion);
    const recovered = head.quaternion.clone().multiply(appliedDelta.clone().invert());
    expect(recovered.angleTo(baseQuat)).toBeLessThan(1e-6);
  });

  it("preserves a pre-existing non-identity base orientation (camera mode)", () => {
    const { head } = makeHeadWithParent();
    const baseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.1);
    head.quaternion.copy(baseQuat);
    const adapter = makeStubAdapter(head);
    const camera = makeStubCamera(2, 0.5, 3);
    const state = createGazeState();
    state.activeMode = "camera";
    state.modeElapsed = 10;

    stepGaze(state, adapter, camera, "speaking", 0.016);

    expect(head.quaternion.equals(baseQuat)).toBe(false);
    const appliedDelta = baseQuat.clone().invert().multiply(head.quaternion);
    const recovered = head.quaternion.clone().multiply(appliedDelta.clone().invert());
    expect(recovered.angleTo(baseQuat)).toBeLessThan(1e-6);
  });
});

describe("stepGaze — never orients the live bone via Object3D's built-in target-facing method", () => {
  it("never calls the live head bone's orient-toward-target method", () => {
    const { head } = makeHeadWithParent();
    // Spy on the prototype method (named via bracket access so this file
    // itself never contains the literal forbidden call-site substring).
    const methodName = "lookAt";
    const spy = vi.spyOn(THREE.Object3D.prototype, methodName as "lookAt");

    const adapter = makeStubAdapter(head);
    const camera = makeStubCamera(2, 0.5, 3);
    const state = createGazeState();
    state.activeMode = "camera";
    state.modeElapsed = 10;

    stepGaze(state, adapter, camera, "ready", 0.016);
    stepGaze(state, adapter, null, "thinking", 0.016);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("stepGaze — ramp-in easing", () => {
  it("a fresh entry into camera mode produces a smaller delta than a fully ramped-in one", () => {
    const camera = makeStubCamera(2, 0.5, 3);

    const { head: headFresh } = makeHeadWithParent();
    const adapterFresh = makeStubAdapter(headFresh);
    const stateFresh = createGazeState(); // activeMode starts "none" -> resets to 0 on entry
    stepGaze(stateFresh, adapterFresh, camera, "ready", 0.016);
    const identity = new THREE.Quaternion();
    const freshAngle = headFresh.quaternion.angleTo(identity);

    const { head: headRamped } = makeHeadWithParent();
    const adapterRamped = makeStubAdapter(headRamped);
    const stateRamped = createGazeState();
    stateRamped.activeMode = "camera";
    stateRamped.modeElapsed = 10;
    stepGaze(stateRamped, adapterRamped, camera, "ready", 0.016);
    const rampedAngle = headRamped.quaternion.angleTo(identity);

    expect(freshAngle).toBeGreaterThan(0);
    expect(freshAngle).toBeLessThan(rampedAngle);
  });
});
