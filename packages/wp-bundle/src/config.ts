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
  /** When true, display the chat text panel alongside the avatar. */
  chatShow?: boolean;
  /** Chat panel placement relative to the avatar canvas. Default "beside". */
  chatPlacement?: "beside" | "below";
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
  const preset = c.cameraPreset ?? "front";
  return {
    lightIntensity: c.lightIntensity ?? LIGHT_INTENSITY.default,
    avatarScale: c.avatarScale ?? 1.0,
    avatarOffsetX: c.avatarOffsetX ?? 0.0,
    avatarOffsetY: c.avatarOffsetY ?? 0.0,
    cameraPreset: preset,
    cameraPosition: CAMERA_PRESETS[preset].position,
    cameraTarget: CAMERA_PRESETS[preset].target,
    /** fov=20 matches khavee-app PreviewModel.tsx:61 (consistent with preset vectors). */
    cameraFov: 20,
    /** Ambient intensity — matches Phase-8 mount.tsx:59 hardcoded value. */
    ambient: 1,
    /** Directional intensity — matches Phase-8 mount.tsx:60 hardcoded value. */
    directional: 2.5,
  };
}
