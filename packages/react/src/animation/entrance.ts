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

/** Seconds before the clip ends that the status clip starts crossfading in. */
export const ENTRANCE_HANDOFF_SECONDS = 0.5;

export type EntrancePhase = "pending" | "playing" | "done";

/** Clip names minus the entrance, for status-driven clip resolution. */
export function withoutEntrance(names: string[]): string[] {
  return names.filter((name) => name !== ENTRANCE_CLIP_NAME);
}

/** Starts the entrance: play once, hold the last frame, full weight. */
export function startEntrance(action: THREE.AnimationAction): void {
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
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
