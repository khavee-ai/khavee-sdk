import * as THREE from "three";

/**
 * renderQuality - Shared helpers that give avatar components sane,
 * production-quality rendering defaults (shadows, anisotropic filtering,
 * tone mapping/color space, and a scoped light rig) instead of the flat,
 * shadow-less output produced by an untouched three.js/R3F scene.
 *
 * These are intentionally plain, dependency-light functions (plus one
 * light-rig component) so `VRMAvatar` and `GLBAvatar` can apply identical
 * behavior without duplicating traversal/material logic.
 */

/** Options for {@link applyMeshRenderFlags}. */
export interface MeshRenderFlagOptions {
  castShadow: boolean;
  receiveShadow: boolean;
  anisotropy: number;
}

/**
 * applyMeshRenderFlags - Force shadow-casting/receiving and material map
 * anisotropy on every mesh under `root`.
 *
 * Today no avatar component sets `castShadow`/`receiveShadow` anywhere, so a
 * consuming app's `<Canvas shadows>` is a dead no-op — this traversal is what
 * actually makes shadows appear. Anisotropy is applied per-material-map
 * (only for map slots that exist) to sharpen grazing-angle texture sampling.
 *
 * @param root - Root object to traverse (e.g. a loaded VRM/GLB scene).
 * @param opts - Flags/anisotropy to apply to every mesh found under `root`.
 */
export function applyMeshRenderFlags(
  root: THREE.Object3D,
  opts: MeshRenderFlagOptions,
): void {
  const { castShadow, receiveShadow, anisotropy } = opts;

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;

    obj.castShadow = castShadow;
    obj.receiveShadow = receiveShadow;

    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach((material) => {
      if (!material) return;

      const mapSlots = [
        "map",
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "emissiveMap",
      ] as const;

      mapSlots.forEach((slot) => {
        const texture = (material as unknown as Record<string, THREE.Texture | null>)[slot];
        if (texture) {
          texture.anisotropy = anisotropy;
        }
      });

      material.needsUpdate = true;
    });
  });
}

/** Options for {@link applyRendererDefaults}. */
export interface RendererDefaultOptions {
  toneMapping: THREE.ToneMapping;
  colorSpace: THREE.ColorSpace;
}

/**
 * applyRendererDefaults - Force tone mapping + output color space on a
 * WebGLRenderer.
 *
 * IMPORTANT (Canvas-global side effect): `gl` is the single shared
 * WebGLRenderer instance owned by the app's `<Canvas>` — this mutates that
 * ENTIRE renderer's state, not just the avatar. The Canvas is app-owned, so
 * this is a deliberate, accepted global side-effect chosen so avatars look
 * correct out-of-the-box (see threat register T-1yq-01 in the quick-task
 * plan). A caller that wants full renderer control should pass a custom
 * `toneMapping` prop, or opt out and manage `gl` themselves. Idempotent —
 * safe to call repeatedly (e.g. on every mount-time effect run).
 *
 * @param gl - The Canvas's shared WebGLRenderer instance.
 * @param opts - Tone mapping mode and output color space to force.
 */
export function applyRendererDefaults(
  gl: THREE.WebGLRenderer,
  opts: RendererDefaultOptions,
): void {
  gl.toneMapping = opts.toneMapping;
  gl.outputColorSpace = opts.colorSpace;
}

/**
 * resolveAnisotropy - Resolve a requested anisotropy level against the
 * renderer's actual hardware maximum.
 *
 * @param gl - The Canvas's shared WebGLRenderer instance.
 * @param requested - Caller-requested anisotropy level, or undefined to use
 *   the default of 8.
 * @returns The requested level clamped to `gl.capabilities.getMaxAnisotropy()`.
 */
export function resolveAnisotropy(
  gl: THREE.WebGLRenderer,
  requested: number | undefined,
): number {
  return Math.min(requested ?? 8, gl.capabilities.getMaxAnisotropy());
}

/**
 * AvatarLightRig - A minimal ambient + directional light rig meant to be
 * mounted inside an avatar's own group, so lighting is spatially scoped
 * alongside the model instead of relying on the consuming page to hand-roll
 * lights. Skip via the avatar component's `autoLighting={false}` prop on
 * pages that already provide their own lighting (avoids double-lighting).
 */
export function AvatarLightRig() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight castShadow position={[2, 4, 3]} intensity={1.2} />
    </>
  );
}
