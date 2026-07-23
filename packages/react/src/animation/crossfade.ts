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
 *
 * `fromStartWeight`/`toStartWeight` (T-pose/bind-pose snap fix — see
 * .planning/debug/tpose-snap-speak-toggle.md): the ACTUAL effective weight
 * each action had at the moment `beginCrossfade` was called, captured so
 * `stepCrossfade` can ramp from where each action genuinely started rather
 * than assuming `from` always starts at 1 and `to` always starts at 0. Both
 * assumptions hold in the common case (a settled, non-interrupted switch),
 * but break when this crossfade itself INTERRUPTS an already-in-progress
 * one — see `beginCrossfade`'s doc comment for the full mechanism.
 */
export interface BlendState {
  active: boolean;
  from: THREE.AnimationAction | null;
  to: THREE.AnimationAction | null;
  startTime: number;
  duration: number;
  fromStartWeight: number;
  toStartWeight: number;
}

/**
 * Starts a pose-gap-adaptive crossfade from `fromAction` to `toAction`.
 *
 * T-pose/bind-pose snap fix (.planning/debug/tpose-snap-speak-toggle.md):
 * previously this function unconditionally forced `toAction`'s weight to a
 * hardcoded `0`, and `stepCrossfade` assumed `fromAction` always started at
 * weight `1`. Both assumptions hold for a settled, non-interrupted switch
 * (the only case earlier tests exercised), but break the instant this
 * crossfade itself INTERRUPTS an already-in-progress one — which callers
 * like `AnimationStateEngine.ts`'s `switchToClip` do whenever a new target
 * (chatStatus change, or a talk-cycle variant switch) arrives before the
 * previous blend reached `t>=1`. In that case `toAction` is very often the
 * PREVIOUS blend's `fromAction` (e.g. toggling speaking off snaps back to
 * the idle clip that was still mid-fade-out) — an action already
 * contributing real, non-zero weight to the mixer. Forcing it to `0` (while
 * the interrupted `fromAction` keeps whatever partial weight it last had,
 * since `beginCrossfade` never touches `from`'s weight) drops the mixer's
 * TOTAL accumulated weight across both actions well under `1` for at least
 * one rendered frame — VRMAvatar's `mixer.update()` runs before
 * `controller.update()`/`stepCrossfade` each frame, so that under-weighted
 * state is what actually renders. THREE's AnimationMixer fills any
 * shortfall below full weight with the bind pose, producing the reported
 * flash. Seeding each action's ramp from its OWN actual current weight
 * (via `isRunning()`/`getEffectiveWeight()`) instead of a hardcoded
 * endpoint preserves total-weight continuity across an interruption.
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

  // Capture BEFORE mutating anything below: `toAction`'s actual current
  // weight if it's already running (mid a just-interrupted blend), else 0
  // (the ordinary, non-interrupted case — unchanged from prior behavior).
  // `fromAction`'s current weight is captured the same way so stepCrossfade
  // can ramp it down from where it genuinely is, not an assumed 1.
  const toStartWeight = toAction.isRunning() ? toAction.getEffectiveWeight() : 0;
  const fromStartWeight = fromAction?.isRunning() ? fromAction.getEffectiveWeight() : fromAction ? 1 : 0;

  toAction.reset();
  // three.js's AnimationMixer only evaluates actions that are both
  // `enabled` and in the "playing" set — setEffectiveWeight alone does
  // NOT make an action contribute to the mixer's output. `.enabled = true`
  // and `.play()` must happen before/around the initial weight call, or
  // the target animation silently never appears.
  toAction.enabled = true;
  toAction.setEffectiveWeight(toStartWeight);
  toAction.play();

  return {
    active: true,
    from: fromAction,
    to: toAction,
    startTime: performance.now(),
    duration,
    fromStartWeight,
    toStartWeight,
  };
}

/**
 * Advances an in-progress crossfade by one frame. Call every frame (e.g.
 * from `useFrame`, after `mixer.update(delta)`) while `blend.active` is
 * true. No-ops if the blend has no target action or is already inactive.
 *
 * Ramps each action from its captured `fromStartWeight`/`toStartWeight`
 * (see `beginCrossfade`'s doc comment) toward its target endpoint (0 for
 * `from`, 1 for `to`) — this reduces to the original `1 - eased`/`eased`
 * formulas exactly when `fromStartWeight === 1` and `toStartWeight === 0`
 * (the ordinary, non-interrupted case), and generalizes correctly when
 * either action was already mid-ramp at interruption time.
 */
export function stepCrossfade(blend: BlendState): void {
  if (!blend.active || !blend.to) return;
  const elapsed = (performance.now() - blend.startTime) / 1000;
  const t = Math.min(elapsed / blend.duration, 1);
  const eased = easeInOutCubic(t);
  blend.from?.setEffectiveWeight(blend.fromStartWeight * (1 - eased));
  blend.to.setEffectiveWeight(blend.toStartWeight + (1 - blend.toStartWeight) * eased);
  if (t >= 1) {
    blend.from?.stop();
    blend.active = false;
  }
}
