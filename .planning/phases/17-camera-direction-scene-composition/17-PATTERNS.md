# Phase 17: Camera Direction & Scene Composition - Pattern Map

**Mapped:** 2026-09-18
**Files analyzed:** 3 (2 new, 1 modified)
**Analogs found:** 3 / 3

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/react/src/utils/AvatarCamera.tsx` | component | event-driven | `packages/react/src/utils/AvatarBackdrop.tsx` | exact (per-Canvas component with useFrame) |
| `packages/react/src/index.ts` | config | N/A | `packages/react/src/index.ts` (itself) | exact |
| Demo page (optional verification harness) | component | request-response | `apps/playground/src/app/openai/page.tsx` | role-match |

## Pattern Assignments

### `packages/react/src/utils/AvatarCamera.tsx` (component, event-driven)

**Primary analog:** `packages/react/src/utils/AvatarBackdrop.tsx`
**Supporting analogs:** `renderQuality.tsx` (AvatarPostFX), `breathing.ts`, `sway.ts`, `VRMAvatar.tsx`, `crossfade.ts`, `Experience.tsx`

#### File Header & Imports Pattern

**Source:** `AvatarBackdrop.tsx` lines 1-33

```typescript
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
// drei imports for CameraControls
import { CameraControls } from "@react-three/drei";

/**
 * AvatarCamera - [Brief description of what it does]
 *
 * [Key architectural notes: why per-Canvas, not per-avatar]
 *
 * **Mount once per Canvas:** Multiple cameras in the same scene are not
 * meaningful — only one camera can be active. Mount at most one
 * `<AvatarCamera>` per `<Canvas>`.
 */
```

**Pattern notes:**
- File header JSDoc explains the component's role, architectural constraints, and usage notes
- Import from `@react-three/fiber` for `useFrame`, `useThree`
- Import from `@react-three/drei` for `CameraControls`
- Import `THREE` for three.js types/math

#### Component Props Interface Pattern

**Source:** `renderQuality.tsx` (AvatarPostFX) lines 617-678

```typescript
/** Preset camera framing configurations */
export type CameraPreset = "bust-shot" | "medium-close-up" | "full-body";

/** Orbit interaction mode */
export type OrbitMode = "locked" | "constrained" | "free";

/** Options for {@link AvatarCamera}. */
export interface AvatarCameraProps {
  /** Camera framing preset. Default: "bust-shot" */
  preset?: CameraPreset;
  /** Orbit interaction mode. Default: "locked" */
  orbit?: OrbitMode;
  /** Override preset's camera position [x, y, z]. */
  position?: [number, number, number];
  /** Override preset's look-at target [x, y, z]. */
  target?: [number, number, number];
  /** Override preset's field of view (degrees). */
  fov?: number;
  /** Enable handheld drift (procedural camera life). Default: true */
  drift?: boolean;
  /** Enable state-driven reframing (dolly on speaking). Default: true */
  reframe?: boolean;
}
```

**Pattern notes:**
- String literal unions for preset/mode enums (not TypeScript enums)
- Props interface uses JSDoc comments directly above each field
- Optional props with documented defaults
- Tuple types for 3D vectors: `[number, number, number]`
- Boolean props default to `true` for "on by default" features

#### Preset Constants & Resolution Pattern

**Source:** `renderQuality.tsx` lines 228-250

```typescript
/**
 * Preset camera configurations (position, target, fov).
 * Values are Claude's discretion — tune empirically during execution.
 */
const CAMERA_PRESETS: Record<CameraPreset, { position: [number, number, number]; target: [number, number, number]; fov: number }> = {
  "bust-shot": {
    position: [0, 1.4, 1.8],
    target: [0, 1.3, 0],
    fov: 35,
  },
  "medium-close-up": {
    position: [0, 1.5, 2.2],
    target: [0, 1.4, 0],
    fov: 40,
  },
  "full-body": {
    position: [0, 1.2, 4.0],
    target: [0, 1.0, 0],
    fov: 50,
  },
};

/**
 * resolvePreset - Merge preset defaults with explicit prop overrides.
 */
function resolvePreset(
  preset: CameraPreset,
  overrides: { position?: [number, number, number]; target?: [number, number, number]; fov?: number }
) {
  const base = CAMERA_PRESETS[preset];
  return {
    position: overrides.position ?? base.position,
    target: overrides.target ?? base.target,
    fov: overrides.fov ?? base.fov,
  };
}
```

**Pattern notes:**
- Constants use `Record<StringUnion, ObjectShape>` for type safety
- Helper function merges preset defaults with explicit overrides using `??` operator
- Follows the "partial override" convention from Phase 16 lighting prop

#### CameraControls Setup & Ref Pattern

**Source:** `Experience.tsx` lines 9-34

```typescript
export function AvatarCamera({ preset = "bust-shot", orbit = "locked", ...props }: AvatarCameraProps) {
  const controlsRef = useRef<CameraControls>(null);
  
  const resolved = useMemo(
    () => resolvePreset(preset, { position: props.position, target: props.target, fov: props.fov }),
    [preset, props.position, props.target, props.fov]
  );

  // Configure orbit constraints when orbit mode changes
  useEffect(() => {
    if (!controlsRef.current) return;
    const c = controlsRef.current;
    
    if (orbit === "locked") {
      // Disable all input
      c.mouseButtons.left = 0;
      c.mouseButtons.wheel = 0;
      c.mouseButtons.right = 0;
      c.touches.one = 0;
      c.touches.two = 0;
      c.touches.three = 0;
    } else if (orbit === "constrained") {
      // Enable input but clamp ranges (values are Claude's discretion)
      c.mouseButtons.left = 1;  // CameraControls.ACTION.ROTATE
      c.mouseButtons.wheel = 16; // CameraControls.ACTION.DOLLY
      c.minPolarAngle = Math.PI / 4;
      c.maxPolarAngle = Math.PI / 2.5;
      c.minAzimuthAngle = -Math.PI / 6;
      c.maxAzimuthAngle = Math.PI / 6;
      c.minDistance = 1.5;
      c.maxDistance = 3.0;
    } else {
      // "free" — reset to CameraControls defaults (no constraints)
      c.mouseButtons.left = 1;
      c.mouseButtons.wheel = 16;
      c.minPolarAngle = 0;
      c.maxPolarAngle = Math.PI;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      c.minDistance = 0;
      c.maxDistance = Infinity;
    }
  }, [orbit]);

  return <CameraControls ref={controlsRef} />;
}
```

**Pattern notes:**
- `useRef<CameraControls>(null)` for accessing drei's CameraControls instance
- `useEffect` to configure constraints when orbit mode changes
- Access ref methods/properties: `controlsRef.current.mouseButtons`, `controlsRef.current.minDistance`, etc.
- Constrained orbit ranges are per-preset (tune during execution)

#### Preset Transition Pattern

**Source:** `renderQuality.tsx` (AvatarPostFX) lines 241-250 + RESEARCH.md Pattern 1

```typescript
// Transition to new preset (smooth camera move)
useEffect(() => {
  if (!controlsRef.current) return;
  const { position, target } = resolved;
  
  // setLookAt with enableTransition=true for smooth eased movement
  controlsRef.current.setLookAt(
    position[0], position[1], position[2],
    target[0], target[1], target[2],
    true // enableTransition — uses CameraControls' built-in easing
  );
}, [resolved]);
```

**Pattern notes:**
- `useEffect` watches the resolved preset (derived state via `useMemo`)
- `setLookAt(px, py, pz, tx, ty, tz, enableTransition)` is CameraControls' programmatic API
- `enableTransition=true` enables smooth interpolation (D-06)

#### Procedural Noise State Pattern

**Source:** `breathing.ts` lines 39-85, `sway.ts` lines 44-87

```typescript
// Module-scoped scratch objects (allocation-reuse, never `new` in per-frame path)
const _scratchDelta = new THREE.Vector3();

// Noise parameters (Claude's discretion — tune during execution)
const DRIFT_FREQUENCY = 0.5; // Hz
const DRIFT_AMPLITUDE = 0.01; // world units (~1cm)

/** Mutable drift state for one camera instance */
interface DriftState {
  time: number;
  noise3D: any; // createNoise3D() result from simplex-noise
}

/**
 * createDriftState - Initialize procedural drift state.
 */
function createDriftState(): DriftState {
  // Import: import { createNoise3D } from "simplex-noise";
  const { createNoise3D } = require("simplex-noise"); // or ES6 import
  return {
    time: 0,
    noise3D: createNoise3D(),
  };
}

/**
 * stepDrift - Advance drift state and return position/target deltas.
 */
function stepDrift(state: DriftState, delta: number): { positionDelta: THREE.Vector3; targetDelta: THREE.Vector3 } {
  state.time += delta;
  const t = state.time * DRIFT_FREQUENCY;
  
  // Sample three independent noise streams (offset in noise space for independence)
  const dx = state.noise3D(t, 0, 0) * DRIFT_AMPLITUDE;
  const dy = state.noise3D(t, 100, 0) * DRIFT_AMPLITUDE;
  const dz = state.noise3D(t, 200, 0) * DRIFT_AMPLITUDE;
  
  // Apply to both position and target (parallel drift, not diverging)
  _scratchDelta.set(dx, dy, dz);
  return {
    positionDelta: _scratchDelta.clone(),
    targetDelta: _scratchDelta.clone(),
  };
}

/**
 * useDrift - Ref-driven drift stepper hook.
 */
function useDrift(enabled: boolean) {
  const state = useRef(createDriftState());
  
  function step(delta: number) {
    if (!enabled) return { positionDelta: new THREE.Vector3(), targetDelta: new THREE.Vector3() };
    return stepDrift(state.current, delta);
  }
  
  return { step };
}
```

**Pattern notes:**
- Module-scoped scratch objects allocated once, reused every frame (allocation-reuse pattern from breathing/sway)
- State held in a `useRef` (never React setState — avoids re-render storm)
- Separate `create`, `step`, and `use` functions for testability
- Noise uses offset coordinates for independent X/Y/Z streams

#### State Reframing Pattern

**Source:** `VRMAvatar.tsx` lines 8, `renderQuality.tsx` (SubjectFocusTracker) lines 699-716

```typescript
import { useKhavee } from "./KhaveeProvider";

/**
 * useStateReframing - Compute target dolly distance based on chatStatus.
 */
function useStateReframing(enabled: boolean, baseDistance: number) {
  const { chatStatus } = useKhavee();
  const currentDistance = useRef(baseDistance);

  useFrame((state, delta) => {
    if (!enabled) return baseDistance;
    
    // Compute target distance (D-10: ~5-10% push-in on speaking)
    const targetDistance = chatStatus === "speaking" 
      ? baseDistance * 0.93 // 7% closer (middle of 5-10% range)
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

**Pattern notes:**
- `useKhavee()` hook accesses chatStatus from React context
- `useFrame` for per-frame interpolation
- Exponential decay lerp: `1 - Math.exp(-delta * k)` for frame-rate-independent smoothing
- Read-only check: if `!enabled`, return base value unchanged

#### useFrame Integration Pattern

**Source:** `AvatarBackdrop.tsx` lines 231-267

```typescript
// Reused per frame; allocating inside useFrame would churn GC
const scratch = useMemo(
  () => ({
    pos: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    camQuat: new THREE.Quaternion(),
  }),
  [],
);

useFrame(({ camera }) => {
  if (!controlsRef.current) return;
  const { pos, forward, camQuat } = scratch;
  
  // Apply drift (if enabled)
  const driftDelta = drift.step(delta);
  
  // Apply state reframing (if enabled)
  const targetDistance = reframing.step(delta);
  const currentDistance = controlsRef.current.getDistance();
  const dollyDelta = targetDistance - currentDistance;
  
  // Skip drift if user is actively orbiting (detect via CameraControls events)
  if (!isUserOrbiting && props.drift !== false) {
    // Apply drift deltas via CameraControls API
    camera.getWorldPosition(pos);
    pos.add(driftDelta.positionDelta);
    // ... apply to CameraControls
  }
  
  if (props.reframe !== false && Math.abs(dollyDelta) > 0.001) {
    controlsRef.current.dolly(dollyDelta, false); // false = no built-in transition (we're interpolating per-frame)
  }
});
```

**Pattern notes:**
- `useMemo(() => ({ ... }), [])` for scratch objects (allocated once, reused every frame)
- `useFrame(({ camera }) => ...)` destructures state.camera
- Apply drift only when user is not actively orbiting (detect via onControlStart/onControlEnd callbacks)
- `controlsRef.current.dolly(delta, false)` applies dolly without built-in transition

#### Easing Function Pattern

**Source:** `crossfade.ts` lines 20-27

```typescript
/**
 * Cubic ease-in-out timing curve. `t` and the return value are both in
 * [0, 1]; endpoints are fixed (0 -> 0, 1 -> 1) and the curve is
 * monotonically increasing across the domain.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
```

**Pattern notes:**
- Existing easing function in `animation/crossfade.ts`
- Can be imported and reused: `import { easeInOutCubic } from "../animation/crossfade";`
- Used for manual interpolation if not relying on CameraControls' built-in transitions

#### Component Return Pattern

**Source:** `renderQuality.tsx` (AvatarPostFX) lines 841-851, `AvatarBackdrop.tsx` lines 269-305

```typescript
export function AvatarCamera({ 
  preset = "bust-shot",
  orbit = "locked",
  drift = true,
  reframe = true,
  ...overrides
}: AvatarCameraProps): ReactElement | null {
  // ... all hooks and logic ...
  
  return <CameraControls ref={controlsRef} />;
}
```

**Pattern notes:**
- Export the function component directly (no need for React.FC wrapper)
- Default values in destructured props
- Return type: `ReactElement | null` (can return null if disabled, though camera always returns CameraControls)
- Mount `<CameraControls>` from drei with a ref

---

### `packages/react/src/index.ts` (config, N/A)

**Analog:** `packages/react/src/index.ts` (itself) lines 1-52

#### Barrel Export Pattern

**Source:** `packages/react/src/index.ts` lines 45-50

```typescript
export { AvatarBackdrop } from "./utils/AvatarBackdrop";
export type {
  AvatarBackdropProps,
  AvatarBackground,
  BackgroundFit,
} from "./utils/AvatarBackdrop";
```

**Add to index.ts:**
```typescript
export { AvatarCamera } from "./utils/AvatarCamera";
export type {
  AvatarCameraProps,
  CameraPreset,
  OrbitMode,
} from "./utils/AvatarCamera";
```

**Pattern notes:**
- Export both the component and its types
- Component export uses named export, not default
- Type exports in a separate block with `export type { ... }`

---

### Demo Page (optional verification harness)

**Analog:** `apps/playground/src/app/openai/page.tsx` lines 1-86

#### Demo Page Structure Pattern

**Source:** `apps/playground/src/app/openai/page.tsx` lines 1-86

```typescript
'use client';

import { KhaveeProvider, VRMAvatar, AvatarCamera } from '@khaveeai/react';
import { Canvas } from '@react-three/fiber';
import { useState } from 'react';

function CameraDemo() {
  const [preset, setPreset] = useState<"bust-shot" | "medium-close-up" | "full-body">("bust-shot");
  const [orbit, setOrbit] = useState<"locked" | "constrained" | "free">("locked");

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Camera Direction Demo</h1>
        
        <div className="flex gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">Preset:</label>
            <select 
              value={preset} 
              onChange={(e) => setPreset(e.target.value as any)}
              className="px-4 py-2 border rounded"
            >
              <option value="bust-shot">Bust Shot</option>
              <option value="medium-close-up">Medium Close-Up</option>
              <option value="full-body">Full Body</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Orbit Mode:</label>
            <select 
              value={orbit} 
              onChange={(e) => setOrbit(e.target.value as any)}
              className="px-4 py-2 border rounded"
            >
              <option value="locked">Locked</option>
              <option value="constrained">Constrained</option>
              <option value="free">Free</option>
            </select>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow" style={{ height: '600px' }}>
          <Canvas shadows>
            <AvatarCamera preset={preset} orbit={orbit} />
            <VRMAvatar src="/models/male.vrm" position={[0, -1, 0]} />
          </Canvas>
        </div>
      </div>
    </div>
  );
}

export default function CameraPage() {
  return (
    <KhaveeProvider config={{}}>
      <CameraDemo />
    </KhaveeProvider>
  );
}
```

**Pattern notes:**
- `'use client';` directive at top (Next.js App Router requirement)
- Import from `@khaveeai/react` (published-style workspace package name)
- Wrap in `KhaveeProvider` at page level
- Mount `AvatarCamera` inside `<Canvas>` as a sibling of avatar components
- Use state hooks to wire interactive controls for testing

---

## Shared Patterns

### React Three Fiber Hook Usage

**Source:** Multiple files (`AvatarBackdrop.tsx`, `VRMAvatar.tsx`, `breathing.ts`)

**Apply to:** `AvatarCamera.tsx`

```typescript
import { useFrame, useThree } from "@react-three/fiber";

// Access camera and size from R3F context
const { camera, size } = useThree();

// Per-frame updates
useFrame((state, delta) => {
  // state.camera is the active three.js camera
  // delta is time since last frame (seconds)
  // ... apply camera updates ...
});
```

**Usage:**
- `useThree()` accesses R3F's shared context (camera, gl, size, etc.)
- `useFrame` runs every frame, receives `(state, delta)` callback
- All per-frame camera updates go inside `useFrame`

### useRef for Per-Frame State

**Source:** `breathing.ts` lines 122-135, `sway.ts` lines 131-144

**Apply to:** `AvatarCamera.tsx` (drift state, reframing state)

```typescript
const state = useRef(createDriftState());

// Never use setState for per-frame data — causes re-render storm
// Always use useRef for mutable state updated in useFrame
```

**Usage:**
- Any state that updates every frame MUST use `useRef`, never `useState`
- `useState` triggers React re-renders; `useRef` does not
- This is a codebase-wide convention (see breathing.ts file header comment)

### Allocation-Reuse for Scratch Objects

**Source:** `breathing.ts` lines 39, `sway.ts` lines 45, `AvatarBackdrop.tsx` lines 231-240

**Apply to:** `AvatarCamera.tsx` (scratch vectors/quaternions in useFrame)

```typescript
// Module-scoped (outside component, allocated once per module load)
const _scratchVector = new THREE.Vector3();

// OR component-scoped via useMemo (allocated once per component instance)
const scratch = useMemo(
  () => ({
    pos: new THREE.Vector3(),
    forward: new THREE.Vector3(),
  }),
  [],
);

useFrame(() => {
  // Reuse scratch objects (set, never `new`)
  _scratchVector.set(x, y, z);
  scratch.pos.copy(camera.position);
  // ... use and reuse ...
});
```

**Usage:**
- Never `new THREE.Vector3()` inside `useFrame` (causes GC churn)
- Allocate once, reuse via `.set()`, `.copy()`, etc.
- Module-scoped for shared scratch (all instances share), or `useMemo(() => ({}), [])` for per-instance

### Optional Callback Ref Pattern

**Source:** `AvatarBackdrop.tsx` lines 99-103

**Apply to:** `AvatarCamera.tsx` (if adding onError or similar callbacks)

```typescript
// Kept in a ref so an inline callback — the ordinary way to pass one — does
// not re-run the load effect on every parent render
const onErrorRef = useRef(onError);
useEffect(() => {
  onErrorRef.current = onError;
}, [onError]);

// Inside async effect or useFrame:
onErrorRef.current?.(error);
```

**Usage:**
- If accepting optional callbacks (`onError`, `onCameraMove`, etc.), store in a ref
- Update ref in a `useEffect` watching the prop
- Prevents unnecessary effect re-runs when parent passes inline lambdas

---

## No Analog Found

No files in this phase lack an analog — all patterns are well-established in the codebase.

---

## Metadata

**Analog search scope:**
- `packages/react/src/utils/` (AvatarBackdrop, renderQuality)
- `packages/react/src/animation/` (breathing, sway, crossfade)
- `packages/react/src/` (VRMAvatar, KhaveeProvider, index.ts)
- `apps/playground/src/app/` (openai page, Experience component)

**Files scanned:** 8
**Pattern extraction date:** 2026-09-18

**Coverage:**
- **Component structure:** AvatarBackdrop (per-Canvas opt-in component)
- **Props & defaults:** AvatarPostFX (boolean defaults, partial override pattern)
- **CameraControls usage:** Experience.tsx (ref, constraints, transitions)
- **Procedural animation:** breathing.ts, sway.ts (useRef state, per-frame updates, allocation-reuse)
- **chatStatus integration:** VRMAvatar.tsx (useKhavee hook)
- **Easing:** crossfade.ts (easeInOutCubic)
- **useFrame patterns:** AvatarBackdrop, SubjectFocusTracker (per-frame camera tracking)
- **Barrel export:** index.ts (named exports for component + types)
