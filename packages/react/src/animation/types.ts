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
   * Returns the VRM expression manager driving blendshape-based
   * expressions (blink, mouth shapes, etc.), or `null` for formats with no
   * expression system (GLB).
   *
   * Callers must null-check the return value, not branch on avatar format —
   * per wayfinder ticket #8, this is "a null-check, not a capability flag."
   */
  getExpressionManager(): VRMExpressionManager | null;
}
