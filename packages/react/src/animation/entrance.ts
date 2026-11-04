/**
 * entrance.ts — the one-shot entrance clip (run, jump or drop in).
 *
 * An `entrance` key in the animation config names a clip that plays once
 * when the avatar first appears, before any status clip. It holds its last
 * frame and hands over to normal clip selection shortly before it ends, so
 * the status clip (idle, or the greeting) crossfades in from the landing
 * pose. VRMAvatar retargets it anchored at its LAST frame, so it may start
 * anywhere (off-screen, above the frame) but lands where idle stands.
 */
import * as THREE from "three";

/** Config key / clip name of the entrance clip. */
export const ENTRANCE_CLIP_NAME = "entrance";

/** Config key / clip name of the in-place walk loop used by `entranceWalk`. */
export const ENTRANCE_WALK_CLIP_NAME = "entranceWalk";

/**
 * Which clip the entrance plays and how. `loop` clips (a walk) keep cycling
 * until `isFinished` reports true; one-shot clips hand over shortly before
 * their end.
 */
export interface EntrancePlan {
  clipName: string;
  loop: boolean;
  isFinished?: () => boolean;
}

/** Seconds before the clip ends that the status clip starts crossfading in. */
export const ENTRANCE_HANDOFF_SECONDS = 0.5;

export type EntrancePhase = "pending" | "playing" | "done";

/** Clip names minus the entrance clips, for status-driven clip resolution. */
export function withoutEntrance(names: string[]): string[] {
  return names.filter((name) => name !== ENTRANCE_CLIP_NAME && name !== ENTRANCE_WALK_CLIP_NAME);
}

/**
 * Starts the entrance at full weight: a one-shot plays once and holds its
 * last frame; a loop repeats until the plan says it's finished.
 */
export function startEntrance(action: THREE.AnimationAction, loop = false): void {
  action.reset();
  if (loop) {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  } else {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(1);
  action.play();
}

/** Whether the entrance is close enough to its end to hand over. */
export function isEntranceHandoffDue(
  action: THREE.AnimationAction,
  handoffSeconds = ENTRANCE_HANDOFF_SECONDS,
): boolean {
  const duration = action.getClip().duration;
  return !action.isRunning() || action.time >= duration - Math.min(handoffSeconds, duration / 2);
}
