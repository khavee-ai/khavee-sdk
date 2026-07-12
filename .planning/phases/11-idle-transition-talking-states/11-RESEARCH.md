# Phase 11: Idle, Transition & Talking States - Research

**Researched:** 2026-07-12
**Domain:** Ref-driven procedural bone/expression animation layered on an existing three.js `AnimationMixer`, composed additively across a shared `chatStatus`-driven state engine (React + React Three Fiber + `@pixiv/three-vrm`)
**Confidence:** HIGH (all core claims verified by direct codebase/asset inspection — GLB clip names parsed from the actual binary, VRM bone names parsed from 4 actual `.vrm` files, all cited source files read in full)

## Summary

Phase 11 adds three procedural/state systems on top of Phase 10's shared animation module (`packages/react/src/animation/{types,crossfade,blink,AnimationStateEngine}.ts`): (1) an always-on idle base (breathing + weight-shift sway, VRM-only expression drift), (2) dedicated `starting`/`stopped` clips with a minimum-duration floor, and (3) loop-boundary-driven talk-clip cycling with audio-reactive procedural amplitude. All three extend `useAnimationController`'s single `update(delta)` body — the insertion point is already commented in `AnimationStateEngine.ts` ("an obvious insertion point for Phase 11's additive bone-delta layer").

Two engineering realities, both **newly verified this session and not previously documented in CONTEXT.md**, materially affect how this phase must be planned:

1. **`AvatarFormatAdapter.getBoneNode(name)` is a literal scene-graph name lookup, not a VRM-humanoid-normalized lookup**, and this project's own bundled VRM assets use three different literal bone-name conventions for the same humanoid role (`"chest"`, `"Chest"`, `"J_Bip_C_Chest"` across 4 sampled models). Breathing/sway code that calls `getBoneNode("chest")` will silently no-op (return null, do nothing) on `male.vrm` (the demo default), which uses `"J_Bip_C_Chest"`. The planner must route VRM bone resolution through `vrm.humanoid.getNormalizedBoneNode(name)` (using VRM humanoid bone-name strings `"hips"`/`"spine"`/`"chest"`/`"upperChest"`/`"neck"`/`"head"`), not through the existing literal-name adapter method, or must extend the adapter contract to support both.
2. **`currentVolume` plumbing gap is real and confirmed**: `KhaveeContextType` (in `KhaveeProvider.tsx`) has no `currentVolume` field at all. It exists only inside `useRealtime()`'s local `useState`. `VRMAvatar`/`GLBAvatar` (where the procedural amplitude scaling must run, inside the shared `useFrame`) read `chatStatus` via `useKhavee()`, never via `useRealtime()` directly — adding `currentVolume` to `KhaveeContextType` and having `KhaveeProvider` subscribe to `realtimeProvider.onVolumeChange` (mirroring the existing `onChatStatusChange` subscription pattern at `KhaveeProvider.tsx:108-112`) is new, non-trivial plumbing this phase must build.

Asset-mapping verification (CONTEXT.md's flagged open items) is now fully resolved by direct inspection, not inference: exact GLB clip names, exact VRM animation directory contents, and the exact speaking-regex mismatch are all confirmed below with tool output, not assumption.

**Primary recommendation:** Extend `useAnimationController`'s `update(delta)` with three new ref-driven procedural steps (breathing, sway, expression-drift) plus a talk-cycle state machine and a `starting`/`stopped` minimum-duration floor via `beginCrossfade`'s existing (currently unused) `floorSeconds` parameter — composing all spine-bone writers via `bone.quaternion.multiply(deltaQuat)` in a fixed order, never `.set()`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Breathing/sway procedural bone deltas | Browser/Client (R3F `useFrame`) | — | Pure per-frame client-side rendering math; no server involvement, matches existing blink pattern |
| Expression rest-state drift (VRM) | Browser/Client (R3F `useFrame`) | — | Same as above; gated on `adapter.getExpressionManager()` non-null |
| `starting`/`stopped` dedicated clips + duration floor | Browser/Client (crossfade engine) | — | Extends Phase 10's `beginCrossfade`/`stepCrossfade`, already client-side |
| Talk-clip cycling (loop-boundary detection) | Browser/Client (R3F `useFrame`, reads `AnimationAction.time`/`getClip().duration`) | — | No server signal needed; loop boundary is a local mixer-state read |
| Audio-reactive amplitude signal | Browser/Client (reads `currentVolume`) → **API/Backend boundary** | API/Backend (`OpenAIRealtimeProvider.onVolumeChange`, already shipped) | The volume *source* is the realtime provider (audio decode happens off-main-thread via WebRTC/AudioContext); the *consumption* (scaling procedural amplitude) is 100% client-side. This phase only touches the client-side consumption + a new context-plumbing seam — no provider-package changes (out of scope per REQUIREMENTS.md "Out of Scope" table) |
| `currentVolume` context plumbing | Browser/Client (`KhaveeProvider` React context) | — | Pure state-lifting within the existing provider; no new API surface, no backend change |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IDLE-01 | `ready`/`stopped` base has randomized-range procedural breathing (chest/spine) and independent weight-shift sway (hip/spine) | Bone-resolution pitfall (below) is the critical blocker to solve first; `blink.ts` is the reference ref-driven pattern; `PERFORMANCE-BUDGET.md` §1-§4 sizes cost and gives the additive-composition technique |
| IDLE-02 | VRM gets 1-2 expression rest-state drift values; GLB gets none | `adapter.getExpressionManager()` null-check (already the gating mechanism `blink.ts` uses) is the correct, already-proven no-op-on-GLB pattern — no new mechanism needed |
| TRANS-01 | `starting` plays a dedicated greeting clip, ~1.0-1.5s min duration floor even if pose-gap alone resolves faster | `beginCrossfade(fromAction, toAction, scene, floorSeconds)` already accepts `floorSeconds` — verified unused by any current call site (`AnimationStateEngine.ts`'s `useAnimationController` calls `beginCrossfade(currentActionRef.current, toAction, root)` with no 4th arg). GLB's `'State 3 Welcome (loop)'` clip is a verified candidate; VRM has no candidate clip at all (see Pitfall: VRM asset gap) |
| TRANS-02 | `stopped` plays a distinct dedicated goodbye clip, same duration floor | No usable candidate clip exists in either bundled asset set (VRM: none; GLB: no clip name matches `/stop\|bye\|goodbye\|outro/i`) — this is a genuine, D-01-acknowledged asset gap, not a wiring gap |
| TALK-01 | `speaking` cycles 2+ talk-clip variants at loop-completion boundaries only, ~2s min dwell, no `setInterval`/`setTimeout` | VRM has 2 real candidates (`talking.fbx`, `talking1.fbx`) once loaded via the demo's `AnimationConfig` (both already match the existing `/talk\|gesture\|speak/i` pattern). Current `resolveBaseClip` uses `.find()`, which returns only the *first* match and never cycles — this is the concrete gap TALK-01 closes. GLB has only 1 usable speaking-adjacent clip (`'State 4 Taking (loop)'`, and it doesn't match the regex at all — see Pitfall below) |
| TALK-02 | Live volume signal scales procedural motion amplitude during `speaking` only, never affects clip selection/timing | `currentVolume` plumbing gap (Summary #2) must be closed first; source is `useRealtime()`'s `currentVolume` (fed by `OpenAIRealtimeProvider.onVolumeChange`), per CONTEXT.md D-02 — confirmed correct, `useAudioLipSync` has no live volume scalar |
| PERF-01 | Same-bone procedural systems compose via additive delta-quaternion `multiply()`, fixed order, bounded magnitude — not `.set()`/overwrite | `PERFORMANCE-BUDGET.md` §4 gives the exact technique and cites Unity/Unreal additive-layer prior art; crossfade.ts's existing scratch-quaternion pattern (`qLive`/`qTarget` allocated once, reused) is the allocation-reuse precedent to mirror |

## Project Constraints (from CLAUDE.md)

- **Naming:** Interfaces PascalCase, no `I` prefix (matches existing `AvatarFormatAdapter`). Functions/methods camelCase. Boolean refs/flags prefixed `is`/`has`/`enable` (matches existing `isBlinking`). New orchestrator-shaped exports (if any) PascalCase.
- **Error handling:** Defensive early-return over throw for "expected, recoverable" conditions (missing bone, missing clip, adapter returning null) — matches `blink.ts`'s `if (!expressionManager) return;` and `AnimationStateEngine.ts`'s `if (!targetName || !toAction) return;`. Do not introduce new `try/catch` for synchronous bone/expression lookups.
- **Comments:** File-header block comments explaining role + non-obvious lifecycle/timing constraints (see every existing file under `packages/react/src/animation/`). Inline comments citing "why" for non-obvious ordering (e.g. why breathing must run before sway in the fixed composition order). No decorative/emoji logging in SDK package code (reserved for mock/demo-only code) — this rules out the emoji-prefixed `console.log` style seen in `GLBAvatar.tsx`'s existing `[GLB Avatar]` logs as a pattern to extend.
- **No cross-package relative imports** — n/a for this phase (all new code is internal to `packages/react/src/animation/`).
- **TypeScript strict mode** — no implicit `any`; exhaustive null checks required (directly relevant: `getBoneNode`/`getExpressionManager` both return nullable types that must be checked before use, matching `blink.ts`'s existing gate).
- **Internal module convention:** New procedural-system files must NOT be added to `packages/react/src/index.ts`'s exports — matches Phase 10's established internal-only convention for everything under `animation/`.

## Standard Stack

No new external packages are required for this phase. All work is pure application code against already-installed dependencies:

| Library | Installed Version | Purpose | Why No New Package Needed |
|---------|-------------------|---------|---------------------------|
| `three` | ^0.180.0 (npm registry current: 0.185.1) | `THREE.Quaternion` (multiply/slerp/setFromAxisAngle), `THREE.Object3D` bone traversal | Breathing/sway/drift are pure trig + quaternion composition against the existing scene graph — no new geometry/animation library needed |
| `@pixiv/three-vrm` | ^3.4.2 (npm registry current: 3.5.5) | `VRMHumanoid.getNormalizedBoneNode(boneName)`, `VRMExpressionManager` | Required for the bone-resolution fix (see Pitfall below) — already a direct dependency, no version bump needed for this API (present since VRM 1.0-era three-vrm releases) |
| `@react-three/fiber` | ^9.3.0 | `useFrame` (already the call site both `update(delta)` steps run inside) | No new R3F APIs needed |

**Package Legitimacy Audit:** Not applicable — no new packages installed this phase.

## Architectural Responsibility Map — see above (moved earlier per template ordering; duplicated section removed)

## Architecture Patterns

### System Architecture Diagram

```
chatStatus (from useKhavee())
        │
        ▼
resolveBaseClip(chatStatus, currentAnimation, availableNames)   [existing, Phase 10]
        │  target clip name changes
        ▼
beginCrossfade(from, to, root, floorSeconds?)                    [existing; floorSeconds NEW this phase for TRANS-01/02]
        │
        ▼
┌─────────────────────────── useFrame(delta) ───────────────────────────┐
│  1. mixer.update(delta)              [existing, owned by component]   │
│  2. stepCrossfade(blend)             [existing, Phase 10]             │
│  3. blink.step(adapter, enabled)     [existing, Phase 10]             │
│  4. NEW: breathing.step(adapter, delta)   → writes spine/chest quat   │
│  5. NEW: sway.step(adapter, delta)        → writes spine/hip quat    │
│           (4+5 compose via delta.multiply() in fixed order — PERF-01) │
│  6. NEW: expressionDrift.step(adapter, delta)  [VRM-only, no-op GLB]  │
│  7. NEW: talkCycle.step(adapter, chatStatus, delta)                   │
│           → on loop-completion boundary AND ≥2s dwell, may trigger    │
│             a new beginCrossfade() to the next talk-clip variant      │
│  8. NEW: audioReactiveAmplitude.step(currentVolume, chatStatus)       │
│           → scales output magnitude of steps 4/5/7's procedural part  │
│             ONLY while chatStatus === "speaking"; never touches       │
│             clip selection (talkCycle owns that, independently)       │
│  9. vrm.update(delta)                [existing, VRM only]             │
└─────────────────────────────────────────────────────────────────────┘
        ▲
        │  currentVolume (NEW plumbing this phase)
KhaveeProvider ◄── realtimeProvider.onVolumeChange ◄── OpenAIRealtimeProvider
        │
        ▼
useKhavee().currentVolume  (read by VRMAvatar/GLBAvatar, passed into controller)
```

### Recommended Project Structure

Per CONTEXT.md's "Claude's Discretion" note, module boundaries beyond `animation/` are the planner's call. Given `blink.ts`'s precedent (one small file per procedural concern) and PERF-01's requirement that spine-touching systems share one fixed composition order, a reasonable split:

```
packages/react/src/animation/
├── types.ts                # existing — AvatarFormatAdapter; may need a new
│                            #   getHumanoidBoneNode()-style method or an
│                            #   extended getBoneNode() (see Pitfall below)
├── crossfade.ts             # existing — beginCrossfade's floorSeconds param
│                            #   is already there, just needs a caller
├── blink.ts                 # existing — untouched, reference pattern
├── breathing.ts              # NEW — chest/spine sine cycle
├── sway.ts                   # NEW — hip/spine sine cycle, independent period
├── expressionDrift.ts        # NEW — VRM-only, gated on getExpressionManager()
├── talkCycle.ts               # NEW — loop-boundary detection + variant selection
│                            #   (TALK-01); reads AnimationAction.time vs.
│                            #   getClip().duration, never setInterval/setTimeout
├── AnimationStateEngine.ts   # existing — update(delta) grows to call all of
│                            #   the above in the fixed documented order
```

### Pattern 1: Bone resolution — the getBoneNode gap (VERIFIED, critical for IDLE-01)

**What:** `AvatarFormatAdapter.getBoneNode(name)` is implemented identically in both avatars as a literal scene-graph name lookup:
```typescript
// VRMAvatar.tsx:448
getBoneNode: (name) => scene?.getObjectByName(name) ?? null,
// GLBAvatar.tsx:144
getBoneNode: (name) => groupRef.current?.getObjectByName(name) ?? null,
```
This is correct for `crossfade.ts`'s use case (`computePoseGapAngle` extracts literal bone names directly from `AnimationClip` track names, e.g. `"J_Bip_C_Chest.quaternion"`, so a literal lookup is exactly right there).

**Why it breaks breathing/sway if reused naively:** VRM bone *literal scene names* are not standardized — they vary per model/rig export tool. Verified directly against 4 of this project's bundled `.vrm` files by parsing each file's `extensions.VRM.humanoid.humanBones` and resolving the `chest` role's target node name:

| VRM file | Literal scene node name for the "chest" humanoid role |
|---|---|
| `public/models/male.vrm` (the demo/default avatar, used by `src/app/openai-avatar-test/page.tsx`, `src/app/generic-demo/page.tsx`, `src/app/vrm-avatar-test/page.tsx`) | `J_Bip_C_Chest` |
| `public/models/blacknwhitecat.vrm` | `chest` |
| `public/models/amongus.vrm` | `Chest` |
| `public/models/male/nongkhavee_male_01.vrm` | `J_Bip_C_Chest` |

A hardcoded `getBoneNode("chest")` call would find `blacknwhitecat.vrm`'s bone, silently return `null` (no-op, not an error) on `male.vrm` — the actual default demo avatar — and fail case-sensitively on `amongus.vrm`. **This means a naive implementation would ship with breathing/sway silently doing nothing on the project's own default avatar**, discoverable only by visual inspection, not by any type error or exception.

**GLB does not have this problem** — `happy.glb`'s embedded skeleton uses plain literal names that already match the semantic role directly: verified node names include `chest`, `spine`, `hips`, `neck`, `head` (parsed from the GLB's `nodes[].name` array). `getBoneNode("chest")` works correctly today on GLB with no changes.

**Recommended fix (for the planner to decide the exact shape of):** For VRM, resolve bones through `vrm.humanoid.getNormalizedBoneNode(vrmHumanBoneName)` instead of (or as a fallback path inside) the literal `getBoneNode`. The VRM humanoid bone-name strings this codebase already uses elsewhere (`remapMixamoAnimationToVrm.ts`'s `mixamoVRMRigMap` target values) are: `"hips"`, `"spine"`, `"chest"`, `"upperChest"`, `"neck"`, `"head"` — these are stable across every VRM model regardless of literal node naming, by VRM spec design. Options, not decided here (Claude's Discretion / planner's call):
  1. Extend `AvatarFormatAdapter` with a new method (e.g. `getHumanoidBoneNode(role: "hips" | "spine" | "chest" | ...): THREE.Object3D | null`), implemented via `vrm.humanoid.getNormalizedBoneNode()` on VRM and via a small literal-name lookup table on GLB (since GLB has no humanoid schema, but this project's `happy.glb` happens to already use the exact matching literal names).
  2. Make the *existing* `getBoneNode(name)` try `vrm.humanoid.getNormalizedBoneNode(name)` first (when the name matches one of VRM's known humanoid role strings) and fall back to `scene.getObjectByName(name)` — non-breaking because humanoid role strings (`"chest"`, `"spine"`, etc.) never collide with typical prefixed literal node names, but *would* collide on models like `blacknwhitecat.vrm` whose literal names ARE the humanoid role strings (harmless collision — resolves to the same bone either way).

Either approach must be validated against **`male.vrm` specifically**, since that is the demo/default avatar and the one most likely to be used for phase verification.

### Pattern 2: `beginCrossfade`'s `floorSeconds` — already built, just unused (TRANS-01/02)

`crossfade.ts`'s `beginCrossfade` and `poseGapToDuration` both already accept an optional `floorSeconds` parameter, added in Phase 10 specifically as "Forward-compatibility hook for Phase 11's TRANS-01/02 `starting`/`stopped` minimum-duration floors (~1.0-1.5s)":

```typescript
// crossfade.ts:74 (existing, unused by any current call site)
export function poseGapToDuration(maxAngleRad: number, floorSeconds?: number): number {
  const minDuration = 0.3;
  const maxDuration = 0.9;
  const maxExpectedAngle = Math.PI / 2;
  const t = THREE.MathUtils.clamp(maxAngleRad / maxExpectedAngle, 0, 1);
  const duration = THREE.MathUtils.lerp(minDuration, maxDuration, t);
  return floorSeconds !== undefined ? Math.max(duration, floorSeconds) : duration;
}
```

Verified: `AnimationStateEngine.ts`'s `useAnimationController` currently calls `beginCrossfade(currentActionRef.current, toAction, root)` with **no 4th argument** — this is the exact insertion point. TRANS-01/02 requires the controller to pass `floorSeconds: 1.0` to `1.5` when `chatStatus === "starting"` or `"stopped"` (exact value within that range is Claude's Discretion, unlocked by CONTEXT.md).

### Pattern 3: Additive composition — verified allocation-reuse precedent to mirror

`crossfade.ts`'s `computePoseGapAngle` already establishes the exact allocation-reuse pattern PERF-01 requires, just for a different purpose (pose-gap measurement, not composition):

```typescript
// crossfade.ts:41-59 (existing) — scratch quaternions declared ONCE per call,
// not per-track-iteration. Breathing/sway/drift should mirror this: module-
// or ref-scoped scratch THREE.Quaternion, never `new` inside useFrame.
export function computePoseGapAngle(scene, toClip) {
  const qLive = new THREE.Quaternion();
  const qTarget = new THREE.Quaternion();
  let max = 0;
  for (const track of toClip.tracks) {
    // ... qLive.copy(bone.quaternion); qTarget.set(...); ...
  }
  return max;
}
```

The additive composition pattern itself (not yet in the codebase, net-new for Phase 11):
```typescript
// Illustrative shape, not a locked implementation — module-scoped scratch,
// applied AFTER mixer.update()/stepCrossfade() have set the bone's
// post-mixer base orientation, BEFORE vrm.update(delta).
const _deltaQuat = new THREE.Quaternion(); // module-scoped, reused every frame

function applyBreathingDelta(bone: THREE.Object3D, phase: number, amplitude: number) {
  _deltaQuat.setFromAxisAngle(X_AXIS, Math.sin(phase) * amplitude);
  bone.quaternion.multiply(_deltaQuat); // additive — NOT bone.quaternion.set(...)
}
```
Fixed order (breathing → sway → audio-reactive scale, or any other planner-chosen fixed order) must be documented inline as a comment at the call site in `AnimationStateEngine.ts`'s `update(delta)`, per PERF-01's "fixed, documented order" requirement.

### Anti-Patterns to Avoid

- **`.set()`/`.copy()` overwrite on a bone touched by more than one procedural system** — this is the exact anti-pattern PERF-01 exists to prevent (last-write-wins silently discards the other system's contribution). Always `.multiply(deltaQuat)`.
- **`setInterval`/`setTimeout` for talk-clip cycling** — this is the exact pattern Phase 10 already removed from `GLBAvatar.tsx` (the old `3000 + Math.random() * 2000` ms loop-back timer, fully reproduced in `10-PATTERNS.md`). TALK-01 explicitly requires loop-completion-driven switching instead — detect via `AnimationAction.time` approaching `action.getClip().duration` (or `AnimationMixer`'s `"finished"` event for non-looping actions), not a wall-clock timer.
- **`new THREE.Quaternion()`/`new THREE.Euler()` inside `useFrame`** — allocates every frame, defeats GC-avoidance; `PERFORMANCE-BUDGET.md` §4 and the existing `crossfade.ts` precedent both establish module-/ref-scoped scratch objects as the required pattern.
- **Converting any new ref to `useState`** — `blink.ts`'s inline comment (preserved verbatim from `VRMAvatar.tsx`) documents exactly why: a state setter firing every frame during active motion fights the R3F render loop. All new breathing/sway/drift/talk-cycle bookkeeping must be `useRef`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Detecting when a looping `AnimationAction` completes a cycle | A manual time-accumulator comparing against a guessed clip duration | `THREE.AnimationAction`'s own `.time` (current playback position within the clip) compared against `.getClip().duration`, or the mixer's native `"loop"` event (`mixer.addEventListener("loop", ...)`, fired once per loop completion for `LoopRepeat`-mode actions) — three.js's `AnimationMixer` already dispatches this | Reimplementing loop-boundary detection risks drift from the mixer's actual internal loop-counting (which handles `LoopOnce`/`LoopRepeat`/`LoopPingPong` differently) — the native event is authoritative and already exists |
| VRM humanoid bone resolution | A custom name-guessing/fuzzy-match table across observed naming conventions (`J_Bip_C_*`, bare, capitalized, etc.) | `vrm.humanoid.getNormalizedBoneNode(vrmHumanBoneName)` (`@pixiv/three-vrm`'s own, spec-compliant API — already used elsewhere in this codebase, `remapMixamoAnimationToVrm.ts:26`) | The VRM 0.x/1.0 spec mandates every conformant VRM file publish a `humanBones` mapping; `three-vrm` already parses and exposes it. A custom guessing table would be strictly worse and still wrong on the next arbitrary VRM file a consumer loads |
| Ease/interpolation curves for the duration-floor crossfade | A new easing function | The existing `easeInOutCubic` in `crossfade.ts` — `beginCrossfade`/`stepCrossfade` already apply it; `floorSeconds` only changes the *duration*, not the curve shape | No new curve is needed; XFADE-01's locked easing choice already covers TRANS-01/02's transitions |

**Key insight:** Every "don't hand-roll" item above already has a working, spec-compliant or codebase-proven mechanism sitting one layer below the naive approach — the risk in this phase is reaching for a plausible-looking custom solution (timer-based loop detection, name-guessing bone tables) when three.js/three-vrm already solved the exact problem correctly.

## Common Pitfalls

### Pitfall 1: `getBoneNode` literal-name lookup silently no-ops on the default VRM avatar
**What goes wrong:** Breathing/sway appear to do nothing when tested against `male.vrm` (this project's demo default), even though the exact same code visibly works against `blacknwhitecat.vrm`.
**Why it happens:** `getBoneNode("chest")` returns `null` on any model whose literal chest-bone node name isn't exactly `"chest"` — confirmed `male.vrm` uses `"J_Bip_C_Chest"`. `null` is a silent, expected return value per the adapter's own contract (not an error), so nothing surfaces the failure except visual absence of motion.
**How to avoid:** Resolve VRM bones via `vrm.humanoid.getNormalizedBoneNode()`, not the literal adapter method (see Architecture Pattern 1).
**Warning signs:** Breathing/sway work in a quick manual test against one bundled VRM file but not another; code review shows a hardcoded literal bone-name string passed to `getBoneNode`.

### Pitfall 2: `'State 4 Taking (loop)'` does not match the speaking regex — GLB has no working speaking clip today
**What goes wrong:** Assuming GLB's speaking state "just works" because a talk-adjacent clip name exists in `happy.glb`.
**Why it happens:** `STATUS_CLIP_PATTERNS.speaking` is `/talk|gesture|speak/i` (verified verbatim, `AnimationStateEngine.ts:33`). `"State 4 Taking (loop)"` contains `"Taking"`, not `"Talking"` — the substring `"talk"` does not appear (`T-a-k-i-n-g` vs. `t-a-l-k`). Confirmed programmatically: the regex does not match this exact string. This also is not fixable by the `/gesture|speak/i` alternatives — neither appears either.
**How to avoid:** This is very likely a source-asset typo ("Taking" vs. "Talking"), but per CONTEXT.md D-01 this phase does not re-litigate asset sourcing. Three options, planner's call: (a) extend the regex to also match `/\btaking\b/i` as a documented one-off accommodation for this specific placeholder asset (with an inline comment explaining why), (b) leave GLB's speaking state falling back to `currentAnimation`/first-available (current, correct-per-D-01 behavior — GLB speaking would show whatever `ready`'s base clip resolves to, no dedicated talk motion), or (c) manually wire `'State 4 Taking (loop)'` as GLB's speaking clip via the consuming app's own `animate()` call rather than automatic pattern-matching. Do not assume it silently works without picking one of these.
**Warning signs:** GLB avatar shows no distinct clip change when `chatStatus` becomes `"speaking"`.

### Pitfall 3: GLB's `ready`/idle base resolves to `"Pose"`, not `"State 1 Idle (loop)"`, by default
**What goes wrong:** `IDLE-01`'s "left idle for 30+ seconds" verification is performed against whatever clip is actually playing in the `ready` state — which, on `happy.glb` with zero explicit `animate()` calls from the consuming app, is **not** the idle-loop clip.
**Why it happens:** `resolveBaseClip` has no `STATUS_CLIP_PATTERNS` entry for `"ready"` (verified — the table only has `speaking`/`listening`/`thinking`/`starting`/`stopped`), so it always falls through to `currentAnimation ?? availableNames[0] ?? null`. `KhaveeProvider`'s `currentAnimation` state is initialized to the literal string `"idle"` (verified, `KhaveeProvider.tsx:89`), which does not match any of `happy.glb`'s 8 real clip names (`"Pose"`, `"State 1 Idle (loop)"`, `"State 2 present (loop)"`, `"State 3 Welcome (loop)"`, `"State 4 Taking (loop)"`, `"State 5 listening (loop)"`, `"Walk"`, `"Walk.001"` — confirmed by parsing the GLB binary directly). Since `getAction("idle")` returns `null` for GLB, `useAnimationController`'s crossfade-trigger effect early-returns and never starts a crossfade at all — leaving whichever clip `GLBAvatar`'s own separate `autoPlayAnimation` effect played on mount, which defaults to `names[0]` = `"Pose"` (the first entry in `gltf.animations`, confirmed by parsing order).
**How to avoid:** This is a pre-existing rough edge, not introduced by Phase 11, but it directly affects whether IDLE-01's breathing/sway is verifiably layered on a *moving* idle-loop base vs. a static `"Pose"` clip. Two options for the planner: (a) add a `ready` entry to `STATUS_CLIP_PATTERNS` (e.g. `/idle|ready|rest/i`) so `"State 1 Idle (loop)"` auto-resolves the same way `listening`/`thinking`/etc. already do, or (b) treat it as out of scope and note in the plan that IDLE-01 verification against the GLB default requires the consuming app to explicitly `animate('State 1 Idle (loop)')` once on mount. On VRM, this same fallback chain happens to work correctly today only because the demo app's `AnimationConfig` key is coincidentally named `"idle"` exactly (`src/app/openai-avatar-test/page.tsx:35`) — a fragile, naming-coincidence-dependent correctness, not a guaranteed one for other consumers.
**Warning signs:** GLB avatar shows a static/frozen pose during `ready` with no idle-loop motion at all, even before breathing/sway are layered on.

### Pitfall 4: `resolveBaseClip`'s `.find()` never cycles — TALK-01's core gap, already confirmed
**What goes wrong:** Assuming the existing speaking-state resolution already does *some* variant switching that just needs a timer swapped out.
**Why it happens:** `resolveBaseClip`'s pattern-match branch is `availableNames.find((name) => pattern.test(name))` — `Array.prototype.find` always returns the **first** match and never advances. With VRM's demo config (`talking.fbx`, `talking1.fbx`, both matching `/talk/i`), this always resolves to whichever one appears first in `availableNames` — permanently, never the second one.
**How to avoid:** TALK-01's loop-boundary-driven cycling needs new state (an index or last-played-clip ref) that `resolveBaseClip`'s pure-function pattern-match cannot hold — this needs to live in `useAnimationController`'s stateful body (a `useRef`), not in `resolveBaseClip` itself, and must trigger `beginCrossfade` to the next variant only on a detected loop-completion + minimum-dwell condition (never every render).
**Warning signs:** Only one of the two available VRM talk clips is ever observed playing during an extended `speaking` session.

### Pitfall 5: `currentVolume` is not readable from `useKhavee()` today
**What goes wrong:** Code inside `VRMAvatar`/`GLBAvatar`'s `useFrame` (where TALK-02's amplitude scaling must run) attempts `useKhavee().currentVolume` and gets `undefined`/a type error, because it isn't part of `KhaveeContextType`.
**Why it happens:** Confirmed by reading `KhaveeProvider.tsx` in full — `currentVolume` exists only as local `useState` inside `useRealtime()` (`useRealtime.ts:25`, updated via `provider.onVolumeChange = (volume) => setCurrentVolume(volume);` at line 106). `useRealtime()` is a separate hook a consuming app calls at its own top level (per its own doc comment, "Hook for real-time chat"); it is not a descendant-accessible context value the way `chatStatus`/`currentAnimation` are.
**How to avoid:** `KhaveeProvider` must independently subscribe to `realtimeProvider.onVolumeChange`, mirroring its existing `onChatStatusChange` subscription (`KhaveeProvider.tsx:107-112`: `useEffect(() => { if (realtimeProvider) { realtimeProvider.onChatStatusChange = setChatStatus; } }, [realtimeProvider]);`), storing the value in new local state, and exposing it on `KhaveeContextType`. Note the existing `onChatStatusChange` wiring is a direct assignment (`provider.onChatStatusChange = setChatStatus`), which would **overwrite** whatever `useRealtime()` also assigns to the same callback if both hooks are used together in the same tree — `useRealtime.ts`'s own effect (lines 67-71) already defends against this exact collision for `onChatStatusChange`/`onError` by preserving and chaining the "upstream" callback before overwriting. Any new `onVolumeChange` wiring in `KhaveeProvider` should apply the same chaining precaution if `useRealtime()` is expected to coexist with it (`useRealtime.ts:106` currently does a bare, non-chaining assignment to `onVolumeChange` too — worth flagging to the planner as a related, pre-existing collision risk on the `useRealtime()` side, not something this phase necessarily must fix, but should not make worse).
**Warning signs:** TypeScript error on `useKhavee().currentVolume`; or, if loosely typed, `currentVolume` silently stays `0` during a real conversation because nothing is actually setting it inside `KhaveeProvider`.

### Pitfall 6: Frame-ordering contract — already documented, must be preserved
**What goes wrong:** New procedural bone-delta code runs before `mixer.update(delta)` (would immediately be overwritten by the mixer) or after `vrm.update(delta)` (VRM-only final step; would never be applied to the rendered frame for VRM, though harmless-but-wrong-order for GLB which has no equivalent final step).
**Why it happens:** Not a hypothetical — `AnimationStateEngine.ts`'s own doc comment explicitly names this as "Phase 11's additive bone-delta layer" insertion point and gives the required order: `mixer.update(delta) -> controller.update(delta) -> vrm.update(delta)`.
**How to avoid:** All new steps (breathing, sway, drift, talk-cycle crossfade-trigger, audio-reactive scale) go inside `controller.update(delta)`'s body, which both `VRMAvatar.tsx` and `GLBAvatar.tsx` already call at the correct point in their respective `useFrame` callbacks (verified: `VRMAvatar.tsx:498` calls `controller.update(delta);` between `mixerRef.current.update(delta)` (line 485) and `currentVrm.update(delta)` (line 501); `GLBAvatar.tsx:162` calls `controller.update(delta);` inside a `useFrame` that relies on drei's own earlier-registered `useFrame` for `mixer.update`).
**Warning signs:** Breathing/sway visibly "pop" or fail to apply at all; VRM expression-manager-driven blendshapes (blink, drift) don't visually update despite `setValue()` being called (would indicate insertion after `vrm.update()`).

## Code Examples

### Existing insertion point (verbatim, current state — where Phase 11 code goes)

```typescript
// Source: packages/react/src/animation/AnimationStateEngine.ts:129-134 (current, pre-Phase-11)
function update(delta: number): void {
  if (blendRef.current.active) {
    stepCrossfade(blendRef.current);
  }
  blink.step(adapter, enableBlinking);
  // Phase 11 adds breathing/sway/drift/talkCycle/audioReactive steps here,
  // in this function body, after blink.step and before returning.
}
```

### `floorSeconds` call-site change needed for TRANS-01/02

```typescript
// Source: packages/react/src/animation/AnimationStateEngine.ts:120 (current call, no floor)
blendRef.current = beginCrossfade(currentActionRef.current, toAction, root);

// TRANS-01/02 needs something shaped like:
const floor = (chatStatus === "starting" || chatStatus === "stopped") ? 1.2 : undefined;
blendRef.current = beginCrossfade(currentActionRef.current, toAction, root, floor);
```

### VRM humanoid bone resolution (the fix for Pitfall 1)

```typescript
// Source: @pixiv/three-vrm's VRMHumanoid API, already used elsewhere in this
// codebase — packages/react/src/utils/remapMixamoAnimationToVrm.ts:26-27
const vrmHipsY = vrm.humanoid
  ?.getNormalizedBoneNode("hips")
  .getWorldPosition(_vec3).y;
// Breathing/sway should use the same accessor for "chest"/"spine"/"hips",
// not adapter.getBoneNode(literalName).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `GLBAvatar.tsx`'s `setTimeout`-driven talk-clip loop-back (`3000 + Math.random() * 2000` ms) | `stepCrossfade`-driven, `useFrame`-timed crossfades via `beginCrossfade`/`stepCrossfade`, no live-clock timers | Phase 10 (removed) | Established the no-timer precedent TALK-01 must extend for variant cycling, not reintroduce a timer for |
| Fixed-duration linear `fadeIn(0.3)`/`fadeOut(0.3)` on both avatars | Pose-gap-adaptive, `easeInOutCubic`-eased manual `setEffectiveWeight` ramp (0.3-0.9s, now extensible via `floorSeconds`) | Phase 10 | TRANS-01/02 build directly on this, not a new crossfade mechanism |
| `resolveBaseClip` had no naming-convention resolution for `listening`/`thinking`/`starting`/`stopped` | `STATUS_CLIP_PATTERNS` table added, generalizing the `speaking` pattern to 5 statuses | Post-Phase-10 quick task `260712-qvu` (2026-07-12, same day as this research) | Directly consumable by Phase 11 once clip names/placeholders are decided — no further `resolveBaseClip` change needed for pattern-matching itself, only for `ready` (Pitfall 3) and cycling (Pitfall 4) |

**Deprecated/outdated:** None — this is a young, actively-developed internal module (all of `animation/*.ts` was created in Phase 10, same milestone).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|-----------------|
| A1 | Exact numeric parameters for breathing/sway (period, amplitude, randomization bounds) are unconstrained by any locked decision — CONTEXT.md explicitly leaves this to Claude's Discretion, following `blink.ts`'s precedent of keeping original inline constants rather than re-deriving them. This research does not propose specific numbers (no existing "original breathing/sway constants" exist anywhere in this codebase to migrate verbatim, unlike blink) | Standard Stack / Architecture Patterns | Low — CONTEXT.md already flags this as discretion, not a research gap; planner should pick physiologically-plausible defaults (e.g. ~4-6s breathing period, ~6-10s sway period, small-degree amplitude) and document them inline per the `blink.ts` comment-density convention |
| A2 | `THREE.AnimationMixer`'s native `"loop"` event (`mixer.addEventListener("loop", callback)`) is the correct native mechanism for TALK-01's loop-boundary detection, in preference to manually polling `action.time` vs. `clip.duration` every frame | Don't Hand-Roll | Medium — this is training-data knowledge about three.js's `AnimationMixer` API surface, not verified via Context7/official docs in this session (no MCP Context7 tool was available in this environment). The planner/implementer should confirm the exact event name/payload shape (`{action, loopDelta}`) against the installed `three@0.180.x` d.ts before relying on it; a manual `action.time`/`getClip().duration` comparison is a safe fallback if the event API doesn't behave as expected |

## Open Questions

1. **Which VRM clip (if any) should stand in for `starting`/`stopped`?**
   - What we know: `public/models/animations/` contains only `Idle.fbx`, `talking.fbx`, `talking1.fbx` (confirmed by `ls`; CONTEXT.md's claim is accurate — no 4th "Fist Fight B.fbx" clip is a plausible greeting/goodbye substitute either, confirmed present but clearly combat-themed and unrelated).
   - What's unclear: Whether TRANS-01/02 should be implemented as "no dedicated VRM clip exists, so `starting`/`stopped` fall back to the existing `Idle.fbx` via `resolveBaseClip`'s fallback chain, with only the duration-floor mechanism visibly differentiating them from instant `ready`" — or whether the plan should explicitly flag this as a VRM-side gap requiring a `checkpoint:human-verify` before considering TRANS-01/02 "done" for VRM specifically (GLB has a real candidate; VRM does not).
   - Recommendation: Planner should treat VRM's `starting`/`stopped` as "duration-floor mechanism works, but no distinct visual clip exists yet" and note this explicitly as a known limitation inherited from the D-01-acknowledged asset gap (ASSET-01, issue #17) — not attempt to source a clip within this phase.

2. **Exact fixed composition order for breathing/sway/audio-reactive-amplitude on the shared spine bone**
   - What we know: `PERFORMANCE-BUDGET.md` §4 suggests breathing → sway → audio-reactive-scale as an *example* order, explicitly not a mandate. CONTEXT.md confirms this is Claude's Discretion.
   - What's unclear: Whether the "combined magnitude bounded" requirement (PERF-01) should be a hard clamp (e.g. total delta angle ≤ some max radians) applied after all systems compose, or a per-system amplitude cap applied before composition.
   - Recommendation: A post-composition clamp (measure the final combined delta quaternion's angle via `.angleTo(IDENTITY)` and re-normalize/slerp-back if it exceeds a threshold) is simpler to reason about and test in isolation than per-system caps that must be hand-tuned to avoid a worst-case combined overshoot — but this is a genuine implementation-detail decision the plan should make explicitly and document, per PERF-01's "documented order" requirement.

## Environment Availability

No external tools, services, or runtimes beyond what's already installed are required for this phase — all work is application code against already-present `three`/`@pixiv/three-vrm`/`@react-three/fiber` dependencies (verified installed via `packages/react/package.json` and cross-checked against current npm registry versions above). No environment audit gaps.

## Security Domain

`security_enforcement` is not explicitly disabled in `.planning/config.json` (absent = enabled per protocol), but this phase's surface area has minimal security relevance — no new network calls, no new user input parsing, no authentication/authorization/cryptography surface. The only externally-influenced input this phase newly consumes is `currentVolume` (a `number` scalar sourced from `OpenAIRealtimeProvider.onVolumeChange`, itself derived from decoded audio — already-trusted, already-shipped data path, not new attack surface).

| ASVS Category | Applies | Standard Control |
|---------------|---------|--------------------|
| V5 Input Validation | Yes (minimal) | `currentVolume` should be clamped to a sane range (e.g. `[0, 1]`) before being used to scale procedural amplitude, matching the existing clamping convention already used elsewhere in this codebase for similar scalar inputs (e.g. `KhaveeProvider.tsx`'s `setExpression`: `Math.max(0, Math.min(1, value))`) — defends against a malformed/out-of-range value from the provider producing an extreme, visually-broken procedural motion, not a security vulnerability per se, but a robustness control worth carrying over from the codebase's existing pattern |
| V2/V3/V4/V6 | No | No authentication, session, access-control, or cryptography surface touched by this phase |

### Known Threat Patterns for this stack

None applicable — this phase is pure client-side rendering/animation logic with no new trust boundary, no new parsing of untrusted structured data (the `currentVolume` scalar is the only new data flow, addressed above).

## Sources

### Primary (HIGH confidence — direct tool verification this session)
- Direct GLB binary parse (`node` script reading `public/models/happy.glb`'s embedded JSON chunk) — 8 animation clips enumerated exactly: `Pose`, `State 1 Idle (loop)`, `State 2 present (loop)`, `State 3 Welcome (loop)`, `State 4 Taking (loop)`, `State 5 listening (loop)`, `Walk`, `Walk.001`
- Direct VRM binary parse (4 files: `male.vrm`, `blacknwhitecat.vrm`, `amongus.vrm`, `nongkhavee_male_01.vrm`) — humanoid bone → literal node name mapping for `chest`/`spine`/`hips`/`neck`/`head`/`upperChest`
- `ls public/models/animations/` — confirmed exact FBX file list (`Fist Fight B.fbx`, `Idle.fbx`, `talking.fbx`, `talking1.fbx`)
- `packages/react/src/animation/AnimationStateEngine.ts` (read in full) — `STATUS_CLIP_PATTERNS` regex table, `resolveBaseClip`, `useAnimationController`
- `packages/react/src/animation/crossfade.ts` (read in full) — `beginCrossfade`/`stepCrossfade`/`poseGapToDuration`'s existing `floorSeconds` parameter
- `packages/react/src/animation/blink.ts`, `types.ts` (read in full) — reference procedural pattern, `AvatarFormatAdapter` contract
- `packages/react/src/VRMAvatar.tsx`, `GLBAvatar.tsx` (read in full) — adapter wiring, `useFrame` ordering, context consumption
- `packages/react/src/KhaveeProvider.tsx` (read in full) — `KhaveeContextType` shape, confirmed absence of `currentVolume`
- `packages/react/src/hooks/useRealtime.ts` (read in full) — `currentVolume` state + `onVolumeChange` wiring, confirmed isolated to this hook
- `packages/react/src/utils/remapMixamoAnimationToVrm.ts`, `mixamoVRMRigMap.ts` — confirmed `vrm.humanoid.getNormalizedBoneNode()` usage precedent and VRM humanoid bone-name strings
- `src/app/glb-avatar-test/page.tsx` — independent cross-verification of the exact GLB clip name list (Phase 10's own manual-test fixture, matches this session's binary parse exactly)
- `src/app/openai-avatar-test/page.tsx` — confirmed VRM demo `AnimationConfig` keys (`idle`, `talking`, `talking1`)
- `packages/react/src/animation/AnimationStateEngine.test.ts`, `crossfade.test.ts` — confirmed `resolveBaseClip("ready", ...)` fallback-chain behavior via existing passing tests
- `.planning/config.json` — confirmed `workflow.nyquist_validation: false` (Validation Architecture section omitted per protocol) and `brave_search`/`exa_search`/`firecrawl` all `false`
- `npm view three version` / `npm view @pixiv/three-vrm version` — current registry versions cross-checked against installed semver ranges

### Secondary (MEDIUM confidence)
- `.planning/phases/wayfinder-map-1-animation-architecture/PERFORMANCE-BUDGET.md` — full document read; cites web.dev, R3F docs, three.js Discourse, Unity/Unreal docs (all secondary citations within that document, not re-verified independently this session — treated as already-vetted per CONTEXT.md's instruction not to re-litigate locked wayfinder research)
- `.planning/phases/wayfinder-map-1-animation-architecture/ASSET-RESEARCH.md` §7 — read; confirms the asset-sourcing dead-end (Quaternius/Kenney CC0 packs checked, no clean candidates found) underlying D-01

### Tertiary (LOW confidence)
- `THREE.AnimationMixer`'s `"loop"` event API shape (Assumption A2) — training-data knowledge, not verified against the installed `three@0.180.x` package's type definitions or changelog in this session (no Context7 MCP tool was available in this environment; a CLI fallback (`ctx7`) was also not invoked for this specific check). Flagged in Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all APIs already in use in this codebase
- Architecture (bone resolution, crossfade floor, adapter contract): HIGH — every claim verified by direct file read or binary parse this session, not inference from CONTEXT.md's own (explicitly flagged as unverified) claims
- Pitfalls: HIGH — all 6 pitfalls are grounded in direct verification (regex test, binary parse, file read), not speculation
- TALK-01/02 cycling mechanism specifics (loop event vs. manual polling): MEDIUM — mechanism choice is sound engineering judgment but the exact three.js API shape (Assumption A2) is unverified against installed package docs

**Research date:** 2026-07-12
**Valid until:** 30 days (stable internal codebase, no fast-moving external dependency in the critical path — the only external-library dependency, `@pixiv/three-vrm`'s humanoid API, is a mature, spec-stable surface)
