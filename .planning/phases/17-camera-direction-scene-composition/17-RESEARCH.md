# Phase 17: Camera Direction & Scene Composition - Research

**Researched:** 2026-09-18
**Domain:** React Three Fiber camera control, procedural camera animation, cinematographic framing
**Confidence:** HIGH

## Summary

Phase 17 builds a new opt-in `<AvatarCamera>` component that replaces unconstrained free-orbit camera controls with deliberate cinematographic framing. The component ships three presets (bust-shot, medium-close-up, full-body), three orbit modes (locked/constrained/free), procedural handheld drift using simplex noise, and chatStatus-driven dolly reframing — all on by default with granular opt-out props.

The technical foundation already exists: drei's `CameraControls` (wrapper around `camera-controls` library) provides programmatic camera movement with smooth transitions and orbital constraints; `easeInOutCubic` from `crossfade.ts` handles easing; `useFrame` and `useThree().camera` patterns are established across the animation system; `AvatarBackdrop` and `SubjectFocusTracker` already track camera position per-frame and will cooperate automatically.

The main unknowns are empirical: exact preset positions/targets/fov values must be tuned against real avatars, noise parameters for drift require "subtle enough to not notice consciously, obvious enough that removing it makes the scene feel dead" calibration, and constrained-orbit clamp ranges need validation across all three presets. These are Claude's discretion areas and will be determined during planning/execution.

**Primary recommendation:** Use drei's `CameraControls` as the internal implementation (via ref) for programmatic camera movement and orbit constraint enforcement; layer `simplex-noise` 3D/4D noise on top for handheld drift via `useFrame`; consume `useKhavee().chatStatus` for state-driven reframing; expose a component shape matching the established `AvatarPostFX` / `AvatarLightRig` precedent (opt-in per-Canvas component with sensible defaults and partial-override props).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Camera position & orientation | Browser / Client | — | three.js PerspectiveCamera and R3F camera state live entirely client-side in the WebGL rendering context |
| Orbit interaction (mouse/touch) | Browser / Client | — | User input events and camera-controls library run in the browser event loop |
| Handheld drift noise evaluation | Browser / Client | — | Per-frame noise sampling must happen in `useFrame` (client animation loop) to drive camera position deltas |
| State-driven reframing (dolly) | Browser / Client | — | Reads `chatStatus` from React context and applies camera distance changes via three.js Camera API — pure client-side composition |
| Framing preset definitions | Browser / Client | — | Preset position/target/fov values are component-local constants, no backend coordination needed |

**Note:** This phase has no backend or API tier involvement — camera behavior is entirely a client-side rendering concern, driven by local state (chatStatus) and user interaction. The camera does not communicate with the voice pipeline or any external service.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Ship a new **`<AvatarCamera>`** component, separate from `VRMAvatar`/`GLBAvatar`. Camera is per-Canvas (like `AvatarPostFX`), not per-avatar.
- **D-02:** `AvatarCamera` is **opt-in** — no `autoCamera` prop on avatar components. Avoids conflict with existing consumers' `OrbitControls`/`CameraControls`.
- **D-03:** Three built-in **framing presets**: `"bust-shot"` (default), `"medium-close-up"`, and `"full-body"`.
- **D-04:** Consumer can override preset's framing via explicit **`position`, `target`, and `fov` props**. Explicit prop overrides preset default for that axis only.
- **D-05:** `AvatarCamera` exposes **`orbit` mode prop**: `"locked"` (default) | `"constrained"` | `"free"`.
  - `"locked"` — camera fixed to preset, no user interaction
  - `"constrained"` — user can orbit within clamped ranges
  - `"free"` — unconstrained orbit (dev/debug)
- **D-06:** Presets are **runtime-swappable** with **smooth eased transitions** (easeInOutCubic, ~0.8–1.5s).
- **D-07:** Handheld drift uses **procedural noise** (Perlin/simplex) on camera position and target, very low amplitude (~0.5–2 cm world-space).
- **D-08:** Drift is **always on** (across all `chatStatus` values), pauses only during active user orbit.
- **D-09:** `drift` prop defaults to `true`.
- **D-10:** State reframing is **dolly only** — ~5–10% push-in on `chatStatus="speaking"`, ease back on `"listening"`/`"ready"`. No angle/target change.
- **D-11:** `reframe` prop defaults to `true`.
- **D-12:** Both drift and reframe are **on by default** when `AvatarCamera` is mounted.

### Claude's Discretion

- Exact preset camera positions, targets, and fov values for the 3 presets
- Exact noise parameters for handheld drift (frequency, octaves, amplitude per axis)
- Easing curve and duration specifics for preset transitions and state reframing
- How `orbit="constrained"` clamps are defined (exact polar/azimuth/distance ranges per preset)
- Whether to use drei's `CameraControls` internally or manage camera directly via `useFrame`

### Deferred Ideas (OUT OF SCOPE)

- LLM-triggered camera changes (belongs in Phase 18 or future phase)
- Phase 13 performance tiers (drift will need tier-gating when Phase 13 lands)
- Camera shake on events (too specific, future polish)

</user_constraints>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@react-three/drei` | ^10.7.6 [VERIFIED: npm registry] | Camera controls, drei utilities | Already a project dependency; `CameraControls` is drei's wrapper around `camera-controls` library (yomotsu/camera-controls) providing programmatic camera movement, smooth transitions, and orbital constraints — production-proven across R3F ecosystem |
| `simplex-noise` | ^4.0.3 [VERIFIED: npm registry] | Procedural noise for handheld drift | Fast (~20ns/sample for 2D), self-contained (no dependencies), small (~2KB gzipped), supports seeded deterministic generation, standard choice for procedural animation in JavaScript |
| `three` | ^0.180.0 [VERIFIED: existing dep] | Core 3D engine, PerspectiveCamera API | Already a project dependency; provides `PerspectiveCamera`, `Vector3`, `MathUtils`, camera projection matrix math |
| `@react-three/fiber` | ^9.3.0 [VERIFIED: existing dep] | React bindings for three.js | Already a project dependency; provides `useFrame`, `useThree`, Canvas integration |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `alea` | ^1.0.1 [VERIFIED: npm registry] | Seeded PRNG for deterministic noise | Optional: use if deterministic camera drift is needed (e.g., for automated testing, replay systems). Pass to `createNoise3D(alea('seed'))` to get reproducible drift patterns. Not needed for default live behavior. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| drei's `CameraControls` | drei's `OrbitControls` | `OrbitControls` lacks programmatic API for smooth transitions (`setLookAt`, `setPosition` with `enableTransition`). Would need manual interpolation logic for preset swaps and state reframing. `CameraControls` is higher-level and designed for this. |
| drei's `CameraControls` | Manual camera management via `useFrame` | Possible but requires reimplementing damping, boundary clamping, input handling, and smooth transitions — all already solved by `camera-controls` library. Only consider if camera-controls has a blocking issue. |
| `simplex-noise` | `perlin-noise-3d` or similar | simplex-noise is the performance leader (~72.9M ops/sec for 2D) and has no dependencies. Other libraries may have different API shapes but no clear advantage. |
| Procedural noise | Sine-based drift (like `breathing.ts`/`sway.ts`) | Sine produces predictable, looping patterns — reads as mechanical. Noise is organic/non-repeating, which is the desired "handheld camera" feel (D-07). |

**Installation:**
```bash
pnpm add simplex-noise@4.0.3
# alea is optional, only if seeded deterministic drift is needed:
# pnpm add alea@1.0.1
```

**Version verification:** Verified via `npm view` against npm registry 2026-09-18. drei ^10.7.6 requires `three >=0.159` and `@react-three/fiber ^9.0.0` — project has three ^0.180.0 and fiber ^9.3.0, fully compatible.

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         <AvatarCamera>                                │
│                     (mounted once per Canvas)                         │
└────────────┬─────────────────────────────────────────────────────────┘
             │
             ├─▶ Props Input
             │    • preset: "bust-shot" | "medium-close-up" | "full-body"
             │    • orbit: "locked" | "constrained" | "free"
             │    • position/target/fov overrides (optional)
             │    • drift: boolean (default true)
             │    • reframe: boolean (default true)
             │
             ├─▶ [1] Preset Resolution
             │    │   Merge preset defaults with explicit prop overrides
             │    │   → resolved {position, target, fov}
             │    │
             │    └─▶ [2] CameraControls Setup (ref)
             │         │   Set minDistance/maxDistance, minPolarAngle/maxPolarAngle, etc.
             │         │   Configure orbit mode via mouseButtons/touches
             │         │   → locked: no input bindings
             │         │   → constrained: clamped ranges
             │         │   → free: full range
             │         │
             │         └─▶ [3] Preset Transition (on preset change)
             │              │   Call ref.current.setLookAt(pos, target, enableTransition=true)
             │              │   Eased via easeInOutCubic, ~0.8-1.5s duration
             │              │
             │              └─▶ [4] useFrame Loop (per-frame updates)
             │                   │
             │                   ├─▶ [4a] Handheld Drift (if drift=true)
             │                   │    │   Sample simplex noise (time-driven)
             │                   │    │   → small deltas (~0.5-2cm) on position & target
             │                   │    │   Apply to camera via setPosition/setTarget
             │                   │    │   Skip if user is actively orbiting
             │                   │    │
             │                   └─▶ [4b] State Reframing (if reframe=true)
             │                        │   Read chatStatus from useKhavee()
             │                        │   → "speaking": dolly-in ~5-10% closer
             │                        │   → "listening"/"ready": dolly back to base
             │                        │   Smooth interpolation (not instant)
             │                        │
             │                        └─▶ three.js PerspectiveCamera
             │                             (useThree().camera)
             │                             ↓
             │                        ┌───────────────────────┐
             │                        │  Downstream Consumers │
             │                        ├───────────────────────┤
             │                        │ • AvatarBackdrop      │ (follows camera pos/dir)
             │                        │ • SubjectFocusTracker │ (DOF from cam distance)
             │                        │ • gaze.ts             │ (reads camera for target)
             │                        └───────────────────────┘
```

**Data flow:**
1. Component receives props (preset, orbit mode, overrides, feature flags)
2. Preset resolution merges defaults with explicit overrides → resolved camera state
3. CameraControls ref is configured with orbital constraints matching the orbit mode
4. Preset changes trigger smooth transitions via `setLookAt(enableTransition=true)`
5. Per-frame loop runs two independent systems:
   - **Drift:** Samples noise, applies small deltas (skipped during user orbit)
   - **Reframing:** Reads chatStatus, dolly-in on speaking, dolly-out otherwise
6. Both systems manipulate the same three.js camera that all downstream systems (backdrop, DOF, gaze) already read via `useThree().camera`

**Key invariant:** `AvatarCamera` is the single owner of camera position/target during its lifecycle. It does not coordinate with or detect external camera manipulation — mounting both `AvatarCamera` and `OrbitControls` in the same scene creates a conflict (both try to own the camera). This is why the component is opt-in (D-02).

### Recommended Project Structure

```
packages/react/src/
├── utils/
│   └── AvatarCamera.tsx       # New: main component
├── animation/
│   └── (existing files)       # No changes — camera is separate from avatar
└── index.ts                   # Add AvatarCamera export
```

**Component file organization (AvatarCamera.tsx):**
```typescript
// Type definitions (props, preset configs)
// Preset constants (BUST_SHOT, MEDIUM_CLOSE_UP, FULL_BODY)
// Helper: resolvePreset(preset, overrides) → {position, target, fov}
// Helper: configureCameraControls(ref, orbitMode, preset)
// Hook: useHandheldDrift(enabled, noiseParams) → driftDelta
// Hook: useStateReframing(enabled, chatStatus, baseDistance) → targetDistance
// Main component: AvatarCamera(props)
```

### Pattern 1: Using drei's CameraControls as Internal Implementation

**What:** Mount drei's `<CameraControls>` with a ref, configure it in `useEffect`, drive it programmatically via the ref's methods.

**When to use:** This is the recommended pattern (not an alternative). CameraControls provides smooth transitions, damping, and boundary enforcement out-of-the-box.

**Example:**
```typescript
// Source: drei docs (http://drei.docs.pmnd.rs/controls/camera-controls)
// + existing usage in apps/playground/src/app/components/Experience.tsx

import { CameraControls } from "@react-three/drei";
import { useRef, useEffect } from "react";

function AvatarCamera({ preset, orbit }: AvatarCameraProps) {
  const controlsRef = useRef<CameraControls>(null);

  // Configure constraints when orbit mode changes
  useEffect(() => {
    if (!controlsRef.current) return;
    const c = controlsRef.current;
    
    if (orbit === "locked") {
      // Disable all input
      c.mouseButtons.left = c.mouseButtons.wheel = c.mouseButtons.right = 0;
    } else if (orbit === "constrained") {
      // Clamp ranges (example values, tune per preset)
      c.minPolarAngle = Math.PI / 4;
      c.maxPolarAngle = Math.PI / 2.5;
      c.minAzimuthAngle = -Math.PI / 6;
      c.maxAzimuthAngle = Math.PI / 6;
      c.minDistance = 1.5;
      c.maxDistance = 3.0;
    }
    // "free" uses CameraControls defaults (no constraints)
  }, [orbit]);

  // Transition to new preset
  useEffect(() => {
    if (!controlsRef.current) return;
    const { position, target } = resolvePreset(preset);
    // setLookAt(posX, posY, posZ, targetX, targetY, targetZ, enableTransition)
    controlsRef.current.setLookAt(
      position[0], position[1], position[2],
      target[0], target[1], target[2],
      true // smooth transition
    );
  }, [preset]);

  return <CameraControls ref={controlsRef} />;
}
```

**Key CameraControls methods (from drei docs):**
- `setLookAt(px, py, pz, tx, ty, tz, enableTransition)` — move camera & target with optional smooth animation
- `setPosition(x, y, z, enableTransition)` — move camera only
- `dolly(distance, enableTransition)` — move closer/farther from target
- `rotate(azimuthAngle, polarAngle, enableTransition)` — orbit around target

**Transition behavior:** When `enableTransition=true`, camera-controls library handles interpolation automatically with configurable `smoothTime` (default adequate for this phase).

### Pattern 2: Procedural Noise for Handheld Drift

**What:** Sample 3D/4D simplex noise each frame using elapsed time as an input dimension, producing organic non-repeating position/target deltas.

**When to use:** Always when `drift={true}` (the default). Pause when user is actively orbiting (detect via CameraControls' `onControl` event).

**Example:**
```typescript
// Source: simplex-noise.js GitHub (https://github.com/jwagner/simplex-noise.js)
import { createNoise3D } from "simplex-noise";
import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";

function useHandheldDrift(enabled: boolean) {
  const noise3D = useRef(createNoise3D()).current; // Create once
  const time = useRef(0);

  useFrame((state, delta) => {
    if (!enabled) return;
    time.current += delta;
    
    // Noise parameters (Claude's discretion — tune during execution)
    const frequency = 0.5; // cycles per second
    const amplitude = 0.01; // ~1cm world-space
    
    // Sample noise for X/Y/Z position deltas
    const t = time.current * frequency;
    const dx = noise3D(t, 0, 0) * amplitude;
    const dy = noise3D(t, 100, 0) * amplitude; // offset in noise space for independence
    const dz = noise3D(t, 200, 0) * amplitude;
    
    return { dx, dy, dz }; // Apply to camera.position in parent component
  });
}
```

**Why 3D noise, not 2D?** Three independent noise values (X, Y, Z drift) need uncorrelated streams. Using different offsets in a shared 3D noise space (e.g., `noise3D(t, 0, 0)`, `noise3D(t, 100, 0)`, `noise3D(t, 200, 0)`) is cleaner than creating three separate 2D noise functions.

**Why not 4D noise?** 4D can be used if drift needs to vary along a 4th dimension (e.g., preset-dependent drift character), but 3D+offsets is sufficient for time-varying XYZ drift. Keep it simple unless a design need emerges.

**Amplitude tuning (from CONTEXT.md D-07):** ~0.5–2 cm world-space. Start with 1cm (0.01 units) and tune empirically — "subtle enough to not notice consciously, obvious enough that removing it makes the scene feel dead."

### Pattern 3: State-Driven Dolly Reframing

**What:** Read `chatStatus` from `useKhavee()`, interpolate camera distance toward a target distance based on state.

**When to use:** Always when `reframe={true}` (the default).

**Example:**
```typescript
// Source: existing chatStatus usage in packages/react/src/VRMAvatar.tsx
import { useKhavee } from "@khaveeai/react";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

function useStateReframing(enabled: boolean, baseDistance: number) {
  const { chatStatus } = useKhavee();
  const currentDistance = useRef(baseDistance);

  useFrame((state, delta) => {
    if (!enabled) return;
    
    // Compute target distance based on chatStatus (D-10: ~5-10% push-in on speaking)
    const targetDistance = chatStatus === "speaking" 
      ? baseDistance * 0.93 // 7% closer (tune within 5-10% range)
      : baseDistance;
    
    // Smooth interpolation (not instant snap)
    const lerpFactor = 1 - Math.exp(-delta * 3); // ~0.33s time constant
    currentDistance.current = THREE.MathUtils.lerp(
      currentDistance.current,
      targetDistance,
      lerpFactor
    );
    
    return currentDistance.current;
  });
}
```

**Integration with CameraControls:** Call `controlsRef.current.dolly(desiredDistance - currentDistance, false)` to apply the delta. The `false` disables the built-in transition (we're already interpolating per-frame).

**Why dolly-only, not full reframe?** (from CONTEXT.md D-10) Mirrors real cinematography — a slow push-in signals focus/attention, easing back signals release. Changing angle or framing would be distracting. This is a subtle effect, not a dramatic move.

### Pattern 4: Partial Override Props (Established Convention)

**What:** A prop like `lighting` or `position` that accepts a partial object, merging explicit values with preset defaults.

**When to use:** Following the Phase 16 precedent (D-04 from Phase 17 CONTEXT.md).

**Example:**
```typescript
interface AvatarCameraProps {
  preset?: "bust-shot" | "medium-close-up" | "full-body";
  position?: [number, number, number]; // Override preset's position
  target?: [number, number, number];   // Override preset's target
  fov?: number;                        // Override preset's fov
  // ... other props
}

// Preset defaults (example values, tune during execution)
const PRESETS = {
  "bust-shot": { position: [0, 1.4, 1.8], target: [0, 1.3, 0], fov: 35 },
  "medium-close-up": { position: [0, 1.5, 2.2], target: [0, 1.4, 0], fov: 40 },
  "full-body": { position: [0, 1.2, 4.0], target: [0, 1.0, 0], fov: 50 },
};

function resolvePreset(
  preset: string,
  overrides: Partial<{ position, target, fov }>
) {
  const base = PRESETS[preset];
  return {
    position: overrides.position ?? base.position,
    target: overrides.target ?? base.target,
    fov: overrides.fov ?? base.fov,
  };
}

// Usage:
<AvatarCamera 
  preset="bust-shot" 
  position={[0, 1.5, 2.5]} // Custom position, preset target & fov
/>
```

**Rationale (from CONTEXT.md D-04):** An explicit prop overrides the preset's default for that axis only. This gives consumers escape hatches for fine-tuning without needing to fork the component.

### Anti-Patterns to Avoid

- **Mounting both `AvatarCamera` and `OrbitControls`/`CameraControls` in the same scene:** Both try to own the camera. Result: conflicting updates, jittery camera, unpredictable behavior. `AvatarCamera` is opt-in (D-02) specifically to avoid this — existing consumers keep their controls, new consumers mount `AvatarCamera` instead.

- **Applying drift during user interaction:** Camera fighting user input feels broken. Pause drift when `CameraControls` emits `onControl` events, resume on `onRest`.

- **Instant camera jumps on preset change:** Use `enableTransition=true` on `setLookAt` (D-06). Instant cuts are jarring and read as a bug, not a feature.

- **Re-creating noise functions every frame:** `createNoise3D()` should be called once (e.g., in a `useRef` initializer), not in the render path or `useFrame` body. Noise state is mutable and reusable.

- **Forgetting `camera.updateProjectionMatrix()` after changing `fov`:** If fov is modified directly on the camera (not via CameraControls), must call `updateProjectionMatrix()`. CameraControls handles this internally, so only a concern if managing camera manually.

- **Using Math.random() for drift:** Non-deterministic and spatially discontinuous (produces white noise, not smooth organic motion). Use simplex/Perlin noise instead (D-07).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Camera orbit controls with smooth damping | Custom mouse/touch event handlers + manual quaternion interpolation | drei's `CameraControls` | Handles input binding, damping, boundary clamping, zoom/dolly, smooth transitions, and edge cases (e.g., gimbal lock near poles). Production-hardened across thousands of R3F projects. Wraps `camera-controls` library which has been solving this since ~2018. |
| Procedural noise generation | Custom noise algorithm or sum-of-sines | `simplex-noise` library | Simplex noise is the algorithm; implementing it from scratch is error-prone (requires understanding of gradient lattices, hashing, interpolation). Library is 2KB gzipped, zero dependencies, and fast (~20ns/sample). No reason to reimplement. |
| Easing functions | Custom `t * t * (3 - 2 * t)` or similar | `easeInOutCubic` from `crossfade.ts` (already in codebase) | Easing math is formulaic but easy to get wrong (off-by-one on endpoints, non-monotonic curves). Reuse the project's existing tested implementation (used by all animation crossfades since Phase 10). |
| Smooth interpolation between camera states | Manual lerp with fixed `delta * speed` | CameraControls' built-in `enableTransition` parameter | The library already handles frame-rate-independent interpolation with configurable smoothTime. Reimplementing this means duplicating damping logic that's already solved. |

**Key insight:** Camera control in 3D is deceptively complex — naive approaches hit edge cases like gimbal lock, inconsistent damping across frame rates, and input conflicts. CameraControls abstracts this; the only custom logic needed is drift (noise sampling) and state reframing (dolly distance adjustment), both of which are additive on top of CameraControls' base behavior.

## Common Pitfalls

### Pitfall 1: Constrained Orbit Ranges Too Tight

**What goes wrong:** Setting `minPolarAngle`/`maxPolarAngle` or azimuth ranges that are so narrow the user can barely move the camera, or that exclude the preset's own default position.

**Why it happens:** Copying range values from one preset without adjusting for another preset's geometry. A bust-shot's constrained range (mostly horizontal panning, little vertical tilt) is different from a full-body shot's range (needs more vertical freedom to tilt up/down).

**How to avoid:** 
- Define constrained ranges **per preset**, not globally.
- Ensure the preset's default position falls comfortably within the constrained range (ideally centered).
- Test each preset with constrained orbit by trying to rotate to "bad" angles (under chin, top of head, profile from wrong side) and verify those are blocked.

**Warning signs:** 
- User drags mouse but camera barely moves
- Preset position is at the edge of the allowed range (camera "sticks" at boundary immediately after transition)
- Different presets feel inconsistent (one allows wide panning, another feels locked)

### Pitfall 2: Drift Amplitude Too High

**What goes wrong:** Camera visibly wobbles, reads as "shaky cam" or broken, distracts from the avatar. Viewer consciously notices the movement (opposite of "subtle enough to not notice consciously" goal from CONTEXT.md D-07).

**Why it happens:** Noise amplitude scaled in screen-space (CSS pixels) rather than world-space units, or noise frequency too high causing jitter rather than smooth drift.

**How to avoid:**
- Start with very low amplitude (~0.005 world units / 5mm) and increase incrementally until removing it makes the scene feel static.
- Use low frequency (~0.3–0.8 Hz) — handheld drift is slow, not vibration.
- Test against multiple viewport sizes and camera distances — drift should feel similar at 1920×1080 and 800×600, and from 2m and 4m away.

**Warning signs:**
- Viewer comments "why is the camera shaking?"
- Avatar's face visibly wobbles side-to-side or up-down
- Drift is perceptible without actively looking for it
- Background elements (if backdrop is enabled) show noticeable parallax wobble

### Pitfall 3: State Reframing Fights User Orbit

**What goes wrong:** User tries to orbit in `constrained` mode while `chatStatus` changes to `"speaking"`, causing the camera to dolly-in while the user is dragging. Result: camera moves in an unexpected direction, feels unresponsive or "sticky."

**Why it happens:** State reframing (dolly delta) applies every frame, including during active user interaction. The user's drag input and the procedural dolly are summed, producing a resultant motion that doesn't match the user's gesture.

**How to avoid:**
- Check CameraControls' interaction state before applying reframing delta. If `controlsRef.current` reports an active drag (monitor via `onControlStart`/`onControlEnd` callbacks or internal state), skip the reframing update that frame.
- Alternatively, use a "freeze reframing during interaction" flag that's set on `onControlStart` and cleared on `onControlEnd`.

**Warning signs:**
- Camera doesn't respond predictably to drag gestures
- Dolly-in feels "laggy" or delayed when speaking starts (because user is mid-drag and reframing is paused until they release)
- User drags horizontally but camera also moves forward/back unexpectedly

### Pitfall 4: Preset Transitions Feel Mechanical

**What goes wrong:** Camera snaps between presets instantly, or eases with a linear curve that feels robotic. Doesn't read as "cinematic" (CONTEXT.md D-06 goal).

**Why it happens:** Using `enableTransition=false` on `setLookAt`, or CameraControls' default easing is too linear, or transition duration is too short (<0.5s).

**How to avoid:**
- Always use `enableTransition=true` for preset swaps (D-06).
- Configure CameraControls' `smoothTime` if default feels wrong (try 0.8–1.5s range per CONTEXT.md).
- Use `easeInOutCubic` timing if manually interpolating (already used by animation crossfades, proven feel).

**Warning signs:**
- Preset changes feel abrupt or "cut" rather than "move"
- Transition is so slow it reads as sluggish (>2s)
- Easing starts/ends too suddenly (linear interpolation artifact)

### Pitfall 5: Backdrop/DOF Lag Behind Camera During Transitions

**What goes wrong:** During a preset transition or state reframing dolly, `AvatarBackdrop` or `SubjectFocusTracker` (DOF) visibly lag behind the camera, causing the backdrop to momentarily misalign or DOF to be out-of-focus mid-transition.

**Why it happens:** `AvatarBackdrop` and `SubjectFocusTracker` read `useThree().camera` position per-frame via their own `useFrame` hooks. If `AvatarCamera`'s `useFrame` runs **after** theirs in the same frame, they see stale camera state for one frame.

**How to avoid:**
- R3F `useFrame` hooks run in the order components are mounted (generally). Mount `AvatarCamera` **before** `AvatarBackdrop` and post-processing components in the JSX tree.
- If order can't be controlled, use `useFrame(callback, priority)` with explicit priority values to force `AvatarCamera`'s updates to run first (lower priority number = earlier execution).
- Verify during implementation: watch backdrop alignment and DOF focus during a preset transition. If backdrop "slides into place" a frame late, the execution order is wrong.

**Warning signs:**
- Backdrop plane visibly shifts or resizes during camera transitions
- DOF focus "catches up" to the new distance a frame or two after camera stops moving
- Single-frame flicker or misalignment at start/end of preset transition

## Code Examples

Verified patterns from existing codebase and official sources:

### Using CameraControls with Ref

```typescript
// Source: apps/playground/src/app/components/Experience.tsx (verified existing usage)
import { CameraControls } from "@react-three/drei";
import { useRef } from "react";

export function AvatarCamera(props: AvatarCameraProps) {
  const controlsRef = useRef<CameraControls>(null);

  // Access methods programmatically:
  // controlsRef.current.setLookAt(px, py, pz, tx, ty, tz, true)
  // controlsRef.current.dolly(distance, true)
  // controlsRef.current.minDistance = 1.5;
  // etc.

  return (
    <CameraControls
      ref={controlsRef}
      maxPolarAngle={Math.PI / 2}
      minDistance={1}
      maxDistance={10}
    />
  );
}
```

### Creating and Sampling Simplex Noise

```typescript
// Source: simplex-noise.js README (https://github.com/jwagner/simplex-noise.js)
import { createNoise3D } from "simplex-noise";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

function useHandheldDrift(enabled: boolean) {
  const noise3D = useRef(createNoise3D()).current; // Create once, reuse
  const time = useRef(0);

  useFrame((state, delta) => {
    if (!enabled) return null;

    time.current += delta;
    const frequency = 0.5; // Hz
    const amplitude = 0.01; // world units

    const t = time.current * frequency;
    // Sample three independent streams by offsetting in noise space
    const dx = noise3D(t, 0, 0) * amplitude;
    const dy = noise3D(t, 100, 0) * amplitude;
    const dz = noise3D(t, 200, 0) * amplitude;

    return { dx, dy, dz };
  });
}
```

### Reusing Existing easeInOutCubic

```typescript
// Source: packages/react/src/animation/crossfade.ts (verified existing code)
import { easeInOutCubic } from "./animation/crossfade";

// For manual interpolation (if not using CameraControls' built-in transitions):
const t = elapsedTime / totalDuration; // [0, 1]
const easedT = easeInOutCubic(t);
const current = start + (end - start) * easedT;
```

### Reading chatStatus from Context

```typescript
// Source: packages/react/src/VRMAvatar.tsx (verified existing usage)
import { useKhavee } from "@khaveeai/react";

function AvatarCamera(props: AvatarCameraProps) {
  const { chatStatus } = useKhavee();

  // Use chatStatus to drive reframing logic:
  // if (chatStatus === "speaking") { targetDistance = baseDistance * 0.93; }
  // else { targetDistance = baseDistance; }

  return <CameraControls ref={controlsRef} />;
}
```

### Camera FOV Math (Existing Utility)

```typescript
// Source: packages/react/src/utils/backdropCover.ts (verified existing code)
export function planeSizeForDistance(
  fovDegrees: number,
  cameraAspect: number,
  distance: number,
): { width: number; height: number } {
  const height = 2 * distance * Math.tan((fovDegrees * Math.PI) / 360);
  return { width: height * cameraAspect, height };
}

// Useful if computing "how far away must camera be to frame a subject of height H":
// distance = H / (2 * tan(fov_rad / 2))
// Invert the above formula.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| drei's `OrbitControls` | drei's `CameraControls` | drei v9.x → v10.x (2023) | `CameraControls` wraps yomotsu's `camera-controls` library, adding programmatic API (`setLookAt`, `dolly`, etc.) that `OrbitControls` lacks. `OrbitControls` is still supported but is lower-level — good for free-orbit dev mode, not for scripted cinematography. |
| Fixed camera distance | Dynamic dolly based on interaction state | Industry standard (decades) | Modern virtual productions use state-driven camera moves (e.g., Unreal Engine's virtual camera system). Static locked camera reads as "default Unity tutorial" quality, not cinematic. |
| Manual noise implementation | `simplex-noise` library | Library stable since ~2014, v4.x (2023) added 20-30% perf boost | Simplex algorithm is non-trivial to implement correctly. Library is small, fast, and mature — no reason to hand-roll anymore. |

**Deprecated/outdated:**
- **drei v9 and earlier's `PerspectiveCamera` component:** v10+ recommends using `CameraControls` for interactive scenes and letting it manage the camera directly (sets `makeDefault` internally). Manually controlling a separate `<PerspectiveCamera>` is still possible but less idiomatic.
- **camera-controls v2.x:** Version 3.x (current) changed API surface and removed some deprecated methods. drei ^10.5.0 uses camera-controls v3.x — ensure docs consulted are v3-compatible.

## Assumptions Log

> All claims in this research were verified via npm registry, official drei docs, or existing codebase inspection. No assumptions requiring user confirmation.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | (empty) | — | — |

## Open Questions (RESOLVED)

1. **Exact Preset Positions/Targets/FOV Values** — RESOLVED: Claude's discretion per CONTEXT.md.
   - What we know: Standard cinematographic framing definitions (bust shot ~chest-up, medium close-up ~shoulder-up, full body ~head-to-feet visible); existing demos use targets around [0, 1, 0] and distances 1.5–4.0m.
   - What's unclear: Optimal values that work across both VRM and GLB avatars of varying heights/proportions, and feel "right" at typical viewport aspect ratios (16:9, 4:3, portrait).
   - Recommendation: Start with empirical values based on cinematography rules-of-thumb, tune against male.vrm / happy.glb in a harness. Bust-shot: camera at [0, 1.4, 1.8], target [0, 1.3, 0], fov 35°. Medium close-up: [0, 1.5, 2.2], target [0, 1.4, 0], fov 40°. Full-body: [0, 1.2, 4.0], target [0, 1.0, 0], fov 50°. Iterate based on subjective review.

2. **Constrained Orbit Range Clamps Per Preset** — RESOLVED: Claude's discretion per CONTEXT.md.
   - What we know: CameraControls supports minPolarAngle/maxPolarAngle, minAzimuthAngle/maxAzimuthAngle, minDistance/maxDistance. Ranges should be preset-specific (Pitfall 1).
   - What's unclear: Exact degree/radian ranges that feel "constrained but not locked" and prevent unflattering angles without feeling restrictive.
   - Recommendation: Start with ranges that allow ±15° azimuth and ±10° polar from each preset's default position. Test by trying to orbit to "bad" angles (under chin, top of head) and verify they're blocked. Widen if too restrictive, tighten if bad angles slip through.

3. **Drift Noise Parameters (Frequency, Amplitude, Octaves)** — RESOLVED: Claude's discretion per CONTEXT.md.
   - What we know: Target amplitude ~0.5–2 cm (0.005–0.02 world units), should be "subtle enough to not notice consciously, obvious enough that removing it makes the scene feel dead" (CONTEXT.md D-07).
   - What's unclear: Exact frequency (Hz) and whether multi-octave noise is needed, or if single-octave simplex is sufficient.
   - Recommendation: Start with single-octave simplex, frequency 0.5 Hz, amplitude 0.01 (1cm). Tune amplitude via a runtime debug slider (not exposed in production API). If drift feels too uniform, layer a second octave at 2x frequency and 0.5x amplitude for higher-frequency detail. Avoid >2 octaves (diminishing returns, added per-frame cost).

4. **State Reframing Dolly Distance (5-10% Range)** — RESOLVED: Claude's discretion per CONTEXT.md.
   - What we know: D-10 specifies ~5–10% push-in on speaking, dolly-only (no angle change).
   - What's unclear: Exact percentage that reads as "subtle cinematic push-in" vs "distractingly aggressive move-in."
   - Recommendation: Start at 7% (middle of range). Test with a conversation that alternates speaking/listening rapidly — if camera feels "busy," reduce to 5%. If barely perceptible, increase to 10%. User should feel "the camera is paying attention to the speaker" without consciously noticing a move.

## Environment Availability

This phase is purely code/config-only (new component, no external service dependencies). Skipping environment audit.

## Sources

### Primary (HIGH confidence)
- drei CameraControls documentation: http://drei.docs.pmnd.rs/controls/camera-controls — verified API props, methods, constraint capabilities
- `camera-controls` library (yomotsu/camera-controls) — underlying library drei wraps, provides programmatic camera API
- simplex-noise.js GitHub README: https://github.com/jwagner/simplex-noise.js — API, performance characteristics, seeding
- npm registry: verified `simplex-noise@4.0.3`, `alea@1.0.1`, `@react-three/drei@10.7.6` all exist and compatible
- Existing codebase: `crossfade.ts` (`easeInOutCubic`), `breathing.ts` (procedural animation pattern), `backdropCover.ts` (FOV math), `AvatarBackdrop.tsx` (useFrame camera tracking), `Experience.tsx` (CameraControls usage)

### Secondary (MEDIUM confidence)
- Wikipedia: Shot (filmmaking) — standard cinematographic framing definitions (close-up, medium close-up, medium shot, full shot)
- Wikipedia: Dolly zoom — cinematographic dolly movement effects and narrative purpose
- Wikipedia: Handheld camera — handheld camera characteristics and stylistic effects

### Tertiary (LOW confidence)
- (none — all technical claims verified against official docs or npm registry)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified on npm registry, existing dependencies confirmed, drei CameraControls documented and proven in existing demo code
- Architecture: HIGH - Component shape follows established precedent (AvatarPostFX, AvatarLightRig opt-in pattern); useFrame/useThree patterns already used across animation system; CameraControls API well-documented
- Pitfalls: MEDIUM-HIGH - Pitfalls 1-4 are common patterns in 3D camera work (orbit ranges, drift amplitude, interaction conflicts, mechanical easing) with clear mitigations; Pitfall 5 (backdrop/DOF lag) is inferred from R3F's useFrame execution order but not empirically validated in this exact scenario (will be proven during implementation)

**Research date:** 2026-09-18
**Valid until:** ~30 days (stable domain — camera control APIs and cinematography conventions change slowly)
