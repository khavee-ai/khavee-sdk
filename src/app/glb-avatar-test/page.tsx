"use client";
/**
 * glb-avatar-test — manual-verification surface for the migrated GLBAvatar
 * (Phase 10 Plan 03, ANIM-01/ANIM-02/XFADE-01).
 *
 * Mounts the SDK's GLBAvatar against happy.glb (the same fixture the
 * wayfinder/5-crossfade-prototype validated against — D-03) so a human can
 * trigger transitions between distinct poses and watch the eased,
 * pose-gap-adaptive crossfade the shared animation module now drives,
 * instead of the old fixed-duration linear fade / timer-based loop-back.
 *
 * Dev/test page only — not shipped SDK surface. Mirrors src/app/glb/page.tsx's
 * Canvas/OrbitControls/button styling for consistency.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { KhaveeProvider, GLBAvatar, useAnimations } from "@khaveeai/react";

// happy.glb's REAL embedded clip names (verified by parsing the GLB directly —
// NOT the "Idle"/"Taking"/"listening" shorthand used in discussion).
const HAPPY_GLB_CLIPS = [
  "State 1 Idle (loop)",
  "State 2 present (loop)",
  "State 3 Welcome (loop)",
  "State 4 Taking (loop)",
  "State 5 listening (loop)",
] as const;

function AnimationButtons() {
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
      {HAPPY_GLB_CLIPS.map((name) => (
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

export default function GLBAvatarTestPage() {
  return (
    <KhaveeProvider>
      <div style={{ width: "100%", height: "100vh", position: "relative", background: "#3353FF" }}>
        <AnimationButtons />
        <Canvas camera={{ position: [0, 1, 3], fov: 50 }} shadows>
          {/* No manual lights — GLBAvatar's autoLighting (default true)
              mounts its own AvatarLightRig (renderQuality.tsx). */}
          <GLBAvatar src="/models/happy.glb" />
          <OrbitControls target={[0, 1, 0]} />
        </Canvas>
      </div>
    </KhaveeProvider>
  );
}
