# Phase 11: Bone-Masked Upper-Body Animation Layering - Research

**Researched:** 2026-07-01
**Domain:** three.js `AnimationMixer`/`AnimationClip` track-level bone filtering, applied to `@pixiv/three-vrm` humanoid rigs inside `VRMAvatar.tsx`
**Confidence:** HIGH (core mechanism verified by reading the actual installed `three@0.180.0` and `@pixiv/three-vrm-core@3.4.2` source in `node_modules/`, not just docs/training data)

## Summary

three.js's `AnimationMixer` binds `PropertyMixer` instances **per (root UUID, track name) pair**, not per-action. This means two `AnimationAction`s on the *same* mixer whose clips reference **disjoint track names** never interact — each bone-property has exactly one contributing action, so there is no blend-weight conflict between a continuous base/lower-body action and a crossfading upper-body action. This was confirmed by reading `AnimationMixer.js::_bindAction` and `PropertyMixer.js` directly (not assumed from docs). A single `THREE.AnimationMixer` instance is sufficient — no second mixer is needed, matching CONTEXT.md's Claude's-Discretion assumption.

The one **load-bearing correction to CONTEXT.md's technical framing**: track names in this codebase's already-remapped clips are **not** `"head.quaternion"` — they are `"Normalized_<raw-node-name-from-the-loaded-VRM's-own-skeleton>.quaternion"`. `@pixiv/three-vrm-core`'s `VRMHumanoidRig._setupTransforms()` sets `rigBoneNode.name = "Normalized_" + boneNode.name`, where `boneNode.name` is whatever the *specific loaded VRM file* calls that bone internally (e.g. `J_Bip_C_Head`, `mixamorigHead`, `Head`, etc. — varies per model). A bone-filtering utility that does `track.name.startsWith("head")` will silently match nothing. The correct approach — already used by `remapMixamoAnimationToVrm.ts` itself — is to resolve `vrm.humanoid.getNormalizedBoneNode(vrmBoneName)?.name` for every bone in the D-01/D-02 lists, build a `Set` of the resulting node names, and filter `clip.tracks` against that set. This must happen **after** the VRM is loaded (per-model), which is already true of `processedClips`.

`THREE.AnimationUtils.subclip()` is **not** the right tool — it slices a clip by **time/frame range**, not by bone/track name (confirmed by reading `AnimationUtils.js::subclip`). The correct mechanism is manual `clip.tracks.filter(...)` + `new THREE.AnimationClip(name, duration, filteredTracks)`, which is exactly what the existing `remapMixamoAnimationToVrm.ts` pattern already does for a different purpose (Mixamo→VRM renaming) — the new utility is structurally a sibling of that file, not a novel technique.

Two real correctness risks were found that CONTEXT.md's decisions do not yet address and must be surfaced to the planner: (1) **AnimationClip UUID churn** — every `new THREE.AnimationClip(...)` call generates a fresh random UUID, so the filtered upper/lower sub-clips MUST be memoized (stable object identity across renders) or every render will silently leak a new `AnimationAction`+`PropertyMixer` pair and reset crossfade/weight state; (2) **cross-path bone conflict** — D-04's exempted "custom whole-skeleton" path (developer calls `animate('dance')`) plays an *unfiltered* clip that still contains `hips`/`spine`/leg tracks, which are the *same* track names the always-on base-lower action drives, so both actions will simultaneously contribute weight to the same `PropertyMixer` and produce an averaged/fighting pose unless the base-lower (and current upper) action's weight is dropped to 0 while a custom whole-skeleton animation is active.

**Primary recommendation:** Build one small utility, `filterClipTracksByBoneSet(clip, vrm, boneNames, name)`, that resolves normalized-bone-node names per the currently loaded VRM and filters `clip.tracks` by exact node-name match (not literal bone-name string match). Use it to derive a memoized `{ baseLower, upperByKey }` clip map from `processedClips` once per VRM load. Keep a single `mixerRef.current`, add two new refs (`baseActionRef`, `upperActionRef`) alongside the existing `currentActionRef`, and reuse the exact `.reset().fadeIn(0.3).play()` / `.fadeOut(0.3)` pattern already in `VRMAvatar.tsx` for the upper-layer swap — scoped to upper-filtered clips instead of whole-skeleton clips.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bone-set track filtering (`filterClipTracksByBoneSet`) | Browser / Client | — | Pure three.js `AnimationClip`/`KeyframeTrack` manipulation, runs in the browser alongside existing `remapMixamoAnimationToVrm` |
| Base/lower-body continuous action lifecycle | Browser / Client | — | `THREE.AnimationMixer`/`AnimationAction` state, lives entirely inside `VRMAvatar.tsx`'s refs |
| Upper-body layer crossfade (idle-upper ↔ gesture) | Browser / Client | — | Same mixer, same component; triggered by `chatStatus` context value already flowing from `KhaveeProvider` |
| `chatStatus` → animation key selection | Browser / Client | — | Existing `useEffect` in `VRMAvatar.tsx`; this phase only changes *how* the selected key is applied to the mixer, not how the key is chosen |
| Custom/non-status `animate()` whole-skeleton path (unchanged) | Browser / Client | — | Explicitly out of scope per D-04; existing `currentAnimation` effect stays as-is |
| Phase 10 procedural bone deltas (breathing/head/fingers) | Browser / Client | — | Unchanged; still applied post-`mixer.update()`, pre-`vrm.update()`, regardless of which action currently drives a given bone |

No backend/API/database tier is involved anywhere in this phase — it is 100% client-side rendering logic inside `packages/react/`.

## Standard Stack

### Core
| Library | Version (installed, verified) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `three` | 0.180.0 [VERIFIED: local `node_modules/three/package.json`] | `AnimationClip`, `AnimationMixer`, `AnimationAction`, `KeyframeTrack` — the entire animation-blending substrate | Already the project's only 3D/animation engine; no alternative under consideration |
| `@pixiv/three-vrm` (via `@pixiv/three-vrm-core@3.4.2`) | 3.4.2 [VERIFIED: local `node_modules/.pnpm/@pixiv+three-vrm-core@3.4.2.../package.json`] | `VRMHumanoid.getNormalizedBoneNode()`, normalized-rig bone naming | Already the project's only VRM runtime; the exact bone-naming behavior (`"Normalized_" + rawNodeName`) was read directly from its source and is load-bearing for this phase's design |

No new packages are required for this phase — it is implemented entirely with existing dependencies already in `package.json`. **Package Legitimacy Audit is not applicable** (no new external packages installed).

### Supporting
None required. No new library is needed for bone-set filtering — it is ~20 lines of `Array.filter` + a `Set` lookup, and the project's own conventions (see `remapMixamoAnimationToVrm.ts`) already do exactly this kind of track manipulation by hand rather than pulling in a dependency.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual `clip.tracks.filter()` + `new AnimationClip()` | `THREE.AnimationUtils.subclip()` | **Rejected** — `subclip` filters by time/frame range, not bone name; confirmed by reading its source (`AnimationUtils.js:182-251`). Using it would produce a clip trimmed to a time window, not a bone subset. Not viable for this phase's requirement. |
| Weight-based track filtering (author separate "upper-only"/"lower-only" clips at export time in Blender/Mixamo) | Runtime track filtering in JS | Export-time splitting is the AAA-engine-standard approach (also recommended in community discussion, see Sources) but requires re-authoring every existing FBX asset and adds an asset-pipeline step; CONTEXT.md's Non-scope explicitly excludes "re-authoring existing demo FBX clips" — runtime filtering is therefore the only viable option for this phase's scope. |
| `THREE.AdditiveAnimationBlendMode` (`makeClipAdditive` + `action.blendMode = AdditiveAnimationBlendMode`) | Disjoint-track normal-blend-mode layering (this research's recommendation) | Additive blend mode is for layering a *delta* animation (e.g. a wave gesture) on top of a *different* full-body animation without excluding any bones — it still requires per-track weight tuning to avoid double-counting the same bone, and is a fundamentally different technique (subtracting a reference pose) than "this action owns these bones, that action owns those bones." Not needed here since D-01/D-02 already partition all bones into two disjoint sets. |

**Installation:** None — no new packages.

## Architecture Patterns

### System Architecture Diagram

```
                    chatStatus (from KhaveeProvider context)
                              │
                              ▼
        ┌─────────────────────────────────────────────┐
        │  chatStatus auto-mapping effect (existing,   │
        │  VRMAvatar.tsx ~line 428)                    │
        │  selects: idle | listening | thinking |      │
        │  speaking-variant | keyword-matched key      │
        └───────────────────┬───────────────────────────┘
                            │  (NEW: branch by whether the
                            │   selected key came from THIS
                            │   effect — status-driven — or
                            │   from an external animate() call)
              ┌─────────────┴──────────────┐
              ▼                            ▼
  status-driven key                 external/custom key
  (idle/listening/thinking/         (animate('dance') etc.,
   speaking + variants/keywords)     D-04 exemption)
              │                            │
              ▼                            ▼
  ┌───────────────────────┐      ┌─────────────────────────┐
  │ UPPER-LAYER crossfade  │      │ EXISTING whole-skeleton  │
  │ effect (NEW)           │      │ currentAnimation effect  │
  │ upperActionRef.fadeOut │      │ (UNCHANGED, line 489)    │
  │ newUpperAction         │      │ currentActionRef.fadeOut │
  │   .reset().fadeIn(0.3) │      │ newAction.fadeIn(0.3)    │
  │   .play()              │      │   .play()                │
  └───────────┬────────────┘      └────────────┬─────────────┘
              │                                 │
              │   ⚠ MUST coordinate weight:     │
              │   base-lower + upper actions    │
              │   must drop to weight 0 while   │
              │   the whole-skeleton path is     │
              │   active (disjoint-track          │
              │   assumption breaks otherwise)    │
              ▼                                 ▼
        ┌────────────────────────────────────────────┐
        │        mixerRef.current (single mixer)      │
        │  ┌──────────────┐  ┌──────────────────────┐ │
        │  │ baseActionRef │  │ upperActionRef /      │ │
        │  │ (lower-body,  │  │ currentActionRef      │ │
        │  │ always weight │  │ (whichever path is    │ │
        │  │ 1, never      │  │ currently authoritative)│
        │  │ swapped)      │  │                        │ │
        │  └──────────────┘  └──────────────────────┘ │
        └───────────────────────┬────────────────────┘
                                 │ mixer.update(delta)
                                 ▼
        ┌────────────────────────────────────────────┐
        │ Phase 10 procedural bone deltas (UNCHANGED) │
        │ breathing(spine,chest) / head micro-move /  │
        │ nod / thinking-tilt / gaze / finger curl     │
        │ — applied per-bone via quaternion.multiply() │
        └───────────────────────┬────────────────────┘
                                 ▼
                         currentVrm.update(delta)
```

### Recommended Project Structure
```
packages/react/src/
├── VRMAvatar.tsx                          # add baseActionRef, upperActionRef, boneMaskedClips memo, new upper-layer crossfade effect
└── utils/
    ├── remapMixamoAnimationToVrm.ts        # unchanged
    ├── mixamoVRMRigMap.ts                  # unchanged (source of truth for bone name list)
    └── filterClipTracksByBoneSet.ts        # NEW — the bone-set track filter utility
```

### Pattern 1: Resolve bone names to actual track-name prefixes (per loaded VRM)

**What:** Given a list of VRM humanoid bone names (e.g. `["hips","spine",...]`), resolve each to the *actual* normalized rig node name for the currently loaded model, because that name is `"Normalized_" + <raw skeleton node name>`, which differs per VRM file.

**When to use:** Once per VRM load, memoized alongside `processedClips`.

**Example (grounded in installed source, not assumed):**
```typescript
// Source: read directly from node_modules/.pnpm/@pixiv+three-vrm-core@3.4.2.../lib/three-vrm-core.module.js
// VRMHumanoidRig._setupTransforms(): rigBoneNode.name = "Normalized_" + boneNode.name;
// => vrm.humanoid.getNormalizedBoneNode("head").name is NOT "head" — it is
//    "Normalized_<whatever the raw VRM skeleton calls its head node>" and
//    varies per avatar file. Filtering must resolve this per-model, not
//    hardcode a fixed prefix.

function getBoneTrackNodeNames(vrm: VRM, boneNames: string[]): Set<string> {
  const nodeNames = new Set<string>();
  for (const boneName of boneNames) {
    const node = vrm.humanoid?.getNormalizedBoneNode(boneName as any);
    if (node?.name) nodeNames.add(node.name);
  }
  return nodeNames;
}
```

### Pattern 2: Filter an already-remapped `AnimationClip` by bone set

**What:** Produce a new `AnimationClip` containing only the tracks whose leading node name (before the first `.`) is in the resolved bone-node-name set.

**Example:**
```typescript
// Source: pattern mirrors packages/react/src/utils/remapMixamoAnimationToVrm.ts's own
// `track.name.split(".")` convention (line 34) — consistent with existing codebase style.
// Confirmed against node_modules/three/src/animation/AnimationClip.js constructor
// (new AnimationClip(name, duration, tracks) — no track validation beyond storing them).

import * as THREE from "three";

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

  // IMPORTANT: pass the ORIGINAL clip.duration explicitly (do not call
  // resetDuration()). If base-lower and upper clips are both derived from
  // the same 'idle' source clip but their remaining tracks happen to have
  // slightly different last-keyframe times, resetDuration() would give them
  // different durations and the two loops would drift out of phase over time.
  return new THREE.AnimationClip(newName, clip.duration, filteredTracks);
}
```

### Pattern 3: Memoize filtered clips (prevents AnimationAction/PropertyMixer leak)

**What:** `new THREE.AnimationClip(...)` generates a fresh random `uuid` on every call (confirmed: `AnimationClip` constructor calls `generateUUID()` unconditionally — `AnimationClip.js:68`). `AnimationMixer.clipAction()` caches actions **by clip UUID** (`AnimationMixer.js:560, 577-595`). If the filtered clips are recreated every render (not memoized), every `.clipAction(filteredClip)` call creates a brand-new `AnimationAction` + set of `PropertyMixer`s that are never released — the old ones stay in `_actions`/`_bindings` as "inactive" entries indefinitely (only `uncacheClip`/`uncacheAction`/`uncacheRoot` release them), and `currentActionRef`-equivalent refs pointing at last render's action instance become stale, breaking crossfade continuity (each render appears to be "a different animation" to the mixer even though it's logically the same one).

**When to use:** Always — filtered clips must be produced inside a `useMemo` keyed on `[processedClips, currentVrm]`, exactly like the existing `processedClips` memo itself (`VRMAvatar.tsx:328`), not recomputed inside the render body or inside `useFrame`.

```typescript
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
    // Fallback (Claude's Discretion, non-Mixamo GLB edge case): if filtering
    // produced zero tracks, this clip's node names never matched our
    // resolved set (not a Mixamo-remapped clip) — mark unmaskable so the
    // caller can fall back to the old whole-skeleton path for this key.
    if (upperClip.tracks.length > 0) upperByKey[clip.name] = upperClip;
  });

  return { baseLower, upperByKey };
}, [processedClips, currentVrm]);
```

### Pattern 4: Crossfade the upper layer with the existing fade pattern

**What:** Reuse `.reset().fadeIn(0.3).play()` / `.fadeOut(0.3)` exactly as the existing `currentAnimation` effect does (`VRMAvatar.tsx:513, 510`), scoped to upper-only clips. `AnimationAction.fadeIn`/`fadeOut` schedule a weight-interpolant from the mixer's current global time (`AnimationAction.js:905-927`) — they do not require the action to already be playing, and calling `.play()` before or after `.fadeIn()` is equivalent since scheduling is time-based, not call-order-based (confirmed via source).

```typescript
// First-ever activation: snap to weight 1 immediately (no fadeIn), matching
// the existing pattern at VRMAvatar.tsx:515-518 (`else if (!currentActionRef.current)`).
// This avoids a partial-weight blend into the VRM's raw bind pose during the
// very first 0.3s, which would otherwise be visible as a brief "T-pose ghost"
// on cold start (see PropertyMixer.saveOriginalState()/apply() — Pitfall 1 below).
if (!upperActionRef.current) {
  newUpperAction.reset().play();
} else if (upperActionRef.current !== newUpperAction) {
  upperActionRef.current.fadeOut(0.3);
  newUpperAction.reset().fadeIn(0.3).play();
}
upperActionRef.current = newUpperAction;
```

### Anti-Patterns to Avoid
- **String-matching bone names directly against track names** (e.g. `track.name.startsWith("head")`): will silently match zero tracks because remapped track names are `"Normalized_<raw-name>.quaternion"`, not `"head.quaternion"`. Always resolve through `vrm.humanoid.getNormalizedBoneNode(boneName).name` first.
- **Recreating filtered `AnimationClip`s outside a memo**: leaks `AnimationAction`/`PropertyMixer` objects and breaks crossfade continuity every render.
- **Using `THREE.AnimationUtils.subclip()` for bone filtering**: it filters by time range, not bone/track name — wrong tool entirely.
- **Letting the base-lower action and a whole-skeleton custom action (D-04 path) both run at weight 1 simultaneously**: both will contribute to the same `hips`/`spine`/leg `PropertyMixer`s since the custom clip is unfiltered, producing a fighting/averaged pose. Must explicitly zero one side's weight while the other is authoritative.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Weighted blending between two simultaneously-playing partial-skeleton actions | A custom weight-accumulation system across bones | three.js's built-in `PropertyMixer` accumulation (already per-track, already correct for disjoint track sets — verified via source) | The engine already solves exactly this problem for free as long as the two clips' track sets are disjoint; no custom blending math is needed |
| Crossfading between two clips that share tracks (idle-upper ↔ gesture-upper) | Manual weight lerp in `useFrame` | `AnimationAction.fadeIn()`/`fadeOut()` (already used identically in the existing whole-skeleton effect) | Same API, same 0.3s value, zero new code pattern to learn or maintain |
| Resolving bone name → node name per VRM model | A hardcoded string map | `vrm.humanoid.getNormalizedBoneNode(boneName)` (VRM's own API, per-instance) | The mapping is inherently per-model (depends on the raw skeleton naming inside each specific `.vrm` file); a hardcoded map would only work for whichever demo avatar was tested against |

**Key insight:** Every piece of this phase's mechanism (disjoint-track blending, crossfading, bone-name resolution) already exists as a first-class three.js/`@pixiv/three-vrm` API. The entire phase is track-list *filtering* glue code (~30-40 lines) wired into two new `useRef`s and one new `useEffect` — there is no new blending algorithm to invent.

## Common Pitfalls

### Pitfall 1: First-frame "bind pose ghost" on cold start
**What goes wrong:** If the very first activation of `baseActionRef` or `upperActionRef` uses `.fadeIn(0.3)` instead of an immediate `.play()` at weight 1, the bone briefly blends toward the VRM's raw bind pose (T-pose-like) for the fraction of weight not yet covered by the fading-in action.
**Why it happens:** `PropertyMixer.apply()`: `if (weight < 1) { accuN += original * (1 - cumulativeWeight) }` (`PropertyMixer.js:212-220`). `original` is captured via `saveOriginalState()` the moment a binding is first lent out (`AnimationMixer.js:150-153`) — i.e. whatever pose the scene graph was in *before any action ever touched that bone*, which for a freshly-loaded VRM is the raw bind pose.
**How to avoid:** Mirror the existing code's own handling of this exact case (`VRMAvatar.tsx:515-518`, `else if (!currentActionRef.current)` branch calls `.reset().play()` with no fade) for both new action refs on their first-ever activation.
**Warning signs:** A visible brief "pop" or arms-out flash on the very first render before an animation is loaded.

### Pitfall 2: Cross-path bone ownership conflict (base-lower vs. whole-skeleton custom animation)
**What goes wrong:** When a developer calls `animate('dance')` (D-04's exempted whole-skeleton path), the resulting action plays an *unfiltered* clip that still contains `hips`/`spine`/leg tracks — the exact same track names the always-on base-lower action owns. Both actions then contribute weight to the same `PropertyMixer`s, producing an averaged/fighting pose instead of a clean full-body override.
**Why it happens:** The disjoint-track assumption that makes base+upper layering conflict-free only holds between the base-lower action and the *filtered* upper action — it does not hold against an *unfiltered* whole-skeleton action played through the D-04 exemption path.
**How to avoid:** When the whole-skeleton custom path becomes active (`currentActionRef` set to a non-status key), set `baseActionRef.current.weight = 0` and `upperActionRef.current.weight = 0` (or equivalent `setEffectiveWeight(0)`); restore both to `1` when returning to a status-driven key. This is not addressed by CONTEXT.md's decisions — flag as a design gap requiring an explicit decision (see Open Questions).
**Warning signs:** During a custom `animate('dance')` call, hips/legs appear to jitter between the dance pose and the idle pose instead of cleanly following the dance clip.

### Pitfall 3: Memoization boundary mismatch causes stale `AnimationAction` leaks
**What goes wrong:** If `filterClipTracksByBoneSet()` is called inside the render body, `useFrame`, or a differently-scoped `useMemo` than `processedClips`, a new `THREE.AnimationClip` (new UUID) is produced every time that scope re-runs, and `mixerRef.current.clipAction(newClipEachTime)` allocates a fresh `AnimationAction`/`PropertyMixer` set every time instead of reusing the cached one.
**Why it happens:** `AnimationMixer` caches actions by `clip.uuid`, and `AnimationClip`'s constructor always generates a new UUID unless explicitly copied (confirmed: no UUID-passing constructor overload exists).
**How to avoid:** Compute the filtered clip map in exactly one `useMemo`, dependency array `[processedClips, currentVrm]` — same lifecycle as the existing `processedClips` memo.
**Warning signs:** Memory growing over time (`mixerRef.current.stats.actions.total` climbing unbounded across re-renders); crossfades resetting to a full pop instead of smoothly blending because `upperActionRef.current !== newUpperAction` is always true even for "the same" animation key.

### Pitfall 4: Duration drift between base-lower and idle-upper sub-clips
**What goes wrong:** If the filtering utility calls `clip.resetDuration()` after filtering (recomputing duration purely from the remaining tracks), the base-lower and idle-upper sub-clips — both derived from the same source 'idle' clip — could end up with slightly different durations if some tracks' last keyframe times differ. Since both loop independently (`LoopRepeat`), they will slowly drift out of phase relative to each other over many loop iterations, even though they started from one coherent authored animation.
**Why it happens:** `AnimationClip.resetDuration()` takes `Math.max` over only the *remaining* tracks' last keyframe times (`AnimationClip.js:440-457`) — a subset of tracks does not necessarily share the exact same max time as the full clip.
**How to avoid:** Always pass the **original, unfiltered** `clip.duration` explicitly into `new THREE.AnimationClip(name, clip.duration, filteredTracks)` rather than letting it auto-compute (`duration = -1` triggers auto-calc per the constructor, `AnimationClip.js:78-83`).
**Warning signs:** Upper-body and lower-body idle motion visually "unsynced" after the avatar has been idle for an extended period (minutes), even though they look correct immediately after the avatar loads.

### Pitfall 5: Non-Mixamo GLB clips silently produce empty filtered clips
**What goes wrong:** A GLB animation whose track names were never routed through `remapMixamoAnimationToVrm` (arbitrary bone names, not `"Normalized_..."`-prefixed) will match zero entries in the resolved bone-node-name set, producing a filtered clip with `tracks.length === 0`. Playing a zero-track `AnimationAction` is not an error but does nothing.
**Why it happens:** The bone-node-name resolution in Pattern 1 only produces names that exist in the *current VRM's normalized humanoid rig* — a clip whose original tracks were never Mixamo-remapped won't share that naming scheme at all.
**How to avoid:** Explicit fallback check (already reflected in Pattern 3's example): if `upperClip.tracks.length === 0`, treat that animation key as unmaskable and fall back to the existing whole-skeleton crossfade for it (matches CONTEXT.md's Claude's Discretion guidance).
**Warning signs:** A status key mapped to a non-Mixamo GLB clip appears completely frozen/motionless when it should be animating.

## Code Examples

### Bone-set constants (derived from `mixamoVRMRigMap.ts`, union = full VRM humanoid bone set)
```typescript
// Source: derived 1:1 from packages/react/src/utils/mixamoVRMRigMap.ts values (D-01/D-02)
export const BASE_LOWER_BONES = [
  "hips", "spine",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
  "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
];

export const UPPER_BONES = [
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
// BASE_LOWER_BONES ∪ UPPER_BONES == every bone key in mixamoVRMRigMap's values
// (verified by manual cross-reference) — no bone is silently dropped from
// both filtered clips.
```

### Base-lower action: created once, always playing, never swapped
```typescript
// New effect, added near the existing mixer-init effect (VRMAvatar.tsx ~line 389)
useEffect(() => {
  if (!mixerRef.current || !boneMaskedClips?.baseLower || baseActionRef.current) return;

  const action = mixerRef.current.clipAction(boneMaskedClips.baseLower);
  action.reset().play(); // no fadeIn — first-ever activation (Pitfall 1)
  baseActionRef.current = action;
}, [boneMaskedClips]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Whole-skeleton `currentActionRef` crossfade on every `chatStatus` change (`VRMAvatar.tsx:489-521`) | Disjoint base-lower + upper-layer dual-action crossfade, scoped to status-mapped keys only | This phase (Phase 11) | Eliminates the full-body snap/jarring pose reset on every status transition; lower-body motion (idle sway/weight shift) continues uninterrupted through listening/thinking/speaking transitions |

**Deprecated/outdated:** Nothing in the underlying three.js/VRM API is deprecated here — `AnimationClip.parseAnimation()` is deprecated (per its own source JSDoc, `AnimationClip.js:301`) but is unrelated to this phase (used only for the legacy `animation.hierarchy` JSON format, not touched by this codebase).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Speaking-variant and keyword-matched animation keys selected *within* the existing `chatStatus` auto-mapping effect (not just the four literal status names) should also go through the new bone-masked upper-layer path, not the old whole-skeleton path | Architecture Patterns, Open Questions | If wrong, speaking-turn variety picks would still full-body-snap, only partially fixing the jarring-swap complaint the phase exists to solve. This is presented as a recommendation, not confirmed with the user in CONTEXT.md — flagged for planner/discuss-phase follow-up. |
| A2 | Setting `baseActionRef`/`upperActionRef` weight to `0` (rather than `.stop()`) is the correct way to cede control during a D-04 whole-skeleton custom animation | Common Pitfalls (Pitfall 2) | If wrong (e.g. `.stop()` is actually needed to avoid some other side effect), the recommended coordination code would need adjustment; this specific interaction is not covered by any three.js official doc found and is inferred from reading `AnimationAction.setEffectiveWeight()`/`_updateWeight()` source. |

## Open Questions

1. **Does bone masking apply to ALL animation keys selected inside the `chatStatus` auto-mapping effect, or only to the four literal status-name keys?**
   - What we know: D-04 says masking applies to "the four status-mapped keys' auto-triggered transitions... via the existing `chatStatus` auto-mapping effect." That same effect also picks random speak/talk/gesture variants and keyword-matched keys (e.g. `"agree"`, `"nod"`) when `chatStatus === "speaking"`.
   - What's unclear: Whether a variant/keyword pick (a key name that isn't literally `"speaking"`) should be treated as "status-driven" (bone-masked) or "custom" (whole-skeleton, D-04 exemption) — both readings of D-04's wording are plausible.
   - Recommendation: Treat any key selected *from within* the chatStatus auto-mapping effect as status-driven/bone-masked (this research's Assumption A1), since the entire phase's goal is eliminating the full-body snap during status transitions, and variant/keyword picks are still status-transition-triggered, not developer-invoked. Confirm with user during planning/discuss-phase if this reading is contested.

2. **How should the base-lower/upper actions coordinate with the D-04 whole-skeleton exemption path to avoid the cross-path bone conflict (Pitfall 2)?**
   - What we know: The conflict is real and confirmed via source-level reading of `PropertyMixer` accumulation — it is not a theoretical concern.
   - What's unclear: CONTEXT.md's decisions do not mention this interaction at all; it is an emergent consequence of layering the new mechanism into an existing component that still has an unmodified whole-skeleton path.
   - Recommendation: Add an explicit weight-zeroing coordination step (Pitfall 2's fix) as a required task in the plan, not an optional nice-to-have — without it, any developer who uses a non-status custom animation key will see broken lower-body motion.

3. **Should `currentAnimation` (the shared context value from `useKhavee()`) still reflect the active upper-body gesture key for status-driven transitions, given the whole-skeleton effect at line 489 will no longer be the thing driving the mixer for those keys?**
   - What we know: `animate()` in `KhaveeProvider.tsx` is a simple `setCurrentAnimation(name)` — a single flat state slot currently serves both the whole-skeleton effect's input AND any app-level UI that displays "current animation."
   - What's unclear: If status-driven transitions bypass the whole-skeleton effect entirely (recommended, to avoid double-driving bones), does `currentAnimation` still need to be updated for observability, or does a new context field need to be added?
   - Recommendation: Keep calling `animate(key)` for its state-tracking side effect (so `currentAnimation` stays observable) but branch the *mixer-driving* logic separately based on whether the key is a status-mapped key — i.e., decouple "what value does `currentAnimation` show" from "which effect actually drives the mixer." Confirm this doesn't conflict with any existing demo-app usage of `currentAnimation` during planning.

## Environment Availability

Not applicable in the "external dependency" sense — no new tools, services, or packages are introduced. For grounding, the two already-installed libraries this phase depends on were version-confirmed directly from the local filesystem:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `three` | AnimationMixer/AnimationClip/KeyframeTrack APIs | ✓ | 0.180.0 | — |
| `@pixiv/three-vrm` (`three-vrm-core`) | `VRMHumanoid.getNormalizedBoneNode()` | ✓ | 3.4.2 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Security Domain

This phase is a pure client-side rendering/animation-blending change with no network calls, no user input parsing, no authentication, and no data persistence. `security_enforcement` is not explicitly disabled in `.planning/config.json`, so this section is included per policy, but no ASVS category meaningfully applies.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A — no auth surface touched |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A |
| V5 Input Validation | No | Animation keys come from the developer's own `animations` prop (a trusted, developer-authored config object), not from untrusted runtime/user input |
| V6 Cryptography | No | N/A |

No known threat patterns for this stack apply to bone-masked animation blending — it is not an attack surface.

## Sources

### Primary (HIGH confidence — read directly from installed source)
- `node_modules/three/src/animation/AnimationMixer.js` (three@0.180.0) — `clipAction()`, `_bindAction()`, `update()`, per-(root,trackName) `PropertyMixer` caching
- `node_modules/three/src/animation/AnimationClip.js` (three@0.180.0) — constructor UUID generation, `resetDuration()`, `findByName()`
- `node_modules/three/src/animation/AnimationAction.js` (three@0.180.0) — `fadeIn()`/`fadeOut()`/`crossFadeTo()`/`_scheduleFading()`, weight/blendMode application in `_update()`
- `node_modules/three/src/animation/AnimationUtils.js` (three@0.180.0) — confirms `subclip()` is time/frame-based, not bone-based
- `node_modules/three/src/animation/PropertyMixer.js` (three@0.180.0) — `accumulate()`/`apply()`/`saveOriginalState()`, the exact mechanism proving disjoint-track actions don't conflict
- `node_modules/.pnpm/@pixiv+three-vrm-core@3.4.2_three@0.180.0/node_modules/@pixiv/three-vrm-core/lib/three-vrm-core.module.js` (three-vrm-core@3.4.2) — `VRMHumanoidRig._setupTransforms()`, confirms `"Normalized_" + boneNode.name` naming
- `packages/react/src/VRMAvatar.tsx` (this repo) — existing crossfade pattern, mixer lifecycle, chatStatus auto-mapping effect, useFrame ordering
- `packages/react/src/utils/remapMixamoAnimationToVrm.ts` (this repo) — confirms `${vrmNodeName}.${propertyName}` track-naming convention and the `track.name.split(".")` parsing convention
- `packages/react/src/utils/mixamoVRMRigMap.ts` (this repo) — canonical bone-name list used to derive BASE_LOWER_BONES/UPPER_BONES
- `packages/react/src/KhaveeProvider.tsx` (this repo) — confirms `animate()` is a flat `setCurrentAnimation()` call, informing Open Question 3
- `.planning/phases/10-avatar-animation-naturalness/10-CONTEXT.md` (this repo) — Phase 10's procedural-layer decisions and useFrame ordering constraints

### Secondary (MEDIUM confidence — WebSearch cross-verified against community consensus)
- [Should I build a custom animation mixer, or chop up Animation Clips? — three.js forum](https://discourse.threejs.org/t/advice-should-i-build-a-custom-animation-mixer-or-chop-up-animation-clips/69120) — independently corroborates that runtime/export-time track-filtering ("chop up the clips") is the standard community-recommended approach for upper/lower body separation, and explicitly warns against customizing `AnimationMixer` itself

### Tertiary (LOW confidence)
None — all findings in this document are either verified against locally installed source code or corroborated by a specific, checkable community discussion.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, versions confirmed from local `node_modules`
- Architecture: HIGH — core mixer/clip/action interaction verified by reading the actual shipped source, not training-data recall or docs alone
- Pitfalls: HIGH for Pitfalls 1/3/4/5 (directly traced through source); MEDIUM for Pitfall 2 (the conflict mechanism is HIGH-confidence-verified, but the *recommended fix* — weight-zeroing — is this research's synthesis, not something CONTEXT.md or an official doc prescribes; flagged as Assumption A2)

**Research date:** 2026-07-01
**Valid until:** 2026-08-01 (30 days — `three`/`@pixiv/three-vrm` animation internals are stable APIs, unlikely to change; re-verify only if either package is upgraded before implementation)
