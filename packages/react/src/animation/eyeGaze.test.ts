/**
 * eyeGaze.test.ts — unit tests for the eye-contact tracking module (EYE-01,
 * EYE-02, D-01..D-04). Exercises `stepEyeGaze`/`createEyeGazeState` directly
 * via a stub `AvatarFormatAdapter`/`LookAtController` and a stub
 * `THREE.Camera` — no React rendering required (mirrors gaze.test.ts's
 * Testability approach).
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  createEyeGazeState,
  NEUTRAL_EYE_GAZE_BIAS,
  stepEyeGaze,
} from "./eyeGaze";
import type { EyeGazeBias, EyeGazeStepResult } from "./eyeGaze";
import type { AvatarFormatAdapter, LookAtController } from "./types";

/** A stub LookAtController mirroring three-vrm's own yaw/pitch=atan2(...) convention over a world-space target. Used only by tests — the real math lives in three-vrm, never in eyeGaze.ts. */
function makeStubLookAt(): LookAtController {
  return {
    autoUpdate: true,
    yaw: 0,
    pitch: 0,
    lookAt(position: THREE.Vector3): void {
      this.yaw = THREE.MathUtils.radToDeg(Math.atan2(position.x, position.z));
      this.pitch = THREE.MathUtils.radToDeg(
        Math.atan2(position.y, Math.hypot(position.x, position.z)),
      );
    },
  };
}

function makeStubAdapter(opts: {
  lookAt?: LookAtController | null;
  head?: THREE.Object3D | null;
  leftEye?: THREE.Object3D | null;
  rightEye?: THREE.Object3D | null;
}): AvatarFormatAdapter {
  const getHumanoidBoneNode = vi.fn((role: Parameters<AvatarFormatAdapter["getHumanoidBoneNode"]>[0]) => {
    if (role === "head") return opts.head ?? null;
    if (role === "leftEye") return opts.leftEye ?? null;
    if (role === "rightEye") return opts.rightEye ?? null;
    return null;
  });
  return {
    getMixer: () => {
      throw new Error("not used by eyeGaze.ts");
    },
    getBoneNode: () => null,
    getHumanoidBoneNode,
    getExpressionManager: () => null,
    getLookAt: () => opts.lookAt ?? null,
  };
}

/** Builds a camera positioned so that, under BOTH the stub lookAt's and the
 * fallback path's own `atan2(x,z)`/`atan2(y,hypot(x,z))` convention, the
 * computed raw yaw/pitch exactly equal `yawDeg`/`pitchDeg`. */
function makeStubCameraAtYawPitchDeg(yawDeg: number, pitchDeg: number, radiusXZ = 5): THREE.Camera {
  const yawRad = THREE.MathUtils.degToRad(yawDeg);
  const pitchRad = THREE.MathUtils.degToRad(pitchDeg);
  const x = radiusXZ * Math.sin(yawRad);
  const z = radiusXZ * Math.cos(yawRad);
  const y = radiusXZ * Math.tan(pitchRad);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  return camera;
}

function makeStubCameraAtYawDeg(yawDeg: number, radiusXZ = 5): THREE.Camera {
  return makeStubCameraAtYawPitchDeg(yawDeg, 0, radiusXZ);
}

/** Small deterministic LCG for the micro-saccade test — needs real variance, unlike the fixed-0.5 random used everywhere else. */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const FRAME_DT = 1 / 60;
const NO_SACCADE_RANDOM = () => 0.5; // (0.5*2-1) = 0 amplitude — deterministic, zero saccade contribution.

describe("stepEyeGaze — primary lookAt path (D-04)", () => {
  it("drives lookAt directly: autoUpdate=false, path='lookAt', and never resolves eye bones", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const camera = makeStubCameraAtYawDeg(15);
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    const result = stepEyeGaze(state, {
      adapter,
      camera,
      chatStatus: "listening",
      delta: FRAME_DT,
      random: NO_SACCADE_RANDOM,
    });

    expect(result.path).toBe("lookAt");
    expect(lookAt.autoUpdate).toBe(false);
    expect(adapter.getHumanoidBoneNode).not.toHaveBeenCalledWith("leftEye");
    expect(adapter.getHumanoidBoneNode).not.toHaveBeenCalledWith("rightEye");
  });
});

describe("stepEyeGaze — camera-mode convergence", () => {
  it("converges to within 0.5deg of a 15deg camera target after 60 frames, with zero saccade amplitude", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const camera = makeStubCameraAtYawDeg(15);
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    for (let i = 0; i < 60; i++) {
      stepEyeGaze(state, {
        adapter,
        camera,
        chatStatus: "ready",
        delta: FRAME_DT,
        random: NO_SACCADE_RANDOM,
      });
    }

    expect(Math.abs(lookAt.yaw - 15)).toBeLessThan(0.5);
  });
});

describe("stepEyeGaze — micro-saccades (D-01)", () => {
  it("deviates from the steady base by at least 0.1deg at some frame and never by more than 2.5deg over 5s", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const camera = makeStubCameraAtYawDeg(0); // steady dead-ahead base target.
    const state = createEyeGazeState(NO_SACCADE_RANDOM);
    const random = makeLcg(42);

    let maxAbsDeviation = 0;
    const totalFrames = Math.round(5 / FRAME_DT); // 5 seconds
    for (let i = 0; i < totalFrames; i++) {
      stepEyeGaze(state, { adapter, camera, chatStatus: "ready", delta: FRAME_DT, random });
      maxAbsDeviation = Math.max(maxAbsDeviation, Math.abs(lookAt.yaw));
    }

    expect(maxAbsDeviation).toBeGreaterThanOrEqual(0.1);
    expect(maxAbsDeviation).toBeLessThanOrEqual(2.5);
  });
});

describe("stepEyeGaze — shift detection (D-02)", () => {
  it("reports shiftDetected on the first frame toward a significant target", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    const result = stepEyeGaze(state, {
      adapter,
      camera: makeStubCameraAtYawDeg(15),
      chatStatus: "ready",
      delta: 0,
      random: NO_SACCADE_RANDOM,
    });

    expect(result.shiftDetected).toBe(true);
  });

  it("does not report a shift for a sub-7deg target change even after the cooldown elapses", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    stepEyeGaze(state, {
      adapter,
      camera: makeStubCameraAtYawDeg(15),
      chatStatus: "ready",
      delta: 0,
      random: NO_SACCADE_RANDOM,
    });

    const result = stepEyeGaze(state, {
      adapter,
      camera: makeStubCameraAtYawDeg(18), // +3deg, under the 7deg threshold
      chatStatus: "ready",
      delta: 2, // well past SHIFT_BLINK_COOLDOWN_S
      random: NO_SACCADE_RANDOM,
    });

    expect(result.shiftDetected).toBe(false);
  });

  it("does not report a second significant jump within the 1.2s cooldown, but does once it elapses", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    stepEyeGaze(state, {
      adapter,
      camera: makeStubCameraAtYawDeg(15),
      chatStatus: "ready",
      delta: 0,
      random: NO_SACCADE_RANDOM,
    });

    const withinCooldown1 = stepEyeGaze(state, {
      adapter,
      camera: makeStubCameraAtYawDeg(30),
      chatStatus: "ready",
      delta: 0.5,
      random: NO_SACCADE_RANDOM,
    });
    expect(withinCooldown1.shiftDetected).toBe(false);

    const withinCooldown2 = stepEyeGaze(state, {
      adapter,
      camera: makeStubCameraAtYawDeg(30),
      chatStatus: "ready",
      delta: 0.5,
      random: NO_SACCADE_RANDOM,
    });
    expect(withinCooldown2.shiftDetected).toBe(false);

    const afterCooldown = stepEyeGaze(state, {
      adapter,
      camera: makeStubCameraAtYawDeg(30),
      chatStatus: "ready",
      delta: 0.3, // total elapsed since last shift: 0.5 + 0.5 + 0.3 = 1.3s >= 1.2s
      random: NO_SACCADE_RANDOM,
    });
    expect(afterCooldown.shiftDetected).toBe(true);
  });
});

describe("stepEyeGaze — aversion mode (thinking)", () => {
  it("moves toward EYE_AVERSION_YAW_DEG/PITCH_DEG (10, -4)", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    for (let i = 0; i < 60; i++) {
      stepEyeGaze(state, {
        adapter,
        camera: null,
        chatStatus: "thinking",
        delta: FRAME_DT,
        random: NO_SACCADE_RANDOM,
      });
    }

    expect(Math.abs(lookAt.yaw - 10)).toBeLessThan(0.5);
    expect(Math.abs(lookAt.pitch - -4)).toBeLessThan(0.5);
  });
});

describe("stepEyeGaze — center mode / no-camera fallback to 0/0", () => {
  it("'stopped' (center mode) moves toward 0/0 even with a camera present", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const camera = makeStubCameraAtYawDeg(15);
    const state = createEyeGazeState(NO_SACCADE_RANDOM);
    // Seed a nonzero starting point so convergence toward 0 is meaningful.
    state.smoothedYaw = 20;

    for (let i = 0; i < 60; i++) {
      stepEyeGaze(state, {
        adapter,
        camera,
        chatStatus: "stopped",
        delta: FRAME_DT,
        random: NO_SACCADE_RANDOM,
      });
    }

    expect(Math.abs(lookAt.yaw)).toBeLessThan(0.5);
  });

  it("camera mode with camera=null moves toward 0/0", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const state = createEyeGazeState(NO_SACCADE_RANDOM);
    state.smoothedYaw = 20;

    for (let i = 0; i < 60; i++) {
      stepEyeGaze(state, {
        adapter,
        camera: null,
        chatStatus: "ready",
        delta: FRAME_DT,
        random: NO_SACCADE_RANDOM,
      });
    }

    expect(Math.abs(lookAt.yaw)).toBeLessThan(0.5);
  });
});

describe("stepEyeGaze — camera behind the head (give-up threshold)", () => {
  it("relaxes to 0/0 when the raw yaw exceeds the give-up threshold (60deg)", () => {
    const lookAt = makeStubLookAt();
    const adapter = makeStubAdapter({ lookAt });
    const camera = makeStubCameraAtYawDeg(170); // far behind
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    for (let i = 0; i < 30; i++) {
      stepEyeGaze(state, {
        adapter,
        camera,
        chatStatus: "ready",
        delta: FRAME_DT,
        random: NO_SACCADE_RANDOM,
      });
    }

    expect(Math.abs(lookAt.yaw)).toBeLessThan(0.5);
  });
});

describe("stepEyeGaze — EyeGazeBias (D-01/D-02 emotion contract)", () => {
  it("pitchOffsetDeg shifts the converged pitch by about that many degrees relative to NEUTRAL_EYE_GAZE_BIAS", () => {
    const camera = makeStubCameraAtYawDeg(0);

    const lookAtNeutral = makeStubLookAt();
    const adapterNeutral = makeStubAdapter({ lookAt: lookAtNeutral });
    const stateNeutral = createEyeGazeState(NO_SACCADE_RANDOM);
    for (let i = 0; i < 120; i++) {
      stepEyeGaze(stateNeutral, {
        adapter: adapterNeutral,
        camera,
        chatStatus: "ready",
        delta: FRAME_DT,
        bias: NEUTRAL_EYE_GAZE_BIAS,
        random: NO_SACCADE_RANDOM,
      });
    }

    const biasedBias: EyeGazeBias = {
      yawOffsetDeg: 0,
      pitchOffsetDeg: -6,
      aversionScale: 1,
      saccadeScale: 0,
    };
    const lookAtBiased = makeStubLookAt();
    const adapterBiased = makeStubAdapter({ lookAt: lookAtBiased });
    const stateBiased = createEyeGazeState(NO_SACCADE_RANDOM);
    for (let i = 0; i < 120; i++) {
      stepEyeGaze(stateBiased, {
        adapter: adapterBiased,
        camera,
        chatStatus: "ready",
        delta: FRAME_DT,
        bias: biasedBias,
        random: NO_SACCADE_RANDOM,
      });
    }

    const diff = lookAtNeutral.pitch - lookAtBiased.pitch;
    expect(diff).toBeCloseTo(6, 0);
  });
});

describe("stepEyeGaze — bone fallback path (D-04)", () => {
  function makeEyeRig(): { head: THREE.Object3D; leftEye: THREE.Object3D; rightEye: THREE.Object3D } {
    const head = new THREE.Object3D();
    const leftEye = new THREE.Object3D();
    const rightEye = new THREE.Object3D();
    head.add(leftEye);
    head.add(rightEye);
    return { head, leftEye, rightEye };
  }

  it("rotates the eyes toward a camera on the +X side (path='bones') without accumulating across repeated frames", () => {
    const { head, leftEye, rightEye } = makeEyeRig();
    const adapter = makeStubAdapter({ lookAt: null, head, leftEye, rightEye });
    // 45deg yaw (+X side), well within the give-up threshold (60deg) so the
    // target isn't relaxed to dead-ahead.
    const camera = makeStubCameraAtYawDeg(45);
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    let result: EyeGazeStepResult | undefined;
    for (let i = 0; i < 100; i++) {
      result = stepEyeGaze(state, {
        adapter,
        camera,
        chatStatus: "ready",
        delta: FRAME_DT,
        random: NO_SACCADE_RANDOM,
      });
    }

    expect(result!.path).toBe("bones");

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(leftEye.quaternion);
    expect(forward.x).toBeGreaterThan(0);

    const quaternionAt100 = leftEye.quaternion.clone();
    for (let i = 0; i < 100; i++) {
      stepEyeGaze(state, {
        adapter,
        camera,
        chatStatus: "ready",
        delta: FRAME_DT,
        random: NO_SACCADE_RANDOM,
      });
    }

    expect(leftEye.quaternion.angleTo(quaternionAt100)).toBeLessThan(1e-4);
  });

  it("clamps the fallback path to +/-12deg yaw and +/-10deg pitch", () => {
    const { head, leftEye, rightEye } = makeEyeRig();
    const adapter = makeStubAdapter({ lookAt: null, head, leftEye, rightEye });
    // 45deg yaw target: exceeds BONE_MAX_YAW_DEG(12) but is well under the
    // give-up threshold (60deg), so it exercises the clamp, not the give-up.
    const camera = makeStubCameraAtYawDeg(45);
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    for (let i = 0; i < 200; i++) {
      stepEyeGaze(state, {
        adapter,
        camera,
        chatStatus: "ready",
        delta: FRAME_DT,
        random: NO_SACCADE_RANDOM,
      });
    }

    const euler = new THREE.Euler().setFromQuaternion(leftEye.quaternion, "YXZ");
    const yawDeg = THREE.MathUtils.radToDeg(euler.y);
    expect(Math.abs(yawDeg)).toBeLessThanOrEqual(12 + 0.01);
  });

  it("returns path='none' without throwing when an eye bone cannot be resolved and there is no lookAt", () => {
    const adapter = makeStubAdapter({
      lookAt: null,
      head: new THREE.Object3D(),
      leftEye: null,
      rightEye: new THREE.Object3D(),
    });
    const state = createEyeGazeState(NO_SACCADE_RANDOM);

    let result: EyeGazeStepResult | undefined;
    expect(() => {
      result = stepEyeGaze(state, {
        adapter,
        camera: null,
        chatStatus: "ready",
        delta: FRAME_DT,
        random: NO_SACCADE_RANDOM,
      });
    }).not.toThrow();

    expect(result!.path).toBe("none");
    expect(result!.shiftDetected).toBe(false);
  });
});
