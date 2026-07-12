# Phase 10: Shared Animation Architecture & Crossfade Engine - Pattern Map

**Mapped:** 2026-07-12
**Files analyzed:** 6 (4 new, 2 modified)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `packages/react/src/animation/types.ts` | config (type module) | transform | `packages/react/src/types/animation.ts` | exact (same package, same role) |
| `packages/react/src/animation/crossfade.ts` | utility (procedural engine) | event-driven (per-frame) | `wayfinder/5-crossfade-prototype` commit `6d0b9d7`, `src/app/glb/page.tsx` (git-only, not on `main`) | exact (D-02 mandated port) |
| `packages/react/src/animation/blink.ts` | utility (procedural delta layer) | event-driven (per-frame) | `packages/react/src/VRMAvatar.tsx` lines 308-317, 516-553 | exact (verbatim migration source, D-01) |
| `packages/react/src/animation/AnimationStateEngine.ts` | service (orchestrator) | event-driven (chatStatus → clip transition) | `packages/react/src/GLBAvatar.tsx` lines 138-224 (pattern to replace) + prototype `BlendState` orchestration | role-match (anti-pattern being replaced, not a positive analog) |
| `packages/react/src/VRMAvatar.tsx` | component | request-response (R3F render/useFrame lifecycle) | itself (existing file, modified in place) + `packages/react/src/GLBAvatar.tsx` (sibling component for adapter-consistency check) | exact (self) |
| `packages/react/src/GLBAvatar.tsx` | component | request-response (R3F render/useFrame lifecycle) | `packages/react/src/VRMAvatar.tsx` (sibling component, same role — use as reference for post-migration `useFrame` ordering) | role-match |

## Pattern Assignments

### `packages/react/src/animation/types.ts` (config, transform)

**Analog:** `packages/react/src/types/animation.ts` (existing sibling type module) + `packages/core/src/types/realtime.ts` (project-wide interface-naming convention)

**File-header + JSDoc convention** (from `packages/react/src/types/animation.ts:1-26`):
```typescript
/**
 * Type definitions for the VRM Animation System
 *
 * Import these types when using TypeScript for better type safety
 */

import * as THREE from "three";

/**
 * Animation Registry
 *
 * A map of animation names to THREE.AnimationClip objects.
 * ...
 */
export interface AnimationRegistry {
  [name: string]: THREE.AnimationClip;
}
```

**Interface-naming convention** (no `I` prefix, PascalCase — `packages/core/src/types/realtime.ts` and CLAUDE.md "Naming Patterns"): name the new adapter type `AvatarFormatAdapter`, not `IAvatarFormatAdapter`.

**Concrete shape to define** (method names verbatim from wayfinder ticket #8, reproduced in RESEARCH.md Pattern 1):
```typescript
export interface AvatarFormatAdapter {
  getMixer(): THREE.AnimationMixer;
  getBoneNode(name: string): THREE.Object3D | null;
  getExpressionManager(): VRMExpressionManager | null; // null for GLB — null-check, not a capability flag
}
```

**Nullable-return precedent already in codebase** (`packages/react/src/VRMAvatar.tsx:46-49`):
```typescript
interface VRMParseResult {
  scene: THREE.Group;
  userData: { vrm?: VRM; [key: string]: any };
}
```
Matches the `getExpressionManager(): ... | null` shape — optional/nullable VRM-specific fields are an established pattern in this file already.

---

### `packages/react/src/animation/crossfade.ts` (utility, event-driven per-frame)

**Analog:** Prototype branch `wayfinder/5-crossfade-prototype`, commit `6d0b9d7`, `src/app/glb/page.tsx` (not on `main` — read via `git show`, reproduced in full in RESEARCH.md "Pattern 2"). Per D-02, this is a direct port, not a reimplementation.

**File-header convention to apply** (matching `packages/providers/openai-stt-tts/src/AudioRecorder.ts:1-18` and `STTClient.ts:1-16` — internal-helper header block explaining role + non-obvious pitfalls):
```typescript
/**
 * crossfade.ts — Pose-gap-adaptive eased crossfade engine (XFADE-01).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Ported from local prototype branch wayfinder/5-crossfade-prototype,
 * commit 6d0b9d7 ("Variant C" — the ticket #5 decision). Do not
 * reimplement from notes; this is the validated reference.
 */
```

**Core pattern — easing + max-not-average pose-gap + duration mapping** (verbatim source, RESEARCH.md Pattern 2, from `git show wayfinder/5-crossfade-prototype:src/app/glb/page.tsx`):
```typescript
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Max angular distance (radians) between the live pose and a clip's first-frame
 * pose, across every bone the clip animates. Max, not average — a single
 * dramatically-different limb is what causes visible crossfade "popping." */
function computePoseGapAngle(scene: THREE.Object3D, toClip: THREE.AnimationClip): number {
  const qLive = new THREE.Quaternion();
  const qTarget = new THREE.Quaternion();
  let max = 0;
  for (const track of toClip.tracks) {
    if (!track.name.endsWith(".quaternion")) continue;
    const boneName = track.name.replace(".quaternion", "");
    const bone = scene.getObjectByName(boneName);
    if (!bone) continue;
    qLive.copy(bone.quaternion);
    qTarget.set(track.values[0], track.values[1], track.values[2], track.values[3]);
    const a = qLive.angleTo(qTarget);
    if (a > max) max = a;
  }
  return max;
}

function poseGapToDuration(maxAngleRad: number): number {
  const minDuration = 0.3;
  const maxDuration = 0.9;
  const maxExpectedAngle = Math.PI / 2;
  const t = THREE.MathUtils.clamp(maxAngleRad / maxExpectedAngle, 0, 1);
  return THREE.MathUtils.lerp(minDuration, maxDuration, t);
}
```

**Per-frame blend-state ramp** (verbatim, same source — the "core pattern" this file's primary export drives):
```typescript
type BlendState = {
  active: boolean;
  from: THREE.AnimationAction | null;
  to: THREE.AnimationAction | null;
  startTime: number;
  duration: number;
};

// On chatStatus/base-clip change:
toAction.reset();
toAction.enabled = true;        // required: mixer won't evaluate a disabled action
toAction.setEffectiveWeight(0); // start at 0 before the ramp begins
toAction.play();                // required even at weight 0

// Every frame (useFrame):
const blend = blendRef.current;
if (blend.active && blend.to) {
  const elapsed = (performance.now() - blend.startTime) / 1000;
  const t = Math.min(elapsed / blend.duration, 1);
  const eased = easeInOutCubic(t);
  blend.from?.setEffectiveWeight(1 - eased);
  blend.to.setEffectiveWeight(eased);
  if (t >= 1) {
    blend.from?.stop();
    blend.active = false;
  }
}
```

**Error handling:** No `try/catch` needed — `getObjectByName` returning `undefined`/`null` is handled inline (`if (!bone) continue;`), matching the codebase's existing defensive-guard-over-throw convention (CLAUDE.md "Error Handling": "Defensive guards return early instead of throwing for 'should never happen but is not fatal' conditions").

**Pitfall to encode as a comment** (RESEARCH.md Pitfall 4): document why `.enabled = true` and `.play()` must precede `setEffectiveWeight(0)` — three.js's `AnimationMixer` only evaluates actions that are both `enabled` and in the "playing" set.

---

### `packages/react/src/animation/blink.ts` (utility, event-driven per-frame)

**Analog:** `packages/react/src/VRMAvatar.tsx` lines 308-317 (ref declarations) and 516-553 (per-frame logic) — this is a verbatim migration, not a new pattern (D-01).

**Refs to migrate** (`VRMAvatar.tsx:308-317`, preserve the inline "why refs not state" comment):
```typescript
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
```

**Core per-frame logic to migrate** (`VRMAvatar.tsx:516-553`), rewritten to read/write through `adapter.getExpressionManager()` instead of `currentVrm.expressionManager` directly, and gated on non-null adapter return instead of `if (enableBlinking)`:
```typescript
const time = Date.now();
if (time > nextBlinkTime.current && !isBlinking.current) {
  isBlinking.current = true;
  blinkAnimationRef.current = 0;
  nextBlinkTime.current = time + 100 + Math.random() * 4000; // Next blink in 0-4 seconds
}
if (isBlinking.current) {
  blinkAnimationRef.current += 0.15;
  if (blinkAnimationRef.current >= 1) {
    isBlinking.current = false;
    blinkState.current = 0;
  } else {
    blinkState.current = Math.sin(blinkAnimationRef.current * Math.PI);
  }
}
const expressionManager = adapter.getExpressionManager();
if (expressionManager) {
  if (
    expressionManager.blinkExpressionNames.includes("blinkLeft") &&
    expressionManager.blinkExpressionNames.includes("blinkRight")
  ) {
    expressionManager.setValue("blinkLeft", blinkState.current);
    expressionManager.setValue("blinkRight", blinkState.current);
  }
}
```

**Critical constraint (preserve exactly):** Keep `useRef`, never convert to `useState` — RESEARCH.md Anti-Patterns explicitly flags this as the regression risk this migration must not introduce.

---

### `packages/react/src/animation/AnimationStateEngine.ts` (service, event-driven)

**Analog (anti-pattern to replace, not a positive template):** `packages/react/src/GLBAvatar.tsx` lines 138-224 — the state-switching + `setTimeout` loop-back this new module directly replaces. Use this to understand *what* state the engine must now own (chatStatus → clip name lookup, current-action tracking), while replacing *how* it's done (no timers, no `fadeIn`/`fadeOut`).

**Anti-pattern being removed** (`GLBAvatar.tsx:165-203`, `setTimeout`-driven loop-back — do not reproduce):
```typescript
// Talking animation system
useEffect(() => {
  if (!names || names.length === 0) return;
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
      animationTimeout.current = setTimeout(() => {
        animationTimeout.current = null;
        if (chatStatus === 'speaking') {
          contextAnimate(names[0]);
        }
      }, 3000 + Math.random() * 2000);
    }
  } else if (chatStatus !== 'speaking' && animationTimeout.current) {
    clearTimeout(animationTimeout.current);
    animationTimeout.current = null;
    if (names[0]) {
      contextAnimate(names[0]);
    }
  }
}, [chatStatus, names, currentAnimation, contextAnimate]);
```
**Do not port this.** RESEARCH.md's "Common Pitfalls" and "State of the Art" both flag this `setTimeout` mechanism as the canonical example the new architecture eliminates — the verification checklist (wayfinder ticket #14) explicitly checks for "no live-clock interrupts."

**chatStatus source-of-truth wiring** (`packages/react/src/KhaveeProvider.tsx:6-25`, context shape the state layer reads from):
```typescript
interface KhaveeContextType {
  // ...
  currentAnimation: string | null;
  animate: (animationName: string) => void;
  stopAnimation: () => void;
  availableAnimations: string[];
  setAvailableAnimations: (animations: string[]) => void;
  realtimeProvider: RealtimeProvider | null;
  chatStatus: import('@khaveeai/core').ChatStatus;
}
```

**ChatStatus union to switch over** (`packages/core/src/types/conversation.ts:17-23`):
```typescript
export type ChatStatus =
  | 'ready'       // Ready to chat
  | 'speaking'    // AI is speaking
  | 'listening'   // Listening to user
  | 'thinking'    // Processing/thinking
  | 'stopped'     // Session stopped
  | 'starting';   // Starting session
```

**Orchestration pattern to build (from the crossfade prototype, not GLBAvatar):** on `chatStatus`/base-clip change, look up the target clip, call `crossfade`'s `computePoseGapAngle`/`poseGapToDuration`, then hand off to the per-frame `setEffectiveWeight` ramp (see `animation/crossfade.ts` excerpt above) — driven entirely by the mixer's own state and `useFrame`, never `setTimeout`/`setInterval`.

**Error handling:** Follow the codebase's defensive-guard convention — `if (!targetClip) return;` style early returns (matching `VRMAvatar.tsx:430` `if (!mixerRef.current || !currentAnimation) { ... return; }`), not thrown exceptions, since a missing clip/adapter method is a recoverable, expected condition during async loading.

---

### `packages/react/src/VRMAvatar.tsx` (component, modify in place)

**Analog:** Self (existing file) — modification target, not a fresh file. Cross-reference `GLBAvatar.tsx`'s adapter wiring (once migrated) for consistency.

**Code to remove — fixed-duration linear crossfade** (`VRMAvatar.tsx:428-467`, replaced by `AnimationStateEngine`/`crossfade.ts`):
```typescript
// Handle animation switching with proper crossfading
useEffect(() => {
  if (!mixerRef.current || !currentAnimation) {
    if (currentActionRef.current) {
      currentActionRef.current.fadeOut(0.3);
      currentActionRef.current = null;
    }
    return;
  }
  const targetClip = processedClips.find((clip) => clip?.name === currentAnimation);
  if (targetClip && mixerRef.current) {
    const newAction = mixerRef.current.clipAction(targetClip);
    if (currentActionRef.current !== newAction) {
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.3);
      }
      newAction.reset().fadeIn(0.3).play();
      currentActionRef.current = newAction;
    } else if (!currentActionRef.current) {
      newAction.reset().play();
      currentActionRef.current = newAction;
    }
  }
}, [currentAnimation, processedClips]);
```

**Code to remove — inline blink block** (`VRMAvatar.tsx:308-317` refs + `516-553` logic) — migrates verbatim into `animation/blink.ts` per D-01 (see that section above for the exact source).

**Adapter wiring to add** (mixer already real, per RESEARCH.md Pattern 1 — `mixerRef` at `VRMAvatar.tsx:304, 391` is the correct mixer, unlike GLBAvatar's dead one):
```typescript
const vrmAdapter: AvatarFormatAdapter = {
  getMixer: () => mixerRef.current!,
  getBoneNode: (name) => scene?.getObjectByName(name) ?? null,
  getExpressionManager: () => currentVrm?.expressionManager ?? null,
};
```

**`useFrame` ordering to preserve** (`VRMAvatar.tsx:501-557` — mixer update, then expressions, then blink, then `vrm.update(delta)` last; RESEARCH.md Pitfall 6 requires this ordering stay structurally obvious for Phase 11's future additive bone-delta insertion point):
```typescript
useFrame((_, delta) => {
  if (!currentVrm?.expressionManager) return;
  if (mixerRef.current) {
    mixerRef.current.update(delta);
  }
  // ...expressions...
  // [this phase: blink via adapter, replacing inline block]
  // [future Phase 11: procedural bone deltas go here]
  currentVrm.update(delta);
});
```

**Stale JSDoc to correct, not "remove nonexistent code" for** (`VRMAvatar.tsx:204-206, 217`) — per RESEARCH.md Pitfall 3, `enableTalkingAnimations` is documented but never destructured from props (only `enableBlinking` is, line 300/118). Update the docstring to match the new module's real automatic chatStatus-driven behavior once implemented, rather than searching for code to delete.

---

### `packages/react/src/GLBAvatar.tsx` (component, modify in place)

**Analog:** `packages/react/src/VRMAvatar.tsx` (sibling component, same role) — use its post-migration adapter/`useFrame` shape as the template for consistency; this file additionally needs its own dead-code removal that `VRMAvatar.tsx` doesn't.

**Code to delete — dead second `AnimationMixer`** (`GLBAvatar.tsx:97, 213-224` — zero registered actions, silently useless):
```typescript
const mixerRef = useRef<THREE.AnimationMixer | null>(null);
// ...
useFrame((_, delta) => {
  if (mixerRef.current) {
    mixerRef.current.update(delta);
  }
});

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
```

**Code to delete — `setTimeout` loop-back anti-pattern** (`GLBAvatar.tsx:100-103, 165-203` — full source reproduced in `AnimationStateEngine.ts` section above).

**Code to delete — linear `fadeIn`/`fadeOut` crossfade** (`GLBAvatar.tsx:138-163`):
```typescript
useEffect(() => {
  if (!actions || !currentAnimation) {
    if (currentActionRef.current) {
      currentActionRef.current.fadeOut(0.3);
      currentActionRef.current = null;
    }
    return;
  }
  const targetAction = actions[currentAnimation];
  if (targetAction && targetAction !== currentActionRef.current) {
    if (currentActionRef.current) {
      currentActionRef.current.fadeOut(0.3);
    }
    targetAction.reset().fadeIn(0.3).play();
    currentActionRef.current = targetAction;
  }
}, [currentAnimation, actions]);
```

**Adapter wiring to add — MUST use drei's real mixer** (RESEARCH.md Pitfall 2, `GLBAvatar.tsx:106-107`):
```typescript
const gltf = useGLTF(src) as any;
const { mixer, actions, names } = useDreiAnimations(gltf.animations, groupRef);
const glbAdapter: AvatarFormatAdapter = {
  getMixer: () => mixer, // NOT a new/local mixerRef — see Pitfall 2
  getBoneNode: (name) => groupRef.current?.getObjectByName(name) ?? null,
  getExpressionManager: () => null,
};
```

**Existing pattern to preserve unchanged (out of scope, ANIM-03):** `useGLTF(src)` loading (`GLBAvatar.tsx:106`) and the `names`/`setAvailableAnimations` effect (`GLBAvatar.tsx:110-115`) are untouched — only the switching/crossfade/mixer code is replaced.

---

## Shared Patterns

### Internal-only module convention (not exported from `index.ts`)
**Source:** `packages/providers/openai-stt-tts/src/index.ts:1-11` (compare `AudioRecorder`/`STTClient`/`ChatClient` internal helpers — note they were *later* additively exported for a different milestone's adapter needs, but originally, and still architecturally, treated as internal) and `packages/react/src/index.ts:1-11` (current public surface).
**Apply to:** All four new files under `packages/react/src/animation/*.ts`.
```typescript
// packages/react/src/index.ts — do NOT add any of these:
// export * from "./animation";
// export { AnimationStateEngine } from "./animation/AnimationStateEngine";
```
The existing `packages/react/src/index.ts` re-exports only `KhaveeProvider`, `useKhavee`, `VRMAvatar`, `GLBAvatar`, VRM-related hooks, and `AnimationConfig`. The new `animation/` module must not appear here — matches ticket #8's explicit "internal, not exported" requirement.

### File-header block comment convention
**Source:** `packages/providers/openai-stt-tts/src/AudioRecorder.ts:1-18`, `STTClient.ts:1-16`
**Apply to:** All new files in `packages/react/src/animation/`.
```typescript
/**
 * <ModuleName> — <one-line role description>.
 *
 * This is an internal helper <class|module> and is NOT exported from index.ts.
 *
 * <non-obvious lifecycle/security/timing notes, with ticket references>
 */
```

### Defensive early-return over throw
**Source:** `packages/react/src/VRMAvatar.tsx:430` (`if (!mixerRef.current || !currentAnimation) { ...; return; }`), `GLBAvatar.tsx:140` (`if (!actions || !currentAnimation) { ...; return; }`)
**Apply to:** All format-adapter method implementations and the state engine's clip-lookup logic — missing mixer/clip/bone is an expected async-loading condition, not an exceptional one. No new `try/catch` is expected per RESEARCH.md's Project Constraints section ("This phase's format-adapter methods are simple synchronous lookups and likely need no new try/catch at all").

### `useRef` (not `useState`) for per-frame-mutated, never-rendered state
**Source:** `packages/react/src/VRMAvatar.tsx:308-317` (blink refs), `mixerRef`/`currentActionRef` throughout both avatar components.
**Apply to:** `animation/blink.ts` refs, `animation/crossfade.ts`'s `BlendState`, and any per-frame bookkeeping in `AnimationStateEngine.ts`. Never convert to `useState` — documented re-render-cost rationale must be preserved as a comment in the new location.

### `useFrame` ordering: mixer → procedural deltas → format `.update()`/render
**Source:** `packages/react/src/VRMAvatar.tsx:501-557`
**Apply to:** Both `VRMAvatar.tsx` and `GLBAvatar.tsx` after migration — the crossfade engine's `setEffectiveWeight` calls and the blink module's expression writes must run inside the same `useFrame` callback, in this order: `mixer.update(delta)` → crossfade ramp step → blink step → `vrm.update(delta)` (VRM only; GLB has no equivalent final step beyond the group render). This ordering is a forward-compatibility requirement for Phase 11's additive bone-delta layer (RESEARCH.md Pitfall 6), not just a Phase 10 preference.

### Naming conventions (CLAUDE.md, cross-checked against `packages/core/src/types/realtime.ts`)
**Apply to:** All new code in `animation/`.
- Interfaces: PascalCase, no `I` prefix — `AvatarFormatAdapter`.
- Functions: camelCase — `computePoseGapAngle`, `poseGapToDuration`, `easeInOutCubic`.
- Boolean-ish refs: `is`/`has`/`enable` prefix, matching existing `isBlinking`.
- If a new class-shaped orchestrator is used, PascalCase matching the export (`AnimationStateEngine`), matching the `STTClient`/`ChatClient`/`AudioRecorder` precedent.

## No Analog Found

None — all 6 files have a strong analog (either exact same-role sibling code, or the explicitly-mandated prototype port per D-02).

**Note on ambiguous scope:** `src/app/glb/page.tsx` (the Next.js demo page the prototype was originally built on) is referenced in CONTEXT.md/RESEARCH.md as the fixture the crossfade prototype validated against, and as a manual-verification surface for D-03's test assets — but it is not explicitly required to change by CONTEXT.md's decisions. If the planner chooses to add a manual-verification page/story exercising the new shared module against `happy.glb`'s real clip names (`'State 1 Idle (loop)'`, `'State 4 Taking (loop)'`, `'State 5 listening (loop)'` — verified exact strings, not the shorthand names used in discussion), treat it as an optional test/demo file with `src/app/glb/page.tsx`'s current (already-reverted) content as its own analog, not a new pattern to source elsewhere.

## Metadata

**Analog search scope:** `packages/react/src`, `packages/providers/openai-stt-tts/src`, `packages/core/src/types`, git branch `wayfinder/5-crossfade-prototype` (commit `6d0b9d7`, read-only via `git show`, never checked out)
**Files scanned:** `VRMAvatar.tsx` (894 lines, read in full across 3 non-overlapping passes), `GLBAvatar.tsx` (232 lines, read in full), `KhaveeProvider.tsx` (targeted ranges: 1-30, 205-244), `types/animation.ts` (143 lines, read in full), `AudioRecorder.ts` (header, lines 1-60), `STTClient.ts` (88 lines, read in full), `index.ts` (react and openai-stt-tts, read in full), `conversation.ts` (35 lines, read in full)
**Pattern extraction date:** 2026-07-12
