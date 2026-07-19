# Phase 11: Bone-Masked Upper-Body Animation Layering - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 2 (1 modified, 1 new)
**Analogs found:** 2 / 2

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/react/src/utils/filterClipTracksByBoneSet.ts` | utility (transform) | transform (AnimationClip → AnimationClip) | `packages/react/src/utils/remapMixamoAnimationToVrm.ts` | exact (same module family, same track-manipulation technique, same directory) |
| `packages/react/src/VRMAvatar.tsx` (modified: new refs, new memo, new effect) | component (render + animation-state) | event-driven (chatStatus transitions drive mixer/action state) | itself — extend existing `processedClips` memo (line 328), mixer-init effects (lines 389, 413), `currentAnimation` crossfade effect (lines 489-521) | exact (same file, same established patterns being extended in place) |

## Pattern Assignments

### `packages/react/src/utils/filterClipTracksByBoneSet.ts` (utility, transform)

**Analog:** `packages/react/src/utils/remapMixamoAnimationToVrm.ts` (100 lines, read in full)

**Imports pattern** (`remapMixamoAnimationToVrm.ts` lines 1-2):
```typescript
import * as THREE from "three";
import { mixamoVRMRigMap } from "./mixamoVRMRigMap";
```
For the new file, mirror this exactly but there is no rig-map import needed — instead accept a `VRM` instance and a `string[]` of VRM humanoid bone names as parameters (per RESEARCH.md Pattern 1/2). Type the VRM param loosely the same way the analog does (it uses an inline structural type for `vrm`, not an imported `VRM` type, to avoid a hard `@pixiv/three-vrm` type dependency mismatch) — but since RESEARCH.md's own example imports `VRM` directly from `@pixiv/three-vrm`, prefer importing the real `VRM` type (already imported in `VRMAvatar.tsx` line 1) for stronger type safety, consistent with how `VRMAvatar.tsx` itself types `currentVrm: VRM`.

**Track-name-parsing convention** (`remapMixamoAnimationToVrm.ts` line 34-36):
```typescript
const trackSplitted = track.name.split(".");
const mixamoRigName = trackSplitted[0];
const vrmBoneName = mixamoVRMRigMap[mixamoRigName as keyof typeof mixamoVRMRigMap];
```
The new utility reuses the identical `track.name.split(".")[0]` convention to extract the leading node name, but in the OPPOSITE direction: instead of mapping mixamo-rig-name → vrmBoneName → vrmNodeName (build phase), it resolves a list of vrmBoneNames → vrmNodeNames once (via `vrm.humanoid.getNormalizedBoneNode(boneName)?.name`), builds a `Set`, then filters existing already-remapped clip tracks by checking `nodeNames.has(track.name.split(".")[0])`. Do NOT string-match bone names directly (e.g. `track.name.startsWith("head")`) — per RESEARCH.md, remapped track names are `"Normalized_<raw-node-name>.quaternion"`, not `"head.quaternion"`. Always resolve through `vrm.humanoid.getNormalizedBoneNode(boneName)?.name` first, exactly as `remapMixamoAnimationToVrm.ts` line 37 does: `const vrmNodeName = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name;`

**Core transform pattern — clip construction** (`remapMixamoAnimationToVrm.ts` line 100, the return statement):
```typescript
return new THREE.AnimationClip("vrmAnimation", clip.duration, tracks);
```
The new utility follows this exact shape: `new THREE.AnimationClip(newName, clip.duration, filteredTracks)`. Critical: pass the ORIGINAL `clip.duration` explicitly (do not call `.resetDuration()` or pass `-1` for auto-calc) — RESEARCH.md Pitfall 4 documents that auto-computed duration on a track subset can drift from the sibling sub-clip's duration over many loop iterations since `resetDuration()` takes `Math.max` over only the *remaining* tracks.

**Concrete implementation** (synthesized from RESEARCH.md Patterns 1-2, matching the analog's style):
```typescript
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

function getBoneTrackNodeNames(vrm: VRM, boneNames: string[]): Set<string> {
  const nodeNames = new Set<string>();
  for (const boneName of boneNames) {
    const node = vrm.humanoid?.getNormalizedBoneNode(boneName as any);
    if (node?.name) nodeNames.add(node.name);
  }
  return nodeNames;
}

export function filterClipTracksByBoneSet(
  clip: THREE.AnimationClip,
  vrm: VRM,
  boneNames: string[],
  newName: string
): THREE.AnimationClip {
  const nodeNames = getBoneTrackNodeNames(vrm, boneNames);

  const filteredTracks = clip.tracks.filter((track) => {
    const nodeName = track.name.split(".")[0];
    return nodeNames.has(nodeName);
  });

  // Pass original clip.duration explicitly — do NOT let it auto-recompute
  // (Pitfall 4: sub-clips derived from the same source clip must share duration
  // to avoid phase drift between independently-looping base/upper actions).
  return new THREE.AnimationClip(newName, clip.duration, filteredTracks);
}
```

**No error handling / no validation in the analog** — `remapMixamoAnimationToVrm.ts` has no try/catch internally (the caller, `processedClips` in `VRMAvatar.tsx` line 340-383, wraps the call site in try/catch and `console.error`s on failure). The new utility should follow the same division of responsibility: the utility itself does not throw for "zero tracks matched" — it returns a valid (possibly empty-tracks) `AnimationClip`, and the CALLER (the new `boneMaskedClips` memo in `VRMAvatar.tsx`) is responsible for checking `tracks.length === 0` and falling back (per D-05/Pitfall 5, non-Mixamo GLB edge case).

**Testing pattern:** No `__tests__` directory exists under `packages/react/src/utils/` today (no test file for `remapMixamoAnimationToVrm.ts` either) — there is no existing test analog for this utility in `packages/react`. If tests are added this phase, the closest test-style analog in the repo is `packages/providers/openai-stt-tts/src/__tests__/STTClient.test.ts` (Vitest), but note `packages/react` has no test runner configured at all per CLAUDE.md ("No test framework configured at repo root or in `packages/core`, `packages/react`..."). Treat testing as out-of-scope unless CONTEXT.md says otherwise (it does not mention tests).

---

### `packages/react/src/VRMAvatar.tsx` (component, event-driven — modification)

**Analog:** itself — three existing patterns within the same file, to be extended, not replaced.

**1. Bone-set constants** — new module-level constants, sibling to the existing top-of-file constant/type declarations (e.g. near `GLTFResult` interface, line 11-18). Derive directly from `mixamoVRMRigMap.ts` values (all 59 map entries, minus duplicates) per D-01/D-02:
```typescript
// D-01: base/lower-body set (always driven by the continuous base clip)
const BASE_LOWER_BONES = [
  "hips", "spine",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
  "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
];

// D-02: upper-body set (chest/upperChest/neck explicitly here, not in base,
// so gesture clips get coherent torso-lean + arm motion — see D-02 rationale)
const UPPER_BONES = [
  "chest", "upperChest", "neck", "head",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "leftThumbMetacarpal", "leftThumbProximal", "leftThumbDistal",
  "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
  "leftMiddleProximal", "leftMiddleIntermediate", "leftMiddleDistal",
  "leftRingProximal", "leftRingIntermediate", "leftRingDistal",
  "leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal",
  "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "rightThumbMetacarpal", "rightThumbProximal", "rightThumbDistal",
  "rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal",
  "rightMiddleProximal", "rightMiddleIntermediate", "rightMiddleDistal",
  "rightRingProximal", "rightRingIntermediate", "rightRingDistal",
  "rightLittleProximal", "rightLittleIntermediate", "rightLittleDistal",
];
```
Cross-reference: `mixamoVRMRigMap.ts` lines 8-59 is the source of truth for the full bone-name union — verify `BASE_LOWER_BONES ∪ UPPER_BONES` covers every distinct value in that map (no bone silently dropped from both sets).

**2. New refs, colocated with existing ref declarations** (analog: `mixerRef`/`currentActionRef` at lines 260-261, `animationsRef` at line 268):
```typescript
const mixerRef = useRef<THREE.AnimationMixer | null>(null);
const currentActionRef = useRef<THREE.AnimationAction | null>(null);
// NEW — add directly below currentActionRef, same declaration style:
const baseActionRef = useRef<THREE.AnimationAction | null>(null);
const upperActionRef = useRef<THREE.AnimationAction | null>(null);
```
Follow the file's established comment-header style for ref groups (e.g. `// chatStatus auto-mapping refs` at line 264) — add a `// Bone-masked layering refs (Phase 11)` header comment above the two new refs.

**3. `boneMaskedClips` memo — sibling to `processedClips` memo** (analog: lines 328-386, `useMemo` with dependency array `[loadedAnimations, currentVrm]`):
```typescript
// Derive base-lower and per-key upper-body-filtered sub-clips from processedClips.
// Memoized on [processedClips, currentVrm] — MUST NOT be recomputed in render body
// or useFrame (Pitfall 3: AnimationClip UUID churn leaks AnimationAction/PropertyMixer
// pairs and breaks crossfade continuity every render).
const boneMaskedClips = useMemo(() => {
  if (!currentVrm || processedClips.length === 0) return null;

  const idleClip = processedClips.find((c) => c?.name === "idle");
  const baseLower = idleClip
    ? filterClipTracksByBoneSet(idleClip, currentVrm, BASE_LOWER_BONES, "base-lower")
    : null;

  const upperByKey: Record<string, THREE.AnimationClip> = {};
  processedClips.forEach((clip) => {
    if (!clip) return;
    const upperClip = filterClipTracksByBoneSet(clip, currentVrm, UPPER_BONES, `${clip.name}-upper`);
    // D-05/Pitfall 5 fallback: zero matched tracks means this clip's node names
    // never appeared in the resolved set (non-Mixamo GLB, arbitrary bone names) —
    // mark unmaskable so the caller falls back to the existing whole-skeleton path.
    if (upperClip.tracks.length > 0) upperByKey[clip.name] = upperClip;
  });

  return { baseLower, upperByKey };
}, [processedClips, currentVrm]);
```
Note the same defensive-empty-state pattern as `processedClips` (line 329-336: `if (!animations || !currentVrm || ...) { console.log(...); return []; }`) — mirror the early-return + `console.log`/`console.warn` style, not throw.

**4. Base-lower action lifecycle — sibling to mixer-init effect** (analog: lines 389-410, the `useEffect` that creates `mixerRef.current` and calls `.clipAction(clip)` for each processed clip):
```typescript
// Base-lower action: created once, always playing at weight 1, never swapped.
useEffect(() => {
  if (!mixerRef.current || !boneMaskedClips?.baseLower || baseActionRef.current) return;

  const action = mixerRef.current.clipAction(boneMaskedClips.baseLower);
  action.reset().play(); // no fadeIn — first-ever activation (Pitfall 1, mirrors line 515-518 pattern)
  baseActionRef.current = action;
}, [boneMaskedClips]);
```
This reuses `mixerRef.current.clipAction(clip)` exactly as the existing mixer-init effect does at line 397 (`mixerRef.current?.clipAction(clip);`) and line 419 — same API call, just applied to the filtered clip and stored in a dedicated ref instead of iterated generically.

**5. Upper-layer crossfade effect — direct extension of the `currentAnimation` crossfade effect** (analog: lines 489-521, read in full):
```typescript
// Existing pattern (lines 489-521) being extended:
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
}, [currentAnimation]);
```
**New upper-layer effect** — same fade values (0.3s), same `.reset().fadeIn(0.3).play()` / `.fadeOut(0.3)` calls, same "already-same-action" and "first-activation" branches, but scoped to `upperActionRef` and keyed off whether `currentAnimation` resolves to a status-mapped key with a bone-masked upper clip available:
```typescript
useEffect(() => {
  if (!mixerRef.current || !boneMaskedClips) return;

  // D-04 exemption: if currentAnimation has no upper-filtered clip (custom/
  // non-status key, or non-Mixamo GLB per Pitfall 5), fall back to the
  // existing whole-skeleton path (handled by the effect above, unchanged) —
  // this effect only acts when an upper-filtered clip IS available.
  const upperKey = currentAnimation && boneMaskedClips.upperByKey[currentAnimation]
    ? currentAnimation
    : "idle"; // D-05: idle-upper fallback when no gesture status is active

  const upperClip = boneMaskedClips.upperByKey[upperKey];
  if (!upperClip || !mixerRef.current) return;

  const newUpperAction = mixerRef.current.clipAction(upperClip);

  if (!upperActionRef.current) {
    newUpperAction.reset().play(); // Pitfall 1: no fade on cold start
  } else if (upperActionRef.current !== newUpperAction) {
    upperActionRef.current.fadeOut(0.3);
    newUpperAction.reset().fadeIn(0.3).play();
  }
  upperActionRef.current = newUpperAction;
}, [currentAnimation, boneMaskedClips]);
```

**6. Cross-path weight coordination (Pitfall 2 — flagged as a design gap in RESEARCH.md, must be resolved in planning)**: when a non-status `animate('dance')` key is active (unfiltered whole-skeleton clip via the existing line-489 effect), `baseActionRef.current` and `upperActionRef.current` must have their weight zeroed to avoid `PropertyMixer` fighting on shared `hips`/`spine`/leg tracks:
```typescript
// Pattern (not yet in codebase — new coordination logic required this phase):
baseActionRef.current?.setEffectiveWeight(isStatusDrivenKey ? 1 : 0);
upperActionRef.current?.setEffectiveWeight(isStatusDrivenKey ? 1 : 0);
```
No existing analog for this in the codebase — `AnimationAction.setEffectiveWeight()` is a three.js built-in, not previously used anywhere in `VRMAvatar.tsx`. Planner should add this as an explicit required task per RESEARCH.md Open Question 2 / Pitfall 2.

**7. `useFrame` ordering — MUST preserve** (lines 575-586, 884, read directly):
```typescript
useFrame((_, delta) => {
  if (!currentVrm?.expressionManager) return;
  // ...
  if (mixerRef.current) {
    mixerRef.current.update(delta); // line 584-586 — single mixer.update() call
  }
  // ── Procedural bone deltas (D-04, D-06, D-08) ── (lines 588+, breathing/head/nod/etc.)
  // ...
  currentVrm.update(delta); // line 884 — final VRM update
});
```
Since `mixerRef.current` is a SINGLE mixer hosting both `baseActionRef`/`upperActionRef`/`currentActionRef` actions (per RESEARCH.md: `AnimationMixer` binds `PropertyMixer` per (root, trackName) pair — disjoint tracks across multiple actions on one mixer never conflict), the existing single `mixerRef.current.update(delta)` call at line 585 already updates ALL bound actions (base-lower + upper + any whole-skeleton custom action) in one call — no new `mixer.update()` call is needed. Procedural deltas (breathing/head/nod/gaze/finger-curl, lines 588-883) continue to apply AFTER this single `mixer.update(delta)` and BEFORE `currentVrm.update(delta)` at line 884, unchanged, since they operate on `currentVrm.humanoid.getNormalizedBoneNode(...)` quaternions directly regardless of which action(s) are currently driving those bones.

---

## Shared Patterns

### Fade pattern (0.3s crossfade)
**Source:** `packages/react/src/VRMAvatar.tsx` lines 509-518 (existing `currentAnimation` effect)
**Apply to:** New upper-layer crossfade effect — reuse verbatim, same duration (D-06 locks 0.3s, no new tunable prop):
```typescript
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
```

### Memoization boundary (prevents AnimationAction/PropertyMixer leaks)
**Source:** `packages/react/src/VRMAvatar.tsx` lines 328-386 (`processedClips` memo, dependency array `[loadedAnimations, currentVrm]`)
**Apply to:** New `boneMaskedClips` memo — MUST use dependency array `[processedClips, currentVrm]`, computed in exactly one `useMemo`, never inside `useFrame` or render body. `AnimationClip`'s constructor generates a fresh UUID on every call (no UUID-passing overload), and `AnimationMixer.clipAction()` caches actions by clip UUID — recomputing outside a stable memo produces a new `AnimationAction`+`PropertyMixer` set every render.

### Track-name resolution via VRM humanoid API (never string-match track names directly)
**Source:** `packages/react/src/utils/remapMixamoAnimationToVrm.ts` line 37 (`vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name`)
**Apply to:** New `filterClipTracksByBoneSet.ts` utility — bone names must be resolved through `vrm.humanoid.getNormalizedBoneNode(boneName)` per currently-loaded VRM instance, because the resulting node name is `"Normalized_" + <raw-node-name-from-the-specific-loaded-VRM-file>`, which varies per model. Hardcoding a fixed string prefix (e.g. `"head."`) will silently match zero tracks.

### Defensive early-return + console logging (no throwing) for "not ready yet" / "no match" states
**Source:** `packages/react/src/VRMAvatar.tsx` lines 329-336 (`processedClips` memo's guard clause) and lines 377-382 (per-clip try/catch with `console.error`)
**Apply to:** `boneMaskedClips` memo (return `null` if `!currentVrm || processedClips.length === 0`) and the new upper-layer effect (no-op / fall back to `"idle"` key if `currentAnimation` has no matching upper-filtered clip) — consistent with the codebase's established "never throw for foreseeable missing-data states" convention (also documented in CLAUDE.md's Error Handling section: defensive guards return early instead of throwing for "should never happen but is not fatal" conditions).

### Original-duration preservation (avoid `resetDuration()`)
**Source:** `packages/react/src/utils/remapMixamoAnimationToVrm.ts` line 100 (`new THREE.AnimationClip("vrmAnimation", clip.duration, tracks)` — passes source `clip.duration` through unchanged, never recomputed)
**Apply to:** `filterClipTracksByBoneSet.ts` — always pass the original unfiltered `clip.duration` explicitly into the new `AnimationClip` constructor call, never let three.js auto-calculate it from the filtered track subset (Pitfall 4: base-lower and idle-upper sub-clips derived from the same source 'idle' clip would otherwise drift out of phase over many loop iterations).

## No Analog Found

| File/Concern | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Cross-path weight-zeroing coordination (Pitfall 2: base/upper action weight vs. D-04 whole-skeleton custom animation) | logic (in-component) | event-driven | No existing use of `AnimationAction.setEffectiveWeight()`/`.stop()` anywhere in the codebase to coordinate multiple simultaneously-bound actions on disjoint vs. overlapping track sets — this is new coordination logic with no prior pattern to copy. Planner should treat this as an explicit required task (RESEARCH.md Open Question 2 / Pitfall 2), not covered by existing crossfade code. |
| Dual-mixer vs. single-mixer decision test/verification | N/A | N/A | No existing test harness verifies multi-action-per-mixer disjoint-track behavior; RESEARCH.md's confidence here comes from reading three.js source directly (`AnimationMixer.js`, `PropertyMixer.js`), not from an existing codebase example. |

## Metadata

**Analog search scope:** `packages/react/src/` (VRMAvatar.tsx, utils/remapMixamoAnimationToVrm.ts, utils/mixamoVRMRigMap.ts), plus targeted line-range reads of VRMAvatar.tsx (imports, ref declarations, processedClips memo, mixer-init effects, chatStatus auto-mapping effect, currentAnimation crossfade effect, useFrame loop head and tail).
**Files scanned:** 3 read in full (`remapMixamoAnimationToVrm.ts` 100 lines, `mixamoVRMRigMap.ts` 59 lines), 1 read via targeted non-overlapping ranges (`VRMAvatar.tsx`, 1221 lines total — ranges 1-30, 259-329, 328-427, 427-527, 575-635, plus grep-located line numbers for `currentVrm.update`).
**Pattern extraction date:** 2026-07-01
