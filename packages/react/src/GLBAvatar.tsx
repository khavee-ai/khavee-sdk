"use client";
import { useAnimations as useDreiAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useKhavee } from "./KhaveeProvider";

interface GLBAvatarProps {
  src: string; // URL or path to the GLB/GLTF model
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  autoPlayAnimation?: string | number; // Animation name or index to auto-play
}

/**
 * GLBAvatar - Render a GLB/GLTF model with embedded animations
 *
 * This component handles GLB models that contain both the 3D model and animations
 * in a single file. Perfect for models exported from Blender, Unity, or other
 * 3D software with animations already embedded.
 *
 * **IMPORTANT:** Must be used inside a React Three Fiber `<Canvas>` component
 * and within a `<KhaveeProvider>`.
 *
 * @param src - URL or path to the GLB/GLTF model file (.glb or .gltf)
 * @param position - Position in 3D space [x, y, z]. Default: [0, 0, 0]
 * @param rotation - Rotation in radians [x, y, z]. Default: [0, 0, 0]
 * @param scale - Scale [x, y, z]. Default: [1, 1, 1]
 * @param autoPlayAnimation - Animation name or index to auto-play. Default: first animation (0)
 *
 * @example
 * // Basic usage
 * ```tsx
 * import { KhaveeProvider, GLBAvatar } from '@khaveeai/react';
 * import { Canvas } from '@react-three/fiber';
 *
 * function App() {
 *   return (
 *     <KhaveeProvider>
 *       <Canvas>
 *         <GLBAvatar src="/models/character.glb" />
 *       </Canvas>
 *     </KhaveeProvider>
 *   );
 * }
 * ```
 *
 * @example
 * // With specific animation
 * ```tsx
 * <GLBAvatar 
 *   src="/models/dragon.glb"
 *   autoPlayAnimation="flying"  // or use index: 0, 1, 2
 *   position={[0, -1, 0]}
 *   scale={[1.5, 1.5, 1.5]}
 * />
 * ```
 *
 * @example
 * // Control animations from outside
 * ```tsx
 * import { useVRMAnimations } from '@khaveeai/react';
 *
 * function Controls() {
 *   const { animate } = useVRMAnimations();
 *
 *   return (
 *     <button onClick={() => animate('walk')}>
 *       Walk!
 *     </button>
 *   );
 * }
 *
 * function App() {
 *   return (
 *     <KhaveeProvider>
 *       <Canvas>
 *         <GLBAvatar src="/models/character.glb" />
 *       </Canvas>
 *       <Controls />
 *     </KhaveeProvider>
 *   );
 * }
 * ```
 */
export function GLBAvatar({
  src,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  autoPlayAnimation = 0,
  ...props
}: GLBAvatarProps) {
  const { currentAnimation, animate: contextAnimate, chatStatus, setAvailableAnimations } = useKhavee();
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  
  // Talking animation system
  const animationTimeout = useRef<NodeJS.Timeout | null>(null);
  const availableTalkingAnimations = useRef<string[]>([]);
  const lastTalkingAnimationIndex = useRef(0);

  // Load GLB model
  const gltf = useGLTF(src) as any;
  const { actions, names } = useDreiAnimations(gltf.animations, groupRef);

  // Store available animations in context
  useEffect(() => {
    if (names && names.length > 0) {
      console.log('[GLB Avatar] Available animations:', names);
      setAvailableAnimations(names);
    }
  }, [names, setAvailableAnimations]);

  // Auto-play animation on load
  useEffect(() => {
    if (!actions || Object.keys(actions).length === 0) return;

    let animationToPlay: string | null = null;

    if (typeof autoPlayAnimation === 'string') {
      animationToPlay = autoPlayAnimation;
    } else if (typeof autoPlayAnimation === 'number' && names[autoPlayAnimation]) {
      animationToPlay = names[autoPlayAnimation];
    } else if (names[0]) {
      animationToPlay = names[0];
    }

    if (animationToPlay && actions[animationToPlay]) {
      console.log('[GLB Avatar] Auto-playing animation:', animationToPlay);
      actions[animationToPlay]?.reset().play();
      currentActionRef.current = actions[animationToPlay] || null;
    }
  }, [actions, names, autoPlayAnimation]);

  // Handle animation switching from context
  useEffect(() => {
    if (!actions || !currentAnimation) {
      // Stop current animation if any
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.3);
        currentActionRef.current = null;
      }
      return;
    }

    const targetAction = actions[currentAnimation];

    if (targetAction && targetAction !== currentActionRef.current) {
      // Fade out current
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.3);
      }
      
      // Fade in new
      targetAction.reset().fadeIn(0.3).play();
      currentActionRef.current = targetAction;
      
      console.log('[GLB Avatar] Switched to animation:', currentAnimation);
    }
  }, [currentAnimation, actions]);

  // Talking animation system
  useEffect(() => {
    if (!names || names.length === 0) return;

    // Collect talking animations
    const talkingAnimNames = names.filter(name =>
      name.toLowerCase().includes('talk') || 
      name.toLowerCase().includes('gesture') || 
      name.toLowerCase().includes('speak')
    );

    availableTalkingAnimations.current = talkingAnimNames;

    if (chatStatus === 'speaking' && talkingAnimNames.length > 0) {
      const isCurrentlyIdle = !currentAnimation || currentAnimation === names[0];

      if (isCurrentlyIdle && !animationTimeout.current) {
        const nextTalkIndex = (lastTalkingAnimationIndex.current + 1) % talkingAnimNames.length;
        contextAnimate(talkingAnimNames[nextTalkIndex]);
        lastTalkingAnimationIndex.current = nextTalkIndex;

        // Schedule next animation
        animationTimeout.current = setTimeout(() => {
          animationTimeout.current = null;
          if (chatStatus === 'speaking') {
            contextAnimate(names[0]); // Back to first animation
          }
        }, 3000 + Math.random() * 2000);
      }
    } else if (chatStatus !== 'speaking' && animationTimeout.current) {
      clearTimeout(animationTimeout.current);
      animationTimeout.current = null;
      
      // Return to first animation
      if (names[0]) {
        contextAnimate(names[0]);
      }
    }
  }, [chatStatus, names, currentAnimation, contextAnimate]);

  // Update mixer
  useFrame((_, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
  });

  // Initialize mixer
  useEffect(() => {
    if (groupRef.current && gltf.animations && gltf.animations.length > 0) {
      mixerRef.current = new THREE.AnimationMixer(groupRef.current);
      
      return () => {
        if (mixerRef.current) {
          mixerRef.current.stopAllAction();
          mixerRef.current = null;
        }
      };
    }
  }, [gltf]);

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale} {...props}>
      <primitive object={gltf.scene} />
    </group>
  );
}
