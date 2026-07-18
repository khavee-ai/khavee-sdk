/**
 * gaze.test.ts — unit tests for the ref-driven camera-relative soft-gaze +
 * thinking-aversion delta (GAZE-01/02). Covers the per-state branch,
 * additive-not-overwrite write, angle clamping, the starting/stopped no-op,
 * (12-07 gap closure) the persistent frame-rate-independent smoothing that
 * replaced the old one-shot ramp, and (12-08 gap closure) the
 * group-rotation-agnostic camera target + frontal-range relaxation that
 * closed the GLB-only idle-spin regression — via a stub
 * `AvatarFormatAdapter` and a stub `THREE.Camera` — no React rendering
 * required (see gaze.ts's Testability note).
 *
 * 12-08 NOTE: the shared off-center test camera used across the
 * "camera-relative gaze" and "continuous smoothing" describe blocks below
 * was changed from `makeStubCamera(2, 0.5, 3)` to `makeStubCamera(2, 0.5,
 * -3)` — negative Z is genuinely IN FRONT of a head whose parent has no
 * world rotation (`makeHeadWithParent`'s default), matching
 * GAZE_FRONTAL_RANGE_RAD's "front" convention introduced in this
 * gap-closure round, so these pre-existing tests keep proving the ORIGINAL
 * clamp/smoothing behavior unchanged rather than incidentally exercising
 * the new frontal-range relaxation.
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createGazeState, MAX_GAZE_ANGLE_RAD, stepGaze } from "./gaze";
import type { GazeState } from "./gaze";
import type { AvatarFormatAdapter } from "./types";
import type { ChatStatus } from "@khaveeai/core";

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

const FRAME_DT = 0.016;

/**
 * Simulates repeated frames of `stepGaze` with a FIXED base pose on the
 * bone, mimicking the real call order (`mixer.update()` -> ...procedural
 * stack... -> `gaze.step()` last, see `AnimationStateEngine.ts` /
 * `VRMAvatar.tsx`): nothing but this frame's own writers ever touches the
 * bone between mixer ticks, so `head.quaternion` is reset to `baseQuat`
 * before every call — only `state` (in particular `state.smoothedTarget`)
 * persists across "frames" here. This is what lets the persistent
 * exponential smoothing converge to a bound of `MAX_GAZE_ANGLE_RAD` from
 * `baseQuat` rather than drifting further with every additional frame.
 */
function runUntilConverged(
  state: GazeState,
  head: THREE.Object3D,
  baseQuat: THREE.Quaternion,
  adapter: AvatarFormatAdapter,
  camera: THREE.Camera | null | undefined,
  chatStatus: ChatStatus,
  frames = 90,
): void {
  for (let i = 0; i < frames; i++) {
    head.quaternion.copy(baseQuat);
    stepGaze(state, adapter, camera, chatStatus, FRAME_DT);
  }
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
    const identity = new THREE.Quaternion();

    runUntilConverged(state, head, identity, adapter, null, "thinking");

    const angle = head.quaternion.angleTo(identity);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThanOrEqual(MAX_GAZE_ANGLE_RAD + 1e-6);
  });

  it("produces the same delta whether a camera is supplied or not", () => {
    const identity = new THREE.Quaternion();

    const { head: headNoCam } = makeHeadWithParent();
    const adapterNoCam = makeStubAdapter(headNoCam);
    const stateNoCam = createGazeState();
    runUntilConverged(stateNoCam, headNoCam, identity, adapterNoCam, null, "thinking");

    const { head: headWithCam } = makeHeadWithParent();
    const adapterWithCam = makeStubAdapter(headWithCam);
    const stateWithCam = createGazeState();
    runUntilConverged(
      stateWithCam,
      headWithCam,
      identity,
      adapterWithCam,
      makeStubCamera(3, 1, -2),
      "thinking",
    );

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
      // 12-08 gap closure: negative Z is genuinely IN FRONT of a head whose
      // parent has no world rotation (HEAD_FORWARD_AXIS = local -Z is also
      // the head's actual current world forward here) — off-center enough
      // that an unclamped look-at would exceed the small max by a wide
      // margin, but well within GAZE_FRONTAL_RANGE_RAD so the frontal-range
      // relaxation added in 12-08 does not scale this down.
      const camera = makeStubCamera(2, 0.5, -3);
      const state = createGazeState();
      const identity = new THREE.Quaternion();

      runUntilConverged(state, head, identity, adapter, camera, chatStatus);

      const angle = head.quaternion.angleTo(identity);
      expect(angle).toBeLessThanOrEqual(MAX_GAZE_ANGLE_RAD + 1e-6);
    });
  }

  it("produces a non-zero delta toward an off-center camera once converged", () => {
    const { head } = makeHeadWithParent();
    const adapter = makeStubAdapter(head);
    const camera = makeStubCamera(2, 0.5, -3);
    const state = createGazeState();
    const identity = new THREE.Quaternion();

    runUntilConverged(state, head, identity, adapter, camera, "ready");

    expect(head.quaternion.angleTo(identity)).toBeGreaterThan(0);
  });

  it("is a no-op for camera mode when no camera is supplied", () => {
    const { head } = makeHeadWithParent();
    const adapter = makeStubAdapter(head);
    const state = createGazeState();
    // Simulate an already-active, already-converged camera-gaze state to
    // prove the missing-camera defensive branch is a full no-op even when
    // there is a live smoothed target to fall back on.
    state.activeMode = "camera";
    state.smoothedInitialized = true;
    state.smoothedTarget.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.03);

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
    const camera = makeStubCamera(2, 0.5, -3);
    const state = createGazeState();

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
    const camera = makeStubCamera(2, 0.5, -3);
    const state = createGazeState();

    stepGaze(state, adapter, camera, "ready", 0.016);
    stepGaze(state, adapter, null, "thinking", 0.016);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("stepGaze — continuous smoothing (Gap 1 fix: no per-frame snap)", () => {
  it("eases in, does not jump: a single frame produces a smaller angle than the converged one", () => {
    const camera = makeStubCamera(2, 0.5, -3);
    const identity = new THREE.Quaternion();

    const { head: headFresh } = makeHeadWithParent();
    const adapterFresh = makeStubAdapter(headFresh);
    const stateFresh = createGazeState();
    stepGaze(stateFresh, adapterFresh, camera, "ready", FRAME_DT);
    const freshAngle = headFresh.quaternion.angleTo(identity);

    const { head: headConverged } = makeHeadWithParent();
    const adapterConverged = makeStubAdapter(headConverged);
    const stateConverged = createGazeState();
    runUntilConverged(stateConverged, headConverged, identity, adapterConverged, camera, "ready");
    const convergedAngle = headConverged.quaternion.angleTo(identity);

    expect(freshAngle).toBeGreaterThan(0);
    expect(freshAngle).toBeLessThan(convergedAngle);
  });

  it("converges monotonically toward the target, never exceeding the max", () => {
    const { head } = makeHeadWithParent();
    const adapter = makeStubAdapter(head);
    const camera = makeStubCamera(2, 0.5, -3);
    const identity = new THREE.Quaternion();
    const state = createGazeState();

    let prevAngle = 0;
    for (let i = 0; i < 40; i++) {
      head.quaternion.copy(identity);
      stepGaze(state, adapter, camera, "ready", FRAME_DT);
      const angle = head.quaternion.angleTo(identity);
      // Non-decreasing (small epsilon for floating-point noise near the
      // asymptote) and never overshoots the declared bound.
      expect(angle).toBeGreaterThanOrEqual(prevAngle - 1e-9);
      expect(angle).toBeLessThanOrEqual(MAX_GAZE_ANGLE_RAD + 1e-6);
      prevAngle = angle;
    }
    // After 40 frames (~0.64s, well beyond GAZE_SMOOTH_TIME_CONSTANT) the
    // applied angle should have meaningfully converged toward the bound,
    // not still be near its fresh-entry starting value.
    expect(prevAngle).toBeGreaterThan(MAX_GAZE_ANGLE_RAD * 0.5);
  });

  it("is frame-rate independent: one 0.1s step matches five 0.02s steps", () => {
    const camera = makeStubCamera(2, 0.5, -3);
    const identity = new THREE.Quaternion();

    const { head: headBig } = makeHeadWithParent();
    const adapterBig = makeStubAdapter(headBig);
    const stateBig = createGazeState();
    headBig.quaternion.copy(identity);
    stepGaze(stateBig, adapterBig, camera, "ready", 0.1);
    const bigStepAngle = headBig.quaternion.angleTo(identity);

    const { head: headSmall } = makeHeadWithParent();
    const adapterSmall = makeStubAdapter(headSmall);
    const stateSmall = createGazeState();
    for (let i = 0; i < 5; i++) {
      headSmall.quaternion.copy(identity);
      stepGaze(stateSmall, adapterSmall, camera, "ready", 0.02);
    }
    const smallStepsAngle = headSmall.quaternion.angleTo(identity);

    expect(Math.abs(bigStepAngle - smallStepsAngle)).toBeLessThan(1e-4);
  });

  it("mode switch (camera -> aversion) does not snap back through the neutral base", () => {
    const { head } = makeHeadWithParent();
    const adapter = makeStubAdapter(head);
    const camera = makeStubCamera(2, 0.5, -3);
    const identity = new THREE.Quaternion();
    const state = createGazeState();

    // Converge fully in camera mode first.
    runUntilConverged(state, head, identity, adapter, camera, "ready");
    const convergedAngle = head.quaternion.angleTo(identity);
    expect(convergedAngle).toBeGreaterThan(MAX_GAZE_ANGLE_RAD * 0.9);

    // Switch to aversion (thinking) for a single frame — simulating the
    // mixer resetting the bone to its base pose before this frame's
    // procedural writers run, exactly as production does.
    head.quaternion.copy(identity);
    stepGaze(state, adapter, camera, "thinking", FRAME_DT);
    const postSwitchAngle = head.quaternion.angleTo(identity);

    // Gap 1 fix: the transition eases ONWARD from the currently-applied
    // gaze toward the new target — it must NOT collapse toward ~0 in this
    // single frame (that would mean it snapped back through the neutral
    // base before easing into the new mode).
    expect(postSwitchAngle).toBeGreaterThan(convergedAngle * 0.5);
    expect(postSwitchAngle).toBeLessThanOrEqual(MAX_GAZE_ANGLE_RAD + 1e-6);
  });
});

describe("stepGaze — group-rotation-agnostic camera target (12-08 gap closure, Gap 2)", () => {
  it("GLB-analog (parent rotation [0,0,0]): a front camera produces a small, non-pinned applied angle", () => {
    const { parent, head } = makeHeadWithParent();
    parent.rotation.set(0, 0, 0); // GLBAvatar.tsx's default group rotation
    const adapter = makeStubAdapter(head);
    // Front-facing, off-center camera relative to THIS parent rotation's
    // actual current head world forward (-Z, since HEAD_FORWARD_AXIS
    // rotated by an identity parent+head quaternion stays -Z).
    const camera = makeStubCamera(1, 0.3, -3);
    const state = createGazeState();
    const identity = new THREE.Quaternion();

    runUntilConverged(state, head, identity, adapter, camera, "ready");

    const angle = head.quaternion.angleTo(identity);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThanOrEqual(MAX_GAZE_ANGLE_RAD + 1e-6);
    // Converges close to the full bound (not relaxed — this camera sits
    // well within GAZE_FRONTAL_RANGE_RAD of the head's actual current
    // world forward). Cross-checked for GAZE-02 symmetry against the
    // mirrored VRM-analog case in the next test.
    expect(angle).toBeGreaterThan(MAX_GAZE_ANGLE_RAD * 0.5);
  });

  it("VRM-analog (parent rotation [0, Math.PI, 0]): the mirrored front camera produces the SAME small applied angle (GAZE-02 symmetry)", () => {
    const identity = new THREE.Quaternion();

    const { parent: glbParent, head: glbHead } = makeHeadWithParent();
    glbParent.rotation.set(0, 0, 0);
    const glbAdapter = makeStubAdapter(glbHead);
    const glbCamera = makeStubCamera(1, 0.3, -3);
    const glbState = createGazeState();
    runUntilConverged(glbState, glbHead, identity, glbAdapter, glbCamera, "ready");
    const glbAngle = glbHead.quaternion.angleTo(identity);

    const { parent: vrmParent, head: vrmHead } = makeHeadWithParent();
    vrmParent.rotation.set(0, Math.PI, 0); // VRMAvatar.tsx's default group rotation
    const vrmAdapter = makeStubAdapter(vrmHead);
    // Mirrored across Z relative to the GLB-analog camera above — the VRM
    // group's 180-degree flip makes its head's actual current world
    // forward point the opposite way ((0,0,1) instead of (0,0,-1)), so the
    // equivalent "front, off-center" camera position is mirrored too.
    const vrmCamera = makeStubCamera(1, 0.3, 3);
    const vrmState = createGazeState();
    runUntilConverged(vrmState, vrmHead, identity, vrmAdapter, vrmCamera, "ready");
    const vrmAngle = vrmHead.quaternion.angleTo(identity);

    expect(vrmAngle).toBeGreaterThan(0);
    expect(vrmAngle).toBeLessThanOrEqual(MAX_GAZE_ANGLE_RAD + 1e-6);
    // This IS the GAZE-02 bone-level symmetry guarantee: the same
    // camera-relative "front, off-center" configuration produces the same
    // applied angle regardless of which way the consuming app orients the
    // avatar's outer group.
    expect(Math.abs(vrmAngle - glbAngle)).toBeLessThan(1e-4);
  });

  it("camera behind the head's actual current facing relaxes toward no offset instead of pinning at the max (Gap 2 fix)", () => {
    const { parent, head } = makeHeadWithParent();
    parent.rotation.set(0, 0, 0);
    const adapter = makeStubAdapter(head);
    // Genuinely BEHIND the GLB-analog head's actual current world forward
    // (-Z) — this is the real-world configuration Task 1's empirical
    // measurement found for happy.glb's default mount against its own demo
    // page's camera (~168 degrees raw, well outside GAZE_FRONTAL_RANGE_RAD).
    const camera = makeStubCamera(0, 0.5, 3);
    const state = createGazeState();
    const identity = new THREE.Quaternion();

    runUntilConverged(state, head, identity, adapter, camera, "ready");

    const angle = head.quaternion.angleTo(identity);
    // Bounded (never exceeds the declared max)...
    expect(angle).toBeLessThanOrEqual(MAX_GAZE_ANGLE_RAD + 1e-6);
    // ...but relaxed well below the max rather than pinned at it — this is
    // the Gap 2 fix: the pre-fix code would have persistently clamped to
    // MAX_GAZE_ANGLE_RAD every single frame here (a large, stable-magnitude
    // push toward an effectively-unreachable ~168-degree-away target),
    // which Task 1 found sits very close to `setFromUnitVectors`'s
    // near-antiparallel axis-instability singularity once combined with a
    // continuously-jostling body (breathing/sway) — reading as the
    // reported "spin weird" idle-animation regression.
    expect(angle).toBeLessThan(MAX_GAZE_ANGLE_RAD * 0.5);
  });
});
