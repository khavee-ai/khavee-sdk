/**
 * types.ts — Format-adapter contract for the shared animation module (ANIM-01).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * The shared internal animation module (state layer, crossfade engine,
 * procedural delta layer) never imports `VRM`- or GLB-specific types
 * directly. Instead it depends on this `AvatarFormatAdapter` interface,
 * which `VRMAvatar.tsx` and `GLBAvatar.tsx` each implement to expose their
 * concrete mixer/bone/expression-manager objects in a common shape. This is
 * the seam that lets one shared module drive both avatar formats (wayfinder
 * ticket #8) instead of naturalness work landing on `VRMAvatar.tsx` alone.
 */

import * as THREE from "three";
import type { VRMExpressionManager } from "@pixiv/three-vrm";

/**
 * Bridges VRM-specific (`@pixiv/three-vrm`) and GLB-generic (drei's
 * `useAnimations`) client objects behind one shape so the shared animation
 * module can read/write "the current 3D model" without knowing which
 * format it's driving.
 */
export interface AvatarFormatAdapter {
  /**
   * Returns the live `THREE.AnimationMixer` driving this avatar's clips.
   *
   * For VRM this is the mixer `VRMAvatar.tsx` already creates and updates.
   * For GLB this MUST be drei's `useAnimations()` return value's `mixer` —
   * never a second, independently-created mixer with no registered actions
   * (a pre-existing bug in `GLBAvatar.tsx` this module's wiring corrects).
   */
  getMixer(): THREE.AnimationMixer;

  /**
   * Resolves a bone/object by name within the avatar's scene graph.
   *
   * @param name - The bone name (matches `AnimationClip` track names with
   *   the trailing `.quaternion` suffix stripped).
   * @returns The matching `THREE.Object3D`, or `null` if no bone with that
   *   name exists in the current scene (e.g. clip authored against a
   *   different rig, or scene not yet loaded).
   */
  getBoneNode(name: string): THREE.Object3D | null;

  /**
   * Resolves a bone by VRM humanoid ROLE, not literal scene-graph name.
   *
   * Unlike `getBoneNode`, this method must NEVER fall back to a hardcoded
   * literal-name guess — VRM literal node names are not standardized across
   * models (verified: `male.vrm`'s chest bone is named `"J_Bip_C_Chest"`
   * while `blacknwhitecat.vrm`'s is named `"chest"`). Resolving by role
   * instead of name is the only way to reliably find "the chest bone" (or
   * spine/hips/etc.) across every VRM rig.
   *
   * For VRM, this MUST be backed by `vrm.humanoid.getNormalizedBoneNode(role)`
   * (the proven, standards-based VRM humanoid API — see
   * `packages/react/src/utils/remapMixamoAnimationToVrm.ts`), never a
   * literal-name lookup.
   *
   * GLB implementations may use a literal-name lookup ONLY when the format's
   * bundled asset happens to name its nodes to match the role strings
   * directly (e.g. `happy.glb`'s `chest`/`spine`/`hips`/`neck`/`head` nodes)
   * — this is a property of that specific asset, not a general guarantee.
   *
   * @param role - One of the six VRM humanoid body-procedural-motion roles
   *   (breathing, sway, etc.), plus (Phase 18) `"leftEye"`/`"rightEye"` for
   *   the eye-gaze bone-fallback path (EYE-01) and `"jaw"` for jaw motion
   *   (VIS-03). All three are valid VRM humanoid bone names (confirmed in
   *   `@pixiv/three-vrm-core`'s `VRMHumanBoneName.d.ts`), the gap was purely
   *   in this SDK's own adapter type (RESEARCH Pitfall 4).
   * @returns The matching `THREE.Object3D`, or `null` if the role cannot be
   *   resolved (e.g. scene not yet loaded, or format has no mapping for it).
   */
  getHumanoidBoneNode(
    role: "hips" | "spine" | "chest" | "upperChest" | "neck" | "head" | "leftEye" | "rightEye" | "jaw",
  ): THREE.Object3D | null;

  /**
   * Returns the VRM expression manager driving blendshape-based
   * expressions (blink, mouth shapes, etc.), or `null` for formats with no
   * expression system (GLB).
   *
   * Callers must null-check the return value, not branch on avatar format —
   * per wayfinder ticket #8, this is "a null-check, not a capability flag."
   */
  getExpressionManager(): VRMExpressionManager | null;

  /**
   * Returns the VRM `lookAt` controller (`vrm.lookAt`), or `null`/`undefined`
   * for formats with no such controller (GLB, or a VRM whose applier has no
   * eye-bone mapping). Optional so every pre-Phase-18 adapter object and
   * test stub adapter still compiles without change.
   *
   * `eyeGaze.ts` (EYE-01) uses this as its PRIMARY path — it sets
   * `lookAt.yaw`/`.pitch` directly (with `autoUpdate = false`) rather than
   * writing eye bones, because `VRMCore.update()` runs `lookAt.update()`
   * AFTER `humanoid.update()`, so any bone write eye-gaze made would be
   * absolutely overwritten by three-vrm's own lookAt-to-bone application
   * that same frame (RESEARCH Pitfall 3). When this method is absent or
   * returns `null`, eye-gaze falls back to rotating `leftEye`/`rightEye`
   * bones directly (D-04).
   */
  getLookAt?(): LookAtController | null;
}

/**
 * Structural subset of three-vrm's `VRMLookAt` (`@pixiv/three-vrm-core`).
 * Declared locally (rather than importing the concrete three-vrm type) so
 * `eyeGaze.test.ts` and other unit tests can stub it with a plain object,
 * with no dependency on the `@pixiv/three-vrm` package at test time.
 */
export interface LookAtController {
  /**
   * When `true` (three-vrm's default), `VRMLookAt.update()` recomputes
   * yaw/pitch from `target` every frame and overwrites any external write.
   * `eyeGaze.ts`'s primary path sets this to `false` so its own yaw/pitch
   * writes are not immediately clobbered (RESEARCH Pitfall 3).
   */
  autoUpdate: boolean;
  /** Horizontal look angle in degrees. Positive/negative sign convention matches three-vrm's own `VRMLookAt.yaw`. */
  yaw: number;
  /** Vertical look angle in degrees. Positive = up, matching three-vrm's own `VRMLookAt.pitch`. */
  pitch: number;
  /** Points the controller at a world-space position, setting `yaw`/`.pitch` accordingly. */
  lookAt(position: THREE.Vector3): void;
}
