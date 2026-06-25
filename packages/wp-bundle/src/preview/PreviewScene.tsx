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
 *   - useRealtime() is NOT called anywhere in this file — it throws when
 *     realtimeProvider is null (useRealtime.ts:36-40).
 *
 * Preview-talking viseme cycler (STUDIO-04 editor-side, no-audio):
 *   usePreviewTalking loops aa/ih/ou/ee/oh at 250ms via setInterval when
 *   config.previewTalking is true, so the author sees mouth motion without a
 *   live realtime session. A "Preview talking" pill label overlays the corner.
 *
 * Background (Pitfall 6 — transparent-background):
 *   bgTransparent: <Canvas gl={{ alpha: true }}> + container div background:transparent
 *   bgColor / bgImage: applied to the container div CSS, NOT to scene.background
 *   (cheaper, simpler, avoids three.js background clear-color interaction).
 */
import React, { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { KhaveeProvider, VRMAvatar, GLBAvatar, useVRMExpressions } from "@khaveeai/react";
import {
  resolveSceneDefaults,
  type KhaveeAvatarConfig,
} from "../config";

// ── Preview-only config extension ─────────────────────────────────────────────

/**
 * Extends KhaveeAvatarConfig with editor-only preview flags emitted by
 * editor.js (Plan 09-02) into the data-khaveeai-preview-config JSON.
 * Not part of the published-page config transport.
 */
interface PreviewAvatarConfig extends KhaveeAvatarConfig {
  /** When true, the no-audio viseme cycler runs at ~4Hz. Default false. */
  previewTalking?: boolean;
}

// ── Preview-talking viseme cycler ─────────────────────────────────────────────

const VISEME_SEQUENCE = ["aa", "ih", "ou", "ee", "oh"] as const;
const VISEME_VALUES: Record<string, number> = {
  aa: 0.6,
  ih: 0.4,
  ou: 0.5,
  ee: 0.45,
  oh: 0.55,
};

/**
 * No-audio Preview-talking demo hook (STUDIO-04, editor-side).
 *
 * When enabled, cycles through the five mouth shapes (aa/ih/ou/ee/oh) at
 * ~4Hz (250ms) via setInterval so the author sees mouth motion without a
 * live realtime session. On disable (or unmount), all viseme weights reset
 * to zero.
 *
 * Must be called inside a <KhaveeProvider> subtree because it uses
 * useVRMExpressions() which reads context from KhaveeProvider.
 */
function usePreviewTalking(enabled: boolean): void {
  const { setMultipleExpressions } = useVRMExpressions();

  useEffect(() => {
    if (!enabled) {
      setMultipleExpressions({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
      return;
    }
    let i = 0;
    const interval = setInterval(() => {
      const viseme = VISEME_SEQUENCE[i % VISEME_SEQUENCE.length];
      const state: Record<string, number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
      state[viseme] = VISEME_VALUES[viseme];
      setMultipleExpressions(state);
      i++;
    }, 250); // ~4Hz per UI-SPEC §Interaction-States
    return () => clearInterval(interval);
  }, [enabled, setMultipleExpressions]);
}

// ── PreviewSceneInner ─────────────────────────────────────────────────────────

/**
 * Inner component rendered inside <KhaveeProvider>. Holds the actual Three.js
 * Canvas, lights, avatar, and the preview-talking cycler hook. The split from
 * <PreviewScene> exists so useVRMExpressions() (and thus usePreviewTalking)
 * is called within the provider's subtree (React rules of hooks).
 */
function PreviewSceneInner({ config }: { config: PreviewAvatarConfig }) {
  const sceneDefaults = resolveSceneDefaults(config);
  const isTalking = config.previewTalking ?? false;
  const isGlb = Boolean(config.avatarUrl?.toLowerCase().endsWith(".glb"));

  // Viseme cycler — must be inside KhaveeProvider context (Pitfall 4 avoidance).
  usePreviewTalking(isTalking);

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

  // ── Canvas props ──────────────────────────────────────────────────────────

  const canvasGl = config.bgTransparent ? { alpha: true } : undefined;
  const canvasStyle: React.CSSProperties | undefined = config.bgTransparent
    ? { background: "transparent" }
    : undefined;

  // ── Scale tuple ───────────────────────────────────────────────────────────

  const scaleTuple: [number, number, number] = [
    sceneDefaults.avatarScale,
    sceneDefaults.avatarScale,
    sceneDefaults.avatarScale,
  ];

  const positionTuple: [number, number, number] = [
    sceneDefaults.avatarOffsetX,
    sceneDefaults.avatarOffsetY,
    0,
  ];

  return (
    <div style={containerStyle}>
      <Canvas
        camera={{ position: sceneDefaults.cameraPosition, fov: sceneDefaults.cameraFov }}
        gl={canvasGl}
        style={canvasStyle}
      >
        {/* ── Lighting ─────────────────────────────────────────────────── */}
        {/* ambient: config-driven Part A Lighting. directional: matches Phase-8 mount.tsx:59-60. */}
        <ambientLight intensity={sceneDefaults.lightIntensity} />
        <directionalLight position={[10, 10, 5]} intensity={sceneDefaults.directional} />

        {/* ── Avatar ───────────────────────────────────────────────────── */}
        {config.avatarUrl && (
          isGlb ? (
            <GLBAvatar
              src={config.avatarUrl}
              position={positionTuple}
              scale={scaleTuple}
            />
          ) : (
            <VRMAvatar
              src={config.avatarUrl}
              position={positionTuple}
              scale={scaleTuple}
            />
          )
        )}
      </Canvas>

      {/* ── Empty state (no avatar selected) ──────────────────────────── */}
      {/* UI-SPEC §Copywriting — verbatim copy */}
      {!config.avatarUrl && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: "8px" }}>
            No avatar selected
          </p>
          <p style={{ fontSize: "14px", color: "#757575" }}>
            Choose an avatar in the Avatar panel, or set a global default in
            Settings.
          </p>
        </div>
      )}

      {/* ── Preview-talking pill label ─────────────────────────────────── */}
      {/* UI-SPEC §Interaction-States: "Preview talking ON" — overlay pill so the */}
      {/* author knows the motion is a demo, not a live session. */}
      {isTalking && (
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            background: "rgba(0, 0, 0, 0.6)",
            color: "#fff",
            fontSize: "12px",
            padding: "4px 8px",
            borderRadius: "12px",
            pointerEvents: "none",
            fontFamily: "inherit",
          }}
        >
          Preview talking
        </div>
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
 */
export function PreviewScene({ config }: { config: KhaveeAvatarConfig }) {
  return (
    <KhaveeProvider>
      <PreviewSceneInner config={config as PreviewAvatarConfig} />
    </KhaveeProvider>
  );
}
