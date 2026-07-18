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
 *   4. Advance a PERSISTED smoothed-target quaternion (`GazeState.
 *      smoothedTarget`) toward the clamped target via continuous,
 *      frame-rate-independent exponential smoothing (`1 - Math.exp(-delta /
 *      GAZE_SMOOTH_TIME_CONSTANT)`), carried across every `stepGaze` call —
 *      NOT a one-shot fade-in fraction recomputed from the base pose each
 *      frame (that was Gap 1 from 12-06-VERIFICATION.md: the old
 *      `modeElapsed`-based ramp landed exactly on the clamped target every
 *      frame once "ramped", because `_scratchCurrent` is re-captured from
 *      the gaze-free base pose every frame — zero lag, reads as a snap).
 *      The smoothed target is only re-seeded to the current base pose on a
 *      FRESH entry from "none" (`starting`/`stopped` -> a live mode); a
 *      switch between two already-live modes (camera<->aversion) eases
 *      onward from wherever the smoothed target already is, so the head
 *      never snaps back through the neutral base first.
 *   5. Derive the final LOCAL delta (`current^-1 * easedTarget`) and apply
 *      it additively via `head.quaternion.multiply(delta)` — PERF-01,
 *      never `.set()`.
 *
 * `thinking`'s aversion (Pattern 2) skips steps 2-3 entirely — its "target"
 * is simply the current base rotated by a FIXED constant offset
 * (`AVERSION_OFFSET`), so there is no camera dependency and no clamp is
 * needed (the offset is bounded by construction). It still runs through
 * the same smoothing/diff/multiply steps 4-5 for a consistent, continuous
 * easing feel.
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
const _scratchEasedTarget = new THREE.Quaternion(); // snapshot of state.smoothedTarget used to derive this frame's delta
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

// Exponential-smoothing time constant (seconds) for the PERSISTED gaze
// target (Gap 1 fix, 12-06-VERIFICATION.md) — how quickly the applied gaze
// catches up to a moving/changing target: smoothT = 1 - exp(-delta / this),
// frame-rate independent (same elapsed time converges to the same result
// whether advanced in one big step or several small ones). Extrapolated
// from the old one-shot RAMP_SECONDS=0.3s fade-in and
// `AnimationStateEngine.ts`'s SETTLE_RAMP_SECONDS=1.2s settle-ramp
// precedent — short enough to read as responsive, long enough to read as
// smooth rather than snap (Assumption A1).
export const GAZE_SMOOTH_TIME_CONSTANT = 0.18;

/** Which gaze behavior is currently active, per GAZE-01's per-state branch. */
export type GazeMode = "camera" | "aversion" | "none";

/** Mutable smoothing/mode-tracking state for one gaze instance. */
export interface GazeState {
  /** The gaze mode observed on the previous `stepGaze` call, used to detect
   * a fresh entry from "none" (re-seed `smoothedTarget` from the base pose)
   * versus a switch between two already-live modes (ease onward from the
   * current `smoothedTarget`, no re-seed). */
  activeMode: GazeMode;
  /** Persisted smoothed ABSOLUTE LOCAL target orientation, advanced toward
   * each frame's clamped target via continuous exponential slerp. This IS
   * the state that turns the old one-shot fade-in into genuine
   * frame-over-frame damping — carrying it across calls (instead of
   * recomputing purely from the current base pose every frame) is what
   * makes the applied gaze ease continuously rather than snap. */
  smoothedTarget: THREE.Quaternion;
  /** Whether `smoothedTarget` has been seeded from a live base orientation
   * yet. Reset to `false` whenever gaze returns to "none"
   * (`starting`/`stopped`) so a later re-entry re-seeds from the CURRENT
   * base pose rather than easing in from a stale orientation left over
   * from a much earlier session. */
  smoothedInitialized: boolean;
}

/** Creates a fresh gaze state with no active mode and an unseeded,
 * identity-initialized smoothed target. */
export function createGazeState(): GazeState {
  return {
    activeMode: "none",
    smoothedTarget: new THREE.Quaternion(),
    smoothedInitialized: false,
  };
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
 * @param state - Mutable smoothing/mode state from `createGazeState()`.
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
    // Un-seed the smoothed target so a later re-entry into a live mode
    // re-seeds from the CURRENT base pose rather than easing in from a
    // stale orientation left over from a much earlier session. The
    // quaternion value itself is left as-is (harmless, about to be
    // overwritten by the next seed) — only the flag is reset here.
    state.smoothedInitialized = false;
    return;
  }

  // Camera mode with no camera supplied: nothing to compute a target
  // against this frame — defensive no-op rather than throwing. Smoothing
  // state is left untouched so a transient missing-camera frame doesn't
  // reset the ease-in the moment a camera does become available.
  if (mode === "camera" && !camera) {
    return;
  }

  // A fresh entry into a live mode from "none" (or the very first live
  // frame this GazeState instance has ever seen) re-seeds the smoothed
  // target from the base pose below. A switch between two already-live
  // modes (camera<->aversion) does NOT re-seed — the smoothed target
  // continues easing onward from wherever it already is (Gap 1 fix: no
  // snap back through the neutral base on a mode switch).
  const enteringFromNone = state.activeMode === "none";
  state.activeMode = mode;

  // Capture the bone's pre-gaze LOCAL orientation BEFORE any gaze write —
  // this is the base the mixer/breathing/sway already wrote this frame.
  _scratchCurrent.copy(head.quaternion);

  if (!state.smoothedInitialized || enteringFromNone) {
    state.smoothedTarget.copy(_scratchCurrent);
    state.smoothedInitialized = true;
  }

  if (mode === "aversion") {
    // Pattern 2: fixed offset, no camera math, no clamp needed (bounded by
    // construction). Still smoothed via the shared smoothing/diff/multiply
    // steps below for a consistent, continuous easing feel.
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

  // Frame-rate-independent exponential smoothing factor: how far to
  // advance the persisted smoothed target toward THIS frame's clamped
  // target. Clamped to [0,1] defensively (Math.exp(-delta/tc) is already
  // in (0,1] for delta>=0, but guards against a pathological negative or
  // huge delta from a stalled/resumed tab).
  const smoothT = Math.min(1, Math.max(0, 1 - Math.exp(-delta / GAZE_SMOOTH_TIME_CONSTANT)));

  // Advance the PERSISTED smoothed target toward the clamped target IN
  // PLACE — this is GazeState.smoothedTarget itself, not a throwaway
  // scratch, so the next stepGaze call continues easing from here instead
  // of recomputing from a freshly-captured base every frame. This
  // persistence (rather than the old per-frame `modeElapsed`-driven
  // recompute) is what turns the fade-in into continuous, frame-over-frame
  // damping — closing Gap 1 (gaze snapping to target instead of easing).
  state.smoothedTarget.slerp(_scratchClampedTarget, smoothT);

  // Use the persisted smoothed target as this frame's eased target.
  _scratchEasedTarget.copy(state.smoothedTarget);

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
