# Phase 18: Facial Performance — Eyes, Visemes & Emotion - Pattern Map

**Mapped:** 2026-09-18
**Files analyzed:** 13 (new/modified, per CONTEXT.md D-01..D-16 + RESEARCH.md's Recommended Project Structure)
**Analogs found:** 13 / 13 (every file has at least a role-match analog; several have exact structural analogs)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/react/src/animation/eyeGaze.ts` (new) | animation-module (procedural, per-frame) | transform (target-tracking, continuous) | `packages/react/src/animation/gaze.ts` | exact (same role, same target-tracking data flow, D-03 explicitly forks from it) |
| `packages/react/src/animation/eyeGaze.test.ts` (new) | test | transform | `packages/react/src/animation/gaze.test.ts` | exact |
| `packages/react/src/animation/viseme.ts` (new) | animation-module (procedural, per-frame + event-consuming) | transform + event-driven (consumes `PhonemeData` stream) | `packages/react/src/animation/gesture.ts` (trigger/consume shape) + `packages/react/src/hooks/useAudioLipSync.ts` (`phonemeToMouthState`, viseme-value shape) | role-match (composite of two analogs — see Pattern Assignments) |
| `packages/react/src/animation/viseme.test.ts` (new) | test | transform | `packages/react/src/animation/gesture.test.ts` | role-match |
| `packages/react/src/animation/emotion.ts` (new) | animation-module (procedural, hint-consuming) | event-driven (consumes `emotionHint`) + transform (crossfade) | `packages/react/src/animation/gesture.ts` (hint-consume-clear shape) + `packages/react/src/animation/expressionDrift.ts` (expression-write/ownership-guard shape) + `packages/react/src/animation/crossfade.ts` (`easeInOutCubic`) | exact (composite of three analogs, all explicitly named in CONTEXT.md/RESEARCH.md) |
| `packages/react/src/animation/emotion.test.ts` (new) | test | transform | `packages/react/src/animation/expressionDrift.test.ts` + `gesture.test.ts` | role-match |
| `packages/react/src/animation/AnimationStateEngine.ts` (modified — append steps 12-13) | animation-orchestrator | transform (composition order) | itself (existing steps 10-11: gaze + gesture composition) | exact |
| `packages/react/src/animation/types.ts` (modified — extend bone-role union) | type-definition | — | itself (existing `AvatarFormatAdapter.getHumanoidBoneNode` role union) | exact |
| `packages/react/src/animation/blink.ts` (modified — add `forceBlink` param, D-02) | animation-module | event-driven (new trigger surface) | itself (existing `useBlink()`/`step()` signature) | exact |
| `packages/react/src/animation/blink.test.ts` (new — does not exist today) | test | transform | `packages/react/src/animation/gesture.test.ts` (closest triggered-behavior test shape) | role-match |
| `packages/core/src/tools/emotion.ts` (new) | tool-definition / factory | request-response (LLM tool call) | `packages/core/src/tools/gesture.ts` (bare-object shape) — but D-11/Open-Question-3 requires a **factory function**, closer to a hypothetical `createXTool(setter)` pattern not yet in the codebase; `packages/core/src/types/tools.ts`'s `Tool`/`ToolExecutor` is the dispatch contract to satisfy | role-match (shape precedent from `gesture.ts`, factory requirement is new) |
| `packages/core/src/tools/__tests__/emotion.test.ts` (new) | test | request-response | `packages/core/src/tools/__tests__/` (directory convention; no existing tool test file to copy structure from — dir exists, files TBD) | partial (no sibling test file found — see No Analog Found) |
| `packages/react/src/KhaveeProvider.tsx` (modified — add `emotionHint`/`setEmotionHint`) | provider (React context) | event-driven (hint bridge) | itself (existing `gestureHint`/`setGestureHint` field pair) | exact |
| `packages/react/src/VRMAvatar.tsx` (modified — thread `emotionHint`/eye-bone adapter method into controller) | component (orchestrator) | transform (useFrame composition) | itself (existing `gestureHint`/`onGestureConsumed` threading into `useAnimationController`) | exact |
| `packages/react/src/hooks/useAudioLipSync.ts` (modified — mark `@deprecated`, D-08) | hook | streaming (audio analysis) | itself | exact (no external analog needed — modifying in place) |
| `packages/react/src/hooks/useRealtime.ts` (modified — improve `RealtimeAudioAnalyzer` per D-05 fallback) | hook | streaming (audio analysis) | itself (`useAudioLipSync.ts`'s near-duplicate `phonemeToMouthState`/`RealtimeAudioAnalyzer` — the two files already mirror each other) | exact |
| `packages/core/src/types/pipeline.ts` (possibly modified — optional viseme-timing field) | type-definition | — | itself (existing `TTSProvider.speak()` opts shape) | exact |
| `packages/core/src/types/audio.ts` (possibly modified — extend `PhonemeData` per Pitfall 6) | type-definition | — | itself (existing `PhonemeData`/`MouthState` interfaces) | exact |

## Pattern Assignments

### `packages/react/src/animation/eyeGaze.ts` (animation-module, transform)

**Analog:** `packages/react/src/animation/gaze.ts` (531 lines, read in full)

**Module shape / hook wrapper** (lines 508-531):
```typescript
export function useGaze(): {
  step(
    adapter: AvatarFormatAdapter,
    camera: THREE.Camera | null | undefined,
    chatStatus: ChatStatus,
    delta: number,
  ): void;
} {
  const state = useRef(createGazeState());
  function step(adapter, camera, chatStatus, delta): void {
    stepGaze(state.current, adapter, camera, chatStatus, delta);
  }
  return { step };
}
```
Copy this `create<Thing>State()` + pure `step<Thing>(state, adapter, ...)` + thin `use<Thing>()` hook shape exactly for `eyeGaze.ts`. Module-scoped `THREE.Quaternion`/`Vector3` scratch objects declared once at module load (lines 156-169) — never `new` inside the per-frame path.

**Primary path (D-04, `vrm.lookAt`) — NOT modeled in `gaze.ts` (which deliberately avoids `vrm.lookAt`)**. Per RESEARCH.md Pattern 3, this is new code:
```typescript
// Illustrative pattern (RESEARCH.md Pattern 3, no direct source in repo):
if (vrm.lookAt) {
  vrm.lookAt.autoUpdate = false; // this module owns the target, not three-vrm's own auto-track
  vrm.lookAt.pitch = computedPitchDegrees; // base target + saccade offset SUMMED before one write (Pitfall 3)
  vrm.lookAt.yaw = computedYawDegrees;
  // vrm.lookAt.update(delta) is called later, inside currentVrm.update(delta) — VRMAvatar.tsx
}
```
Set `vrm.lookAt.target`/`.yaw`/`.pitch` during `controller.update()` (this module's step), never write eye bones directly while `autoUpdate` is true — `VRMCore.update()`'s fixed order (`humanoid.update() -> lookAt.update(delta) -> expressionManager.update()`) will overwrite any direct bone write moments later in the same frame.

**Bone-fallback path (D-04 fallback) — copy `gaze.ts`'s additive-clamped-quaternion idiom verbatim, retargeted to `leftEye`/`rightEye`** (lines 306-500, esp. the clamp idiom at 411-422 and the additive write at 495-500):
```typescript
// PERF-01 bounded-delta clamp idiom — reused verbatim for eye bones:
const targetAngle = _scratchCurrent.angleTo(_scratchLocalTarget);
if (targetAngle > MAX_GAZE_ANGLE_RAD && targetAngle > 0) {
  const t = MAX_GAZE_ANGLE_RAD / targetAngle;
  _scratchClampedTarget.copy(_scratchCurrent).slerp(_scratchLocalTarget, t);
} else {
  _scratchClampedTarget.copy(_scratchLocalTarget);
}
// ...
// Additive write (PERF-01): multiply(), never set()/lookAt().
head.quaternion.multiply(_scratchDelta);
```
Note: this requires extending `AvatarFormatAdapter.getHumanoidBoneNode`'s role union first (see `types.ts` below — Pitfall 4).

**Smoothing pattern** (lines 233-242, 445-459): exponential frame-rate-independent smoothing (`1 - Math.exp(-delta / TIME_CONSTANT)`) applied to a **persisted** `state.smoothedTarget`, not a one-shot ramp. Reuse this exact idiom for saccade/gaze-target easing.

**Defensive gate pattern** (line 313-314): `const head = adapter.getHumanoidBoneNode("head"); if (!head) return;` — early-return without throwing when the bone can't be resolved. Apply identically for `leftEye`/`rightEye`.

---

### `packages/react/src/animation/viseme.ts` (animation-module, transform + event-driven)

**Analogs:** `packages/react/src/animation/gesture.ts` (trigger/consume shape) + `packages/react/src/hooks/useAudioLipSync.ts` (existing viseme→mouth-shape value conventions, to be improved not replaced per D-08)

**Existing wire type to reuse (Pitfall 6) — do not invent a parallel type:**
```typescript
// packages/core/src/types/audio.ts (full file, 38 lines)
export interface MouthState {
  aa: number; ih: number; ou: number; ee: number; oh: number;
}
export interface PhonemeData {
  phoneme: 'aa' | 'ih' | 'ou' | 'ee' | 'oh' | 'sil';
  intensity: number; // 0-1
  timestamp: number;
  duration?: number;
}
```
Extend `PhonemeData` with optional `source?: "timing" | "audio-analysis"` and `wordBoundary?: boolean` rather than a new `VisemeEvent`/`VisemeData` type.

**Existing fallback-path mouth-shape mapping to build coarticulation smoothing on top of** (`packages/react/src/hooks/useAudioLipSync.ts` lines 527-560, near-identical copy in `useRealtime.ts` lines 860+):
```typescript
function phonemeToMouthState(phoneme: PhonemeData, intensityMultiplier: number = 1.0): MouthState {
  const state: MouthState = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  if (phoneme.phoneme !== "sil" && phoneme.intensity > 0.01) {
    let boostedIntensity = phoneme.intensity * intensityMultiplier;
    const phonemeBoosts = { aa: 2.2, ih: 1.8, ou: 2.0, ee: 1.7, oh: 1.9 };
    boostedIntensity *= phonemeBoosts[phoneme.phoneme] || 1.0;
    // ... exponential curve + per-phoneme minimum-movement floor
  }
  return state;
}
```
D-06's coarticulation smoothing is a weighted lookahead blend layered on TOP of this existing 5-target `MouthState` space — do not remap to a larger viseme vocabulary (Assumption A1).

**Trigger/consume + additive-bone shape to copy for jaw-bone motion (D-07)** — `gesture.ts`'s full pulse/envelope/additive-write pattern (lines 89-156):
```typescript
const envelope = Math.sin(progress * Math.PI); // rise-then-fall envelope, reused for jaw open/close curve
// ...
head.quaternion.multiply(_scratchGesture); // additive write — retarget to jaw bone
```

**Test analog:** `packages/react/src/animation/gesture.test.ts` (372 lines) — stub-adapter, no-React, pure-function test pattern.

---

### `packages/react/src/animation/emotion.ts` (animation-module, event-driven + transform)

**Analogs:** `packages/react/src/animation/gesture.ts` (hint consume-once shape) + `packages/react/src/animation/expressionDrift.ts` (expression-write/ownership-guard shape, D-15 base layer) + `packages/react/src/animation/crossfade.ts` (`easeInOutCubic`, D-14)

**Hint consume-once pattern** (`gesture.ts` `GestureStepParams`, lines 77-87, and consume logic lines 113-124):
```typescript
export interface GestureStepParams {
  adapter: AvatarFormatAdapter;
  chatStatus: ChatStatus;
  gestureHint: GestureHint;
  currentAction: THREE.AnimationAction | null;
  delta: number;
  onConsume: () => void; // called exactly once, the frame the hint is consumed
}
// ...
if (state.activeGesture === null && (gestureHint === "nod" || gestureHint === "shake")) {
  if (shouldStart) {
    state.activeGesture = gestureHint;
    state.elapsed = 0;
    onConsume();
  }
}
```
Mirror this exactly for `emotionHint: {emotion, intensity} | null` and `onConsume` wired to `onEmotionConsumed`.

**Ownership-guard / non-clobber pattern for the base-drift-layer interaction (D-15)** — `expressionDrift.ts` lines 296-323:
```typescript
for (const name of DRIFT_CANDIDATES) {
  if (activeCount >= MAX_ACTIVE_CANDIDATES) break;
  if (em.getExpression(name) === null) continue;
  const current = em.getValue(name);
  const lastWritten = state.lastWritten[name];
  const currentDiffersFromLastWritten =
    lastWritten === undefined || Math.abs(current! - lastWritten) > EPSILON;
  if (current !== null && Math.abs(current) > EPSILON && currentDiffersFromLastWritten) {
    continue; // Relinquish: do not write, do not update lastWritten.
  }
  // ... em.setValue(name, weight); state.lastWritten[name] = weight;
}
```
`emotion.ts`'s crossfade must know when it "owns" an expression slot versus when `expressionDrift.ts` is still writing it — the emotion step runs as a NEW composition step after `expressionDrift.step()` (step 9 today) and must overwrite/blend on top when active, then yield back to drift when the emotion transition completes.

**Crossfade easing to reuse verbatim (D-14):**
```typescript
// packages/react/src/animation/crossfade.ts, lines 25-27
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
```

**VRM standard expression preset mapping (D-13):** confirm the 6 core emotions against `expressionDrift.ts`'s documented VRoid-normalization caveats (file header, lines 10-22) — `happy`/`relaxed` are confirmed present on both bundled test VRMs after `v0v1PresetNameMap` normalization; `surprised`/`browInnerUp` are NOT present on either bundled model. `emotion.ts` must degrade gracefully (skip absent presets) exactly like `expressionDrift.ts`'s `em.getExpression(name) !== null` presence check (line 298).

**Test analogs:** `packages/react/src/animation/expressionDrift.test.ts` (180 lines) + `gesture.test.ts` (372 lines).

---

### `packages/react/src/animation/AnimationStateEngine.ts` (modified)

**Analog:** itself — existing steps 10-11 (gaze + gesture), lines 1286-1314

**Imports to extend** (lines 408-428):
```typescript
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ChatStatus } from "@khaveeai/core";
import { /* ... */ } from "...";
import { useBlink } from "./blink";
import { useBreathing } from "./breathing";
import { useSway } from "./sway";
import { useExpressionDrift } from "./expressionDrift";
import { useTalkCycle } from "./talkCycle";
import { useGaze } from "./gaze";
import { useGesture, type GestureHint } from "./gesture";
// NEW: import { useEyeGaze } from "./eyeGaze";
// NEW: import { useEmotion, type EmotionHint } from "./emotion";
import { volumeToAmplitudeScale } from "./audioAmplitude";
import type { AvatarFormatAdapter } from "./types";
```

**`useAnimationController` params shape to extend** (lines 825-863) — follow the exact JSDoc-per-field style already used for `gestureHint`/`onGestureConsumed`:
```typescript
gestureHint?: GestureHint;
onGestureConsumed?: () => void;
// NEW, mirroring the above exactly:
// emotionHint?: EmotionHint;
// onEmotionConsumed?: () => void;
```

**Composition order extension point** (lines 1286-1314, steps 10-11 today — eyeGaze becomes step 12, emotion becomes step 13):
```typescript
// 10. Gaze (GAZE-01/02) ...
if (camera) gaze.step(adapter, camera, chatStatus, delta);

// 11. Gesture (GEST-01/02) ...
gesture.step({
  adapter, chatStatus, gestureHint: gestureHint ?? null,
  currentAction: currentActionRef.current, delta,
  onConsume: () => onGestureConsumed?.(),
});

// NEW — 12. eyeGaze.step() — see eyeGaze.ts Pattern Assignment above.
// NEW — 13. emotion.step({ adapter, emotionHint: emotionHint ?? null, delta,
//   onConsume: () => onEmotionConsumed?.() }) — see emotion.ts Pattern Assignment above.
```
Add a numbered inline comment block for each new step, matching the existing documentation density (each existing step has a 3-8 line comment explaining composition order rationale — see step 10/11's comments for the exact tone/format to match).

---

### `packages/react/src/animation/types.ts` (modified)

**Analog:** itself, lines 71-73 — extend the role union.

**Current:**
```typescript
getHumanoidBoneNode(
  role: "hips" | "spine" | "chest" | "upperChest" | "neck" | "head",
): THREE.Object3D | null;
```
**Extend to:** add `"leftEye" | "rightEye"` (Pitfall 4). GLB adapter implementations of this new role should return `null` (no established eye-bone-name convention on `happy.glb`) — making eye gaze VRM-only by construction, consistent with the pattern's own doc-comment convention: "Callers must null-check the return value, not branch on avatar format" (lines 80-83).

---

### `packages/react/src/animation/blink.ts` (modified, D-02)

**Analog:** itself, full file (78 lines) — signature to extend, minimal-diff per RESEARCH Open Question 2's recommendation:
```typescript
export function useBlink(): {
  step(adapter: AvatarFormatAdapter, enabled: boolean): void;
} {
  // ...
  function step(adapter: AvatarFormatAdapter, enabled: boolean): void {
    if (!enabled) return;
    // ...
    if (time > nextBlinkTime.current && !isBlinking.current) {
      isBlinking.current = true;
      blinkAnimationRef.current = 0;
      nextBlinkTime.current = time + 100 + Math.random() * 4000;
    }
    // ...
  }
  return { step };
}
```
Add an optional `forceBlink?: boolean` third parameter to `step()`, mirroring how `gesture.ts` accepts an external `gestureHint` into an otherwise-internal step function — when `forceBlink` is true, force-enter the `isBlinking.current = true` branch immediately regardless of `nextBlinkTime`. This is a signature change to a file CONTEXT.md's canonical refs did not flag as needing modification — call this out explicitly in planning (RESEARCH Pitfall 5).

---

### `packages/core/src/tools/emotion.ts` (new, D-09/D-11)

**Analog (shape precedent):** `packages/core/src/tools/gesture.ts`, full file (26 lines):
```typescript
export const toolGesture = {
  name: "set_gesture",
  description: "Call this as part of your normal response to signal a head gesture...",
  parameters: {
    gesture: {
      type: "string" as const,
      enum: ["nod", "shake", "none"],
      required: true,
      description: "...",
    },
  },
};
```
Note the FLAT `RealtimeTool["parameters"]` shape (map of param-name -> schema), NOT the nested JSON-Schema envelope `toolAnimate` uses (`packages/core/src/tools/animate.ts` — the OLDER, inconsistent shape: `{ type: "object", properties: {...}, required: [...] }`). Follow `toolGesture`'s flat shape, not `toolAnimate`'s.

**Gap vs. the analog — D-11/"zero-config" requires a factory, not a bare object** (RESEARCH Open Question 3): `toolGesture` has NO `execute` attached; `KhaveeProvider.tsx`'s own JSDoc example shows app code manually wiring `execute: async ({gesture}) => { setGestureHint(gesture); return 'done'; }`. `createEmotionTool()` should instead be:
```typescript
// Recommended shape (RESEARCH.md Open Question 3 recommendation):
export function createEmotionTool(
  setEmotionHint: (emotion: string, intensity: number) => void,
): { tool: RealtimeTool; systemPromptAddition: string } {
  return {
    tool: {
      name: "set_emotion",
      description: "...",
      parameters: { /* flat shape, per toolGesture precedent */ },
      execute: async ({ emotion, intensity }) => {
        setEmotionHint(emotion, intensity);
        return { success: true, message: "emotion set" };
      },
    },
    systemPromptAddition: "...",
  };
}
```

**Dispatch contract to satisfy** — `packages/core/src/types/tools.ts`, full file (107 lines): `Tool`/`ExecutableTool`/`ToolExecutor` (the single, already-consolidated dispatcher — CORE-05, no per-provider duplication). `ToolExecutor.execute()` catch-and-normalize pattern (lines 90-98):
```typescript
try {
  return await fn(args);
} catch (error) {
  console.error(`Error executing function '${name}':`, error);
  return {
    success: false,
    message: `Error executing function: ${error instanceof Error ? error.message : 'Unknown error'}`
  };
}
```

**Barrel export precedent** — `packages/core/src/index.ts`, lines 4-5:
```typescript
export { toolGesture } from './tools/gesture';
export { toolAnimate } from './tools/animate';
// NEW: export { createEmotionTool } from './tools/emotion';
```

**Tool-call execution loop it must integrate with (Pitfall 2)** — `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts`, lines 494-513:
```typescript
let round = 0;
let result: LLMCompletionResult;
while (true) {
  result = await this.llm.complete({
    messages: this.messages,
    tools: this.pipelineToolList,
    signal,
  });
  if (signal?.aborted) return;
  if (result.toolCalls.length === 0) break; // final text reply (D-04 terminal condition)
  round++;
  if (round > MAX_TOOL_ROUNDS) {
    throw new Error(`Tool-calling loop exceeded ${MAX_TOOL_ROUNDS} rounds`);
  }
  // ... assistant_tool_calls history marker, then execute + tool_result marker
}
```
`OpenAISTTTTSProvider` has NO equivalent loop — `set_emotion`/`set_gesture` silently no-op there (verified: `runTurnFromText()` never passes `tools` to `ChatClient.complete()`). Plan/demo the emotion tool against `GenericPipelineProvider` or `OpenAIRealtimeProvider` only, per RESEARCH Assumption A2.

---

### `packages/react/src/KhaveeProvider.tsx` (modified, D-09/D-11/D-16)

**Analog:** itself — existing `gestureHint`/`setGestureHint` field pair, full pattern.

**Context type field pair** (lines 26-30):
```typescript
gestureHint: "nod" | "shake" | null;
setGestureHint: (gesture: string | null) => void;
// NEW, mirroring exactly:
// emotionHint: { emotion: string; intensity: number } | null;
// setEmotionHint: (emotion: string, intensity: number) => void;
```

**Allow-list validated setter, never-throws convention (Security Domain — mirrors T-12-04)** (lines 306-312):
```typescript
const setGestureHint = useCallback((gesture: string | null) => {
  if (gesture === 'nod' || gesture === 'shake') {
    setGestureHintState(gesture);
  } else {
    setGestureHintState(null);
  }
}, []);
```
`setEmotionHint` must apply the identical discipline: validate `emotion` against the D-13 6-value allow-list (`happy`/`sad`/`angry`/`surprised`/`neutral`/`thinking`), clamp `intensity` via `Math.max(0, Math.min(1, value))` (copy `setExpression`'s clamp at lines 162-165), and never pass the raw LLM argument to `VRMExpressionManager.setValue()` unvalidated.

**State declaration + provider value wiring** (lines 104, 314-336): add `useState` for `emotionHint`, add to the `KhaveeContext.Provider value={{ ... }}` object, alongside the existing `gestureHint, setGestureHint,` pair.

---

### `packages/react/src/VRMAvatar.tsx` (modified)

**Analog:** itself — existing `gestureHint`/`onGestureConsumed` threading.

**Context destructure + controller wiring** (lines 426-427, 697-709):
```typescript
const { setVrm, expressions, currentAnimation, animate, chatStatus, currentVolume, gestureHint, setGestureHint } =
  useKhavee();
// NEW: also destructure emotionHint, setEmotionHint

const controller = useAnimationController({
  adapter: vrmAdapter,
  chatStatus,
  currentAnimation,
  availableNames: processedClips.map((c) => c.name),
  getAction,
  getRoot,
  enableBlinking,
  currentVolume,
  camera,
  gestureHint,
  onGestureConsumed: () => setGestureHint(null),
  // NEW: emotionHint, onEmotionConsumed: () => setEmotionHint(null, 0)
});
```

**Adapter shape to extend for eye-bone fallback** (lines 675-680):
```typescript
const vrmAdapter: AvatarFormatAdapter = {
  getMixer: () => mixerRef.current!,
  getBoneNode: (name) => scene?.getObjectByName(name) ?? null,
  getHumanoidBoneNode: (role) => currentVrm?.humanoid?.getNormalizedBoneNode(role) ?? null,
  getExpressionManager: () => currentVrm?.expressionManager ?? null,
};
```
No change needed here beyond `types.ts`'s role union extension — `getNormalizedBoneNode("leftEye"|"rightEye")` already works once the type allows it (three-vrm's humanoid API already supports these role names).

**Frame-ordering contract (critical for D-04's primary lookAt path)** (lines 726-748):
```typescript
useFrame((_, delta) => {
  if (!currentVrm?.expressionManager) return;
  if (mixerRef.current) mixerRef.current.update(delta);
  Object.entries(expressions).forEach(([name, value]) => {
    if (typeof value === "number") lerpExpression(name, value, delta * 8);
  });
  // Crossfade ramp + blink step ... Frame-ordering contract:
  // mixer.update -> controller.update -> vrm.update.
  controller.update(delta);
  // Update VRM after all changes (expressions + animations + blinking + gestures)
  currentVrm.update(delta);
});
```
`eyeGaze.ts`'s primary path MUST set `vrm.lookAt.yaw`/`.pitch` inside `controller.update(delta)` (i.e. before this `currentVrm.update(delta)` call) so three-vrm's own `lookAt.update()` (invoked inside `currentVrm.update`) applies the combined target that same frame.

**Camera read (component scope, not inside useFrame)** (lines 428-433):
```typescript
const camera = useThree((state) => state.camera);
```
Reuse this exact pattern — already threaded through to `useAnimationController({ camera, ... })`, no new plumbing needed for eyeGaze's camera dependency.

---

### `packages/react/src/hooks/useAudioLipSync.ts` / `useRealtime.ts` (modified, D-08 deprecation + D-05 fallback improvement)

**Analog:** these two files ARE each other's analog — near-duplicate `RealtimeAudioAnalyzer`/`phonemeToMouthState` implementations already exist (verified via grep: identical function signatures at `useAudioLipSync.ts:527` and `useRealtime.ts:860`). Any D-05 fallback-path improvement should be made once and kept in sync between both, or (better) factored into a shared helper consumed by both — flag this consolidation opportunity to the planner rather than editing two divergent copies.

**Deprecation marker convention** — no existing `@deprecated` JSDoc tag found anywhere in the codebase (first use of this pattern this phase). Standard TSDoc `@deprecated` tag on the exported `useAudioLipSync` function, per CLAUDE.md's Comments convention (JSDoc density correlates with "how recently/carefully the code was written" — this is a deliberate, careful annotation, so give it full JSDoc).

---

### `packages/core/src/types/pipeline.ts` / `packages/core/src/types/audio.ts` (possibly modified, D-05 interface-only)

**Analog:** itself — `TTSProvider.speak()`'s existing opts shape, lines 201-211:
```typescript
speak(
  text: string,
  opts: {
    audioContext: AudioContext;
    onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;
    voice?: string;
    speed?: number;
    signal?: AbortSignal;
  }
): Promise<void>;
```
Add an optional field here (e.g. `onWordBoundary?: (data: PhonemeData) => void`) following the existing optional-callback-field convention (`onAudioData` is the direct precedent) — vendor-neutral, no OpenAI-specific field names (per CLAUDE.md's Vendor neutrality constraint and this file's own header note on avoiding vendor-specific wire names).

## Shared Patterns

### Hook + Pure-Function + Scratch-Object Module Shape
**Source:** `packages/react/src/animation/gaze.ts`, `gesture.ts`, `blink.ts`, `expressionDrift.ts` (all four read in full)
**Apply to:** `eyeGaze.ts`, `viseme.ts`, `emotion.ts` (every new animation module this phase)
```typescript
const _scratchThing = new THREE.Quaternion(); // module-scoped, reused every step
export interface ThingState { /* plain mutable object */ }
export function createThingState(): ThingState { /* ... */ }
export function stepThing(state: ThingState, params: ThingStepParams): void { /* pure, testable */ }
export function useThing(): { step(params: ThingStepParams): void } {
  const stateRef = useRef<ThingState>(createThingState());
  return { step: (params) => stepThing(stateRef.current, params) };
}
```

### Additive Bone Composition (PERF-01)
**Source:** `gaze.ts` line 500, `gesture.ts` line 150
**Apply to:** any new module writing bone quaternions (eyeGaze's bone-fallback path, viseme's jaw-bone motion)
```typescript
head.quaternion.multiply(_scratchDelta); // multiply(), never .set() — preserves other systems' writes this frame
```

### Angle-Clamped Delta (PERF-01 idiom)
**Source:** `gaze.ts` lines 411-422 (and `AnimationStateEngine.ts`'s spine clamp)
**Apply to:** eyeGaze's bone-fallback path
```typescript
const targetAngle = _scratchCurrent.angleTo(_scratchLocalTarget);
if (targetAngle > MAX_ANGLE_RAD && targetAngle > 0) {
  const t = MAX_ANGLE_RAD / targetAngle;
  _scratchClampedTarget.copy(_scratchCurrent).slerp(_scratchLocalTarget, t);
} else {
  _scratchClampedTarget.copy(_scratchLocalTarget);
}
```

### React-Context Hint Bridge for LLM Tool Output
**Source:** `packages/react/src/KhaveeProvider.tsx` lines 26-30, 306-312
**Apply to:** `emotionHint`/`setEmotionHint` (D-09/D-11) — identical shape to `gestureHint`/`setGestureHint`, with an allow-list validated, never-throwing setter.

### Crossfade Easing
**Source:** `packages/react/src/animation/crossfade.ts` lines 25-27 (`easeInOutCubic`)
**Apply to:** `emotion.ts`'s expression transition timer (D-14)

### Defensive Early-Return (never throw for "not fatal" conditions)
**Source:** `gaze.ts` line 313-314, `blink.ts` line 44, `expressionDrift.ts` line 274
**Apply to:** every new animation module — `if (!head) return;` / `if (!em) return;` style gates, no exceptions thrown from per-frame code.

### Tool Dispatch (no per-provider duplication)
**Source:** `packages/core/src/types/tools.ts` (`ToolExecutor`, full file)
**Apply to:** `createEmotionTool()`'s registered tool — dispatched through the SAME shared `ToolExecutor`, never a new emotion-specific executor.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/core/src/tools/__tests__/emotion.test.ts` | test | request-response | `packages/core/src/tools/__tests__/` directory exists but is empty — no sibling tool test file to copy structure from. Planner should base structure on `packages/react/src/animation/gesture.test.ts`'s pure-function/no-React test style, adapted for a plain-object tool + factory function instead of a `step()` animation function. |
| `packages/react/src/animation/blink.test.ts` | test | transform | Confirmed via directory listing: no `blink.test.ts` exists today despite `blink.ts` being a shipped module — this is a pre-existing test gap (RESEARCH Wave 0 Gaps), not specific to this phase's new code. Use `gesture.test.ts`'s triggered-behavior test shape (stub adapter, force a trigger, assert the envelope/state machine) as the structural analog. |
| D-05 primary viseme path (TTS provider timestamps) | — | event-driven | No TTS vendor integrated in this repo (`TTSPlayer.ts`, `OpenAITTSAdapter.ts`) emits word/phoneme timing data — confirmed via source read + external web search (RESEARCH Pitfall 1). Scope as an interface-only addition (`packages/core/src/types/pipeline.ts`/`audio.ts`) with a hand-constructed `PhonemeData[]` test fixture standing in for a real vendor response; do not attempt to "wire" a real vendor's timestamps this phase. |

## Metadata

**Analog search scope:** `packages/react/src/animation/*.ts` (all 9 modules + 8 test files), `packages/core/src/tools/*.ts`, `packages/core/src/types/{tools,realtime,pipeline,audio}.ts`, `packages/react/src/KhaveeProvider.tsx`, `packages/react/src/VRMAvatar.tsx`, `packages/react/src/hooks/{useAudioLipSync,useRealtime}.ts`, `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts`
**Files scanned:** 20 read directly (full or targeted sections), all via direct source reads (no inference)
**Pattern extraction date:** 2026-09-18
