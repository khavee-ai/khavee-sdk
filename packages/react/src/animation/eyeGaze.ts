/**
 * eyeGaze.ts — Ref-driven eye-contact tracking with micro-saccades,
 * glance-aways, and blink-shift reporting (EYE-01, EYE-02, D-01..D-04).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * D-03: this is a NEW, SEPARATE module from `gaze.ts` (head-bone camera
 * gaze) — `gaze.ts` is not modified by this plan (verified by CI:
 * `git diff --quiet -- packages/react/src/animation/gaze.ts`). The two
 * systems drive different bones (head vs eyes) with different math and can
 * evolve independently.
 *
 * D-04 (primary/fallback split): when the adapter exposes `getLookAt()`
 * (VRM's `vrm.lookAt`), this module drives eye contact through it
 * EXCLUSIVELY — it sets `lookAt.yaw`/`.pitch` with `lookAt.autoUpdate =
 * false`, and never touches `leftEye`/`rightEye` bones directly. This is
 * NOT optional: `VRMCore.update()` runs `humanoid.update()` (which drives
 * any mixer-keyed bones) BEFORE `lookAt.update()`, and — critically —
 * `lookAt.update()` runs with `autoUpdate` still `true` by three-vrm's
 * default, which recomputes yaw/pitch from `lookAt.target` and OVERWRITES
 * the eye bones absolutely every frame. A saccade/gaze write straight to
 * `leftEye`/`rightEye` bones while `autoUpdate` is still true would be
 * silently erased that same frame (RESEARCH Pitfall 3). Folding the
 * saccade/glance offsets INTO the yaw/pitch value this module itself
 * computes and writes (once `autoUpdate` is set `false`) avoids the whole
 * class of bug. When `getLookAt()` is absent or returns `null` (GLB, or a
 * VRM applier with no eye-bone mapping), this module falls back to
 * additively rotating `leftEye`/`rightEye` bones directly via
 * `additiveBone.ts`'s non-accumulating helper (D-04 fallback) — those bones
 * are typically NOT keyed by any clip, so a bare `multiply()` would
 * otherwise compound every frame (see `additiveBone.ts`'s header).
 *
 * One frame of lag (primary path only): `lookAt.lookAt()` reads the head's
 * WORLD MATRIX, which three.js only recomputes once per render — calling it
 * mid-frame (before the next render's matrix update) means it is reading
 * last frame's head orientation. This is a well-known three-vrm
 * characteristic, not a bug in this module; the exponential smoothing this
 * module applies on top (`EYE_TRACK_TIME_CONSTANT_S`) comfortably absorbs a
 * single frame of staleness at any real frame rate.
 *
 * D-01 (subtlety): micro-saccades and glance-aways are both SMALL, BOUNDED
 * additive offsets summed into the same final yaw/pitch write — never a
 * second independent write, and never routed around the exponential
 * smoothing gaze itself uses (Pitfall 3's fix applies equally to these).
 *
 * D-02: this module reports `shiftDetected` (a significant, rate-limited
 * gaze-target change) so `AnimationStateEngine.ts` (wired in 18-04) can pass
 * it through to `blink.ts`'s `forceBlink` — real eyes tend to blink right
 * after a big gaze shift. This module does NOT call into `blink.ts`
 * itself; it only reports the signal (RESEARCH Pitfall 5 — the actual
 * coupling wiring is explicitly out of scope for this plan).
 *
 * Testability: mirrors `gaze.ts`'s shape — a pure `createEyeGazeState`/
 * `stepEyeGaze(state, params)` pair operating on a plain mutable state
 * object and a stub `AvatarFormatAdapter`, with `useEyeGaze()` as a thin
 * `useRef` wrapper.
 */

import { useRef } from "react";
import * as THREE from "three";
import type { ChatStatus } from "@khaveeai/core";
import { applyAdditiveDelta, createAdditiveBoneSlot } from "./additiveBone";
import type { AdditiveBoneSlot } from "./additiveBone";
import type { AvatarFormatAdapter } from "./types";

// ── Module-scoped scratch objects — reused every stepEyeGaze() call across
// every useEyeGaze() instance, never `new` inside the per-frame path
// (T-18-01, same DoS/frame-budget precedent as gaze.ts/breathing.ts).
const _scratchCameraWorldPos = new THREE.Vector3();
const _scratchLocalTarget = new THREE.Vector3(); // camera position converted into head-local space, fallback path only
const _scratchEuler = new THREE.Euler();
const _scratchEyeDelta = new THREE.Quaternion(); // final LOCAL delta applied to both eye bones, fallback path only

// ── Eye-tracking smoothing (Assumption A1, extrapolated from gaze.ts's
// GAZE_SMOOTH_TIME_CONSTANT=0.18s precedent, but tighter — eyes should
// visibly lead the head, not lag behind it).
const EYE_TRACK_TIME_CONSTANT_S = 0.08;
const SACCADE_TIME_CONSTANT_S = 0.025;

// ── Micro-saccade scheduling/amplitude (D-01 "subtle" — small enough to
// read as alive, never as a nervous tic).
const SACCADE_MIN_INTERVAL_S = 0.8;
const SACCADE_INTERVAL_JITTER_S = 1.8;
const SACCADE_MAX_YAW_DEG = 1.8;
const SACCADE_MAX_PITCH_DEG = 1.0;

// ── Glance-away scheduling/amplitude (camera mode only) — an occasional
// larger, deliberate look-away-and-back, distinct from a saccade's constant
// small jitter.
const GLANCE_MIN_INTERVAL_S = 6;
const GLANCE_INTERVAL_JITTER_S = 6;
const GLANCE_MIN_DURATION_S = 0.5;
const GLANCE_DURATION_JITTER_S = 0.6;
const GLANCE_MIN_YAW_DEG = 8;
const GLANCE_YAW_JITTER_DEG = 6;
const GLANCE_PITCH_DEG = -3;

// ── Thinking-aversion target (same positive-yaw/slight-downward-pitch
// convention as gaze.ts's AVERSION_YAW_RAD, Pattern 2 — no camera math).
const EYE_AVERSION_YAW_DEG = 10;
const EYE_AVERSION_PITCH_DEG = -4;

// ── Give-up thresholds: beyond these raw angles the camera is considered
// unreachable/behind the avatar this frame, and the target relaxes to
// dead-ahead (0/0) rather than pinning the eyes at their travel limit.
const EYE_TRACK_GIVE_UP_YAW_DEG = 60;
const EYE_TRACK_GIVE_UP_PITCH_DEG = 45;

// ── Per-path travel limits. The primary (`vrm.lookAt`) path can safely use
// a wider range than the bone-fallback path, which has no per-model
// `VRMLookAtRangeMap` calibration to lean on.
const LOOKAT_MAX_YAW_DEG = 25;
const LOOKAT_MAX_PITCH_DEG = 20;
const BONE_MAX_YAW_DEG = 12;
const BONE_MAX_PITCH_DEG = 10;

// ── Blink-coupling shift detection (D-02).
const SHIFT_BLINK_THRESHOLD_DEG = 7;
const SHIFT_BLINK_COOLDOWN_S = 1.2;

/**
 * Per-avatar bias applied on top of the base eye-gaze computation. This
 * field set is the contract 18-02's emotion module mirrors structurally —
 * do not rename these fields without updating that module too.
 */
export interface EyeGazeBias {
  /** Added to the raw target yaw (degrees) in camera/aversion modes, before clamping. */
  yawOffsetDeg: number;
  /** Added to the raw target pitch (degrees) in camera/aversion modes, before clamping. */
  pitchOffsetDeg: number;
  /** Scales the glance-away schedule's countdown rate (camera mode only). `1` = neutral pacing. */
  aversionScale: number;
  /** Scales micro-saccade amplitude and reschedule pacing. `0` fully disables saccades. */
  saccadeScale: number;
}

/** Neutral bias: no offset, standard glance/saccade pacing. */
export const NEUTRAL_EYE_GAZE_BIAS: EyeGazeBias = {
  yawOffsetDeg: 0,
  pitchOffsetDeg: 0,
  aversionScale: 1,
  saccadeScale: 1,
};

/** Which eye-gaze behavior is active, resolved from `ChatStatus`. */
export type EyeGazeMode = "camera" | "aversion" | "center";

/** Maps `ChatStatus` to an `EyeGazeMode`: ready/listening/speaking track the camera, thinking looks away (Pattern 2), everything else centers. */
export function resolveEyeGazeMode(chatStatus: ChatStatus): EyeGazeMode {
  if (chatStatus === "ready" || chatStatus === "listening" || chatStatus === "speaking") {
    return "camera";
  }
  if (chatStatus === "thinking") return "aversion";
  return "center";
}

/** Mutable smoothing/scheduling state for one eye-gaze instance. */
export interface EyeGazeState {
  /** Persisted exponentially-smoothed target yaw (degrees), pre-saccade. */
  smoothedYaw: number;
  /** Persisted exponentially-smoothed target pitch (degrees), pre-saccade. */
  smoothedPitch: number;
  /** Persisted exponentially-smoothed current saccade offset yaw (degrees). */
  saccadeYaw: number;
  /** Persisted exponentially-smoothed current saccade offset pitch (degrees). */
  saccadePitch: number;
  /** The saccade offset `saccadeYaw` is currently easing toward. */
  saccadeTargetYaw: number;
  /** The saccade offset `saccadePitch` is currently easing toward. */
  saccadeTargetPitch: number;
  /** Seconds remaining until the next saccade re-target (camera mode only). */
  timeToNextSaccadeS: number;
  /** Whether a glance-away is currently in progress. */
  glanceActive: boolean;
  /** Seconds remaining in the current glance-away. Only meaningful while `glanceActive`. */
  glanceRemainingS: number;
  /** Seconds remaining until the next glance-away may begin (camera mode only). */
  timeToNextGlanceS: number;
  /** The current glance-away's yaw offset (degrees), signed by side. Only meaningful while `glanceActive`. */
  glanceYaw: number;
  /** The current glance-away's pitch offset (degrees). Only meaningful while `glanceActive`. */
  glancePitch: number;
  /** The target yaw (degrees) at the time of the last reported `shiftDetected`. */
  lastShiftYaw: number;
  /** The target pitch (degrees) at the time of the last reported `shiftDetected`. */
  lastShiftPitch: number;
  /** Seconds elapsed since the last reported `shiftDetected`. */
  timeSinceShiftS: number;
  /** Non-accumulating additive-write bookkeeping for the left eye bone (bone-fallback path only). */
  leftEyeSlot: AdditiveBoneSlot;
  /** Non-accumulating additive-write bookkeeping for the right eye bone (bone-fallback path only). */
  rightEyeSlot: AdditiveBoneSlot;
}

/**
 * Creates a fresh eye-gaze state. The initial saccade/glance timers are
 * seeded from `random` so a freshly-mounted avatar's first saccade/glance
 * isn't perfectly synchronized across every instance. `timeSinceShiftS` is
 * seeded to `SHIFT_BLINK_COOLDOWN_S` (not `0`) so a genuine first-frame
 * gaze shift can immediately report `shiftDetected` rather than being
 * blocked by a cooldown that hasn't actually elapsed yet.
 *
 * @param random - Injectable RNG for deterministic tests. Defaults to `Math.random`.
 */
export function createEyeGazeState(random: () => number = Math.random): EyeGazeState {
  return {
    smoothedYaw: 0,
    smoothedPitch: 0,
    saccadeYaw: 0,
    saccadePitch: 0,
    saccadeTargetYaw: 0,
    saccadeTargetPitch: 0,
    timeToNextSaccadeS: SACCADE_MIN_INTERVAL_S + random() * SACCADE_INTERVAL_JITTER_S,
    glanceActive: false,
    glanceRemainingS: 0,
    timeToNextGlanceS: GLANCE_MIN_INTERVAL_S + random() * GLANCE_INTERVAL_JITTER_S,
    glanceYaw: 0,
    glancePitch: 0,
    lastShiftYaw: 0,
    lastShiftPitch: 0,
    timeSinceShiftS: SHIFT_BLINK_COOLDOWN_S,
    leftEyeSlot: createAdditiveBoneSlot(),
    rightEyeSlot: createAdditiveBoneSlot(),
  };
}

/** Per-frame inputs to `stepEyeGaze`. */
export interface EyeGazeStepParams {
  adapter: AvatarFormatAdapter;
  /** The R3F scene camera (D-04), or `null`/`undefined` when unavailable. Unused outside camera mode. */
  camera: THREE.Camera | null | undefined;
  chatStatus: ChatStatus;
  /** Frame delta time in seconds. Timers do not advance for `delta <= 0`, but the write still happens. */
  delta: number;
  /** Per-avatar bias, e.g. from 18-02's emotion module. Defaults to `NEUTRAL_EYE_GAZE_BIAS`. */
  bias?: EyeGazeBias;
  /** Injectable RNG for deterministic tests. Defaults to `Math.random`. */
  random?: () => number;
}

/** Result of one `stepEyeGaze` call. */
export interface EyeGazeStepResult {
  /** `true` exactly on the frame a significant, rate-limited gaze-target shift was detected (D-02). */
  shiftDetected: boolean;
  /** Which write path was used this call. */
  path: "lookAt" | "bones" | "none";
}

/**
 * Advances `state` by one frame and writes the resulting eye-gaze
 * yaw/pitch, either through `adapter.getLookAt()` (primary path) or
 * additively onto `leftEye`/`rightEye` bones (fallback path, D-04). Never
 * allocates THREE objects and never throws.
 */
export function stepEyeGaze(state: EyeGazeState, params: EyeGazeStepParams): EyeGazeStepResult {
  const { adapter, camera, chatStatus, delta } = params;
  const bias = params.bias ?? NEUTRAL_EYE_GAZE_BIAS;
  const random = params.random ?? Math.random;

  // 1-2. Resolve the write path. Primary (lookAt) short-circuits — the
  // bone-fallback path's bones are never resolved (and getHumanoidBoneNode
  // is never called for leftEye/rightEye) when a lookAt controller exists.
  const lookAt = adapter.getLookAt?.() ?? null;
  let head: THREE.Object3D | null = null;
  let leftEye: THREE.Object3D | null = null;
  let rightEye: THREE.Object3D | null = null;
  let path: "lookAt" | "bones";

  if (lookAt) {
    path = "lookAt";
  } else {
    head = adapter.getHumanoidBoneNode("head");
    leftEye = adapter.getHumanoidBoneNode("leftEye");
    rightEye = adapter.getHumanoidBoneNode("rightEye");
    if (!head || !leftEye || !rightEye) {
      return { shiftDetected: false, path: "none" };
    }
    path = "bones";
  }

  const mode = resolveEyeGazeMode(chatStatus);

  // 3. Raw desired yaw/pitch.
  let rawYawDeg = 0;
  let rawPitchDeg = 0;

  if (mode === "camera" && camera) {
    camera.getWorldPosition(_scratchCameraWorldPos);

    if (path === "lookAt") {
      // Primary path: hand the world position straight to three-vrm's own
      // lookAt math (Assumption A4) and read back the yaw/pitch it computed.
      lookAt!.lookAt(_scratchCameraWorldPos);
      rawYawDeg = lookAt!.yaw;
      rawPitchDeg = lookAt!.pitch;
    } else {
      // Bone-fallback path: convert the camera's world position into the
      // head's own local space, then derive yaw/pitch via atan2. This
      // fallback path's own local convention treats +Z as forward (verified
      // by this file's own behavior test, not by inspection — see the
      // "fallback path" describe block in eyeGaze.test.ts).
      _scratchLocalTarget.copy(_scratchCameraWorldPos);
      head!.worldToLocal(_scratchLocalTarget);
      rawYawDeg = THREE.MathUtils.radToDeg(
        Math.atan2(_scratchLocalTarget.x, _scratchLocalTarget.z),
      );
      rawPitchDeg = THREE.MathUtils.radToDeg(
        Math.atan2(_scratchLocalTarget.y, Math.hypot(_scratchLocalTarget.x, _scratchLocalTarget.z)),
      );
    }

    // Give-up: the camera is more behind the head than in front of it —
    // relax to dead-ahead rather than pinning the eyes at their limit.
    if (
      Math.abs(rawYawDeg) > EYE_TRACK_GIVE_UP_YAW_DEG ||
      Math.abs(rawPitchDeg) > EYE_TRACK_GIVE_UP_PITCH_DEG
    ) {
      rawYawDeg = 0;
      rawPitchDeg = 0;
    }
  } else if (mode === "aversion") {
    // Pattern 2: fixed offset, no camera math.
    rawYawDeg = EYE_AVERSION_YAW_DEG;
    rawPitchDeg = EYE_AVERSION_PITCH_DEG;
  } else {
    // center mode, or camera mode with no camera supplied.
    rawYawDeg = 0;
    rawPitchDeg = 0;
  }

  // 4. Glance-aways — camera mode only; a full cancel (not an eased
  // relax) whenever camera mode is not active this frame.
  if (mode === "camera") {
    if (delta > 0) {
      state.timeToNextGlanceS -= delta * Math.max(0.1, bias.aversionScale);
    }

    if (state.glanceActive) {
      if (delta > 0) {
        state.glanceRemainingS -= delta;
        if (state.glanceRemainingS <= 0) {
          state.glanceActive = false;
          state.timeToNextGlanceS = GLANCE_MIN_INTERVAL_S + random() * GLANCE_INTERVAL_JITTER_S;
        }
      }
    } else if (state.timeToNextGlanceS <= 0) {
      state.glanceActive = true;
      state.glanceRemainingS = GLANCE_MIN_DURATION_S + random() * GLANCE_DURATION_JITTER_S;
      const side = random() < 0.5 ? -1 : 1;
      state.glanceYaw = side * (GLANCE_MIN_YAW_DEG + random() * GLANCE_YAW_JITTER_DEG);
      state.glancePitch = GLANCE_PITCH_DEG;
    }

    if (state.glanceActive) {
      rawYawDeg += state.glanceYaw;
      rawPitchDeg += state.glancePitch;
    }
  } else {
    state.glanceActive = false;
  }

  // 5. Bias offsets (camera/aversion only), then clamp to this path's travel limit.
  if (mode === "camera" || mode === "aversion") {
    rawYawDeg += bias.yawOffsetDeg;
    rawPitchDeg += bias.pitchOffsetDeg;
  }
  const maxYawDeg = path === "lookAt" ? LOOKAT_MAX_YAW_DEG : BONE_MAX_YAW_DEG;
  const maxPitchDeg = path === "lookAt" ? LOOKAT_MAX_PITCH_DEG : BONE_MAX_PITCH_DEG;
  rawYawDeg = THREE.MathUtils.clamp(rawYawDeg, -maxYawDeg, maxYawDeg);
  rawPitchDeg = THREE.MathUtils.clamp(rawPitchDeg, -maxPitchDeg, maxPitchDeg);

  // 6. Shift detection (D-02) — on this pre-smoothing base target.
  if (delta > 0) {
    state.timeSinceShiftS += delta;
  }
  let shiftDetected = false;
  const shiftMagnitudeDeg = Math.hypot(rawYawDeg - state.lastShiftYaw, rawPitchDeg - state.lastShiftPitch);
  if (shiftMagnitudeDeg > SHIFT_BLINK_THRESHOLD_DEG && state.timeSinceShiftS >= SHIFT_BLINK_COOLDOWN_S) {
    shiftDetected = true;
    state.lastShiftYaw = rawYawDeg;
    state.lastShiftPitch = rawPitchDeg;
    state.timeSinceShiftS = 0;
  }

  // 7. Smooth the base target — frame-rate-independent, same idiom as gaze.ts.
  const trackAlpha = delta > 0 ? 1 - Math.exp(-delta / EYE_TRACK_TIME_CONSTANT_S) : 0;
  state.smoothedYaw += (rawYawDeg - state.smoothedYaw) * trackAlpha;
  state.smoothedPitch += (rawPitchDeg - state.smoothedPitch) * trackAlpha;

  // 8. Micro-saccades — camera mode only; targets relax to 0 otherwise, still eased.
  if (mode === "camera") {
    if (delta > 0) {
      state.timeToNextSaccadeS -= delta;
    }
    if (state.timeToNextSaccadeS <= 0) {
      state.saccadeTargetYaw = (random() * 2 - 1) * SACCADE_MAX_YAW_DEG * bias.saccadeScale;
      state.saccadeTargetPitch = (random() * 2 - 1) * SACCADE_MAX_PITCH_DEG * bias.saccadeScale;
      state.timeToNextSaccadeS =
        (SACCADE_MIN_INTERVAL_S + random() * SACCADE_INTERVAL_JITTER_S) /
        Math.max(0.25, bias.saccadeScale);
    }
  } else {
    state.saccadeTargetYaw = 0;
    state.saccadeTargetPitch = 0;
  }
  const saccadeAlpha = delta > 0 ? 1 - Math.exp(-delta / SACCADE_TIME_CONSTANT_S) : 0;
  state.saccadeYaw += (state.saccadeTargetYaw - state.saccadeYaw) * saccadeAlpha;
  state.saccadePitch += (state.saccadeTargetPitch - state.saccadePitch) * saccadeAlpha;

  // 9. Final yaw/pitch — saccades folded into the SAME write as the base
  // target (RESEARCH Pitfall 3: never a second, independent write).
  const finalYawDeg = state.smoothedYaw + state.saccadeYaw;
  const finalPitchDeg = state.smoothedPitch + state.saccadePitch;

  // 10. Write.
  if (path === "lookAt") {
    lookAt!.autoUpdate = false;
    lookAt!.yaw = finalYawDeg;
    lookAt!.pitch = finalPitchDeg;
  } else {
    const yawRad = THREE.MathUtils.degToRad(finalYawDeg);
    const pitchRad = THREE.MathUtils.degToRad(finalPitchDeg);
    // Negative X gives pitch-up in this fallback path's +Z-forward frame
    // (verified by the behavior test, not by inspection).
    _scratchEuler.set(-pitchRad, yawRad, 0, "YXZ");
    _scratchEyeDelta.setFromEuler(_scratchEuler);
    applyAdditiveDelta(leftEye!, state.leftEyeSlot, _scratchEyeDelta);
    applyAdditiveDelta(rightEye!, state.rightEyeSlot, _scratchEyeDelta);
  }

  return { shiftDetected, path };
}

/**
 * Ref-driven eye-gaze stepper. Call `useEyeGaze()` once per component
 * instance and invoke the returned `step(params)` from inside the same
 * `useFrame` callback that updates the mixer, every frame.
 */
export function useEyeGaze(): { step(params: EyeGazeStepParams): EyeGazeStepResult } {
  const stateRef = useRef<EyeGazeState>(createEyeGazeState());

  function step(params: EyeGazeStepParams): EyeGazeStepResult {
    return stepEyeGaze(stateRef.current, params);
  }

  return { step };
}
