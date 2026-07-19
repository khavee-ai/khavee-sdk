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
 */
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

export default function VRMAvatarTestPage() {
  return (
    <KhaveeProvider>
      <div style={{ width: "100%", height: "100vh", position: "relative", background: "#3353FF" }}>
        <AnimationButtons />
        <Canvas camera={{ position: [0, 1.5, 3], fov: 50 }} shadows>
          {/* No manual lights — VRMAvatar's autoLighting (default true)
              mounts its own AvatarLightRig (renderQuality.tsx). */}
          <VRMAvatar src="/models/male.vrm" animations={VRM_TEST_ANIMATIONS} enableBlinking />
          <OrbitControls target={[0, 1, 0]} />
        </Canvas>
      </div>
    </KhaveeProvider>
  );
}
