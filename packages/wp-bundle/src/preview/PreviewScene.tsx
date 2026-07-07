/**
 * packages/wp-bundle/src/preview/PreviewScene.tsx — STUDIO-02/04 preview scene.
 *
 * Renders a config-driven 3D VRM preview inside a <KhaveeProvider> with NO
 * realtime provider. This component is the UI body of the STUDIO-02 safe-preview
 * bundle: it never calls useRealtime(), never constructs OpenAIRealtimeProvider,
 * never calls getUserMedia, and never hits the token endpoint.
 *
 * Safety guarantees (defence in depth, T-09-03-01):
 *   - KhaveeProvider receives no config prop → realtimeProvider is null inside.
 *   - useVRMExpressions() works with a null realtime provider (reads VRM state
 *     from context, not from a live session).
 *   - useRealtime() is NOT called anywhere in this file (nor in
 *     PreviewAvatarCanvas.tsx, PreviewChatBox.tsx) — it throws when
 *     realtimeProvider is null (useRealtime.ts:36-40).
 *
 * Quick task 260708-1ws: the actual Canvas/camera/lighting/VRMAvatar fragment
 * (previously inlined here as PreviewSceneInner's `avatarArea`) now lives in
 * PreviewAvatarCanvas.tsx so it can be shared between this plain layout
 * (Avatar-section / Gutenberg block editor previews) and
 * PreviewFloatingWidget's fixed-200px avatar area — both render inside the
 * SAME <KhaveeProvider> this file owns. `previewMode: "floating"` (set ONLY
 * by SettingsPage.php's floating mount) branches PreviewSceneInner to
 * PreviewFloatingWidget; every other caller (Avatar-section mount, Gutenberg
 * block editor) leaves previewMode unset and keeps the plain-layout
 * rendering below unchanged.
 *
 * Background (Pitfall 6 — transparent-background):
 *   The container div's CSS `background` (transparent | config.bgColor |
 *   url(...)) does 100% of the actual transparent-vs-opaque switching for
 *   the plain layout — PreviewAvatarCanvas's Canvas ALWAYS renders with a
 *   constant gl={{ alpha: true }} (no key-based remount).
 *
 *   Quick task 260707-oyu root-cause note (genuine fix, replacing the
 *   disproven `key`-prop hypothesis from commit 5a39d51): the prior code
 *   branched `gl={config.bgTransparent ? { alpha: true } : undefined}` under
 *   a `key={bgTransparent ? "gl-alpha" : "gl-opaque"}`, on the theory that
 *   the "opaque" branch needed its OWN forced-remount WebGLRenderer with a
 *   different alpha context. Traced directly against the installed
 *   @react-three/fiber source (dist/react-three-fiber.cjs.dev.js — the
 *   renderer-creation `defaultProps` object hardcodes `alpha: true`, and
 *   `new THREE.WebGLRenderer({ ...defaultProps, ...glConfig })` with
 *   `glConfig === undefined` is a no-op spread) proves the "opaque" branch's
 *   `gl={undefined}` NEVER produced an opaque context — it was ALWAYS
 *   `alpha: true`, identical to the "transparent" branch. (three.js's own
 *   WebGLBackground module further confirms `clearAlpha` defaults to `0`
 *   whenever `alpha === true`, so the canvas has ALWAYS cleared to fully
 *   transparent in both branches — exactly matching the file's own design:
 *   the canvas never blocks the container's CSS background.) The `key` prop
 *   therefore forced a full Canvas/WebGLRenderer/VRM-reload teardown+rebuild
 *   on EVERY checkbox toggle for zero actual alpha-context benefit — directly
 *   contradicting mountPreview.tsx's own stated design goal of keeping a
 *   SINGLE persistent WebGL context alive for the block's lifetime, and is
 *   the most plausible source of a toggle sequence going genuinely "stuck"
 *   (repeated WebGL context churn is a known trigger for context loss/
 *   exhaustion in browsers). The real fix: drop the `key` and the
 *   differentiated `gl` value entirely — the Canvas now mounts ONCE with a
 *   constant `gl={{ alpha: true }}`, and the container div's `background`
 *   CSS (already recomputed correctly on every render from live `config`,
 *   below) does 100% of the actual visible transparent/opaque switching,
 *   with no Canvas remount required.
 */
import React from "react";
import { KhaveeProvider } from "@khaveeai/react";
import type { KhaveeAvatarConfig } from "../config";
import { PreviewChatBox } from "./PreviewChatBox";
import { PreviewAvatarCanvas } from "./PreviewAvatarCanvas";
import { PreviewFloatingWidget } from "./PreviewFloatingWidget";

// ── Preview-only config extension ─────────────────────────────────────────────

/**
 * Extends KhaveeAvatarConfig with editor-only preview flags emitted by
 * editor.js (Plan 09-02) into the data-khaveeai-preview-config JSON.
 * Not part of the published-page config transport.
 */
export interface PreviewAvatarConfig extends KhaveeAvatarConfig {
  /** When true, the no-audio viseme cycler runs at ~4Hz. Default false. */
  previewTalking?: boolean;
  /**
   * When set to "floating", PreviewSceneInner renders PreviewFloatingWidget
   * (the real front-end FloatingWidget.tsx's structure/CSS classes, preview-
   * safe) instead of the plain-layout preview below. Emitted ONLY by
   * SettingsPage.php's render_floating_preview_mount() config array and its
   * inline rebuild() cfg object — the Avatar-section mount and the
   * Gutenberg block editor never set this, so they keep the plain-avatar
   * layout. Preview-only; NOT part of the published-page config transport
   * (KhaveeAvatarConfig).
   */
  previewMode?: "floating";
}

// ── PreviewSceneInner ─────────────────────────────────────────────────────────

/**
 * Inner component rendered inside <KhaveeProvider>. Branches to
 * PreviewFloatingWidget when config.previewMode === "floating"; otherwise
 * renders the plain containerStyle + optional khaveeai-layout + chat
 * composition, using the shared PreviewAvatarCanvas fragment for the avatar
 * area in both the chatShow and no-chat branches. The split from
 * <PreviewScene> exists so PreviewAvatarCanvas's hooks (useVRMExpressions()
 * via usePreviewTalking) are called within the provider's subtree (React
 * rules of hooks).
 */
function PreviewSceneInner({
  config,
  onCameraAngleChange,
}: {
  config: PreviewAvatarConfig;
  onCameraAngleChange?: (deg: number) => void;
}) {
  // Floating-widget parity layout (quick task 260708-1ws): fixed 360x520
  // panel sizing comes entirely from .khaveeai-floating-panel's own CSS —
  // do NOT apply the plain containerStyle dimensions or khaveeai-layout
  // wrapper in this mode.
  if (config.previewMode === "floating") {
    return (
      <PreviewFloatingWidget
        config={config}
        onCameraAngleChange={onCameraAngleChange}
      />
    );
  }

  // ── Container styling (background + dimensions) ──────────────────────────

  const containerStyle: React.CSSProperties = {
    position: "relative", // required for absolutely-positioned overlays
  };

  // Dimensions
  if (config.fullWidth) {
    containerStyle.width = "100%";
  } else if (config.containerWidth && config.containerWidth > 0) {
    containerStyle.width = `${config.containerWidth}px`;
  }
  if (config.containerHeight && config.containerHeight > 0) {
    containerStyle.height = `${config.containerHeight}px`;
  }

  // Background (Pitfall 6 — do NOT set scene.background; use CSS-on-container)
  if (config.bgTransparent) {
    containerStyle.background = "transparent";
  } else if (config.bgType === "color" && config.bgColor) {
    containerStyle.background = config.bgColor;
  } else if (config.bgType === "image" && config.bgImageUrl) {
    containerStyle.backgroundImage = `url(${config.bgImageUrl})`;
    containerStyle.backgroundSize = "cover";
    containerStyle.backgroundPosition = "center";
  }

  // "" (not undefined) is editor.js's SelectControl value for "(using global
  // default)" on chatPlacement too — the live/published path normalizes this
  // in PHP (AvatarRenderer.php), but the editor preview reads the raw
  // attribute directly, so this must use `||` not `??` for the same reason
  // as resolveSceneDefaults()'s cameraPreset fix (config.ts).
  const chatPlacement = (config.chatPlacement || "beside") as "beside" | "below";

  const avatarArea = (
    <PreviewAvatarCanvas config={config} onCameraAngleChange={onCameraAngleChange} />
  );

  return (
    <div style={containerStyle}>
      {config.chatShow ? (
        // Mirrors mount.tsx's live-view layout (.khaveeai-layout--{beside|below})
        // so the editor preview matches the published page WYSIWYG.
        <div className={`khaveeai-layout khaveeai-layout--${chatPlacement}`}>
          <div style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
            {avatarArea}
          </div>
          <PreviewChatBox placement={chatPlacement} />
        </div>
      ) : (
        avatarArea
      )}
    </div>
  );
}

// ── PreviewScene (exported) ────────────────────────────────────────────────────

/**
 * Config-driven 3D VRM editor preview component.
 *
 * Wraps its content in <KhaveeProvider> with NO realtime config so
 * useVRMExpressions() works for the Preview-talking cycler while
 * useRealtime() is never called (it would throw with a null provider).
 *
 * @param config - The parsed KhaveeAvatarConfig (extended with previewTalking)
 *   from the data-khaveeai-preview-config attribute on the mount-point div.
 * @param onCameraAngleChange - Optional callback fired once per drag/zoom
 *   release on the preview's OrbitControls, with the resulting Y-axis
 *   degrees (see PreviewAvatarCanvas's handleOrbitEnd). Used by
 *   mountPreview.tsx to bridge the drag gesture out to the plain-JS
 *   Settings page.
 */
export function PreviewScene({
  config,
  onCameraAngleChange,
}: {
  config: KhaveeAvatarConfig;
  onCameraAngleChange?: (deg: number) => void;
}) {
  return (
    <KhaveeProvider>
      <PreviewSceneInner
        config={config as PreviewAvatarConfig}
        onCameraAngleChange={onCameraAngleChange}
      />
    </KhaveeProvider>
  );
}
