// 11-15 gap closure (G5 fix) — regression tests for remapMixamoAnimationToVrm's
// hips VectorKeyframeTrack anchor. Prior behavior normalized every retargeted
// clip's hips track to start at Y=0, which mismatched the VRM's actual
// bind-pose local hips Y, producing a visible Y-axis drop as THREE's
// PropertyMixer blended between the two on any never-yet-driven skeleton
// (see AnimationStateEngine.ts's "11-15 gap closure" file-header diagnosis
// block for the full headless production-path runtime evidence). This file
// uses synthetic fixtures + a PropertyMixer-blend simulation, matching this
// package's existing test suite pattern — no real VRM/FBX file load.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { remapMixamoAnimationToVrm } from "./remapMixamoAnimationToVrm";

/**
 * Builds a minimal synthetic "Mixamo asset" — a THREE.Group containing a
 * `mixamorigHips` node (parented so `getWorldQuaternion`/`.parent!.getWorldQuaternion`
 * resolve, as the retargeter unconditionally calls both for every mapped
 * track) and an AnimationClip named `mixamo.com` carrying one hips
 * VectorKeyframeTrack with the given raw (pre-scale) Y keyframe values.
 */
function makeSyntheticMixamoAsset(params: {
  motionHipsHeight: number;
  rawYKeyframes: [number, number];
}): THREE.Group {
  const { motionHipsHeight, rawYKeyframes } = params;
  const root = new THREE.Group();
  const hipsNode = new THREE.Object3D();
  hipsNode.name = "mixamorigHips";
  hipsNode.position.set(0, motionHipsHeight, 0);
  root.add(hipsNode);

  const [y0, y1] = rawYKeyframes;
  const track = new THREE.VectorKeyframeTrack(
    "mixamorigHips.position",
    [0, 1],
    [0, y0, 0, 0, y1, 0],
  );
  const clip = new THREE.AnimationClip("mixamo.com", 1, [track]);
  root.animations = [clip];
  return root;
}

/**
 * A minimal mock VRM matching the shape `remapMixamoAnimationToVrm` reads.
 * `bindPoseHipsY` is the LOCAL hips Y (what THREE's PropertyMixer captures
 * as `original` for the `hips.position` binding — the value this fix
 * anchors against). `worldHipsY`/`rootY` drive the existing (unchanged)
 * `hipsPositionScale` computation at lines 25-30.
 */
function makeMockVrm(params: { bindPoseHipsY: number; worldHipsY: number; rootY?: number }) {
  const { bindPoseHipsY, worldHipsY, rootY = 0 } = params;
  return {
    humanoid: {
      getNormalizedBoneNode: (name: string) => {
        if (name !== "hips") return null;
        return {
          name: "Normalized_hips",
          position: { y: bindPoseHipsY },
          getWorldPosition: (v: THREE.Vector3) => {
            v.set(0, worldHipsY, 0);
            return v;
          },
        };
      },
    },
    scene: {
      getWorldPosition: (v: THREE.Vector3) => {
        v.set(0, rootY, 0);
        return v;
      },
    },
    meta: { metaVersion: "1" },
  };
}

function getHipsPositionTrack(clip: THREE.AnimationClip): THREE.VectorKeyframeTrack {
  const track = clip.tracks.find(
    (t) => t.name.endsWith(".position") && /hips/i.test(t.name),
  );
  if (!track) throw new Error("hips position track not found in remapped clip");
  return track as THREE.VectorKeyframeTrack;
}

describe("remapMixamoAnimationToVrm — hips Y anchor (11-15 gap closure G5 fix)", () => {
  it("anchors the remapped hips track's first-keyframe Y at the VRM bind-pose local hips Y, NOT 0", () => {
    const bindPoseHipsY = 1.008;
    const vrm = makeMockVrm({ bindPoseHipsY, worldHipsY: 1, rootY: 0 });
    // motionHipsHeight === worldHipsY - rootY => hipsPositionScale === 1,
    // keeping the raw keyframe values directly comparable to the output.
    const asset = makeSyntheticMixamoAsset({ motionHipsHeight: 1, rawYKeyframes: [5, 7] });

    const remapped = remapMixamoAnimationToVrm(vrm as any, asset);
    const hipsTrack = getHipsPositionTrack(remapped);

    // values layout: [x0, y0, z0, x1, y1, z1]
    const firstKeyframeY = hipsTrack.values[1];
    expect(firstKeyframeY).toBeCloseTo(bindPoseHipsY, 6);
    expect(firstKeyframeY).not.toBeCloseTo(0, 3);
  });

  it("contrasting guard: the OLD anchor-to-0 normalization would have produced first-keyframe Y ≈ 0 for the identical input", () => {
    // Re-derives the OLD (pre-fix) value directly from the fixed function's
    // own output, so this test genuinely guards the fix rather than being a
    // tautology: OLD = NEW - bindPoseHipsY (since NEW = v - firstY +
    // bindPoseHipsY and OLD = v - firstY).
    const bindPoseHipsY = 1.008;
    const vrm = makeMockVrm({ bindPoseHipsY, worldHipsY: 1, rootY: 0 });
    const asset = makeSyntheticMixamoAsset({ motionHipsHeight: 1, rawYKeyframes: [5, 7] });

    const remapped = remapMixamoAnimationToVrm(vrm as any, asset);
    const hipsTrack = getHipsPositionTrack(remapped);
    const newFirstKeyframeY = hipsTrack.values[1];

    const oldFirstKeyframeY = newFirstKeyframeY - bindPoseHipsY;
    expect(oldFirstKeyframeY).toBeCloseTo(0, 6);
  });

  it("PropertyMixer flatness-across-weights: applied(w) = bindPoseY*(1-w) + animatedFirstY*w stays flat at bindPoseY for every w with the fix, but drops toward 0 as w->1 under the old anchor-to-0 behavior", () => {
    const bindPoseHipsY = 1.008;
    const vrm = makeMockVrm({ bindPoseHipsY, worldHipsY: 1, rootY: 0 });
    const asset = makeSyntheticMixamoAsset({ motionHipsHeight: 1, rawYKeyframes: [5, 7] });

    const remapped = remapMixamoAnimationToVrm(vrm as any, asset);
    const fixedFirstY = getHipsPositionTrack(remapped).values[1];
    const oldFirstY = fixedFirstY - bindPoseHipsY; // see contrasting-guard test above

    for (let w = 0; w <= 1; w += 0.1) {
      const appliedFixed = bindPoseHipsY * (1 - w) + fixedFirstY * w;
      expect(appliedFixed).toBeCloseTo(bindPoseHipsY, 6);
    }

    // Old behavior: flat only at w=0 (matches bind pose), then drops
    // monotonically toward the animated (0-anchored) value as w -> 1.
    const appliedOldAtW0 = bindPoseHipsY * (1 - 0) + oldFirstY * 0;
    const appliedOldAtWHalf = bindPoseHipsY * (1 - 0.5) + oldFirstY * 0.5;
    const appliedOldAtW1 = bindPoseHipsY * (1 - 1) + oldFirstY * 1;
    expect(appliedOldAtW0).toBeCloseTo(bindPoseHipsY, 6);
    expect(appliedOldAtWHalf).toBeLessThan(appliedOldAtW0);
    expect(appliedOldAtW1).toBeCloseTo(0, 6);
  });

  it("inter-clip consistency: two different clips with different raw hip-Y keyframes both start at the SAME (bind-pose) height after the fix", () => {
    const bindPoseHipsY = 1.008;
    const vrm = makeMockVrm({ bindPoseHipsY, worldHipsY: 1, rootY: 0 });

    const assetA = makeSyntheticMixamoAsset({ motionHipsHeight: 1, rawYKeyframes: [5, 7] });
    const assetB = makeSyntheticMixamoAsset({ motionHipsHeight: 1, rawYKeyframes: [-3, 12] });

    const remappedA = remapMixamoAnimationToVrm(vrm as any, assetA);
    const remappedB = remapMixamoAnimationToVrm(vrm as any, assetB);

    const firstYA = getHipsPositionTrack(remappedA).values[1];
    const firstYB = getHipsPositionTrack(remappedB).values[1];

    expect(firstYA).toBeCloseTo(bindPoseHipsY, 6);
    expect(firstYB).toBeCloseTo(bindPoseHipsY, 6);
    expect(firstYA).toBeCloseTo(firstYB, 6);
  });
});
