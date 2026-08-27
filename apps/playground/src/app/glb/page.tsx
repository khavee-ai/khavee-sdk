"use client";
import { OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";

type ModelProps = {
  currentAnimation: string | null;
};

function Model({ currentAnimation }: ModelProps) {
  const group = useRef(null);
  const gltf = useGLTF("./models/happy.glb");
  const { actions, names } = useAnimations(gltf.animations, group);

  useEffect(() => {
    if (currentAnimation && actions[currentAnimation]) {
      // Stop all actions then play selected
      Object.values(actions).forEach((a) => a?.stop());
      actions[currentAnimation]?.reset().play();
    }
  }, [currentAnimation, actions]);

  return <primitive object={gltf.scene} ref={group} />;
}

function AnimationButtons({
  names,
  current,
  onSelect,
}: {
  names: string[];
  current: string | null;
  onSelect: (name: string) => void;
}) {
  const gltf = useGLTF("./models/happy.glb");
  const allNames = gltf.animations.map((a) => a.name);

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
        {allNames.map((name) => (
          <button
            key={name}
            onClick={() => onSelect(name)}
            style={{
              padding: "6px 14px",
              background: current === name ? "#6366f1" : "#1e1e2e",
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

export default function GLBTest() {
  const [currentAnimation, setCurrentAnimation] = useState<string | null>(null);
  const gltf = useGLTF("./models/happy.glb");
  const animationNames = gltf.animations.map((a) => a.name);

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative", background: "#3353FF" }}>
      <AnimationButtons
        names={animationNames}
        current={currentAnimation}
        onSelect={setCurrentAnimation}
      />
      <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
        <ambientLight intensity={1} />
        <directionalLight position={[10, 10, 5]} intensity={2.5} />
        <Model currentAnimation={currentAnimation} />
        <OrbitControls />
      </Canvas>
    </div>
  );
}
