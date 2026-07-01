import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

// D-01: Base/lower-body bone set — always driven by the continuous base
// clip, never swapped on chatStatus transitions.
export const BASE_LOWER_BONES: string[] = [
  "hips",
  "spine",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
];

// D-02: Upper-body bone set — driven by the upper-body layer, crossfades
// between idle-upper and gesture clips. chest/upperChest/neck are
// deliberately included here (not in BASE_LOWER_BONES) per D-02 rationale:
// gesture clips get coherent torso-lean + arm motion instead of a locked
// torso fighting arm movement.
export const UPPER_BONES: string[] = [
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
];

/**
 * Resolves a list of VRM humanoid bone names to the actual per-model
 * normalized rig node names (e.g. `"Normalized_" + <raw skeleton node name>`,
 * which varies per loaded VRM file). Never string-match bone names against
 * track names directly — track names are already-remapped node names, not
 * literal bone names.
 *
 * @param vrm - The currently loaded VRM instance.
 * @param boneNames - VRM humanoid bone names to resolve (e.g. from
 *   BASE_LOWER_BONES or UPPER_BONES).
 * @returns Set of resolved node names present on this VRM's normalized rig.
 */
function getBoneTrackNodeNames(vrm: VRM, boneNames: string[]): Set<string> {
  const nodeNames = new Set<string>();

  for (const boneName of boneNames) {
    const node = vrm.humanoid?.getNormalizedBoneNode(boneName as any);
    if (node?.name) {
      nodeNames.add(node.name);
    }
  }

  return nodeNames;
}

/**
 * Filters an already-remapped `THREE.AnimationClip` down to only the tracks
 * belonging to a given set of VRM humanoid bones, resolved per the currently
 * loaded VRM model.
 *
 * The original clip's duration is always passed through explicitly — never
 * auto-recomputed from the filtered track subset — so bone-masked sub-clips
 * derived from the same source clip never drift out of phase relative to
 * each other over long idle loops (Pitfall 4).
 *
 * This function has a no-throw contract: it always returns a valid clip,
 * which may have zero tracks if none of `boneNames` resolve to any track in
 * `clip` (e.g. a non-Mixamo-remapped clip). Callers are responsible for
 * handling the empty-track fallback.
 *
 * @param clip - Source clip, already remapped via `remapMixamoAnimationToVrm`.
 * @param vrm - The currently loaded VRM instance.
 * @param boneNames - VRM humanoid bone names to keep (e.g. BASE_LOWER_BONES).
 * @param newName - Name for the resulting filtered clip.
 * @returns A new `THREE.AnimationClip` containing only the matching tracks.
 */
export function filterClipTracksByBoneSet(
  clip: THREE.AnimationClip,
  vrm: VRM,
  boneNames: string[],
  newName: string
): THREE.AnimationClip {
  const nodeNames = getBoneTrackNodeNames(vrm, boneNames);

  const filteredTracks = clip.tracks.filter((track) => {
    const nodeName = track.name.split(".")[0];
    return nodeNames.has(nodeName);
  });

  return new THREE.AnimationClip(newName, clip.duration, filteredTracks);
}
