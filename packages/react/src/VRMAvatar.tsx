import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { useFBX, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { lerp } from "three/src/math/MathUtils.js";
import type { ChatStatus } from "@khaveeai/core";
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

/**
 * VRMAvatarProps - Configuration props for the VRMAvatar component
 *
 * All optional props default to true, enabling all procedural animation layers by default.
 * Set any to false to disable specific features.
 */
export interface VRMAvatarProps {
  /** URL or path to the VRM model file (.vrm) */
  src: string;
  /** Position in 3D space [x, y, z]. Default: [0, 0, 0] */
  position?: [number, number, number];
  /** Rotation in radians [x, y, z]. Default: [0, Math.PI, 0] */
  rotation?: [number, number, number];
  /** Scale [x, y, z]. Default: [1, 1, 1] */
  scale?: [number, number, number];
  /** Optional animation configuration using URLs to FBX or GLB files */
  animations?: AnimationConfig;
  /** Enable natural blinking animations. Default: true */
  enableBlinking?: boolean;
  /** Enable subtle breathing motion (spine/chest oscillation). Default: true */
  enableBreathing?: boolean;
  /** Enable natural head micro-movement. Default: true */
  enableHeadMovement?: boolean;
  /** Enable drifting eye gaze behavior. Default: true */
  enableEyeGaze?: boolean;
  /** Enable subtle finger curl noise. Default: true */
  enableHandGestures?: boolean;
  /** Enable status-based micro-expressions (idle/listening/thinking). Default: true */
  enableMicroExpressions?: boolean;
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

// ── Module-level scratch objects (avoid per-frame GC) ──
const scratchX = new THREE.Vector3(1, 0, 0);
const scratchY = new THREE.Vector3(0, 1, 0);

const breathQuat = new THREE.Quaternion();
const headQuatX = new THREE.Quaternion();
const headQuatY = new THREE.Quaternion();
const fingerQuat = new THREE.Quaternion();

// Finger proximal bone names (camelCase per CLAUDE.md)
const leftFingerBones = [
  "leftThumbProximal",
  "leftIndexProximal",
  "leftMiddleProximal",
  "leftRingProximal",
  "leftLittleProximal",
];

const rightFingerBones = [
  "rightThumbProximal",
  "rightIndexProximal",
  "rightMiddleProximal",
  "rightRingProximal",
  "rightLittleProximal",
];

const allFingerBones = [...leftFingerBones, ...rightFingerBones];

// Phase offsets for per-finger variety (0–1 range)
const fingerPhases = [0, 1.1, 2.3, 0.7, 1.9];

// ── Wave-4: Keyword gesture override ──
// Fixed regex patterns mapped to candidate animation-key substrings.
// Regexes are module-level constants — never built from user input (T-10-04-B).
const gestureKeywords: [RegExp, string[]][] = [
  [/\byes\b|\bใช่\b|\bagree\b|\bexact|\bright\b|\bcorrect\b/i, ["agree", "nod", "yes"]],
  [/\bno\b|\bไม่\b|\bdisagree\b|\bnever\b/i, ["disagree", "shake", "no"]],
  [/\bi\b|\bฉัน\b|\bผม\b|\bme\b/i, ["self", "chest", "point"]],
  [/\bthink\b|\bคิด\b|\bbelieve\b|\bfeel\b/i, ["think", "ponder", "wonder"]],
];

// Internal component to load FBX and GLB animation files
function useAnimationFiles(animationUrls: AnimationConfig | undefined) {
  const loadedAnimations: Record<string, { type: 'fbx' | 'glb', data: THREE.Group | GLTFResult }> = {};

  if (animationUrls) {
    Object.entries(animationUrls).forEach(([name, url]) => {
      const extension = url.toLowerCase().split('.').pop();
      
      if (extension === 'fbx') {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const fbxData = useFBX(url);
        loadedAnimations[name] = { type: 'fbx', data: fbxData };
      } else if (extension === 'glb' || extension === 'gltf') {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const gltfData = useGLTF(url) as GLTFResult;
        loadedAnimations[name] = { type: 'glb', data: gltfData };
      }
    });
  }

  return loadedAnimations;
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
 * @param enableBreathing - Enable subtle breathing motion (spine/chest oscillation). Default: true
 * @param enableHeadMovement - Enable natural head micro-movement. Default: true
 * @param enableEyeGaze - Enable drifting eye gaze behavior. Default: true
 * @param enableHandGestures - Enable subtle finger curl noise. Default: true
 * @param enableMicroExpressions - Enable status-based micro-expressions (idle/listening/thinking). Default: true
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
  enableBreathing = true,
  enableHeadMovement = true,
  enableEyeGaze = true,
  enableHandGestures = true,
  enableMicroExpressions = true,
  ...props
}: VRMAvatarProps) {
  const { setVrm, expressions, currentAnimation, animate, chatStatus, realtimeProvider } = useKhavee();
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const expressionTargetsRef = useRef<Record<string, number>>({});

  // chatStatus auto-mapping refs
  /** Tracks the previous chatStatus to guard against redundant animation triggers. */
  const prevChatStatusRef = useRef<ChatStatus | null>(null);
  /** Stale-closure guard: always holds the latest animations prop reference (Pitfall 3). */
  const animationsRef = useRef<AnimationConfig | undefined>(animations);
  /** Remembers the speaking animation variant chosen for the current speaking turn. */
  const currentSpeakingAnimRef = useRef<string | null>(null);

  // Sync animationsRef whenever the animations prop changes (Pitfall 3 stale-closure guard).
  useEffect(() => {
    animationsRef.current = animations;
  }, [animations]);

  // Blinking system
  const [blinkState, setBlinkState] = useState(0);
  const nextBlinkTime = useRef(Date.now() + 2000 + Math.random() * 3000);
  const isBlinking = useRef(false);
  const blinkAnimationRef = useRef(0);

  // Procedural animation time refs
  const breathTimeRef = useRef(0);
  const headTimeRef = useRef(0);
  const gazeTimeRef = useRef(0);
  const fingerTimeRef = useRef(0);
  const gazeTargetRef = useRef<THREE.Object3D | null>(null);

  // ── Procedural life layer ──
  // Micro-expression scheduler refs
  const microExprTimeRef = useRef(0);
  const nextExprChangeRef = useRef(3 + Math.random() * 5);
  const currentExprTargetsRef = useRef<Record<string, number>>({});

  // ── Wave-4: Nodding ──
  const nodActiveRef = useRef(false);
  const nodTypeRef = useRef(0);          // 0=SHORT, 1=LONG, 2=LONG_P
  const nodProgressRef = useRef(0);      // 0→1 over nodDurationRef
  const nodDurationRef = useRef(0.3);    // seconds
  const nextNodTimeRef = useRef(2.5);    // seconds until next nod

  // ── Wave-4: Thinking pose ──
  const thinkingTiltRef = useRef(0);           // 0 (neutral) → 1 (full tilt), lerped
  const thinkingTiltDirectionRef = useRef(1);  // +1 or -1, randomised per thinking turn

  // ── Wave-4: Gaze aversion ──
  const aversionPhaseRef = useRef<0 | 1 | 2 | 3>(0); // 0=idle, 1=averting, 2=hold, 3=returning
  const aversionProgressRef = useRef(0);
  const aversionHoldTimerRef = useRef(0);
  const aversionTimerRef = useRef(4.5);
  const aversionTargetXRef = useRef(0);


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

  // chatStatus → animation auto-mapping (D-01, D-02, D-03)
  // Runs only on a real chatStatus transition; early-returns if the status is unchanged
  // (Pitfall 5: prevents re-triggering on every render while already in a given state).
  useEffect(() => {
    if (chatStatus === prevChatStatusRef.current) return;

    prevChatStatusRef.current = chatStatus;

    const animKeys = Object.keys(animationsRef.current || {});

    if (chatStatus === "speaking") {
      // D-02: pick a random speak/talk/gesture variant on transition INTO speaking.
      // Re-roll happens only here, not on subsequent renders while already speaking.
      const variants = animKeys.filter((key) => /speak|talk|gesture/i.test(key));
      if (variants.length > 0) {
        const pick = variants[Math.floor(Math.random() * variants.length)];
        currentSpeakingAnimRef.current = pick;
        animate(pick);
      }

      // ── Wave-4: Keyword gesture override ──
      // Check last assistant message for a semantic gesture hint; overrides the
      // random pick above only when BOTH a keyword pattern matches AND a matching
      // animation key exists in the animations prop. Silently no-ops otherwise.
      const msgs = realtimeProvider?.conversation ?? [];
      const lastAI = [...msgs].reverse().find((m) => m.role === "assistant");
      if (lastAI?.text) {
        const text = lastAI.text;
        const availableKeys = Object.keys(animationsRef.current ?? {});
        for (const [pattern, candidates] of gestureKeywords) {
          if (pattern.test(text)) {
            const matchedCandidate = candidates.find((c) =>
              availableKeys.some((k) => k.toLowerCase().includes(c))
            );
            if (matchedCandidate) {
              const matchedKey = availableKeys.find((k) =>
                k.toLowerCase().includes(matchedCandidate)
              );
              if (matchedKey) {
                animate(matchedKey);
                currentSpeakingAnimRef.current = matchedKey;
              }
              break;
            }
          }
        }
      }
    } else {
      // Clear the remembered speaking variant when leaving the speaking state.
      currentSpeakingAnimRef.current = null;
      // D-01: 'idle' is the animation key convention for chatStatus === 'ready'
      // (ChatStatus has no 'idle' value — the animation key name and the status differ).
      const targetKey = chatStatus === "ready" ? "idle" : chatStatus;
      // D-03: if no matching key exists, do nothing — never throw.
      if (animKeys.includes(targetKey)) {
        animate(targetKey);
      }
    }
  }, [chatStatus, animate, realtimeProvider]);

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

  // Eye gaze target lifecycle (D-05)
  useEffect(() => {
    if (!currentVrm || !enableEyeGaze || !currentVrm.lookAt) return;

    const gazeObj = new THREE.Object3D();
    gazeObj.position.set(0, 1.6, 2.0); // Base target position
    currentVrm.scene.add(gazeObj);
    gazeTargetRef.current = gazeObj;
    currentVrm.lookAt.target = gazeObj;
    currentVrm.lookAt.autoUpdate = true;

    return () => {
      currentVrm.scene.remove(gazeObj);
      if (currentVrm.lookAt) {
        currentVrm.lookAt.target = null;
      }
      gazeTargetRef.current = null;
    };
  }, [currentVrm, enableEyeGaze]);

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

    // ── Wave-4: Volume-reactive head movement scaling ──
    // Falls back to 1 when realtimeProvider is null or chatStatus isn't 'speaking'.
    const rawVolume = realtimeProvider?.currentVolume ?? 0;
    const volumeFactor = chatStatus === "speaking" ? 1 + Math.min(rawVolume, 1) * 0.45 : 1;

    // Update animation mixer first (if exists)
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // ── Procedural bone deltas (D-04, D-06, D-08) ──
    // All applied AFTER mixer.update, BEFORE vrm.update (Pitfall 1)

    // Breathing: spine and chest oscillation (D-06)
    if (enableBreathing && currentVrm.humanoid) {
      breathTimeRef.current += delta;
      const offset = Math.sin(breathTimeRef.current * 1.2) * 0.020;
      breathQuat.setFromAxisAngle(scratchX, offset);

      const spine = currentVrm.humanoid.getNormalizedBoneNode("spine" as any);
      if (spine) {
        spine.quaternion.multiply(breathQuat);
      }

      const chest = currentVrm.humanoid.getNormalizedBoneNode("chest" as any);
      if (chest) {
        chest.quaternion.multiply(breathQuat);
      }
    }

    // Head micro-movement: two-octave noise (D-06)
    if (enableHeadMovement && currentVrm.humanoid) {
      headTimeRef.current += delta;
      const headX =
        (Math.sin(headTimeRef.current * 0.19) * 0.018 +
          Math.sin(headTimeRef.current * 0.53) * 0.009) *
        volumeFactor;
      const headY =
        (Math.sin(headTimeRef.current * 0.31) * 0.022 +
          Math.sin(headTimeRef.current * 0.67) * 0.011) *
        volumeFactor;

      headQuatX.setFromAxisAngle(scratchX, headX);
      headQuatY.setFromAxisAngle(scratchY, headY);

      const head = currentVrm.humanoid.getNormalizedBoneNode("head" as any);
      if (head) {
        head.quaternion.multiply(headQuatX).multiply(headQuatY);
      }
    }

    // ── Wave-4: Nodding (listening state) ──
    if (enableHeadMovement && currentVrm.humanoid) {
      // Nod timer (only ticks during listening; reset on exit)
      if (chatStatus === "listening") {
        nextNodTimeRef.current -= delta;
        if (!nodActiveRef.current && nextNodTimeRef.current <= 0) {
          nodActiveRef.current = true;
          nodProgressRef.current = 0;
          const r = Math.random();
          // SHORT 40%, LONG 40%, LONG_P 20%
          nodTypeRef.current = r < 0.4 ? 0 : r < 0.8 ? 1 : 2;
          nodDurationRef.current =
            nodTypeRef.current === 0 ? 0.3 : nodTypeRef.current === 1 ? 0.5 : 0.6;
          nextNodTimeRef.current = Math.random() * 2 + 2;
        }
      } else if (!nodActiveRef.current) {
        nextNodTimeRef.current = Math.random() * 2 + 2;
      }

      // Apply active nod
      if (nodActiveRef.current) {
        nodProgressRef.current += delta / nodDurationRef.current;
        if (nodProgressRef.current >= 1) {
          nodProgressRef.current = 1;
          nodActiveRef.current = false;
        }
        const t = nodProgressRef.current;
        const headBoneNod = currentVrm.humanoid.getNormalizedBoneNode("head" as any);
        if (headBoneNod) {
          let nodX = 0;
          let nodY = 0;
          if (nodTypeRef.current === 0) {
            nodX = Math.sin(t * Math.PI) * 0.022; // SHORT: one dip
          } else if (nodTypeRef.current === 1) {
            nodX = Math.sin(t * Math.PI * 2) * 0.038; // LONG: two cycles
          } else {
            nodX = Math.sin(t * Math.PI * 2) * 0.038; // LONG_P: two cycles
            nodY = thinkingTiltDirectionRef.current * Math.sin(t * Math.PI) * 0.012; // + upswing
          }
          headQuatX.setFromAxisAngle(scratchX, nodX);
          headBoneNod.quaternion.multiply(headQuatX);
          if (nodY !== 0) {
            headQuatY.setFromAxisAngle(scratchY, nodY);
            headBoneNod.quaternion.multiply(headQuatY);
          }
        }
      }
    }

    // ── Wave-4: Thinking pose (head tilt) ──
    if (enableHeadMovement && currentVrm.humanoid) {
      // Randomise tilt direction on first frame entering thinking
      if (chatStatus === "thinking" && prevChatStatusRef.current !== "thinking") {
        thinkingTiltDirectionRef.current = Math.random() > 0.5 ? 1 : -1;
      }
      // Lerp tilt 0→1 when thinking, 1→0 otherwise
      const thinkingTarget = chatStatus === "thinking" ? 1 : 0;
      thinkingTiltRef.current +=
        (thinkingTarget - thinkingTiltRef.current) * Math.min(delta * 2, 1);
      if (thinkingTiltRef.current > 0.001) {
        const headBoneTilt = currentVrm.humanoid.getNormalizedBoneNode("head" as any);
        if (headBoneTilt) {
          const tiltY = thinkingTiltRef.current * thinkingTiltDirectionRef.current * 0.13;
          headQuatY.setFromAxisAngle(scratchY, tiltY);
          headBoneTilt.quaternion.multiply(headQuatY);
        }
      }
    }

    // Eye gaze: drifting lookAt target (D-05)
    if (enableEyeGaze && gazeTargetRef.current && currentVrm.humanoid) {
      gazeTimeRef.current += delta;
      const gazeX =
        Math.sin(gazeTimeRef.current * 0.12) * 0.25 +
        Math.sin(gazeTimeRef.current * 0.38) * 0.12;
      const gazeY =
        1.6 +
        Math.sin(gazeTimeRef.current * 0.15) * 0.08 +
        Math.sin(gazeTimeRef.current * 0.42) * 0.04;

      gazeTargetRef.current.position.set(gazeX, gazeY, 2.0);
      // vrm.lookAt.autoUpdate handles the rest in vrm.update()
    }

    // ── Wave-4: Gaze aversion (thinking only, additive on top of drift above) ──
    if (enableEyeGaze && gazeTargetRef.current && chatStatus === "thinking") {
      aversionTimerRef.current -= delta;

      if (aversionPhaseRef.current === 0 && aversionTimerRef.current <= 0) {
        // Start aversion
        aversionPhaseRef.current = 1;
        aversionProgressRef.current = 0;
        aversionTargetXRef.current =
          (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 0.3 + 0.5);
      }

      if (aversionPhaseRef.current === 1) {
        // Averting outward
        aversionProgressRef.current += delta / 0.4;
        if (aversionProgressRef.current >= 1) {
          aversionProgressRef.current = 1;
          aversionPhaseRef.current = 2;
          aversionHoldTimerRef.current = 1.5;
        }
        const easedP =
          aversionProgressRef.current * aversionProgressRef.current * (3 - 2 * aversionProgressRef.current);
        gazeTargetRef.current.position.x += aversionTargetXRef.current * easedP;
        gazeTargetRef.current.position.y -= 0.25 * easedP;
      } else if (aversionPhaseRef.current === 2) {
        // Hold
        aversionHoldTimerRef.current -= delta;
        gazeTargetRef.current.position.x += aversionTargetXRef.current;
        gazeTargetRef.current.position.y -= 0.25;
        if (aversionHoldTimerRef.current <= 0) {
          aversionPhaseRef.current = 3;
          aversionProgressRef.current = 0;
        }
      } else if (aversionPhaseRef.current === 3) {
        // Returning
        aversionProgressRef.current += delta / 0.6;
        if (aversionProgressRef.current >= 1) {
          aversionProgressRef.current = 1;
          aversionPhaseRef.current = 0;
          aversionTimerRef.current = Math.random() * 3 + 4;
        }
        const easedP =
          1 -
          aversionProgressRef.current * aversionProgressRef.current * (3 - 2 * aversionProgressRef.current);
        gazeTargetRef.current.position.x += aversionTargetXRef.current * easedP;
        gazeTargetRef.current.position.y -= 0.25 * easedP;
      }
    } else if (chatStatus !== "thinking") {
      // Force reset on exit from thinking
      aversionPhaseRef.current = 0;
      aversionTimerRef.current = Math.random() * 3 + 4;
    }

    // Finger curl noise (D-08)
    if (enableHandGestures && currentVrm.humanoid) {
      fingerTimeRef.current += delta;

      for (let i = 0; i < allFingerBones.length; i++) {
        const boneName = allFingerBones[i];
        const phase = fingerPhases[i % 5];
        const freq = 0.7 + (i % 3) * 0.17;
        const offset = Math.sin(fingerTimeRef.current * freq + phase) * 0.018;

        fingerQuat.setFromAxisAngle(scratchX, offset);

        const bone = currentVrm.humanoid.getNormalizedBoneNode(boneName as any);
        if (bone) {
          bone.quaternion.multiply(fingerQuat);
        }
      }
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
          setBlinkState(0);
        } else {
          // Create smooth blink curve using sine
          const blinkProgress = Math.sin(blinkAnimationRef.current * Math.PI);
          setBlinkState(blinkProgress);
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
          currentVrm.expressionManager.setValue("blinkLeft", blinkState);
          currentVrm.expressionManager.setValue("blinkRight", blinkState);
        }
      }
    }

    // Micro-expression scheduler (D-07)
    if (enableMicroExpressions && currentVrm.expressionManager) {
      microExprTimeRef.current += delta;

      // Re-roll targets every 3-8 seconds
      if (microExprTimeRef.current >= nextExprChangeRef.current) {
        nextExprChangeRef.current = microExprTimeRef.current + 3 + Math.random() * 5;

        // D-07 schedule: effectiveStatus maps 'ready' -> 'idle'
        const effectiveStatus = chatStatus === "ready" ? "idle" : chatStatus;

        if (effectiveStatus === "idle") {
          currentExprTargetsRef.current = {
            relaxed: 0.06 + Math.random() * 0.04, // 0.06-0.10
          };
        } else if (effectiveStatus === "listening") {
          currentExprTargetsRef.current = {
            happy: 0.10 + Math.random() * 0.05, // 0.10-0.15
            surprised: 0.04 + Math.random() * 0.02, // 0.04-0.06
          };
        } else if (effectiveStatus === "thinking") {
          currentExprTargetsRef.current = {
            neutral: 0.08 + Math.random() * 0.04, // 0.08-0.12
          };
        } else {
          // speaking and other statuses produce no micro-expressions
          currentExprTargetsRef.current = {};
        }
      }

      // Each frame: lerp toward additive targets (Open Question 2 resolution)
      const exprManager = currentVrm.expressionManager;
      Object.entries(currentExprTargetsRef.current).forEach(([name, microTarget]) => {
        // Null-guard: only setValue if the expression exists on this model (T-10-04)
        if (exprManager.getValue(name) === null) {
          return;
        }

        // Additive over developer-set values, capped at 1.0 (T-10-05)
        const devValue = expressions[name] ?? 0;
        const currentValue = exprManager.getValue(name) ?? 0;
        const combinedTarget = Math.min(1, devValue + microTarget);

        // Slow lerp for smooth transitions (delta * 0.8)
        const lerpFactor = delta * 0.8;
        const newValue = lerp(currentValue, combinedTarget, lerpFactor);

        exprManager.setValue(name, newValue);
      });
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
