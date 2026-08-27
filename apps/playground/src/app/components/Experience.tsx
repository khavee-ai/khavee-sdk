"use client";
import { CameraControls, Environment, Gltf } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useControls } from "leva";
import { useRef } from "react";
import VRMAvatar from "./VRMAvatarRef";

export const Experience = () => {
  const controls = useRef(null);

  const { avatar } = useControls("VRM", {
    avatar: {
      value: "amongus.vrm",
      options: [
        "happy.glb",
        "amongus.vrm",
        "blacknwhitecat.vrm",
        "male.vrm",
        "3636451243928341470.vrm",
        "8087383217573817818.vrm",
        "dragon.glb",
        "pla.glb",
      ],
    },
  });

  return (
    <>
      <CameraControls
        ref={controls}
        maxPolarAngle={Math.PI / 2}
        minDistance={1}
        maxDistance={10}
      />
      <Environment preset="sunset" />
      <directionalLight intensity={2} position={[10, 10, 5]} />
      <directionalLight intensity={1} position={[-10, 10, 5]} />
      <group position-y={-1.25}>
        <VRMAvatar avatar={avatar} position={[0, 0, 0]} />
        {/* <Gltf
          src="models/sound-stage-final.glb"
          position-z={-1.4}
          position-x={-0.5}
          scale={0.65}
        /> */}
      </group>
      <EffectComposer>
        <Bloom mipmapBlur intensity={0.7} />
      </EffectComposer>
    </>
  );
};
