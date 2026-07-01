# Phase 10: Avatar Animation Naturalness — Procedural Life Layer - Research

**Researched:** 2026-07-01
**Domain:** @pixiv/three-vrm v3 bone/lookAt API, React Three Fiber useFrame patterns, VRM expression system
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Key-name exact match. If an animation key in the `animations` prop is exactly `'idle'`, `'listening'`, `'thinking'`, or `'speaking'`, the SDK auto-plays it when `chatStatus` changes to that value.
- **D-02:** Speaking variety via name-pattern matching. When `chatStatus` is `'speaking'`, the SDK randomly picks from ALL animation keys whose name contains `'speak'`, `'talk'`, or `'gesture'` (case-insensitive). New random one selected on each new speaking turn.
- **D-03:** Fallback: if no matching animation key found, do nothing (no error).
- **D-04:** Individual boolean props on `VRMAvatar`, all defaulting to `true`. New props: `enableBreathing`, `enableHeadMovement`, `enableEyeGaze`, `enableMicroExpressions`, `enableHandGestures`. Existing `enableBlinking` stays.
- **D-05:** Eye gaze via `vrm.lookAt.target` (invisible drifting `THREE.Object3D`). Do NOT drive eye bones directly.
- **D-06:** Additive bone deltas on top of FBX, applied after `mixer.update(delta)`. Breathing: `Math.sin(time * breathSpeed) * breathAmp` on `spine` and `chest` rotation (±0.015–0.025 rad). Head: smooth noise on `head` rotation.x/y (±0.02–0.04 rad, ~0.2–0.5 Hz).
- **D-07:** Built-in micro-expression schedule: `listening` → happy (0.10–0.15) + surprised (0.04–0.06); `thinking` → neutral (0.08–0.12); `idle` → relaxed (0.06–0.10); `speaking` → none. Change every 3–8 s with slow lerp.
- **D-08:** Procedural finger curl noise on proximal finger bones. Each finger unique phase offset. Amplitude ~0.015–0.025 rad, frequency ~0.6–1.2 Hz.
- **D-09:** FBX/GLB loading pipeline preserved unchanged. All layers additive, operate after mixer updates.

### Claude's Discretion

None specified — all major decisions are locked.

### Deferred Ideas (OUT OF SCOPE)

- Tunable amplitude/speed per procedural layer (e.g. `breathingSpeed`, `headMovementIntensity`)
- Developer-configurable micro-expression schedule
- Blend tree / state machine for animation graphs
- Physics-based hair/cloth simulation
- ML-based motion retargeting
</user_constraints>

---

## Summary

Phase 10 adds a procedural life layer inside `VRMAvatar.tsx` using only already-installed dependencies (`@pixiv/three-vrm` 3.4.2, `three` 0.180.0, `@react-three/fiber`). No new packages are required. All new code lives in the single `useFrame` callback and a small number of supporting `useRef`s and `useEffect`s — the same pattern as the existing blinking system.

The critical technical finding is the **additive bone delta order of operations**: the existing `remapMixamoAnimationToVrm` utility targets VRM **normalized bones** (not raw bones) with `QuaternionKeyframeTrack`. Therefore procedural bone deltas must be applied to normalized bones (via `vrm.humanoid.getNormalizedBoneNode`) AFTER `mixer.update(delta)` but BEFORE `vrm.update(delta)`. `vrm.update()` then transfers the composed (animation + procedural) normalized quaternion to raw bones. Any deltas applied after `vrm.update()` would stay in raw bones but be immediately overwritten by the next frame's `mixer.update()` + `vrm.update()` cycle.

An open question for the planner: `ChatStatus` does NOT include an `'idle'` value — the actual values are `'ready' | 'speaking' | 'listening' | 'thinking' | 'stopped' | 'starting'`. Decision D-01 references an `'idle'` chatStatus that does not exist. The planner must decide: does the `'idle'` animation key trigger on `'ready'`, on `'stopped'`, or on both?

**Primary recommendation:** Apply all procedural bone deltas to `vrm.humanoid.getNormalizedBoneNode(name)?.quaternion` between `mixer.update(delta)` and `vrm.update(delta)`. Use `useEffect([chatStatus])` (not useFrame) for chatStatus→animation auto-mapping to avoid stale closures.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Procedural bone animation (breathing, head, fingers) | Browser/Client (useFrame) | — | Per-frame delta applied to Three.js scene graph in the render loop |
| Eye gaze (lookAt) | Browser/Client (useFrame via vrm.update) | — | VRM built-in lookAt.update() runs inside vrm.update(delta) |
| Micro-expression schedule | Browser/Client (useFrame) | — | setValue + lerp inside the same useFrame loop |
| chatStatus → animation auto-mapping | Browser/Client (useEffect) | — | React effect watching context value, calls existing animate() |
| Speaking variety random pick | Browser/Client (useEffect on chatStatus) | — | Fires once per speaking turn transition |
| ChatStatus source | `KhaveeProvider` React context | — | Already exists; VRMAvatar reads via `useKhavee().chatStatus` |

---

## Standard Stack

### Core (all already installed — no new installs)

| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| `@pixiv/three-vrm` | 3.4.2 | VRM humanoid bone access, lookAt, expressionManager | [VERIFIED: npm registry] — confirmed from node_modules |
| `three` | ^0.180.0 | `THREE.Object3D`, `THREE.Quaternion`, `THREE.Euler` for bone manipulation | [VERIFIED: npm registry] |
| `@react-three/fiber` | ^9.3.0 | `useFrame` — per-frame animation loop | [VERIFIED: npm registry] |

### No New Packages

This phase installs zero new dependencies. All required APIs exist in the already-installed `@pixiv/three-vrm` 3.4.2.

---

## Package Legitimacy Audit

No new packages are installed in this phase. Section not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
useEffect([chatStatus])
  └─► match animations prop keys
        └─► animate(name)  ──►  KhaveeProvider.setCurrentAnimation
                                     └─► useEffect([currentAnimation]) in VRMAvatar
                                               └─► mixer.clipAction(clip).fadeIn.play()

useFrame(delta):
  ① mixer.update(delta)           ← FBX/GLB animation drives normalized bone quaternions
  ② getNormalizedBoneNode()       ← apply breathing / head / finger procedural deltas
      .quaternion.multiply(deltaQ)    to NORMALIZED bones (before humanoid.update copies them)
  ③ expressionManager.setValue()  ← micro-expressions (+ blinking, already exists)
  ④ vrm.update(delta)             ← humanoid.update() copies normalized→raw
                                     lookAt.update() tracks gazeTarget Object3D
                                     expressionManager.update() flushes expression values
```

### Recommended Project Structure

No new files. All changes go into:

```
packages/react/src/
├── VRMAvatar.tsx          ← ALL new code (props, useRefs, useEffect, useFrame additions)
└── KhaveeProvider.tsx     ← No changes (chatStatus already exposed)
packages/core/src/types/
└── conversation.ts        ← No changes needed (ChatStatus already has all needed values)
```

### Pattern 1: Additive Bone Delta via Normalized Bone Quaternion

**What:** Apply a small procedural rotation to a VRM humanoid normalized bone by multiplying its quaternion with a delta quaternion. Done AFTER mixer.update() but BEFORE vrm.update().

**When to use:** Breathing (spine, chest), head micro-movement (head), finger curl (finger proximal bones).

**Example:**
```typescript
// Source: verified from @pixiv/three-vrm 3.4.2 source (lib/three-vrm.module.js:2005-2013)
// Pre-allocate per-frame scratch objects as module-level or ref constants to avoid GC pressure
const _scratchAxis = new THREE.Vector3(1, 0, 0);
const _scratchQuat = new THREE.Quaternion();

// Inside useFrame, after mixer.update(delta):
const spine = currentVrm.humanoid.getNormalizedBoneNode("spine");
if (spine) {
  const breathOffset = Math.sin(timeRef.current * 1.2) * 0.018;
  _scratchQuat.setFromAxisAngle(_scratchAxis, breathOffset);
  spine.quaternion.multiply(_scratchQuat);
}
```

**Why BEFORE vrm.update():** `remapMixamoAnimationToVrm` creates `QuaternionKeyframeTrack` targeting the normalized bone's Three.js node name. After `mixer.update(delta)`, the normalized bone quaternion has animation data. We compound our delta into that quaternion. Then `vrm.update(delta)` → `humanoid.update()` copies the composed (animation + procedural) quaternion to raw bones. [VERIFIED: confirmed by reading three-vrm.module.js:1780, 2022, 3117-3130 and remapMixamoAnimationToVrm.ts:37]

### Pattern 2: Eye Gaze via vrm.lookAt.target

**What:** Assign an invisible `THREE.Object3D` to `vrm.lookAt.target`. Move it with slow smooth noise each frame (BEFORE vrm.update). VRM's `lookAt.update(delta)` inside `vrm.update()` reads `target.getWorldPosition()` and rotates eyes appropriately.

**Example:**
```typescript
// Source: verified from three-vrm.module.js:2575-2576, 2411-2420, 2485
// In useEffect when VRM loads:
const gazeObj = new THREE.Object3D();
gazeObj.position.set(0, 1.6, 2.0); // Start at eye-level, in front
currentVrm.scene.add(gazeObj);      // Add to VRM scene for world-position tracking
gazeTargetRef.current = gazeObj;
currentVrm.lookAt.target = gazeObj;
currentVrm.lookAt.autoUpdate = true; // Already true by default

// In useFrame, BEFORE vrm.update(delta):
if (enableEyeGaze && gazeTargetRef.current && currentVrm.lookAt) {
  const t = gazeTimeRef.current;
  const x = Math.sin(t * 0.23 + 1.1) * 0.3 + Math.sin(t * 0.11) * 0.15;
  const y = 1.6 + Math.sin(t * 0.17 + 0.5) * 0.15;
  gazeTargetRef.current.position.set(x, y, 2.0);
}
// vrm.update(delta) then calls lookAt.update(delta) which reads target position
```

**Important:** `vrm.lookAt.target` is `THREE.Object3D | null`. The VRM internally calls `target.getWorldPosition()`, so the object must exist in a scene (or at least have valid world matrix). Adding it to `currentVrm.scene` is the safest approach.

**autoUpdate:** Defaults to `true`. When true, `lookAt.update(delta)` calls `this.lookAt(target.getWorldPosition(...))` automatically. Do NOT call `vrm.lookAt.lookAt()` manually if autoUpdate is on — it will be immediately overwritten.

### Pattern 3: chatStatus → Animation Auto-Mapping via useEffect

**What:** Watch `chatStatus` from context via `useEffect`. On transition to a speaking/listening/thinking/ready state, check the `animations` prop keys and call `animate()` if a match exists.

**Example:**
```typescript
// Source: [ASSUMED] — standard React pattern; stale closure avoidance confirmed by pattern analysis
const animationsRef = useRef(animations); // Ref to avoid stale closure on animations prop
useEffect(() => { animationsRef.current = animations; }, [animations]);

const prevChatStatusRef = useRef<ChatStatus | null>(null);

useEffect(() => {
  if (chatStatus === prevChatStatusRef.current) return;
  const prevStatus = prevChatStatusRef.current;
  prevChatStatusRef.current = chatStatus;

  const animKeys = Object.keys(animationsRef.current || {});

  if (chatStatus === "speaking") {
    // D-02: random pick from keys containing 'speak', 'talk', 'gesture'
    const variants = animKeys.filter(k => /speak|talk|gesture/i.test(k));
    if (variants.length > 0) {
      animate(variants[Math.floor(Math.random() * variants.length)]);
    }
  } else {
    // D-01: exact key match for other statuses
    // NOTE: 'idle' key → triggered by 'ready' chatStatus (see Open Questions)
    const targetKey = chatStatus === "ready" ? "idle" : chatStatus;
    if (animKeys.includes(targetKey)) {
      animate(targetKey);
    }
  }
}, [chatStatus, animate]);
```

**Why useEffect not useFrame:** chatStatus changes are event-driven (once per turn), not per-frame. useEffect fires exactly once per chatStatus transition. Using useEffect + ref for `animations` prop avoids stale closure on both chatStatus and animations.

### Pattern 4: Smooth Noise Without a Library

**What:** Multi-octave sine sums create smooth pseudo-random motion. Deterministic but looks organic.

**Example:**
```typescript
// Source: [ASSUMED] — standard procedural animation pattern
// Per component instance, stored in useRef (no React re-renders):
const headTimeRef = useRef(0);
// Per-finger phase offsets (constant, computed once):
const FINGER_PHASES = [0, 1.1, 2.3, 0.7, 1.9]; // index, middle, ring, little, thumb

// Inside useFrame:
headTimeRef.current += delta;
const t = headTimeRef.current;

// Two-octave noise for head X (up/down nod micro-movement):
const headX = Math.sin(t * 0.28 + 0.5) * 0.018 + Math.sin(t * 0.67 + 1.2) * 0.009;
// Two-octave noise for head Y (left/right drift):
const headY = Math.sin(t * 0.19 + 2.1) * 0.022 + Math.sin(t * 0.53 + 0.8) * 0.011;
```

**Characteristics:** At 60 fps with `delta ≈ 0.016`, headTimeRef advances ~1 unit/second. Frequencies 0.2–0.5 Hz give slow drift. No library needed. All math is scalar, no allocations.

### Pattern 5: Ref-Based Per-Frame State (Existing Pattern to Follow)

**What:** All per-frame animation state is stored in `useRef` (not `useState`) to avoid React re-renders at 60fps.

**Existing refs to model after:**
```typescript
// From VRMAvatar.tsx (lines 194–196) — existing, VERIFIED pattern:
const nextBlinkTime = useRef(Date.now() + 2000 + Math.random() * 3000);
const isBlinking = useRef(false);
const blinkAnimationRef = useRef(0);
```

**New refs to add (same pattern):**
```typescript
const breathTimeRef = useRef(0);
const headTimeRef = useRef(0);
const gazeTimeRef = useRef(0);
const fingerTimeRef = useRef(0);
const gazeTargetRef = useRef<THREE.Object3D | null>(null);
const microExprTimeRef = useRef(0);
const nextExprChangeRef = useRef(3 + Math.random() * 5); // seconds until next expr change
const currentExprTargetsRef = useRef<Record<string, number>>({});
```

**Exception:** `blinkState` is useState (causes re-render) — this is a pre-existing pattern the new code should NOT replicate. New procedural layers call vrm API directly, no setState.

### Anti-Patterns to Avoid

- **Applying bone deltas after vrm.update():** Raw bones are populated by `humanoid.update()` inside `vrm.update()`. Deltas applied after are correct for that frame but are overwritten next frame by the normalized→raw transfer. Result: flickering or zero net effect.
- **Modifying raw bones (getRawBoneNode) when animations are active:** The animation mixer drives normalized bones; `humanoid.update()` overwrites raw bones every frame. Raw bone modifications are ephemeral.
- **Using useState for per-frame procedural values:** Triggers React re-renders at 60fps, causing performance degradation.
- **Calling vrm.lookAt.lookAt() manually with autoUpdate=true:** Inside `vrm.update()`, autoUpdate will immediately overwrite any manual call with the target position. Stick to moving the target Object3D.
- **Creating new THREE.Quaternion/THREE.Vector3 inside useFrame:** Causes GC pressure at 60fps. Pre-allocate as module-level constants or component-level refs.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Eye tracking direction | Custom bone rotations for leftEye/rightEye | `vrm.lookAt.target` + `vrm.lookAt.autoUpdate` | VRM handles bone-vs-expression routing per model automatically |
| Expression blending | Custom lerp accumulator per expression | `expressionManager.setValue()` + existing `lerpExpression()` | Already handles multipliers, override weights, mouth/blink/lookAt interaction |
| Bone name resolution | String lookup table | `vrm.humanoid.getNormalizedBoneNode(name)` returning null if bone absent | VRM handles VRM0/VRM1 differences; null-check is the graceful fallback |

**Key insight:** `vrm.lookAt.target` completely replaces any need to manually drive `leftEye`/`rightEye` bones. VRM internally decides whether to use bone rotation (VRM0) or blend shapes (VRM1) — the applier pattern is per-model. Manual eye bone manipulation would break VRM0/VRM1 compatibility.

---

## VRM API Reference (Verified)

### Bone Access

```typescript
// Source: three-vrm.module.js:2005-2013, confirmed [VERIFIED]

// USE THIS for additive animation (mixer also drives normalized bones):
vrm.humanoid.getNormalizedBoneNode(boneName: string): THREE.Object3D | null

// Available but targets different layer (raw skeleton bones with bind-pose rotations):
vrm.humanoid.getRawBoneNode(boneName: string): THREE.Object3D | null

// DEPRECATED — logs warning, internally calls getRawBoneNode:
vrm.humanoid.getBoneNode(boneName: string): THREE.Object3D | null
```

### Verified Bone Name Strings (camelCase)

All confirmed from `three-vrm.module.js` lines 1416–1499. [VERIFIED]

**Body bones:**
- `"hips"`, `"spine"`, `"chest"`, `"upperChest"`, `"neck"`, `"head"`
- `"leftShoulder"`, `"leftUpperArm"`, `"leftLowerArm"`, `"leftHand"`
- `"rightShoulder"`, `"rightUpperArm"`, `"rightLowerArm"`, `"rightHand"`

**Left finger bones (proximal only — D-08 scope):**
- `"leftThumbProximal"`, `"leftIndexProximal"`, `"leftMiddleProximal"`, `"leftRingProximal"`, `"leftLittleProximal"`

**Right finger bones (proximal only):**
- `"rightThumbProximal"`, `"rightIndexProximal"`, `"rightMiddleProximal"`, `"rightRingProximal"`, `"rightLittleProximal"`

**Eye bones (NOT used for gaze — use lookAt.target instead per D-05):**
- `"leftEye"`, `"rightEye"`

### lookAt API

```typescript
// Source: three-vrm.module.js:2411-2585 [VERIFIED]
vrm.lookAt.target: THREE.Object3D | null   // Set to invisible Object3D to drive gaze
vrm.lookAt.autoUpdate: boolean              // true by default — tracks target in vrm.update()

// vrm.update(delta) internally does:
//   humanoid.update()           // normalized → raw bone transfer
//   lookAt.update(delta)        // if target != null && autoUpdate: calls this.lookAt(target.getWorldPosition())
//   expressionManager.update()  // flushes expression values to morph targets
```

### Expression Manager API

```typescript
// Source: three-vrm.module.js:361-443 [VERIFIED] — already used in VRMAvatar.tsx
vrm.expressionManager.setValue(name: string, weight: number): void
vrm.expressionManager.getValue(name: string): number | null
vrm.expressionManager.blinkExpressionNames: string[]  // ['blinkLeft', 'blinkRight'] typically
```

**Standard VRM expression names** (not enum-verified, [ASSUMED] from VRM spec / training knowledge):
- `"happy"`, `"sad"`, `"angry"`, `"surprised"`, `"relaxed"`, `"neutral"`
- `"blinkLeft"`, `"blinkRight"`
- `"aa"`, `"ih"`, `"ou"`, `"ee"`, `"oh"` (viseme expressions for lip-sync)

Note: Actual available expression names depend on the VRM file. Always guard: `expressionManager.getValue(name) !== null` before calling setValue.

### vrm.update(delta) Exact Call Order

```typescript
// Source: three-vrm.module.js:3117-3130 [VERIFIED]
vrm.update(delta) {
  this.humanoid.update();         // 1. copies normalizedBones → rawBones (if autoUpdateHumanBones)
  if (this.lookAt) {
    this.lookAt.update(delta);    // 2. reads lookAt.target, rotates eyes
  }
  if (this.expressionManager) {
    this.expressionManager.update(); // 3. applies expression values to morph targets
  }
}
```

---

## Correct useFrame Order of Operations

```typescript
// D-09 compliant — FBX unchanged, all additions are additive
useFrame((_, delta) => {
  if (!currentVrm?.expressionManager) return;

  // ① Advance animation mixer (drives normalized bone quaternions from FBX clips)
  if (mixerRef.current) {
    mixerRef.current.update(delta);
  }

  // ② Procedural bone deltas — AFTER mixer, BEFORE vrm.update
  //    Target: getNormalizedBoneNode (same layer the mixer drives)
  if (enableBreathing)     applyBreathing(currentVrm, delta);
  if (enableHeadMovement)  applyHeadMovement(currentVrm, delta);
  if (enableHandGestures)  applyFingerNoise(currentVrm, delta);

  // ③ Eye gaze — move target Object3D (vrm.update will read it)
  if (enableEyeGaze)       updateGazeTarget(currentVrm, delta);

  // ④ Expressions (user-set from context + micro-expressions)
  Object.entries(expressions).forEach(([name, value]) => {
    if (typeof value === "number") lerpExpression(name, value, delta * 8);
  });
  if (enableMicroExpressions) applyMicroExpressions(currentVrm, chatStatus, delta);

  // ⑤ Blinking (existing, unchanged)
  if (enableBlinking) { /* existing blink code */ }

  // ⑥ vrm.update — applies humanoid bone transfer, lookAt, expressionManager
  currentVrm.update(delta);
});
```

---

## Critical Finding: ChatStatus Does NOT Include 'idle'

**Finding:** `ChatStatus` type (verified from `packages/core/src/types/conversation.ts`) is:
```typescript
type ChatStatus = 'ready' | 'speaking' | 'listening' | 'thinking' | 'stopped' | 'starting';
```

**Problem with D-01:** Decision D-01 says the `'idle'` animation key triggers when `chatStatus === 'idle'`. But `'idle'` is not a valid ChatStatus value. The closest state is `'ready'` (the "not doing anything" state after connection).

**Recommendation for planner:** Map the `'idle'` animation key to `chatStatus === 'ready'`. When chatStatus becomes `'ready'`, auto-play `animations['idle']` if it exists. This matches user intent (idle = avatar is ready and waiting) and the existing KhaveeProvider default of `currentAnimation = "idle"`.

For D-07 micro-expressions, map "idle" schedule state to `chatStatus === 'ready'` as well.

---

## Common Pitfalls

### Pitfall 1: Applying Bone Deltas After vrm.update() (Additive Order Error)

**What goes wrong:** Procedural deltas are applied to raw bones after `vrm.update(delta)`. They appear correctly for one frame but are overwritten by `humanoid.update()` the next frame (which copies normalized → raw). Net effect: deltas may appear doubled, zero, or flickering.

**Why it happens:** Confusion between raw vs. normalized bone layers. The existing CONTEXT.md comment says "apply after mixer.update()" which is correct but incomplete — must also be BEFORE vrm.update().

**How to avoid:** Always apply normalized bone deltas between `mixer.update(delta)` and `vrm.update(delta)`. The frame order is fixed.

**Warning signs:** Procedural motion appears absent or jittery despite correct math.

### Pitfall 2: Modifying vrm.expressionManager AFTER vrm.update()

**What goes wrong:** Expression values set via `setValue()` after `vrm.update()` are NOT flushed to morph targets until the NEXT frame's `vrm.update()`. This causes a one-frame lag for new expressions.

**Why it happens:** `expressionManager.update()` runs inside `vrm.update()`, not after it.

**How to avoid:** Call `setValue()` BEFORE `vrm.update(delta)` (already done in existing code). [VERIFIED: three-vrm.module.js:3127]

### Pitfall 3: Stale Closure on `animations` Prop in useEffect/useFrame

**What goes wrong:** The `useEffect` for chatStatus→animation mapping captures the `animations` prop at mount time. If the consumer changes the `animations` object reference, the effect has stale data.

**How to avoid:** Sync `animations` prop to a `useRef` via a separate `useEffect([animations])`, then read from the ref inside the chatStatus effect.

### Pitfall 4: `getNormalizedBoneNode` Returns null for Missing Bones

**What goes wrong:** Not all VRM models include all optional bones (e.g., finger bones are optional). Calling `.quaternion.multiply()` on null throws.

**How to avoid:** Always guard: `const bone = vrm.humanoid.getNormalizedBoneNode(name); if (bone) { ... }`. [VERIFIED: return type is `THREE.Object3D | null`]

### Pitfall 5: Double-Setting chatStatus→Animation When Already in State

**What goes wrong:** If chatStatus is already `'speaking'` and something re-triggers the auto-mapping effect, a new random animation is picked mid-sentence.

**How to avoid:** Track previous chatStatus in `prevChatStatusRef`. Only pick a new random animation on TRANSITION to `'speaking'` from a different state, not on re-renders where chatStatus is unchanged.

### Pitfall 6: gazeTarget Object3D Added to Wrong Scene

**What goes wrong:** If the gaze target Object3D is added to the React Three Fiber root scene instead of `currentVrm.scene`, its world matrix may be correct but VRM's internal coordinate frame could differ.

**How to avoid:** Add the gazeTarget to `currentVrm.scene`. Since VRMAvatar renders `<primitive object={scene} />` (where `scene = useGLTF(src).scene`), the VRM scene IS in the R3F scene graph. Adding the gazeObj to `currentVrm.scene` is safe. [VERIFIED: VRMAvatar.tsx line 439, three-vrm.module.js:2575]

---

## Code Examples

### Breathing Implementation

```typescript
// Source: pattern derived from three-vrm.module.js:2005 [VERIFIED API], noise pattern [ASSUMED]
// Module-level scratch (no allocation per frame):
const _breathAxis = new THREE.Vector3(1, 0, 0);
const _breathQuat = new THREE.Quaternion();

function applyBreathing(vrm: VRM, delta: number, timeRef: React.MutableRefObject<number>) {
  timeRef.current += delta;
  const breathOffset = Math.sin(timeRef.current * 1.2) * 0.020; // ~0.2 Hz breathing
  _breathQuat.setFromAxisAngle(_breathAxis, breathOffset);

  const spine = vrm.humanoid.getNormalizedBoneNode("spine");
  const chest = vrm.humanoid.getNormalizedBoneNode("chest");
  if (spine) spine.quaternion.multiply(_breathQuat);
  if (chest) chest.quaternion.multiply(_breathQuat);
}
```

### Head Micro-Movement

```typescript
// Source: [ASSUMED] smooth noise pattern; bone API [VERIFIED]
const _headAxisX = new THREE.Vector3(1, 0, 0);
const _headAxisY = new THREE.Vector3(0, 1, 0);
const _headQuatX = new THREE.Quaternion();
const _headQuatY = new THREE.Quaternion();

function applyHeadMovement(vrm: VRM, delta: number, timeRef: React.MutableRefObject<number>) {
  timeRef.current += delta;
  const t = timeRef.current;
  const headX = Math.sin(t * 0.28 + 0.5) * 0.018 + Math.sin(t * 0.67 + 1.2) * 0.009;
  const headY = Math.sin(t * 0.19 + 2.1) * 0.022 + Math.sin(t * 0.53 + 0.8) * 0.011;
  _headQuatX.setFromAxisAngle(_headAxisX, headX);
  _headQuatY.setFromAxisAngle(_headAxisY, headY);
  const head = vrm.humanoid.getNormalizedBoneNode("head");
  if (head) head.quaternion.multiply(_headQuatX).multiply(_headQuatY);
}
```

### Procedural Finger Curl

```typescript
// Source: [ASSUMED] pattern; bone names [VERIFIED from three-vrm.module.js:1416-1499]
const LEFT_FINGER_BONES = [
  "leftIndexProximal", "leftMiddleProximal", "leftRingProximal",
  "leftLittleProximal", "leftThumbProximal",
] as const;
const RIGHT_FINGER_BONES = [
  "rightIndexProximal", "rightMiddleProximal", "rightRingProximal",
  "rightLittleProximal", "rightThumbProximal",
] as const;
const FINGER_PHASES = [0, 1.1, 2.3, 0.7, 1.9]; // one phase offset per finger

const _fingerAxis = new THREE.Vector3(1, 0, 0);
const _fingerQuat = new THREE.Quaternion();

function applyFingerNoise(vrm: VRM, delta: number, timeRef: React.MutableRefObject<number>) {
  timeRef.current += delta;
  const t = timeRef.current;
  [...LEFT_FINGER_BONES, ...RIGHT_FINGER_BONES].forEach((boneName, i) => {
    const phase = FINGER_PHASES[i % 5];
    const freq = 0.7 + (i % 3) * 0.17; // ~0.7–1.2 Hz
    const offset = Math.sin(t * freq + phase) * 0.018;
    _fingerQuat.setFromAxisAngle(_fingerAxis, offset);
    const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (bone) bone.quaternion.multiply(_fingerQuat);
  });
}
```

### Micro-Expression Schedule

```typescript
// Source: [ASSUMED] pattern; expressionManager API [VERIFIED]
// Called in useFrame BEFORE vrm.update():
function applyMicroExpressions(
  vrm: VRM,
  chatStatus: ChatStatus,
  delta: number,
  timeRef: React.MutableRefObject<number>,
  nextChangeRef: React.MutableRefObject<number>,
  targetsRef: React.MutableRefObject<Record<string, number>>
) {
  timeRef.current += delta;
  // Check if it's time to pick new targets
  if (timeRef.current >= nextChangeRef.current) {
    nextChangeRef.current = timeRef.current + 3 + Math.random() * 5;
    // D-07: pick targets based on chatStatus (mapped from 'idle' → 'ready')
    const effectiveStatus = chatStatus === "ready" ? "idle" : chatStatus;
    if (effectiveStatus === "idle") {
      targetsRef.current = { relaxed: 0.06 + Math.random() * 0.04 };
    } else if (effectiveStatus === "listening") {
      targetsRef.current = {
        happy: 0.10 + Math.random() * 0.05,
        surprised: 0.04 + Math.random() * 0.02,
      };
    } else if (effectiveStatus === "thinking") {
      targetsRef.current = { neutral: 0.08 + Math.random() * 0.04 };
    } else {
      // speaking or other: no micro-expressions
      targetsRef.current = {};
    }
  }
  // Lerp toward targets
  const mgr = vrm.expressionManager;
  Object.entries(targetsRef.current).forEach(([name, target]) => {
    if (mgr.getValue(name) !== null) {
      const current = mgr.getValue(name) ?? 0;
      mgr.setValue(name, current + (target - current) * delta * 0.8);
    }
  });
}
```

### Eye Gaze Target Setup

```typescript
// Source: vrm.lookAt API [VERIFIED from three-vrm.module.js:2485, 2575-2576]
// In useEffect when currentVrm loads:
useEffect(() => {
  if (!currentVrm || !enableEyeGaze) return;
  const gazeObj = new THREE.Object3D();
  gazeObj.position.set(0, 1.6, 2.0);
  currentVrm.scene.add(gazeObj);
  gazeTargetRef.current = gazeObj;
  currentVrm.lookAt.target = gazeObj;
  currentVrm.lookAt.autoUpdate = true;
  return () => {
    currentVrm.scene.remove(gazeObj);
    currentVrm.lookAt.target = null;
    gazeTargetRef.current = null;
  };
}, [currentVrm, enableEyeGaze]);

// In useFrame, BEFORE vrm.update():
if (enableEyeGaze && gazeTargetRef.current && currentVrm.lookAt) {
  const t = gazeTimeRef.current;
  gazeTargetRef.current.position.x = Math.sin(t * 0.23 + 1.1) * 0.3 + Math.sin(t * 0.11) * 0.15;
  gazeTargetRef.current.position.y = 1.6 + Math.sin(t * 0.17 + 0.5) * 0.15;
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `vrm.humanoid.getBoneNode()` | `vrm.humanoid.getRawBoneNode()` or `getNormalizedBoneNode()` | Old method is deprecated (logs warning). Always use one of the two explicit variants. |
| Manual eye bone rotation | `vrm.lookAt.target` | VRM1 models use blend shapes for gaze, not bones; VRMLookAt.autoUpdate handles both. |
| Direct raw bone manipulation for additive animation | Normalized bone manipulation + humanoid.update() transfer | Raw bones are overwritten every frame by humanoid.update(). Normalized bones persist through the transfer. |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | VRM expression names: 'happy', 'relaxed', 'surprised', 'neutral' exist in the model | Micro-expression schedule | Expressions not available → getValue() returns null → guard check silently skips; low runtime risk but visual feature absent |
| A2 | Adding gazeTarget to `currentVrm.scene` (not R3F root scene) is the correct parent for world-position tracking | Eye gaze | gaze target position could be misinterpreted; fix is to use R3F root scene instead |
| A3 | Multi-octave sine sums provide sufficient organic-looking noise for head/gaze at 60fps | Smooth noise pattern | May look too mechanical; mitigation is tuning frequencies and adding a third octave |
| A4 | `chatStatus === 'ready'` should trigger the `'idle'` animation key (D-01 resolution) | chatStatus → animation mapping | If user expects 'idle' to trigger on 'stopped', avatar won't return to idle after disconnect |

---

## Open Questions

1. **'idle' animation key → which chatStatus?**
   - What we know: ChatStatus has `'ready'` and `'stopped'` but NOT `'idle'`. D-01 says `'idle'` key triggers "when chatStatus changes to that value" — but 'idle' is not a value.
   - What's unclear: Should `'idle'` animation trigger on `'ready'` only, `'stopped'` only, or both?
   - Recommendation: Map `'idle'` → `'ready'`. The `'stopped'` state is after session end; `'ready'` is the "connected but not doing anything" state that semantically corresponds to idle behavior.

2. **Micro-expression + user-set expression conflict**
   - What we know: D-07 says micro-expressions "blend WITH any expressions the developer sets via setExpression() — additive, not overriding."
   - What's unclear: If a developer sets `happy = 0.8` and the micro-expression schedule also sets `happy = 0.12`, the final value would be additive (~0.92). Is that the intended behavior, or should micro-expressions use setValue for ONLY those keys not currently set by user?
   - Recommendation: Since `lerpExpression()` reads the current value and lerps toward the context `expressions` value first, micro-expressions should operate on a separate layer or only nudge values if the user's expression value is below a threshold.

3. **GazeTarget cleanup on VRM src prop change**
   - What we know: `currentVrm` updates when `src` changes (new VRM loaded). The useEffect cleanup runs.
   - What's unclear: Does `currentVrm.scene.remove(gazeObj)` need to happen before the new VRM scene mounts?
   - Recommendation: Tie cleanup to the useEffect return that watches `currentVrm`.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is code-only changes to existing packages with no new external tool/service dependencies.

---

## Sources

### Primary (HIGH confidence — verified from installed source)
- `node_modules/@pixiv/three-vrm/lib/three-vrm.module.js` — Lines 2005-2013 (getRawBoneNode/getNormalizedBoneNode), 2411-2585 (VRMLookAt, target, autoUpdate), 3117-3130 (VRM.update() call order), 1416-1499 (VRMHumanBoneName enum and bone name strings)
- `packages/react/src/VRMAvatar.tsx` — Existing useFrame structure, lerpExpression, blinking pattern, mixer usage
- `packages/react/src/utils/remapMixamoAnimationToVrm.ts` — Confirms mixer targets NORMALIZED bones via getNormalizedBoneNode
- `packages/core/src/types/conversation.ts` — ChatStatus exact values
- `packages/react/src/KhaveeProvider.tsx` — chatStatus exposed in context, initial animation = "idle"

### Secondary (MEDIUM confidence)
- VRM specification: bone name casing convention (camelCase) — cross-confirmed between VRMHumanBoneName enum and the array at lines 1416–1444

### Tertiary (LOW confidence)
- Smooth noise frequency values (0.2–0.5 Hz for head, 0.6–1.2 Hz for fingers) — [ASSUMED] from animation principles; verify with subjective review
- VRM expression name strings ('happy', 'relaxed', etc.) — [ASSUMED]; actual names are model-dependent

---

## Metadata

**Confidence breakdown:**
- VRM API (bone access, lookAt, expressionManager, update order): HIGH — verified from installed source
- Bone name strings: HIGH — verified from VRMHumanBoneName enum in installed module
- Correct additive delta order (normalized before vrm.update): HIGH — verified by reading remapMixamoAnimationToVrm + vrm.update source
- Smooth noise math: MEDIUM — standard procedural pattern, unverified against actual perception
- Expression names: LOW — model-dependent, not enumerated in VRM spec types

**Research date:** 2026-07-01
**Valid until:** 2026-08-01 (stable library — @pixiv/three-vrm 3.x has been stable)
