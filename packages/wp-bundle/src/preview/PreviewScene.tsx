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
 *   The Canvas ALWAYS renders with gl={{ alpha: true }} — a CONSTANT prop
 *   (no key-based remount; see the root-cause note below). All of the actual
 *   transparent-vs-opaque switching happens on the CONTAINER div's CSS
 *   `background` (transparent | config.bgColor | url(...)), never on
 *   scene.background or the renderer's alpha context (cheaper, simpler,
 *   avoids three.js background clear-color interaction).
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
import React, { useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { KhaveeProvider, VRMAvatar, useVRMExpressions } from "@khaveeai/react";
import {
  resolveSceneDefaults,
  angleFromCameraPosition,
  CAMERA_PRESETS,
  IDLE_ANIMATION_URL,
  type KhaveeAvatarConfig,
} from "../config";
import { PreviewChatBox } from "./PreviewChatBox";

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

// ── CameraController ─────────────────────────────────────────────────────────

/**
 * Imperatively syncs the R3F camera to position/target/fov on every change.
 *
 * R3F's <Canvas camera={{...}}> prop is initialization-only (Pitfall 7: camera
 * prop not reactive). This component uses useThree() to access the live camera
 * object and useEffect to call camera.position.set / camera.lookAt /
 * camera.updateProjectionMatrix imperatively whenever the props change.
 *
 * Uses individual array-element deps ([pos[0], pos[1], pos[2], ...]) rather
 * than the tuple refs so the effect does not re-run when resolveSceneDefaults
 * returns a new tuple reference with identical values.
 *
 * STUDIO-02 safety: does NOT call useRealtime(), does NOT import any khaveeai
 * provider — only useThree from @react-three/fiber and THREE from three.
 */
function CameraController({
  position,
  target,
  fov,
}: {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}): null {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(target[0], target[1], target[2]);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // Individual element deps avoid re-firing when a new tuple reference
    // is created with the same values (resolveSceneDefaults returns new
    // tuple objects on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, position[0], position[1], position[2], target[0], target[1], target[2], fov]);

  return null;
}

// ── CameraRefCapture ──────────────────────────────────────────────────────────

/**
 * Mirrors the live R3F camera object into a ref so code OUTSIDE the Canvas
 * (e.g. the OrbitControls onEnd handler wired up in PreviewSceneInner) can
 * read the camera's current position without itself needing to be inside
 * the Canvas's useThree() context.
 *
 * Purely a read-side sibling of CameraController — it never mutates the
 * camera and does not participate in the config-driven reset behavior.
 */
function CameraRefCapture({
  cameraRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
}): null {
  const { camera } = useThree();
  cameraRef.current = camera;
  return null;
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
function PreviewSceneInner({
  config,
  onCameraAngleChange,
}: {
  config: PreviewAvatarConfig;
  onCameraAngleChange?: (deg: number) => void;
}) {
  const sceneDefaults = resolveSceneDefaults(config);
  const isTalking = config.previewTalking ?? false;

  // Viseme cycler — must be inside KhaveeProvider context (Pitfall 4 avoidance).
  usePreviewTalking(isTalking);

  // Live camera mirror for the OrbitControls onEnd readback below — see
  // CameraRefCapture's doc comment for why this needs to live outside the
  // Canvas's own useThree() context.
  const liveCameraRef = useRef<THREE.Camera | null>(null);

  /**
   * Fires once when the user releases a drag/zoom on the preview's
   * OrbitControls (NOT per-frame — onChange would write-thrash the slider
   * on every render). Reads the live camera's current position back into a
   * Y-axis degrees value via the inverse of orbitAroundTarget, and reports
   * it to the caller (mountPreview.tsx bridges this to a DOM CustomEvent so
   * the plain-JS Settings page can hear it). CameraController's own reset
   * effect is untouched — this is a read-only sibling.
   */
  const handleOrbitEnd = () => {
    const camera = liveCameraRef.current;
    if (!camera || !onCameraAngleChange) return;
    const cameraPosition: [number, number, number] = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
    ];
    const basePosition = CAMERA_PRESETS[sceneDefaults.cameraPreset].position;
    const deg = angleFromCameraPosition(
      cameraPosition,
      sceneDefaults.cameraTarget,
      basePosition
    );
    onCameraAngleChange(deg);
  };

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
  // Quick task 260707-oyu: no more differentiated/keyed `gl` value here — see
  // the file-header root-cause note. `gl={{ alpha: true }}` is now a CONSTANT
  // passed to the Canvas below; the container's `background` CSS above (not
  // the Canvas) does 100% of the actual transparent/opaque switching.

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

  // "" (not undefined) is editor.js's SelectControl value for "(using global
  // default)" on chatPlacement too — the live/published path normalizes this
  // in PHP (AvatarRenderer.php), but the editor preview reads the raw
  // attribute directly, so this must use `||` not `??` for the same reason
  // as resolveSceneDefaults()'s cameraPreset fix (config.ts).
  const chatPlacement = (config.chatPlacement || "beside") as "beside" | "below";

  const avatarArea = (
    <>
      <Canvas
        // Quick task 260707-oyu (genuine fix, see file-header root-cause
        // note): NO `key` here anymore — commit 5a39d51's key-based remount
        // was proven (via @react-three/fiber + three.js source trace) to
        // change nothing about the renderer's actual alpha/transparency
        // behavior (both branches were already `alpha: true`), while forcing
        // a full Canvas/WebGLRenderer/VRM-reload teardown+rebuild on every
        // single checkbox toggle — the most plausible cause of a toggle
        // sequence going genuinely stuck (WebGL context churn). The Canvas
        // now mounts ONCE with a constant `gl={{ alpha: true }}`; the
        // container div's `background` CSS (set above from live `config` on
        // every render) is what actually switches transparent vs opaque.
        camera={{ position: sceneDefaults.cameraPosition, fov: sceneDefaults.cameraFov }}
        gl={{ alpha: true }}
        style={canvasStyle}
      >
        <CameraController
          position={sceneDefaults.cameraPosition}
          target={sceneDefaults.cameraTarget}
          fov={sceneDefaults.cameraFov}
        />
        <CameraRefCapture cameraRef={liveCameraRef} />
        {/* Lets the author freely orbit/zoom the preview to check angles.
            makeDefault registers this as the R3F default controls instance;
            CameraController still owns the canonical position/target/fov
            whenever the config-driven values change (e.g. a new camera
            preset), so switching presets resets any manual orbiting.
            onEnd (fires once per drag/zoom release, not per-frame) reads
            the live camera back into a Y-angle via handleOrbitEnd. */}
        <OrbitControls
          target={sceneDefaults.cameraTarget}
          makeDefault
          onEnd={handleOrbitEnd}
        />
        {/* ── Lighting ─────────────────────────────────────────────────── */}
        {/* ambient: config-driven Part A Lighting. directional: matches Phase-8 mount.tsx:59-60. */}
        <ambientLight intensity={sceneDefaults.lightIntensity} />
        <directionalLight position={[10, 10, 5]} intensity={sceneDefaults.directional} />

        {/* ── Avatar ───────────────────────────────────────────────────── */}
        {/* Always VRMAvatar, never branched on file extension: several
            "avatarUrl.glb" uploads in the wild are actually VRM avatars
            (VRM extension present, zero embedded animations, unlit
            material fallback) saved with a .glb filename — routing those
            through GLBAvatar left them in a permanent T-pose with no
            lighting response. VRMAvatar's VRMLoaderPlugin is additive on
            top of the standard GLTFLoader, so a genuinely plain (non-VRM)
            .glb still loads and displays, just without humanoid/expression
            features (found 2026-07-02, testing a real .glb avatar). */}
        {config.avatarUrl && (
          <VRMAvatar
            src={config.avatarUrl}
            position={positionTuple}
            scale={scaleTuple}
            animations={IDLE_ANIMATION_URL ? { idle: IDLE_ANIMATION_URL } : undefined}
          />
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
    </>
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
 *   degrees (see PreviewSceneInner's handleOrbitEnd). Used by mountPreview.tsx
 *   to bridge the drag gesture out to the plain-JS Settings page.
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
