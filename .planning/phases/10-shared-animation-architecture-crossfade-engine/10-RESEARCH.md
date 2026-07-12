# Phase 10: Shared Animation Architecture & Crossfade Engine - Research

**Researched:** 2026-07-12
**Domain:** React Three Fiber / three.js AnimationMixer crossfading, VRM/GLB avatar animation-state unification
**Confidence:** HIGH

## Summary

This phase's architecture is fully locked by a completed wayfinder design map (GitHub issue [khavee-ai/khavee-sdk#1](https://github.com/khavee-ai/khavee-sdk/issues/1)), so this research is almost entirely extraction, not exploration. Three closed tickets carry the concrete implementation contract: [#2](https://github.com/khavee-ai/khavee-sdk/issues/2) (hybrid state layer + procedural delta layer), [#5](https://github.com/khavee-ai/khavee-sdk/issues/5) (crossfade formula, prototyped and validated), and [#8](https://github.com/khavee-ai/khavee-sdk/issues/8) (VRM/GLB unification via a format-adapter interface). A working, validated prototype of the crossfade engine exists on git branch `wayfinder/5-crossfade-prototype` (commit `6d0b9d7`, not merged) — its full source is reproduced below in Code Examples and should be ported directly, not re-derived.

Two concrete, code-verified findings materially affect planning. First, `VRMAvatar.tsx`'s JSDoc claims automatic chatStatus-driven talking-animation switching ("randomly plays animations whose names include 'talk'...") — grepping the actual component body confirms this is **not implemented**: `enableTalkingAnimations` isn't even destructured from props. Only the fixed-duration `fadeIn`/`fadeOut(0.3)` crossfade (lines 429-467) is real. This means ANIM-02's "remove old switching" instruction applies literally to `GLBAvatar.tsx` (its `setTimeout` loop-back, lines 165-203) but for `VRMAvatar.tsx` the new shared module isn't replacing working code — it's adding automatic chatStatus-driven behavior for the first time, while removing/replacing the existing fixed-duration crossfade. Second, `GLBAvatar.tsx` currently instantiates **two independent `AnimationMixer` instances** for the same model: one internally inside drei's `useAnimations` hook (the real one, driving `actions[name].play()`), and a second, separate `mixerRef` (lines 97, 213-224) that a `useFrame` callback updates every frame but which never has any clip actions added to it — dead code that does nothing. The format-adapter's `getMixer()` for GLB must return drei's real mixer (exposed as `mixer` in `useAnimations`'s return value), not the orphaned `mixerRef`.

**Primary recommendation:** Port `wayfinder/5-crossfade-prototype`'s "Variant C" logic (`easeInOutCubic` easing, `computePoseGapAngle` using max per-bone quaternion `angleTo`, `poseGapToDuration` lerping 0.3–0.9s, manual per-frame `setEffectiveWeight` ramp in `useFrame`) into a new internal module in `packages/react/src` that both `VRMAvatar` and `GLBAvatar` consume through a `{ getMixer(), getBoneNode(name), getExpressionManager(): VRMExpressionManager | null }` adapter, replacing GLBAvatar's dead second mixer, GLBAvatar's `setTimeout` loop-back, and VRMAvatar's linear `fadeIn`/`fadeOut`. Migrate the existing ref-driven blink system into this module's procedural delta layer verbatim (D-01), giving GLB avatars blink for the first time.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| chatStatus → base-clip state mapping (ANIM-01) | Browser/Client (R3F component tree, `packages/react`) | — | Pure client-side rendering state, driven by `KhaveeProvider`'s React context; no server/API involvement |
| Crossfade engine (XFADE-01) | Browser/Client (`useFrame` callback, per-frame) | — | Must run in the WebGL render loop; three.js `AnimationMixer`/`AnimationAction` are client-only objects |
| Format-adapter interface (ANIM-01/03) | Browser/Client | — | Bridges VRM-specific (`@pixiv/three-vrm`) and GLB-generic (drei `useAnimations`) client objects behind one shape |
| Procedural delta layer / blink migration (D-01) | Browser/Client (`useFrame`, ref-driven) | — | Same `useFrame` callback as the mixer update; must avoid React state per existing inline comment (re-render cost) |
| Model loading/parsing (ANIM-03, explicitly untouched) | Browser/Client (`useLoadVRM`, `useGLTF`) | — | Out of scope this phase; stays format-specific per ticket #8 |
| chatStatus source of truth | Browser/Client (`KhaveeProvider` context, `useRealtime` hook) | — | Already exists upstream; this phase only reads it, does not change its origin |

No server/API, CDN, or database tier is involved anywhere in this phase — this is a pure client-rendering refactor confined to `packages/react/src`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Procedural delta layer scope this phase:** Migrate `VRMAvatar.tsx`'s existing blink system (currently inline, `useFrame`-driven, ref-based state) into the new shared module's procedural delta layer during Phase 10, rather than leaving it in place and deferring all procedural work to Phase 11. Rationale: blink is exactly the "already-proven pattern" wayfinder ticket #2 said the procedural delta layer should extend, so migrating it now proves the layer works end-to-end with one real behavior instead of shipping an empty stub. As a side effect, `GLBAvatar` gets blink for the first time (it currently has none). Phase 11 still owns breathing, weight-shift sway, expression rest-state drift, and all other procedural behaviors (IDLE-01/02, TALK-01/02, PERF-01) — only blink migrates early.

**D-02 — Crossfade prototype reuse:** Port the actual implementation from the local prototype branch `wayfinder/5-crossfade-prototype` (commit `6d0b9d7`) as the starting point for the crossfade engine, rather than reimplementing the formula from scratch off the decision notes alone. The prototype's `setEffectiveWeight`-based manual blending (validated against real pose data on `happy.glb`'s `Idle`/`Taking`/`listening` clips) is the reference implementation to adapt into the new shared module — reduces risk of re-deriving the max-vs-average pose-gap formula incorrectly a second time. Note: `main`'s copy of `src/app/glb/page.tsx` was already reverted to its pre-prototype state — only the branch/commit itself retains the prototype code, not any file currently on `main`.

**D-03 — Test assets for this phase:** Build and verify Phase 10's architecture (shared module, format-adapter, crossfade engine) against the clips already bundled in the repo — `public/models/animations/{Idle,talking,talking1}.fbx` for VRM, and `happy.glb`'s embedded `Idle`/`Taking`/`listening` clips for GLB (same fixtures the prototype used). Do not wait on or attempt to source the final CC0 clips tracked in issue #17 (`stopped`, `listening`×2+, `thinking`×2+, `speaking` 2nd variant) — those are out of reach this phase. The bundled clips' redistribution-license risk (tracked separately in issue #11) is a known, separately-tracked compliance issue, not a blocker for using them as architecture-verification placeholders now.

### Claude's Discretion

- Exact file/module location and naming for the new shared internal module within `packages/react/src` — wayfinder ticket #8 explicitly left this unspecified, only requiring it stay internal (not exported from the package's public `index.ts`), matching the existing internal-only pattern (`AudioRecorder`, `STTClient` in `openai-stt-tts`).
- Whether the format-adapter interface is a TypeScript `interface` or an object literal shape — ticket #8 only specified the method signatures (`getMixer()`, `getBoneNode(name)`, `getExpressionManager(): ExpressionManager | null`), not the exact type-declaration mechanics.
- How existing public props (`enableBlinking`, `enableTalkingAnimations` on `VRMAvatar`; `autoPlayAnimation` on `GLBAvatar`) map onto or coexist with the new internal module during this phase — Phase 13 owns the actual new public API surface (API-01..04); Phase 10 just needs the existing public behavior to keep working from the outside.

### Deferred Ideas (OUT OF SCOPE)

- Sourcing final CC0 clips for `stopped`/`listening`/`thinking`/2nd `speaking` variant — tracked in issue #17, explicitly out of reach this phase (D-03).
- Fixing the bundled Mixamo files' redistribution-license risk — tracked separately in issue #11, unrelated compliance work.
- All idle/talking/gaze/gesture procedural *behaviors* (breathing, sway, expression drift, audio-reactive amplitude, gaze, semantic gestures) — Phase 11/12 scope (IDLE-01/02, TRANS-01/02, TALK-01/02, PERF-01, GAZE-01/02, GEST-01/02).
- New public API surface (`enableNaturalMotion`, reserved `animations` keys, zero-config defaults) — Phase 13 scope (API-01..04).

**Standing instruction (repeated for visibility):** Do not reference, mine, or build on the abandoned `worktree-agent-*` branches or the `fix/emotion-analyzer-provider-agnostic` branch — explicit user direction. This applies to implementation, not just design. This research did not open, diff, or cite either.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANIM-01 | The chatStatus→animation state layer and procedural delta layer are implemented once as a shared internal module (not exported from the package's public `index.ts`), consumed by both `VRMAvatar` and `GLBAvatar` via a format-adapter interface (`getMixer()`, `getBoneNode(name)`, `getExpressionManager(): ExpressionManager \| null`) | Ticket #2 (hybrid layer decision) and #8 (adapter interface, file-location discretion, null-check pattern) fully specify this; see Architecture Patterns below for the concrete module shape and adapter wiring for both `VRMAvatar` (real mixer already exists via `mixerRef`) and `GLBAvatar` (must switch to drei's real `mixer`, not the dead `mixerRef`) |
| ANIM-02 | `VRMAvatar.tsx`'s `useEffect`+if-statement chatStatus switching and `GLBAvatar.tsx`'s `setTimeout`-driven loop-back pattern are both removed, replaced by the shared module | Exact line ranges identified below (Common Pitfalls / Code removal map). **Correction surfaced by this research:** `VRMAvatar.tsx` has no chatStatus-driven `useEffect`+if-statement switching to remove today — only its fixed-duration `fadeIn`/`fadeOut` crossfade effect (lines 429-467) needs replacing; the "old pattern removal" instruction is real and literal only for `GLBAvatar.tsx`'s `setTimeout` loop-back (lines 165-203) |
| ANIM-03 | Model loading/parsing (`useLoadVRM`, `useGLTF`) stays separate per format, untouched by this work | Confirmed: `useLoadVRM` (VRMAvatar.tsx:63-101) and `useGLTF`/drei's `useAnimations` (GLBAvatar.tsx:106-107) are unrelated to the crossfade/state work; format-adapter interface reads already-loaded mixer/bones/expression-manager, never touches loading |
| XFADE-01 | All state transitions use `easeInOutCubic`-eased crossfades with pose-gap-adaptive duration (0.3–0.9s), where pose-gap is measured as the max (not average) per-bone quaternion angular distance | Full formula, prototype source, and the max-vs-average correction extracted verbatim from ticket #5 and branch `wayfinder/5-crossfade-prototype` commit `6d0b9d7` — see Code Examples |
</phase_requirements>

## Standard Stack

### Core

| Library | Version (installed) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `three` | `^0.180.0` [VERIFIED: repo `package.json`/`packages/react/package.json`] | `AnimationMixer`, `AnimationAction`, `Quaternion.angleTo`, `MathUtils.lerp`/`clamp` — all primitives the crossfade engine and format-adapter are built on | Already the project's sole 3D engine; no alternative under consideration |
| `@pixiv/three-vrm` | `^3.4.2` [VERIFIED: `packages/react/package.json`, cross-checked against `node_modules/@pixiv/three-vrm-core` type declarations] | Exposes `VRM.expressionManager?: VRMExpressionManager` — the exact type the format-adapter's `getExpressionManager()` must return (or `null`) | Already the project's VRM runtime; ticket #8 explicitly names this pattern |
| `@react-three/fiber` | `^9.3.0` [VERIFIED: `packages/react/package.json`] | `useFrame` — the callback both the existing mixer updates and the new crossfade/procedural-delta logic must run inside | Already the project's R3F binding |
| `@react-three/drei` | `^10.7.6` [VERIFIED: `packages/react/package.json`, confirmed via reading `node_modules/@react-three/drei/core/useAnimations.js` source] | `useAnimations(clips, root)` — used by `GLBAvatar` today; **owns the real, only-correct `AnimationMixer` for GLB** (it internally calls `useFrame` to run `mixer.update(delta)` and lazily creates `AnimationAction`s via `mixer.clipAction(clip, root)`) | Already the project's animation-clip helper for GLB; no reason to bypass it |

No new packages are required for this phase — the crossfade engine, format-adapter, and blink migration are composed entirely from APIs already present in the four libraries above. **Package Legitimacy Audit is not applicable** — this phase installs zero new dependencies.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `three/src/math/MathUtils.js` (`lerp`) | bundled with `three@0.180.0` | Already imported in `VRMAvatar.tsx:7` for expression lerping; the prototype also uses `THREE.MathUtils.lerp`/`THREE.MathUtils.clamp` for the pose-gap-to-duration mapping | Reuse for `poseGapToDuration` — do not hand-roll a linear-interpolation/clamp helper |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual per-frame `setEffectiveWeight` ramp | THREE's built-in `AnimationAction.crossFadeTo()` / `.fadeIn()`/`.fadeOut()` | **Rejected by ticket #5 explicitly** — built-in fade supports neither pose-gap-adaptive duration nor custom (`easeInOutCubic`) easing; it only does a fixed-duration linear ramp. This is exactly the pattern being replaced (XFADE-01), not an alternative to consider. |
| Format-adapter `interface` (nominal TS type) | Plain object-literal duck-typed shape (structural typing, no `interface` keyword) | Left to Claude's discretion per CONTEXT.md — both are TS-idiomatic; `interface` gives clearer public contract documentation via JSDoc (matches the project's convention of full JSDoc on public/internal contracts per CLAUDE.md Comments section), duck-typed shape is marginally less ceremony. No functional difference at runtime. |

## Package Legitimacy Audit

Not applicable — this phase installs zero new external packages. All required APIs (`AnimationMixer`, `AnimationAction.setEffectiveWeight`, `Quaternion.angleTo`, `VRMExpressionManager`, drei's `useAnimations`) come from dependencies already declared in `packages/react/package.json` and already used elsewhere in the codebase (verified above).

## Architecture Patterns

### System Architecture Diagram

```
                         KhaveeProvider (React context)
                         chatStatus: ChatStatus
                         currentAnimation / animate()
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  useRealtime() (existing,      │
                    │  upstream — untouched)          │
                    │  mirrors provider.chatStatus    │
                    │  into React state ~line 124     │
                    └───────────────┬─────────────────┘
                                    │ chatStatus (read-only input)
                                    ▼
        ┌──────────────────────────────────────────────────────┐
        │   NEW: Shared internal animation module (this phase)  │
        │   packages/react/src/<TBD location, Claude's choice>  │
        │                                                        │
        │   ┌────────────────────────────────────────────────┐ │
        │   │ State layer                                     │ │
        │   │  chatStatus → base clip name lookup             │ │
        │   │  on change: start crossfade (see below)          │ │
        │   └────────────────────────────────────────────────┘ │
        │   ┌────────────────────────────────────────────────┐ │
        │   │ Crossfade engine (XFADE-01)                     │ │
        │   │  computePoseGapAngle(scene, toClip) -> max rad  │ │
        │   │  poseGapToDuration(angle) -> 0.3–0.9s            │ │
        │   │  easeInOutCubic(t)                               │ │
        │   │  per-frame: fromAction.setEffectiveWeight(1-t)  │ │
        │   │             toAction.setEffectiveWeight(t)      │ │
        │   └────────────────────────────────────────────────┘ │
        │   ┌────────────────────────────────────────────────┐ │
        │   │ Procedural delta layer (D-01: blink only        │ │
        │   │  this phase; ref-driven, runs in same useFrame) │ │
        │   │  blinkState/isBlinking/nextBlinkTime refs        │ │
        │   │  writes to adapter.getExpressionManager()        │ │
        │   │  (skipped automatically when adapter returns     │ │
        │   │  null, i.e. GLB — no crash, just no blink until  │ │
        │   │  GLB gets an expression-equivalent, which never  │ │
        │   │  happens; GLB blink is architecturally a no-op   │ │
        │   │  unless a future bone-based blink is added)      │ │
        │   └────────────────────────────────────────────────┘ │
        └───────────────┬────────────────────┬───────────────────┘
                         │ format-adapter     │ format-adapter
                         │ interface          │ interface
                         ▼                    ▼
        ┌────────────────────────┐  ┌────────────────────────────┐
        │  VRMAvatar.tsx          │  │  GLBAvatar.tsx               │
        │  getMixer() -> the      │  │  getMixer() -> drei's REAL   │
        │   existing mixerRef     │  │   `mixer` from useAnimations │
        │   (real, already used)  │  │   (NOT the dead 2nd mixerRef │
        │  getBoneNode(name) ->   │  │   this phase must delete)    │
        │   scene.getObjectByName │  │  getBoneNode(name) ->        │
        │  getExpressionManager() │  │   groupRef.current           │
        │   -> currentVrm.        │  │   .getObjectByName(name)     │
        │   expressionManager     │  │  getExpressionManager() ->   │
        │   (VRMExpressionManager │  │   null (GLB has no           │
        │   | undefined)          │  │   expression system)         │
        └────────────┬────────────┘  └──────────────┬───────────────┘
                     │ useFrame: mixer.update(delta) then vrm.update(delta)
                     │                               │ useFrame: (drei already
                     ▼                               │  calls mixer.update
              VRM scene renders                      │  internally)
                                                       ▼
                                                GLB scene renders
```

A reader can trace the primary use case end to end: `chatStatus` changes in `KhaveeProvider` → the shared module's state layer looks up the new base clip → the crossfade engine computes pose-gap and starts a `useFrame`-driven `setEffectiveWeight` ramp → the format adapter resolves which concrete mixer/bones/expression-manager to write to → the correct avatar component's existing render/update path applies the result.

### Recommended Project Structure

Exact naming/location is explicitly Claude's discretion (CONTEXT.md), but given the existing internal-only pattern cited by ticket #8 (`AudioRecorder`, `STTClient` live directly under `openai-stt-tts/src/`, not a nested subfolder, and are simply omitted from `index.ts`), a directly analogous flat placement is the path of least surprise:

```
packages/react/src/
├── VRMAvatar.tsx              # consumes shared module via VRM adapter
├── GLBAvatar.tsx              # consumes shared module via GLB adapter
├── KhaveeProvider.tsx         # unchanged — still owns chatStatus
├── animation/                 # NEW — internal-only, not in index.ts
│   ├── AnimationStateEngine.ts   # state layer: chatStatus -> base clip, orchestrates crossfade
│   ├── crossfade.ts              # XFADE-01: easeInOutCubic, computePoseGapAngle, poseGapToDuration
│   ├── blink.ts                   # D-01: migrated procedural delta layer (blink only, this phase)
│   └── types.ts                   # FormatAdapter interface/shape
├── hooks/
│   └── useRealtime.ts         # unchanged
└── index.ts                   # UNCHANGED public surface — animation/ is never exported here
```

This is a recommendation, not a lock — the planner/implementer may choose a different internal layout as long as (a) it stays un-exported from `index.ts`, and (b) it is one module consumed by both avatar components, not two parallel copies (the failure mode ticket #8 explicitly calls out from the abandoned prior-art branch: naturalness work landing on `VRMAvatar.tsx` alone, growing to 1870 lines, never reaching `GLBAvatar.tsx`).

### Pattern 1: Format-Adapter Interface (ANIM-01, ticket #8)

**What:** A small interface/shape the shared module depends on instead of depending on `VRM` or drei's `useAnimations` return type directly, so the same crossfade/state/procedural code works for both formats.

**When to use:** Every read/write the shared module needs to perform against "the current 3D model" goes through this interface — never a direct `VRMAvatar`- or `GLBAvatar`-specific import inside `animation/`.

**Example (shape, adapted from ticket #8's literal method list):**
```typescript
// Source: GitHub issue khavee-ai/khavee-sdk#8, decision comment (method names verbatim)
export interface AvatarFormatAdapter {
  getMixer(): THREE.AnimationMixer;
  getBoneNode(name: string): THREE.Object3D | null;
  getExpressionManager(): VRMExpressionManager | null; // null for GLB — ticket #8: "null-check, not a capability flag"
}

// VRMAvatar.tsx wiring — mixerRef already exists and is real (VRMAvatar.tsx:304, 391)
const vrmAdapter: AvatarFormatAdapter = {
  getMixer: () => mixerRef.current!,
  getBoneNode: (name) => scene?.getObjectByName(name) ?? null,
  getExpressionManager: () => currentVrm?.expressionManager ?? null,
};

// GLBAvatar.tsx wiring — MUST use drei's real mixer, not the dead mixerRef this phase removes
const { mixer, actions, names } = useDreiAnimations(gltf.animations, groupRef);
const glbAdapter: AvatarFormatAdapter = {
  getMixer: () => mixer, // NOT mixerRef.current — see Common Pitfalls
  getBoneNode: (name) => groupRef.current?.getObjectByName(name) ?? null,
  getExpressionManager: () => null,
};
```

### Pattern 2: Pose-Gap-Adaptive Eased Crossfade (XFADE-01, ticket #5)

**What:** Replace `AnimationAction.fadeIn()`/`.fadeOut()` with a manual per-frame `setEffectiveWeight` ramp, eased with `easeInOutCubic`, whose duration is computed from the maximum per-bone quaternion angular distance between the live pose and the target clip's first frame.

**When to use:** Every chatStatus-driven base-clip transition (state layer), for both VRM and GLB, via the format adapter's `getMixer()`/`getBoneNode()`.

**Example — full working prototype source** (verified by reading `git show wayfinder/5-crossfade-prototype:src/app/glb/page.tsx` at commit `6d0b9d7`; this is "Variant C," the winning/decided approach per ticket #5):
```typescript
// Source: local branch wayfinder/5-crossfade-prototype, commit 6d0b9d7,
// src/app/glb/page.tsx (not merged to main — this is the reference to port)

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Max angular distance (radians) between the live pose and a clip's first-frame
 * pose, across every bone the clip animates. Max, not average — a single
 * dramatically-different limb (e.g. a raised arm) is what causes visible
 * crossfade "popping," and averaging across a whole skeleton dilutes that
 * signal into invisibility. Model-agnostic — no hardcoded bone names. */
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

/** Maps max pose-gap angle (radians) to a blend duration. ~90 degrees treated
 * as "very different pose" (one limb swinging through roughly a right angle). */
function poseGapToDuration(maxAngleRad: number): number {
  const minDuration = 0.3;
  const maxDuration = 0.9;
  const maxExpectedAngle = Math.PI / 2;
  const t = THREE.MathUtils.clamp(maxAngleRad / maxExpectedAngle, 0, 1);
  return THREE.MathUtils.lerp(minDuration, maxDuration, t);
}

type BlendState = {
  active: boolean;
  from: THREE.AnimationAction | null;
  to: THREE.AnimationAction | null;
  startTime: number;
  duration: number;
};

// On chatStatus/base-clip change:
const toAction = actions[currentAnimation]!;
const fromAction = currentActionRef.current;
const avgAngle = computePoseGapAngle(group.current, toAction.getClip()); // name is
  // "avgAngle" in the prototype var name but the VALUE is the MAX-angle result —
  // preserve the max semantics, rename the variable when porting to avoid confusion
const duration = poseGapToDuration(avgAngle);
toAction.reset();
toAction.enabled = true;        // required: mixer won't evaluate a disabled action
toAction.setEffectiveWeight(0); // start at 0 before the ramp begins
toAction.play();                // required even at weight 0 — action must be "playing"
                                 // for setEffectiveWeight to take effect each mixer.update()
blendRef.current = { active: true, from: fromAction, to: toAction, startTime: performance.now(), duration };
currentActionRef.current = toAction;

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

**Verified test fixture note:** `happy.glb`'s embedded clips are not literally named `"Idle"`/`"Taking"`/`"listening"` — confirmed by parsing the GLB's JSON chunk directly (`public/models/happy.glb`), the actual clip names are: `'Pose'`, `'State 1 Idle (loop)'`, `'State 2 present (loop)'`, `'State 3 Welcome (loop)'`, `'State 4 Taking (loop)'`, `'State 5 listening (loop)'`, `'Walk'`, `'Walk.001'`. CONTEXT.md/tickets refer to these informally as "Idle"/"Taking"/"listening" — the planner must use the exact bracketed strings above (`'State 1 Idle (loop)'` etc.) when writing test/verification code against this fixture, not the shorthand names. [VERIFIED: parsed `public/models/happy.glb`'s GLTF JSON chunk directly]

### Pattern 3: Ref-Driven Procedural Delta (Blink Migration, D-01)

**What:** The existing blink system in `VRMAvatar.tsx` (lines 308-317 for refs, 516-553 for the per-frame logic) moves into the shared module's procedural delta layer, unchanged in mechanism — still refs, not React state, still driven inside the same `useFrame` that updates the mixer.

**When to use:** Runs every frame for both VRM and GLB, but only produces a visible effect when `adapter.getExpressionManager()` is non-null (VRM). For GLB, the adapter contract makes this an automatic no-op — GLB gets "blink capability wired up" but no visible blink until/unless a future bone-based (eyelid-bone) blink mechanism is added, which is out of this phase's scope.

**Example (verbatim source to migrate, from `packages/react/src/VRMAvatar.tsx:308-317, 516-553`):**
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

// Inside useFrame, if (enableBlinking):
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
if (currentVrm.expressionManager) {
  if (
    currentVrm.expressionManager.blinkExpressionNames.includes("blinkLeft") &&
    currentVrm.expressionManager.blinkExpressionNames.includes("blinkRight")
  ) {
    currentVrm.expressionManager.setValue("blinkLeft", blinkState.current);
    currentVrm.expressionManager.setValue("blinkRight", blinkState.current);
  }
}
```
Port this to read/write through `adapter.getExpressionManager()` instead of `currentVrm.expressionManager` directly, and gate the whole block on the adapter returning non-null (equivalent to today's `if (enableBlinking)` gate, now additionally gated on format).

### Anti-Patterns to Avoid

- **`setInterval`/`setTimeout`-driven animation switching:** `GLBAvatar.tsx`'s current talking-animation loop-back (lines 187-192, 3-5s `setTimeout`) is the canonical example this architecture replaces. The verification checklist (ticket #14) explicitly checks for "no live-clock interrupts" — do not introduce a new timer anywhere in the ported code.
- **THREE's built-in `fadeIn`/`fadeOut`/`crossFadeTo`:** Explicitly rejected by ticket #5 for lacking adaptive duration and custom easing. Both `VRMAvatar.tsx:433/450/453` and `GLBAvatar.tsx:143/154/158/159` currently use this and must be replaced with the manual `setEffectiveWeight` ramp.
- **A second, parallel `AnimationMixer` per model:** `GLBAvatar.tsx`'s current `mixerRef` (lines 97, 213-224) is exactly this anti-pattern already present in the codebase — an unused mixer with zero registered actions, updated every frame for no effect. Delete it; route through drei's real `mixer`.
- **Duplicating the shared module per format:** Ticket #8 explicitly names the observed failure mode from the abandoned `worktree-agent-*` prior art (excluded from this research, cited only as the cautionary data point ticket #8 itself references): naturalness work landing on `VRMAvatar.tsx` alone and never reaching `GLBAvatar.tsx`. Structure the module so both components import the same code path.
- **Converting blink (or any procedural-delta state) to React `useState`:** Would reintroduce the re-render-per-frame stutter the existing inline comment (VRMAvatar.tsx:308-313) documents. Keep refs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cubic ease-in-out timing curve | A custom bezier/spline evaluator | The prototype's `easeInOutCubic(t)` one-liner (already validated, already the ticket #5 decision) | It's a 2-line closed-form function; no library needed and none should be added |
| Per-bone angular pose distance | Manual dot-product/acos math on raw quaternion components | `THREE.Quaternion.angleTo(other)` (three.js built-in, already used in the prototype) | Avoids re-deriving quaternion angular-distance math incorrectly; three.js's implementation is already numerically stable |
| Linear interpolation / clamping for duration mapping | Custom `Math.max(Math.min(...))` clamp + manual lerp | `THREE.MathUtils.lerp` / `THREE.MathUtils.clamp` (already imported project-wide, e.g. `VRMAvatar.tsx:7`) | Consistency with existing codebase usage; these are one-line utility wrappers already in the dependency tree |
| A second animation mixer for GLB | Any new `AnimationMixer` instance inside `GLBAvatar.tsx` | drei's `useAnimations`'s returned `mixer` (already created, already updated every frame internally) | `GLBAvatar.tsx` already has exactly this bug (unused second mixer) — the fix is deletion, not a better custom mixer |

**Key insight:** Every piece of math this phase needs (easing, angular distance, lerp/clamp) already exists as a one-line call into three.js's own API surface. The actual engineering work is wiring/composition (format adapter, state layer, ref lifecycle), not algorithm design — which is exactly why ticket #5's prototype exists as a directly portable reference rather than a set of notes to reimplement from.

## Common Pitfalls

### Pitfall 1: Average instead of max pose-gap (regression risk explicitly flagged by ticket #14)
**What goes wrong:** Computing pose-gap as an average across all animated bones instead of the maximum per-bone angle.
**Why it happens:** Averaging feels like the more "correct" statistical choice, especially if someone "simplifies" the ported code during implementation without re-reading the ticket.
**How to avoid:** Preserve the exact `computePoseGapAngle` implementation above — it tracks a running `max`, never sums/divides.
**Warning signs:** A test case with one dramatically-moved limb (e.g. `'State 1 Idle (loop)'` → `'State 5 listening (loop)'` on `happy.glb`, the prototype's actual measured case: 2.8° average vs. 113.6° max on the same transition) gets a near-minimum (0.3s) blend duration instead of a near-maximum one. The verification checklist (ticket #14) calls this out as a specific, high-signal objective check.

### Pitfall 2: GLBAvatar's dead second `AnimationMixer`
**What goes wrong:** The format adapter's `getMixer()` for GLB accidentally returns `mixerRef.current` (the existing, currently-unused mixer at `GLBAvatar.tsx:97/213-224`) instead of the real mixer drei's `useAnimations` already creates and updates.
**Why it happens:** `mixerRef` looks like "the" mixer at first glance — it's named identically to the pattern used in `VRMAvatar.tsx`, and its `useFrame` callback (lines 206-210) really does call `.update(delta)` every frame, making it look functional even though it has zero registered actions.
**How to avoid:** Delete `GLBAvatar.tsx`'s `mixerRef` state and its `useEffect`/`useFrame` blocks entirely (lines 97, 206-224); wire the format adapter's `getMixer()` to `useDreiAnimations(...).mixer` instead.
**Warning signs:** Crossfade code compiles and runs with no errors but produces no visible blend on GLB (calling `setEffectiveWeight` on actions registered against the wrong/empty mixer is a silent no-op).

### Pitfall 3: `VRMAvatar.tsx`'s documented-but-not-implemented talking-animation switching
**What goes wrong:** Assuming there is existing `useEffect`+if-statement chatStatus-driven switching logic in `VRMAvatar.tsx` to literally delete, per a surface reading of ANIM-02's requirement text.
**Why it happens:** The component's JSDoc (lines 204-206, 217) describes exactly this behavior in detail, including a documented `enableTalkingAnimations` prop.
**How to avoid:** Grep the component body, not the docstring — `enableTalkingAnimations` is never destructured from `VRMAvatarProps` (only `enableBlinking` is, line 300). The only real chatStatus-adjacent code in `VRMAvatar.tsx` is the fixed-duration crossfade effect keyed on `currentAnimation` (not `chatStatus` directly — `currentAnimation` is set via `KhaveeProvider`'s `animate()`, which nothing currently calls automatically from `chatStatus`). Treat the JSDoc as aspirational/stale; update it to match the new module's real behavior once implemented, rather than trying to "remove" nonexistent code.
**Warning signs:** A plan or task description that says "remove VRMAvatar's chatStatus useEffect switching" without a corresponding line-range citation is describing the JSDoc, not the code.

### Pitfall 4: `setEffectiveWeight` silently doing nothing without `.play()`/`.enabled = true`
**What goes wrong:** Calling `action.setEffectiveWeight(0)` on a freshly-created or `.reset()` action without also setting `.enabled = true` and calling `.play()` first.
**Why it happens:** It's easy to assume `setEffectiveWeight` alone controls whether an action contributes to the mixer's output, but three.js's `AnimationMixer` only evaluates actions that are both `enabled` and in the "playing" set.
**How to avoid:** Always follow the prototype's exact sequence: `toAction.reset(); toAction.enabled = true; toAction.setEffectiveWeight(0); toAction.play();` before starting the per-frame ramp.
**Warning signs:** The target animation never appears (weight ramps in the ref/state but nothing visibly changes on screen).

### Pitfall 5: Clip re-derivation causing frame-0 pose snapping (pre-existing, must not regress)
**What goes wrong:** If `processedClips` (or the GLB equivalent) is recomputed with a new array/object identity on every render, any effect depending on it re-fires, creating a *new* `AnimationAction` via `mixer.clipAction()` and restarting it from frame 0 — visibly snapping the pose.
**Why it happens:** Already diagnosed and fixed once in this codebase — see the inline comment at `VRMAvatar.tsx:168-181` explaining why `useAnimationFiles`' returned object is `useMemo`'d keyed on `JSON.stringify(animationUrls)` rather than the raw entries array.
**How to avoid:** When porting the crossfade/state logic into the new shared module, do not introduce a new source of unstable clip/array identity feeding into the crossfade trigger effect. Reuse the existing stable `processedClips` (VRM) / `gltf.animations` (GLB, already stable via drei's cache) as-is.
**Warning signs:** Avatar pose snaps to bind pose or restarts mid-animation on unrelated re-renders (e.g. while expressions update during speech, which happens dozens of times/sec per the `useRealtime.ts` rAF-coalescing comment at lines 41-50).

### Pitfall 6: Composing future procedural systems on the same bone (forward-looking, not required to solve this phase)
**What goes wrong:** Phase 11 will add breathing/sway that touch the same spine/hip bones. If this phase's blink migration (or the crossfade engine's bone writes) uses `.set()`/`.copy()` (overwrite) instead of `.multiply()` (additive) semantics on `Object3D.quaternion`, Phase 11's additive composition (PERF-01) will silently break blink or vice versa.
**Why it happens:** Blink itself only ever writes to expression blendshapes (`setValue`), never bone quaternions — so this phase has no actual overwrite-vs-additive conflict to resolve. But the crossfade engine's `setEffectiveWeight` mechanism operates at the `AnimationMixer`/`AnimationAction` level (blending whole clips), which is a different composition mechanism than the future procedural bone-delta layer (which will operate by directly mutating `bone.quaternion` after the mixer runs).
**How to avoid:** No code change required this phase (blink is expression-only). Just don't design the new module's internal API in a way that would block Phase 11 from later inserting a `bone.quaternion.multiply(deltaQuat)` step after `mixer.update(delta)` and before `vrm.update(delta)`/scene render — i.e., keep the `useFrame` callback's ordering (`mixer.update` → [future: procedural bone deltas] → `vrm.update`/render) structurally obvious and commented, matching `.planning/phases/wayfinder-map-1-animation-architecture/PERFORMANCE-BUDGET.md`'s documented composition order guidance.
**Warning signs:** N/A this phase — flagged only so the module's internal structure doesn't have to be reworked in Phase 11.

## Code Examples

See Architecture Patterns above (Pattern 1, 2, 3) for the complete, verified prototype source and blink-migration source. No additional canonical examples beyond what's already reproduced there — this phase's implementation is a direct port, not new design.

## State of the Art

| Old Approach | Current/New Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `AnimationAction.fadeIn(0.3)`/`.fadeOut(0.3)` (linear, fixed 0.3s) — `VRMAvatar.tsx:433/450/453`, `GLBAvatar.tsx:143/154/158/159` | Manual `setEffectiveWeight` ramp, `easeInOutCubic`, 0.3–0.9s pose-gap-adaptive | This phase (XFADE-01), prototyped on `wayfinder/5-crossfade-prototype` commit `6d0b9d7` | Eliminates the fixed-duration "pop" on large pose changes; ticket #5's own before/after comparison (Variant A vs. C) is the empirical basis |
| `GLBAvatar.tsx`'s `setTimeout(..., 3000 + Math.random() * 2000)` loop-back to idle (lines 187-192) | Loop-completion-driven variant cycling (Phase 11's TALK-01 scope) plus this phase's removal of the timer-based mechanism entirely | This phase removes the timer; Phase 11 adds the loop-completion replacement | Verification checklist (ticket #14) explicitly checks for zero live-clock interrupts in the speaking state |
| Two independent `AnimationMixer`s per GLB avatar (drei's real one + `GLBAvatar.tsx`'s dead `mixerRef`) | One mixer (drei's), referenced via the format adapter | This phase (as part of ANIM-01 wiring, not a separately ticketed decision — surfaced by this research) | Removes dead per-frame work and a latent source of confusion for future contributors |

**Deprecated/outdated:**
- `VRMAvatar.tsx`'s JSDoc description of automatic talking-animation switching (lines 204-206, 217) and the `enableTalkingAnimations` prop it documents — neither exists in the component body. Should be corrected once the new module actually implements chatStatus-driven switching, not left as-is.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The format-adapter should be declared as a TypeScript `interface` (vs. duck-typed object shape) — presented as a recommendation, not a verified requirement | Architecture Patterns / Alternatives Considered | Low — CONTEXT.md explicitly leaves this to Claude's discretion; either choice satisfies ticket #8's literal method-signature requirement |
| A2 | The recommended file layout (`packages/react/src/animation/*.ts`) is a suggestion only, not sourced from any ticket (ticket #8 explicitly left location unspecified) | Architecture Patterns / Recommended Project Structure | Low — flagged inline as discretionary; planner may choose differently without contradicting any locked decision |

**All other claims in this research were verified directly** — GitHub issue bodies/comments via `gh api`, prototype source via `git show` against the exact commit CONTEXT.md names, current file contents via direct `Read`, `happy.glb`'s real clip names via parsing the GLB's binary GLTF-JSON chunk, package versions via `package.json`, and the `VRMExpressionManager` type via `node_modules/@pixiv/three-vrm-core`'s `.d.ts` files. No package-legitimacy audit was needed (zero new dependencies).

## Open Questions (RESOLVED)

1. **Exact internal module boundaries (single file vs. multiple)**
   - What we know: Ticket #8 requires "one shared internal module," not "one shared internal file" — multiple internal files (state layer, crossfade, blink) composed together and imported by both avatar components would satisfy the requirement equally to one large file.
   - What's unclear: Whether the planner should decompose into multiple files (as recommended in Architecture Patterns) or keep everything in one file for simplicity at this phase's scope (blink is the only procedural-delta content this phase; Phase 11 will add much more).
   - Recommendation: Multiple files (state layer / crossfade / blink split) is lower-risk for Phase 11's follow-on growth, but either satisfies ANIM-01 as written. Not a blocker either way.
   - RESOLVED: Multi-file `animation/` module chosen (types / crossfade / blink / AnimationStateEngine split), per 10-01/10-02 plans.

2. **VRM crossfade duration vs. minimum-floor interaction for `starting`/`stopped` (TRANS-01/02)**
   - What we know: Ticket #6 (Phase 11 scope, TRANS-01/02) specifies a ~1.0–1.5s minimum duration floor for `starting`/`stopped` transitions specifically, layered on top of this phase's pose-gap-adaptive 0.3–0.9s range.
   - What's unclear: Whether this phase's crossfade engine API should already expose a duration-override/floor parameter (unused until Phase 11 wires it in) or whether Phase 11 should extend the function signature later.
   - Recommendation: Design `poseGapToDuration` (or its ported equivalent) to accept an optional `floorSeconds` parameter now, defaulting to unused/`undefined` this phase, so Phase 11 doesn't need to change the function's call sites — purely a forward-compatibility nicety, not required for XFADE-01/ANIM-01..03 to be satisfied this phase.
   - RESOLVED: Optional `floorSeconds?` param added to `poseGapToDuration`/`beginCrossfade` this phase (unused until Phase 11), per 10-01 plan.

## Environment Availability

No new external dependencies, services, CLIs, or runtimes are introduced by this phase. All required libraries are already declared in `packages/react/package.json` and confirmed present in the workspace's `node_modules`:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `three` | `AnimationMixer`, `Quaternion.angleTo`, `MathUtils` | Yes | `^0.180.0` | — |
| `@pixiv/three-vrm` | `VRMExpressionManager` type, `VRM.expressionManager` | Yes | `^3.4.2` | — |
| `@react-three/fiber` | `useFrame` | Yes | `^9.3.0` | — |
| `@react-three/drei` | `useAnimations` (GLB mixer) | Yes | `^10.7.6` | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Security Domain

This phase is a pure client-rendering refactor within `packages/react/src` — no network calls, no user input parsing beyond existing string-keyed animation-name lookups (`getBoneNode(name)`, `mixer.clipAction()`), no authentication/session/credential handling, and no new data persistence. Per `.planning/config.json`, `security_enforcement` is not set (absent = enabled per policy), so this section is included for completeness even though most ASVS categories genuinely do not apply.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not touched — this phase has no auth surface |
| V3 Session Management | No | Not touched |
| V4 Access Control | No | Not touched |
| V5 Input Validation | Marginal | Animation/bone name strings (`getBoneNode(name)`, clip names) originate from developer-authored `AnimationConfig`/bundled clip data, not untrusted end-user input; `scene.getObjectByName(name)` and `mixer.clipAction()` already fail gracefully (return `undefined`/throw caught elsewhere) on unknown names — no new validation is required beyond what the existing `processedClips`/`actions` lookups already do |
| V6 Cryptography | No | Not touched |

### Known Threat Patterns for this stack

None applicable — this is a client-side 3D rendering refactor with no attacker-controlled input surface beyond what already exists (developer-supplied animation URLs, out of scope per ANIM-03/D-03).

## Project Constraints (from CLAUDE.md)

The following directives from `./CLAUDE.md` apply to this phase's implementation and should be honored by the plan:

- **Naming:** New classes/modules use PascalCase for exported classes (e.g. an `AnimationStateEngine` class, if the state layer is class-shaped); camelCase for functions/hooks; interfaces without an `I` prefix (`AvatarFormatAdapter`, not `IAvatarFormatAdapter`); boolean flags prefixed `is`/`has`/`enable` (matches existing `isBlinking`, `enableBlinking`).
- **Internal/private re-entrancy or gate flags** should use a leading underscore if added (matching `_isTurnActive` precedent), though this phase's blink migration doesn't need a new one.
- **No barrel-file export** for the new internal module — `packages/react/src/index.ts` must NOT re-export anything from the new animation module, matching the existing `AudioRecorder`/`STTClient` internal-only pattern this phase is explicitly asked to follow (ticket #8).
- **No cross-package relative imports** — not applicable here since the new module lives inside `packages/react` and is only ever imported by `VRMAvatar.tsx`/`GLBAvatar.tsx` in the same package; relative imports within `packages/react/src` are fine, this rule only forbids `../../` reaching into sibling `@khaveeai/*` packages.
- **Error handling:** Any new `try/catch` introduced (e.g. around bone/expression-manager lookups, if added) should normalize unknown catch values with `error instanceof Error ? error : new Error(String(error))` before any `onError`-style callback, per the pattern already used in `OpenAISTTTTSProvider.ts`. This phase's format-adapter methods are simple synchronous lookups and likely need no new try/catch at all.
- **Logging:** Avoid decorative/emoji `console.log` in this new internal module (production-facing package code) — `console.warn`/`console.error` only for genuinely non-fatal/fatal conditions, matching the `openai-stt-tts` convention rather than the mock/demo emoji-log convention.
- **Comments:** New file(s) should carry a file-header block comment explaining the module's role (matching `STTClient.ts`'s pattern), and non-obvious ordering/timing decisions (e.g. why `mixer.update()` must run before the procedural delta layer, why `.play()` must precede `setEffectiveWeight`) should be commented with "why," not "what," per existing convention. JSDoc is expected on any exported interface/type in the new module (`AvatarFormatAdapter`, any public-within-package function).
- **Section-divider comments** (`// ── Section Name ──`) should be used if the new module's file(s) grow multi-concern, matching the style already used in `OpenAISTTTTSProvider.ts`.

## Sources

### Primary (HIGH confidence)
- GitHub issue [khavee-ai/khavee-sdk#1](https://github.com/khavee-ai/khavee-sdk/issues/1) — wayfinder map overview, fetched via `gh api repos/khavee-ai/khavee-sdk/issues/1`
- GitHub issue [khavee-ai/khavee-sdk#2](https://github.com/khavee-ai/khavee-sdk/issues/2) — hybrid state/procedural layer decision + comments, fetched via `gh api .../issues/2` and `.../issues/2/comments`
- GitHub issue [khavee-ai/khavee-sdk#5](https://github.com/khavee-ai/khavee-sdk/issues/5) — crossfade formula decision + comments, fetched via `gh api .../issues/5` and `.../issues/5/comments`
- GitHub issue [khavee-ai/khavee-sdk#6](https://github.com/khavee-ai/khavee-sdk/issues/6) — starting/stopped treatment decision + comments
- GitHub issue [khavee-ai/khavee-sdk#8](https://github.com/khavee-ai/khavee-sdk/issues/8) — VRM/GLB unification decision + comments
- Git branch `wayfinder/5-crossfade-prototype`, commit `6d0b9d7` — full prototype source read via `git show wayfinder/5-crossfade-prototype:src/app/glb/page.tsx` (not checked out, per instructions)
- `packages/react/src/VRMAvatar.tsx` — read in full (894 lines)
- `packages/react/src/GLBAvatar.tsx` — read in full (232 lines)
- `packages/react/src/KhaveeProvider.tsx` — read in full (308 lines)
- `packages/react/src/hooks/useRealtime.ts` — read (lines 1-180)
- `packages/core/src/types/conversation.ts` — `ChatStatus` union, read in full
- `node_modules/@react-three/drei/core/useAnimations.js` — confirmed drei's internal mixer creation/update behavior
- `node_modules/.pnpm/@pixiv+three-vrm-core@3.4.2.../types/VRMCore.d.ts` — confirmed `expressionManager?: VRMExpressionManager` type
- `public/models/happy.glb` — parsed directly (Python GLB binary chunk reader) to confirm actual embedded clip names
- `.planning/phases/wayfinder-map-1-animation-architecture/VERIFICATION-CHECKLIST.md` — read in full
- `.planning/phases/wayfinder-map-1-animation-architecture/PERFORMANCE-BUDGET.md` — read in full
- `.planning/phases/10-shared-animation-architecture-crossfade-engine/10-CONTEXT.md` — read in full
- `.planning/REQUIREMENTS.md` — read in full
- `.planning/STATE.md` — read in full
- `.planning/config.json` — read via `gsd-sdk query init.phase-op "10"` and direct file read

### Secondary (MEDIUM confidence)
None used — every claim above traces to a primary source read or executed in this session.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages, all versions read directly from `package.json`, all API usage confirmed against installed `node_modules` source/type files
- Architecture: HIGH — architecture is a locked, closed wayfinder decision; this research extracted it directly from primary GitHub issue sources and a real, committed prototype, not re-derived
- Pitfalls: HIGH — every pitfall listed is either an explicit ticket-documented finding (max-vs-average) or a concrete bug this research located by reading the actual current source (GLBAvatar's dead mixer, VRMAvatar's stale JSDoc)

**Research date:** 2026-07-12
**Valid until:** No expiry driver — the architecture is locked/closed (wayfinder map #1 fully resolved) and the prototype commit is immutable; this research does not go stale on a time basis the way a fast-moving external-library survey would. Re-verify only if `wayfinder/5-crossfade-prototype` is deleted/rewritten, or if `VRMAvatar.tsx`/`GLBAvatar.tsx` are modified by other work before Phase 10 executes.
