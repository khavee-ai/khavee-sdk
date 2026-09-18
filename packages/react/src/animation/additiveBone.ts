/**
 * additiveBone.ts — Non-accumulating additive bone write for bones the
 * mixer may not drive (P18-ACC).
 *
 * `gaze.ts`'s `head.quaternion.multiply(delta)` idiom (PERF-01) is only
 * non-accumulating BECAUSE an upstream system — the animation mixer —
 * rewrites the head bone's quaternion every single frame before gaze runs.
 * A bare `multiply(delta)` on a bone the mixer does NOT drive would compound
 * every call: applying the same 5-degree delta 100 times would leave the
 * bone rotated 500 degrees, not 5.
 *
 * Eye bones (`leftEye`/`rightEye`, the bone-fallback path in `eyeGaze.ts`,
 * D-04) and jaw bones (`jaw`, viseme motion, VIS-03) are usually NOT keyed
 * by any animation clip, so there is no upstream rewrite to piggyback on.
 * This module gives those bones the same "delta added on top of whatever is
 * already there this frame" behavior, but detects whether "already there"
 * changed since the last write (an upstream system DID touch it — e.g. a
 * clip that happens to key eye bones) versus is unchanged (nothing wrote it
 * since our own last write — reapply the delta on top of our OWN last base,
 * not on top of our own last WRITTEN value, which is what would accumulate).
 */

import * as THREE from "three";

/** Angle (radians) above which a bone's current orientation is treated as a
 * fresh upstream write rather than floating-point noise left over from our
 * own last write to the same bone. */
const UPSTREAM_WRITE_EPSILON_RAD = 1e-5;

/**
 * Per-bone bookkeeping for `applyAdditiveDelta`. One instance per bone,
 * created once via `createAdditiveBoneSlot()` and reused every frame.
 */
export interface AdditiveBoneSlot {
  /** The upstream base orientation this frame's delta is applied on top of. */
  base: THREE.Quaternion;
  /** The value this module itself last wrote to the bone, used to detect
   * whether anything else touched the bone since. */
  lastWritten: THREE.Quaternion;
  /** Whether `base`/`lastWritten` have been seeded yet. */
  initialized: boolean;
}

/** Creates a fresh, unseeded additive-bone slot. */
export function createAdditiveBoneSlot(): AdditiveBoneSlot {
  return {
    base: new THREE.Quaternion(),
    lastWritten: new THREE.Quaternion(),
    initialized: false,
  };
}

/**
 * Applies `delta` additively on top of `bone`'s upstream base orientation,
 * without accumulating across repeated calls when nothing else writes the
 * bone in between.
 *
 * If `bone.quaternion` differs from `slot.lastWritten` by more than
 * `UPSTREAM_WRITE_EPSILON_RAD` (or the slot has never been initialized),
 * the current value is treated as a fresh upstream pose and captured into
 * `slot.base`. The final write is always `base * delta`, so repeated calls
 * with an unchanged upstream base and the same `delta` land on the same
 * orientation every time rather than compounding.
 *
 * Never allocates — all scratch state lives on `slot`.
 */
export function applyAdditiveDelta(
  bone: THREE.Object3D,
  slot: AdditiveBoneSlot,
  delta: THREE.Quaternion,
): void {
  if (!slot.initialized || bone.quaternion.angleTo(slot.lastWritten) > UPSTREAM_WRITE_EPSILON_RAD) {
    slot.base.copy(bone.quaternion);
  }

  bone.quaternion.copy(slot.base).multiply(delta);
  slot.lastWritten.copy(bone.quaternion);
  slot.initialized = true;
}
