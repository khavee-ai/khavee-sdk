# Phase 12: Gaze & Gesture - Research

**Researched:** 2026-07-17
**Domain:** Procedural bone-delta animation (camera-relative gaze) + LLM tool-calling-triggered procedural gesture, on top of an existing shared VRM/GLB animation module (three.js + @react-three/fiber + @pixiv/three-vrm)
**Confidence:** HIGH for plumbing/composition mechanics (all verified by direct codebase inspection + a headless bone-resolution replay against the real bundled assets); MEDIUM for gaze's 3D look-at math (verified against three-vrm's own issue tracker, but this codebase has no existing look-at precedent to copy verbatim — see Common Pitfalls); MEDIUM for exact numeric parameters (no external prior-art benchmark, extrapolated from this codebase's own breathing/sway/blink precedent per CONTEXT.md's explicit instruction to do so).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Gesture tool shape & LLM nudge**
- **D-01:** The gesture-hint tool is a new exported plain-object factory, `packages/core/src/tools/gesture.ts`, mirroring `toolAnimate`'s existing shape (`packages/core/src/tools/animate.ts`) exactly — `name`, `description`, `parameters`, no `execute` field. The consuming app passes it into `config.tools` and wires `execute` itself (matching the beginner-DX "plain JS object, no schema library, app wires execute" pattern already established). The SDK does NOT auto-register this tool — it is opt-in, same as `toolAnimate`.
- **D-02:** Tool `name` is `set_gesture` (snake_case, matching `toolAnimate`'s `trigger_animation` convention and ticket #13's example verbatim). Parameter enum is exactly `['nod', 'shake', 'none']` — `'none'` lets the LLM explicitly opt out on a given turn rather than omitting the call.
- **D-03:** The tool's `description` field explicitly coaches the LLM on when to use each value (e.g., affirms/agrees/says-yes → `nod`; denies/disagrees/says-no → `shake`), unlike `toolAnimate`'s minimal/generic description. Rationale: nod/shake semantics are universal and language-agnostic (this SDK ships Thai support via Thonburian STT/JaiTTS — English-only keyword coaching would be a dead end), so baking guidance into the tool description gets zero-config correct behavior without every consuming app having to rediscover the right system-prompt wording.

**Gaze camera source**
- **D-04:** Gaze targets R3F's active scene camera (`useThree().camera`), not `VRMAvatar`'s existing `cameras: THREE.Camera[]` prop. Matches ticket #12's stated rationale verbatim ("a THREE.Camera is always available in an R3F scene, zero new dependencies") and works even when a consuming app never passes the `cameras` prop. Confirmed symmetric: `GLBAvatar.tsx` has no `cameras` prop equivalent to check (`grep cameras GLBAvatar.tsx` returns 0 matches), so `useThree().camera` is the only option that's uniform across both formats by construction.
- **D-05:** Gaze is a **continuous subtle offset** toward the camera direction (a small, constantly-updated head/neck delta, clamped to a small max angle) — not occasional saccade-like glances. Mirrors breathing/sway's always-on sine-driven `step()` pattern exactly (same ref-driven shape, no new timing/scheduling system needed). Reads as steady attentiveness.

**Gesture queuing outside `speaking`**
- **D-06:** When the LLM emits a gesture hint while `chatStatus` is `ready`/`listening`/`thinking` (i.e. no talk-clip cycle is running), the gesture **applies immediately** rather than queuing or being dropped. Rationale: ticket #13's "queue for the next natural loop boundary" constraint exists specifically to protect talk-clip cycling from being interrupted mid-play (GEST-02) — outside `speaking` there is no clip cycle to protect, so a nod/shake can play as soon as it's received. It remains a bounded procedural bone delta, not an interrupt of anything, consistent with the base decision in #13 that gestures never need a dedicated clip.

### Claude's Discretion
- Exact numeric parameters for gaze intensity (max offset angle, ramp/settle timing) and gesture delta magnitude/duration (head-pitch pulse for nod, head-yaw pulse for shake) — ticket #12 establishes the *mechanism* ("small-amplitude, randomized-range parameters, same precedent as #3's breathing/sway") but not exact numbers. Follow `breathing.ts`'s approach as the reference for how much numeric specificity this codebase expects.
- Whether gaze and gesture live in one new module or two small ones alongside `breathing.ts`/`sway.ts`/`expressionDrift.ts` — no mandate beyond staying internal (not exported from `index.ts`), matching the Phase 10/11 precedent.
- Exact plumbing mechanism for threading the gesture-hint signal from the tool's `execute` callback into `useKhavee()`/`KhaveeProvider` context (a new field/setter, likely mirroring how `currentVolume` was threaded through in Phase 11) — the planner should follow that established precedent rather than inventing a new seam.
- Composition order when gaze's head/neck delta and any existing procedural systems (breathing/sway target spine/chest/hips per Phase 11, so no direct bone overlap is expected) interact — PERF-01's fixed, documented, bounded-magnitude composition rule from Phase 11 (`AnimationStateEngine.ts`'s `update()`) is the pattern to extend, not redesign.

### Deferred Ideas (OUT OF SCOPE)
- Tracked-user-position gaze mode — explicitly out of scope per ticket #12's decision and `.planning/REQUIREMENTS.md`'s Out of Scope table.
- Semantic/keyword-triggered gestures beyond nod/shake — explicitly out of scope per ticket #13's decision and `.planning/REQUIREMENTS.md`'s Out of Scope table.
- New public API surface (`enableNaturalMotion`, reserved `animations` keys, per-behavior override flags) — Phase 13 scope (API-01..04).
- Frame-budget adaptive throttling for the full procedural stack including gaze/gesture — Phase 11's D-03 deferred the full tiered-degradation system; Phase 13's PERF-02 is where any throttling work would land if still needed after profiling.

**Standing instruction:** Do not reference, mine, or build on the abandoned `worktree-agent-*` branches or the `fix/emotion-analyzer-provider-agnostic` branch.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GAZE-01 | `ready`/`listening`/`speaking` show camera-relative soft gaze; `thinking` shows brief gaze aversion; `starting`/`stopped` get no separate gaze treatment | `ChatStatus` enum confirmed (6 values, `packages/core/src/types/conversation.ts:17-23`); `STATUS_CLIP_PATTERNS` in `AnimationStateEngine.ts` already special-cases `starting`/`stopped` via dedicated clips, so gaze's per-state branch can key directly off the same `chatStatus` value already threaded into `useAnimationController`. See Architecture Patterns → Gaze mechanism, and Common Pitfalls → "naive `Object3D.lookAt()` is an absolute overwrite." |
| GAZE-02 | Gaze applies symmetrically to both VRM and GLB (bone-level, not expression-dependent) | Headless verification (this session) confirms `getHumanoidBoneNode("neck"\|"head")` resolves on BOTH bundled test assets — `male.vrm` (VRM, via `humanoid.getNormalizedBoneNode`) and `happy.glb` (GLB, via literal-name `getObjectByName`). See Code Examples → bone verification output. |
| GEST-01 | LLM emits `nod`/`shake`/`none` via tool-calling, no separate classification call, no keyword/regex | `toolAnimate` shape confirmed at `packages/core/src/tools/animate.ts` (5 lines, no `execute`); `RealtimeTool`/`RealtimeConfig.tools`/`registerFunction` confirmed identical across `OpenAIRealtimeProvider` and `OpenAISTTTTSProvider`. **Gap found:** `toolAnimate` itself is NOT exported from `packages/core/src/index.ts` today (dead/unwired code) — `toolGesture` MUST be added to the barrel export or GEST-01 cannot work end-to-end. See Common Pitfalls. |
| GEST-02 | Triggered gestures are procedural bone deltas, queued for the ambient talk-cycle's next natural loop boundary, never interrupt mid-clip | `talkCycle.ts` fully read: loop-boundary detection (`currentTime < prevActionTime` wrap-or-crossing check) is real and precedent-worthy, but is NOT exposed as a reusable hook/callback — it is fully internal to `stepTalkCycle`, gated by `MIN_TALK_DWELL_SECONDS` and TALK-01's variant-cycling concerns, neither of which apply to gesture queuing. Planner must extract a reusable loop-boundary primitive rather than reinvent the wrap-detection math from scratch. See Architecture Patterns → "No existing loop-boundary hook" and Don't Hand-Roll. |
</phase_requirements>

## Summary

Phase 12 is implementation work on top of an architecture that is already fully decided (CONTEXT.md's D-01..D-06, sourced from wayfinder tickets #12/#13, both re-fetched and cross-checked verbatim in this research pass — no drift found). The phase adds two independent procedural systems to `packages/react/src/animation/`, following the exact `breathing.ts`/`sway.ts` shape (ref-driven hook wrapping a pure, unit-testable `step` function, additive `multiply()` writes on a module-scoped scratch `THREE.Quaternion`), plus one new plain-object LLM tool in `packages/core/src/tools/gesture.ts` mirroring `toolAnimate` exactly.

Three concrete implementation facts, verified this session and not previously documented anywhere in this repo, materially change what the planner needs to scope:

1. **Bone resolution is confirmed to work on both bundled test assets.** A headless replay (GLTFLoader.parse() + VRMLoaderPlugin, texture loading stubbed, mirroring Phase 11's own diagnostic method) against the real `public/models/male.vrm` and `public/models/happy.glb` confirms `getHumanoidBoneNode("neck")` and `("head")` resolve cleanly on both — VRM via `humanoid.getNormalizedBoneNode`, GLB via literal-name lookup (`happy.glb`'s node names already match role strings, same property Phase 11 found true for chest/spine/hips). No blocking asset gap exists for GAZE-02.

2. **`talkCycle.ts` does NOT expose a reusable "next loop boundary" hook.** Its loop-boundary detection (comparing `currentAction.time` against the previous frame's value to detect a wrap or a crossing of clip duration) is real, correct, and the right primitive to reuse — but it lives entirely inside `stepTalkCycle`, entangled with `MIN_TALK_DWELL_SECONDS` (a TALK-01-specific anti-thrash floor) and speaking-variant round-robin selection, neither of which gesture queuing needs. The planner must extract a small, pure, reusable boundary-detection function (e.g. `didLoopBoundaryOccur(currentTime, prevTime, duration)`) that both `stepTalkCycle` and a new gesture-queue step can call, rather than reimplementing the wrap-check inline a second time (which would risk the two detectors silently disagreeing on where a "loop boundary" actually is).

3. **`toolAnimate` — the exact shape `toolGesture` must mirror — is currently unexported and unused anywhere in this repo.** `packages/core/src/index.ts` only re-exports `./types` and `./client/khavee-client`; `packages/core/package.json`'s `exports` field has a single `"."` entry with no tools subpath. This means GEST-01 cannot function end-to-end unless the planner explicitly adds `toolGesture` (and, as a closely-related fix, probably `toolAnimate` too, since both now live in the same file-shape family) to the barrel export. This is not optional cleanup — without it, `import { toolGesture } from '@khaveeai/core'` fails to compile for any consuming app.

Gaze's "look toward camera" math is the one piece of this phase with genuine technical risk: three.js's `Object3D.lookAt()` performs an **absolute overwrite**, not an additive delta, and a documented three-vrm GitHub issue (#1173) shows a developer hitting exactly the failure mode this codebase's PERF-01 rule exists to prevent — an un-clamped, un-composed `lookAt()` call producing "full 360 degree rotation." Gaze must be built as: compute the absolute look-at target quaternion in a scratch object (never on the live bone), diff it against the bone's pre-gaze orientation to get a delta, clamp that delta to a small max angle, ease it over time, and apply via `.multiply()` like every other procedural system in this file family. This is a materially different math shape than breathing/sway's fixed-single-axis sine and should be scoped as its own task with its own verification step, not treated as "just another sine-driven system." `thinking`'s gaze aversion, by contrast, needs no camera math at all — it is a fixed-direction offset and can reuse breathing/sway's simpler fixed-axis-angle approach directly.

**Primary recommendation:** Build gaze and gesture as two separate new files (`gaze.ts`, `gesture.ts`) under `packages/react/src/animation/`, both following `breathing.ts`'s exact hook/step/scratch-quaternion shape; extract talk-cycle's loop-boundary check into a small reusable pure function rather than duplicating it; add `toolGesture` (`packages/core/src/tools/gesture.ts`) to `packages/core/src/index.ts`'s barrel export as its own task, since this is a currently-undiscovered blocker for GEST-01; and treat gaze's camera-relative delta math as the phase's one genuinely novel, higher-risk task, scoped separately from the more mechanical breathing/sway-style pieces.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Camera-relative gaze delta (GAZE-01/02) | Browser / Client (R3F render loop) | — | Pure per-frame bone-quaternion math inside `useFrame`; no server/API involvement. Reads `useThree().camera`, an R3F-scene-local object. |
| Gesture-hint tool definition (GEST-01) | API / Backend-agnostic (LLM tool schema) | Browser / Client (execute wiring) | The tool's `name`/`description`/`parameters` shape is a plain data contract consumed by whichever LLM backend the app wires (`OpenAIRealtimeProvider`/`OpenAISTTTTSProvider`) — it has no server-side component of its own in this SDK; the `execute` callback the app supplies runs client-side and writes into React context. |
| Gesture-hint plumbing (tool execute → animation layer) | Browser / Client (`KhaveeProvider` context) | — | Mirrors `currentVolume`'s existing Phase-11 seam: a new context field/setter on `KhaveeContextType`, consumed inside the same `useFrame`-driven `update(delta)` that already reads `currentVolume`. |
| Gesture bone-delta playback + loop-boundary queuing (GEST-02) | Browser / Client (`AnimationStateEngine.ts`'s `update()`) | — | Entirely inside the existing per-frame controller; no new render pass or component. |

## Standard Stack

No new external packages are required for this phase.

### Core (existing, already installed — no version changes needed)
| Library | Version (installed) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `three` | ^0.180.0 (installed; `packages/react/package.json`) | `THREE.Quaternion`/`THREE.Vector3`/`THREE.Camera` math for gaze's delta computation | Already the sole 3D math dependency across every procedural system in this codebase (breathing/sway/crossfade all import from `three` directly) |
| `@react-three/fiber` | ^9.3.0 (installed; `packages/react/package.json`) | `useThree()` hook (D-04's camera source) and/or the existing `useFrame((state, delta) => ...)` callback's first argument, `state.camera` — both resolve to the identical `RootState.camera: THREE.Camera` field. Confirmed via `node_modules/.pnpm/@react-three+fiber@9.3.0.../store.d.ts`. | Already the render-loop dependency VRMAvatar/GLBAvatar both use for `useFrame` |
| `@pixiv/three-vrm` | ^3.4.2 (installed; `packages/react/package.json`) | `humanoid.getNormalizedBoneNode("neck"\|"head")` — VRM-side bone resolution, already exposed through `AvatarFormatAdapter.getHumanoidBoneNode` | Already the sole VRM dependency; no VRM-specific look-at API exists in this library (confirmed — see Common Pitfalls) so no new VRM feature surface is being adopted |

**Installation:** None — no `npm install`/`pnpm add` needed this phase.

## Package Legitimacy Audit

Not applicable — this phase introduces zero new external packages. No `slopcheck`/registry verification is required; every dependency used (`three`, `@react-three/fiber`, `@pixiv/three-vrm`) is already installed and in active use elsewhere in `packages/react`.

## Architecture Patterns

### System Architecture Diagram

```
LLM tool-calling response (OpenAI Realtime / STT-TTS provider)
        │  (function call: set_gesture({ gesture: 'nod'|'shake'|'none' }))
        ▼
App-supplied `execute` callback (wired by consuming app, NOT the SDK)
        │  calls a new KhaveeProvider context setter, e.g. setGestureHint(gesture)
        ▼
KhaveeProvider (React context) ── new field: gestureHint, setGestureHint ──┐
        │  read every frame (mirrors currentVolume's existing wiring)     │
        ▼                                                                  │
VRMAvatar.tsx / GLBAvatar.tsx                                              │
        │  useFrame(state, delta):                                        │
        │    mixer.update(delta)                                          │
        │    controller.update(delta)  ◄── useAnimationController params  │
        │      internally, in this fixed order (extends PERF-01's list): │
        │        ...crossfade ramp → blink → amplitude/settle scale →    │
        │        rest-pose reset → breathing → sway → spine clamp →      │
        │        expression drift → talk-cycle → [NEW] gaze → [NEW]      │
        │        gesture-queue-and-play                                  │
        │                                                                  │
        │  gaze.step(adapter, camera, chatStatus, delta)                  │
        │    - reads state.camera (from useFrame's first arg, or          │
        │      useThree().camera per D-04)                                │
        │    - computes camera-relative delta on neck/head (ready/        │
        │      listening/speaking) OR a fixed aversion offset (thinking)  │
        │    - writes via bone.quaternion.multiply(scratch), clamped      │
        │                                                                  │
        │  gesture.step(adapter, gestureHint, chatStatus, loopBoundary,   │
        │               delta) ◄────────────────────────────────────────┘
        │    - if chatStatus !== "speaking": plays immediately (D-06)
        │    - if chatStatus === "speaking": waits for the SAME
        │      loop-boundary primitive talkCycle.ts already computes
        │      (extracted, not reinvented — see Don't Hand-Roll)
        │    - plays a bounded, one-shot bone-delta pulse on neck/head
        │      (pitch pulse for nod, yaw pulse for shake), then calls
        │      the consumed-and-cleared setter (setGestureHint(null))
        ▼
        vrm.update(delta) / drei's implicit mixer tick (GLB)
```

### Recommended Project Structure
```
packages/react/src/animation/
├── breathing.ts          # existing — unchanged
├── sway.ts                # existing — unchanged
├── expressionDrift.ts      # existing — unchanged
├── talkCycle.ts            # existing — extend with an exported, reusable
│                            #   loop-boundary-detection primitive (pure fn)
├── gaze.ts                 # NEW — continuous camera-relative delta (GAZE-01/02)
├── gesture.ts               # NEW — triggered, consumed-and-cleared bone pulse (GEST-01/02)
└── AnimationStateEngine.ts # existing — extend update()'s composition order
                             #   (append gaze + gesture steps, per the
                             #   file's own "extend this list, not reorder
                             #   it silently" convention)

packages/core/src/tools/
├── animate.ts    # existing — unchanged (but see Common Pitfalls: currently
│                  #   unexported from index.ts — a pre-existing gap)
└── gesture.ts     # NEW — toolGesture, mirrors toolAnimate's shape exactly
```

### Pattern 1: Ref-driven procedural step function (reuse verbatim)
**What:** A `use<Thing>()` hook holding `useRef`-backed mutable state, wrapping a pure `step(state, adapter, ...)` function that is independently unit-testable (no React rendering needed).
**When to use:** Both gaze and gesture — this is the established, only pattern for procedural systems in this codebase (breathing.ts, sway.ts, expressionDrift.ts, blink.ts, talkCycle.ts all follow it).
**Example (from `breathing.ts`, the direct template):**
```typescript
// Source: packages/react/src/animation/breathing.ts (existing code, verified this session)
const _scratchDelta = new THREE.Quaternion(); // module-scoped, never `new` per-frame

export function stepBreathing(state, adapter, delta, amplitudeScale = 1): void {
  const chest = adapter.getHumanoidBoneNode("chest");
  const spine = adapter.getHumanoidBoneNode("spine");
  if (!chest || !spine) return; // defensive gate — scene not loaded / rig has no mapping
  state.phase += (delta / state.period) * Math.PI * 2;
  const angle = breathingDeltaAngle(state.phase, DEFAULT_AMPLITUDE, amplitudeScale);
  _scratchDelta.setFromAxisAngle(BREATHING_AXIS, angle);
  chest.quaternion.multiply(_scratchDelta); // additive — never .set()
  spine.quaternion.multiply(_scratchDelta);
}
```

### Pattern 2: `thinking`-state gaze aversion — reuse Pattern 1 directly, no camera math
The `thinking` aversion is NOT camera-relative — it's a fixed offset ("look away"). This is structurally identical to breathing/sway's fixed-axis-angle approach (no look-at math, no clamping-against-a-moving-target needed), so it should be implemented as a simple conditional branch inside `gaze.ts`'s `step()`: when `chatStatus === "thinking"`, apply a fixed small yaw/pitch offset instead of computing a camera-relative target. This significantly de-risks 3 of the 4 in-scope gaze states (`ready`/`listening`/`speaking` all need the harder camera-relative math; `thinking` does not).

### Pattern 3: Camera-relative delta (the one genuinely new math shape this phase needs)
**What:** Computing a small, bounded, additive rotation that nudges the head/neck toward the camera — WITHOUT using `Object3D.lookAt()` directly on the live bone (see Common Pitfalls for why).
**Recommended approach** (synthesized from three.js/three-vrm conventions; NOT copied from an existing precedent in this codebase, since none exists — flag as the phase's one novel task):
```typescript
// Illustrative shape only — exact axis/space handling needs empirical
// verification during implementation (see Open Questions).
const _scratchTarget = new THREE.Quaternion();   // absolute look-at target, scratch-only
const _scratchCurrent = new THREE.Quaternion();  // bone's pre-gaze orientation
const _scratchDelta = new THREE.Quaternion();    // target composed against current

function stepGaze(state, adapter, camera, chatStatus, delta) {
  const head = adapter.getHumanoidBoneNode("head");
  if (!head) return;

  _scratchCurrent.copy(head.quaternion); // capture BEFORE any gaze write

  if (chatStatus === "thinking") {
    // Fixed aversion offset — Pattern 2, no camera math.
  } else if (chatStatus === "ready" || chatStatus === "listening" || chatStatus === "speaking") {
    // 1. Compute camera position in the bone's PARENT local space (never
    //    call head.lookAt() directly — that overwrites, doesn't compose).
    // 2. Build the ABSOLUTE target orientation in _scratchTarget only.
    // 3. Diff: delta = target * current^-1 (or equivalent), clamp delta's
    //    angle to a small max (see numeric params below), ease toward it.
    // 4. head.quaternion.multiply(_scratchDelta); // additive, matches PERF-01
  }
  // starting/stopped: no branch — gaze.step() should no-op entirely for
  // these two statuses (GAZE-01's "no separate gaze treatment").
}
```

### Pattern 4: Loop-boundary detection, extracted for reuse (GEST-02)
**What:** `talkCycle.ts` already computes "did the currently-playing action just cross a loop boundary" — this exact primitive is what GEST-02's queuing needs, but it is currently inline and entangled with `MIN_TALK_DWELL_SECONDS`/variant-selection concerns that don't apply to gesture queuing.
**Recommended refactor (verified against the real `stepTalkCycle` source this session):**
```typescript
// Source: packages/react/src/animation/talkCycle.ts, lines 96-109 (existing
// logic to extract into a pure, separately-exported function):
//
//   let loopBoundary = false;
//   if (currentTime !== null && duration !== null && duration > 0) {
//     if (state.prevActionTime !== null) {
//       loopBoundary =
//         currentTime < state.prevActionTime ||
//         (currentTime >= duration && state.prevActionTime < duration);
//     }
//     state.prevActionTime = currentTime;
//   }
//
// Extract this into: export function detectLoopBoundary(currentTime: number
// | null, prevTime: number | null, duration: number | null): boolean
// — pure, no state mutation — then have BOTH stepTalkCycle AND a new
// gesture-queue step call it, each owning their OWN prevActionTime tracking
// (since gesture's queue and talk-cycle's variant-switch are conceptually
// independent consumers of "did a loop just complete," even though today
// they'd observe the same physical action/clip).
```

### Anti-Patterns to Avoid
- **Calling `Object3D.lookAt()` directly on a live humanoid bone:** absolute overwrite, no clamp, no composition with other procedural systems — violates PERF-01 and is the exact failure mode documented in three-vrm's own issue tracker (#1173, "full 360 degree rotation").
- **Reimplementing loop-boundary wrap detection a second time inside a new gesture module:** risks the gesture queue and `talkCycle.ts`'s own variant-switch silently disagreeing about where a loop boundary is, since both would be independently reading `currentAction.time`/`getClip().duration` with slightly different edge-case handling.
- **Treating gaze's camera math as "just another sine, like breathing":** it fundamentally is not — breathing/sway are periodic single-axis oscillators with no external target; gaze is a target-tracking system with a moving external reference (the camera). Scope it as its own task.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Is the camera available in this frame's render context?" | A new `useThree()` call plus prop-drilling camera through `AvatarFormatAdapter` | The camera argument `useFrame((state, delta) => ...)` already receives as `state.camera` — both `VRMAvatar.tsx` and `GLBAvatar.tsx` already have a `useFrame` callback; `state.camera` is the identical object `useThree().camera` returns (confirmed via `@react-three/fiber`'s `RootState` type) | Zero new API surface, no extra hook call, no adapter interface change needed |
| "Did the current talk-clip just loop?" | A second independent `prevActionTime`/wrap-detection implementation inside a new gesture module | Extract `talkCycle.ts`'s existing wrap-check (lines 96-109) into a small exported pure function, called by both `stepTalkCycle` and the new gesture step | Avoids two independently-maintained loop-boundary detectors silently drifting apart on edge cases (e.g. a non-looping clip clamped at its end) |
| "Rotate this bone to face a target" | A custom lookAt-and-clamp implementation built from raw trig | `THREE.Quaternion.setFromUnitVectors()` (direction-to-direction rotation) combined with the codebase's existing scratch-quaternion + `angleTo()`-based clamping pattern (already used for the PERF-01 spine clamp in `AnimationStateEngine.ts` lines ~1105-1118) | `angleTo()`+slerp-toward-clamped-target is already a proven, tested pattern in this exact file for bounding a composed delta — reuse it rather than inventing new clamp math |
| "Is this LLM tool call callable end-to-end?" | Assuming `toolAnimate`'s existing shape is sufficient because it "already works" | Verify `packages/core/src/index.ts`'s barrel export explicitly — `toolAnimate` is NOT currently exported, so copying its shape alone does not make `toolGesture` importable | A silent, easy-to-miss packaging gap; GEST-01 is unverifiable without this fix |

**Key insight:** Every mechanism GAZE/GEST needs (frame-scoped camera access, loop-boundary detection, bounded-angle clamping, tool-object shape, provider tool registration) already exists somewhere in this codebase in a proven, tested form. The actual net-new work is almost entirely (a) gaze's camera-relative delta math (genuinely new) and (b) wiring/plumbing (gesture-hint context field, barrel export fix) — not new algorithmic infrastructure.

## Common Pitfalls

### Pitfall 1: `Object3D.lookAt()` performs an absolute overwrite, not a composable delta
**What goes wrong:** Calling `head.lookAt(targetPosition)` directly on the live bone snaps the bone to point exactly at the target with no magnitude limit, and — per this codebase's PERF-01 rule — completely defeats the additive `multiply()` composition every other procedural system uses (breathing/sway would be silently discarded whenever gaze runs, since `.lookAt()`'s internal `.set()`-equivalent write happens after them in composition order, or would themselves get overwritten if gaze runs first).
**Why it happens:** `Object3D.lookAt()` is the obvious, first-reached-for three.js API for "point this thing at that thing" — it's exactly what a naive implementation would use.
**How to avoid:** Compute the look-at target quaternion into a scratch object only (never write it to the live bone), diff it against the bone's pre-gaze orientation to derive a delta, clamp that delta's angle, then apply via `.multiply()`.
**Warning signs:** Sudden extreme head rotation on connect/state-change; gaze appears to fight or cancel breathing/sway; a documented three-vrm GitHub issue (#1173) shows a developer hitting exactly this failure mode ("full 360 degree rotation") when using `.lookAt()` naively on a VRM head bone.

### Pitfall 2: `toolGesture` is unreachable by consuming apps unless the barrel export is fixed
**What goes wrong:** `packages/core/src/tools/animate.ts` exports `toolAnimate`, but `packages/core/src/index.ts` only re-exports `./types` and `./client/khavee-client` — `toolAnimate` has never been importable as `@khaveeai/core`'s public surface, and nothing in this repo currently imports it (confirmed via `grep -rn "toolAnimate"` returning only its own definition). If `toolGesture` is added following the exact same pattern without also touching `index.ts`, GEST-01 is silently unimplementable end-to-end — `import { toolGesture } from '@khaveeai/core'` will fail to compile for any app that tries to use it, even though the tool file itself is correct.
**Why it happens:** The `toolAnimate` precedent this phase is told to "mirror exactly" is itself an incomplete/unwired example — copying its shape faithfully reproduces its gap.
**How to avoid:** Explicitly add `export { toolGesture } from './tools/gesture';` (and, as a low-risk drive-by fix matching CLAUDE.md's "Barrel files ... re-export the package's public surface" convention, likely `export { toolAnimate } from './tools/animate';` too) to `packages/core/src/index.ts` as its own planned task.
**Warning signs:** A plan task that only touches `packages/core/src/tools/gesture.ts` and nothing else in `packages/core` — this is the tell that the barrel-export step was missed.

### Pitfall 3: Gesture's `execute` callback lives in app-scope, not React-scope — the wiring seam is not identical to `currentVolume`'s
**What goes wrong:** `currentVolume` is set exclusively via `realtimeProvider.onVolumeChange`, an event callback KhaveeProvider itself wires up internally inside a `useEffect` (`KhaveeProvider.tsx` lines 125-130) — the setter (`setCurrentVolume`) is never exposed publicly through `useKhavee()`. Gesture's trigger source is different in kind: the LLM tool's `execute` callback is supplied by the **consuming app**, at `RealtimeConfig.tools` construction time — which, per this codebase's own existing demo pattern (`src/app/rag-realtime/page.tsx`'s module-scoped `provider = new OpenAIRealtimeProvider({ tools: [...] })`), typically happens OUTSIDE the React tree, before `KhaveeProvider` has even mounted. If the planner copies `currentVolume`'s wiring pattern literally (internal-only setter), the app-supplied `execute` callback has no way to reach it.
**Why it happens:** CONTEXT.md's Claude's-Discretion note says to mirror `currentVolume`'s plumbing "likely" — but the analogy only holds for WHERE the field lives in `KhaveeContextType`, not for whether the setter is public.
**How to avoid:** Expose the new setter (e.g. `setGestureHint`) as part of `useKhavee()`'s public return value (unlike `setCurrentVolume`, which stays internal), so an app can call it from inside a component that has both `useKhavee()` and a reference to its own tool's `execute` closure — most naturally by calling `provider.registerFunction({ ...toolGesture, execute })` inside a `useEffect` after the provider is available in context, the same pattern this codebase already uses for `onChatStatusChange`/`onVolumeChange`/`onToolCall` reassignment.
**Warning signs:** A plan that adds `gestureHint` to `KhaveeContextType` but forgets to also return its setter from `useKhavee()`'s return object — this leaves the field readable but not writable by app code, exactly mirroring `currentVolume`'s intentionally-internal-only setter.

### Pitfall 4: Bone-local coordinate spaces are not guaranteed uniform across VRM/GLB or even across VRM rigs
**What goes wrong:** VRM 1.0's specification standardizes the WHOLE-AVATAR root orientation to face -Z (and three-vrm auto-corrects VRM 0.x rigs, which are authored +Z-forward, to present the same -Z convention at runtime via its loader) — but this says nothing about an individual bone's LOCAL rotation space relative to its own parent, which depends on how the source rig was modeled. A gaze implementation that assumes "the head bone's local -Z is always forward" without verifying against the actual bundled assets risks producing a rotation that reads as looking in the wrong direction, or with an inverted axis (a documented complaint in the same three-vrm issue #1173, where a developer needed a manual Y-axis correction `lookAt.setY(lookAt.y + 3)`).
**Why it happens:** VRM's root-level facing-direction standardization is easy to over-generalize to "every bone is standardized," which is not documented anywhere as true.
**How to avoid:** Verify empirically against the real bundled assets (male.vrm normalized head bone, happy.glb's literal head bone) using a headless script before committing to a specific forward-axis assumption — same methodology this research session used for bone-presence verification (see Code Examples). Consider computing the delta in WORLD space (camera world position vs. head world position) and converting the resulting rotation into the bone's parent-local space via `parent.worldToLocal()`, rather than assuming a fixed local forward axis.
**Warning signs:** Gaze reads as looking away from the camera, or only partially toward it, on one format but not the other.

### Pitfall 5: Forgetting `starting`/`stopped` must get NO gaze treatment at all (not "zero-amplitude gaze")
**What goes wrong:** Following breathing/sway/expressionDrift's existing `SETTLE_SCALE`-damping pattern for `stopped` might tempt a "gaze runs everywhere but is damped to near-zero during starting/stopped" implementation — but GAZE-01 explicitly says these two states get "no separate gaze treatment," not "damped gaze." Since `starting`/`stopped` already play dedicated greeting/goodbye clips (TRANS-01/02, Phase 11), introducing even a damped gaze delta risks visibly fighting those clips' own head motion.
**Why it happens:** The `SETTLE_SCALE`/`proceduralScale` pattern is the freshest, most recently-touched precedent in `AnimationStateEngine.ts` (Phase 11 gap closures), making it an easy but incorrect template to copy for every new system.
**How to avoid:** Gate gaze's `step()` with an explicit early-return for `chatStatus === "starting" || chatStatus === "stopped"` (a full no-op, not an amplitude scale of 0 applied through the shared `proceduralScale` pipeline).
**Warning signs:** A gaze implementation that reads `proceduralScale`/`settleScale` from `update()`'s existing step 3 instead of branching directly on `chatStatus`.

## Code Examples

### Verified: bone resolution on both bundled test assets (this session's headless replay)
```
=== VRM: public/models/male.vrm ===
  getNormalizedBoneNode("neck"): FOUND (name="Normalized_J_Bip_C_Neck")
  getNormalizedBoneNode("head"): FOUND (name="Normalized_J_Bip_C_Head")
  getRawBoneNode("neck"): FOUND (name="J_Bip_C_Neck")
  getRawBoneNode("head"): FOUND (name="J_Bip_C_Head")

=== GLB: public/models/happy.glb ===
  getObjectByName("neck"): FOUND (type=Bone)
  getObjectByName("head"): FOUND (type=Bone)
```
Method: `GLTFLoader.parse()` + `VRMLoaderPlugin` registered, `THREE.TextureLoader.prototype.load` and `globalThis.self` stubbed so the real loader runs headless in plain Node (mirrors Phase 11's own diagnostic methodology, e.g. its 11-09/11-15 gap-closure headless replays). Both bundled test assets — the same ones Phase 11 verified chest/spine/hips against, and the same ones the demo pages (`openai-avatar-test`, `glb-avatar-test`) actually load — resolve `neck` and `head` cleanly via the existing `AvatarFormatAdapter.getHumanoidBoneNode` contract with no code changes needed to `types.ts`, `VRMAvatar.tsx`, or `GLBAvatar.tsx`'s adapter implementations (the `"neck"|"head"` role strings are already part of the interface's union type — see `types.ts` line 72 — just never exercised by any procedural system until now).

### Existing tool-object shape to mirror exactly
```typescript
// Source: packages/core/src/tools/animate.ts (existing, unchanged, verified this session)
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
Note: this shape (`type: "object"`, `properties: {...}`, `required: [...]`) is a JSON-Schema-flavored shape, DISTINCT from `RealtimeTool.parameters`'s own flatter shape in `packages/core/src/types/realtime.ts` (`{ [key]: { type, required?, enum?, description? } }` — no wrapping `type: "object"`/`properties`/`required` envelope). `toolAnimate` as written does NOT type-check against `RealtimeTool["parameters"]` today. The planner must decide (or the CONTEXT.md's D-01/D-02 "mirror exactly" instruction must be read as "mirror the FIELD NAMES `name`/`description`/`parameters`, not necessarily the internal JSON-Schema envelope") — `toolGesture`'s `parameters` should most likely use the FLATTER `RealtimeTool`-compatible shape (`{ gesture: { type: "string", enum: ["nod","shake","none"], required: true, description: "..." } }`) so it type-checks cleanly when spread into `RealtimeConfig.tools`, rather than literally copying `toolAnimate`'s incompatible nested-object shape. Flagged as an Open Question below since this is a real ambiguity CONTEXT.md's decisions don't fully resolve.

### Existing per-frame composition order to extend (not reorder)
```typescript
// Source: packages/react/src/animation/AnimationStateEngine.ts, update()'s
// own documented step list (existing comment, verified this session):
//   1. crossfade ramp -> 2. blink -> 3. amplitude/settle scale compute
//   -> 4a. lazily capture rest-pose anchor -> 4b. reset-if-not-driven
//   -> 4c. capture spine base -> 5. breathing -> 6. sway -> 7. spine
//   clamp -> 8. expression drift -> 9. talk-cycle.
// "Any future addition to this stack should extend this list, not
// reorder it silently."
```
Gaze and gesture should be appended as steps 10 and 11 (or interleaved per the planner's own judgment on ordering — e.g. gaze before gesture, since gesture is a discrete pulse that should compose ON TOP of gaze's continuous offset, not the reverse), with the module's own header comment updated to document the new full order, matching this file's own established self-documentation convention.

### Existing volume-plumbing precedent (partial analogy — see Pitfall 3 for where it diverges)
```typescript
// Source: packages/react/src/KhaveeProvider.tsx (existing, verified this session)
const [currentVolume, setCurrentVolume] = useState(0);
useEffect(() => {
  if (realtimeProvider) {
    realtimeProvider.onVolumeChange = (volume) =>
      setCurrentVolume(Math.max(0, Math.min(1, volume)));
  }
}, [realtimeProvider]);
// currentVolume IS exposed via useKhavee()'s return object; setCurrentVolume
// is NOT — because its only writer is this internal effect. Gesture's
// setter needs the OPPOSITE visibility (public), since its writer is
// app-supplied `execute` code — see Pitfall 3.
```

## State of the Art

Not broadly applicable — this is internal-precedent-driven work, not an external-library-currency question. The one relevant internal "state of the art" progression: `AnimationStateEngine.ts`'s composition order has been extended six times across Phase 11's gap-closure rounds (11-09 through 11-17) without ever being reordered — gaze/gesture should continue that discipline (append, document, never silently reorder).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recommended numeric parameters for gaze max-offset-angle and gesture pulse magnitude/duration (not stated in this doc as hard numbers — deferred to the planner per CONTEXT.md's Claude's-Discretion note) should be derived by extrapolating from breathing's ~0.03rad/sway's ~0.025rad idle amplitudes and blink's ~150ms sine-eased pulse envelope as the closest existing precedent for a "triggered, bounded-duration" effect | Common Pitfalls / Code Examples (implicit); no external prior-art benchmark was found or sought, per CONTEXT.md's explicit instruction to follow this codebase's own precedent rather than external game-animation literature | If gesture amplitude is set too low (imperceptible) or too high (reads as a full head-turn rather than a nod/shake), a human-verify checkpoint will need at least one gap-closure round — same pattern Phase 11 needed repeatedly for its own amplitude tuning (IDLE-02's `DEFAULT_AMPLITUDE` went through two rounds, 0.12 → 0.35, before it read as visible) |
| A2 | `toolGesture`'s `parameters` field should use the flatter `RealtimeTool`-compatible shape rather than literally copying `toolAnimate`'s nested JSON-Schema-style shape (which does not type-check against `RealtimeTool["parameters"]`) | Code Examples → "Existing tool-object shape to mirror exactly" | If the planner instead copies `toolAnimate`'s shape literally, TypeScript will not enforce `RealtimeTool` conformance at the point the tool is spread into `RealtimeConfig.tools`, and the mismatch may only surface as a runtime error inside whichever provider's tool-registration code actually reads `parameters` |
| A3 | The correct gaze delta-math approach is: compute an absolute target quaternion in a scratch object, diff against the bone's pre-gaze orientation, clamp the resulting delta's angle, then `multiply()` it onto the live bone — rather than any alternative (e.g. a pure Euler-angle yaw/pitch offset computed from camera bearing without ever constructing a full lookAt quaternion) | Architecture Patterns → Pattern 3 | This is a reasonable, three.js-idiomatic approach cross-checked against a real three-vrm community issue, but was NOT validated against the actual bundled rig's bone-local coordinate conventions in this research pass (see Pitfall 4/Open Question 1) — if the bone-local forward axis assumption is wrong, the delta computation may need a different intermediate step (e.g. computing everything in world space first, then converting only the FINAL small delta into local space, rather than working in local space throughout) |

**If this table is empty:** N/A — see entries above.

## Open Questions (RESOLVED — operationalized in plans, see notes below)

1. **RESOLVED in 12-02 Task 1 (empirical spike).** What is the bundled VRM/GLB head bone's actual local "forward" axis convention, and does it match between formats?
   - What we know: VRM 1.0's specification standardizes the whole-avatar ROOT to face -Z (with three-vrm auto-correcting VRM 0.x rigs at load time); a three-vrm GitHub issue (#1173) documents a developer needing manual axis correction when doing exactly this kind of head-bone look-at math, suggesting individual bone-local conventions are NOT automatically standardized the same way.
   - What's unclear: whether `male.vrm`'s normalized head bone and `happy.glb`'s literal head bone share a consistent local-forward convention, or whether each needs its own axis handling.
   - Recommendation: before implementing gaze's camera-relative math, run a small headless (or in-browser devtools) empirical check — set the head bone's world quaternion to a known "looking straight at world +Z" orientation, read back its LOCAL quaternion, and compare across both assets — rather than assuming a convention from documentation alone. This is a ~30-minute spike, not a research-blocking unknown, but should be its own early task/checkpoint in the plan given Pattern 3 is the phase's one genuinely novel piece of math.

2. **RESOLVED in 12-01 Task 1 (flat shape chosen, per Assumption A2).** Does `toolGesture`'s parameter shape need to satisfy BOTH `RealtimeTool["parameters"]` (from `packages/core/src/types/realtime.ts`) AND whatever `toolAnimate`'s nested JSON-Schema shape implies, or should `toolAnimate` be left as-is (possibly already broken/unused) while `toolGesture` uses the correct, type-checking shape?**
   - What we know: `toolAnimate` is unexported and unused anywhere in this repo, so its shape mismatch with `RealtimeTool` has never been caught by any consumer or test.
   - What's unclear: whether "mirror `toolAnimate`'s shape exactly" (D-01) was intended literally (reproduce the same mismatch) or as "mirror the pattern of a plain exported object with `name`/`description`/`parameters`, no `execute`" (functionally correct, textually different).
   - Recommendation: planner should treat D-01 as constraining the OUTER shape (`name`/`description`/`parameters`, no `execute`, plain exported const) and use the `RealtimeTool`-compatible flatter `parameters` shape for `toolGesture` specifically, since GEST-01 requires this tool to actually function through `RealtimeConfig.tools` — unlike `toolAnimate`, which has never been exercised end-to-end and so never had to satisfy that constraint.

3. **RESOLVED in 12-05 Task 2 (`useEffect` + `registerFunction` bridge).** Where exactly should the "app wires `execute`" bridging code live for a demo/verification page, given this phase's tool-construction-timing mismatch (Pitfall 3)?**
   - What we know: the existing `rag-realtime/page.tsx` demo constructs its `RealtimeProvider` (and its `tools` array) at MODULE scope, outside any component, while `useKhavee()`'s new gesture setter only exists inside the React tree.
   - What's unclear: whether this phase's plan should include a new/updated demo page exercising `set_gesture` end-to-end (useful for the phase's human-verify checkpoint, matching Phase 10/11's `openai-avatar-test`/`glb-avatar-test` precedent), and if so, whether it should use `registerFunction()` post-construction (inside a `useEffect`) or restructure tool construction to happen inside a component.
   - Recommendation: planner should scope a small demo-page task (or reuse an existing one) specifically to exercise GEST-01 end-to-end for verification purposes, using `registerFunction()` inside a `useEffect` after the provider is available via `useKhavee()`/`useRealtime()` — this avoids restructuring the existing module-scope-provider-construction pattern other demo pages already rely on.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase has no auth surface — unrelated to gaze/gesture |
| V3 Session Management | No | Unrelated |
| V4 Access Control | No | Unrelated |
| V5 Input Validation | Yes (narrow) | The `gesture` argument arriving from the LLM's tool call is untrusted input (an LLM can, in principle, emit a value outside the declared `['nod','shake','none']` enum, e.g. due to a model error or an adversarial prompt). The app's `execute` callback (and/or the SDK-internal consumer reading `gestureHint` off context) should validate/narrow the incoming string against the exact enum before using it to select a bone-delta branch, defaulting to a no-op for any unrecognized value — mirroring this codebase's existing input-clamping convention (`Math.max(0, Math.min(1, volume))` in `KhaveeProvider.tsx`, `setExpression`'s clamp). |
| V6 Cryptography | No | Unrelated |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM emits an out-of-enum or malformed `gesture` value (model hallucination, not malice, is the realistic threat model here — this is a client-side cosmetic feature, not a trust boundary) | Tampering (of application state/behavior, not data) | Explicit `switch`/allow-list check against `'nod'\|'shake'\|'none'` before branching bone-delta logic; unrecognized values treated as `'none'` (no-op), never thrown as an uncaught error that could crash the render loop |

This phase has no network I/O, no new credentials, and no user-supplied data beyond an LLM-mediated enum string — the security surface is narrow and adequately covered by input validation on that one value.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection (this session): `packages/react/src/animation/{breathing,sway,expressionDrift,blink,talkCycle,crossfade,audioAmplitude,AnimationStateEngine,types}.ts`, `packages/react/src/{VRMAvatar,GLBAvatar,KhaveeProvider}.tsx`, `packages/core/src/{index.ts,tools/animate.ts,types/realtime.ts,types/conversation.ts}`, `packages/core/package.json`, `packages/react/package.json`
- Headless verification script run this session (GLTFLoader.parse() + VRMLoaderPlugin against the real bundled `public/models/male.vrm` and `public/models/happy.glb`) — confirms `getHumanoidBoneNode("neck"|"head")` resolves on both assets
- `gh api repos/khavee-ai/khavee-sdk/issues/12` and `/13` (this session) — full decision-comment text of the two wayfinder tickets this phase implements, cross-checked verbatim against CONTEXT.md's D-01..D-06 (no drift found)
- `.planning/phases/wayfinder-map-1-animation-architecture/PERFORMANCE-BUDGET.md` §4-5 (existing project doc) — composition/allocation-reuse rules, and an explicit prior flag that gaze's "look-at target solve" is expected to eventually need separate throttling consideration from the cheap slerp-toward-target part (§5, "Future: Gaze (system 6, unspec'd)")

### Secondary (MEDIUM confidence)
- [three-vrm GitHub issue #1173, "Getting older VRM character to look at the camera"](https://github.com/pixiv/three-vrm/issues/1173) — confirms three-vrm has no built-in look-at API for this purpose, confirms `Object3D.lookAt()` is the naive-but-broken approach (absolute overwrite, no clamp, axis-inversion complaints), used to justify this research's Pitfall 1/4 recommendations
- [VRM specification, humanoid.md](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md) and community sources (vrm.dev) — VRM 1.0 root-level -Z forward-facing convention; VRM 0.x is +Z, auto-corrected by three-vrm at load time

### Tertiary (LOW confidence)
- None — all WebSearch/WebFetch findings above were cross-checked against either an official spec/repo or this codebase's own verified behavior before being included.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every dependency's exact role was confirmed by reading real installed type declarations (`@react-three/fiber`'s `store.d.ts`/`loop.d.ts`)
- Architecture (plumbing, composition order, tool shape, bone resolution): HIGH — verified by direct source reading and a real headless replay against the actual bundled assets, not assumption
- Architecture (gaze camera-relative delta math specifically): MEDIUM — sound three.js-idiomatic approach cross-checked against a real community issue, but the exact per-rig axis convention was not empirically verified against the bundled assets in this session (flagged as Open Question 1, recommended as an early implementation-time spike)
- Pitfalls: HIGH — four of five pitfalls are drawn directly from this session's source reading (unexported tool, plumbing-visibility mismatch, starting/stopped no-op requirement) or a directly-relevant external issue (lookAt overwrite behavior); one (coordinate-space) is a documented risk, not yet empirically closed
- Numeric parameters (gesture/gaze amplitude, duration): MEDIUM — no external benchmark sought (per CONTEXT.md's explicit instruction to follow internal precedent only); extrapolated from breathing/sway/blink's existing values, logged as Assumption A1

**Research date:** 2026-07-17
**Valid until:** 30 days (stable internal codebase; no fast-moving external dependency risk since no new packages are introduced)
