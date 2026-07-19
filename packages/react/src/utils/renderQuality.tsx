import type { ReactElement } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Bloom, EffectComposer, SMAA } from "@react-three/postprocessing";

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

/** Options for {@link ShadowFloor}. */
export interface ShadowFloorProps {
  /** Half-width/half-depth of the square floor plane (full size = `size * 2`). Default: 10 */
  size?: number;
  /** Y position of the floor plane. Default: 0 */
  y?: number;
  /** Shadow darkness where the floor is shadowed, 0 (invisible) to 1 (fully black). Default: 0.35 */
  opacity?: number;
}

/**
 * ShadowFloor - A ground plane that only receives shadows (invisible where
 * unshadowed) — the simplest way to actually SEE `castShadow` working.
 * Shadows need a receiver; without one, a correctly shadow-casting mesh
 * still renders with no visible shadow anywhere.
 *
 * Not auto-mounted by `AvatarLightRig` (unlike the light rig itself): a
 * floor plane is a scene-composition choice (position, size, whether the
 * avatar even has "ground" in its scene), not a pure render-quality
 * default — same reasoning as why post-processing isn't auto-injected.
 * Opt in by rendering it yourself, once per scene, at the avatar's feet.
 */
export function ShadowFloor({ size = 10, y = 0, opacity = 0.35 }: ShadowFloorProps) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <planeGeometry args={[size * 2, size * 2]} />
      <shadowMaterial opacity={opacity} />
    </mesh>
  );
}

/** Options for {@link AvatarPostFX}. */
export interface AvatarPostFXProps {
  /** Enable the bloom glow on bright highlights. Default: true */
  bloom?: boolean;
  /** Bloom glow strength. Default: 0.5 */
  bloomIntensity?: number;
  /**
   * Luminance floor (0-1) above which a pixel starts blooming. This is
   * measured AFTER tone mapping (see `applyRendererDefaults` — ACES
   * compresses highlights hard), so ordinary specular/rim highlights
   * rarely reach anywhere near 1.0. Lower = more surfaces glow.
   * Default: 0.3
   */
  bloomThreshold?: number;
  /** Softness of the threshold cutoff (0 = hard edge, higher = gradual falloff). Default: 1 */
  bloomSmoothing?: number;
  /** Enable subpixel morphological anti-aliasing (on top of the Canvas's own MSAA). Default: true */
  smaa?: boolean;
}

/**
 * AvatarPostFX - Opt-in Bloom + SMAA post-processing pipeline.
 *
 * NOT auto-mounted by VRMAvatar/GLBAvatar (unlike AvatarLightRig): an
 * `EffectComposer` takes over its ENTIRE Canvas's render pipeline, so it
 * must be mounted exactly ONCE per Canvas, as a sibling of the avatar(s) —
 * not once per avatar. Two avatars sharing a Canvas should still only
 * render one `<AvatarPostFX />`. Requires `@react-three/postprocessing`
 * (a peer of this package — install it in your app if not already present).
 *
 * Renders nothing if both `bloom` and `smaa` are disabled.
 */
export function AvatarPostFX({
  bloom = true,
  bloomIntensity = 0.5,
  bloomThreshold = 0.3,
  bloomSmoothing = 1,
  smaa = true,
}: AvatarPostFXProps) {
  if (!bloom && !smaa) return null;

  // EffectComposer's `children` type is `JSX.Element | JSX.Element[]` (no
  // boolean/null allowed), so conditionally-included effects must be built
  // as a filtered array rather than `{cond && <Effect />}` inline JSX.
  const effects: ReactElement[] = [];
  if (bloom) {
    effects.push(
      <Bloom
        key="bloom"
        mipmapBlur
        intensity={bloomIntensity}
        luminanceThreshold={bloomThreshold}
        luminanceSmoothing={bloomSmoothing}
      />,
    );
  }
  if (smaa) {
    effects.push(<SMAA key="smaa" />);
  }

  return <EffectComposer>{effects}</EffectComposer>;
}
