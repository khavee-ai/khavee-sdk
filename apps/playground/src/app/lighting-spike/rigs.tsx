"use client";
/**
 * rigs — SPIKE 005 (lighting-contrast-rebaseline). THROWAWAY.
 *
 * Three light rigs held side by side so contrast/saturation can be measured
 * under each. The point of the spike: every number in spikes 001-003 — including
 * the 0.3041 ACESFilmic contrast figure CONTEXT D-11 sets as Phase 16's gate —
 * was measured under `legacy`. Phase 16 replaces that rig, so the gate has to be
 * re-derived under the rig we actually intend to ship.
 */
import * as THREE from "three";

export type RigId = "legacy" | "sdk-current" | "three-point";

export const RIGS: { id: RigId; label: string; note: string }[] = [
  { id: "legacy", label: "legacy (production)", note: "what khavee-app hand-rolls today; spikes 001-003 measured under this" },
  { id: "sdk-current", label: "sdk current", note: "AvatarLightRig as shipped — tuned shadows, still 2 lights" },
  { id: "three-point", label: "three-point + rim", note: "Phase 16 prototype: key + cool fill + rim/back" },
];

/**
 * Exactly what `khavee-app`'s PreviewModel.tsx mounts today: one ambient whose
 * intensity is a customer-facing setting, and one directional with NO shadow
 * tuning whatsoever. Reproduced verbatim rather than approximated — it is the
 * baseline the old numbers came from, so any drift here invalidates the
 * comparison.
 */
function LegacyRig() {
  return (
    <>
      {/* 0.7, not 0.6 — verified against mtoon-spike/page.tsx, which is what
          spike 003 actually measured under and which states it is identical to
          khavee-app's PreviewModel.tsx. Guessing this wrong silently invalidates
          every comparison against the 003 numbers. */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 10, 5]} castShadow />
    </>
  );
}

/** Mirrors the shipped `AvatarLightRig` (see packages/react/src/utils/renderQuality.tsx). */
function SdkCurrentRig() {
  return (
    <>
      <ambientLight intensity={0.6} />
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
        shadow-radius={4}
        shadow-intensity={0.6}
      />
    </>
  );
}

export interface ThreePointParams {
  ambient: number;
  key: number;
  fill: number;
  rim: number;
  rimColor: string;
}

export const DEFAULT_THREE_POINT: ThreePointParams = {
  // Lower than legacy's 0.6 on purpose: ambient is flat fill light, and the
  // whole point of a rig is that shape comes from directional contrast. Phase
  // 15 traded contrast away expecting lighting to give it back, and ambient is
  // what eats contrast.
  ambient: 0.32,
  key: 1.35,
  fill: 0.45,
  rim: 1.6,
  // Cool rim against a warm key is the standard film/anime pairing — it reads
  // as separation rather than as "the character got brighter".
  rimColor: "#bcd4ff",
};

function ThreePointRig({ p }: { p: ThreePointParams }) {
  return (
    <>
      <ambientLight intensity={p.ambient} />
      {/* KEY — front-left, slightly above. Carries the shadow, so it inherits
          the shipped rig's shadow tuning verbatim; those values exist because
          three.js's defaults produce shadow acne on folded cloth. */}
      <directionalLight
        castShadow
        position={[2, 4, 3]}
        intensity={p.key}
        color="#fff4e6"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.1}
        shadow-camera-far={10}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
        shadow-normalBias={0.02}
        shadow-radius={4}
        shadow-intensity={0.6}
      />
      {/* FILL — opposite side, cool, no shadow. Lifts the shadow side without
          flattening it; a second shadow-caster would fight the key. */}
      <directionalLight position={[-3, 1.5, 2]} intensity={p.fill} color="#cfe0ff" />
      {/* RIM / BACK — behind and above, aimed at the camera side. This is the
          signature of premium anime rendering and the thing the current rig has
          no equivalent of. */}
      <directionalLight position={[-1.5, 3, -4]} intensity={p.rim} color={p.rimColor} />
    </>
  );
}

export function Rig({ id, params }: { id: RigId; params: ThreePointParams }) {
  if (id === "legacy") return <LegacyRig />;
  if (id === "sdk-current") return <SdkCurrentRig />;
  return <ThreePointRig p={params} />;
}

export const TONE_CURVES: { id: string; label: string; value: THREE.ToneMapping }[] = [
  { id: "aces", label: "ACESFilmic (pre-15)", value: THREE.ACESFilmicToneMapping },
  { id: "cineon", label: "Cineon (Phase 15)", value: THREE.CineonToneMapping },
];
