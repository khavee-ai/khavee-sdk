/**
 * gaze.ts — Ref-driven procedural camera-relative soft-gaze + thinking
 * aversion delta on the head bone (GAZE-01/02).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Follows `breathing.ts`'s exact hook/state/step shape (a `use<Thing>()`
 * hook holding `useRef`-backed mutable state, wrapping a pure,
 * independently-unit-testable `step(state, adapter, ...)` function) — see
 * `breathing.ts`'s file header for the full rationale (useRef over React
 * state so the per-frame write never re-renders the component).
 *
 * WHY THIS FILE DEVIATES FROM BREATHING/SWAY'S SHAPE (mirrors sway.ts's
 * own header-note precedent for documenting a deviation): breathing and
 * sway are fixed-single-axis SINE OSCILLATORS with no external reference —
 * their delta is a pure function of an internally-owned phase accumulator.
 * Gaze is a TARGET-TRACKING system: `ready`/`listening`/`speaking` compute a
 * delta toward a moving external reference (the R3F scene camera, D-04),
 * which breathing/sway have no equivalent of. `thinking`'s aversion offset,
 * by contrast, needs no camera math at all (Pattern 2) and is structurally
 * identical to breathing/sway's fixed-axis-angle approach.
 *
 * HEAD-BONE FORWARD-AXIS CONVENTION (Task 1 empirical spike, Open Question
 * 1 — see `packages/react/scripts/verify-head-axis.mjs`): running that
 * script against BOTH bundled test rigs (`public/models/male.vrm`'s
 * VRM-normalized head bone, and `public/models/happy.glb`'s literal head
 * bone) measured local **-Z as the forward axis on both formats, no
 * per-format correction needed** (dot=1.0000 against the avatar root's -Z
 * world forward direction, in each rig's bind pose). This is why
 * `HEAD_FORWARD_AXIS` below is a single shared constant instead of a
 * per-format branch — do NOT assume this generalizes to every possible VRM
 * rig a consuming app might load (Pitfall 4); it is verified only for these
 * two bundled assets, which is what this SDK's demo/test pages actually
 * load.
 *
 * CAMERA-RELATIVE DELTA MATH (Pattern 3 — the phase's one genuinely novel
 * piece, per RESEARCH): `Object3D`'s built-in orient-toward-target method is
 * NEVER called on the live bone — per RESEARCH's Pitfall 1 (three-vrm issue
 * #1173's documented "full 360 degree rotation" failure), that method is an
 * ABSOLUTE OVERWRITE with no clamp and no composition with other procedural
 * systems. Instead:
 *   1. Capture the bone's pre-gaze LOCAL orientation into a scratch
 *      (`_scratchCurrent`) — this is the base the mixer/other procedural
 *      systems already wrote this frame.
 *   2. Compute the camera direction in WORLD space, build the absolute
 *      WORLD target quaternion via `setFromUnitVectors(HEAD_FORWARD_AXIS,
 *      direction)`, then convert it into the bone's PARENT-LOCAL space via
 *      `parentWorldQuat^-1 * worldTarget` (Pitfall 4 — never assume a
 *      bone's local space equals world space) — written to
 *      `_scratchLocalTarget`, a scratch-only value, never applied to the
 *      live bone directly.
 *   3. Diff `_scratchLocalTarget` against `_scratchCurrent`, clamp the
 *      resulting angle to `MAX_GAZE_ANGLE_RAD` using the SAME
 *      `angleTo()`+`copy().slerp()` idiom `AnimationStateEngine.ts` already
 *      uses for its PERF-01 spine clamp (two independent scratches, never
 *      slerping directly on the live bone).
 *   4. Ease the (already-clamped) target in from the CURRENT bone
 *      orientation by a per-mode ramp fraction (`GazeState.modeElapsed`,
 *      reset whenever the active gaze mode changes) so gaze fades in over
 *      `RAMP_SECONDS` instead of snapping the instant `chatStatus` changes.
 *   5. Derive the final LOCAL delta (`current^-1 * easedTarget`) and apply
 *      it additively via `head.quaternion.multiply(delta)` — PERF-01,
 *      never `.set()`.
 *
 * `thinking`'s aversion (Pattern 2) skips steps 2-3 entirely — its "target"
 * is simply the current base rotated by a FIXED constant offset
 * (`AVERSION_OFFSET`), so there is no camera dependency and no clamp is
 * needed (the offset is bounded by construction). It still runs through
 * the same ramp/ease/diff/multiply steps 4-5 for a consistent fade-in feel.
 *
 * `starting`/`stopped` (Pitfall 5): a FULL no-op early return, branching
 * directly on `chatStatus` — NOT a damped/zero-amplitude gaze routed
 * through any shared `proceduralScale`/`settleScale` pipeline. These two
 * states already play dedicated greeting/goodbye clips (TRANS-01/02); even
 * a damped gaze delta would risk visibly fighting those clips' own head
 * motion.
 *
 * Testability: state/step are factored out of the hook into
 * `createGazeState`/`stepGaze` (plain functions operating on a plain
 * mutable object and a stub `AvatarFormatAdapter`) so the delta math and
 * additive-write behavior are unit-testable without rendering a React
 * component or a scene — `useGaze()` itself is a thin `useRef` wrapper.
 */

import { useRef } from "react";
import * as THREE from "three";
import type { ChatStatus } from "@khaveeai/core";
import type { AvatarFormatAdapter } from "./types";

// ── Module-scoped scratch objects — reused every stepGaze() call across
// every useGaze() instance, never `new` inside the per-frame path
// (T-12-03, DoS/frame-budget mitigation, same precedent as breathing.ts's
// _scratchDelta / crossfade.ts's qLive/qTarget). Each scratch has a single,
// narrow purpose so intermediate values from one step never leak into the
// next call within the same frame.
const _scratchCurrent = new THREE.Quaternion(); // bone's pre-gaze LOCAL orientation this frame
const _scratchWorldTarget = new THREE.Quaternion(); // absolute WORLD target quaternion (camera mode only)
const _scratchParentWorldQuat = new THREE.Quaternion(); // bone parent's world quaternion, for local-space conversion
const _scratchLocalTarget = new THREE.Quaternion(); // absolute target converted into the bone's parent-local space
const _scratchClampedTarget = new THREE.Quaternion(); // _scratchLocalTarget, clamped to MAX_GAZE_ANGLE_RAD from current
const _scratchEasedTarget = new THREE.Quaternion(); // _scratchClampedTarget, eased in from current by the ramp fraction
const _scratchDelta = new THREE.Quaternion(); // final LOCAL delta actually applied via multiply()
const _scratchHeadWorldPos = new THREE.Vector3();
const _scratchCameraWorldPos = new THREE.Vector3();
const _scratchDirection = new THREE.Vector3();

// Empirically measured (Task 1 spike, see file header) — both bundled test
// rigs' head bones treat local -Z as "forward" in their bind pose.
const HEAD_FORWARD_AXIS = new THREE.Vector3(0, 0, -1);

// Small-degree default max offset (radians). ~0.05rad ≈ 2.9 degrees — a
// few-degree nudge that reads as steady attentiveness, not a head-turn.
// Extrapolated from breathing's ~0.03rad / sway's ~0.025rad idle amplitudes
// (Assumption A1) — slightly larger than either since gaze is a single
// deliberate offset rather than an oscillating one, but still well short of
// a visible head-turn.
export const MAX_GAZE_ANGLE_RAD = 0.05;

// Fixed thinking-aversion offset: a small yaw (look slightly to one side)
// plus a slight downward pitch ("looking away/down while thinking"), no
// camera math (Pattern 2). Magnitude deliberately similar to
// MAX_GAZE_ANGLE_RAD so aversion reads as comparable in scale to the
// camera-relative gaze it's replacing for this one status.
const AVERSION_YAW_RAD = 0.06;
const AVERSION_PITCH_RAD = 0.02;
const AVERSION_OFFSET = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(AVERSION_PITCH_RAD, AVERSION_YAW_RAD, 0, "XYZ"),
);

// Ramp-in duration (seconds) for both gaze modes — short enough to feel
// responsive to a chatStatus change, long enough not to snap. Extrapolated
// from blink's ~150ms pulse envelope as the closest existing "triggered,
// bounded-duration" precedent (Assumption A1).
export const RAMP_SECONDS = 0.3;

/** Which gaze behavior is currently active, per GAZE-01's per-state branch. */
export type GazeMode = "camera" | "aversion" | "none";

/** Mutable ramp/mode-tracking state for one gaze instance. */
export interface GazeState {
  /** Seconds elapsed since `activeMode` last changed — drives the ramp-in
   * easing fraction so gaze fades in smoothly rather than snapping the
   * instant `chatStatus` changes. */
  modeElapsed: number;
  /** The gaze mode observed on the previous `stepGaze` call, used to detect
   * a mode change and reset `modeElapsed` back to 0. */
  activeMode: GazeMode;
}

/** Creates a fresh gaze state with no active mode and a zeroed ramp. */
export function createGazeState(): GazeState {
  return { modeElapsed: 0, activeMode: "none" };
}

function resolveMode(chatStatus: ChatStatus): GazeMode {
  if (chatStatus === "thinking") return "aversion";
  if (chatStatus === "ready" || chatStatus === "listening" || chatStatus === "speaking") {
    return "camera";
  }
  // "starting" | "stopped" — Pitfall 5: full no-op, not a damped mode.
  return "none";
}

/**
 * Advances `state` by `delta` seconds and applies the resulting additive
 * gaze delta to the adapter's head bone. Early-returns without throwing if
 * the head bone cannot be resolved (defensive gate — scene not loaded, or
 * the rig has no mapping for that humanoid role), and is a FULL no-op for
 * `starting`/`stopped` (Pitfall 5) or when camera mode is active but no
 * `camera` was supplied (defensive — cannot compute a target without one).
 *
 * @param state - Mutable ramp/mode state from `createGazeState()`.
 * @param adapter - Format adapter used to resolve the head bone by role
 *   (`getHumanoidBoneNode("head")`) so this works identically on VRM/GLB
 *   (GAZE-02).
 * @param camera - The R3F scene camera (D-04, e.g. `useThree().camera` or
 *   `useFrame`'s first-argument `state.camera`). Unused in `thinking`
 *   aversion mode — that branch has no camera dependency (Pattern 2).
 * @param chatStatus - The 6-value ChatStatus to branch gaze behavior on.
 * @param delta - Frame delta time in seconds.
 */
export function stepGaze(
  state: GazeState,
  adapter: AvatarFormatAdapter,
  camera: THREE.Camera | null | undefined,
  chatStatus: ChatStatus,
  delta: number,
): void {
  const head = adapter.getHumanoidBoneNode("head");
  if (!head) return;

  const mode = resolveMode(chatStatus);

  // Pitfall 5: starting/stopped get NO gaze treatment at all — a plain
  // early return branching directly on chatStatus, not an amplitude-scaled
  // pass through any shared proceduralScale/settleScale pipeline.
  if (mode === "none") {
    state.activeMode = "none";
    state.modeElapsed = 0;
    return;
  }

  // Camera mode with no camera supplied: nothing to compute a target
  // against this frame — defensive no-op rather than throwing. Ramp state
  // is left untouched so a transient missing-camera frame doesn't reset
  // the ease-in the moment a camera does become available.
  if (mode === "camera" && !camera) {
    return;
  }

  if (state.activeMode !== mode) {
    state.activeMode = mode;
    state.modeElapsed = 0;
  }
  state.modeElapsed += delta;
  const strength = Math.min(1, state.modeElapsed / RAMP_SECONDS);

  // Capture the bone's pre-gaze LOCAL orientation BEFORE any gaze write —
  // this is the base the mixer/breathing/sway already wrote this frame.
  _scratchCurrent.copy(head.quaternion);

  if (mode === "aversion") {
    // Pattern 2: fixed offset, no camera math, no clamp needed (bounded by
    // construction). Still eased via the shared ramp/ease/diff/multiply
    // steps below for a consistent fade-in feel.
    _scratchLocalTarget.copy(_scratchCurrent).multiply(AVERSION_OFFSET);
  } else {
    // mode === "camera" (D-04/D-05) — Pattern 3, the phase's one genuinely
    // novel math shape (target-tracking, not a fixed-axis sine).
    head.getWorldPosition(_scratchHeadWorldPos);
    camera!.getWorldPosition(_scratchCameraWorldPos);
    _scratchDirection.subVectors(_scratchCameraWorldPos, _scratchHeadWorldPos).normalize();

    // Absolute WORLD target quaternion — scratch-only, never written to
    // the live bone (Pitfall 1: this is exactly the value a naive call to
    // Object3D's orient-toward-target method on `head` directly would
    // compute and then overwrite the bone with; here it is only ever
    // diffed and clamped, never written straight to the bone).
    _scratchWorldTarget.setFromUnitVectors(HEAD_FORWARD_AXIS, _scratchDirection);

    // Convert the absolute WORLD target into the bone's PARENT-LOCAL space
    // (Pitfall 4 — never assume a bone's local space equals world space):
    // local = parentWorld^-1 * world.
    if (head.parent) {
      head.parent.getWorldQuaternion(_scratchParentWorldQuat);
    } else {
      _scratchParentWorldQuat.identity();
    }
    _scratchLocalTarget
      .copy(_scratchParentWorldQuat)
      .invert()
      .multiply(_scratchWorldTarget);
  }

  // PERF-01 bounded-delta clamp idiom (reused verbatim from
  // AnimationStateEngine.ts's spine clamp): measure the angle from the
  // pre-gaze base to the absolute target, and if it exceeds the max, slerp
  // FROM the base TOWARD the target only far enough to land exactly on the
  // bound — via two independent scratches, never on the live bone.
  const targetAngle = _scratchCurrent.angleTo(_scratchLocalTarget);
  if (targetAngle > MAX_GAZE_ANGLE_RAD && targetAngle > 0) {
    const t = MAX_GAZE_ANGLE_RAD / targetAngle;
    _scratchClampedTarget.copy(_scratchCurrent).slerp(_scratchLocalTarget, t);
  } else {
    _scratchClampedTarget.copy(_scratchLocalTarget);
  }

  // Ease the (already-clamped) target in from the current base by the
  // ramp fraction, so gaze fades in over RAMP_SECONDS rather than snapping.
  _scratchEasedTarget.copy(_scratchCurrent).slerp(_scratchClampedTarget, strength);

  // Final LOCAL delta: current^-1 * easedTarget, so that
  // current.multiply(delta) === easedTarget.
  _scratchDelta.copy(_scratchCurrent).invert().multiply(_scratchEasedTarget);

  // Additive write (PERF-01): multiply(), never set()/lookAt() — preserves
  // whatever orientation the mixer/other procedural systems already wrote
  // to this bone this frame.
  head.quaternion.multiply(_scratchDelta);
}

/**
 * Ref-driven gaze stepper. Call `useGaze()` once per component instance and
 * invoke the returned `step(adapter, camera, chatStatus, delta)` from
 * inside the same `useFrame` callback that updates the mixer, every frame.
 */
export function useGaze(): {
  step(
    adapter: AvatarFormatAdapter,
    camera: THREE.Camera | null | undefined,
    chatStatus: ChatStatus,
    delta: number,
  ): void;
} {
  // A single ref holding a plain mutable state object — not React's other
  // state hook, for the same reason breathing.ts's/sway.ts's state is a ref
  // (see breathing.ts's file header for the full rationale).
  const state = useRef(createGazeState());

  function step(
    adapter: AvatarFormatAdapter,
    camera: THREE.Camera | null | undefined,
    chatStatus: ChatStatus,
    delta: number,
  ): void {
    stepGaze(state.current, adapter, camera, chatStatus, delta);
  }

  return { step };
}
