"use client";
import { useAnimations as useDreiAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useKhavee } from "./KhaveeProvider";
import { useAnimationController } from "./animation/AnimationStateEngine";
import type { AvatarFormatAdapter } from "./animation/types";
import {
  applyMeshRenderFlags,
  applyRendererDefaults,
  AvatarLightRig,
  resolveAnisotropy,
} from "./utils/renderQuality";

interface GLBAvatarProps {
  src: string; // URL or path to the GLB/GLTF model
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  autoPlayAnimation?: string | number; // Animation name or index to auto-play
  /** Force `castShadow` on every avatar mesh at load time. Default: true */
  castShadow?: boolean;
  /** Force `receiveShadow` on every avatar mesh at load time. Default: true */
  receiveShadow?: boolean;
  /** Texture anisotropy for material maps, clamped to hardware max. Default: 8 (resolved) */
  anisotropy?: number;
  /** Renderer tone mapping mode, applied Canvas-wide on mount. Default: THREE.ACESFilmicToneMapping */
  toneMapping?: THREE.ToneMapping;
  /** Mount a scoped ambient+directional light rig inside the avatar group. Default: true */
  autoLighting?: boolean;
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
 * @param castShadow - Force castShadow on every avatar mesh. Default: true
 * @param receiveShadow - Force receiveShadow on every avatar mesh. Default: true
 * @param anisotropy - Texture anisotropy for material maps. Default: resolved against hardware max (8)
 * @param toneMapping - Renderer tone mapping mode (Canvas-global). Default: THREE.ACESFilmicToneMapping
 * @param autoLighting - Mount a scoped ambient+directional light rig. Default: true
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
  castShadow = true,
  receiveShadow = true,
  anisotropy,
  toneMapping,
  autoLighting = true,
  ...props
}: GLBAvatarProps) {
  const { currentAnimation, chatStatus, setAvailableAnimations, currentVolume, gestureHint, setGestureHint } =
    useKhavee();
  // D-04: read the R3F active scene camera once per render (NOT inside
  // useFrame) — see the matching comment in VRMAvatar.tsx. Kept symmetric
  // across both avatar components so gaze/gesture behave identically
  // (GAZE-02).
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const groupRef = useRef<THREE.Group>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);

  // Load GLB model
  const gltf = useGLTF(src) as any;
  const { mixer, actions, names } = useDreiAnimations(gltf.animations, groupRef);

  // Force renderer defaults (tone mapping + output color space) once on
  // mount. NOTE: this mutates the Canvas-shared `gl` (WebGLRenderer)
  // instance, not just this avatar — see the detailed explanation in
  // utils/renderQuality.tsx (applyRendererDefaults).
  useEffect(() => {
    applyRendererDefaults(gl, {
      toneMapping: toneMapping ?? THREE.ACESFilmicToneMapping,
      colorSpace: THREE.SRGBColorSpace,
    });
  }, [gl, toneMapping]);

  // Force shadow-casting/receiving + material map anisotropy on every mesh
  // once the GLB scene is available — today no avatar mesh sets these
  // anywhere, so a consuming page's <Canvas shadows> is otherwise a dead
  // no-op.
  useEffect(() => {
    if (!gltf.scene) return;
    applyMeshRenderFlags(gltf.scene, {
      castShadow,
      receiveShadow,
      anisotropy: resolveAnisotropy(gl, anisotropy),
    });
  }, [gltf.scene, gl, castShadow, receiveShadow, anisotropy]);

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

  // Shared animation module (ANIM-01): drives chatStatus-triggered eased,
  // pose-gap-adaptive crossfading (replacing the old fixed-duration 0.3s
  // linear fade effect and the live-clock-driven talking-animation loop-back
  // this component used to own) on drei's REAL mixer — NOT a second,
  // independently-created one (RESEARCH Pitfall 2: setEffectiveWeight is a
  // silent no-op against a mixer with no registered actions). Talk-clip
  // cycling returns, loop-boundary-driven and timer-free, in Phase 11
  // (TALK-01) — this phase only removes the timer.
  const glbAdapter: AvatarFormatAdapter = {
    getMixer: () => mixer,
    getBoneNode: (name) => groupRef.current?.getObjectByName(name) ?? null,
    // happy.glb's literal node names already match VRM humanoid role strings
    // directly (chest/spine/hips/neck/head), so a literal lookup is correct
    // here specifically — this is a property of that bundled asset, not a
    // general GLB guarantee.
    getHumanoidBoneNode: (role) => groupRef.current?.getObjectByName(role) ?? null,
    getExpressionManager: () => null, // GLB has no expression/blendshape system.
  };

  // Memoized so identity is stable across unrelated re-renders (defense-in-
  // depth for TRANS-01/TALK-01 — see the matching comment in VRMAvatar.tsx).
  // groupRef is a stable ref, so getRoot needs no deps.
  const getAction = useCallback((name: string) => actions[name] ?? null, [actions]);
  const getRoot = useCallback(() => groupRef.current, []);

  const controller = useAnimationController({
    adapter: glbAdapter,
    chatStatus,
    currentAnimation,
    availableNames: names,
    getAction,
    getRoot,
    enableBlinking: true, // harmless no-op on GLB — adapter's expression manager is always null.
    currentVolume,
    // 11-17 gap closure (OPEN ISSUE 2): disable procedural breathing/sway
    // while a manually-selected non-idle clip is the active base — see
    // `shouldDisableProceduralForManualClip` in AnimationStateEngine.ts.
    // VRMAvatar.tsx intentionally omits this param.
    dampProceduralOnManualClip: true,
    camera,
    gestureHint,
    onGestureConsumed: () => setGestureHint(null),
  });

  // drei's useAnimations already runs mixer.update(delta) internally via its
  // own earlier-registered useFrame, so the controller's crossfade ramp/
  // blink step below runs after it — no manual mixer.update(delta) here.
  useFrame((_, delta) => {
    controller.update(delta);
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale} {...props}>
      {autoLighting && <AvatarLightRig />}
      <primitive object={gltf.scene} />
    </group>
  );
}
