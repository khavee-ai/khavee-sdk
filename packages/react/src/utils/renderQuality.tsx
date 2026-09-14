import type { ReactElement } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Bloom, EffectComposer, SMAA } from "@react-three/postprocessing";
import { ContactShadows } from "@react-three/drei";

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

// The MToon repair pass lives in its own module, not inline here, because the
// phase's TEST-01 tests run under vitest `environment: "node"` and this file
// imports `@react-three/postprocessing` + JSX, which drags an R3F/DOM
// dependency graph into a headless test. `mtoonRepair.ts` depends only on
// `three` and `@pixiv/three-vrm`, so it stays node-testable. Re-exporting it
// here keeps `renderQuality.tsx` as the single render-quality import site
// `VRMAvatar`/`GLBAvatar` consume.
export {
  repairMToonMaterials,
  snapshotMToon,
  restoreMToon,
  setMToonDebugMode,
  DEFAULT_REPAIR,
  FACE_DETAIL_MATERIAL_RE,
} from "./mtoonRepair";
export type {
  MaterialPreset,
  MToonDebugMode,
  RepairOptions,
  RepairResult,
  RepairLogEntry,
  MToonSnapshot,
} from "./mtoonRepair";

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
 * The tone curve `opts.toneMapping` is caller-dependent, not a single
 * SDK-wide default: `VRMAvatar` passes `THREE.CineonToneMapping` (spike 003
 * measured +35% saturation over `THREE.ACESFilmicToneMapping` on MToon/toon
 * output for near-equal contrast loss), while `GLBAvatar` still passes
 * `THREE.ACESFilmicToneMapping` for its plain glTF PBR output. See both
 * components' own tone-mapping comments for the full measured rationale.
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

// ── Lighting Configuration Types ──

/** One light's tunable parameters. A bare number is shorthand for `{ intensity }`. */
export interface LightSpec {
  /** Light intensity. */
  intensity?: number;
  /** Light color as a CSS-compatible string (e.g., "#fff", "white", "rgb(255, 255, 255)"). */
  color?: string;
  /** Light position [x, y, z]. Ignored for the `ambient` axis — an ambient light has no position. */
  position?: [number, number, number];
}

/** Accepts either a bare number (intensity shorthand) or a full {@link LightSpec} object. */
export type LightSetting = number | LightSpec;

/** Shadow-map tuning parameters for the key light. */
export interface ShadowOptions {
  /** Shadow darkness where the surface is shadowed, 0 (invisible) to 1 (fully black). Default: 0.6 */
  intensity?: number;
  /** Shadow map resolution [width, height]. Default: [2048, 2048]. Clamped to 256-4096 per axis to prevent GPU allocation failure (T-16-04). */
  mapSize?: number;
  /** Normal-offset bias to prevent shadow acne on curved surfaces. Default: 0.02 */
  normalBias?: number;
  /** Shadow-edge blur radius (only under PCFSoftShadowMap). Default: 4 */
  radius?: number;
}

/** Configuration for the {@link AvatarLightRig} three-point lighting setup. */
export interface LightRigOptions {
  /** Ambient light (omnidirectional fill). Position is ignored. */
  ambient?: LightSetting;
  /** Key light (main directional, carries the shadow). */
  key?: LightSetting;
  /** Fill light (lifts the shadow side, no shadow-casting). */
  fill?: LightSetting;
  /** Rim/back light (separation/edge highlight, no shadow-casting). */
  rim?: LightSetting;
  /** Shadow-map tuning for the key light. */
  shadow?: ShadowOptions;
}

/**
 * DEFAULT_LIGHT_RIG - The three-point rig's default values, sourced from spike
 * 005 (`apps/playground/src/app/lighting-spike/rigs.tsx`) and measured against
 * real MToon VRM assets under Cineon tone mapping. Omitting a field from the
 * `lighting` prop falls back to these values.
 *
 * - ambient: 0.32 (intentionally lower than the previous 0.6 — ambient is flat
 *   fill and is what eats contrast; Phase 15 traded contrast away expecting
 *   lighting to give it back through directional shape, not omnidirectional
 *   brightness)
 * - key: 1.35 intensity, warm `#fff4e6`, position `[2, 4, 3]` front-left/above
 * - fill: 0.45 intensity, cool `#cfe0ff`, position `[-3, 1.5, 2]` opposite side
 * - rim: 1.6 intensity, cool `#bcd4ff`, position `[-1.5, 3, -4]` behind/above
 *   (static cool white; plan 16-04 will derive this from the background)
 * - shadow: 0.6 intensity, 2048x2048 map, normalBias 0.02, radius 4
 */
export const DEFAULT_LIGHT_RIG = {
  ambient: { intensity: 0.32 },
  key: { intensity: 1.35, color: "#fff4e6", position: [2, 4, 3] as [number, number, number] },
  fill: { intensity: 0.45, color: "#cfe0ff", position: [-3, 1.5, 2] as [number, number, number] },
  rim: { intensity: 1.6, color: "#bcd4ff", position: [-1.5, 3, -4] as [number, number, number] },
  shadow: { intensity: 0.6, mapSize: 2048, normalBias: 0.02, radius: 4 },
};

/**
 * resolveLight - Normalise a caller-supplied {@link LightSetting} into a
 * fully-populated {@link LightSpec}.
 *
 * @param setting - Caller's value (bare number, partial spec, or undefined).
 * @param fallback - Default values to use for any unset field.
 * @returns A complete LightSpec with every field defined.
 */
function resolveLight(setting: LightSetting | undefined, fallback: LightSpec): Required<LightSpec> {
  const spec = typeof setting === "number" ? { intensity: setting } : setting ?? {};
  return {
    intensity: spec.intensity ?? fallback.intensity ?? 1,
    color: spec.color ?? fallback.color ?? "#ffffff",
    position: spec.position ?? fallback.position ?? [0, 0, 0],
  };
}

/**
 * AvatarLightRig - A configurable three-point lighting rig (warm key, cool
 * fill, cool rim/back) meant to be mounted inside an avatar's own group, so
 * lighting is spatially scoped alongside the model instead of relying on the
 * consuming page to hand-roll lights. This is the default for both
 * `VRMAvatar` and `GLBAvatar` via their `autoLighting` prop (default `true`).
 *
 * The default ambient intensity (0.32) is intentionally lower than the
 * previous rig's 0.6 — ambient is omnidirectional flat fill, and the whole
 * point of a three-point rig is that shape/depth comes from directional
 * contrast, not brightness. Phase 15 traded contrast away (via tone curve)
 * expecting lighting to return it through this rig.
 *
 * The rim light's default colour is a static cool white (`#bcd4ff`) — plan
 * 16-04's background-derivation logic can override it by passing
 * `lighting={{ rim: { color: derivedColor } }}`, which keeps every other
 * axis/field at its default.
 *
 * Skip via the avatar component's `autoLighting={false}` prop on pages that
 * already provide their own lighting (avoids double-lighting).
 *
 * @param options - Partial rig config; omit to use {@link DEFAULT_LIGHT_RIG} defaults.
 * @example
 * ```tsx
 * // Keep the tuned shadow, fill and rim — only override ambient to match a
 * // legacy/customer-facing control (the D-04 adoption shape for khavee-app):
 * <VRMAvatar src="..." lighting={{ ambient: 0.6 }} />
 * ```
 */
export function AvatarLightRig({ options }: { options?: LightRigOptions } = {}) {
  const ambient = resolveLight(options?.ambient, DEFAULT_LIGHT_RIG.ambient);
  const key = resolveLight(options?.key, DEFAULT_LIGHT_RIG.key);
  const fill = resolveLight(options?.fill, DEFAULT_LIGHT_RIG.fill);
  const rim = resolveLight(options?.rim, DEFAULT_LIGHT_RIG.rim);

  // Shadow tuning: clamp mapSize to 256-4096 to prevent GPU allocation failure
  // (T-16-04 — a caller-supplied 16384 allocates a 1 GB depth texture, or
  // fails allocation and blanks the canvas). Out-of-range values are clamped
  // silently rather than thrown — a lighting option isn't worth crashing a
  // consumer's scene over.
  const shadowOpts = options?.shadow ?? {};
  const shadowIntensity = shadowOpts.intensity ?? DEFAULT_LIGHT_RIG.shadow.intensity;
  const shadowMapSize = Math.max(256, Math.min(4096, shadowOpts.mapSize ?? DEFAULT_LIGHT_RIG.shadow.mapSize));
  const shadowNormalBias = shadowOpts.normalBias ?? DEFAULT_LIGHT_RIG.shadow.normalBias;
  const shadowRadius = shadowOpts.radius ?? DEFAULT_LIGHT_RIG.shadow.radius;

  return (
    <>
      {/* Ambient — omnidirectional fill. The resolved `position` is deliberately
          unused (ambient lights have no position); say so explicitly to avoid
          this reading as a bug. */}
      <ambientLight intensity={ambient.intensity} color={ambient.color} />

      {/* KEY — main directional, front-left/above, carries the shadow. Shadow-map
          tuning below is REQUIRED, not cosmetic: three.js's DirectionalLight
          defaults (512x512 map, -5..5 ortho frustum, zero bias) produce visible
          shadow-acne moire on curved/folded avatar surfaces (clothing folds,
          rounded heads) — self-shadowing rippling that reads as a texture/material
          bug but is purely a shadow-map resolution/bias problem. A tight frustum
          sized to person-scale + normalBias (avoids peter-panning better than a
          plain bias for curved geometry) fixes it. */}
      <directionalLight
        castShadow
        position={key.position}
        intensity={key.intensity}
        color={key.color}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-camera-near={0.1}
        shadow-camera-far={10}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
        shadow-normalBias={shadowNormalBias}
        // Blurs shadow edges — only takes effect under PCFSoftShadowMap,
        // which R3F's Canvas `shadows` boolean prop already selects by
        // default. No-op (harmless) under a hard shadow map type.
        shadow-radius={shadowRadius}
        // Forcing castShadow on EVERY mesh (applyMeshRenderFlags) means
        // hair now casts a real shadow onto shoulders/chest — at full
        // shadow.intensity (three.js default 1 = fully black-out) that
        // reads as a hard, wrong-colored patch, especially stacked on top
        // of MToon's own toon shade-color. 0.6 (default) blends the shadowed
        // area 60% toward black / 40% toward its lit color instead of full
        // black — visible depth without the garment appearing to change
        // color under the shadow.
        shadow-intensity={shadowIntensity}
      />

      {/* FILL — opposite side, cool, no shadow. Lifts the shadow side without
          flattening it; a second shadow-caster would fight the key (two
          overlapping shadow maps produce moire/banding). */}
      <directionalLight position={fill.position} intensity={fill.intensity} color={fill.color} />

      {/* RIM / BACK — behind and above, aimed at the camera side. This is the
          signature of premium anime rendering and the thing the previous rig had
          no equivalent of. Static cool white by default; plan 16-04's
          background-derivation can override via `lighting={{ rim: { color } }}`. */}
      <directionalLight position={rim.position} intensity={rim.intensity} color={rim.color} />
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

// ── Contact Shadows ──

/** Options for {@link AvatarContactShadows}. */
export interface AvatarContactShadowsProps {
  /** Y position of the shadow plane. Default: 0 */
  y?: number;
  /** Shadow opacity, 0 (invisible) to 1 (fully black). Default: 0.6 */
  opacity?: number;
  /** Shadow blur amount. Default: 2.5 */
  blur?: number;
  /** Shadow scale (distance from center to edge). Default: 4 */
  scale?: number;
  /** Render-target resolution for the depth map. Default: 512. Clamped to 128-2048 (T-16-05). */
  resolution?: number;
  /** Far clipping distance for the depth camera. Default: 2 */
  far?: number;
  /** Shadow color. Default: "#000000" */
  color?: string;
  /**
   * How many frames to render the shadow before freezing it. Default: Infinity
   * (continuous updates). This is the cost lever: at `Infinity`, performs one
   * full-scene depth render + two blur passes every frame, forever. The default
   * is `Infinity` because a VRM avatar never stops moving (breathing, spring
   * bones) — a finite value produces a visibly stale shadow. See RESEARCH
   * Pitfall 3 for the full continuous-cost analysis.
   */
  frames?: number;
}

/**
 * AvatarContactShadows - Soft, blurred contact shadows rendered via an
 * independent depth pass (mechanically unrelated to `ShadowFloor`, which
 * reuses the key light's shadow map).
 *
 * This component needs NO LIGHT at all — it renders `MeshDepthMaterial` into
 * its own render target and blurs the result to produce soft, ambient-occlusion-style
 * shadows directly under/around objects. It is therefore COMPLEMENTARY to
 * `ShadowFloor`, not a replacement — mounting both is a valid and intended
 * composition (hard directional shadows from the key light via `ShadowFloor`,
 * plus soft contact shadows via `AvatarContactShadows`).
 *
 * `frames` is the cost lever: at the default `Infinity`, this performs one
 * extra full-scene depth render + two blur passes every frame, forever. The
 * reason that is the default is that a VRM avatar never stops moving (breathing,
 * spring bones), so a finite value produces a visibly stale shadow. This
 * tradeoff is accepted and documented (RESEARCH Pitfall 3) rather than hidden
 * behind a default that looks free but isn't.
 *
 * Not auto-mounted by `AvatarLightRig` (same reasoning as `ShadowFloor`): a
 * shadow is a scene-composition choice, not a pure render-quality default.
 * Opt in by rendering it yourself, once per scene, at the avatar's feet.
 */
export function AvatarContactShadows({
  y = 0,
  opacity = 0.6,
  blur = 2.5,
  scale = 4,
  resolution = 512,
  far = 2,
  color = "#000000",
  frames = Infinity,
}: AvatarContactShadowsProps = {}) {
  // T-16-05: clamp resolution to 128-2048 to prevent GPU allocation failure
  // (a caller-supplied 16384 allocates a 1 GB render target, or fails and
  // blanks the canvas). Out-of-range values are clamped silently rather than
  // thrown — a shadow option isn't worth crashing a consumer's scene over.
  const clampedResolution = Math.max(128, Math.min(2048, resolution));

  return (
    <ContactShadows
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      opacity={opacity}
      blur={blur}
      scale={scale}
      resolution={clampedResolution}
      far={far}
      color={color}
      frames={frames}
    />
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
   * measured AFTER tone mapping (see `applyRendererDefaults` — the curve is
   * caller-dependent: `THREE.CineonToneMapping` for `VRMAvatar`,
   * `THREE.ACESFilmicToneMapping` for `GLBAvatar`, both of which compress
   * highlights), so ordinary specular/rim highlights rarely reach anywhere
   * near 1.0, and this threshold may need retuning per curve. Lower = more
   * surfaces glow. Default: 0.3
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
