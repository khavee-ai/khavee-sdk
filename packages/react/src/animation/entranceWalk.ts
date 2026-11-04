/**
 * entranceWalk.ts — the avatar walks on from the side of the frame.
 *
 * Pure timing for VRMAvatar's `entranceWalk` prop: while an in-place walk
 * loop plays, the avatar slides from `distance` metres off to one side to its
 * own spot, facing the way it walks, then turns to face the camera as the
 * status clip (idle, or the greeting) crossfades in.
 */

export interface EntranceWalkOptions {
  /** Side of the frame the avatar walks in from (camera's view). Default: "right". */
  from?: "left" | "right";
  /** How far off-centre it starts, in metres. Default: 3 (off-frame for a full-body shot). */
  distance?: number;
  /** Walking speed in m/s. Default: the walk clip's own stride, measured from its root motion; 1.2 for an in-place clip. */
  speed?: number;
  /** Seconds spent turning to face the camera after arriving. Default: 0.5 */
  turnSeconds?: number;
}

export interface EntranceWalkSample {
  /** Sideways offset from the avatar's own spot, in metres (camera's +X is right). */
  x: number;
  /** Extra yaw in radians on top of facing the camera; 0 faces the camera. */
  yaw: number;
  /** Still walking: the walk clip should keep playing. */
  walking: boolean;
  /** Arrived and turned: the entrance is over. */
  done: boolean;
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** Where the avatar is and which way it faces `elapsed` seconds into the walk-in. */
export function sampleEntranceWalk(elapsed: number, options: EntranceWalkOptions = {}): EntranceWalkSample {
  const side = options.from === "left" ? -1 : 1;
  const distance = Math.max(0, options.distance ?? 3);
  const speed = Math.max(0.1, options.speed ?? 1.2);
  const turnSeconds = Math.max(0, options.turnSeconds ?? 0.5);
  const walkSeconds = distance / speed;
  // Walking toward the centre: from the right that is the camera's -X.
  const walkYaw = (side * -Math.PI) / 2;

  if (elapsed < walkSeconds) {
    return { x: side * distance * (1 - elapsed / walkSeconds), yaw: walkYaw, walking: true, done: false };
  }
  const turn = turnSeconds > 0 ? Math.min(1, (elapsed - walkSeconds) / turnSeconds) : 1;
  return { x: 0, yaw: walkYaw * (1 - smoothstep(turn)), walking: false, done: turn >= 1 };
}
