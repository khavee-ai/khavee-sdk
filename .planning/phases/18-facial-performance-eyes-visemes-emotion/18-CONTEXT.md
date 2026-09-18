# Phase 18: Facial Performance — Eyes, Visemes & Emotion - Context

**Gathered:** 2026-09-18
**Status:** Ready for planning

<domain>
## Phase Boundary

The face carries the performance — the avatar makes real eye contact, its mouth matches what is actually being said, and its expression follows the emotional content of the reply rather than drifting at random. Three subsystems: eye-bone gaze with blink coupling, viseme lip-sync from TTS timing data, and an LLM-driven emotion channel that drives expression + gaze + gesture.

</domain>

<decisions>
## Implementation Decisions

### Eye Movement
- **D-01:** Anime-natural blend style — eyes follow camera/target smoothly with occasional subtle saccades. Not photorealistic; matches VRM anime aesthetic.
- **D-02:** Blinks coupled to gaze shifts — blink triggers when eye target changes significantly, not on a random independent timer.
- **D-03:** Separate eye module (e.g. `eyeGaze.ts`) — do not extend the existing 531-line `gaze.ts`. Two modules: head-bone gaze stays in `gaze.ts`, eye-bone gaze in a new file. They coordinate but are architecturally separate.
- **D-04:** VRM lookAt first, bone fallback — use `vrm.lookAt` when available (standard VRM API), fall back to direct eye-bone rotation when lookAt is not supported. This reverses `gaze.ts`'s existing decision to avoid `vrm.lookAt`.

### Viseme Lip-Sync
- **D-05:** Hybrid viseme source — use TTS provider phoneme/word timestamps when available (highest quality). Fall back to improved client-side audio analysis when timestamps aren't provided. Maximum compatibility across providers.
- **D-06:** Coarticulation smoothing — neighboring visemes influence each other's mouth shape (e.g. 'ba' vs 'bi'). Not just simple crossfade between shapes.
- **D-07:** Additive jaw-bone motion — blendshapes for mouth shape PLUS jaw bone rotation for open/close. More dimensional than blendshapes alone.
- **D-08:** Coexist with deprecation — new viseme system lives alongside `useAudioLipSync.ts`. Mark the old hook as deprecated. Consumers migrate at their own pace.

### Emotion Channel
- **D-09:** Tool/function calling mechanism — LLM calls `set_emotion()` tool with structured data. Works with existing `ToolExecutor`. Reliable, typed.
- **D-10:** Pre-response emotion call — LLM calls `set_emotion()` before the spoken reply begins, not mid-stream. Expression transition happens during the thinking→speaking gap.
- **D-11:** Built-in SDK helper — SDK exports `createEmotionTool()` that returns the tool definition + system prompt additions. Beginner-friendly, zero-config emotion support.
- **D-12:** Full emotion-driven performance — emotion influences facial expression + gaze behavior (e.g. sad = more aversion) + gesture selection. Not just face expressions.

### Expression Mapping
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Eye Gaze (Phase 12 foundation)
- `packages/react/src/animation/gaze.ts` — Existing head-bone gaze system (531 lines). D-03 creates a SEPARATE eye module, not an extension of this file.
- `.planning/phases/12-gaze-gesture/12-CONTEXT.md` — Phase 12 decisions on gaze behavior, mode switching, smoothing

### Expression System
- `packages/react/src/animation/expressionDrift.ts` — Rest-state expression drift (344 lines). D-15 keeps this as a base layer under emotion.
- `packages/react/src/animation/crossfade.ts` — Crossfade/easing utilities. D-14 reuses these patterns.

### Lip-Sync (current, to be superseded)
- `packages/react/src/hooks/useAudioLipSync.ts` — Current MFCC-based phoneme detection (591 lines). D-08 deprecates but coexists.
- `packages/react/src/hooks/useRealtime.ts` — Contains embedded `RealtimeAudioAnalyzer` for lip-sync. Consumes lip-sync data.

### Tool Calling
- `packages/providers/openai-stt-tts/src/ToolExecutor.ts` — Existing tool executor. D-09 emotion tool integrates with this pattern.
- `packages/core/src/types/realtime.ts` — `RealtimeTool` interface for tool definitions.

### Avatar Components
- `packages/react/src/VRMAvatar.tsx` — Main avatar component, applies expressions, runs `vrm.update(delta)`
- `packages/react/src/KhaveeProvider.tsx` — Provides `chatStatus` context consumed by emotion/gaze systems

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `crossfade.ts` — `easeInOutCubic` and lerp patterns for smooth expression transitions (D-14)
- `expressionDrift.ts` — Drift architecture (step-per-frame, additive values) serves as the base layer pattern (D-15)
- `ToolExecutor` — Name→function registry for tool calling, directly reusable for emotion tool (D-09)
- `gaze.ts` — Coordinate system, target tracking, and smoothing patterns to reference for eye module (D-03)

### Established Patterns
- Additive expression writes via `setValue` (never overwrite) — `expressionDrift.ts` convention
- Per-frame `step(delta)` pattern for animation modules — used by gaze, breathing, sway, expressionDrift
- Scratch vector reuse pattern — module-scoped THREE.Vector3 to avoid per-frame allocation

### Integration Points
- `VRMAvatar.tsx` orchestrates all animation modules in its `useFrame` callback
- `KhaveeProvider.tsx` exposes `chatStatus` — emotion system will need a new context value for active emotion
- `useRealtime.ts` wires provider callbacks to React state — viseme data flows through here
- `RealtimeProvider` interface may need a new event callback for emotion/viseme timing data

</code_context>

<specifics>
## Specific Ideas

- Emotion tool API: `set_emotion({ emotion: 'happy', intensity: 0.7 })` — plain JS objects, no schema library (per SDK's beginner DX constraint)
- Eye gaze: anime-natural blend — subtle enough that it reads as alive, not uncanny-valley realistic
- The 6 core emotions (happy, sad, angry, surprised, neutral, thinking) map to VRM standard expressions where available, with 'thinking' using a custom blend
- Viseme hybrid: when TTS provider gives timestamps, use them for perfect sync; when not, improved client-side analysis as fallback

</specifics>

<deferred>
## Deferred Ideas

- Extended emotion set (10+ emotions like confused, curious, excited, disgusted, embarrassed) — requires models with matching blendshapes, deferred to future phase
- ARKit 52 / Perfect Sync blendshape support — deferred to asset quality track (not an engineering phase)
- Mid-stream emotion changes (emotion shifts mid-sentence) — D-10 chose pre-response only; mid-stream is future work
- Replace useAudioLipSync.ts entirely — D-08 chose coexistence with deprecation; full removal is a future cleanup phase

</deferred>

---

*Phase: 18-facial-performance-eyes-visemes-emotion*
*Context gathered: 2026-09-18*
