import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { useFBX, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { lerp } from "three/src/math/MathUtils.js";
import { useKhavee } from "./KhaveeProvider";
import { remapMixamoAnimationToVrm } from "./utils/remapMixamoAnimationToVrm";

// ── Per-instance VRM loading (bypasses drei's useGLTF global cache) ──
//
// useGLTF caches the PARSED GLTF result (including userData.vrm) in a
// module-global cache keyed by URL (@react-three/fiber's useLoader ->
// suspend-react). Two <VRMAvatar src="same-url"> instances therefore get
// the SAME scene/VRM object back — mounting the same THREE.Object3D via
// <primitive object={scene}> into two React trees reparents it to whichever
// instance mounts second, leaving the first Canvas empty. See
// .planning/quick/260708-16h-vrmavatar-shared-scene-instance-fix/260708-16h-RESEARCH.md
// for full source-verified diagnosis and why scene.clone()/SkeletonUtils.clone
// are insufficient (the VRM object's humanoid/expressionManager/lookAt/
// springBoneManager still reference the ORIGINAL bones).
//
// Fix: fetch each URL's raw GLB ArrayBuffer at most once (module-level
// cache), then run an INDEPENDENT GLTFLoader.parse() per component instance
// with a fresh VRMLoaderPlugin registration. This produces a genuinely
// independent scene+VRM pair per instance with no manual bone re-linking.

/** Module-level cache: fetch each avatar URL's GLB buffer at most once, regardless of how many VRMAvatar instances reference it. */
const glbBufferCache = new Map<string, Promise<ArrayBuffer>>();

function fetchGlbBuffer(url: string): Promise<ArrayBuffer> {
  let cached = glbBufferCache.get(url);
  if (!cached) {
    cached = fetch(url).then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch VRM/GLB: ${url} (${res.status})`);
      }
      return res.arrayBuffer();
    });
    glbBufferCache.set(url, cached);
  }
  return cached;
}

interface VRMParseResult {
  scene: THREE.Group;
  userData: { vrm?: VRM; [key: string]: any };
}

/**
 * useLoadVRM - Parse a VRM/GLB file into an independent scene+VRM pair for this component instance.
 *
 * Unlike drei's `useGLTF`, this does NOT share a module-global cache of the
 * PARSED result across instances/Canvases - each call runs its own
 * `GLTFLoader.parse()` (with `VRMLoaderPlugin` registered), so multiple
 * simultaneous instances referencing the same URL each get their own
 * scene/VRM object instead of stealing it from one another.
 *
 * @param src - URL or path to the .vrm/.glb file
 * @returns `{ scene, userData }` once parsed, or `null` while loading/on error
 */
function useLoadVRM(src: string): VRMParseResult | null {
  const [result, setResult] = useState<VRMParseResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    let localScene: THREE.Group | null = null;
    setResult(null); // reset to loading state when src changes

    fetchGlbBuffer(src)
      .then((buffer) => {
        const loader = new GLTFLoader();
        // @ts-ignore - VRM loader type compatibility issue (same cast used previously)
        loader.register((parser: any) => new VRMLoaderPlugin(parser));
        return loader.parseAsync(buffer, "");
      })
      .then((gltf) => {
        if (cancelled) {
          VRMUtils.deepDispose(gltf.scene);
          return;
        }
        localScene = gltf.scene;
        setResult({ scene: gltf.scene, userData: gltf.userData });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(`[VRMAvatar] Failed to load ${src}:`, error);
        }
      });

    return () => {
      cancelled = true;
      if (localScene) {
        VRMUtils.deepDispose(localScene);
      }
    };
  }, [src]);

  return result;
}

// Define GLTF type locally
interface GLTFResult {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  scenes: THREE.Group[];
  cameras: THREE.Camera[];
  asset: any;
}

interface VRMAvatarProps {
  src: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  animations?: AnimationConfig;
  enableBlinking?: boolean;
}

/**
 * AnimationConfig - Simple animation configuration using URLs
 *
 * Just provide URLs to your animation files (FBX or GLB). The SDK automatically:
 * - Loads FBX or GLB files based on file extension
 * - For FBX files: Remaps Mixamo bone names to VRM bone names
 * - For GLB files: Uses embedded animations directly (with optional Mixamo remapping)
 * - Creates AnimationClips
 * - Auto-plays the "idle" animation if present
 *
 * @example
 * ```tsx
 * const animations: AnimationConfig = {
 *   idle: '/animations/idle.fbx',      // FBX file - Auto-plays on load
 *   walk: '/animations/walk.glb',      // GLB file with embedded animation
 *   dance: '/animations/dance.fbx',
 * };
 *
 * <VRMAvatar src="/model.vrm" animations={animations} />
 * ```
 */
export interface AnimationConfig {
  [name: string]: string; // URL to FBX or GLB file! SDK handles loading & remapping
}

// Internal component to load FBX and GLB animation files
function useAnimationFiles(animationUrls: AnimationConfig | undefined) {
  const entries: Array<
    [string, 'fbx' | 'glb', THREE.Group | GLTFResult]
  > = [];

  if (animationUrls) {
    Object.entries(animationUrls).forEach(([name, url]) => {
      const extension = url.toLowerCase().split('.').pop();

      if (extension === 'fbx') {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const fbxData = useFBX(url);
        entries.push([name, 'fbx', fbxData]);
      } else if (extension === 'glb' || extension === 'gltf') {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const gltfData = useGLTF(url) as GLTFResult;
        entries.push([name, 'glb', gltfData]);
      }
    });
  }

  // useFBX/useGLTF return stable references for the same URL (drei's
  // suspense cache) — but without this memo, the returned object literal
  // itself was rebuilt fresh on every render regardless, defeating
  // processedClips' useMemo below (which depends on this return value) and
  // making it recompute brand-new AnimationClip objects on every render.
  // That in turn made the animation-crossfade effect re-fire on every
  // render too, since it depends on processedClips: it saw a "new" clip
  // object each time, created a fresh AnimationAction via
  // mixer.clipAction(), and reset+restarted it from frame 0 — visibly
  // snapping the whole-body pose back to frame 0 on every re-render.
  // VRMAvatar re-renders frequently while the AI is speaking (expressions
  // context updates), so this fired dozens of times a second. Keying the
  // memo on the URL config (not the entries array, whose length/order
  // isn't a stable dependency-array shape across renders) fixes it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const loadedAnimations: Record<string, { type: 'fbx' | 'glb', data: THREE.Group | GLTFResult }> = {};
    entries.forEach(([name, type, data]) => {
      loadedAnimations[name] = { type, data };
    });
    return loadedAnimations;
  }, [JSON.stringify(animationUrls)]);
}

/**
 * VRMAvatar - Render a VRM character with animations, expressions, and talking animations
 *
 * This component handles everything needed to display and animate a VRM model:
 * - Loads and renders the VRM model
 * - Automatically loads and remaps animations from URLs
 * - Manages expression blending with smooth transitions
 * - Auto-plays "idle" animation if provided
 * - Natural blinking with randomized timing
 * - Talking animations that play automatically when AI speaks
 * - Updates VRM model every frame
 *
 * **TALKING ANIMATIONS:** When the AI speaks (chatStatus === 'speaking'), the system automatically
 * randomly plays animations whose names include 'talk', 'gesture', or 'speak'. This provides
 * natural variety during conversations without complex gesture calculations.
 *
 * **IMPORTANT:** Must be used inside a React Three Fiber `<Canvas>` component
 * and within a `<KhaveeProvider>`.
 *
 * @param src - URL or path to the VRM model file (.vrm)
 * @param position - Position in 3D space [x, y, z]. Default: [0, 0, 0]
 * @param rotation - Rotation in radians [x, y, z]. Default: [0, Math.PI, 0]
 * @param scale - Scale [x, y, z]. Default: [1, 1, 1]
 * @param animations - Optional animation configuration using URLs to FBX files
 * @param enableBlinking - Enable natural blinking animations. Default: true
 * @param enableTalkingAnimations - Enable talking animations during AI speech. Default: true
 *
 * @example
 * // Basic usage
 * ```tsx
 * import { KhaveeProvider, VRMAvatar } from '@khaveeai/react';
 * import { Canvas } from '@react-three/fiber';
 *
 * function App() {
 *   return (
 *     <KhaveeProvider>
 *       <Canvas>
 *         <VRMAvatar src="/models/character.vrm" />
 *       </Canvas>
 *     </KhaveeProvider>
 *   );
 * }
 * ```
 *
 * @example
 * // With talking animations
 * ```tsx
 * function Character() {
 *   const animations = {
 *     idle: '/animations/idle.fbx',
 *     talk1: '/animations/talking_1.fbx',
 *     talk2: '/animations/talking_2.fbx',
 *     gesture_nod: '/animations/gesture_nod.fbx',
 *     gesture_point: '/animations/gesture_point.fbx',
 *   };
 *
 *   return (
 *     <VRMAvatar
 *       src="/models/character.vrm"
 *       animations={animations}
 *       position={[0, -1, 0]}
 *       scale={[1.5, 1.5, 1.5]}
 *       enableBlinking={true}
 *       enableTalkingAnimations={true}
 *     />
 *   );
 * }
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
 *     <button onClick={() => animate('dance')}>
 *       Dance!
 *     </button>
 *   );
 * }
 *
 * function App() {
 *   const animations = {
 *     idle: '/animations/idle.fbx',
 *     talk1: '/animations/talking_1.fbx',
 *     dance: '/animations/dance.fbx',
 *   };
 *
 *   return (
 *     <KhaveeProvider>
 *       <Canvas>
 *         <VRMAvatar src="/model.vrm" animations={animations} />
 *       </Canvas>
 *       <Controls />
 *     </KhaveeProvider>
 *   );
 * }
 * ```
 */
export function VRMAvatar({
  src,
  position = [0, 0, 0],
  rotation = [0, Math.PI, 0],
  scale = [1, 1, 1],
  animations,
  enableBlinking = true,
  ...props
}: VRMAvatarProps) {
  const { setVrm, expressions, currentAnimation, animate } = useKhavee();
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const expressionTargetsRef = useRef<Record<string, number>>({});

  // Blinking system. blinkState is a ref, not React state: it's only ever
  // read synchronously within the same useFrame callback that writes it,
  // never rendered in JSX — calling a state setter here would re-render
  // this component on every single animation frame during a blink (blink
  // lasts ~7 frames at blinkAnimationRef's 0.15/frame step), fighting the
  // R3F render loop for the main thread and producing visible stutter.
  const blinkState = useRef(0);
  const nextBlinkTime = useRef(Date.now() + 2000 + Math.random() * 3000);
  const isBlinking = useRef(false);
  const blinkAnimationRef = useRef(0);


  const parsed = useLoadVRM(src);
  const scene = parsed?.scene;
  const currentVrm = parsed?.userData.vrm as VRM | undefined;

  // SDK automatically loads FBX and GLB files from URLs!
  const loadedAnimations = useAnimationFiles(animations);

  // Process and remap animations automatically - SDK handles EVERYTHING!
  const processedClips = useMemo(() => {
    if (
      !animations ||
      !currentVrm ||
      Object.keys(loadedAnimations).length === 0
    ) {
      console.log("[VRM Animation] Waiting for animations or VRM to load...");
      return [];
    }

    const clips: THREE.AnimationClip[] = [];

    Object.entries(loadedAnimations).forEach(([name, { type, data }]) => {
      try {
        if (type === 'fbx') {
          // FBX files - Automatically remap Mixamo animation to VRM format
          // @ts-ignore - VRM type compatibility with remap function
          const remappedClip = remapMixamoAnimationToVrm(currentVrm, data as THREE.Group);
          remappedClip.name = name;
          clips.push(remappedClip);
        } else if (type === 'glb') {
          // GLB files - Extract animations from GLTF
          const gltf = data as GLTFResult;
          
          if (gltf.animations && gltf.animations.length > 0) {
            // Check if this is a Mixamo animation that needs remapping
            const isMixamoAnimation = gltf.animations.some(
              (anim: THREE.AnimationClip) => anim.name.includes('mixamo')
            );
            
            if (isMixamoAnimation && gltf.scene) {
              // Remap Mixamo GLB animation to VRM
              // @ts-ignore - VRM type compatibility
              const remappedClip = remapMixamoAnimationToVrm(currentVrm, gltf.scene);
              remappedClip.name = name;
              clips.push(remappedClip);
            } else {
              // Use animation directly (already VRM-compatible or generic)
              // If multiple animations in GLB, use the first one or all of them
              gltf.animations.forEach((clip: THREE.AnimationClip, index: number) => {
                const clipCopy = clip.clone();
                clipCopy.name = gltf.animations.length === 1 ? name : `${name}_${index}`;
                clips.push(clipCopy);
              });
            }
          } else {
            console.warn(`[VRM Animation] No animations found in GLB file: ${name}`);
          }
        }
      } catch (error) {
        console.error(
          `[VRM Animation] ❌ Failed to load/remap ${name}:`,
          error
        );
      }
    });

    return clips;
  }, [loadedAnimations, currentVrm]);

  // Initialize animation mixer and maintain animation state
  useEffect(() => {
    if (currentVrm?.scene && !mixerRef.current) {
      mixerRef.current = new THREE.AnimationMixer(currentVrm.scene);

      // Add clips to mixer when they're available
      if (processedClips.length > 0) {
        processedClips.forEach((clip) => {
          if (clip) {
            mixerRef.current?.clipAction(clip);
          }
        });
      }
    }

    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
        currentActionRef.current = null;
      }
    };
  }, [currentVrm]);

  // Add processed clips to existing mixer when they become available
  useEffect(() => {
    if (mixerRef.current && processedClips.length > 0) {
      processedClips.forEach((clip) => {
        if (clip) {
          // Only add if not already added
          try {
            mixerRef.current?.clipAction(clip);
          } catch (error) {
            // Clip might already be added, ignore error
          }
        }
      });
    }
  }, [processedClips]);

  // Handle animation switching with proper crossfading
  useEffect(() => {
    if (!mixerRef.current || !currentAnimation) {
      // Stop current animation
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.3);
        currentActionRef.current = null;
      }
      return;
    }

    const targetClip = processedClips.find(
      (clip) => clip?.name === currentAnimation
    );

    if (targetClip && mixerRef.current) {
      const newAction = mixerRef.current.clipAction(targetClip);

      // Only restart if this is actually a different animation
      if (currentActionRef.current !== newAction) {
        // Fade out current animation if it exists
        if (currentActionRef.current) {
          currentActionRef.current.fadeOut(0.3);
        }
        // Fade in new animation
        newAction.reset().fadeIn(0.3).play();
        currentActionRef.current = newAction;
      } else if (!currentActionRef.current) {
        // Start new animation without fade (first time)
        newAction.reset().play();
        currentActionRef.current = newAction;
      }
    }
    // processedClips is included so this retries once the mixer/clips become
    // ready asynchronously (useLoadVRM no longer guarantees synchronous
    // readiness the way Suspense-based useGLTF did) — without it, "idle"
    // (the default currentAnimation, which never changes on its own) would
    // never get (re)applied once the mixer actually exists, leaving the
    // avatar stuck in its raw bind pose.
  }, [currentAnimation, processedClips]);

  useEffect(() => {
    if (!currentVrm || !scene) return;

    // Update VRM in context
    setVrm(currentVrm);

    // Performance optimizations
    VRMUtils.removeUnnecessaryVertices(scene);
    VRMUtils.combineSkeletons(scene);
    VRMUtils.combineMorphs(currentVrm);

    // Disable frustum culling
    currentVrm.scene.traverse((obj: any) => {
      obj.frustumCulled = false;
    });
  }, [scene, currentVrm, setVrm]);

  const lerpExpression = (name: string, value: number, lerpFactor: number) => {
    if (!currentVrm?.expressionManager) return;

    const currentValue = currentVrm.expressionManager.getValue(name);
    if (currentValue !== null) {
      const targetValue = lerp(currentValue, value, lerpFactor);

      // Store target for reference
      expressionTargetsRef.current[name] = value;

      // Apply expression without disrupting animations
      currentVrm.expressionManager.setValue(name, targetValue);
    }
  };

  useFrame((_, delta) => {
    if (!currentVrm?.expressionManager) return;

    // Update animation mixer first (if exists)
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // Apply expressions from the hook with smooth lerping
    Object.entries(expressions).forEach(([name, value]) => {
      if (typeof value === "number") {
        lerpExpression(name, value, delta * 8);
      }
    });

    // Blinking system
    if (enableBlinking) {
      const time = Date.now();

      // Check if it's time to blink
      if (time > nextBlinkTime.current && !isBlinking.current) {
        isBlinking.current = true;
        blinkAnimationRef.current = 0;
        nextBlinkTime.current = time + 100 + Math.random() * 4000; // Next blink in 0-4 seconds
      }

      // Handle blink animation
      if (isBlinking.current) {
        blinkAnimationRef.current += 0.15;
        if (blinkAnimationRef.current >= 1) {
          isBlinking.current = false;
          blinkState.current = 0;
        } else {
          // Create smooth blink curve using sine
          blinkState.current = Math.sin(blinkAnimationRef.current * Math.PI);
        }
      }

      // Apply blinking to VRM expression system
      if (currentVrm.expressionManager) {
        if (
          currentVrm.expressionManager.blinkExpressionNames.includes(
            "blinkLeft"
          ) &&
          currentVrm.expressionManager.blinkExpressionNames.includes(
            "blinkRight"
          )
        ) {
          currentVrm.expressionManager.setValue("blinkLeft", blinkState.current);
          currentVrm.expressionManager.setValue("blinkRight", blinkState.current);
        }
      }
    }

    // Update VRM after all changes (expressions + animations + blinking + gestures)
    currentVrm.update(delta);
  });

  return (
    <group position={position} rotation={rotation} scale={scale} {...props}>
      {scene && <primitive object={scene} />}
    </group>
  );
}

/**
 * useVRM - Access the loaded VRM model instance
 *
 * Returns the current VRM model instance. Use this when you need direct access
 * to the VRM object for advanced operations.
 *
 * @returns VRM instance or null if not yet loaded
 * @throws Error if used outside of KhaveeProvider
 *
 * @example
 * ```tsx
 * import { useVRM } from '@khaveeai/react';
 *
 * function VRMInfo() {
 *   const vrm = useVRM();
 *
 *   if (!vrm) {
 *     return <div>Loading VRM...</div>;
 *   }
 *
 *   return (
 *     <div>
 *       <p>VRM Model: {vrm.meta?.name}</p>
 *       <p>Author: {vrm.meta?.author}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useVRM() {
  const { vrm } = useKhavee();
  return vrm;
}

/**
 * useVRMExpressions - Control VRM facial expressions
 *
 * Provides functions to control VRM expressions (facial animations) with smooth transitions.
 * All expression values are clamped between 0 and 1, and changes are smoothly interpolated.
 *
 * @returns Object containing:
 *   - expressions: Current expression values
 *   - setExpression: Set a single expression
 *   - resetExpressions: Reset all expressions to 0
 *   - setMultipleExpressions: Set multiple expressions at once
 *
 * @example
 * // Basic expression control
 * ```tsx
 * import { useVRMExpressions } from '@khaveeai/react';
 *
 * function ExpressionControls() {
 *   const { setExpression, resetExpressions } = useVRMExpressions();
 *
 *   return (
 *     <div>
 *       <button onClick={() => setExpression('happy', 1)}>
 *         😊 Happy
 *       </button>
 *       <button onClick={() => setExpression('sad', 1)}>
 *         😢 Sad
 *       </button>
 *       <button onClick={() => setExpression('angry', 1)}>
 *         😠 Angry
 *       </button>
 *       <button onClick={() => resetExpressions()}>
 *         Reset
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * // Partial expressions (intensity control)
 * ```tsx
 * function SubtleExpressions() {
 *   const { setExpression } = useVRMExpressions();
 *
 *   return (
 *     <div>
 *       <button onClick={() => setExpression('happy', 0.3)}>
 *         Slightly Happy (30%)
 *       </button>
 *       <button onClick={() => setExpression('happy', 0.7)}>
 *         Very Happy (70%)
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * // Multiple expressions at once
 * ```tsx
 * function CombinedExpressions() {
 *   const { setMultipleExpressions } = useVRMExpressions();
 *
 *   const setSurprisedAndHappy = () => {
 *     setMultipleExpressions({
 *       happy: 0.7,
 *       surprised: 0.5,
 *     });
 *   };
 *
 *   return (
 *     <button onClick={setSurprisedAndHappy}>
 *       😃 Happy Surprise!
 *     </button>
 *   );
 * }
 * ```
 *
 * @example
 * // Display current expressions
 * ```tsx
 * function ExpressionDisplay() {
 *   const { expressions } = useVRMExpressions();
 *
 *   return (
 *     <div>
 *       <h3>Active Expressions:</h3>
 *       {Object.entries(expressions).map(([name, value]) => (
 *         <p key={name}>
 *           {name}: {(value * 100).toFixed(0)}%
 *         </p>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useVRMExpressions() {
  const {
    expressions,
    setExpression,
    resetExpressions,
    setMultipleExpressions,
  } = useKhavee();

  return {
    expressions,
    setExpression,
    resetExpressions,
    setMultipleExpressions,
  };
}

/**
 * useAnimations - Control animations for VRM or GLB models
 *
 * Generic hook to play, stop, and manage animations. Works with both VRMAvatar and GLBAvatar.
 * Animations are smoothly transitioned with fade-in/fade-out effects.
 *
 * @returns Object containing:
 *   - currentAnimation: Name of the currently playing animation
 *   - animate: Function to play an animation by name
 *   - stopAnimation: Function to stop all animations
 *   - availableAnimations: Array of loaded animation names
 *
 * @example
 * // Basic animation control (works with VRM or GLB)
 * ```tsx
 * import { useAnimations } from '@khaveeai/react';
 *
 * function AnimationControls() {
 *   const { animate, currentAnimation, availableAnimations } = useAnimations();
 *
 *   return (
 *     <div>
 *       <p>Current: {currentAnimation}</p>
 *       {availableAnimations.map(name => (
 *         <button key={name} onClick={() => animate(name)}>
 *           {name}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * // With GLBAvatar
 * ```tsx
 * function App() {
 *   const { animate } = useAnimations();
 *   
 *   return (
 *     <>
 *       <Canvas>
 *         <GLBAvatar src="/model.glb" />
 *       </Canvas>
 *       <button onClick={() => animate('walk')}>Walk</button>
 *     </>
 *   );
 * }
 * ```
 */
export function useAnimations() {
  const { currentAnimation, animate, stopAnimation, availableAnimations } =
    useKhavee();

  return {
    currentAnimation,
    animate,
    stopAnimation,
    availableAnimations,
  };
}

/**
 * useVRMAnimations - Control VRM character animations
 * 
 * @deprecated Use `useAnimations()` instead - works for both VRM and GLB models
 * 
 * Alias for useAnimations() for backward compatibility.
 * Provides functions to play, stop, and manage VRM animations. Animations are smoothly
 * transitioned with fade-in/fade-out effects. The "idle" animation auto-plays when loaded.
 *
 * @returns Object containing:
 *   - currentAnimation: Name of the currently playing animation
 *   - animate: Function to play an animation by name
 *   - stopAnimation: Function to stop all animations
 *   - availableAnimations: Array of loaded animation names
 *
 * @example
 * // Basic animation control
 * ```tsx
 * import { useVRMAnimations } from '@khaveeai/react';
 *
 * function AnimationControls() {
 *   const { animate, currentAnimation } = useVRMAnimations();
 *
 *   return (
 *     <div>
 *       <p>Current: {currentAnimation}</p>
 *       <button onClick={() => animate('idle')}>
 *         🧍 Idle
 *       </button>
 *       <button onClick={() => animate('walk')}>
 *         🚶 Walk
 *       </button>
 *       <button onClick={() => animate('dance')}>
 *         💃 Dance
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * // With animation panel UI
 * ```tsx
 * function AnimationPanel() {
 *   const { animate, currentAnimation, stopAnimation } = useVRMAnimations();
 *
 *   const animations = ['idle', 'walk', 'run', 'jump', 'dance'];
 *
 *   return (
 *     <div className="panel">
 *       {animations.map(name => (
 *         <button
 *           key={name}
 *           onClick={() => animate(name)}
 *           className={currentAnimation === name ? 'active' : ''}
 *         >
 *           {name}
 *         </button>
 *       ))}
 *       <button onClick={stopAnimation}>Stop All</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * // Keyboard controls
 * ```tsx
 * function KeyboardControls() {
 *   const { animate } = useVRMAnimations();
 *
 *   useEffect(() => {
 *     const handleKeyPress = (e: KeyboardEvent) => {
 *       switch(e.key) {
 *         case 'w': animate('walk'); break;
 *         case 'r': animate('run'); break;
 *         case 'd': animate('dance'); break;
 *         case ' ': animate('idle'); break;
 *       }
 *     };
 *
 *     window.addEventListener('keydown', handleKeyPress);
 *     return () => window.removeEventListener('keydown', handleKeyPress);
 *   }, [animate]);
 *
 *   return <div>Use W/R/D/Space to control animations</div>;
 * }
 * ```
 *
 * @example
 * // Combined with expressions
 * ```tsx
 * function PresetActions() {
 *   const { animate } = useVRMAnimations();
 *   const { setMultipleExpressions } = useVRMExpressions();
 *
 *   const happyDance = () => {
 *     animate('dance');
 *     setMultipleExpressions({ happy: 1, excited: 0.8 });
 *   };
 *
 *   const sadWalk = () => {
 *     animate('walk');
 *     setMultipleExpressions({ sad: 0.7 });
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={happyDance}>😄 Happy Dance</button>
 *       <button onClick={sadWalk}>😢 Sad Walk</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useVRMAnimations() {
  return useAnimations();
}
