# Phase 11: Idle, Transition & Talking States - Pattern Map

**Mapped:** 2026-07-12
**Files analyzed:** 10 (4 new, 6 modified; `crossfade.ts` consulted but requires no source change)
**Analogs found:** 10 / 10 (all files have at least a partial analog; net-new mechanics flagged separately in "No Analog Found")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/react/src/animation/breathing.ts` (NEW) | utility (ref-driven procedural stepper) | transform (per-frame delta → bone quaternion write) | `packages/react/src/animation/blink.ts` | exact (shape) / partial (bone vs. expression target) |
| `packages/react/src/animation/sway.ts` (NEW) | utility (ref-driven procedural stepper) | transform | `packages/react/src/animation/blink.ts` | exact (shape) / partial |
| `packages/react/src/animation/expressionDrift.ts` (NEW) | utility (ref-driven procedural stepper, VRM-only) | transform | `packages/react/src/animation/blink.ts` | exact — same gating mechanism (`getExpressionManager()` null-check), same target system (expression values) |
| `packages/react/src/animation/talkCycle.ts` (NEW) | utility (stateful cycling/state-machine, invoked from controller) | event-driven (loop-boundary detection → triggers `beginCrossfade`) | `AnimationStateEngine.ts`'s `useAnimationController` crossfade-trigger `useEffect` (lines 112-127) | role-match — closest existing "detect a condition, call `beginCrossfade`" pattern, but the condition (loop-boundary) and the extra cycling-index state are net-new |
| `packages/react/src/animation/types.ts` (MODIFIED) | model (interface/contract) | n/a | itself, extended in place — precedent is `getBoneNode`'s existing doc-comment style (lines 35-44) | exact — additive change to an existing, actively-documented interface |
| `packages/react/src/animation/AnimationStateEngine.ts` (MODIFIED) | hook/controller | event-driven (chatStatus/target-clip change → crossfade; per-frame `update(delta)`) | itself, extended in place — `update(delta)` (lines 129-134) and the `beginCrossfade` call site (line 120) | exact — same file, same function, additive steps |
| `packages/react/src/KhaveeProvider.tsx` (MODIFIED) | provider | pub-sub (subscribe to `realtimeProvider.onVolumeChange`, republish via React context) | itself, extended in place — the existing `onChatStatusChange` subscription (lines 107-112) | exact — same file, directly analogous subscription-to-context pattern already present |
| `packages/react/src/VRMAvatar.tsx` (MODIFIED) | component | streaming (per-frame `useFrame`) | itself, extended in place; humanoid bone resolution precedent from `packages/react/src/utils/remapMixamoAnimationToVrm.ts` (lines 25-27) | exact (adapter wiring) / role-match (humanoid bone lookup — new usage of an existing codebase API) |
| `packages/react/src/GLBAvatar.tsx` (MODIFIED) | component | streaming (per-frame `useFrame`) | `VRMAvatar.tsx` (sibling adapter implementation) | exact — same adapter/controller wiring shape, GLB-specific bone-name table is net-new |
| `packages/react/src/animation/crossfade.ts` (NO CHANGE — informational) | utility | transform | n/a — `floorSeconds` param already exists (lines 74, 110-117), just needs a caller in `AnimationStateEngine.ts` | n/a |

## Pattern Assignments

### `packages/react/src/animation/breathing.ts` (NEW — utility, transform)

**Analog:** `packages/react/src/animation/blink.ts` (read in full, 79 lines)

**File header / role comment convention** (blink.ts lines 1-16):
```typescript
/**
 * blink.ts — Ref-driven procedural blink delta (D-01).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Migrated verbatim from `VRMAvatar.tsx` lines 308-317 (refs) and 516-553
 * (per-frame logic) — the timing constants, blink curve, and scheduling are
 * unchanged from the original inline implementation. ...
 */
```
Follow this shape: file-header block comment naming the requirement ID (IDLE-01), stating "internal helper, not exported from index.ts," and explaining any non-obvious timing/lifecycle constraint (e.g. why breathing must run before sway in the fixed composition order — PERF-01).

**Hook shape + ref declarations** (blink.ts lines 26-38):
```typescript
export function useBlink(): {
  step(adapter: AvatarFormatAdapter, enabled: boolean): void;
} {
  // Blinking system. blinkState is a ref, not React state: it's only ever
  // read synchronously within the same useFrame callback that writes it,
  // never rendered in JSX — calling a state setter here would re-render
  // this component on every single animation frame ...
  const blinkState = useRef(0);
  const nextBlinkTime = useRef(Date.now() + 2000 + Math.random() * 3000);
  const isBlinking = useRef(false);
  const blinkAnimationRef = useRef(0);
```
`breathing.ts` should export a `useBreathing()` hook returning `{ step(adapter, delta, amplitudeScale?) }`, with a module- or hook-scoped `useRef` for phase/period state — never `useState` (this file's own inline comment is the canonical citation for why).

**Gating + early return** (blink.ts lines 40-44):
```typescript
function step(adapter: AvatarFormatAdapter, enabled: boolean): void {
  if (!enabled) return;

  const expressionManager = adapter.getExpressionManager();
  if (!expressionManager) return; // GLB (and any format with no expression system): automatic no-op.
```
`breathing.ts`'s `step` should mirror this exact defensive-early-return shape but gate on the bone lookup instead: `const chest = adapter.getHumanoidBoneNode("chest"); if (!chest) return;` (see types.ts pattern below for why this must NOT be the existing literal `getBoneNode`).

**Allocation-reuse scratch quaternion** — mirror `crossfade.ts`'s pattern (see below), not `blink.ts` (blink writes scalar expression values, has no allocation concern). Declare `const _breathingDelta = new THREE.Quaternion();` once at module scope, reused every `step()` call, never `new` inside the per-frame path.

**Composition write — additive, not overwrite (PERF-01)**:
```typescript
// Illustrative shape (RESEARCH.md Pattern 3) — module-scoped scratch,
// applied via multiply(), never .set()/.copy().
const _deltaQuat = new THREE.Quaternion();
function applyBreathingDelta(bone: THREE.Object3D, phase: number, amplitude: number) {
  _deltaQuat.setFromAxisAngle(X_AXIS, Math.sin(phase) * amplitude);
  bone.quaternion.multiply(_deltaQuat); // additive — NOT bone.quaternion.set(...)
}
```

---

### `packages/react/src/animation/sway.ts` (NEW — utility, transform)

**Analog:** same as `breathing.ts` above (`blink.ts`'s hook/ref/gating shape). Sway differs only in which bone role it targets (`"hips"`/`"spine"` vs. breathing's `"chest"`/`"spine"`) and its period should be independent (not phase-locked to breathing) per wayfinder ticket #3's "independent sine cycles" requirement. Same allocation-reuse and additive-composition rules as `breathing.ts` apply verbatim — both write to the shared spine bone and must compose via `.multiply()` in the fixed order the planner documents in `AnimationStateEngine.ts`.

---

### `packages/react/src/animation/expressionDrift.ts` (NEW — utility, transform, VRM-only)

**Analog:** `packages/react/src/animation/blink.ts` — this is the closest possible match because expressionDrift targets the *same* system (`VRMExpressionManager`) as blink, using the identical gating mechanism.

**Gating pattern to copy verbatim (blink.ts lines 43-44)**:
```typescript
const expressionManager = adapter.getExpressionManager();
if (!expressionManager) return; // GLB (and any format with no expression system): automatic no-op.
```
This is IDLE-02's exact required behavior ("VRM gets 1-2 expression rest-state drift values; GLB gets none") — no new mechanism needed, just reuse this null-check.

**Expression-value write pattern (blink.ts lines 68-74)**:
```typescript
if (
  expressionManager.blinkExpressionNames.includes("blinkLeft") &&
  expressionManager.blinkExpressionNames.includes("blinkRight")
) {
  expressionManager.setValue("blinkLeft", blinkState.current);
  expressionManager.setValue("blinkRight", blinkState.current);
}
```
`expressionDrift.ts` should call `expressionManager.setValue(name, driftValue)` per drift target, following the same "compute a value via `Math.sin`-based timing, then `setValue`" shape blink.ts already establishes. Unlike blink (binary blink/not-blink state), drift values should be small and continuous — no `.multiply()` composition concern here since expression values are already additive-by-convention via `setValue` overwrites of a manager-owned scalar, not bone quaternions (PERF-01's composition rule is bone-specific, not expression-specific).

---

### `packages/react/src/animation/talkCycle.ts` (NEW — utility, event-driven)

**Analog:** `AnimationStateEngine.ts`'s `useAnimationController` crossfade-trigger effect (lines 112-127) — the existing "detect a condition, call `beginCrossfade`" pattern.

**Existing trigger-and-crossfade shape to extend, not replace** (`AnimationStateEngine.ts` lines 110-127):
```typescript
const targetName = resolveBaseClip(chatStatus, currentAnimation, availableNames);

useEffect(() => {
  const toAction = targetName ? getAction(targetName) : null;
  if (!targetName || !toAction) return;
  if (toAction === currentActionRef.current) return; // already showing this clip, nothing to do

  const root = getRoot();
  if (!root) return;

  blendRef.current = beginCrossfade(currentActionRef.current, toAction, root);
  currentActionRef.current = toAction;
  currentClipNameRef.current = targetName;
}, [targetName, getAction]);
```
`resolveBaseClip`'s `.find()` always returns the *first* matching clip and never cycles (confirmed, RESEARCH Pitfall 4) — this is the exact gap `talkCycle.ts` closes. `talkCycle.ts` needs its own `useRef`-held cycling index/last-played-name state (this `useAnimationController` effect has no such state today; it is net new) and must trigger `beginCrossfade` only on a detected loop-completion (not every render, and never via `setInterval`/`setTimeout` — see Don't-Hand-Roll below).

**Don't hand-roll — use native mixer loop detection, not a manual timer:**
`three.js`'s `AnimationMixer` dispatches a native `"loop"` event (`mixer.addEventListener("loop", callback)`) once per loop completion for `LoopRepeat`-mode actions; alternatively, poll `action.time` vs. `action.getClip().duration` each frame inside `talkCycle.step(adapter, delta)`. **Confidence: MEDIUM** — RESEARCH.md flags the exact `"loop"` event payload shape as unverified against the installed `three@0.180.x` type definitions this session (Assumption A2); confirm against `node_modules/three/src/animation/AnimationMixer.d.ts` before relying on the event API, and fall back to manual `action.time`/`clip.duration` polling if it doesn't behave as expected.

**Anti-pattern this file must NOT reintroduce** (already removed in Phase 10, per `.planning/phases/10-shared-animation-architecture-crossfade-engine/10-PATTERNS.md`): the old `GLBAvatar.tsx` `setTimeout`-driven `3000 + Math.random() * 2000` ms loop-back timer. TALK-01 explicitly requires loop-completion-driven switching with a minimum ~2s dwell, never a wall-clock timer.

---

### `packages/react/src/animation/types.ts` (MODIFIED — model/interface)

**Analog:** itself — additive extension to an existing, actively-documented interface (lines 24-55).

**Current interface to extend** (types.ts lines 24-55, read in full):
```typescript
export interface AvatarFormatAdapter {
  getMixer(): THREE.AnimationMixer;

  /**
   * Resolves a bone/object by name within the avatar's scene graph.
   * ...
   */
  getBoneNode(name: string): THREE.Object3D | null;

  getExpressionManager(): VRMExpressionManager | null;
}
```

**Critical fix required (RESEARCH Pitfall 1, HIGH confidence, directly verified):** `getBoneNode(name)` is a *literal* scene-graph name lookup, not VRM-humanoid-normalized. This project's own bundled VRM assets use 3 different literal names for the same "chest" role (`"chest"`, `"Chest"`, `"J_Bip_C_Chest"`) — a hardcoded `getBoneNode("chest")` call **silently no-ops (returns null, no error) on `male.vrm`**, the project's own demo/default avatar. `breathing.ts`/`sway.ts` MUST NOT call the existing `getBoneNode` for humanoid-role bone lookups.

**Recommended new method, doc-comment style to match `getBoneNode`'s existing convention:**
```typescript
/**
 * Resolves a bone by VRM-humanoid role ("hips" | "spine" | "chest" | ...),
 * NOT a literal scene-graph name — see getBoneNode's literal-name contract
 * above for the distinction. For VRM this is backed by
 * vrm.humanoid.getNormalizedBoneNode(role); VRM bone literal node names are
 * NOT standardized across models (confirmed: this project's own male.vrm,
 * blacknwhitecat.vrm, amongus.vrm each use a different literal name for the
 * same "chest" role) so this method must never fall back to a hardcoded
 * literal-name guess. GLB has no humanoid schema; implementations may use a
 * literal-name lookup table IF the specific bundled model's node names
 * happen to match (verified true for happy.glb: chest/spine/hips/neck/head
 * literal names already match the role strings directly).
 */
getHumanoidBoneNode(role: "hips" | "spine" | "chest" | "upperChest" | "neck" | "head"): THREE.Object3D | null;
```

**VRM humanoid bone-name precedent already in this codebase** (`packages/react/src/utils/remapMixamoAnimationToVrm.ts` lines 25-27, 36-38 — read in full):
```typescript
const vrmHipsY = vrm.humanoid
  ?.getNormalizedBoneNode("hips")
  .getWorldPosition(_vec3).y;
...
const vrmNodeName = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name;
```
This confirms `vrm.humanoid.getNormalizedBoneNode(roleString)` is already a proven, in-use API in this codebase — the correct building block for the new adapter method's VRM-side implementation.

---

### `packages/react/src/animation/AnimationStateEngine.ts` (MODIFIED — hook/controller)

**Analog:** itself, extended in place (full file read, 137 lines).

**Insertion point — verbatim, current state** (lines 129-134):
```typescript
function update(delta: number): void {
  if (blendRef.current.active) {
    stepCrossfade(blendRef.current);
  }
  blink.step(adapter, enableBlinking);
  // Phase 11 adds breathing/sway/drift/talkCycle/audioReactive steps here,
  // in this function body, after blink.step and before returning.
}
```
This comment is the file's own explicit forward-compatibility marker — new steps go here, in this order (or whatever fixed order the plan documents), never before `stepCrossfade`/`blink.step`.

**`floorSeconds` wiring needed for TRANS-01/02** — current call site has no 4th argument (line 120):
```typescript
blendRef.current = beginCrossfade(currentActionRef.current, toAction, root);
```
Change needed (RESEARCH.md's exact recommended shape):
```typescript
const floor = (chatStatus === "starting" || chatStatus === "stopped") ? 1.2 : undefined;
blendRef.current = beginCrossfade(currentActionRef.current, toAction, root, floor);
```
`poseGapToDuration`/`beginCrossfade` in `crossfade.ts` already accept this `floorSeconds` param (added in Phase 10 specifically as a Phase-11 forward-compat hook, lines 69-72 and 105-106 of `crossfade.ts`) — **no changes needed to `crossfade.ts` itself**, only to this call site.

**`STATUS_CLIP_PATTERNS` table — already generalized, ready to consume placeholder clip names** (lines 32-38):
```typescript
const STATUS_CLIP_PATTERNS: Partial<Record<ChatStatus, RegExp>> = {
  speaking: /talk|gesture|speak/i,
  listening: /listen/i,
  thinking: /think/i,
  starting: /welcome|greet|hello|intro/i,
  stopped: /stop|bye|goodbye|outro/i,
};
```
Note the GLB regex mismatch (RESEARCH Pitfall 2): `'State 4 Taking (loop)'` does not match `/talk|gesture|speak/i` (contains "Taking," not "Talking"). If the plan extends this regex, add a documented one-off (`/\btaking\b/i`) with an inline comment explaining why, per the pitfall's option (a).

**`useAnimationController`'s params signature to extend** (lines 82-91) — `currentVolume` and any talk-cycle-needed state must be threaded in as new params, following the existing params-object convention:
```typescript
export function useAnimationController(params: {
  adapter: AvatarFormatAdapter;
  chatStatus: ChatStatus;
  currentAnimation: string | null;
  availableNames: string[];
  getAction: (name: string) => THREE.AnimationAction | null;
  getRoot: () => THREE.Object3D | null;
  enableBlinking: boolean;
  // Phase 11 additions follow this same flat-params-object shape, e.g.:
  // currentVolume?: number;
}): { update: (delta: number) => void } {
```

**Existing "never useState" convention, cited again at this exact call site** (lines 96-99):
```typescript
// Never useState — mutated every frame (blendRef via stepCrossfade) or on
// every base-clip change (currentActionRef/currentClipNameRef), neither
// of which should trigger a React re-render (see the codebase-wide
// useRef-for-per-frame-state convention documented in blink.ts).
```
Any new talk-cycle index/last-loop-time bookkeeping added to this hook must be `useRef`, matching this file's own explicit citation.

---

### `packages/react/src/KhaveeProvider.tsx` (MODIFIED — provider, pub-sub)

**Analog:** itself, extended in place (full file read, 308 lines) — the existing `onChatStatusChange` subscription is the direct template for the new `onVolumeChange` subscription.

**`KhaveeContextType` shape to extend** (lines 6-25):
```typescript
interface KhaveeContextType {
  config?: KhaveeConfig;
  vrm: VRM | null;
  setVrm: (vrm: VRM | null) => void;
  expressions: Record<string, number>;
  setExpression: (name: string, value: number) => void;
  resetExpressions: () => void;
  setMultipleExpressions: (expressionMap: Record<string, number>) => void;
  currentAnimation: string | null;
  animate: (animationName: string) => void;
  stopAnimation: () => void;
  availableAnimations: string[];
  setAvailableAnimations: (animations: string[]) => void;
  realtimeProvider: RealtimeProvider | null;
  chatStatus: import('@khaveeai/core').ChatStatus;
  // Phase 11 adds: currentVolume: number;
}
```

**State + subscription pattern to mirror exactly** (lines 96, 107-112 — `chatStatus`'s existing wiring, the direct template for `currentVolume`):
```typescript
const [chatStatus, setChatStatus] = useState<import('@khaveeai/core').ChatStatus>("stopped");
...
// Listen to chat status changes from realtime provider
useEffect(() => {
  if (realtimeProvider) {
    realtimeProvider.onChatStatusChange = setChatStatus;
  }
}, [realtimeProvider]);
```
New code should add `const [currentVolume, setCurrentVolume] = useState(0);` and a parallel `useEffect` subscribing `realtimeProvider.onVolumeChange = setCurrentVolume;`.

**Known collision risk to defend against (RESEARCH Pitfall 5, verified):** this existing `onChatStatusChange` assignment is a **bare, non-chaining** direct assignment (`provider.onChatStatusChange = setChatStatus`) — it does NOT preserve/chain any prior callback. `useRealtime.ts` (lines 67-71, 95-97) already had to defend against exactly this collision by capturing and chaining the upstream callback before overwriting it:
```typescript
// useRealtime.ts lines 71-72, 95-97 — the chaining precaution KhaveeProvider's
// new onVolumeChange wiring should apply if useRealtime() is expected to
// coexist with it (useRealtime.ts's own onVolumeChange assignment at line 106
// is currently a bare, non-chaining assignment too — a related, pre-existing
// risk this phase should not make worse, per RESEARCH Pitfall 5).
const upstreamChatStatusChange = provider.onChatStatusChange;
...
provider.onChatStatusChange = (status) => {
  upstreamChatStatusChange?.(status); // Forward to upstream subscriber (KhaveeProvider) first
  setChatStatus(status);
  ...
};
```

**Existing scalar-clamping convention to apply to `currentVolume` (Security Domain V5, minimal but real):** `setExpression`'s clamp (lines 138-141):
```typescript
const setExpression = useCallback((name: string, value: number) => {
  const clampedValue = Math.max(0, Math.min(1, value));
  setExpressions(prev => ({ ...prev, [name]: clampedValue }));
}, []);
```
Apply the same `Math.max(0, Math.min(1, value))` pattern when storing `currentVolume`, matching this file's own existing convention for scalar inputs from external sources.

**Context value object to extend** (lines 249-268) — add `currentVolume` alongside the other exposed state, following the flat-spread shape already used there.

---

### `packages/react/src/VRMAvatar.tsx` (MODIFIED — component, streaming)

**Analog:** itself, extended in place (relevant section read, lines 300-509).

**Current adapter to extend** (lines 446-450):
```typescript
const vrmAdapter: AvatarFormatAdapter = {
  getMixer: () => mixerRef.current!,
  getBoneNode: (name) => scene?.getObjectByName(name) ?? null,
  getExpressionManager: () => currentVrm?.expressionManager ?? null,
};
```
Add `getHumanoidBoneNode: (role) => currentVrm?.humanoid?.getNormalizedBoneNode(role) ?? null,` — using the same optional-chaining/null-coalescing style already established for `getExpressionManager` on this exact object literal.

**Controller call to extend with new params** (lines 452-463):
```typescript
const controller = useAnimationController({
  adapter: vrmAdapter,
  chatStatus,
  currentAnimation,
  availableNames: processedClips.map((c) => c.name),
  getAction: (name) => {
    const clip = processedClips.find((c) => c?.name === name);
    return clip && mixerRef.current ? mixerRef.current.clipAction(clip) : null;
  },
  getRoot: () => currentVrm?.scene ?? scene ?? null,
  enableBlinking,
});
```
`currentVolume` must be read via `useKhavee()` (line 307's existing destructure: `const { setVrm, expressions, currentAnimation, animate, chatStatus } = useKhavee();` — add `currentVolume` to this same destructure) and passed into this params object, following the exact same "pull from `useKhavee()`, pass straight into the controller params object" shape already used for `chatStatus`/`currentAnimation`.

**Frame-ordering contract — MUST be preserved exactly** (lines 480-502, the critical section):
```typescript
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

  // Crossfade ramp + blink step (shared animation module — see
  // packages/react/src/animation/AnimationStateEngine.ts). Frame-ordering
  // contract: mixer.update -> controller.update -> vrm.update.
  controller.update(delta);

  // Update VRM after all changes (expressions + animations + blinking + gestures)
  currentVrm.update(delta);
});
```
All new procedural steps (breathing/sway/drift/talkCycle/audio-reactive) live INSIDE `controller.update(delta)` (in `AnimationStateEngine.ts`), not added as new lines in this `useFrame` body — this file's own insertion-point comment already documents why: `mixer.update -> controller.update -> vrm.update`.

---

### `packages/react/src/GLBAvatar.tsx` (MODIFIED — component, streaming)

**Analog:** `VRMAvatar.tsx` (sibling implementation, same adapter/controller contract) — also self, extended in place (full file read, 170 lines).

**Current adapter to extend** (lines 142-146):
```typescript
const glbAdapter: AvatarFormatAdapter = {
  getMixer: () => mixer,
  getBoneNode: (name) => groupRef.current?.getObjectByName(name) ?? null,
  getExpressionManager: () => null, // GLB has no expression/blendshape system.
};
```
Add `getHumanoidBoneNode`, e.g. a small literal-name lookup since GLB has no humanoid schema — verified `happy.glb`'s embedded skeleton already uses plain literal names matching the semantic role directly (`chest`, `spine`, `hips`, `neck`, `head`, confirmed by parsing the GLB's `nodes[].name` array):
```typescript
getHumanoidBoneNode: (role) => groupRef.current?.getObjectByName(role) ?? null, // happy.glb's literal node names already match VRM humanoid role strings directly
```

**Controller call to extend with new params** (lines 148-156):
```typescript
const controller = useAnimationController({
  adapter: glbAdapter,
  chatStatus,
  currentAnimation,
  availableNames: names,
  getAction: (name) => actions[name] ?? null,
  getRoot: () => groupRef.current,
  enableBlinking: true, // harmless no-op on GLB — adapter's expression manager is always null.
});
```
Same as VRMAvatar: destructure `currentVolume` from `useKhavee()` at line 97 (`const { currentAnimation, chatStatus, setAvailableAnimations } = useKhavee();`) and pass into this params object.

**Frame-ordering contract — GLB's variant, mixer owned by drei** (lines 158-163):
```typescript
// drei's useAnimations already runs mixer.update(delta) internally via its
// own earlier-registered useFrame, so the controller's crossfade ramp/
// blink step below runs after it — no manual mixer.update(delta) here.
useFrame((_, delta) => {
  controller.update(delta);
});
```
No change needed to this `useFrame` body itself — same "everything new goes inside `controller.update(delta)`" rule as VRMAvatar applies here too.

---

## Shared Patterns

### Ref-driven procedural state (never `useState`)
**Source:** `packages/react/src/animation/blink.ts` lines 29-34, reinforced at `AnimationStateEngine.ts` lines 96-99
**Apply to:** `breathing.ts`, `sway.ts`, `expressionDrift.ts`, `talkCycle.ts`, and any new stateful bookkeeping added to `useAnimationController`
```typescript
// blinkState is a ref, not React state: it's only ever read synchronously
// within the same useFrame callback that writes it, never rendered in JSX —
// calling a state setter here would re-render this component every frame,
// fighting the R3F render loop for the main thread.
const blinkState = useRef(0);
```

### Defensive early-return gating on nullable adapter methods
**Source:** `packages/react/src/animation/blink.ts` lines 41, 43-44
**Apply to:** all four new procedural files, `AnimationStateEngine.ts`
```typescript
if (!enabled) return;
const expressionManager = adapter.getExpressionManager();
if (!expressionManager) return; // GLB (and any format with no expression system): automatic no-op.
```
This is the codebase's established pattern for "expected, recoverable" conditions (missing bone, missing clip, adapter returning null) — no `try/catch` for these synchronous lookups.

### Allocation-reuse: scratch objects declared once, reused every frame
**Source:** `packages/react/src/animation/crossfade.ts` lines 45-46 (`computePoseGapAngle`)
**Apply to:** `breathing.ts`, `sway.ts` (any file allocating `THREE.Quaternion`/`THREE.Euler` for per-frame math)
```typescript
const qLive = new THREE.Quaternion();
const qTarget = new THREE.Quaternion();
// declared once per call/module, never `new` inside the per-frame loop body
```

### Additive composition — `.multiply()`, never `.set()`/`.copy()` (PERF-01)
**Source:** net-new pattern for this phase, illustrated in RESEARCH.md's Pattern 3; no existing codebase precedent to copy verbatim (this is the one genuinely new mechanic, not a migration)
**Apply to:** `breathing.ts`, `sway.ts`, and their composition call site in `AnimationStateEngine.ts`'s `update(delta)`
```typescript
const _deltaQuat = new THREE.Quaternion(); // module-scoped, reused every frame
_deltaQuat.setFromAxisAngle(X_AXIS, Math.sin(phase) * amplitude);
bone.quaternion.multiply(_deltaQuat); // additive — NOT bone.quaternion.set(...)
```
Fixed composition order (e.g. breathing → sway → audio-reactive scale) must be documented as an inline comment at the call site in `AnimationStateEngine.ts`'s `update(delta)`.

### VRM humanoid bone resolution (not literal `getBoneNode`)
**Source:** `packages/react/src/utils/remapMixamoAnimationToVrm.ts` lines 25-27, 36-38 — pre-existing, proven usage of `vrm.humanoid.getNormalizedBoneNode()`
**Apply to:** `types.ts`'s new `getHumanoidBoneNode` method, its VRM implementation in `VRMAvatar.tsx`, and every call site in `breathing.ts`/`sway.ts` that needs `"chest"`/`"spine"`/`"hips"` bones
```typescript
const vrmHipsY = vrm.humanoid
  ?.getNormalizedBoneNode("hips")
  .getWorldPosition(_vec3).y;
```
Critical: do NOT use the existing `getBoneNode(literalName)` for humanoid-role lookups — verified to silently no-op on `male.vrm` (this project's own demo default), which uses `"J_Bip_C_Chest"` rather than a bare `"chest"` literal node name.

### Frame-ordering contract (must not be violated)
**Source:** `AnimationStateEngine.ts` lines 73-80 (doc comment), enforced at call sites in `VRMAvatar.tsx` lines 480-502 and `GLBAvatar.tsx` lines 158-163
**Apply to:** every new procedural step — all live inside `controller.update(delta)`'s body, never as new lines added directly to either avatar's `useFrame`
```
mixer.update(delta) -> controller.update(delta) -> vrm.update(delta)
```

### Scalar clamping for externally-sourced values
**Source:** `KhaveeProvider.tsx` lines 138-141 (`setExpression`)
**Apply to:** `currentVolume` storage in `KhaveeProvider.tsx`, and its consumption in `talkCycle.ts`/`breathing.ts`/`sway.ts` amplitude scaling
```typescript
const clampedValue = Math.max(0, Math.min(1, value));
```

## No Analog Found

Mechanics that are genuinely net-new this phase — no existing codebase pattern to copy, only RESEARCH.md's illustrative (non-locked) shapes to reference:

| File / Mechanic | Role | Data Flow | Reason |
|---|---|---|---|
| Audio-reactive amplitude scaling (wherever the planner locates it — likely a function/param threaded through `breathing.ts`/`sway.ts`/`talkCycle.ts` rather than its own file, per RESEARCH.md's Recommended Project Structure, which lists no separate `audioReactiveAmplitude.ts`) | utility | transform | No existing codebase code scales procedural motion by a live volume signal; `currentVolume` itself is a pre-existing signal but its consumption for this purpose is new |
| `talkCycle.ts`'s cycling-index/last-played-clip ref state | utility (state machine) | event-driven | `resolveBaseClip` is a pure function with no state-holding capability (RESEARCH Pitfall 4, confirmed); the nearest analog (`useAnimationController`'s crossfade-trigger effect) has no equivalent "remember which variant played last" state today |
| `mixer.addEventListener("loop", ...)` usage | n/a (native three.js API) | event-driven | Not used anywhere in this codebase today; MEDIUM confidence per RESEARCH.md Assumption A2 — verify against installed `three@0.180.x` types before relying on it, manual `action.time`/`clip.duration` polling is the documented fallback |
| `expressionDrift.ts`'s specific rest-state drift values (which 1-2 expressions, target ranges) | n/a (numeric parameters) | n/a | No existing "idle expression drift" values exist anywhere in this codebase to migrate verbatim (unlike blink, which kept its original inline constants) — CONTEXT.md Assumption A1 flags this as Claude's Discretion, pick physiologically-plausible defaults and document them inline |

## Metadata

**Analog search scope:** `packages/react/src/animation/*.ts` (all 4 existing files read in full), `packages/react/src/{KhaveeProvider,VRMAvatar,GLBAvatar}.tsx` (relevant sections read), `packages/react/src/hooks/useRealtime.ts` (read in full), `packages/react/src/utils/remapMixamoAnimationToVrm.ts` (read in full), `packages/react/src/animation/*.test.ts` (both existing test files read for test-structure convention)
**Files scanned:** 9 source files + 2 test files, all current on branch `gsd/phase-10-shared-animation-architecture-crossfade-engine`'s successor state (all files verified directly this session, not inferred from CONTEXT.md/RESEARCH.md's own citations)
**Pattern extraction date:** 2026-07-12
