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
  /** When true, register a tool letting the AI search the site's Khavee
   *  Platform knowledge base mid-conversation. Requires a configured
   *  Platform API key server-side — this flag alone doesn't guarantee
   *  results, just that the tool is registered. */
  knowledgeBaseEnabled?: boolean;
  /** REST URL of the khaveeai/v1/knowledge-search endpoint (injected by
   *  PHP, only when knowledgeBaseEnabled is true). */
  knowledgeSearchUrl?: string;
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
  /** Vertical camera tilt (elevation), in degrees, applied AFTER the
   * horizontal orbit above. 0 = the preset's own angle, positive = look
   * down at the avatar from higher up, negative = look up from lower down. */
  cameraRotationX?: number;
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
  // Floating-widget-only visual config (quick task 260705-p30): independent
  // of the global bgColor/bgTransparent/avatarScale/avatarOffsetX/Y fields
  // above — FloatingWidget derives its own scene config from these instead
  // of falling back to the global ones, so the two embeds never share state.
  /** CSS colour string for the floating panel's avatar-area background. Default "#6929ff". */
  floatingBgColor?: string;
  /** When true, the floating panel's avatar-area Canvas background is transparent. */
  floatingBgTransparent?: boolean;
  /** Horizontal avatar offset in scene units, floating panel only. 0.0 = centred. */
  floatingAvatarOffsetX?: number;
  /** Vertical avatar offset in scene units, floating panel only. 0.0 = centred. */
  floatingAvatarOffsetY?: number;
  /** Avatar scale multiplier, floating panel only. 1.0 = natural size. */
  floatingAvatarScale?: number;
  /** Horizontal camera orbit, in degrees, floating panel only. 0 = the
   * preset's own angle, positive = orbit right. Independent of the
   * inline-embed's cameraRotationY. */
  floatingCameraRotationY?: number;
  /** Vertical camera tilt, in degrees, floating panel only. 0 = the
   * preset's own angle, positive = look down from higher up. Independent
   * of the inline-embed's cameraRotationX. */
  floatingCameraRotationX?: number;
  // Floating-widget page-placement config (quick task 260715-75r): which
  // corner of the viewport the widget anchors to and a pixel Y-nudge, so a
  // site owner whose page already has another floating widget (Intercom,
  // Crisp, Drift, etc.) in the same corner can move Khavee's widget clear
  // of it instead of the two overlapping.
  /** Page corner the floating widget anchors to. Default "bottom-right". */
  floatingPosition?: "bottom-right" | "bottom-left";
  /** Extra pixels to lift the widget up off the page's bottom edge, on top
   * of the base 24px inset. Default 0. */
  floatingOffsetY?: number;
  /** Extra pixels to nudge the widget in from whichever side it's anchored
   * to (right for "bottom-right", left for "bottom-left"), on top of the
   * base 24px inset. Default 0. */
  floatingOffsetX?: number;
  /** Diameter, in pixels, of the collapsed launcher button. Default 60. */
  floatingLauncherSize?: number;
  /** Mobile-only override (<=480px viewport) for floatingOffsetY. 0/unset
   * means "same as desktop" — this does NOT stack with the desktop value,
   * it replaces it below the breakpoint. */
  floatingOffsetYMobile?: number;
  /** Mobile-only override (<=480px viewport) for floatingOffsetX. 0/unset
   * means "same as desktop". */
  floatingOffsetXMobile?: number;
  /** Mobile-only override (<=480px viewport) for floatingLauncherSize.
   * 0/unset means "same as desktop". */
  floatingLauncherSizeMobile?: number;
  /**
   * CSS z-index of the floating widget's fixed-position container. Default
   * 999999 (chosen to sit above ordinary page content). Lower this when the
   * widget conflicts with another high-z-index overlay on the same page —
   * e.g. a shopping-cart drawer or modal — that should stay clickable
   * underneath / on top of Khavee.
   */
  floatingZIndex?: number;
  /**
   * Brand/accent color for the floating widget (260716-primary-color) —
   * overrides the --khaveeai-primary CSS custom property (default #6929ff
   * purple) that drives the header, launcher, mic button, chat bubbles,
   * and send button. When unset, floatingBgColor's own fallback (the
   * avatar-area background only) also follows this before finally
   * defaulting to #6929ff, so setting just this one field re-themes the
   * whole widget. Any valid CSS color string (hex, rgb(), named color).
   */
  floatingPrimaryColor?: string;
  /**
   * Display name shown in the floating panel header. Empty string (the
   * value AvatarRenderer::render_floating() always sends when unset) means
   * "use the default" — FloatingWidget.tsx falls back to "AI Assistant".
   */
  floatingWidgetName?: string;
  /**
   * First-visit greeting-bubble text. Empty string (the value
   * AvatarRenderer::render_floating() always sends when unset) means "use
   * the default" — FloatingWidget.tsx builds one from floatingWidgetName.
   */
  floatingGreetingText?: string;
  /**
   * Suggested-prompt chips shown above the "Click to talk" button in the
   * idle state (found the idle state too bare in review). Already
   * trimmed/filtered/capped to at most 3 by
   * AvatarRenderer::render_floating() — [] (never undefined at the PHP
   * boundary, but optional here since this type is also used by contexts
   * with no PHP renderer at all) means "no chips, unchanged idle state".
   */
  floatingSuggestedPrompts?: string[];
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

/**
 * Tilts `position` around `target` on the vertical (elevation) axis by
 * `degrees`, preserving the horizontal facing direction (azimuth) and the
 * total distance from target — the vertical counterpart to
 * orbitAroundTarget's horizontal orbit. Intended to run AFTER
 * orbitAroundTarget in resolveSceneDefaults, so a horizontal rotation is
 * applied first and this tilts up/down from that new facing, rather than
 * the two computing independent, uncomposed offsets from the preset base.
 *
 * Clamped by the caller (resolveSceneDefaults) to a range well short of
 * +/-90deg — this function itself has no clamp, but a caller-supplied
 * value near the pole would send radiusXZ toward 0 and, past it, swing the
 * camera to the opposite azimuth still right-side up (no "up" vector
 * recalculation happens here), which reads as a sudden flip rather than a
 * smooth tilt.
 */
function tiltAroundTarget(
  position: [number, number, number],
  target: [number, number, number],
  degrees: number
): [number, number, number] {
  const dx = position[0] - target[0];
  const dy = position[1] - target[1];
  const dz = position[2] - target[2];
  const radiusXZ = Math.sqrt(dx * dx + dz * dz);
  if (radiusXZ === 0) {
    // Already directly above/below target — no horizontal direction to
    // preserve, so there's nothing meaningful left to tilt from.
    return position;
  }
  const radius = Math.sqrt(radiusXZ * radiusXZ + dy * dy);
  const rad = (degrees * Math.PI) / 180;
  const newElevation = Math.atan2(dy, radiusXZ) + rad;
  const newRadiusXZ = radius * Math.cos(newElevation);
  const newDy = radius * Math.sin(newElevation);
  const scale = newRadiusXZ / radiusXZ;
  return [target[0] + dx * scale, target[1] + newDy, target[2] + dz * scale];
}

/**
 * Inverse of `orbitAroundTarget`: given a camera position that has been
 * orbited (e.g. by dragging OrbitControls in the live preview), reads back
 * the Y-axis degrees that would reproduce it via
 * `orbitAroundTarget(basePosition, target, deg)`.
 *
 * Takes `basePosition` (the preset's own un-rotated position) rather than
 * assuming the world origin, because `orbitAroundTarget` rotates relative to
 * that preset base, not (0,0,0) — the same preset base resolveSceneDefaults()
 * already resolves via CAMERA_PRESETS[preset].position.
 *
 * Symmetric with orbitAroundTarget's trig: baseAzimuth/curAzimuth are each
 * atan2(dz, dx) around target, and deg is the base-minus-current delta,
 * normalized to (-180, 180] so it round-trips through orbitAroundTarget.
 */
export function angleFromCameraPosition(
  cameraPosition: [number, number, number],
  target: [number, number, number],
  basePosition: [number, number, number]
): number {
  const baseAzimuth = Math.atan2(
    basePosition[2] - target[2],
    basePosition[0] - target[0]
  );
  const curAzimuth = Math.atan2(
    cameraPosition[2] - target[2],
    cameraPosition[0] - target[0]
  );
  let deg = ((baseAzimuth - curAzimuth) * 180) / Math.PI;
  // Normalize to (-180, 180].
  while (deg <= -180) deg += 360;
  while (deg > 180) deg -= 360;
  return deg;
}

/**
 * Inverse of `tiltAroundTarget`: given a camera position that has been
 * tilted (e.g. by dragging OrbitControls vertically in the live preview),
 * reads back the vertical degrees that would reproduce it via
 * `tiltAroundTarget(basePosition, target, deg)`.
 *
 * Unlike `angleFromCameraPosition`'s azimuth (which wraps at +/-180deg and
 * needs normalizing), elevation via atan2(dy, radiusXZ) is always within
 * (-90, 90) by construction — no wrap-around case exists, so this is
 * simpler than its horizontal counterpart. Also independent of whatever
 * horizontal rotation is ALSO applied: orbitAroundTarget only changes
 * azimuth, never elevation, so this reads the same tilt degrees regardless
 * of the current horizontal angle.
 */
export function tiltFromCameraPosition(
  cameraPosition: [number, number, number],
  target: [number, number, number],
  basePosition: [number, number, number]
): number {
  const baseRadiusXZ = Math.sqrt(
    (basePosition[0] - target[0]) ** 2 + (basePosition[2] - target[2]) ** 2
  );
  const baseElevation = Math.atan2(basePosition[1] - target[1], baseRadiusXZ);

  const curRadiusXZ = Math.sqrt(
    (cameraPosition[0] - target[0]) ** 2 + (cameraPosition[2] - target[2]) ** 2
  );
  const curElevation = Math.atan2(cameraPosition[1] - target[1], curRadiusXZ);

  return ((curElevation - baseElevation) * 180) / Math.PI;
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
  const horizontalPosition =
    rotationDeg === 0
      ? basePosition
      : orbitAroundTarget(basePosition, cameraTarget, rotationDeg);
  // Clamped short of +/-90deg — see tiltAroundTarget's own comment for why
  // going further risks a sudden flip rather than a smooth tilt.
  const tiltDeg = Math.max(-80, Math.min(80, c.cameraRotationX ?? 0));
  const cameraPosition =
    tiltDeg === 0
      ? horizontalPosition
      : tiltAroundTarget(horizontalPosition, cameraTarget, tiltDeg);
  // `> 0` (not `??`): Gutenberg ALWAYS populates lightIntensity/avatarScale
  // with their block.json schema default (0) even when the author never
  // touched the slider, so `c.lightIntensity`/`c.avatarScale` are a real,
  // present `0` here — never `null`/`undefined` — and `??` cannot catch it.
  // This is the SAME "0 means unset" sentinel convention already used by
  // wordpress-plugin/includes/Block/AvatarBlock.php's render_callback
  // (`( $attributes['avatarScale'] ?? 0 ) > 0 ? ... : null`) for the
  // published-page path, and by editor.js's own RangeControl display logic
  // (`value: live.avatarScale > 0 ? ... : undefined`). Without this, every
  // block/preview that hasn't had these two sliders explicitly dragged
  // resolves avatarScale=0 -> <VRMAvatar scale={[0,0,0]}> (invisible avatar,
  // no error, indistinguishable by eye from a stuck load) and
  // lightIntensity=0 (unlit) in the editor preview specifically (fix for
  // "avatar never appears in editor preview" bug, debugged 2026-07-09).
  return {
    lightIntensity: c.lightIntensity && c.lightIntensity > 0 ? c.lightIntensity : LIGHT_INTENSITY.default,
    avatarScale: c.avatarScale && c.avatarScale > 0 ? c.avatarScale : 1.0,
    avatarOffsetX: c.avatarOffsetX ?? 0.0,
    avatarOffsetY: c.avatarOffsetY ?? 0.0,
    cameraPreset: preset,
    cameraRotationY: rotationDeg,
    cameraRotationX: tiltDeg,
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
