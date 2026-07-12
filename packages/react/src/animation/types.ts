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
   * @param role - One of the six VRM humanoid bone roles used by this SDK's
   *   procedural motion layer (breathing, sway, etc.).
   * @returns The matching `THREE.Object3D`, or `null` if the role cannot be
   *   resolved (e.g. scene not yet loaded, or format has no mapping for it).
   */
  getHumanoidBoneNode(
    role: "hips" | "spine" | "chest" | "upperChest" | "neck" | "head",
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
}
