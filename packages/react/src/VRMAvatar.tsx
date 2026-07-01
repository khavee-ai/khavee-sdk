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
import { filterClipTracksByBoneSet, BASE_LOWER_BONES, UPPER_BONES } from "./utils/filterClipTracksByBoneSet";

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

const scratchZ = new THREE.Vector3(0, 0, 1);

const breathQuat = new THREE.Quaternion();
const headQuatX = new THREE.Quaternion();
const headQuatY = new THREE.Quaternion();
const armQuatX = new THREE.Quaternion();
const armQuatZ = new THREE.Quaternion();

// ── Idle gaze-away (D-05) ──
// Only while chatStatus is "ready" or "stopped" (both are idle-eligible) and
// continuously idle for this long does the avatar glance subtly away, then
// smoothly return. Every transition — out, back, or an urgent reset — is a
// real eased glide (see easeInOutCubic below), never a teleport; "urgent"
// transitions (starting/listening/speaking) just use a much shorter duration
// so they still feel immediate while remaining visibly smooth.
//
// Driven DIRECTLY via lookAt.yaw/.pitch (degrees) rather than moving a
// world-space target object for lookAt to trigonometrically resolve. Reason:
// VRMLookAt's range-map SATURATES — it clamps to full blendshape/bone weight
// once the angle passes a (small, per-model) threshold, often around 10°. A
// world-space target far enough away to read as "glancing aside" easily
// exceeds that, so most of an eased approach happened while the eyes were
// already pinned at full deflection — nearly all the visible change was
// compressed into a sliver of the transition, which reads as a snap even
// though the underlying math was genuinely continuous. Driving yaw/pitch
// directly lets us pick a small, explicit peak angle that stays inside the
// visibly-continuous part of the range for the model's entire glide, and
// also fully decouples eye rotation from head position/orientation — no
// trigonometry involving the head bone's current (possibly jittering)
// transform is involved at all.
const IDLE_GAZE_DELAY_SECONDS = 10;
const GAZE_EASE_SECONDS = 1.1; // glance-out duration
const GAZE_RETURN_EASE_SECONDS = 1.1; // natural/soft-cancel return duration
const GAZE_HARD_RESET_EASE_SECONDS = 0.4; // urgent (starting/listening/speaking) return duration
const GAZE_HOLD_SECONDS = 3.9; // ease-out + hold ≈ 5s total time spent looking away
const GAZE_YAW_MAX_DEG = 7; // peak horizontal deflection — small enough to avoid range-map saturation
const GAZE_PITCH_MAX_DEG = 3; // peak vertical deflection

const ARM_SWAY_FADE_SECONDS = 0.45; // fade the whole speaking arm-sway effect in/out over this long

// Ease-in-out (slow start, fast middle, slow finish) rather than exponential
// decay — pure exponential decay has its LARGEST step on the very first
// frame after retargeting, which for a short, small-amplitude glance reads
// as "snap into position, then a long imperceptible crawl" instead of a
// genuinely smooth motion.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Full close+open blink cycle duration — was implicitly ~0.12s (frame-count based).
const BLINK_DURATION_SECONDS = 0.35;

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
  const rawLoadedAnimations: Record<string, { type: 'fbx' | 'glb', data: THREE.Group | GLTFResult }> = {};

  if (animationUrls) {
    Object.entries(animationUrls).forEach(([name, url]) => {
      const extension = url.toLowerCase().split('.').pop();

      if (extension === 'fbx') {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const fbxData = useFBX(url);
        rawLoadedAnimations[name] = { type: 'fbx', data: fbxData };
      } else if (extension === 'glb' || extension === 'gltf') {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const gltfData = useGLTF(url) as GLTFResult;
        rawLoadedAnimations[name] = { type: 'glb', data: gltfData };
      }
    });
  }

  // Stabilize the returned object's identity across renders (Phase 11 fix). useFBX/useGLTF
  // already return cached, stable `data` references per URL via drei's loader cache, but the
  // plain object literal wrapping them above was rebuilt on every render. Every downstream
  // useMemo keyed on this return value (processedClips, boneMaskedClips) therefore recomputed
  // on every render too, minting fresh THREE.AnimationClip UUIDs each time. The bone-masked
  // upper-layer effect treats a new clip UUID as "the animation changed" and restarts its
  // 0.3s crossfade from scratch — with renders arriving faster than fades could settle, this
  // produced a perpetually-restarting, overlapping crossfade (visible as the torso jittering/
  // over-bending and dropped frames from constant AnimationAction/PropertyMixer churn).
  //
  // A useMemo dependency array's length must stay constant across renders (code review
  // WR-04) — spreading `dataRefs` (whose length tracks the current animation-key count)
  // violates that whenever the key set changes between renders. Manual ref-based
  // memoization avoids the variable-length-array requirement entirely.
  const dataRefs = Object.values(rawLoadedAnimations).map((entry) => entry.data);
  const nameKey = Object.keys(rawLoadedAnimations).join(",");
  const stableRef = useRef<{ nameKey: string; dataRefs: unknown[]; result: typeof rawLoadedAnimations } | null>(null);
  const prev = stableRef.current;
  const unchanged =
    prev !== null &&
    prev.nameKey === nameKey &&
    prev.dataRefs.length === dataRefs.length &&
    prev.dataRefs.every((d, i) => d === dataRefs[i]);
  if (!unchanged) {
    stableRef.current = { nameKey, dataRefs, result: rawLoadedAnimations };
  }
  return stableRef.current!.result;
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
  enableMicroExpressions = true,
  ...props
}: VRMAvatarProps) {
  const { setVrm, expressions, currentAnimation, animate, chatStatus, realtimeProvider } = useKhavee();
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const expressionTargetsRef = useRef<Record<string, number>>({});

  // Bone-masked layering refs (Phase 11)
  /** Always-on lower-body (hips/spine/legs) action — never swapped on chatStatus transitions (D-01). */
  const baseActionRef = useRef<THREE.AnimationAction | null>(null);
  /** Upper-body (chest/neck/head/arms) action — crossfades between idle-upper and gesture clips (D-02). */
  const upperActionRef = useRef<THREE.AnimationAction | null>(null);
  /** Provenance: the last animation key selected from WITHIN the chatStatus auto-mapping effect
   *  (including speaking variants + keyword-matched picks, per resolved Open Q1/A1). Used to
   *  distinguish status-driven keys (bone-masked path) from developer animate('custom') calls
   *  (whole-skeleton path, D-04). */
  const statusDrivenKeyRef = useRef<string | null>(null);
  /** Previous `isBoneMaskingActive()` result — lets the weight-coordination effect tell
   *  "just re-entered masked mode from the custom whole-skeleton path" (needs an instant
   *  weight restore) apart from "already in masked mode, switching gestures" (must NOT
   *  touch weight, or it cancels the in-flight fadeIn/fadeOut — see setEffectiveWeight fix). */
  const prevMaskingActiveRef = useRef(false);
  /** Bumped every time `statusDrivenKeyRef.current` is (re)assigned. React bails out of
   *  re-rendering when `animate(targetKey)` sets `currentAnimation` to a value it already
   *  holds (e.g. the very first "ready" -> "idle" transition, since "idle" is
   *  KhaveeProvider's default) — so the masking-dependent effects below, which only
   *  depend on `currentAnimation`/`boneMaskedClips`, would never re-run to notice that
   *  `statusDrivenKeyRef` just changed. This counter is real state, so incrementing it
   *  always triggers a re-render, forcing those effects to re-evaluate
   *  `isBoneMaskingActive()` on every status-driven pick, not just ones that also happen
   *  to change `currentAnimation`'s value. */
  const [statusDrivenEpoch, setStatusDrivenEpoch] = useState(0);

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
  const armSwayTimeRef = useRef(0);
  /** Fades the whole arm-sway effect in/out over ARM_SWAY_FADE_SECONDS instead
   *  of snapping to full/zero amplitude the instant chatStatus flips. */
  const armSwayWeightRef = useRef(0);
  const armSwayWeightStartRef = useRef(0);
  const armSwayWeightTargetRef = useRef(0);
  const armSwayWeightTimeRef = useRef(0);
  /** Occasional emphasis burst — a brief, larger sway pulse on top of the
   *  steady sway, at a random interval while speaking. Same scheduler shape
   *  as the listening-state nod (nextNodTimeRef/nodActiveRef/etc.) below. */
  const armBurstActiveRef = useRef(false);
  const armBurstProgressRef = useRef(0);
  const armBurstDurationRef = useRef(1.0);
  const nextArmBurstTimeRef = useRef(5);

  // Idle gaze-away state (D-05)
  const idleTimeRef = useRef(0);
  const gazePhaseRef = useRef<"waiting" | "away">("waiting");
  const gazeDwellTimeRef = useRef(0);
  const gazeAwayAmountRef = useRef(0);
  const gazeAwayOffsetRef = useRef({ x: 0, y: 0 });
  /** Amount value captured at the start of the current ease-in-out leg — lets a
   *  leg be re-based mid-flight (glance interrupted, or naturally finished)
   *  without a discontinuity, since the new leg always eases FROM wherever the
   *  amount actually is, not from an assumed 0 or 1. */
  const gazeLegStartRef = useRef(0);
  const gazeLegTargetRef = useRef(0);
  const gazeLegTimeRef = useRef(0);
  const gazeLegDurationRef = useRef(GAZE_EASE_SECONDS);

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

  // Derive bone-masked base-lower + per-key upper-body sub-clips from processedClips
  // (Phase 11, D-01/D-02). Memoized on [processedClips, currentVrm] — MUST NOT be
  // recomputed in render body or useFrame (Pitfall 3: AnimationClip UUID churn leaks
  // AnimationAction/PropertyMixer pairs and breaks crossfade continuity every render).
  const boneMaskedClips = useMemo(() => {
    if (!currentVrm || processedClips.length === 0) {
      return null;
    }

    const idleClip = processedClips.find((c) => c?.name === "idle");
    if (!idleClip) {
      // Code review IN-01: without this, bone-masking silently and permanently
      // falls back to the whole-skeleton path with no indication why.
      console.warn(
        "[VRM Animation] No 'idle' animation key found — bone-masked upper-body layering is disabled; falling back to whole-skeleton crossfade."
      );
    }
    const baseLowerCandidate = idleClip
      ? filterClipTracksByBoneSet(idleClip, currentVrm, BASE_LOWER_BONES, "base-lower")
      : null;
    // Pitfall 5 fallback (code review WR-03): a zero-track baseLower (e.g.
    // currentVrm.humanoid unexpectedly falsy) would otherwise be treated as "present"
    // by isBoneMaskingActive()'s null-check alone, activating masking and gating out
    // the whole-skeleton path while nothing actually drives the lower body — silently
    // freezing hips/spine/legs instead of falling back gracefully.
    const baseLower =
      baseLowerCandidate && baseLowerCandidate.tracks.length > 0 ? baseLowerCandidate : null;

    const upperByKey: Record<string, THREE.AnimationClip> = {};
    processedClips.forEach((clip) => {
      if (!clip) return;
      const upperClip = filterClipTracksByBoneSet(clip, currentVrm, UPPER_BONES, `${clip.name}-upper`);
      // D-05/Pitfall 5 fallback: zero matched tracks means this clip's node names never
      // appeared in the resolved set (non-Mixamo GLB, arbitrary bone names) — mark
      // unmaskable so the caller falls back to the existing whole-skeleton path.
      if (upperClip.tracks.length > 0) {
        upperByKey[clip.name] = upperClip;
      }
    });

    return { baseLower, upperByKey };
  }, [processedClips, currentVrm]);

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
        // Phase 11 fix: baseActionRef/upperActionRef MUST also be cleared here.
        // React Strict Mode (Next.js dev default) double-invokes effects with
        // cleanups — mount, cleanup, mount again — even on the very first render.
        // The base-lower action's OWN effect only ever creates it once, guarded
        // by `if (... || baseActionRef.current) return;`. If that first creation
        // raced ahead of Strict Mode's simulated remount here, the guard sees a
        // non-null baseActionRef and never rebinds it to the NEW mixer created
        // above — permanently orphaning it against a discarded, no-longer-updated
        // mixer. Its .time then never advances again (frozen lower body/spine)
        // while the upper body keeps animating normally, producing an incoherent,
        // "weirdly bending" torso even at idle rest (checkpoint feedback).
        baseActionRef.current = null;
        upperActionRef.current = null;
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

  // Base-lower action: created once, always playing at weight 1, never swapped
  // (Phase 11, D-01). No fadeIn on first-ever activation — mirrors the existing
  // whole-skeleton effect's cold-start handling to avoid a bind-pose ghost (Pitfall 1).
  useEffect(() => {
    if (!mixerRef.current || !boneMaskedClips?.baseLower || baseActionRef.current) return;

    const action = mixerRef.current.clipAction(boneMaskedClips.baseLower);
    action.reset().play();
    baseActionRef.current = action;
  }, [boneMaskedClips]);

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
        // Phase 11 (Open Q1/A1): mark this key as status-driven so it takes the
        // bone-masked upper path instead of the D-04 whole-skeleton custom path.
        statusDrivenKeyRef.current = pick;
        // Only bump the epoch when `pick` won't actually change `currentAnimation`
        // (React bails out of re-rendering on a same-value setState, which would
        // otherwise leave the masking-dependent effects unaware this ref changed).
        // Bumping it unconditionally — even when the key IS changing — forces an
        // extra, premature re-render where statusDrivenKeyRef has already moved on
        // but currentAnimation/context hasn't propagated yet, producing one frame
        // of inconsistent state that corrupted the crossfade weight coordination.
        if (pick === currentAnimation) setStatusDrivenEpoch((e) => e + 1);
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
                // Phase 11 (Open Q1/A1): keyword-matched picks are status-driven too.
                statusDrivenKeyRef.current = matchedKey;
                // See the epoch-bump note above the speaking-variant pick — only needed
                // when the key isn't actually changing.
                if (matchedKey === currentAnimation) setStatusDrivenEpoch((e) => e + 1);
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
        // Phase 11 (Open Q1/A1): the else-branch targetKey (idle/listening/thinking) is status-driven.
        statusDrivenKeyRef.current = targetKey;
        // See the epoch-bump note above the speaking-variant pick — only needed
        // when the key isn't actually changing (e.g. the very first "ready" -> "idle"
        // transition, since "idle" is already KhaveeProvider's default).
        if (targetKey === currentAnimation) setStatusDrivenEpoch((e) => e + 1);
        animate(targetKey);
      }
    }
  }, [chatStatus, animate, realtimeProvider]);

  // Phase 11 (D-01/D-02/D-04/D-05): is currentAnimation a status-driven key with a
  // maskable upper-body clip available? When true, the bone-masked base-lower +
  // upper-layer path drives the mixer for this key and the whole-skeleton path below
  // must NOT also drive it (Pitfall 2 / Open Q2). When false (custom animate() key,
  // or no maskable clips / no idle clip available), the OLD whole-skeleton behavior
  // remains fully intact (D-04 exemption + Pitfall 5 fallback).
  function isBoneMaskingActive(): boolean {
    if (!currentAnimation || statusDrivenKeyRef.current !== currentAnimation) return false;
    if (!boneMaskedClips?.baseLower) return false;
    return Boolean(
      boneMaskedClips.upperByKey[currentAnimation] || boneMaskedClips.upperByKey["idle"]
    );
  }

  // Handle animation switching with proper crossfading (D-04: custom/non-status keys only,
  // once bone-masking is active for a key — Phase 11 gate added below, dependency array
  // unconditionally includes boneMaskedClips so a late-arriving boneMaskedClips re-fires
  // this effect and cannot leave a stale unfiltered whole-skeleton action fighting the
  // new base-lower/upper actions on shared hips/spine/leg tracks).
  useEffect(() => {
    if (isBoneMaskingActive()) {
      // Bone-masking owns this status-driven key — cede the whole-skeleton path.
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.3);
        currentActionRef.current = null;
      }
      return;
    }

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
    // avatar stuck in its raw bind pose. boneMaskedClips is also included
    // (Phase 11) so the whole-skeleton gate above re-evaluates once masked
    // clips arrive asynchronously. statusDrivenEpoch forces re-evaluation on
    // same-value status picks that React would otherwise bail out of.
  }, [currentAnimation, processedClips, boneMaskedClips, statusDrivenEpoch]);

  // Upper-layer crossfade effect (Phase 11, D-02/D-05/D-06): drives upperActionRef
  // between idle-upper and the current status-driven gesture's upper-filtered clip.
  // Reuses the exact 0.3s fade pattern from the whole-skeleton effect above, scoped
  // to upper-only clips.
  useEffect(() => {
    if (!mixerRef.current || !boneMaskedClips) return;

    // Cross-path weight coordination (Phase 11, Pitfall 2 / Open Q2 — REQUIRED):
    // when bone-masking is active, the base action is authoritative (weight 1);
    // when a custom whole-skeleton key is authoritative, cede weight to 0 so the
    // unfiltered custom clip's hips/spine/leg tracks don't fight the always-on
    // base-lower action's PropertyMixers. Use setEffectiveWeight, not .stop() (Open Q2/A2).
    //
    // This MUST run before the `!upperClip` early return below (code review WR-02):
    // that early return fires whenever the "idle" D-05 fallback upper clip doesn't
    // exist, which can happen independently of baseLower's own availability — skipping
    // this block in that case would leave baseActionRef fighting an unfiltered custom
    // clip's hips/spine/leg tracks with no weight coordination at all.
    const maskingActive = isBoneMaskingActive();
    baseActionRef.current?.setEffectiveWeight(maskingActive ? 1 : 0);
    if (!maskingActive) {
      // Custom whole-skeleton key is authoritative — cede weight immediately.
      upperActionRef.current?.setEffectiveWeight(0);
    }

    // D-05: fall back to idle-upper whenever no gesture status is active or the
    // current status key has no maskable upper clip (Pitfall 5 non-Mixamo edge case).
    const upperKey =
      statusDrivenKeyRef.current === currentAnimation &&
      currentAnimation &&
      boneMaskedClips.upperByKey[currentAnimation]
        ? currentAnimation
        : "idle";

    const upperClip = boneMaskedClips.upperByKey[upperKey];
    if (!upperClip) {
      prevMaskingActiveRef.current = maskingActive;
      return;
    }

    const newUpperAction = mixerRef.current.clipAction(upperClip);
    // Tracks whether a fade was scheduled THIS pass — code review WR-01.
    let fadeScheduledThisPass = false;

    if (!upperActionRef.current) {
      // First-ever activation: snap to weight 1 immediately (no fadeIn), matching
      // the whole-skeleton effect's cold-start handling (Pitfall 1).
      newUpperAction.reset().play();
    } else if (upperActionRef.current !== newUpperAction) {
      upperActionRef.current.fadeOut(0.3);
      newUpperAction.reset().fadeIn(0.3).play();
      fadeScheduledThisPass = true;
    }
    upperActionRef.current = newUpperAction;

    // IMPORTANT: setEffectiveWeight() calls THREE's AnimationAction.stopFading()
    // internally, cancelling any in-flight fadeIn/fadeOut interpolant and snapping
    // weight to the given value immediately. Calling it unconditionally here —
    // including right after scheduling a fadeIn() a few lines above on that SAME
    // action — cancelled every upper-layer crossfade before it could animate, so
    // gesture transitions just snapped instead of blending (checkpoint feedback).
    //
    // Only restore-to-1 when recovering from the custom whole-skeleton path AND no
    // fade was just scheduled this pass (code review WR-01): if a custom animate()
    // call is immediately followed by a DIFFERENT gesture than whatever was active
    // before it (e.g. idle -> dance -> listening), `newUpperAction` is a fresh action
    // whose own fadeIn already governs its weight from 0 — forcing it to 1 here would
    // cancel that fade and produce an instant pop instead of a 0.3s crossfade. When the
    // upper action identity DIDN'T change (e.g. idle -> dance -> idle, same action),
    // no fade was scheduled to bring weight back up, so the instant snap is correct.
    if (maskingActive && !prevMaskingActiveRef.current && !fadeScheduledThisPass) {
      upperActionRef.current?.setEffectiveWeight(1);
    }
    prevMaskingActiveRef.current = maskingActive;
  }, [currentAnimation, boneMaskedClips, statusDrivenEpoch]);

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

  // Eye gaze lifecycle (D-05).
  //
  // Root cause of the earlier persistent "eyes still moving" reports:
  // vrm.lookAt's target-based mode is a *compensation* system — every
  // vrm.update() call it recomputes eye rotation from scratch to keep
  // pointing at a world-space target given the head's CURRENT world
  // transform. Breathing, head micro-movement, nodding, and thinking-tilt
  // all rotate the head bone earlier in the same frame (Pitfall 1 ordering),
  // so even a perfectly static target produced perpetual counter-rotation as
  // the eyes chased a head that never stops subtly moving.
  //
  // Fix: never use target/autoUpdate at all. yaw/pitch are driven directly,
  // every frame, in the useFrame state machine below (0,0 at rest = looking
  // forward at the camera, since that's the model's default orientation) —
  // fully decoupled from head transform, so there's nothing to chase.
  useEffect(() => {
    if (!currentVrm || !currentVrm.lookAt) return;
    currentVrm.lookAt.target = null;
    currentVrm.lookAt.autoUpdate = false;
    currentVrm.lookAt.reset();

    if (!enableEyeGaze) return;

    gazePhaseRef.current = "waiting";
    idleTimeRef.current = 0;
    gazeAwayAmountRef.current = 0;
    gazeLegStartRef.current = 0;
    gazeLegTargetRef.current = 0;
    gazeLegTimeRef.current = 0;
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

    // Speaking arm/shoulder sway: continuous, naturally varying. The point of
    // this layer is to make "talking" read as alive/expressive rather than as
    // a scripted full-body gesture clip swap — the same problem breathing and
    // head-movement already solve for the idle case, just applied to the arms
    // during speech.
    //
    // NOT driven by rawVolume/currentVolume: TTS voices are loudness-
    // compressed within an utterance — they don't have real quiet/loud
    // swings the way emphatic human speech does, so a volume-scaled version
    // of this just behaved like a binary "speaking vs. paused" gate rather
    // than the expressive variation that was the actual goal. Instead,
    // armIntensity is a slow envelope built from two incommensurate
    // frequencies (0.35 and 0.13 rad/s don't share a short common period),
    // so it drifts between calmer and more animated stretches over several
    // seconds without ever feeling like an obviously repeating loop or
    // depending on an audio signal that isn't actually that expressive.
    //
    // The whole effect is additionally scaled by armSwayWeightRef, an eased
    // leg (same technique as the gaze system) that fades in/out over
    // ARM_SWAY_FADE_SECONDS instead of snapping to full/zero amplitude the
    // instant chatStatus flips — without this, starting a new sentence
    // (going idle -> speaking) or finishing one (speaking -> idle) applied a
    // sudden, non-zero rotation delta in a single frame, which read as the
    // arm "snapping" into or out of the gesture.
    {
      const armSwayTarget = chatStatus === "speaking" ? 1 : 0;
      if (armSwayTarget !== armSwayWeightTargetRef.current) {
        armSwayWeightTargetRef.current = armSwayTarget;
        armSwayWeightStartRef.current = armSwayWeightRef.current;
        armSwayWeightTimeRef.current = 0;
      }
      armSwayWeightTimeRef.current += delta;
      const weightT = easeInOutCubic(
        Math.min(armSwayWeightTimeRef.current / ARM_SWAY_FADE_SECONDS, 1)
      );
      armSwayWeightRef.current =
        armSwayWeightStartRef.current +
        (armSwayWeightTargetRef.current - armSwayWeightStartRef.current) * weightT;

      // Emphasis burst scheduler: only ticks/triggers while actually
      // speaking (mirrors the listening-nod scheduler's reset-while-inactive
      // pattern), but a burst already in flight is allowed to finish playing
      // out — its own smooth sin(progress * PI) shape means it can't pop,
      // and the overall armSwayWeightRef fade-out (above) already handles
      // bringing everything smoothly to zero if speaking ends mid-burst.
      let armBurstBoost = 0;
      if (chatStatus === "speaking") {
        nextArmBurstTimeRef.current -= delta;
        if (!armBurstActiveRef.current && nextArmBurstTimeRef.current <= 0) {
          armBurstActiveRef.current = true;
          armBurstProgressRef.current = 0;
          armBurstDurationRef.current = 0.8 + Math.random() * 0.6;
          nextArmBurstTimeRef.current = 4 + Math.random() * 5;
        }
      } else if (!armBurstActiveRef.current) {
        nextArmBurstTimeRef.current = 4 + Math.random() * 5;
      }
      if (armBurstActiveRef.current) {
        armBurstProgressRef.current += delta / armBurstDurationRef.current;
        if (armBurstProgressRef.current >= 1) {
          armBurstProgressRef.current = 1;
          armBurstActiveRef.current = false;
        }
        armBurstBoost = Math.sin(armBurstProgressRef.current * Math.PI) * 0.8;
      }

      if (currentVrm.humanoid && armSwayWeightRef.current > 0.001) {
        armSwayTimeRef.current += delta;
        const armIntensity =
          THREE.MathUtils.clamp(
            0.65 +
              Math.sin(armSwayTimeRef.current * 0.35) * 0.25 +
              Math.sin(armSwayTimeRef.current * 0.13 + 1.7) * 0.15,
            0.3,
            1.05
          ) *
          (1 + armBurstBoost) *
          armSwayWeightRef.current;

        const swayLeft =
          (Math.sin(armSwayTimeRef.current * 0.9) * 0.14 +
            Math.sin(armSwayTimeRef.current * 1.7) * 0.05) *
          armIntensity;
        const swayRight =
          (Math.sin(armSwayTimeRef.current * 0.9 + Math.PI * 0.6) * 0.14 +
            Math.sin(armSwayTimeRef.current * 1.7 + Math.PI * 0.3) * 0.05) *
          armIntensity;
        const liftLeft = Math.sin(armSwayTimeRef.current * 0.5) * 0.08 * armIntensity;
        const liftRight =
          Math.sin(armSwayTimeRef.current * 0.5 + Math.PI * 0.4) * 0.08 * armIntensity;
        const elbowLeft =
          (Math.sin(armSwayTimeRef.current * 0.7 + Math.PI * 0.2) * 0.5 + 0.5) *
          0.22 *
          armIntensity;
        const elbowRight =
          (Math.sin(armSwayTimeRef.current * 0.7 + Math.PI * 0.9) * 0.5 + 0.5) *
          0.22 *
          armIntensity;

        const leftUpperArm = currentVrm.humanoid.getNormalizedBoneNode("leftUpperArm" as any);
        if (leftUpperArm) {
          armQuatZ.setFromAxisAngle(scratchZ, swayLeft);
          armQuatX.setFromAxisAngle(scratchX, liftLeft);
          leftUpperArm.quaternion.multiply(armQuatZ).multiply(armQuatX);
        }
        const rightUpperArm = currentVrm.humanoid.getNormalizedBoneNode("rightUpperArm" as any);
        if (rightUpperArm) {
          armQuatZ.setFromAxisAngle(scratchZ, -swayRight);
          armQuatX.setFromAxisAngle(scratchX, liftRight);
          rightUpperArm.quaternion.multiply(armQuatZ).multiply(armQuatX);
        }
        const leftLowerArm = currentVrm.humanoid.getNormalizedBoneNode("leftLowerArm" as any);
        if (leftLowerArm) {
          armQuatX.setFromAxisAngle(scratchX, elbowLeft);
          leftLowerArm.quaternion.multiply(armQuatX);
        }
        const rightLowerArm = currentVrm.humanoid.getNormalizedBoneNode("rightLowerArm" as any);
        if (rightLowerArm) {
          armQuatX.setFromAxisAngle(scratchX, elbowRight);
          rightLowerArm.quaternion.multiply(armQuatX);
        }
      } else {
        armSwayTimeRef.current = 0;
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

    // Idle gaze-away state machine (D-05). Only progresses while
    // enableEyeGaze is on (see lifecycle effect above for why target/
    // autoUpdate are never touched — yaw/pitch are driven directly instead).
    //
    // gazeAwayAmountRef is ALWAYS driven by an ease-in-out-cubic "leg" (start
    // value -> target value over some duration) — never teleported/frozen
    // mid-motion. "Urgent" transitions (starting/listening/speaking) just use
    // a SHORTER leg duration (GAZE_HARD_RESET_EASE_SECONDS) — still a real,
    // visible glide, just a fast one.
    //
    // Whenever the desired target (0 or 1) changes — glance triggered, glance
    // naturally finished, interrupted mid-flight by a status change, or a
    // hard reset — a fresh leg is re-based FROM THE CURRENT AMOUNT, so
    // there's never a discontinuity even if retargeted before a leg finishes.
    if (enableEyeGaze && currentVrm.lookAt) {
      const isUrgent =
        chatStatus === "starting" || chatStatus === "listening" || chatStatus === "speaking";

      if (isUrgent || (chatStatus !== "ready" && chatStatus !== "stopped")) {
        // Urgent (starting/listening/speaking) or a softer cancel (e.g.
        // "thinking") — either way the cycle stops and eases back to center;
        // only the leg duration chosen below differs.
        idleTimeRef.current = 0;
        gazePhaseRef.current = "waiting";
      } else if (gazePhaseRef.current === "waiting") {
        idleTimeRef.current += delta;
        if (idleTimeRef.current >= IDLE_GAZE_DELAY_SECONDS) {
          gazePhaseRef.current = "away";
          gazeDwellTimeRef.current = 0;
          // Random peak yaw/pitch (in degrees) for this glance, each within
          // its own small max — see the GAZE_*_MAX_DEG comment above for why
          // these stay deliberately small.
          gazeAwayOffsetRef.current = {
            x: (Math.random() * 2 - 1) * GAZE_YAW_MAX_DEG,
            y: (Math.random() * 2 - 1) * GAZE_PITCH_MAX_DEG,
          };
        }
      } else if (gazePhaseRef.current === "away") {
        gazeDwellTimeRef.current += delta;
        if (gazeDwellTimeRef.current >= GAZE_EASE_SECONDS + GAZE_HOLD_SECONDS) {
          gazePhaseRef.current = "waiting";
          idleTimeRef.current = 0;
        }
      }

      const desiredTarget = gazePhaseRef.current === "away" ? 1 : 0;
      if (desiredTarget !== gazeLegTargetRef.current) {
        gazeLegTargetRef.current = desiredTarget;
        gazeLegStartRef.current = gazeAwayAmountRef.current;
        gazeLegTimeRef.current = 0;
        gazeLegDurationRef.current =
          desiredTarget === 1
            ? GAZE_EASE_SECONDS
            : isUrgent
              ? GAZE_HARD_RESET_EASE_SECONDS
              : GAZE_RETURN_EASE_SECONDS;
      }
      gazeLegTimeRef.current += delta;
      const legT = easeInOutCubic(
        Math.min(gazeLegTimeRef.current / gazeLegDurationRef.current, 1)
      );
      gazeAwayAmountRef.current =
        gazeLegStartRef.current + (gazeLegTargetRef.current - gazeLegStartRef.current) * legT;

      currentVrm.lookAt.yaw = gazeAwayOffsetRef.current.x * gazeAwayAmountRef.current;
      currentVrm.lookAt.pitch = gazeAwayOffsetRef.current.y * gazeAwayAmountRef.current;
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
        // Frame-rate independent: full close+open cycle takes BLINK_DURATION_SECONDS
        // (was a fixed +0.15/frame, i.e. ~0.12s at 60fps — read as an abrupt flicker).
        blinkAnimationRef.current += delta / BLINK_DURATION_SECONDS;
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
