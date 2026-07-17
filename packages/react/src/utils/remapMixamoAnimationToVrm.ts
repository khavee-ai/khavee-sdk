import * as THREE from "three";
import { mixamoVRMRigMap } from "./mixamoVRMRigMap";

export function remapMixamoAnimationToVrm(vrm: { humanoid: { getNormalizedBoneNode: (arg0: string) => { (): any; new(): any; getWorldPosition: { (arg0: THREE.Vector3): { (): any; new(): any; y: any; }; new(): any; }; name: any; position: { y: number }; }; }; scene: { getWorldPosition: (arg0: THREE.Vector3) => { (): any; new(): any; y: any; }; }; meta: { metaVersion: string; }; }, asset: THREE.Group<THREE.Object3DEventMap>) {
  const foundClip = THREE.AnimationClip.findByName(
    asset.animations,
    "mixamo.com"
  );
  
  if (!foundClip) {
    throw new Error("Animation clip 'mixamo.com' not found");
  }
  
  const clip = foundClip.clone(); // extract the AnimationClip

  const tracks: THREE.KeyframeTrack[] | undefined = []; // KeyframeTracks compatible with VRM will be added here

  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();
  const _vec3 = new THREE.Vector3();

  // Adjust with reference to hips height.
  const motionHipsHeight = asset.getObjectByName("mixamorigHips")!.position.y;
  const vrmHipsY = vrm.humanoid
    ?.getNormalizedBoneNode("hips")
    .getWorldPosition(_vec3).y;
  const vrmRootY = vrm.scene.getWorldPosition(_vec3).y;
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY);
  const hipsPositionScale = vrmHipsHeight / motionHipsHeight;

  // (11-15 gap closure — FIX) The VRM's bind-pose LOCAL hips Y, read BEFORE
  // any animation has ever played (so the bone's local `.position.y` IS the
  // bind pose). This is deliberately the LOCAL value, not the WORLD
  // `vrmHipsY` above — for `male.vrm` the two happen to coincide (the
  // scene root sits at world Y 0, confirmed by the 11-15 headless
  // diagnosis), but THREE's `AnimationMixer`/`PropertyMixer` binds and
  // blends the LOCAL `hips.position` property, so anchoring against
  // anything other than the LOCAL bind-pose value would be wrong for a rig
  // whose scene root is offset from world-origin Y.
  const bindPoseHipsY =
    vrm.humanoid?.getNormalizedBoneNode("hips")?.position.y ?? 0;

  clip.tracks.forEach((track) => {
    // Convert each tracks for VRM use, and push to `tracks`
    const trackSplitted = track.name.split(".");
    const mixamoRigName = trackSplitted[0];
    const vrmBoneName = mixamoVRMRigMap[mixamoRigName as keyof typeof mixamoVRMRigMap];
    const vrmNodeName = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);

    if (vrmNodeName != null) {
      const propertyName = trackSplitted[1];

      // Store rotations of rest-pose.
      mixamoRigNode!.getWorldQuaternion(restRotationInverse).invert();
      mixamoRigNode!.parent!.getWorldQuaternion(parentRestWorldRotation);

      if (track instanceof THREE.QuaternionKeyframeTrack) {
        // Retarget rotation of mixamoRig to NormalizedBone.
        for (let i = 0; i < track.values.length; i += 4) {
          const flatQuaternion = track.values.slice(i, i + 4);

          _quatA.fromArray(flatQuaternion);

          // 親のレスト時ワールド回転 * トラックの回転 * レスト時ワールド回転の逆
          _quatA
            .premultiply(parentRestWorldRotation)
            .multiply(restRotationInverse);

          _quatA.toArray(flatQuaternion);

          flatQuaternion.forEach((v, index) => {
            track.values[index + i] = v;
          });
        }

        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            `${vrmNodeName}.${propertyName}`,
            track.times,
            track.values.map((v, i) =>
              vrm.meta?.metaVersion === "0" && i % 2 === 0 ? -v : v
            )
          )
        );
      } else if (track instanceof THREE.VectorKeyframeTrack) {
        const scaled = track.values.map(
          (v, i) =>
            (vrm.meta?.metaVersion === "0" && i % 3 !== 1 ? -v : v) *
            hipsPositionScale
        );

        // Normalize Y (vertical axis, index % 3 === 1) by subtracting the
        // first keyframe's Y, then re-anchoring at the VRM's bind-pose
        // LOCAL hips Y instead of 0. This still prevents the avatar from
        // jumping to a different height when switching between animations
        // that were exported from Mixamo with different hip Y offsets (every
        // clip retargeted through this function is still anchored at the
        // SAME shared constant — the only change is that the shared height
        // is now the bind pose instead of 0).
        //
        // (11-15 gap closure — FIX) Anchoring at 0 (the prior behavior) made
        // THREE's PropertyMixer blend from the bind-pose `original` value
        // (~1.008 for `male.vrm`) down to the animated track's `0`-anchored
        // first frame every time this clip's crossfade started from a
        // never-yet-driven skeleton (T-pose on page load, before 11-13's G1
        // fix; the same settle simply relocated to load time after that
        // fix) -- a visible Y-axis drop, root-caused via headless
        // production-path replay (see AnimationStateEngine.ts's 11-15
        // gap-closure diagnosis block). Anchoring at the bind-pose Y instead
        // makes BOTH crossfade blend endpoints (the bind pose the mixer
        // starts from, and the animated first frame) equal, so
        // `applied(w) = original*(1-w) + animated*w = bindPoseHipsY` at
        // EVERY weight -- the blend is flat across the whole settle, no
        // drop and no mid-ramp overshoot.
        const firstY = scaled[1] ?? 0;
        const value = scaled.map((v, i) =>
          i % 3 === 1 ? v - firstY + bindPoseHipsY : v
        );

        tracks.push(
          new THREE.VectorKeyframeTrack(
            `${vrmNodeName}.${propertyName}`,
            track.times,
            value
          )
        );
      }
    }
  });

  return new THREE.AnimationClip("vrmAnimation", clip.duration, tracks);
}