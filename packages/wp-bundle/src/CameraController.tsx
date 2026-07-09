/**
 * packages/wp-bundle/src/CameraController.tsx
 *
 * Shared camera-aim-correction component used by BOTH rendering paths:
 *   - mount.tsx's AvatarScene (published page)
 *   - preview/PreviewAvatarCanvas.tsx (Gutenberg block editor / Settings
 *     page live preview)
 *
 * Root cause fixed here (debug session: camera-framing-mismatch,
 * .planning/debug/resolved/camera-framing-mismatch.md): react-three-fiber's
 * own default-camera setup is initialization-only for `position`/`fov` AND
 * additionally hardcodes the camera's LOOK-AT rotation to the world origin
 * once, at first Canvas creation — `camera.lookAt(0, 0, 0)` — whenever the
 * `camera` prop has no explicit `rotation` field (see the installed
 * @react-three/fiber's Canvas configure() function: "Always look at center
 * by default"). This completely ignores resolveSceneDefaults()'s actual
 * `cameraTarget` (e.g. [0, 0.15, 0] for the front/angle presets, [0, 0.1, 0]
 * for wide) and is NEVER corrected afterward unless something explicitly
 * re-aims the camera.
 *
 * PreviewAvatarCanvas.tsx already worked around this for the editor path
 * via this same component plus <OrbitControls>, whose own per-frame
 * update() loop unconditionally re-aims the camera at `controls.target`
 * every frame. mount.tsx's published-page path had NO equivalent — it
 * silently kept react-three-fiber's incorrect lookAt(0,0,0) forever,
 * aiming the camera at the wrong point compared to the editor preview for
 * the exact same resolved config (position/fov WERE already identical;
 * only the rotation/aim diverged). This component is now shared by both
 * paths so they can never drift again (mirrors the existing EMBED-04
 * "one shared implementation, no drift" pattern used for
 * AvatarRenderer/AvatarBlock/AvatarShortcode).
 *
 * Uses individual array-element deps ([pos[0], pos[1], pos[2], ...]) rather
 * than the tuple refs so the effect does not re-run when resolveSceneDefaults
 * returns a new tuple reference with identical values.
 *
 * STUDIO-02 safety: does NOT call useRealtime(), does NOT import any khaveeai
 * provider — only useThree from @react-three/fiber and THREE from three, so
 * it is safe to use from BOTH the safe-preview bundle and the live-session
 * view bundle.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

export function CameraController({
  position,
  target,
  fov,
}: {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}): null {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(target[0], target[1], target[2]);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // Individual element deps avoid re-firing when a new tuple reference
    // is created with the same values (resolveSceneDefaults returns new
    // tuple objects on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, position[0], position[1], position[2], target[0], target[1], target[2], fov]);

  return null;
}
