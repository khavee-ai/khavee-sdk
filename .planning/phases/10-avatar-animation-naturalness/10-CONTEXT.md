# Phase 10: Avatar Animation Naturalness — Procedural Life Layer - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a procedural life layer to `VRMAvatar` in `packages/react/` that makes the avatar feel continuously alive (breathing, head micro-movement, eye gaze shifts, micro-expressions, procedural finger movement) on top of the existing FBX animation system. Also add built-in auto-mapping from `chatStatus` to animation keys so developers get sensible behavior without manual `useEffect` wiring.

**Scope**: `packages/react/` and `packages/core/` (types only if needed). No changes to `src/app/`, `wordpress-plugin/`, or any other package.

**Non-scope**: New animation file formats, ML-based motion, server-side features, lip-sync changes (already handled), breaking the existing FBX loading/remapping pipeline.

</domain>

<decisions>
## Implementation Decisions

### chatStatus → Animation Auto-Mapping (D-01 to D-03)

- **D-01:** **Key-name exact match**. If an animation key in the `animations` prop is exactly `'idle'`, `'listening'`, `'thinking'`, or `'speaking'`, the SDK auto-plays it when `chatStatus` changes to that value. No extra prop needed — developer names animations after statuses. Keys with other names are unaffected and still triggerable via `animate()`.
- **D-02:** **Speaking variety via name-pattern matching**. When `chatStatus` is `'speaking'`, the SDK randomly picks from ALL animation keys whose name contains `'speak'`, `'talk'`, or `'gesture'` (case-insensitive substring match). A new random one is selected on each new speaking turn. This enables natural gesture variety without extra wiring.
- **D-03:** **Fallback**: if `chatStatus` changes but no matching animation key is found, the SDK does nothing (current animation continues). No error thrown.

### Procedural Layer API Surface (D-04)

- **D-04:** **Individual boolean props** on `VRMAvatar`, all defaulting to `true`. Existing `enableBlinking` stays. New props: `enableBreathing`, `enableHeadMovement`, `enableEyeGaze`, `enableMicroExpressions`, `enableHandGestures`. Each can be set independently to `false` to disable that layer.

### Eye Gaze System (D-05)

- **D-05:** Use **`vrm.lookAt.target`** (VRM's built-in look-at system) by attaching an invisible `THREE.Object3D` as the target and drifting it with slow smooth noise each frame. VRM handles per-model bone vs. blendshape routing automatically. Do NOT drive eye bones directly.

### Bone-Level Procedural Layers (D-06)

- **D-06:** **Additive bone deltas on top of FBX**. Each frame after the animation mixer updates, apply small procedural offsets to VRM humanoid bones:
  - **Breathing**: add `Math.sin(time * breathSpeed) * breathAmp` to `spine` and `chest` rotation.x (subtle scale: ±0.015–0.025 rad)
  - **Head micro-movement**: add smooth noise (e.g. multi-octave sine sums) to `head` rotation.x/y (subtle: ±0.02–0.04 rad), with slow drift (~0.2–0.5 Hz)
  - The FBX animation still plays at weight 1.0 — procedural offsets are applied AFTER the mixer updates bones each frame, so they are additive.

### Micro-Expressions (D-07)

- **D-07:** SDK provides a **built-in curated micro-expression schedule**, enabled by default (toggled via `enableMicroExpressions`). Internal map:
  - `listening`: randomly blend `happy` at 0.10–0.15 and/or `surprised` at 0.04–0.06 with slow lerp
  - `thinking`: blend `neutral` at ~0.08–0.12 with occasional micro-shifts
  - `idle`: blend `relaxed` at ~0.06–0.10
  - `speaking`: no micro-expressions (lip-sync/audio drives expression during speech)
  - Expressions change slowly (every 3–8 seconds) with smooth lerp transitions. Values are intentionally low to stay subtle.
  - These blend WITH any expressions the developer sets via `setExpression()` — additive, not overriding.

### Hand Gestures / Procedural Finger Movement (D-08)

- **D-08:** **Procedural finger curl noise** driven by per-finger sine waves with different phases. Apply small rotation offsets to available VRM finger bones (`leftIndexProximal`, `leftMiddleProximal`, `leftRingProximal`, `leftLittleProximal`, `leftThumbProximal`, and right-hand equivalents). Each finger gets a unique phase offset so they move independently. Amplitude ~0.015–0.025 rad, frequency ~0.6–1.2 Hz. Driven via `enableHandGestures` prop.

### Backward Compatibility (D-09)

- **D-09:** The existing FBX/GLB loading pipeline (`useAnimationFiles`, `processedClips`, animation mixer, crossfading) is preserved unchanged. All new procedural layers are additive and operate in the `useFrame` loop AFTER the mixer updates. The only prop-surface change is adding the new optional boolean props (all default `true`), so existing consumers that don't pass them continue to work.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Files to Read (required context)
- `packages/react/src/VRMAvatar.tsx` — Main component; all new code goes here or in a new co-located hook extracted from here
- `packages/react/src/KhaveeProvider.tsx` — `chatStatus` is exposed here; auto-mapping reads it from context
- `packages/react/src/hooks/useRealtime.ts` — Shows how `chatStatus` flows into React; not modified but must be understood
- `packages/react/src/utils/remapMixamoAnimationToVrm.ts` — FBX remapping utility; must remain intact
- `packages/core/src/types/realtime.ts` — `ChatStatus` type definition; check if it needs extension for new statuses
- `packages/core/src/types/conversation.ts` — Likely where `ChatStatus` is defined

### VRM API Reference
- `node_modules/@pixiv/three-vrm/` — VRM humanoid bone access (`vrm.humanoid.getRawBoneNode(boneName)`), lookAt system (`vrm.lookAt.target`), expressionManager (`vrm.expressionManager.setValue(name, value)`)
- VRM bone names reference: `head`, `neck`, `spine`, `chest`, `hips`, `leftIndexProximal`, `leftMiddleProximal`, `leftRingProximal`, `leftLittleProximal`, `leftThumbProximal` (and `right*` equivalents), `leftEye`, `rightEye`

### No External Specs
No external specs or ADRs beyond the roadmap and code above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`useFrame` loop in `VRMAvatar.tsx`** (line ~379): Already runs every frame for blinking + mixer update. All procedural layers should be added here in the correct order: (1) mixer.update(delta), (2) bone procedural deltas, (3) expression application, (4) blinking, (5) `vrm.update(delta)`.
- **`lerpExpression()`** in `VRMAvatar.tsx` (line ~364): Can be reused or extended for micro-expression blending.
- **`blinkState` / `isBlinking` refs**: Pattern for procedural expression animation with ref-based timing. Micro-expressions should follow the same ref-based timing pattern (not useState to avoid re-renders).
- **`currentVrm.expressionManager`**: Already used; micro-expressions call `setValue()` directly like blinking does.
- **`mixerRef.current`**: Animation mixer. Bone deltas applied AFTER `mixerRef.current.update(delta)`.

### Established Patterns
- **Ref-based per-frame state** (not useState): `nextBlinkTime`, `isBlinking`, `blinkAnimationRef` are all `useRef` — avoid React re-renders for 60fps animation state. Follow this for all new procedural layers.
- **Conditional guard on `currentVrm?.expressionManager`**: Every `useFrame` callback guards on VRM readiness. New code must do the same.
- **chatStatus comes from `useKhavee()` context**: Currently unused in `VRMAvatar`. Auto-mapping reads it from the same context.

### Integration Points
- **`useKhavee()` in VRMAvatar**: Already imported and destructured (`setVrm`, `expressions`, `currentAnimation`, `animate`). Add `chatStatus` to the destructure list for auto-mapping.
- **`currentAnimation` in KhaveeProvider**: The auto-mapping logic sets this via `animate(animationName)` when chatStatus changes. Use the existing `animate` callback.
- **FBX name-to-clip matching** (line ~323): `processedClips.find((clip) => clip?.name === currentAnimation)`. The speaking-variety random picker selects a key name; this lookup will find the right clip.

</code_context>

<specifics>
## Specific Requirements from Discussion

- The user wants the avatar to feel "natural like a human" — emphasis on subtlety and continuous motion, not dramatic animation swings
- FBX system MUST remain fully operational — all new features are additive layers, zero breaking changes
- Hand gestures: procedural finger curl noise (no new FBX files required for basic hand life)
- Developers should still be able to provide hand gesture FBX animations (e.g. `gesture_hand_wave`) that get picked by the speaking-variety system
- All boolean props default to `true` (opt-out model, not opt-in) for maximum out-of-box naturalness
- The micro-expression schedule values are intentionally subtle (≤ 0.15) to avoid looking over-animated

</specifics>

<deferred>
## Deferred Ideas

- Tunable amplitude/speed per procedural layer (e.g. `breathingSpeed`, `headMovementIntensity`) — deferred; add as a follow-up once the boolean-prop API proves useful. Phase 10 only ships on/off controls.
- Developer-configurable micro-expression schedule (custom expressions per status) — deferred; SDK's built-in schedule is fixed this phase.
- Blend tree / state machine for complex animation graphs — out of scope; FBX + procedural additive is sufficient for now.
- Physics-based hair/cloth simulation — out of scope for this phase.
- ML-based motion retargeting — out of scope.

</deferred>

---

*Phase: 10-avatar-animation-naturalness*
*Context gathered: 2026-07-01*
