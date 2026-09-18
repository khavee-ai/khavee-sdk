# Phase 18: Facial Performance — Eyes, Visemes & Emotion - Research

**Researched:** 2026-09-18
**Domain:** Procedural VRM facial animation (eye-bone/`vrm.lookAt` gaze, viseme-driven lip-sync, LLM-emitted emotion tool-calling), integrated into an existing three.js/react-three-fiber/`@pixiv/three-vrm` animation stack
**Confidence:** HIGH for architecture/integration points (all read directly from source), MEDIUM for algorithm specifics (coarticulation smoothing, saccade parameters — no external library, hand-derived from established technique), LOW for D-05's primary viseme path feasibility (no wired TTS vendor currently emits timing data — see Pitfall 1)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Eye Movement
- **D-01:** Anime-natural blend style — eyes follow camera/target smoothly with occasional subtle saccades. Not photorealistic; matches VRM anime aesthetic.
- **D-02:** Blinks coupled to gaze shifts — blink triggers when eye target changes significantly, not on a random independent timer.
- **D-03:** Separate eye module (e.g. `eyeGaze.ts`) — do not extend the existing 531-line `gaze.ts`. Two modules: head-bone gaze stays in `gaze.ts`, eye-bone gaze in a new file. They coordinate but are architecturally separate.
- **D-04:** VRM lookAt first, bone fallback — use `vrm.lookAt` when available (standard VRM API), fall back to direct eye-bone rotation when lookAt is not supported. This reverses `gaze.ts`'s existing decision to avoid `vrm.lookAt`.

#### Viseme Lip-Sync
- **D-05:** Hybrid viseme source — use TTS provider phoneme/word timestamps when available (highest quality). Fall back to improved client-side audio analysis when timestamps aren't provided. Maximum compatibility across providers.
- **D-06:** Coarticulation smoothing — neighboring visemes influence each other's mouth shape (e.g. 'ba' vs 'bi'). Not just simple crossfade between shapes.
- **D-07:** Additive jaw-bone motion — blendshapes for mouth shape PLUS jaw bone rotation for open/close. More dimensional than blendshapes alone.
- **D-08:** Coexist with deprecation — new viseme system lives alongside `useAudioLipSync.ts`. Mark the old hook as deprecated. Consumers migrate at their own pace.

#### Emotion Channel
- **D-09:** Tool/function calling mechanism — LLM calls `set_emotion()` tool with structured data. Works with existing `ToolExecutor`. Reliable, typed.
- **D-10:** Pre-response emotion call — LLM calls `set_emotion()` before the spoken reply begins, not mid-stream. Expression transition happens during the thinking→speaking gap.
- **D-11:** Built-in SDK helper — SDK exports `createEmotionTool()` that returns the tool definition + system prompt additions. Beginner-friendly, zero-config emotion support.
- **D-12:** Full emotion-driven performance — emotion influences facial expression + gaze behavior (e.g. sad = more aversion) + gesture selection. Not just face expressions.

#### Expression Mapping
- **D-13:** Core 6 emotions — happy, sad, angry, surprised, neutral, thinking. Maps to VRM standard expressions. No extended set this phase.
- **D-14:** Smooth crossfade transitions — blend from current to new expression over ~300-500ms. Uses existing crossfade patterns from animation layer.
- **D-15:** expressionDrift as base layer — keep `expressionDrift.ts` running underneath. When no emotion signal is active, subtle rest-state drift continues. Emotion overrides drift when active. Face never looks static.
- **D-16:** Name + intensity parameter — `set_emotion({ emotion: 'happy', intensity: 0.7 })`. LLM can convey degree. Intensity maps to blendshape weight.

### Claude's Discretion
- Exact viseme-to-blendshape mapping table
- Saccade frequency, amplitude, and timing parameters
- Coarticulation smoothing algorithm specifics
- Jaw bone rotation range and mapping curve
- Fallback client-side audio analysis algorithm improvements
- Emotion-to-gaze behavior mapping details (which emotions affect gaze how)
- Emotion-to-gesture mapping details

### Deferred Ideas (OUT OF SCOPE)
- Extended emotion set (10+ emotions like confused, curious, excited, disgusted, embarrassed) — requires models with matching blendshapes, deferred to future phase
- ARKit 52 / Perfect Sync blendshape support — deferred to asset quality track (not an engineering phase)
- Mid-stream emotion changes (emotion shifts mid-sentence) — D-10 chose pre-response only; mid-stream is future work
- Replace useAudioLipSync.ts entirely — D-08 chose coexistence with deprecation; full removal is a future cleanup phase
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs (e.g. AUTH-01 style) were provided for this phase — REQUIREMENTS.md explicitly states: "Phase 18 — Requirements not yet defined — scope outlines only... To be specified at planning time." The 16 locked decisions (D-01..D-16) above are the closest equivalent to checkable requirements and should be used by the planner as the basis for deriving formal REQ-IDs during planning (see this document's Validation Architecture section, which anticipates that mapping using the decision IDs as a stand-in).
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Compatibility:** Must not break the existing `openai-stt-tts` provider or its consumers — it stays as-is, untouched, unless a task explicitly and narrowly extends it (see Pitfall 2 for why the emotion tool's tool-call loop may need this reconsidered — flag any such change explicitly rather than modifying it incidentally).
- **Language boundary:** No new cross-language/HTTP service integration is implied by this phase — everything is in-process TypeScript in `packages/react`/`packages/core`.
- **Beginner DX:** `createEmotionTool()` (D-11) must be usable by a beginner with no schema library — plain JS objects only, matching `toolGesture`'s existing shape.
- **Vendor neutrality:** Nothing in this phase should hardcode OpenAI-specific behavior into `@khaveeai/core`'s shared types (`RealtimeTool`, `PhonemeData`, `TTSProvider`) — any TTS-timestamp interface addition (Pitfall 1) must stay vendor-neutral, following `pipeline.ts`'s existing pattern of vendor-agnostic interfaces with adapter-level vendor mapping.
- **Naming conventions:** New modules follow existing PascalCase-class/camelCase-function/`use<Thing>`-hook conventions; new interfaces PascalCase without `I` prefix; event callbacks `on<Event>?`; boolean toggles `is<Thing>()`/`enable<Thing>()`.
- **Error handling:** Async methods normalize caught values via `error instanceof Error ? error : new Error(String(error))` before forwarding to `onError`, matching `openai-stt-tts`'s established pattern.
- **Comments:** New "pitfall" inline comments should reference this research/ticket IDs the same way existing code cites `(RESEARCH Pitfall N)`/`(T-12-0N)`/`(GEST-01)`-style tags.
- **GSD workflow enforcement:** All file-changing work must go through a GSD command (`/gsd:plan-phase` → `/gsd:execute-phase`), not direct ad-hoc edits.

## Summary

This phase adds three procedural facial subsystems on top of an already-mature, well-documented animation stack (`packages/react/src/animation/*.ts`). The codebase already established the exact patterns this phase should reuse: a `use<Thing>()` hook wrapping a pure `step(state, adapter, ...)` function, module-scoped `THREE.Quaternion`/`Vector3` scratch objects reused every frame, additive `bone.quaternion.multiply(delta)` composition (never `.set()`), and a documented, numbered composition order inside `AnimationStateEngine.ts`'s `update()` (currently 11 steps, gaze is step 10, gesture is step 11). Eye gaze and the emotion-driven expression layer are new steps 12+ in that same list. `packages/core/src/tools/gesture.ts` (`toolGesture` / `set_gesture`) plus `KhaveeProvider.tsx`'s `gestureHint`/`setGestureHint` context plumbing is the exact, already-shipped precedent for D-11's `createEmotionTool()` — copy this pattern for the emotion channel rather than inventing a new one.

The one significant risk this research surfaces: **D-05's primary viseme path ("use TTS provider phoneme/word timestamps when available") has no data source today.** The SDK's only wired TTS integration (`OpenAI TTS` via `openai-stt-tts`'s `TTSPlayer` and `generic-stt-tts`'s `OpenAITTSAdapter`) returns raw audio bytes only — OpenAI's TTS API does not emit word or phoneme timing in any form, confirmed by a live web search against the OpenAI developer community and docs. Vendors that do (ElevenLabs character-timestamp endpoints, Inworld AI phoneme+viseme timestamps) are not integrated anywhere in this repo. The plan must treat the TTS-timestamp path as a forward-compatible interface extension (optional field, e.g. on `TTSProvider.speak()`'s options/return, or `RealtimeEvents`) that the fallback path degrades gracefully without — and should budget for the fallback client-side analysis path being the one that actually ships and is verifiable this phase, since it is the only path with a real, testable data source.

The second major finding: `vrm.update(delta)` (three-vrm 3.4.2's `VRMCore.update`) calls `this.humanoid.update()` → `this.lookAt.update(delta)` → `this.expressionManager.update()`, in that fixed order, and `VRMAvatar.tsx` calls `currentVrm.update(delta)` **after** `controller.update(delta)` (the shared animation module containing all 11 existing steps). This means `vrm.lookAt`'s bone/expression writes happen strictly after every procedural system in `AnimationStateEngine.ts` runs — the eye-gaze module should therefore *set `vrm.lookAt.target` (or `.yaw`/`.pitch` directly)* during its `controller.update()` step and let three-vrm's own applier do the actual (absolute, not additive) bone/expression write afterward, rather than trying to layer an additive quaternion write onto eye bones that `vrm.lookAt` will unconditionally overwrite moments later. The bone-fallback path (when `vrm.lookAt` is absent or its applier is expression-based, not bone-based) is the one that needs the additive-quaternion-on-eye-bones treatment gaze.ts already models for the head bone — but that requires extending `AvatarFormatAdapter.getHumanoidBoneNode`'s role union (currently `"hips"|"spine"|"chest"|"upperChest"|"neck"|"head"`) to include `"leftEye"|"rightEye"`, both valid VRM humanoid bone names confirmed in `@pixiv/three-vrm-core`'s type definitions.

**Primary recommendation:** Build all three subsystems (`eyeGaze.ts`, viseme lip-sync, emotion tool) as new steps appended to `AnimationStateEngine.ts`'s existing numbered composition list, following the `gaze.ts`/`gesture.ts`/`expressionDrift.ts` hook+pure-function+scratch-object pattern exactly. Wire the emotion tool through `KhaveeProvider.tsx` context exactly like `gestureHint`. Treat TTS-timestamp viseme sourcing as an interface-only addition this phase (no real vendor to prove it against) and put the verification weight on the fallback client-side analysis path instead.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Eye-bone gaze target computation (camera-relative + micro-saccade) | Browser / Client (`packages/react/src/animation/eyeGaze.ts`, new) | — | Pure per-frame procedural math over a loaded `VRM` scene graph; no network/backend involvement, mirrors `gaze.ts` exactly |
| `vrm.lookAt` target/yaw-pitch write | Browser / Client (three-vrm's own `VRMLookAt.update()`, invoked inside `VRM.update()`) | — | Owned by the `@pixiv/three-vrm` library, not this SDK — the new module only sets `.target`/`.yaw`/`.pitch`, never writes eye bones directly on the primary path |
| Blink-on-gaze-shift coupling | Browser / Client | — | Both blink.ts and the new eye module run in the same `useFrame`/`controller.update()` loop; coupling is a same-tier signal, no cross-tier hop |
| Viseme target computation from TTS timestamps | Browser / Client (consumes timestamps already delivered to the browser) | Backend / TTS proxy (must originate the timestamp data) | The browser can only use timestamps a backend/vendor actually returns; today no backend in this repo returns them (see Pitfall 1) — this capability is currently blocked one tier up |
| Viseme target computation, client-side audio-analysis fallback | Browser / Client (`useAudioLipSync.ts`/`useRealtime.ts`'s existing Meyda/MFCC pipeline, to be improved not replaced per D-08) | — | Runs entirely on the already-decoded `AnalyserNode` output; no backend involvement |
| Coarticulation smoothing + jaw-bone additive motion | Browser / Client | — | Pure interpolation/blending over the viseme target stream, regardless of source |
| Emotion tool definition (`set_emotion` schema) | Browser/SDK-authored, transport-agnostic (`packages/core/src/tools/*.ts`) | — | A plain JS object + `execute` callback per `RealtimeTool`, works identically whether the transport is WebRTC (`OpenAIRealtimeProvider`) or turn-based HTTP (`GenericPipelineProvider`) |
| Emotion tool **execution loop** (LLM actually invoking the tool before replying) | API / Backend-adjacent (the realtime/pipeline provider's own tool-call round-trip) | — | Requires a provider with a real multi-round tool-call loop — see Pitfall 2: `OpenAISTTTTSProvider` has none today |
| Emotion → expression/gaze/gesture fan-out | Browser / Client (`KhaveeProvider.tsx` context → `AnimationStateEngine.ts` new step) | — | Same `gestureHint` precedent: state lives in React context, consumed by the shared animation module |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@pixiv/three-vrm` | `^3.4.2` [VERIFIED: package.json, confirmed installed at `.pnpm/@pixiv+three-vrm@3.4.2_three@0.180.0`] | `VRMLookAt`/`VRMLookAtBoneApplier`/`VRMHumanoid` — the eye-gaze primary path (D-04) and the source of VRM standard expression preset names for the 6 core emotions (D-13) | Already the SDK's sole VRM runtime; `VRMLookAt` is the standards-based VRM 1.0 eye-gaze API, confirmed present and typed in the installed package (`VRMLookAt.d.ts`, `VRMLookAtBoneApplier.d.ts`) |
| `three` | `^0.180.0` [VERIFIED: package.json] | `THREE.Quaternion`/`Vector3` scratch-object math for the bone-fallback gaze path and jaw-bone additive rotation (D-07) | Already the SDK's sole 3D math library; every existing animation module (`gaze.ts`, `gesture.ts`, `crossfade.ts`) uses it identically |
| `meyda` | `^5.6.3` [VERIFIED: package.json] | MFCC feature extraction powering the existing client-side phoneme classifier (`useAudioLipSync.ts`, `useRealtime.ts`'s `RealtimeAudioAnalyzer`) — the D-05 fallback path | Already integrated and working (with known jitter, per the phase's own problem statement); D-05/D-08 call for *improving*, not replacing, this pipeline |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new required | — | — | Every capability this phase needs (quaternion math, MFCC extraction, VRM humanoid/lookAt APIs) is already installed. No new npm dependency is needed for eyes, visemes, or the emotion tool itself. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled coarticulation smoothing (weighted lookahead blend over the existing 5-viseme target space) | A dedicated lip-sync library (e.g. Rhubarb Lip Sync, Oculus OVRLipSync) | Both are native binaries/external tools designed for offline batch processing of a fixed audio file, not a live streaming `AnalyserNode`/timestamp feed from an arbitrary TTS backend — integrating either would add a new runtime dependency and a Node-process bridge that contradicts the "Language boundary: integration is over HTTP" and "no new npm dependency" posture already established for this SDK. A hand-rolled weighted-blend smoother over the existing `MouthState { aa, ih, ou, ee, oh }` shape is proportionate to the actual mouth-shape vocabulary already in place. |
| Client-side TTS-timestamp estimation (proportional word-duration-from-character-count heuristic) | Real per-vendor timestamp APIs (ElevenLabs `convert-with-timestamps`, Inworld AI timestamps) | Real vendor timestamps are strictly better (sub-phoneme accurate) but require swapping the TTS vendor this SDK currently ships (OpenAI TTS, no timestamps) — out of this phase's scope per CONTEXT.md's Deferred Ideas (no vendor swap implied). A synthetic estimate is not a "TTS provider timestamp" in D-05's sense and should not be presented as satisfying the primary path — see Pitfall 1. |

**Installation:**
```bash
# No new packages required — @pixiv/three-vrm, three, and meyda are already
# dependencies of packages/react and packages/core.
```

**Version verification:** `@pixiv/three-vrm@3.4.2` and `three@0.180.0` confirmed installed via `find .../node_modules/.pnpm` — both match the versions declared in `packages/react/package.json`/`packages/core/package.json` (`^3.4.2`, `^0.180.0`). No registry lookup was needed since both are already resolved in the workspace lockfile; no drift risk for this phase.

## Package Legitimacy Audit

Not applicable — this phase introduces **zero new npm packages**. Every capability (VRM lookAt, quaternion math, MFCC extraction, tool-calling plumbing) is implemented against already-installed, already-audited dependencies (`@pixiv/three-vrm`, `three`, `meyda`, `@khaveeai/core`'s existing `ToolExecutor`/`RealtimeTool`). The Package Legitimacy Gate protocol is skipped per its own applicability condition ("whenever this phase installs external packages").

## Architecture Patterns

### System Architecture Diagram

```
LLM completion round (GenericPipelineProvider / OpenAIRealtimeProvider)
        |
        v
  tool call: set_emotion({emotion, intensity})  [D-09, D-10 — BEFORE final text reply]
        |
        v
  ToolExecutor.execute("set_emotion", args)  (packages/core — already shared, no per-provider duplication)
        |
        v
  app-supplied execute() callback --> KhaveeProvider.setEmotionHint(emotion, intensity)
        |                                        (new context field, mirrors gestureHint)
        v
  React context: emotionHint = {emotion, intensity} -------------------+
        |                                                              |
        v                                                              v
  VRMAvatar.tsx useFrame -> controller.update(delta)          [same frame]
        |
        |-- existing steps 1-11 (crossfade, blink, breathing, sway,     |
        |   spine clamp, expressionDrift, talkCycle, gaze, gesture)     |
        |                                                               |
        |-- NEW step 12: eyeGaze.step() -- sets vrm.lookAt.target/      |
        |   yaw-pitch (primary) OR additive eye-bone quaternion         |
        |   (fallback) + micro-saccade offset + blink-coupling signal   |
        |                                                               |
        |-- NEW step 13: emotion.step() -- crossfades expressionDrift's |
        |   base layer toward the target VRM expression preset (D-14,  |
        |   D-15), feeds gaze-behavior modifier + gesture-selection     |
        |   modifier (D-12)                                             |
        |
        v
  currentVrm.update(delta)  [VRMCore.update: humanoid -> lookAt -> expressionManager]
        |
        v
  Rendered frame: eyes tracking + expression crossfaded + mouth shape from viseme stream

Parallel, decoupled stream — viseme lip-sync:

TTS audio delivery (OpenAITTSAdapter.speak() / TTSPlayer.speak())
        |
        |-- [D-05 primary, NOT CURRENTLY WIRED] word/phoneme timestamp payload
        |        (no vendor in this repo emits this today -- Pitfall 1)
        |
        +-- [D-05 fallback, WORKING TODAY] AnalyserNode --> Meyda MFCC -->
                DTW phoneme match --> PhonemeData{phoneme, intensity}
                        |
                        v
                NEW: coarticulation smoothing (lookahead blend across
                consecutive viseme targets) + jaw-bone additive rotation (D-06/D-07)
                        |
                        v
                VRMExpressionManager.setValue(aa|ih|ou|ee|oh, weight)
                + adapter eye/jaw bone quaternion.multiply(delta)
```

### Recommended Project Structure
```
packages/react/src/animation/
├── eyeGaze.ts            # NEW (D-03) — eye-bone gaze, separate from gaze.ts
├── eyeGaze.test.ts        # NEW — pure-function unit tests, mirrors gaze.test.ts's stub-adapter pattern
├── viseme.ts              # NEW — coarticulation smoothing + jaw-bone motion, consumes PhonemeData/timing stream
├── viseme.test.ts          # NEW
├── emotion.ts              # NEW — emotion-driven expression crossfade + gaze/gesture modifiers (D-12, D-14, D-15)
├── emotion.test.ts          # NEW
├── gaze.ts                 # UNCHANGED — head-bone gaze stays exactly as-is (D-03)
├── expressionDrift.ts        # UNCHANGED structurally — emotion.ts composes ON TOP of it (D-15), does not replace it
├── gesture.ts                # UNCHANGED — emotion-driven gesture selection (D-12) calls the SAME triggered-pulse primitive, does not fork a second implementation
├── AnimationStateEngine.ts     # MODIFIED — append steps 12 (eyeGaze) and 13 (emotion), extend useAnimationController's params
└── types.ts                    # MODIFIED — extend AvatarFormatAdapter.getHumanoidBoneNode's role union with "leftEye"|"rightEye" (bone-fallback path only)

packages/core/src/
├── tools/
│   ├── gesture.ts          # UNCHANGED — existing precedent
│   ├── emotion.ts           # NEW (D-11) — createEmotionTool(): { tool: RealtimeTool, systemPromptAddition: string }
│   └── __tests__/emotion.test.ts  # NEW
└── types/
    └── pipeline.ts            # POSSIBLY MODIFIED — optional viseme-timing field on TTSProvider.speak() opts/return (D-05 forward-compat only, see Pitfall 1)

packages/react/src/
├── KhaveeProvider.tsx        # MODIFIED — add emotionHint/setEmotionHint context fields, mirroring gestureHint/setGestureHint exactly
├── VRMAvatar.tsx              # MODIFIED — thread emotionHint into useAnimationController, extend vrmAdapter if eye-bone fallback needs a new adapter method
└── hooks/
    ├── useAudioLipSync.ts        # MODIFIED, marked @deprecated (D-08) — coexists, not removed
    └── useRealtime.ts             # MODIFIED — RealtimeAudioAnalyzer improved per D-05 fallback scope; new viseme.ts consumed alongside, not instead of, its output
```

### Pattern 1: Hook + Pure-Function + Scratch-Object Module Shape
**What:** Every animation module in `packages/react/src/animation/` follows the identical shape: a `create<Thing>State()` factory returning a plain mutable object, a pure `step<Thing>(state, adapter, ...args, delta)` function that is independently unit-testable without React or a scene, and a thin `use<Thing>()` hook that wraps `state` in a `useRef` and returns `{ step }`. Module-scoped `THREE.Quaternion`/`Vector3` scratch objects are declared once at module load and reused every call — never `new`'d inside the per-frame path.
**When to use:** Every new procedural system this phase adds (`eyeGaze.ts`, `viseme.ts`, `emotion.ts`).
**Example:**
```typescript
// Source: packages/react/src/animation/gesture.ts (existing, verified pattern)
const _scratchGesture = new THREE.Quaternion(); // module-scoped, reused every step

export interface GestureState { activeGesture: "nod" | "shake" | null; elapsed: number; /* ... */ }
export function createGestureState(): GestureState { return { activeGesture: null, elapsed: 0, prevActionTime: null }; }
export function stepGesture(state: GestureState, params: GestureStepParams): void { /* pure, testable */ }
export function useGesture(): { step(params: GestureStepParams): void } {
  const stateRef = useRef<GestureState>(createGestureState());
  return { step: (params) => stepGesture(stateRef.current, params) };
}
```

### Pattern 2: React-Context Hint Bridge for LLM Tool Output
**What:** `KhaveeProvider.tsx` holds a small piece of state (`gestureHint`) with a PUBLIC setter (`setGestureHint`) specifically because the writer is an LLM tool's `execute` callback, constructed by app code *outside* the React tree — there is no other way for that code to reach React state. The setter validates/normalizes its input against an allow-list before storing (never throws). The consuming animation step (`gesture.ts`) calls an `onConsume` callback exactly once, the frame it starts acting on the hint, and the caller wires that to clear the hint so it cannot re-trigger.
**When to use:** D-11's emotion tool needs the identical bridge — `emotionHint`/`setEmotionHint` on `KhaveeContextType`, validated against the 6-emotion allow-list (D-13) plus an intensity clamp (D-16), consumed by the new `emotion.ts` step with its own `onConsume`.
**Example:**
```typescript
// Source: packages/react/src/KhaveeProvider.tsx (existing, verified pattern)
const setGestureHint = useCallback((gesture: string | null) => {
  if (gesture === 'nod' || gesture === 'shake') setGestureHintState(gesture);
  else setGestureHintState(null); // never throws — mirrors setExpression's clamp-not-throw convention
}, []);
```

### Pattern 3: VRM LookAt — Set the Controller, Not the Bone
**What:** `@pixiv/three-vrm`'s `VRMLookAt` (accessible as `vrm.lookAt`) is a stateful controller with `.target: THREE.Object3D | null`, `.autoUpdate: boolean`, and direct `.yaw`/`.pitch` setters (degrees). Calling `vrm.update(delta)` invokes `this.humanoid.update(); this.lookAt.update(delta); this.expressionManager.update();` in that fixed order [VERIFIED: `@pixiv/three-vrm-core@3.4.2`'s `lib/three-vrm-core.cjs`, `VRMCore.update()` body read directly] — `lookAt.update()` internally calls the applier (`VRMLookAtBoneApplier.applyYawPitch` for bone-based avatars), which **overwrites** the eye bones' rotation absolutely, not additively.
**When to use:** For the D-04 primary path, `eyeGaze.ts` should compute the desired gaze target/yaw-pitch (including micro-saccade offset) and assign it to `vrm.lookAt.target` or `vrm.lookAt.yaw`/`.pitch` during `controller.update()` (i.e., BEFORE `currentVrm.update(delta)` runs later in `VRMAvatar.tsx`'s `useFrame`). Do not attempt to also write the eye bones directly in this path — `vrm.lookAt.update()` will overwrite it moments later in the same frame, exactly the "full 360 degree rotation" class of bug `gaze.ts`'s header already documents avoiding for the head bone (three-vrm issue #1173).
**Example:**
```typescript
// Illustrative — no direct source, derived from VRMLookAt.d.ts + VRMCore.update() read above.
// eyeGaze.ts, primary path:
if (vrm.lookAt) {
  vrm.lookAt.autoUpdate = false; // this module owns the target, not three-vrm's own auto-track
  vrm.lookAt.pitch = computedPitchDegrees; // combines camera-relative target + saccade offset
  vrm.lookAt.yaw = computedYawDegrees;
  // vrm.lookAt.update(delta) — called later, inside currentVrm.update(delta) in VRMAvatar.tsx —
  // applies this to the eye bones (or expression blendshapes, if applier.type === "expression").
}
```

### Anti-Patterns to Avoid
- **Writing eye bones directly while `vrm.lookAt.autoUpdate` is still `true`:** three-vrm's own `lookAt.update()` will overwrite it unconditionally on the same frame (it runs after `controller.update()` in the established `useFrame` order) — the write will appear to do nothing, or flicker between two conflicting targets across frames.
- **Reimplementing the additive-clamped-quaternion idiom from `gaze.ts` for the PRIMARY (lookAt) path:** that idiom exists specifically because `Object3D`'s orient-toward-target methods are unclamped absolute overwrites with no composition story — `vrm.lookAt` already solves this correctly for VRM 1.0-conformant avatars via its own yaw/pitch range-mapping (`VRMLookAtRangeMap`). Only the bone-fallback path (no `vrm.lookAt`, or an expression-type applier with no eye bones to fall back to) needs `gaze.ts`'s additive-clamp treatment, reapplied to `leftEye`/`rightEye` instead of `head`.
- **Presenting a synthetic word-duration-from-character-count viseme timing estimate as "TTS provider timestamps":** it is not vendor data and does not carry D-05's accuracy guarantee — label any such heuristic clearly as part of the FALLBACK path, not the primary one.
- **Building a second, parallel tool-execution loop for the emotion tool:** `GenericPipelineProvider.ts` already has a correct multi-round `toolCalls.length === 0` terminal-condition loop (see Pitfall 2) — reuse it, do not add emotion-specific looping logic to a provider that lacks one (`OpenAISTTTTSProvider`) as a workaround.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VRM eye-gaze targeting/range-mapping | A second additive-quaternion eye-tracking system from scratch | `vrm.lookAt` (`VRMLookAt` + `VRMLookAtBoneApplier`/`VRMLookAtExpressionApplier`) for the primary path (D-04) | It is the VRM 1.0 standard, already installed, already handles horizontal-inner/outer and vertical-up/down range mapping correctly per-model via `VRMLookAtRangeMap` — reimplementing this is exactly the class of problem `gaze.ts`'s own header warns is easy to get wrong (documented three-vrm issue #1173) |
| LLM tool-call dispatch/registration | A per-provider `ToolExecutor` (the OLD, now-corrected anti-pattern) | `ToolExecutor` from `@khaveeai/core` (`packages/core/src/types/tools.ts`) | Already consolidated into one shared implementation (verified: only one `class ToolExecutor` exists in the whole repo, imported identically by all three providers) — do not reintroduce the duplication CLAUDE.md's (now-stale) architecture notes describe as a historical anti-pattern |
| Multi-round "tool call, then final text reply" orchestration | A bespoke loop inside the new emotion-tool wiring | `GenericPipelineProvider.ts`'s existing `while` loop (`result.toolCalls.length === 0` terminal condition) | Already correctly implements exactly the "tool call happens before the final text reply" shape D-10 requires — verified by reading the loop body directly |
| Quaternion clamping / angular-distance-bounded delta application | A new clamp helper for eye bones | The `angleTo()` + `copy().slerp()` idiom already used identically in `gaze.ts` (head bone), `AnimationStateEngine.ts` (spine clamp, PERF-01) | Proven, tested idiom; reapplying it to `leftEye`/`rightEye` for the bone-fallback path is a direct port, not new design |
| Expression crossfade easing | A new easing/tween implementation for emotion transitions | `crossfade.ts`'s `easeInOutCubic` (D-14 explicitly calls for reusing "existing crossfade patterns") | Already the codebase's one shared easing curve, used for clip crossfades, orphan fades, and settle ramps — reuse for the emotion→expression transition timer |

**Key insight:** This phase's biggest hand-rolling risk is NOT a missing algorithm — it's re-deriving infrastructure (tool dispatch, easing, quaternion clamping, bone-role resolution) that the codebase has already built, tested, and hardened across Phases 10-17. Every one of this phase's three subsystems has a structurally identical sibling already shipped (`gaze.ts` for eye-bone math, `gesture.ts` for the LLM-hint-to-procedural-pulse bridge, `expressionDrift.ts` for the additive-expression-with-ownership-guard pattern) — the work is composition and extension, not invention.

## Common Pitfalls

### Pitfall 1: D-05's Primary Viseme Path Has No Real Data Source in This Repo
**What goes wrong:** A plan is written assuming "use TTS provider timestamps when available" is close to a no-op wiring task, then discovers mid-implementation that no TTS integration in the codebase (`TTSPlayer.ts`, `OpenAITTSAdapter.ts`) returns anything but raw audio bytes, and the `TTSProvider`/`speak()` interface in `packages/core/src/types/pipeline.ts` has no timing field at all.
**Why it happens:** OpenAI's TTS API (the SDK's only wired vendor) does not natively provide word-level timestamps or phoneme timing — confirmed via a live web search against the OpenAI developer community forum and `developers.openai.com/api/docs/guides/text-to-speech` [CITED: OpenAI Developer Community, "Text to Speech Word Timings"; developers.openai.com/api/docs/guides/text-to-speech]. Vendors that do support this (ElevenLabs `convert-with-timestamps`, character-level `normalized_alignment`; Inworld AI phoneme+viseme timestamps) [CITED: elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps; docs.inworld.ai/tts/capabilities/timestamps] are not integrated anywhere in this repo (verified: zero matches for "elevenlabs"/"timepoint"/"alignment" across `packages/`).
**How to avoid:** Scope D-05's primary path as an INTERFACE addition only this phase (e.g., an optional `onWordBoundary`/timing field threaded through `TTSProvider.speak()`'s opts, defaulting to absent) — not a proven, tested vendor integration. Put verification/testing weight on the fallback client-side analysis path (D-08's "improved" `useAudioLipSync.ts`/`useRealtime.ts` pipeline), which has a real, already-working data source today. If a plan wants to demonstrate the primary path end-to-end, it needs a synthetic/mock TTS provider that fabricates timestamps for test purposes — clearly labeled as a test fixture, not a real vendor.
**Warning signs:** Any task description that says "wire TTS timestamps from OpenAI" or "wire TTS timestamps from JaiTTS" without first confirming that vendor's API actually returns them.

### Pitfall 2: `OpenAISTTTTSProvider` Has No Tool-Execution Loop — D-09/D-10 Silently No-Ops There
**What goes wrong:** A plan wires `set_emotion`/`set_gesture` tools into `OpenAISTTTTSProvider`'s config (`config.tools`), which does call `registerFunction()` for each tool at construction time, but `runTurnFromText()`'s actual `this.chatClient.complete({...})` call never passes `tools` and never inspects a tool-call response — the registered `execute` callbacks are simply never invoked. This is silent: no error, the LLM just never gets offered any tools at all in this provider's turn flow.
**Why it happens:** `OpenAISTTTTSProvider.ts`'s `runTurnFromText()` (read directly, lines 403-490) calls `this.chatClient.complete()` with only `messages`/`endpoint`/`authToken`/`model`/`temperature` — `ChatClient.complete()`'s request shape has no `tools` field and the response handling has no tool-call branch. By contrast, `OpenAIRealtimeProvider.ts` handles `response.function_call_arguments.done` events (line 722) and calls `this.toolExecutor.execute(msg.name, args)` (line 779), and `GenericPipelineProvider.ts` (`packages/providers/generic-stt-tts`) has an explicit multi-round loop calling `this.llm.complete({..., tools})` and looping while `result.toolCalls.length > 0` (lines 498-536).
**How to avoid:** The emotion tool (and the existing gesture tool) can only function end-to-end via `OpenAIRealtimeProvider` (WebRTC full-duplex, real per-turn function calling) or `GenericPipelineProvider` (turn-based, explicit multi-round tool loop). CONTEXT.md's canonical references list `packages/providers/openai-stt-tts/src/ToolExecutor.ts` — this file no longer exists as a standalone module (`ToolExecutor` was consolidated into `@khaveeai/core`'s `packages/core/src/types/tools.ts`); flag this stale reference to the planner. If the phase's demo/verification path is meant to exercise `OpenAISTTTTSProvider`, either (a) add tool-calling to its turn loop as an explicit new task, or (b) demo/verify the emotion tool against `OpenAIRealtimeProvider`/`GenericPipelineProvider` instead, matching how GEST-01/GEST-02 were actually verified (the demo app's `openai/page.tsx` only wires `OpenAIRealtimeProvider`, per CLAUDE.md's own component table).
**Warning signs:** A task that says "register `createEmotionTool()` on `OpenAISTTTTSProvider`'s config" without also adding a tool-call round-trip to that provider's turn flow.

### Pitfall 3: `vrm.lookAt` Overwrites What Micro-Saccades Additively Wrote, If Ordering Is Wrong
**What goes wrong:** A micro-saccade implementation additively rotates the eye bones directly (mirroring `gaze.ts`'s head-bone approach) while `vrm.lookAt.autoUpdate` is still `true` (its default). `vrm.lookAt.update(delta)` — called inside `currentVrm.update(delta)`, which runs AFTER `controller.update(delta)` in `VRMAvatar.tsx`'s `useFrame` — recomputes yaw/pitch from `vrm.lookAt.target` and overwrites the eye bones absolutely, erasing the saccade offset that frame.
**Why it happens:** `VRMLookAtBoneApplier.applyYawPitch()` sets bone rotation directly from its own rest-quaternion + computed yaw/pitch — it has no concept of "preserve what's already there," unlike this SDK's own additive-multiply convention (PERF-01).
**How to avoid:** Either (a) fold the saccade offset INTO the yaw/pitch value handed to `vrm.lookAt` itself (compute `baseYaw + saccadeYawOffset`, `basePitch + saccadePitchOffset`, then set `vrm.lookAt.yaw`/`.pitch` once, letting three-vrm apply the combined result), or (b) set `vrm.lookAt.autoUpdate = false` and drive the eye bones manually end-to-end for the primary path too (loses `VRMLookAtRangeMap`'s per-model calibration, generally not recommended). Option (a) is the correct approach and is cheap: yaw/pitch are plain numbers, easily summed before one write.
**Warning signs:** Saccades appear to have zero visible effect, or flicker erratically frame-to-frame, despite the saccade math itself testing correctly in isolation.

### Pitfall 4: `AvatarFormatAdapter` Has No Eye-Bone Role — Bone-Fallback Path Needs a Type Extension First
**What goes wrong:** The bone-fallback eye-gaze path (used when `vrm.lookAt` is absent, or its applier is `VRMLookAtExpressionApplier` with no eye bones at all) tries to call `adapter.getHumanoidBoneNode("leftEye")`, but the role union in `packages/react/src/animation/types.ts` is currently `"hips" | "spine" | "chest" | "upperChest" | "neck" | "head"` — a TypeScript compile error, not a runtime surprise.
**Why it happens:** `AvatarFormatAdapter` was built for the body-procedural-motion phases (breathing/sway/gaze on the head), which never needed eye-bone roles. `"leftEye"`/`"rightEye"` ARE valid VRM humanoid bone names (confirmed in `@pixiv/three-vrm-core`'s `VRMHumanBoneName.d.ts`: `LeftEye: "leftEye"`, `RightEye: "rightEye"`) — the gap is purely in this SDK's own adapter type, not in three-vrm.
**How to avoid:** Extend the role union in `types.ts` before writing `eyeGaze.ts`'s fallback branch. Since GLB has no established eye-bone-name convention in this SDK (unlike `spine`/`chest`/`hips`/`neck`/`head`, which `happy.glb` happens to name literally), the GLB adapter implementation of `getHumanoidBoneNode("leftEye"|"rightEye")` should return `null` — making eye gaze a VRM-only feature by construction (no GLB parity claim needed, unlike GAZE-02's explicit VRM/GLB symmetry requirement for head gaze).
**Warning signs:** A task description that treats eye-bone-fallback as "just call `getHumanoidBoneNode` like `gaze.ts` does" without noting the role union needs extending first.

### Pitfall 5: Blink-Coupling (D-02) Needs a New Trigger Surface — `blink.ts`'s Timer Is Currently Fully Internal
**What goes wrong:** A plan assumes blink-on-gaze-shift can be added by simply calling `blink.ts`'s existing `step()` from inside the new eye-gaze module, but `blink.ts`'s `nextBlinkTime`/`isBlinking`/`blinkAnimationRef` are private `useRef`s scoped inside its own `useBlink()` hook closure — there is no exported way to force an early blink or read/mutate the schedule from outside.
**Why it happens:** `blink.ts` was built as a fully autonomous, Date.now()-based idle-blink system (D-01 in Phase 11's original context, unrelated to this phase's D-02) with zero external inputs beyond an `enabled` flag.
**How to avoid:** `blink.ts` needs a signature change — either accept an optional `forceBlink: boolean` step parameter (set by the eye-gaze module when it detects a significant target change, mirroring how `gesture.ts` accepts an external `gestureHint`), or expose a `triggerBlink()` function from `useBlink()`'s return value that `AnimationStateEngine.ts`'s `update()` can call between steps. Either requires touching `blink.ts` itself, not just adding code around it — flag this as an explicit task, not an incidental one-liner.
**Warning signs:** A task that says "couple blink to gaze" without a corresponding sub-task to modify `blink.ts`'s public surface.

### Pitfall 6: `RealtimeEvents.onPhonemeDetected`/`onMouthStateChange` Already Exist But Are Narrowly Typed
**What goes wrong:** A plan designs a new viseme-timing event/callback from scratch, duplicating `RealtimeEvents.onPhonemeDetected?: (phoneme: PhonemeData) => void` and `onMouthStateChange?: (state: MouthState) => void`, which already exist on `RealtimeProvider`/`RealtimeEvents` (`packages/core/src/types/realtime.ts`) and are already wired end-to-end through `useRealtime.ts`'s `RealtimeAudioAnalyzer`.
**Why it happens:** These types are narrowly scoped to the existing 5-viseme space (`PhonemeData.phoneme: 'aa'|'ih'|'ou'|'ee'|'oh'|'sil'`, matching VRM's 5 standard mouth blendshape preset names exactly) with no word-boundary/timing field — easy to miss that they already exist and assume new plumbing is needed end-to-end.
**How to avoid:** Reuse `PhonemeData`/`MouthState` as the wire shape for BOTH the timestamp-driven primary path and the audio-analysis fallback path — extend `PhonemeData` with an optional `source?: "timing" | "audio-analysis"` and optional `wordBoundary?: boolean` field rather than inventing a parallel type. This keeps `useRealtime.ts`'s existing `onPhonemeDetected` consumers (and any future ones) working unmodified.
**Warning signs:** A new type named something like `VisemeEvent`/`VisemeData` appearing in a plan without first checking whether `PhonemeData` can be extended instead.

## Code Examples

### Existing shared-module hook shape (reuse for eyeGaze.ts / emotion.ts / viseme.ts)
```typescript
// Source: packages/react/src/animation/gaze.ts (verified, lines 508-531)
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

### Existing composition-order extension point (AnimationStateEngine.ts)
```typescript
// Source: packages/react/src/animation/AnimationStateEngine.ts (verified, lines 1286-1314)
// Steps 10-11 today; eyeGaze becomes step 12, emotion becomes step 13.
if (camera) gaze.step(adapter, camera, chatStatus, delta);

gesture.step({
  adapter, chatStatus, gestureHint: gestureHint ?? null,
  currentAction: currentActionRef.current, delta,
  onConsume: () => onGestureConsumed?.(),
});

// NEW — step 12 (illustrative, matches the established call shape):
// if (camera) eyeGaze.step(adapter, vrm, camera, chatStatus, delta);

// NEW — step 13 (illustrative):
// emotion.step({ adapter, emotionHint: emotionHint ?? null, delta, onConsume: () => onEmotionConsumed?.() });
```

### VRMCore.update()'s fixed internal order (why eyeGaze must set the controller, not the bone)
```javascript
// Source: node_modules/.pnpm/@pixiv+three-vrm-core@3.4.2_three@0.180.0/.../lib/three-vrm-core.cjs, line 3319-3327 (verified, read directly)
update(delta) {
  this.humanoid.update();
  if (this.lookAt) {
    this.lookAt.update(delta); // absolute overwrite of eye bones (or expression weights), NOT additive
  }
  if (this.expressionManager) {
    this.expressionManager.update();
  }
}
```

### Existing gesture tool definition (direct precedent for createEmotionTool())
```typescript
// Source: packages/core/src/tools/gesture.ts (verified, full file)
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
// D-11's createEmotionTool() should return { tool: RealtimeTool, systemPromptAddition: string } —
// note toolGesture itself is a bare object, not yet wrapped with an `execute` — check how
// KhaveeProvider/app code supplies `execute` (likely at RealtimeTool construction time in app code,
// calling setGestureHint) and mirror that exact wiring for setEmotionHint.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| MFCC/DTW phoneme classification from live spectral analysis (current `useAudioLipSync.ts`/`useRealtime.ts`) | Vendor-supplied word/phoneme timestamps consumed directly (where the vendor supports it) | Industry-wide shift as of ~2024-2026, per ElevenLabs' "New Text-to-Speech endpoints with timestamps" blog post and Inworld AI's timestamp docs [CITED] | Timestamp-driven lip-sync eliminates the inherent latency/jitter of spectral-analysis-based phoneme guessing entirely — but only for vendors that support it; OpenAI's TTS API does not as of this research (2026-09-18) |
| `Object3D.lookAt()` called directly on a live bone | Additive, clamped quaternion deltas computed in a scratch space and composed via `multiply()` | Established within this codebase during Phase 12 (documented in `gaze.ts`'s own header, citing three-vrm issue #1173) | This is already the SDK's own established convention — no further evolution needed, just extend the same pattern to eye bones for the fallback path |

**Deprecated/outdated:**
- Nothing in this phase's direct dependency set is deprecated. `meyda@5.6.3` and `@pixiv/three-vrm@3.4.2` are both current major versions as installed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Coarticulation smoothing can be adequately achieved via a weighted lookahead blend over the existing 5-target `MouthState` space (no phoneme-to-viseme remapping needed, since the space is already VRM's native 5 mouth blendshapes) | Alternatives Considered, Don't Hand-Roll | If a richer viseme vocabulary is later desired (e.g. full 15-viseme Preston Blair set), this smoothing approach would need rework — but D-13's "no extended set this phase" and the existing `PhonemeData` type both scope this to the 5-target space already, so risk is low |
| A2 | Emotion tool execution should target `GenericPipelineProvider`/`OpenAIRealtimeProvider`, not `OpenAISTTTTSProvider`, for end-to-end verification this phase | Pitfall 2 | If the planner instead insists on wiring `OpenAISTTTTSProvider`, an entire new tool-call round-trip must be added to that provider first — a much larger scope increase than the phase description implies |
| A3 | GLB eye gaze is out of scope (no bone-name convention, no VRM `lookAt` equivalent) | Pitfall 4 | If the planner intends GLB parity for eye gaze (unlike CONTEXT.md's decisions, which only discuss VRM/`vrm.lookAt` semantics), this needs an explicit new decision — not assumed here |
| A4 | `vrm.lookAt.yaw`/`.pitch` setters (degrees) are the correct integration point rather than `vrm.lookAt.target` (a `THREE.Object3D` for `autoUpdate`-driven tracking) | Pattern 3, Pitfall 3 | Using `.target` instead would require maintaining a dummy per-frame-repositioned `Object3D` for the saccade-offset target, which is workable but more indirection; either approach is valid per the type definitions read, this is a design preference not a confirmed constraint |

**If this table is empty:** N/A — see above.

## Open Questions (RESOLVED)

1. **Does D-05's primary (TTS-timestamp) path need to be functionally proven this phase, or is the interface addition alone sufficient?**
   - What we know: no TTS vendor wired in this repo emits timestamps (Pitfall 1, confirmed via source read + web search).
   - What's unclear: whether CONTEXT.md's "when available" framing means the planner should build a mock/test-fixture TTS provider with synthetic timestamps to prove the code path works, or whether an untested interface extension is acceptable for this milestone.
   - RESOLVED: Adopted in 18-03 — full interface + consumption code, proven with hand-built timing fixtures and a fake TTS; no live vendor call.
   - Recommendation: Build the interface + consumption code, add a unit test using a hand-constructed `PhonemeData[]` timing array as a stand-in for a real vendor response (no live vendor call needed) — proves the coarticulation/jaw-bone consumption logic without requiring a real timestamp-capable TTS integration this phase.

2. **Should `blink.ts`'s public surface change to accept a `forceBlink` trigger, or should the eye-gaze module read/write blink state directly?**
   - What we know: `blink.ts`'s scheduling state is currently fully private to its own `useBlink()` closure (Pitfall 5).
   - What's unclear: whether the planner prefers a minimal signature addition (`step(adapter, enabled, forceBlink?)`) or a more invasive refactor exposing a `triggerBlink()` method.
   - RESOLVED: Adopted in 18-01 Task 2 — minimal options-object addition (`forceBlink`/`coupled`) to blink's step call.
   - Recommendation: Minimal signature addition — smallest diff, consistent with how `gesture.ts` already accepts an external hint parameter into an otherwise-internal step function.

3. **Does the emotion tool's `execute` callback live in app code (like the gesture tool's documented example) or does the SDK's `createEmotionTool()` bundle a default `execute` that calls `setEmotionHint` directly?**
   - What we know: `toolGesture` in `packages/core/src/tools/gesture.ts` is a bare tool-shape object with NO `execute` attached — `KhaveeProvider.tsx`'s own JSDoc example shows app code supplying `execute: async ({gesture}) => { setGestureHint(gesture); return 'done'; }` manually.
   - What's unclear: D-11 explicitly asks for "Built-in SDK helper... zero-config emotion support" — this implies `createEmotionTool()` should be a step MORE integrated than `toolGesture`'s bare-object precedent (likely needs to accept `setEmotionHint` as a parameter and return a ready-to-register `RealtimeTool` with `execute` already wired), not an identical copy of the gesture pattern.
   - RESOLVED: Adopted in 18-02 Task 1 — `createEmotionTool(setEmotionHint)` factory with `execute` pre-wired.
   - Recommendation: Design `createEmotionTool(setEmotionHint: (emotion: string, intensity: number) => void): RealtimeTool` — a factory function, not a bare object — to actually satisfy "zero-config" (D-11) rather than requiring the app author to write the `execute` wiring by hand as `toolGesture` currently does.

## Environment Availability

Skipped — this phase has no new external tool/service/runtime dependencies. All required libraries (`@pixiv/three-vrm`, `three`, `meyda`) are already installed workspace dependencies; no TTS vendor swap, no new CLI, no new database/service.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.0.0 [VERIFIED: `packages/react/package.json`] |
| Config file | `packages/react/vitest.config.ts` — `environment: "node"`, `include: ["src/**/*.test.ts"]` |
| Quick run command | `pnpm --filter @khaveeai/react test -- <file-pattern>` |
| Full suite command | `pnpm --filter @khaveeai/react test` |

Per the workflow note in this task's scope ("The user never wants dev servers started — verification is via tsc/tests"), all new subsystems must be verifiable via `pnpm --filter @khaveeai/react test` and `tsc` alone, matching every existing animation module's pure-function-plus-stub-adapter test pattern (see `gaze.test.ts`, `gesture.test.ts`, `expressionDrift.test.ts` — all run under `environment: "node"`, no jsdom, no real WebGL/scene).

### Phase Requirement Requirements → Test Map
No REQ-IDs are mapped for Phase 18 yet (per REQUIREMENTS.md: "Phase 18 — Requirements not yet defined — scope outlines only... To be specified at planning time"). The planner should derive REQ-IDs from CONTEXT.md's D-01..D-16 decisions during planning; the table below anticipates that mapping using the decision IDs as a stand-in.

| Decision | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|--------------------|--------------|
| D-01/D-04 | Eye-bone gaze via `vrm.lookAt` primary, bone fallback | unit | `pnpm --filter @khaveeai/react test -- eyeGaze` | ❌ Wave 0 |
| D-02 | Blink triggers on significant gaze-target change | unit | `pnpm --filter @khaveeai/react test -- blink` (extend existing) | Existing file, needs new test cases |
| D-06/D-07 | Coarticulation smoothing + additive jaw-bone motion | unit | `pnpm --filter @khaveeai/react test -- viseme` | ❌ Wave 0 |
| D-09/D-11 | `createEmotionTool()` shape + `ToolExecutor` dispatch | unit | `pnpm --filter core test -- tools/emotion` | ❌ Wave 0 |
| D-13/D-14/D-15/D-16 | Emotion → expression crossfade, drift-as-base-layer composition | unit | `pnpm --filter @khaveeai/react test -- emotion` | ❌ Wave 0 |
| D-12 | Emotion → gaze/gesture fan-out | unit | `pnpm --filter @khaveeai/react test -- emotion` (same file, additional cases) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `pnpm --filter @khaveeai/react test -- <new-file>` + `pnpm --filter @khaveeai/react build` (tsc)
- **Per wave merge:** `pnpm --filter @khaveeai/react test` (full suite) + `pnpm --filter @khaveeai/core test`
- **Phase gate:** Full suite green across `@khaveeai/react` and `@khaveeai/core` before `/gsd:verify-work`. Per this phase's workflow notes, no dev server / live human-verify checkpoint should be assumed as the default gate — earlier phases in this milestone (15, 16) DID use `checkpoint:human-verify` for genuinely visual judgments (rim-tint color, contrast). If any Phase 18 outcome is similarly visual-only (e.g., "does the eye contact read as natural"), it needs the SAME explicit blocking checkpoint pattern — but the user's standing instruction ("never start dev servers... verify via tsc/tests") should shape the planner toward keeping as much as possible in the automated-test tier and minimizing checkpoint surface area.

### Wave 0 Gaps
- [ ] `packages/react/src/animation/eyeGaze.test.ts` — covers D-01/D-04
- [ ] `packages/react/src/animation/viseme.test.ts` — covers D-06/D-07
- [ ] `packages/react/src/animation/emotion.test.ts` — covers D-12/D-13/D-14/D-15/D-16
- [ ] `packages/core/src/tools/__tests__/emotion.test.ts` — covers D-09/D-11
- [ ] Existing `packages/react/src/animation/blink.test.ts` — does not currently exist (no `blink.test.ts` found in the animation directory listing); needs to be created alongside the D-02 coupling work, not just extended

## Security Domain

Not applicable for this phase's actual attack surface in the traditional ASVS sense — this is a client-side, browser-only procedural-animation phase with no new network endpoints, no new auth/session logic, and no new data persistence. The one relevant carry-over from existing convention: `KhaveeProvider.tsx`'s `setGestureHint` validates incoming LLM-tool-call values against an allow-list before storing them (documented inline as "T-12-04 tampering mitigation, since the value can originate from an LLM tool call"). The new `setEmotionHint` must apply the identical allow-list discipline — validate `emotion` against the 6-value D-13 set and clamp `intensity` to `[0,1]` (mirroring `setExpression`'s existing `Math.max(0, Math.min(1, value))` clamp), never trusting the LLM's tool-call arguments as pre-validated.

| Threat Pattern | STRIDE | Standard Mitigation |
|-----------------|--------|----------------------|
| LLM emits an out-of-range or malformed `set_emotion` tool call (e.g. `emotion: "<script>"`, `intensity: 999`) | Tampering | Allow-list validation + numeric clamp in `setEmotionHint`, mirroring the existing `setGestureHint`/`setExpression` pattern — never pass the raw LLM argument directly into `VRMExpressionManager.setValue()` |

## Sources

### Primary (HIGH confidence)
- `@pixiv/three-vrm-core@3.4.2` installed package — `types/lookAt/VRMLookAt.d.ts`, `types/lookAt/VRMLookAtBoneApplier.d.ts`, `types/humanoid/VRMHumanBoneName.d.ts`, and `lib/three-vrm-core.cjs`'s `VRMCore.update()` implementation — all read directly from the installed package in this workspace
- `packages/react/src/animation/gaze.ts`, `gesture.ts`, `blink.ts`, `expressionDrift.ts`, `crossfade.ts`, `types.ts`, `AnimationStateEngine.ts` — read in full/substantially, all direct source
- `packages/core/src/tools/gesture.ts`, `packages/core/src/types/pipeline.ts`, `packages/core/src/types/realtime.ts`, `packages/core/src/types/audio.ts`, `packages/core/src/types/tools.ts` — read directly
- `packages/react/src/KhaveeProvider.tsx`, `packages/react/src/VRMAvatar.tsx` (relevant sections), `packages/react/src/hooks/useAudioLipSync.ts`, `packages/react/src/hooks/useRealtime.ts` (grep + targeted reads) — read directly
- `packages/providers/openai-stt-tts/src/OpenAISTTTTSProvider.ts`, `TTSPlayer.ts`; `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`; `packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts`, `adapters/OpenAITTSAdapter.ts` — read directly for tool-call-loop and TTS-timing analysis

### Secondary (MEDIUM confidence)
- [OpenAI Developer Community: "Text to Speech Word Timings"](https://community.openai.com/t/text-to-speech-word-timings/532875) — community-confirmed absence of word timing in OpenAI TTS
- [OpenAI API docs: Text to speech guide](https://developers.openai.com/api/docs/guides/text-to-speech) — official docs, no timestamp field documented
- [ElevenLabs docs: Create speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps) — official docs, confirms character-level timestamp response shape (for context/comparison only, not integrated in this repo)
- [Inworld AI docs: Timestamps](https://docs.inworld.ai/tts/capabilities/timestamps) — official docs, confirms phoneme+viseme timestamp support exists industry-wide (for context/comparison only)

### Tertiary (LOW confidence)
- None used without cross-verification against source code or official docs above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all versions confirmed installed in this exact workspace
- Architecture/integration points: HIGH — every claim about composition order, `vrm.lookAt`/`VRMCore.update()` behavior, tool-call loop presence/absence, and `AvatarFormatAdapter`'s role union was read directly from source, not inferred
- Coarticulation/saccade algorithm specifics: MEDIUM — general technique knowledge (lookahead blending, sine-envelope pulses matching `blink.ts`/`gesture.ts`'s existing precedent), not sourced from an external spec since the mouth-shape space is this SDK's own 5-target convention, not a standard viseme set
- D-05 primary-path feasibility: LOW-confidence-that-it-ships-this-phase, HIGH-confidence-in-the-underlying-fact (no vendor timing data exists in this repo today) — the web search cross-verifying OpenAI's TTS API gap was corroborated by two independent sources (community forum + official docs) and by direct code inspection finding zero timing-related code anywhere in the TTS integration paths

**Research date:** 2026-09-18
**Valid until:** 30 days for the architecture/integration findings (stable, internal codebase facts unlikely to shift); reverify D-05's TTS-vendor-timestamp landscape specifically if this phase's execution is delayed more than ~60 days, since that is an actively evolving external API surface (ElevenLabs/Inworld shipped their timestamp endpoints relatively recently per the search results).
