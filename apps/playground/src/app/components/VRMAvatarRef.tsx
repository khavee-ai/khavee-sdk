import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { useAnimations, useFBX, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { lerp } from "three/src/math/MathUtils.js";
import React, { useEffect, useMemo, useRef } from "react";
import { remapMixamoAnimationToVrm } from "../utils/remapMixamoAnimationToVrm";
import * as THREE from "three";

interface VRMAvatarProps {
  avatar: string; // URL or path to the VRM model
  [key: string]: any; // Other props
}

export default function VRMAvatar({ avatar, ...props }: VRMAvatarProps) {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const expressionTargetsRef = useRef<Record<string, number>>({});

  const { scene, userData } = useGLTF(
    `models/${avatar}`,
    undefined,
    undefined,
    (loader) => {
      // @ts-ignore - VRM loader type compatibility issue
      loader.register((parser: any) => {
        return new VRMLoaderPlugin(parser);
      });
    }
  );

  // const assetA = useFBX("models/animations/talking.fbx");
  // const assetB = useFBX("models/animations/Thriller Part 2.fbx");
  // const assetC = useFBX("models/animations/Breathing Idle.fbx");
  // const assetD = useFBX("models/animations/Fist Fight B.fbx");

  const currentVrm = userData.vrm;

  // const animationClipA = useMemo(() => {
  //   const clip = remapMixamoAnimationToVrm(currentVrm, assetA);
  //   clip.name = "Swing Dancing";
  //   return clip;
  // }, [assetA, currentVrm]);

  // const animationClipB = useMemo(() => {
  //   const clip = remapMixamoAnimationToVrm(currentVrm, assetB);
  //   clip.name = "Thriller Part 2";
  //   return clip;
  // }, [assetB, currentVrm]);

  // const animationClipC = useMemo(() => {
  //   const clip = remapMixamoAnimationToVrm(currentVrm, assetC);
  //   clip.name = "Idle";
  //   return clip;
  // }, [assetC, currentVrm]);

  // const animationClipD = useMemo(() => {
  //   const clip = remapMixamoAnimationToVrm(currentVrm, assetD);
  //   clip.name = "Fist Fight B";
  //   return clip;
  // }, [assetD, currentVrm]);

  // const { actions } = useAnimations(
  //   [animationClipA, animationClipB, animationClipC, animationClipD],
  //   currentVrm.scene
  // );

  // // Initialize animation mixer and maintain animation state
  // useEffect(() => {
  //   if (currentVrm?.scene) {
  //     mixerRef.current = new THREE.AnimationMixer(currentVrm.scene);

  //     // Add clips to mixer
  //     [animationClipA, animationClipB, animationClipC, animationClipD].forEach(
  //       (clip) => {
  //         if (clip) {
  //           mixerRef.current?.clipAction(clip);
  //         }
  //       }
  //     );
  //   }

  //   return () => {
  //     if (mixerRef.current) {
  //       mixerRef.current.stopAllAction();
  //       mixerRef.current = null;
  //     }
  //   };
  // }, [
  //   currentVrm,
  //   animationClipA,
  //   animationClipB,
  //   animationClipC,
  //   animationClipD,
  // ]);

  useEffect(() => {
    const vrm = userData.vrm;
    // calling these functions greatly improves the performance
    VRMUtils.removeUnnecessaryVertices(scene);
    VRMUtils.combineSkeletons(scene);
    VRMUtils.combineMorphs(vrm);

    // Disable frustum culling
    vrm.scene.traverse((obj: { frustumCulled: boolean }) => {
      obj.frustumCulled = false;
    });
  }, [scene]);

  const {
    aa,
    ih,
    ee,
    oh,
    ou,
    blinkLeft,
    blinkRight,
    angry,
    sad,
    happy,
    animation,
  } = useControls("VRM", {
    aa: { value: 0, min: 0, max: 1 },
    ih: { value: 0, min: 0, max: 1 },
    ee: { value: 0, min: 0, max: 1 },
    oh: { value: 0, min: 0, max: 1 },
    ou: { value: 0, min: 0, max: 1 },
    blinkLeft: { value: 0, min: 0, max: 1 },
    blinkRight: { value: 0, min: 0, max: 1 },
    angry: { value: 0, min: 0, max: 1 },
    sad: { value: 0, min: 0, max: 1 },
    happy: { value: 0, min: 0, max: 1 },
    animation: {
      options: [
        "None",
        "Idle",
        "Swing Dancing",
        "Thriller Part 2",
        "Fist Fight B",
      ],
      value: "Idle",
    },
  });

  // Handle animation switching with proper crossfading
  // useEffect(() => {
  //   if (!mixerRef.current || animation === "None") {
  //     // Stop current animation
  //     if (currentActionRef.current) {
  //       currentActionRef.current.fadeOut(0.3);
  //       currentActionRef.current = null;
  //     }
  //     return;
  //   }

  //   const targetClip = [
  //     animationClipA,
  //     animationClipB,
  //     animationClipC,
  //     animationClipD,
  //   ].find((clip) => clip?.name === animation);

  //   if (targetClip && mixerRef.current) {
  //     const newAction = mixerRef.current.clipAction(targetClip);

  //     // Crossfade from current to new animation
  //     if (currentActionRef.current && currentActionRef.current !== newAction) {
  //       // Fade out current animation
  //       currentActionRef.current.fadeOut(0.3);
  //       // Fade in new animation
  //       newAction.reset().fadeIn(0.3).play();
  //     } else if (!currentActionRef.current) {
  //       // Start new animation without fade
  //       newAction.reset().play();
  //     }

  //     currentActionRef.current = newAction;
  //   }
  // }, [
  //   animation,
  //   animationClipA,
  //   animationClipB,
  //   animationClipC,
  //   animationClipD,
  // ]);

  // Smooth expression interpolation function
  const lerpExpression = (name: string, value: number, lerpFactor: number) => {
    if (!userData.vrm?.expressionManager) return;

    const currentValue = userData.vrm.expressionManager.getValue(name) || 0;
    const targetValue = lerp(currentValue, value, lerpFactor);

    // Store target for reference
    expressionTargetsRef.current[name] = value;

    // Apply expression without disrupting animations
    userData.vrm.expressionManager.setValue(name, targetValue);
  };

  useFrame((_, delta) => {
    if (!userData.vrm) {
      return;
    }

    // Update animation mixer first (if exists)
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // Update expressions with smooth interpolation
    // These expressions don't interfere with bone animations
    userData.vrm.expressionManager.setValue("angry", angry);
    userData.vrm.expressionManager.setValue("sad", sad);
    userData.vrm.expressionManager.setValue("happy", happy);

    // Smooth lip-sync and blink expressions with higher lerp rate for responsiveness
    const expressionLerpRate = 15; // Increased for better lip-sync responsiveness

    [
      { name: "aa", value: aa },
      { name: "ih", value: ih },
      { name: "ee", value: ee },
      { name: "oh", value: oh },
      { name: "ou", value: ou },
      { name: "blinkLeft", value: blinkLeft },
      { name: "blinkRight", value: blinkRight },
    ].forEach((item) => {
      lerpExpression(item.name, item.value, delta * expressionLerpRate);
    });

    // Update VRM after all changes (expressions + animations)
    userData.vrm.update(delta);
  });

  return (
    <group {...props}>
      <primitive object={scene} rotation-y={Math.PI} />
    </group>
  );
}
