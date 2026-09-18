import { useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import * as THREE from "three";
import { createNoise3D } from "simplex-noise";
import { useKhavee } from "../KhaveeProvider";

/**
 * AvatarCamera - Deliberate cinematographic framing for avatar scenes.
 *
 * Replaces unconstrained free-orbit camera with curated, production-quality
 * framing: three built-in presets (bust-shot, medium-close-up, full-body),
 * three orbit modes (locked/constrained/free), procedural handheld drift via
 * simplex noise, and chatStatus-driven dolly reframing.
 *
 * **Why separate from VRMAvatar/GLBAvatar:** Camera is per-Canvas (like
 * AvatarPostFX), not per-avatar. Multiple cameras in the same scene are not
 * meaningful — only one camera can be active.
 *
 * **Mount once per Canvas:** Mounting both `AvatarCamera` and `OrbitControls`/
 * `CameraControls` in the same scene creates a conflict (both try to own the
 * camera). This component is opt-in (D-02) specifically to avoid breaking
 * existing consumers' controls.
 *
 * **Framing presets:** Three built-in presets with sensible defaults for
 * position/target/fov. Consumer can override any axis via explicit props.
 *
 * **Orbit modes:** locked (no user interaction), constrained (clamped ranges),
 * free (unconstrained, for dev/debug).
 *
 * **Drift:** Procedural handheld camera life via simplex noise. Always on
 * (pauses only during active user orbit).
 *
 * **Reframing:** Subtle dolly push-in on chatStatus="speaking", ease back on
 * "listening"/"ready". Dolly-only (no angle/target change).
 */

/** Camera framing preset configurations. */
export type CameraPreset = "bust-shot" | "medium-close-up" | "full-body";

/** Orbit interaction mode. */
export type OrbitMode = "locked" | "constrained" | "free";

/** Options for {@link AvatarCamera}. */
export interface AvatarCameraProps {
  /** Camera framing preset. Default: "bust-shot" */
  preset?: CameraPreset;
  /** Override preset's camera position [x, y, z]. */
  position?: [number, number, number];
  /** Override preset's look-at target [x, y, z]. */
  target?: [number, number, number];
  /** Override preset's field of view (degrees). */
  fov?: number;
  /** Orbit interaction mode. Default: "locked" */
  orbit?: OrbitMode;
  /** Enable handheld drift (procedural camera life). Default: true */
  drift?: boolean;
  /** Enable state-driven reframing (dolly on speaking). Default: true */
  reframe?: boolean;
}

// ── Preset Constants ──────────────────────────────────────────────────────

/**
 * Preset camera configurations (position, target, fov).
 * Values tuned empirically for typical VRM/GLB avatar proportions.
 */
const CAMERA_PRESETS: Record<
  CameraPreset,
  { position: [number, number, number]; target: [number, number, number]; fov: number }
> = {
  "bust-shot": {
    position: [0, 1.4, 1.8],
    target: [0, 1.3, 0],
    fov: 35,
  },
  "medium-close-up": {
    position: [0, 1.45, 2.4],
    target: [0, 1.35, 0],
    fov: 40,
  },
  "full-body": {
    position: [0, 1.0, 4.0],
    target: [0, 0.9, 0],
    fov: 50,
  },
};

/**
 * Constrained orbit ranges per preset (polar/azimuth angles, distance).
 * Applied when orbit="constrained" to clamp user interaction within
 * flattering angles.
 */
const CONSTRAINED_RANGES: Record<
  CameraPreset,
  {
    minPolar: number;
    maxPolar: number;
    minAzimuth: number;
    maxAzimuth: number;
    minDist: number;
    maxDist: number;
  }
> = {
  "bust-shot": {
    minPolar: Math.PI / 3,
    maxPolar: Math.PI / 2.2,
    minAzimuth: -Math.PI / 6,
    maxAzimuth: Math.PI / 6,
    minDist: 1.2,
    maxDist: 2.4,
  },
  "medium-close-up": {
    minPolar: Math.PI / 3.5,
    maxPolar: Math.PI / 2,
    minAzimuth: -Math.PI / 5,
    maxAzimuth: Math.PI / 5,
    minDist: 1.6,
    maxDist: 3.2,
  },
  "full-body": {
    minPolar: Math.PI / 4,
    maxPolar: Math.PI / 2,
    minAzimuth: -Math.PI / 4,
    maxAzimuth: Math.PI / 4,
    minDist: 2.5,
    maxDist: 5.5,
  },
};

/**
 * resolvePreset - Merge preset defaults with explicit prop overrides.
 *
 * An explicit prop overrides the preset's default for that axis only.
 * This gives consumers escape hatches for fine-tuning without forking.
 */
function resolvePreset(
  preset: CameraPreset,
  overrides: {
    position?: [number, number, number];
    target?: [number, number, number];
    fov?: number;
  },
) {
  const base = CAMERA_PRESETS[preset];
  return {
    position: overrides.position ?? base.position,
    target: overrides.target ?? base.target,
    fov: overrides.fov ?? base.fov,
  };
}

// ── Drift Constants ───────────────────────────────────────────────────────

/** Drift frequency (Hz) — slow, organic handheld motion. */
const DRIFT_FREQUENCY = 0.4;

/** Position drift amplitude (world units, ~8mm). */
const DRIFT_POSITION_AMPLITUDE = 0.008;

/** Target drift amplitude (world units, ~5mm) — lower than position to avoid wander. */
const DRIFT_TARGET_AMPLITUDE = 0.005;

// ── Reframe Constants ─────────────────────────────────────────────────────

/** Speaking push-in multiplier (7% closer, middle of D-10's 5-10% range). */
const REFRAME_SPEAKING_MULTIPLIER = 0.93;

/** Exponential decay constant for reframing lerp (~0.33s time constant). */
const REFRAME_LERP_SPEED = 3;

// ── Module-scoped Scratch Objects (Allocation-Reuse Pattern) ─────────────

const _scratchPos = new THREE.Vector3();
const _scratchTarget = new THREE.Vector3();
const _scratchDir = new THREE.Vector3();

// ── Main Component ────────────────────────────────────────────────────────

export function AvatarCamera({
  preset = "bust-shot",
  position,
  target,
  fov,
  orbit = "locked",
  drift = true,
  reframe = true,
}: AvatarCameraProps): ReactElement {
  // Refs
  const controlsRef = useRef<CameraControls>(null);
  const noise3DRef = useRef(createNoise3D());
  const driftTimeRef = useRef(0);
  const isUserOrbitingRef = useRef(false);
  const reframeDistanceRef = useRef(1);
  const initialSetDone = useRef(false);

  // Memos
  const resolved = useMemo(
    () => resolvePreset(preset, { position, target, fov }),
    [preset, position, target, fov],
  );

  // Read camera from R3F
  const { camera } = useThree();

  // Read chatStatus from context
  const { chatStatus } = useKhavee();

  // ── useEffect: Orbit Mode Configuration ─────────────────────────────────

  useEffect(() => {
    if (!controlsRef.current) return;
    const c = controlsRef.current;
    const ranges = CONSTRAINED_RANGES[preset];

    if (orbit === "locked") {
      // Disable all input
      c.mouseButtons.left = 0;
      c.mouseButtons.wheel = 0;
      c.mouseButtons.right = 0;
      c.touches.one = 0;
      c.touches.two = 0;
      c.touches.three = 0;
    } else if (orbit === "constrained") {
      // Enable rotate+dolly, apply clamped ranges
      c.mouseButtons.left = 1; // Rotate
      c.mouseButtons.wheel = 16; // Dolly
      c.mouseButtons.right = 0;
      // Touch: drei's CameraControls sets sensible defaults for touches,
      // so we leave them as-is (don't override)

      c.minPolarAngle = ranges.minPolar;
      c.maxPolarAngle = ranges.maxPolar;
      c.minAzimuthAngle = ranges.minAzimuth;
      c.maxAzimuthAngle = ranges.maxAzimuth;
      c.minDistance = ranges.minDist;
      c.maxDistance = ranges.maxDist;
    } else {
      // "free" — reset to unconstrained defaults
      c.mouseButtons.left = 1;
      c.mouseButtons.wheel = 16;
      c.mouseButtons.right = 2; // Truck
      // Touch: drei's CameraControls sets sensible defaults for touches,
      // so we leave them as-is (don't override)

      c.minPolarAngle = 0;
      c.maxPolarAngle = Math.PI;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      c.minDistance = 0;
      c.maxDistance = Infinity;
    }
  }, [orbit, preset]);

  // ── useEffect: Preset Transition ────────────────────────────────────────

  useEffect(() => {
    if (!controlsRef.current) return;

    // No transition on mount (guard against jarring initial camera jump)
    if (!initialSetDone.current) {
      controlsRef.current.setLookAt(
        resolved.position[0],
        resolved.position[1],
        resolved.position[2],
        resolved.target[0],
        resolved.target[1],
        resolved.target[2],
        false, // no transition on mount
      );
      initialSetDone.current = true;
    } else {
      // Smooth eased transition on preset change
      controlsRef.current.setLookAt(
        resolved.position[0],
        resolved.position[1],
        resolved.position[2],
        resolved.target[0],
        resolved.target[1],
        resolved.target[2],
        true, // enableTransition
      );
    }
  }, [resolved]);

  // ── useEffect: FOV ──────────────────────────────────────────────────────

  useEffect(() => {
    (camera as THREE.PerspectiveCamera).fov = resolved.fov;
    camera.updateProjectionMatrix();
  }, [camera, resolved.fov]);

  // ── CameraControls Event Callbacks ──────────────────────────────────────

  useEffect(() => {
    if (!controlsRef.current) return;
    const c = controlsRef.current;

    const handleControlStart = () => {
      isUserOrbitingRef.current = true;
    };
    const handleControlEnd = () => {
      isUserOrbitingRef.current = false;
    };

    c.addEventListener("controlstart", handleControlStart);
    c.addEventListener("controlend", handleControlEnd);

    return () => {
      c.removeEventListener("controlstart", handleControlStart);
      c.removeEventListener("controlend", handleControlEnd);
    };
  }, []);

  // ── useFrame (Priority 1 — Post-CameraControls Update) ─────────────────

  useFrame((state, delta) => {
    if (!controlsRef.current) return;

    // Skip drift and reframe during active user orbit
    if (isUserOrbitingRef.current) return;

    // 1. Drift (if enabled)
    if (drift) {
      driftTimeRef.current += delta;
      const t = driftTimeRef.current * DRIFT_FREQUENCY;
      const noise3D = noise3DRef.current;

      // Position deltas (3 independent streams via offset in noise space)
      const dx = noise3D(t, 0, 0) * DRIFT_POSITION_AMPLITUDE;
      const dy = noise3D(t, 100, 0) * DRIFT_POSITION_AMPLITUDE;
      const dz = noise3D(t, 200, 0) * DRIFT_POSITION_AMPLITUDE;

      // Target deltas
      const dtx = noise3D(t, 300, 0) * DRIFT_TARGET_AMPLITUDE;
      const dty = noise3D(t, 400, 0) * DRIFT_TARGET_AMPLITUDE;
      const dtz = noise3D(t, 500, 0) * DRIFT_TARGET_AMPLITUDE;

      // Apply drift to camera position
      camera.position.add(_scratchPos.set(dx, dy, dz));

      // Apply drift to target and update camera lookAt
      controlsRef.current.getTarget(_scratchTarget);
      _scratchTarget.add(_scratchDir.set(dtx, dty, dtz));
      camera.lookAt(_scratchTarget);
    }

    // 2. Reframe (if enabled)
    if (reframe) {
      const targetMult =
        chatStatus === "speaking" ? REFRAME_SPEAKING_MULTIPLIER : 1.0;

      // Smooth lerp toward target multiplier
      reframeDistanceRef.current = THREE.MathUtils.lerp(
        reframeDistanceRef.current,
        targetMult,
        1 - Math.exp(-delta * REFRAME_LERP_SPEED),
      );

      // Apply dolly delta if meaningfully different from 1
      if (Math.abs(reframeDistanceRef.current - 1) > 0.001) {
        const currentDistance = controlsRef.current.distance;
        const baseDistance = Math.sqrt(
          Math.pow(resolved.position[0] - resolved.target[0], 2) +
            Math.pow(resolved.position[1] - resolved.target[1], 2) +
            Math.pow(resolved.position[2] - resolved.target[2], 2),
        );
        const desiredDistance = baseDistance * reframeDistanceRef.current;
        controlsRef.current.dolly(currentDistance - desiredDistance, false);
      }
    }
  }, 1); // Priority 1 — run after CameraControls' default-priority update

  return <CameraControls ref={controlsRef} makeDefault />;
}
