/**
 * packages/wp-bundle/src/preview/PreviewAvatarCanvas.tsx — STUDIO-02 safe
 * avatar canvas, extracted from PreviewScene.tsx (quick task 260708-1ws) so
 * it can be shared between the plain-layout preview (Avatar section /
 * Gutenberg block editor) AND the new PreviewFloatingWidget's fixed-200px
 * avatar area.
 *
 * Renders inside a parent that supplies the box dimensions (a containerStyle
 * div for plain mode, `.khaveeai-floating-avatar-area` for floating mode) —
 * this component sets NO width/height itself, exactly as the fragment it
 * was lifted from.
 *
 * STUDIO-02 safety: does NOT call useRealtime(), does NOT construct
 * OpenAIRealtimeProvider, does NOT call getUserMedia, never hits the token
 * endpoint. Must be rendered inside a <KhaveeProvider> subtree (uses
 * useVRMExpressions() via usePreviewTalking below — rules-of-hooks is
 * satisfied because PreviewScene.tsx always renders this component inside
 * its own <KhaveeProvider>).
 *
 * Background (Pitfall 6 — transparent-background):
 *   The Canvas ALWAYS renders with gl={{ alpha: true }} — a CONSTANT prop
 *   (no key-based remount; see PreviewScene.tsx's file-header for the full
 *   root-cause writeup of why a keyed/differentiated `gl` value was removed,
 *   quick task 260707-oyu). All of the actual transparent-vs-opaque
 *   switching happens on the PARENT container's CSS `background`, never on
 *   scene.background or the renderer's alpha context.
 */
import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { VRMAvatar, useVRMExpressions } from "@khaveeai/react";
import {
  resolveSceneDefaults,
  angleFromCameraPosition,
  CAMERA_PRESETS,
  IDLE_ANIMATION_URL,
} from "../config";
import { CameraController } from "../CameraController";
import type { PreviewAvatarConfig } from "./PreviewScene";

// CameraController now lives in ../CameraController.tsx — shared verbatim
// with mount.tsx's AvatarScene (published page) so the two rendering paths
// can never drift on camera aim again (camera-framing-mismatch debug
// session root cause: react-three-fiber's own default-camera setup
// hardcodes camera.lookAt(0, 0, 0) once at Canvas creation, ignoring
// resolveSceneDefaults().cameraTarget entirely; mount.tsx previously had
// no equivalent correction).

// ── CanvasStyleSync ───────────────────────────────────────────────────────────

/**
 * Root cause fix (debug session: camera-framing-mismatch,
 * .planning/debug/camera-framing-mismatch.md): this preview bundle
 * (khaveeai-preview.js) is loaded and EXECUTES in the TOP wp-admin window's
 * JS realm (WordPress's block.json `editorScript` field is never injected
 * into the Gutenberg block-canvas iframe — see preview.ts's file header),
 * while the mount-point div it renders into physically lives INSIDE
 * `iframe[name="editor-canvas"]` — a separate JS realm/document. React
 * creates the `<canvas>` DOM node via that div's own `ownerDocument` (the
 * iframe's document), so the live THREE.WebGLRenderer's `domElement` is an
 * iframe-realm HTMLCanvasElement instance.
 *
 * @react-three/fiber's own Canvas-resize subscription
 * (node_modules/@react-three/fiber/dist/events-*.cjs.dev.js: `const
 * updateStyle = typeof HTMLCanvasElement !== 'undefined' && gl.domElement
 * instanceof HTMLCanvasElement; gl.setSize(size.width, size.height,
 * updateStyle);`) gates whether it sets `canvas.style.width/height` on a
 * cross-realm `instanceof HTMLCanvasElement` check — the bare
 * `HTMLCanvasElement` identifier resolves against the TOP window's
 * constructor (since that's where this bundled code executes), so it never
 * matches an iframe-realm canvas. `updateStyle` is therefore always
 * `false` here, and three.js's `WebGLRenderer.setSize()` never applies a
 * CSS size — the canvas falls back to its intrinsic size, which equals its
 * `width`/`height` HTML ATTRIBUTES (correctly `containerCSSSize *
 * devicePixelRatio`, i.e. the draw-buffer resolution) interpreted directly
 * AS CSS pixels. At devicePixelRatio===1 this coincidentally equals the
 * intended CSS size (hiding the bug entirely — every prior debug session
 * self-verification ran at the default dpr=1 and found nothing). At
 * devicePixelRatio===2 (a real Retina/HiDPI display) the canvas renders at
 * exactly 2x its intended CSS footprint in both dimensions, overflowing/
 * getting clipped by ancestor containers — producing a "zoomed in" crop
 * (full body appears as head+shoulders only), reproduced and measured via
 * CDP with `--force-device-scale-factor=2`.
 *
 * This component bypasses the broken cross-realm instanceof gate entirely
 * by unconditionally applying R3F's own already-correct `size` state
 * (CSS pixels, from react-use-measure's getBoundingClientRect — never
 * itself wrong) straight onto the canvas element's inline style, on every
 * size change. Scoped to this file only: mount.tsx's AvatarScene (published
 * page) mounts in the same document realm as its own script, so its
 * instanceof check already succeeds there and needs no correction.
 */
function CanvasStyleSync(): null {
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    gl.domElement.style.width = `${size.width}px`;
    gl.domElement.style.height = `${size.height}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, size.width, size.height]);

  return null;
}

// ── CameraRefCapture ──────────────────────────────────────────────────────────

/**
 * Mirrors the live R3F camera object into a ref so code OUTSIDE the Canvas
 * (e.g. the OrbitControls onEnd handler wired up below) can read the
 * camera's current position without itself needing to be inside the
 * Canvas's useThree() context.
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

// ── PreviewAvatarCanvas (exported) ────────────────────────────────────────────

/**
 * Config-driven 3D VRM preview canvas fragment: Canvas + camera controller/
 * orbit controls + lighting + VRMAvatar + "No avatar selected" empty state +
 * "Preview talking" pill overlay. Dimension-agnostic — the parent supplies
 * the box (width/height) this fragment fills.
 *
 * @param config - The parsed PreviewAvatarConfig (KhaveeAvatarConfig extended
 *   with previewTalking/previewMode) from the mount point's data attribute.
 * @param onCameraAngleChange - Optional callback fired once per drag/zoom
 *   release on the OrbitControls, with the resulting Y-axis degrees.
 */
export function PreviewAvatarCanvas({
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
   * it to the caller.
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

  // Quick task 260707-oyu: no more differentiated/keyed `gl` value here — see
  // PreviewScene.tsx's file-header root-cause note. `gl={{ alpha: true }}` is
  // now a CONSTANT passed to the Canvas below; the parent container's
  // `background` CSS does 100% of the actual transparent/opaque switching.
  const canvasStyle: React.CSSProperties | undefined = config.bgTransparent
    ? { background: "transparent" }
    : undefined;

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
    <>
      <Canvas
        // Quick task 260707-oyu (genuine fix, see PreviewScene.tsx's
        // file-header root-cause note): NO `key` here — a keyed remount was
        // proven to change nothing about the renderer's actual alpha/
        // transparency behavior while forcing a full Canvas/WebGLRenderer/
        // VRM-reload teardown+rebuild on every checkbox toggle. The Canvas
        // now mounts ONCE with a constant `gl={{ alpha: true }}`; the
        // parent container's `background` CSS is what actually switches
        // transparent vs opaque.
        camera={{ position: sceneDefaults.cameraPosition, fov: sceneDefaults.cameraFov }}
        gl={{ alpha: true }}
        style={canvasStyle}
      >
        <CameraController
          position={sceneDefaults.cameraPosition}
          target={sceneDefaults.cameraTarget}
          fov={sceneDefaults.cameraFov}
        />
        <CanvasStyleSync />
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
}
