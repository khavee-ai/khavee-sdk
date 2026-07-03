/**
 * packages/wp-bundle/src/config.ts
 *
 * Extended KhaveeAvatarConfig interface (moved from mount.tsx) + camera-preset
 * map + light-intensity range constant + scene-default resolver.
 *
 * This module is the single source of truth for all Phase-9 visual/chat
 * config types and scene defaults in the wp-bundle. Both the VIEW entry
 * (index.ts → mount.tsx) and the PREVIEW entry (preview.ts) import from here.
 *
 * Camera preset vectors are lifted VERBATIM from khavee-app
 * Preview.tsx:54-87, converted from {x,y,z} objects to R3F [x,y,z] tuples.
 * The fov=20 in resolveSceneDefaults() matches khavee-app PreviewModel.tsx:61
 * (tighter framing consistent with the preset vectors).
 */

// ── Idle animation asset ──────────────────────────────────────────────────────

/**
 * Absolute URL of the bundled idle animation (build/animations/idle.fbx),
 * resolved from the currently-executing <script> tag's own src rather than
 * a hardcoded/PHP-injected path — portable across install paths/domains
 * with zero PHP wiring, matching how the SAME bundle already self-locates
 * relative to whichever plugins/ directory it was loaded from.
 *
 * `document.currentScript` is only valid synchronously during a script's
 * OWN initial evaluation, so this is captured once at module-init time
 * (this runs as part of the single esbuild IIFE's top-level pass, at the
 * same moment for every module in the bundle — safe to capture here).
 *
 * Only VRMAvatar (MToon/VRM) takes an `animations` prop; GLBAvatar uses
 * animations embedded in the GLB file itself and needs no external URL
 * (see GLBAvatar.tsx's own docs).
 */
export const IDLE_ANIMATION_URL: string | undefined =
  typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement
    ? new URL("animations/idle.fbx", document.currentScript.src).href
    : undefined;

// ── Camera presets ────────────────────────────────────────────────────────────

/**
 * Camera preset vectors lifted verbatim from khavee-app Preview.tsx:54-87,
 * converted from {x,y,z} notation to R3F [x,y,z] tuples.
 * Each preset defines a camera position and the point it looks at (target).
 *
 * Use `as const` so TypeScript narrows each tuple to its exact literal type
 * rather than `number[]`, enabling type-safe indexing via CameraPreset.
 */
export const CAMERA_PRESETS = {
  front: {
    position: [0, 1.3, 3.1] as [number, number, number],
    target: [0, 0.15, 0] as [number, number, number],
  },
  "left-angle": {
    position: [-2.05, 1.28, 2.5] as [number, number, number],
    target: [0, 0.15, 0] as [number, number, number],
  },
  "right-angle": {
    position: [2.05, 1.28, 2.5] as [number, number, number],
    target: [0, 0.15, 0] as [number, number, number],
  },
  wide: {
    position: [0, 1.55, 5.2] as [number, number, number],
    target: [0, 0.1, 0] as [number, number, number],
  },
} as const;

/** Union of valid camera preset names. */
export type CameraPreset = keyof typeof CAMERA_PRESETS;

// ── Light intensity range ─────────────────────────────────────────────────────

/**
 * Light intensity range constants lifted from khavee-app BackgroundPanel.tsx:38-39.
 * Used by the Gutenberg inspector RangeControl and resolveSceneDefaults().
 */
export const LIGHT_INTENSITY = {
  min: 0,
  max: 2,
  step: 0.1,
  default: 1.0,
} as const;

// ── Config interface ──────────────────────────────────────────────────────────

/**
 * Shape of the JSON object server-rendered into each mount point's
 * `data-khaveeai-config` attribute by AvatarRenderer::render() (plans 02/04).
 *
 * Moved here from mount.tsx (Phase 9, STUDIO-05) so both the VIEW bundle
 * and the PREVIEW bundle can import the same type without pulling in the
 * live-realtime mount code.
 *
 * mount.tsx re-exports this type so packages/wp-bundle/src/index.ts:17
 * (`import type { KhaveeAvatarConfig } from "./mount"`) continues to work
 * unchanged.
 */
export interface KhaveeAvatarConfig {
  // Phase-8 fields (unchanged):
  /** OpenAI voice identifier for the realtime session. */
  voice?:
    | "alloy"
    | "ash"
    | "ballad"
    | "coral"
    | "echo"
    | "sage"
    | "shimmer"
    | "verse"
    | "marin"
    | "cedar";
  /** System instructions forwarded to the LLM. */
  instructions?: string;
  /** URL of the VRM or GLB avatar model to render. */
  avatarUrl?: string;
  /** OpenAI model identifier (e.g. "gpt-realtime-1.5"). */
  model?: string;
  /** REST URL of the khaveeai/v1/session endpoint (injected by PHP). */
  restUrl?: string;
  // Phase-9 visual/chat config fields (STUDIO-05 Part A):
  /** Container width in pixels. 0 = use admin default / CSS-driven. */
  containerWidth?: number;
  /** Container height in pixels. 0 = use admin default / CSS-driven. */
  containerHeight?: number;
  /** When true, the container spans the full viewport width. */
  fullWidth?: boolean;
  /** Background mode. "" = no custom background (inherits page background). */
  bgType?: "color" | "image" | "";
  /** CSS colour string for a solid background (bgType==="color"). */
  bgColor?: string;
  /** When true, the Canvas background is transparent (alpha channel). */
  bgTransparent?: boolean;
  /** Resolved URL of the background image attachment (bgType==="image"). */
  bgImageUrl?: string;
  /** Combined ambient+directional scene light intensity multiplier. Default 1.0. */
  lightIntensity?: number;
  /** Avatar scale multiplier. 1.0 = natural size. Default 1.0. */
  avatarScale?: number;
  /** Horizontal avatar offset in scene units. 0.0 = centred. */
  avatarOffsetX?: number;
  /** Vertical avatar offset in scene units. 0.0 = centred. */
  avatarOffsetY?: number;
  /** Camera preset key. Default "front". */
  cameraPreset?: CameraPreset;
  /** Horizontal camera orbit, in degrees, applied on top of the preset's
   * base position. 0 = the preset's own angle, positive = orbit right. */
  cameraRotationY?: number;
  /** When true, display the chat text panel alongside the avatar. */
  chatShow?: boolean;
  /** Chat panel placement relative to the avatar canvas. Default "beside". */
  chatPlacement?: "beside" | "below";
  /**
   * When true, render the site-wide floating launcher/panel layout instead
   * of the inline embed layout. containerWidth/Height/fullWidth are ignored
   * in this mode — the panel has fixed 360x520 sizing.
   */
  floating?: boolean;
}

// ── Camera orbit helper ───────────────────────────────────────────────────────

/**
 * Rotates `position` around `target` on the Y axis by `degrees`, preserving
 * the original height and radius — used by the "Camera rotation" slider
 * (a UI dragger, not mouse-drag orbiting on the canvas — Gutenberg's own
 * block-selection click-capture layer intercepts a plain single-gesture
 * canvas drag before OrbitControls ever sees it, so a dedicated slider is
 * the reliable control surface here).
 */
function orbitAroundTarget(
  position: [number, number, number],
  target: [number, number, number],
  degrees: number
): [number, number, number] {
  const rad = (degrees * Math.PI) / 180;
  const dx = position[0] - target[0];
  const dz = position[2] - target[2];
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    target[0] + dx * cos + dz * sin,
    position[1],
    target[2] - dx * sin + dz * cos,
  ];
}

// ── Scene default resolver ────────────────────────────────────────────────────

/**
 * Resolve per-scene rendering defaults from a KhaveeAvatarConfig, applying
 * Phase-8-compatible fallbacks for any field not set by the admin or author.
 *
 * ambient=1 and directional=2.5 match Phase-8's mount.tsx:59-60 hardcoded
 * values, so existing published pages render identically after the Phase-9
 * upgrade (new config keys all default to blank/zero → fall through here).
 *
 * cameraFov=20 matches khavee-app PreviewModel.tsx:61, which is consistent
 * with the lifted CAMERA_PRESETS position vectors (tighter framing).
 *
 * @param c - Parsed KhaveeAvatarConfig from the mount point's data attribute.
 * @returns Resolved scene values ready to pass to Canvas / VRMAvatar props.
 */
export function resolveSceneDefaults(c: KhaveeAvatarConfig) {
  // `||` (not `??`): editor.js's camera-preset SelectControl uses "" (not
  // undefined) for its "(using global default)" option, and "" isn't a key
  // in CAMERA_PRESETS — `??` wouldn't catch it, causing every block with an
  // unset preset (i.e. every block on first insert) to crash here (fix for
  // "preview never updates" bug, debugged 2026-07-02).
  const preset = (c.cameraPreset || "front") as CameraPreset;
  const basePosition = CAMERA_PRESETS[preset].position;
  const cameraTarget = CAMERA_PRESETS[preset].target;
  const rotationDeg = c.cameraRotationY ?? 0;
  const cameraPosition =
    rotationDeg === 0
      ? basePosition
      : orbitAroundTarget(basePosition, cameraTarget, rotationDeg);
  return {
    lightIntensity: c.lightIntensity ?? LIGHT_INTENSITY.default,
    avatarScale: c.avatarScale ?? 1.0,
    avatarOffsetX: c.avatarOffsetX ?? 0.0,
    avatarOffsetY: c.avatarOffsetY ?? 0.0,
    cameraPreset: preset,
    cameraRotationY: rotationDeg,
    cameraPosition,
    cameraTarget,
    /** fov=20 matches khavee-app PreviewModel.tsx:61 (consistent with preset vectors). */
    cameraFov: 20,
    /** Ambient intensity — matches Phase-8 mount.tsx:59 hardcoded value. */
    ambient: 1,
    /** Directional intensity — matches Phase-8 mount.tsx:60 hardcoded value. */
    directional: 2.5,
  };
}
