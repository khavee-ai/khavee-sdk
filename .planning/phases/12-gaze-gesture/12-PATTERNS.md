# Phase 12: Gaze & Gesture - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 7 (3 new, 4 modified)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/react/src/animation/gaze.ts` (NEW) | utility (procedural bone-delta module) | event-driven (per-frame continuous, `chatStatus`-branched) | `packages/react/src/animation/breathing.ts` | exact (structural template); math shape itself has no exact precedent (target-tracking vs. fixed-axis sine) — see `sway.ts`'s 11-17 targeting note as a secondary analog |
| `packages/react/src/animation/gesture.ts` (NEW) | utility (procedural bone-delta module, triggered/consumed) | event-driven (triggered, one-shot, queued) | `packages/react/src/animation/breathing.ts` (shape) + `packages/react/src/animation/talkCycle.ts` (loop-boundary / one-shot-consume state machine) | exact (structural template) / role-match (queuing state machine) |
| `packages/core/src/tools/gesture.ts` (NEW) | config (LLM tool-schema factory object) | request-response (LLM function-calling contract) | `packages/core/src/tools/animate.ts` | exact (shape to mirror), but see "No Analog Found" note — `toolAnimate`'s `parameters` shape does NOT type-check against `RealtimeTool["parameters"]`; do not copy that part literally |
| `packages/react/src/animation/AnimationStateEngine.ts` (MODIFY) | controller (per-frame composition orchestrator) | event-driven (fixed-order `update(delta)` pipeline) | itself (extend `update()`'s existing composition list) | exact — this is the single call site, not a file to find an analog for |
| `packages/react/src/animation/talkCycle.ts` (MODIFY) | utility (loop-boundary detection, extract reusable primitive) | event-driven | itself (extract `stepTalkCycle`'s inline wrap-check, lines 96-109, into a new pure exported function) | exact |
| `packages/core/src/index.ts` (MODIFY) | config (barrel export) | N/A (module re-export) | itself (currently only re-exports `./types` and `./client/khavee-client`) | exact — add `export { toolGesture } from './tools/gesture'` (and, as a drive-by fix, `toolAnimate`) |
| `packages/react/src/KhaveeProvider.tsx` (MODIFY) | provider (React context) | event-driven (context field + public setter, app-writable) | itself — extend `KhaveeContextType`/`useState` (structurally like `currentVolume`, but visibility differs — see Pitfall below) | role-match (partial: `currentVolume`'s field-placement pattern applies; its setter-visibility does NOT — see Shared Patterns) |

## Pattern Assignments

### `packages/react/src/animation/gaze.ts` (NEW — utility, event-driven)

**Analog:** `packages/react/src/animation/breathing.ts` (whole-file structural template — read in full, 136 lines)

**File header / module doc pattern** (breathing.ts lines 1-29): every procedural module opens with a doc comment explaining (a) role in one line, (b) explicitly "NOT exported from index.ts", (c) the `use<Thing>()`/pure-`step`-function split and why (`useRef`, never `useState`, to avoid a re-render every animation frame), (d) the PERF-01 additive-`multiply()` composition rule, (e) a testability note. `gaze.ts` should follow this exact five-part header shape, but must ALSO document the target-tracking math (see Pitfall 1/4 below) since it deviates from breathing's fixed-axis-sine shape — flag this deviation explicitly in the header, mirroring `sway.ts`'s own precedent of documenting *why* it differs from `breathing.ts` (11-17 header note, lines 14-26).

**Imports pattern** (breathing.ts lines 31-33):
```typescript
import { useRef } from "react";
import * as THREE from "three";
import type { AvatarFormatAdapter } from "./types";
```
`gaze.ts` additionally needs `THREE.Camera` (already covered by `* as THREE`) and, if using D-04's `useThree()` route, `import { useThree } from "@react-three/fiber"` — confirmed available via `VRMAvatar.tsx`/`GLBAvatar.tsx`'s existing `import { useFrame } from "@react-three/fiber"`.

**Module-scoped scratch objects** (breathing.ts lines 35-53):
```typescript
const _scratchDelta = new THREE.Quaternion();
const BREATHING_AXIS = new THREE.Vector3(1, 0, 0);
const DEFAULT_AMPLITUDE = 0.03;
const PERIOD_MIN = 4.0;
const PERIOD_MAX = 6.0;
```
Gaze's camera-relative math (Pattern 3 in RESEARCH.md) needs THREE scratch quaternions per the `AnimationStateEngine.ts` clamp precedent (see below) — at minimum `_scratchTarget` (absolute look-at target, scratch-only, NEVER written to the live bone), `_scratchCurrent` (bone's pre-gaze orientation, captured before any gaze write), `_scratchDelta` (target diffed against current, clamped, then applied). Do not allocate any `THREE.Quaternion`/`THREE.Vector3` inside `step()` — module-scoped and reused every call, exactly like breathing's `_scratchDelta`.

**Core step-function pattern, chatStatus-branched** (breathing.ts lines 94-114, adapted):
```typescript
export function stepBreathing(
  state: BreathingState,
  adapter: AvatarFormatAdapter,
  delta: number,
  amplitudeScale = 1,
): void {
  const chest = adapter.getHumanoidBoneNode("chest");
  const spine = adapter.getHumanoidBoneNode("spine");
  if (!chest || !spine) return;
  state.phase += (delta / state.period) * Math.PI * 2;
  const angle = breathingDeltaAngle(state.phase, DEFAULT_AMPLITUDE, amplitudeScale);
  _scratchDelta.setFromAxisAngle(BREATHING_AXIS, angle);
  chest.quaternion.multiply(_scratchDelta);
  spine.quaternion.multiply(_scratchDelta);
}
```
`stepGaze` follows the identical defensive-gate + additive-`multiply()` shape, but branches on `chatStatus` (per GAZE-01's per-state mapping) BEFORE choosing fixed-aversion (thinking) vs. camera-relative (ready/listening/speaking) vs. no-op (starting/stopped) math — see RESEARCH.md's Pattern 3 pseudocode (lines 190-209) for the exact branch shape, already vetted against this codebase's conventions.

**Hook wrapper pattern** (breathing.ts lines 122-135):
```typescript
export function useBreathing(): {
  step(adapter: AvatarFormatAdapter, delta: number, amplitudeScale?: number): void;
} {
  const state = useRef(createBreathingState());
  function step(adapter: AvatarFormatAdapter, delta: number, amplitudeScale = 1): void {
    stepBreathing(state.current, adapter, delta, amplitudeScale);
  }
  return { step };
}
```
`useGaze()` mirrors this exactly, but `step()`'s signature needs an additional `camera: THREE.Camera` and `chatStatus: ChatStatus` argument (see `useAnimationController`'s params shape in AnimationStateEngine.ts for how `chatStatus` is already threaded into other steppers, e.g. `talkCycle.step({ chatStatus, ... })`).

**Bounded-delta clamp pattern to reuse (NOT breathing/sway — this is genuinely new math)** — source: `AnimationStateEngine.ts`'s PERF-01 spine clamp (lines 432-433, 1098-1118):
```typescript
// Module-scoped, reused every call — never `new` per-frame:
const _spineBaseScratch = new THREE.Quaternion();
const _spineComposedScratch = new THREE.Quaternion();
// ...
if (spine) {
  _spineComposedScratch.copy(spine.quaternion);
  const combinedAngle = _spineBaseScratch.angleTo(_spineComposedScratch);
  if (combinedAngle > MAX_COMBINED_SPINE_DELTA_RAD) {
    const t = MAX_COMBINED_SPINE_DELTA_RAD / combinedAngle;
    spine.quaternion.copy(_spineBaseScratch).slerp(_spineComposedScratch, t);
  }
}
```
This is the exact `angleTo()` + `copy().slerp()` clamp-toward-bound idiom RESEARCH.md's Don't-Hand-Roll table (row 3) says to reuse for gaze's own max-offset-angle clamp — apply it to the delta itself (target vs. current bone orientation), not the composed spine bone. Note the explicit comment on why `slerpQuaternions(base, spine.quaternion, t)` directly on the live bone would self-corrupt (two independent scratches required, never one).

**Camera access pattern** — source: `VRMAvatar.tsx` line 494 / `GLBAvatar.tsx` line 178 (existing `useFrame` call sites) + D-04's decision:
```typescript
// VRMAvatar.tsx (existing, current signature discards first arg):
useFrame((_, delta) => { ... controller.update(delta); ... });
// GLBAvatar.tsx (existing, identical shape):
useFrame((_, delta) => { controller.update(delta); });
```
Per D-04, use `useThree().camera` (called once per component render, not per-frame) rather than renaming `useFrame`'s first arg to `state` and reading `state.camera` — both resolve to the identical `RootState.camera` object (confirmed in RESEARCH.md), but D-04 explicitly locks `useThree()` as the access pattern. `VRMAvatar.tsx`/`GLBAvatar.tsx` will each need `import { useFrame, useThree } from "@react-three/fiber"` and a `const camera = useThree((state) => state.camera);` call, then thread `camera` into `useAnimationController`'s params (see AnimationStateEngine.ts modification below) or pass it directly to `gaze.step(...)` inside the existing `useFrame` callback.

---

### `packages/react/src/animation/gesture.ts` (NEW — utility, event-driven, triggered)

**Analog 1 (shape/hook/scratch):** `packages/react/src/animation/breathing.ts` — same `use<Thing>()`/pure-`step`/module-scoped-scratch shape as gaze.ts above. Gesture's delta is a bounded ONE-SHOT pulse (head-pitch for nod, head-yaw for shake), not a continuous oscillator — closer in spirit to `blink.ts`'s triggered-pulse-with-envelope shape than breathing/sway's infinite sine (blink.ts was not read this session, but is cited in AnimationStateEngine.ts's imports as the doc-comment precedent breathing.ts itself points to for "triggered, ref-driven, non-oscillating" procedural writes — worth reading directly during implementation for its exact envelope-easing shape, e.g. `easeInOutCubic` reuse from `crossfade.ts`).

**Analog 2 (queuing / loop-boundary consume-once state machine):** `packages/react/src/animation/talkCycle.ts` (full file read, 135 lines)

**Loop-boundary wrap-detection to extract as a reusable pure function** (talkCycle.ts lines 96-109, exact source to refactor):
```typescript
let loopBoundary = false;
if (currentTime !== null && duration !== null && duration > 0) {
  if (state.prevActionTime !== null) {
    loopBoundary =
      currentTime < state.prevActionTime ||
      (currentTime >= duration && state.prevActionTime < duration);
  }
  state.prevActionTime = currentTime;
}
```
RESEARCH.md (Pattern 4, Don't-Hand-Roll row 2) mandates extracting this into a new exported pure function in `talkCycle.ts`, e.g. `export function detectLoopBoundary(currentTime: number | null, prevTime: number | null, duration: number | null): boolean`, called by BOTH `stepTalkCycle` (unchanged behavior) AND gesture.ts's new queue-step (own `prevActionTime` tracking, independent instance). Do not reimplement this wrap-check inline in `gesture.ts` — that risks the two detectors silently disagreeing on edge cases (a non-looping clip clamped at its end).

**Consume-and-clear trigger pattern** — source: `talkCycle.ts`'s `stepTalkCycle` return-null-or-name shape (lines 75-119) is the precedent for "read a pending signal, act on it once, then implicitly consume it" — but talkCycle's actual clearing is done by the CALLER re-setting state via `switchToClip`, not by talkCycle itself. Gesture's consume-and-clear is different in kind (per RESEARCH.md's diagram, gesture calls `setGestureHint(null)` after playing) — this is closer to the `KhaveeProvider.tsx` `currentAnimation`/`animate()` set-then-read-once pattern than to `talkCycle.ts`'s pure-function return value. Model gesture's queue state as: `{ pendingGesture: 'nod'|'shake'|null, playing: boolean, elapsed: number }`, held in a `useRef` inside `useGesture()`, with `step()` reading `chatStatus`+`gestureHint` (from context, threaded down as a param, mirroring how `talkCycle.step({ chatStatus, currentAction, ... })` receives its params) and returning/consuming state internally.

**Per-D-06 branch: immediate-vs-queued application:**
```typescript
// Illustrative shape, following talkCycle.ts's params-object step() convention:
export interface GestureStepParams {
  chatStatus: ChatStatus;
  gestureHint: "nod" | "shake" | "none" | null;
  currentAction: THREE.AnimationAction | null; // for loop-boundary detection while speaking
  delta: number;
}
// if chatStatus !== "speaking": play immediately (D-06)
// if chatStatus === "speaking": wait for detectLoopBoundary(...) before starting
```

---

### `packages/core/src/tools/gesture.ts` (NEW — config, request-response)

**Analog:** `packages/core/src/tools/animate.ts` (full file, 22 lines)

**Exact shape to mirror (outer fields only — see Pitfall below for what NOT to copy)**:
```typescript
// Source: packages/core/src/tools/animate.ts (existing, unchanged)
export const toolAnimate = {
  name: "trigger_animation",
  description: "Trigger an animation on the VRM avatar",
  parameters: {
    type: "object",
    properties: {
      animation: { type: "string", description: "Name of the animation to trigger" },
      intensity: { type: "number", description: "Animation intensity (0-1)", minimum: 0, maximum: 1, default: 1 }
    },
    required: ["animation"]
  }
};
```
D-01/D-02/D-03 lock: `name` (`"set_gesture"`), `description` (explicit nod/shake coaching per D-03), `parameters`, no `execute` field, plain exported const object — mirror these OUTER characteristics exactly.

**Do NOT mirror `parameters`'s inner JSON-Schema envelope** (`type: "object"` / `properties` / `required` array) — cross-checked against the actual consumer type:
```typescript
// Source: packages/core/src/types/realtime.ts lines 7-22 (RealtimeTool interface)
export interface RealtimeTool {
  name: string;
  description: string;
  parameters: {
    [key: string]: {
      type: "string" | "number" | "boolean" | "array" | "object";
      required?: boolean;
      enum?: string[];
      description?: string;
    };
  };
  execute: (args: any) => Promise<{ success: boolean; message: string }>;
}
```
`toolAnimate`'s nested `{ type: "object", properties: {...}, required: [...] }` shape does NOT satisfy `RealtimeTool["parameters"]`'s flatter `{ [key]: { type, required?, enum?, description? } }` shape — `toolAnimate` has never been exercised end-to-end (confirmed unexported/unused), so this mismatch has never been caught. `toolGesture` MUST use the flatter, `RealtimeTool`-compatible shape so it actually type-checks when spread into `RealtimeConfig.tools`:
```typescript
// Correct shape for toolGesture (synthesized from RealtimeTool's real interface):
export const toolGesture = {
  name: "set_gesture",
  description: "...(D-03 nod/shake coaching)...",
  parameters: {
    gesture: {
      type: "string",
      enum: ["nod", "shake", "none"],
      required: true,
      description: "...",
    },
  },
};
```

---

### `packages/react/src/animation/AnimationStateEngine.ts` (MODIFY — controller)

**Analog:** itself — this is the single fixed-order composition call site; no external analog needed, only the existing convention.

**Composition-order convention to extend, not reorder** (file header, lines 911-924, and `update()`'s own numbered comment list):
```
1. crossfade ramp -> 2. blink -> 3. amplitude/settle scale compute
-> 4a. lazily capture rest-pose anchor -> 4b. reset-if-not-driven
-> 4c. capture spine base -> 5. breathing -> 6. sway -> 7. spine
clamp -> 8. expression drift -> 9. talk-cycle.
"Any future addition to this stack should extend this list, not
reorder it silently."
```
Gaze and gesture are appended as new numbered steps (10, 11) at the end of `update(delta)` (after talk-cycle, per RESEARCH.md's diagram) — update the header comment's numbered list AND `update()`'s own inline numbered-step comments to document the new full order, matching this file's self-documentation convention exhibited across every one of its six prior gap-closure passes (11-09 through 11-17).

**`useAnimationController`'s params object — pattern for adding new inputs** (lines 774-803):
```typescript
export function useAnimationController(params: {
  adapter: AvatarFormatAdapter;
  chatStatus: ChatStatus;
  currentAnimation: string | null;
  availableNames: string[];
  getAction: (name: string) => THREE.AnimationAction | null;
  getRoot: () => THREE.Object3D | null;
  enableBlinking: boolean;
  currentVolume?: number;
  dampProceduralOnManualClip?: boolean;
}): { update: (delta: number) => void } {
```
Add `camera: THREE.Camera` (or `THREE.Camera | null`) and `gestureHint: "nod" | "shake" | "none" | null` to this params object, following the same optional-field convention `currentVolume`/`dampProceduralOnManualClip` already establish (destructure at the top of the function body alongside the existing params, lines 793-803).

**New hook instantiation pattern** (lines 805-809):
```typescript
const blink = useBlink();
const breathing = useBreathing();
const sway = useSway();
const expressionDrift = useExpressionDrift();
const talkCycle = useTalkCycle();
```
Add `const gaze = useGaze();` and `const gesture = useGesture();` alongside these.

**Bounded-magnitude clamp precedent (PERF-01)** — `MAX_COMBINED_SPINE_DELTA_RAD` (line 471) is the exact naming/sizing convention for gaze/gesture's own bound if their head/neck bone targets ever need a similar composed-magnitude clamp (CONTEXT.md notes no bone overlap is currently expected with breathing/sway's spine/chest/hips targets, so this is likely N/A for composition WITH those systems, but gaze's own internal target-vs-current clamp reuses the same `angleTo()`/`slerp()` idiom — see gaze.ts's Pattern Assignment above).

---

### `packages/react/src/animation/talkCycle.ts` (MODIFY — utility)

**Analog:** itself — extract the existing inline wrap-check (lines 96-109, reproduced in gesture.ts's Pattern Assignment above) into a new exported pure function, e.g. `detectLoopBoundary(currentTime, prevTime, duration)`, called by both the existing `stepTalkCycle` (replacing its inline block, same behavior) and gesture.ts's new queue-step. Follow this file's existing exported-pure-function convention (`nextVariantIndex`, lines 62-66) for how a small helper is carved out and independently unit-tested.

---

### `packages/core/src/index.ts` (MODIFY — config/barrel)

**Analog:** itself (current state, full file):
```typescript
// Core SDK Types and Interfaces
export * from './types';
export * from './client/khavee-client';
```
Add explicit named re-exports for the tools:
```typescript
export { toolGesture } from './tools/gesture';
export { toolAnimate } from './tools/animate'; // drive-by fix — currently unexported, confirmed unused anywhere in this repo
```
This is not optional — confirmed via direct inspection that `packages/core/src/index.ts` has no `./tools` re-export today, and `packages/core/package.json`'s `exports` field (single `"."` entry, no subpath) means `import { toolGesture } from '@khaveeai/core/tools/gesture'` is also not a viable workaround; the barrel export is the only fix site.

---

### `packages/react/src/KhaveeProvider.tsx` (MODIFY — provider)

**Analog:** itself — extend `KhaveeContextType`/the provider's internal `useState` calls, following `currentVolume`'s FIELD-PLACEMENT pattern but NOT its setter-visibility pattern (see Shared Patterns below for why these diverge).

**`currentVolume`'s existing wiring (field placement precedent)** — lines 25 (context type), 98 (`useState`), 125-130 (internal-only effect-based setter):
```typescript
interface KhaveeContextType {
  // ...
  currentVolume: number;
}
// ...
const [currentVolume, setCurrentVolume] = useState(0);
// ...
useEffect(() => {
  if (realtimeProvider) {
    realtimeProvider.onVolumeChange = (volume) =>
      setCurrentVolume(Math.max(0, Math.min(1, volume)));
  }
}, [realtimeProvider]);
```
`currentVolume` IS exposed via the context value object (line 283) and thus via `useKhavee()`'s return; `setCurrentVolume` is NOT — its only writer is the internal effect. `gestureHint` should follow the SAME context-type/value-object field-placement shape, but its setter (`setGestureHint`) must ALSO be added to the context value object and returned by `useKhavee()` — see Shared Patterns for the reasoning (Pitfall 3 from RESEARCH.md).

**Input-clamping/validation convention** — `setExpression`'s clamp (lines 156-159):
```typescript
const setExpression = useCallback((name: string, value: number) => {
  const clampedValue = Math.max(0, Math.min(1, value));
  setExpressions(prev => ({ ...prev, [name]: clampedValue }));
}, []);
```
`setGestureHint` should apply the equivalent allow-list validation for the untrusted LLM-sourced `gesture` string (RESEARCH.md's Security Domain, V5 Input Validation row) — validate against `'nod'|'shake'|'none'` before storing, defaulting anything unrecognized to a no-op (never throw) — mirroring this exact clamp-not-throw convention.

## Shared Patterns

### Ref-driven procedural-system shape (applies to gaze.ts AND gesture.ts)
**Source:** `packages/react/src/animation/breathing.ts` (whole file)
**Apply to:** Both new animation modules
- `use<Thing>()` hook wraps `useRef`-backed mutable state (never `useState` — a setter would re-render every animation frame, fighting the R3F render loop).
- Pure, independently-testable `create<Thing>State()` / `step<Thing>(state, adapter, ...)` functions, no React dependency.
- Module-scoped scratch `THREE.Quaternion`/`THREE.Vector3` objects, reused every call across every hook instance — never `new` inside the per-frame path.
- Additive write via `bone.quaternion.multiply(scratch)`, NEVER `.set()` or a direct overwrite (PERF-01) — this is the single most important rule for both new files, and the one gaze.ts is most at risk of violating (`Object3D.lookAt()` is an absolute overwrite — see Pitfall below).
- Defensive early-return when a required bone cannot be resolved (`if (!chest || !spine) return;`).

### Bounded-magnitude clamp (angleTo + slerp-toward-bound)
**Source:** `packages/react/src/animation/AnimationStateEngine.ts` lines 432-433, 1076-1118 (the PERF-01 spine clamp)
**Apply to:** `gaze.ts`'s own target-vs-current delta clamp (the one place this phase needs genuinely new clamp math)
```typescript
const _scratchBase = new THREE.Quaternion();     // pre-write orientation
const _scratchComposed = new THREE.Quaternion(); // post-write orientation
// ...
const angle = _scratchBase.angleTo(_scratchComposed);
if (angle > MAX_ALLOWED_RAD) {
  const t = MAX_ALLOWED_RAD / angle;
  bone.quaternion.copy(_scratchBase).slerp(_scratchComposed, t);
}
```
Two independent scratches are required — never `slerpQuaternions(base, bone.quaternion, t)` directly on the live bone (self-corrupts, since `.copy(qa)` on `this` overwrites `qb` before `.slerp(qb, t)` reads it — documented inline at AnimationStateEngine.ts lines 424-431).

### Tool factory object shape (LLM function-calling contract)
**Source:** `packages/core/src/tools/animate.ts` (outer shape) + `packages/core/src/types/realtime.ts`'s `RealtimeTool` interface (the actual type constraint)
**Apply to:** `packages/core/src/tools/gesture.ts`
- Plain exported `const`, `name`/`description`/`parameters` fields only, NO `execute` field (the app supplies `execute` at `RealtimeConfig.tools` construction time or via `registerFunction()`).
- `parameters` MUST use `RealtimeTool["parameters"]`'s flatter shape (`{ [key]: { type, required?, enum?, description? } }`), NOT `toolAnimate`'s nested JSON-Schema envelope (which does not type-check against the real consumer interface — a pre-existing, previously-uncaught gap since `toolAnimate` has never been exported/used).

### Context field + public setter for app-writable signals (diverges from `currentVolume`)
**Source:** `packages/react/src/KhaveeProvider.tsx` (existing `currentVolume` wiring, lines 25, 98, 125-130, 283) — partial analogy only
**Apply to:** New `gestureHint`/`setGestureHint` field on `KhaveeContextType`
**Critical divergence (RESEARCH.md Pitfall 3):** `currentVolume`'s setter is internal-only because its sole writer is an SDK-internal `useEffect` (`realtimeProvider.onVolumeChange = ...`). Gesture's writer is different in kind: the LLM tool's `execute` callback is supplied by the CONSUMING APP, typically at `RealtimeConfig.tools` construction time — per this codebase's own demo pattern (`src/app/rag-realtime/page.tsx`'s module-scoped `provider = new OpenAIRealtimeProvider({ tools: [...] })`), this often happens OUTSIDE the React tree, before `KhaveeProvider` even mounts. Copying `currentVolume`'s setter-stays-internal pattern literally leaves the field readable but not writable by app code — the exact tell RESEARCH.md flags as the pitfall's warning sign. `setGestureHint` MUST be added to the object `useKhavee()` returns (unlike `setCurrentVolume`), so an app component can call `provider.registerFunction({ ...toolGesture, execute: (args) => { setGestureHint(args.gesture); ... } })` inside a `useEffect`, the same reassignment pattern this codebase already uses for `onChatStatusChange`/`onVolumeChange`.

### Fixed, documented, append-only composition order (PERF-01)
**Source:** `packages/react/src/animation/AnimationStateEngine.ts`'s `update()` numbered-step convention (lines 911-924, extended six times across Phase 11's 11-09 through 11-17 gap closures without ever reordering)
**Apply to:** All new `update()` additions — gaze and gesture steps append to the end of the existing numbered list; the header comment AND the inline step comments are both updated in the same change, matching this file's own established self-documentation discipline.

## No Analog Found

None — all 7 files have a concrete existing-code analog in this codebase (breathing.ts/sway.ts for the procedural shape, talkCycle.ts for loop-boundary/queuing, animate.ts + realtime.ts for the tool contract, AnimationStateEngine.ts/KhaveeProvider.tsx/index.ts as their own extension targets). The one piece with genuine novelty — gaze's camera-relative look-at delta math (Pattern 3 in RESEARCH.md) — has no in-codebase precedent to copy verbatim, but IS covered by an external, vetted reference (three-vrm GitHub issue #1173) plus this codebase's own PERF-01 clamp idiom (`AnimationStateEngine.ts`'s spine clamp), both cited above; it is flagged as the phase's one higher-risk task, not as a missing pattern.

## Metadata

**Analog search scope:** `packages/react/src/animation/*.ts` (all procedural systems: breathing, sway, blink [cited, not read], expressionDrift [cited, not read], talkCycle, crossfade [cited, not read], AnimationStateEngine, types), `packages/react/src/{VRMAvatar,GLBAvatar,KhaveeProvider}.tsx`, `packages/core/src/{index.ts,tools/animate.ts,types/realtime.ts,types/conversation.ts,package.json}`
**Files scanned:** 13 read directly this session (breathing.ts, sway.ts, animate.ts, index.ts, realtime.ts, AnimationStateEngine.ts [full, 1151 lines across 2 reads], talkCycle.ts, types.ts, KhaveeProvider.tsx, VRMAvatar.tsx [targeted sections], GLBAvatar.tsx [targeted sections], conversation.ts [targeted], breathing.test.ts [targeted]) + core/package.json via grep
**Pattern extraction date:** 2026-07-17
