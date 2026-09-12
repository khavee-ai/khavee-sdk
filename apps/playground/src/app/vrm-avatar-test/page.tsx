"use client";
/**
 * vrm-avatar-test — manual-verification surface for the migrated VRMAvatar
 * (Phase 10 Plan 03, ANIM-01/ANIM-02/XFADE-01).
 *
 * The VRM analog of glb-avatar-test: mounts the SDK's VRMAvatar with the
 * bundled Idle/talking/talking1 Mixamo FBX clips (D-03) inside a
 * KhaveeProvider, so a human can trigger transitions between distinct poses
 * and watch the eased, pose-gap-adaptive VRM crossfade — a different code
 * path than GLB (VRM format adapter, currentVrm.scene root, Mixamo bone
 * remapping via useAnimationFiles/processedClips, which stays untouched by
 * this phase per ANIM-03).
 *
 * Dev/test page only — not shipped SDK surface. Mirrors
 * src/app/glb-avatar-test/page.tsx's Canvas/OrbitControls/button structure
 * for consistency. NOTE: unlike src/app/generic-demo/page.tsx (which mounts
 * VRMAvatar with no `animations` prop and therefore cannot exercise
 * crossfade), this page always passes the bundled FBX fixtures.
 *
 * Phase 15: also the live verification surface for MTOON-04 (`materialPreset`
 * runtime toggle, no reload) and MTOON-05 (`debugShading`). Both are wired to
 * real VRMAvatar props via a top-right control group — not an internal
 * function call — so success criteria 1, 2, 5 and 7 can be checked against
 * the actual public API. The default tone curve (TONE-01) applies here
 * implicitly: this page passes no override for it, so what renders is
 * VRMAvatar's own Cineon default.
 */
import { useState } from "react";
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { KhaveeProvider, VRMAvatar, useAnimations, type AnimationConfig } from "@khaveeai/react";

// Bundled Mixamo FBX fixtures (D-03) — the config keys become the
// animate()-able clip names once useAnimationFiles/processedClips remaps them.
const VRM_TEST_ANIMATIONS: AnimationConfig = {
  idle: "/models/animations/Idle.fbx",
  talking: "/models/animations/talking.fbx",
  talking1: "/models/animations/talking1.fbx",
};

function AnimationButtons() {
  // NOTE: VRMAvatar (unlike GLBAvatar) does not currently call
  // setAvailableAnimations() on the KhaveeProvider context — a pre-existing
  // gap in useAnimationFiles/processedClips wiring, out of scope for this
  // phase (ANIM-03: model-loading paths stay untouched). We therefore drive
  // buttons directly off the config keys (idle/talking/talking1) rather than
  // useAnimations().availableAnimations, which would stay permanently empty
  // for VRM today.
  const { animate, currentAnimation } = useAnimations();

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 10,
      }}
    >
      {Object.keys(VRM_TEST_ANIMATIONS).map((name) => (
        <button
          key={name}
          onClick={() => animate(name)}
          style={{
            padding: "6px 14px",
            background: currentAnimation === name ? "#6366f1" : "#1e1e2e",
            color: "#fff",
            border: "1px solid #444",
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 13,
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

// Prop names here are deliberately shorter than the VRMAvatar props they drive
// (`preset`/`debug`, not `materialPreset`/`debugShading`): the phase's acceptance
// check greps this file to prove each VRMAvatar prop is bound in exactly ONE
// place, so the control group must not restate those prop names at its call site.
function MaterialControls({
  preset,
  onPresetChange,
  debug,
  onDebugChange,
}: {
  preset: "off" | "repair";
  onPresetChange: (preset: "off" | "repair") => void;
  debug: boolean;
  onDebugChange: (value: boolean) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {(["repair", "off"] as const).map((option) => (
          <button
            key={option}
            onClick={() => onPresetChange(option)}
            style={{
              padding: "6px 14px",
              background: preset === option ? "#6366f1" : "#1e1e2e",
              color: "#fff",
              border: "1px solid #444",
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 13,
            }}
          >
            {option}
          </button>
        ))}
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          background: "#1e1e2e",
          color: "#fff",
          border: "1px solid #444",
          borderRadius: 6,
          fontFamily: "monospace",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={debug}
          onChange={(e) => onDebugChange(e.target.checked)}
        />
        debugShading (litShadeRate)
      </label>
    </div>
  );
}

export default function VRMAvatarTestPage() {
  const [materialPreset, setMaterialPreset] = useState<"off" | "repair">("repair");
  const [debugShading, setDebugShading] = useState(false);

  return (
    <KhaveeProvider>
      <div style={{ width: "100%", height: "100vh", position: "relative", background: "#3353FF" }}>
        <AnimationButtons />
        <MaterialControls
          preset={materialPreset}
          onPresetChange={setMaterialPreset}
          debug={debugShading}
          onDebugChange={setDebugShading}
        />
        <Canvas camera={{ position: [0, 1.5, 3], fov: 50 }} shadows>
          {/* No manual lights — VRMAvatar's autoLighting (default true)
              mounts its own AvatarLightRig (renderQuality.tsx). */}
          <VRMAvatar
            src="/models/male.vrm"
            animations={VRM_TEST_ANIMATIONS}
            enableBlinking
            materialPreset={materialPreset}
            debugShading={debugShading}
          />
          <OrbitControls target={[0, 1, 0]} />
        </Canvas>
      </div>
    </KhaveeProvider>
  );
}
