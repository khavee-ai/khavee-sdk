/**
 * crossfade.ts — Pose-gap-adaptive eased crossfade engine (XFADE-01).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Ported from local prototype branch wayfinder/5-crossfade-prototype,
 * commit 6d0b9d7 ("Variant C" — the wayfinder ticket #5 decision). Do not
 * reimplement from notes; this is the validated reference (D-02).
 *
 * Replaces THREE's built-in AnimationAction.fadeIn()/fadeOut()/crossFadeTo()
 * (fixed-duration, linear only) with a manual per-frame setEffectiveWeight
 * ramp whose duration adapts to how different the target pose is from the
 * live pose, eased with easeInOutCubic instead of a linear blend.
 */

import * as THREE from "three";

// ── Easing ──────────────────────────────────────────────────────────────

/**
 * Cubic ease-in-out timing curve. `t` and the return value are both in
 * [0, 1]; endpoints are fixed (0 -> 0, 1 -> 1) and the curve is
 * monotonically increasing across the domain.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Pose-gap measurement ────────────────────────────────────────────────

/**
 * Max angular distance (radians) between the live pose and a clip's
 * first-frame pose, across every bone the clip animates.
 *
 * Max, not the arithmetic mean across bones — a single dramatically-
 * different limb (e.g. a raised arm) is what causes visible crossfade
 * "popping," and blending that signal in with an otherwise-static skeleton
 * would dilute it into invisibility. Model-agnostic — no hardcoded bone
 * names; tracks/bones that don't resolve are simply skipped.
 */
export function computePoseGapAngle(
  scene: THREE.Object3D,
  toClip: THREE.AnimationClip,
): number {
  const qLive = new THREE.Quaternion();
  const qTarget = new THREE.Quaternion();
  let max = 0;
  for (const track of toClip.tracks) {
    if (!track.name.endsWith(".quaternion")) continue;
    const boneName = track.name.replace(".quaternion", "");
    const bone = scene.getObjectByName(boneName);
    if (!bone) continue;
    qLive.copy(bone.quaternion);
    qTarget.set(track.values[0], track.values[1], track.values[2], track.values[3]);
    const a = qLive.angleTo(qTarget);
    if (a > max) max = a;
  }
  return max;
}

/**
 * Maps a max pose-gap angle (radians) to a blend duration (seconds) in the
 * 0.3-0.9s range. ~90 degrees (PI/2) is treated as "very different pose"
 * (one limb swinging through roughly a right angle) and clamps to the
 * 0.9s ceiling beyond that.
 *
 * @param maxAngleRad - The max per-bone pose-gap angle, from
 *   `computePoseGapAngle`.
 * @param floorSeconds - Optional minimum duration. Forward-compatibility
 *   hook for Phase 11's TRANS-01/02 `starting`/`stopped` minimum-duration
 *   floors (~1.0-1.5s) layered on top of this 0.3-0.9s range; unused this
 *   phase (default undefined leaves the 0.3-0.9s behavior untouched).
 */
export function poseGapToDuration(maxAngleRad: number, floorSeconds?: number): number {
  const minDuration = 0.3;
  const maxDuration = 0.9;
  const maxExpectedAngle = Math.PI / 2;
  const t = THREE.MathUtils.clamp(maxAngleRad / maxExpectedAngle, 0, 1);
  const duration = THREE.MathUtils.lerp(minDuration, maxDuration, t);
  return floorSeconds !== undefined ? Math.max(duration, floorSeconds) : duration;
}

// ── Blend state + per-frame ramp ────────────────────────────────────────

/**
 * Tracks an in-progress crossfade between two AnimationActions. Mutated
 * in place by `stepCrossfade` every frame — never converted to React
 * state (see the codebase-wide `useRef`-for-per-frame-state convention).
 */
export interface BlendState {
  active: boolean;
  from: THREE.AnimationAction | null;
  to: THREE.AnimationAction | null;
  startTime: number;
  duration: number;
}

/**
 * Starts a pose-gap-adaptive crossfade from `fromAction` to `toAction`.
 *
 * @param fromAction - The currently-playing action, or null if none.
 * @param toAction - The action to blend into.
 * @param scene - The avatar's scene graph, used to measure the live pose
 *   against `toAction`'s target clip via `computePoseGapAngle`.
 * @param floorSeconds - Optional minimum blend duration; see
 *   `poseGapToDuration`.
 * @returns A fresh `BlendState` to be advanced every frame via
 *   `stepCrossfade`.
 */
export function beginCrossfade(
  fromAction: THREE.AnimationAction | null,
  toAction: THREE.AnimationAction,
  scene: THREE.Object3D,
  floorSeconds?: number,
): BlendState {
  const maxAngle = computePoseGapAngle(scene, toAction.getClip());
  const duration = poseGapToDuration(maxAngle, floorSeconds);

  toAction.reset();
  // three.js's AnimationMixer only evaluates actions that are both
  // `enabled` and in the "playing" set — setEffectiveWeight alone does
  // NOT make an action contribute to the mixer's output. `.enabled = true`
  // and `.play()` must happen before/around the initial weight-0 call, or
  // the target animation silently never appears.
  toAction.enabled = true;
  toAction.setEffectiveWeight(0);
  toAction.play();

  return {
    active: true,
    from: fromAction,
    to: toAction,
    startTime: performance.now(),
    duration,
  };
}

/**
 * Advances an in-progress crossfade by one frame. Call every frame (e.g.
 * from `useFrame`, after `mixer.update(delta)`) while `blend.active` is
 * true. No-ops if the blend has no target action or is already inactive.
 */
export function stepCrossfade(blend: BlendState): void {
  if (!blend.active || !blend.to) return;
  const elapsed = (performance.now() - blend.startTime) / 1000;
  const t = Math.min(elapsed / blend.duration, 1);
  const eased = easeInOutCubic(t);
  blend.from?.setEffectiveWeight(1 - eased);
  blend.to.setEffectiveWeight(eased);
  if (t >= 1) {
    blend.from?.stop();
    blend.active = false;
  }
}
