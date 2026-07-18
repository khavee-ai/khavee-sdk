import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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
      {/* Shadow-map tuning below is REQUIRED, not cosmetic: three.js's
          DirectionalLight defaults (512x512 map, -5..5 ortho frustum, zero
          bias) produce visible shadow-acne moire on curved/folded avatar
          surfaces (clothing folds, rounded heads) — self-shadowing
          rippling that reads as a texture/material bug but is purely a
          shadow-map resolution/bias problem. A tight frustum sized to
          person-scale + normalBias (avoids peter-panning better than a
          plain bias for curved geometry) fixes it. */}
      <directionalLight
        castShadow
        position={[2, 4, 3]}
        intensity={1.2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.1}
        shadow-camera-far={10}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
        shadow-normalBias={0.02}
        // Blurs shadow edges — only takes effect under PCFSoftShadowMap,
        // which R3F's Canvas `shadows` boolean prop already selects by
        // default. No-op (harmless) under a hard shadow map type.
        shadow-radius={4}
        // Forcing castShadow on EVERY mesh (applyMeshRenderFlags) means
        // hair now casts a real shadow onto shoulders/chest — at full
        // shadow.intensity (three.js default 1 = fully black-out) that
        // reads as a hard, wrong-colored patch, especially stacked on top
        // of MToon's own toon shade-color. 0.6 blends the shadowed area
        // 60% toward black / 40% toward its lit color instead of full
        // black — visible depth without the garment appearing to change
        // color under the shadow.
        shadow-intensity={0.6}
      />
    </>
  );
}

/**
 * applySmoothShading - Recompute vertex normals with coincident-vertex
 * welding so adjacent faces blend instead of reading as hard facets.
 *
 * OPT-IN ONLY (never forced by default): unlike shadow/anisotropy/tone-
 * mapping defaults, this mutates GEOMETRY, not just render state — some
 * avatar assets are deliberately low-poly/faceted (a style choice), and
 * welding+renormalizing would silently change their intended look. Wire
 * this behind an explicit `smoothShading?: boolean` prop (default false)
 * on the avatar component, not applied automatically.
 *
 * Mechanism: `mergeVertices` (three's BufferGeometryUtils) welds
 * geometrically-coincident vertices that were duplicated at UV/normal
 * seams (the usual reason `computeVertexNormals()` alone doesn't smooth
 * glTF-exported meshes — seam vertices aren't shared, so per-vertex normal
 * averaging never blends across them). After welding, `computeVertexNormals()`
 * recomputes normals as the average of each vertex's now-shared adjacent
 * faces, producing smooth (Gouraud/Phong-shaded) surfaces.
 *
 * @param root - Root object to traverse (e.g. a loaded VRM/GLB scene).
 * @param tolerance - Distance below which two vertices are considered
 *   coincident and welded together. Default 1e-4 (mergeVertices' own
 *   default) — tight enough to only weld true seam duplicates, not
 *   intentionally separate geometry.
 */
export function applySmoothShading(
  root: THREE.Object3D,
  tolerance = 1e-4,
): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (!(obj.geometry instanceof THREE.BufferGeometry)) return;

    const merged = mergeVertices(obj.geometry, tolerance);
    merged.computeVertexNormals();
    // mergeVertices returns a geometry with no bounding volumes computed —
    // required for correct frustum culling (VRMAvatar disables frustumCulled
    // outright, but GLBAvatar does not, so a stale/null bounding sphere here
    // could make the mesh vanish at the wrong camera angle).
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    obj.geometry = merged;
  });
}
