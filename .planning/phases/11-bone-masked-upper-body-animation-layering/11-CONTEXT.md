# Phase 11: Bone-Masked Upper-Body Animation Layering - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the current whole-skeleton FBX crossfade on `chatStatus` transitions (`VRMAvatar.tsx`'s `currentAnimation` effect, ~line 489) with bone-masked layering: a continuous base clip drives lower-body bones (hips/spine/legs/feet) at all times, while a separate upper-body layer drives chest/neck/head/shoulders/arms/hands. The upper-body layer defaults to the idle clip's own upper-body motion at rest, and crossfades to a gesture clip's upper-body tracks (listening/thinking/speaking) on `chatStatus` transitions — never touching the lower-body layer.

**Scope**: `packages/react/` only (`VRMAvatar.tsx` and any new animation-blending/track-filtering utility). `src/app/`, `wordpress-plugin/` are NOT touched.

**Non-scope**: Re-authoring existing demo FBX clips, a full blend-tree/state-machine UI, Avatar Forcing (cross-attention with user signals), bone masking for developer-triggered custom animations outside the four status keys.

</domain>

<decisions>
## Implementation Decisions

### Bone Split (D-01, D-02)

- **D-01:** **Base/lower-body set** (always driven by the continuous base clip, never swapped): `hips`, `spine`, `leftUpperLeg`, `leftLowerLeg`, `leftFoot`, `leftToes`, `rightUpperLeg`, `rightLowerLeg`, `rightFoot`, `rightToes`.
- **D-02:** **Upper-body set** (driven by the upper-body layer, crossfades between idle-upper and gesture clips): `chest`, `upperChest`, `neck`, `head`, `leftShoulder`, `leftUpperArm`, `leftLowerArm`, `leftHand` + all left finger bones, `rightShoulder`, `rightUpperArm`, `rightLowerArm`, `rightHand` + all right finger bones. Chest/upperChest/neck were explicitly placed in the upper set (not the literal roadmap wording of "spine/legs/hips" base) so gesture clips get coherent torso-lean + arm motion instead of a locked torso fighting arm movement.

### Head Bone Treatment (D-03)

- **D-03:** Head stays in the upper-body gesture mask — gesture FBX clips (listening/thinking/speaking) continue to drive the head bone, same as today. Phase 10's procedural head layer (breathing/nodding/thinking-tilt/gaze aversion) continues to apply additive deltas on top, unchanged. This phase does not attempt to exclude head from FBX control; it only fixes the whole-body snap by masking everything else.

### Custom Animation Scope (D-04)

- **D-04:** Bone masking applies ONLY to the four status-mapped keys' auto-triggered transitions (`idle`/`listening`/`thinking`/`speaking` via the existing `chatStatus` auto-mapping effect). Explicit developer calls to `animate('customName')` for any other animation key keep today's whole-skeleton crossfade behavior unchanged — this phase does not touch the generic `currentAnimation` effect's existing full-body swap path for non-status keys.

### Idle-Upper Fallback (D-05)

- **D-05:** The idle clip is treated as a full-skeleton clip. In addition to being the always-on base/lower-body layer, its upper-body tracks are sliced out and played as the DEFAULT upper-body layer action (an "idle-upper" action) whenever no gesture status is active. When a gesture clip (listening/thinking/speaking) becomes active, the upper-body layer crossfades from idle-upper to the gesture's upper-body-filtered clip; on returning to `ready`, it crossfades back to idle-upper. This keeps arm-swing/torso motion continuous at rest instead of freezing on bind pose.

### Crossfade Timing (D-06)

- **D-06:** Keep the existing 0.3s crossfade duration for upper-body layer swaps (idle-upper ↔ gesture clip) — same value as today's whole-body swap, no new tunable prop introduced this phase.

### Claude's Discretion

- Exact technical mechanism for producing filtered "upper-only" and "lower-only" `THREE.AnimationClip`s from the source clips (e.g., a `filterClipTracksByBoneSet()` utility operating on `clip.tracks` using the bone-name prefix before `.quaternion`/`.position`) — implementation detail, not discussed with user.
- Whether filtering happens once (memoized alongside `processedClips`) or lazily per-clip-first-use — implementation detail.
- Bone masking is understood to apply only to FBX/Mixamo-remapped clips and Mixamo-named GLB clips (both go through `remapMixamoAnimationToVrm`, producing VRM-normalized bone-name tracks). Non-Mixamo GLB clips with arbitrary bone names are out of scope for masking (edge case, not raised by user) — Claude's discretion on exact fallback behavior (e.g., treat as before: full-skeleton swap) if such a clip is ever used for a status key.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Files to Read (required context)
- `packages/react/src/VRMAvatar.tsx` — Main component. The `chatStatus` auto-mapping effect (~line 428-486) selects which animation key to play; the `currentAnimation` effect (~line 489-521) is the whole-skeleton crossfade being replaced/extended for status-mapped keys only. The `useFrame` loop (~line 575-885) applies Phase 10's procedural bone deltas AFTER `mixerRef.current.update(delta)` — new upper/lower mixer updates must preserve this ordering.
- `packages/react/src/utils/remapMixamoAnimationToVrm.ts` — Confirms track naming convention: every track is named `${vrmNodeName}.${propertyName}` where `vrmNodeName` comes from `vrm.humanoid.getNormalizedBoneNode(vrmBoneName)?.name`. This is the mechanism bone-filtering will key off of.
- `packages/react/src/utils/mixamoVRMRigMap.ts` — Canonical list of all VRM humanoid bone names available from Mixamo-remapped clips (used to derive the D-01/D-02 bone-set constants): hips, spine, chest, upperChest, neck, head, left/rightShoulder, left/rightUpperArm, left/rightLowerArm, left/rightHand + finger bones (Proximal/Intermediate/Distal × thumb/index/middle/ring/little), left/rightUpperLeg, left/rightLowerLeg, left/rightFoot, left/rightToes.
- `.planning/phases/10-avatar-animation-naturalness/10-CONTEXT.md` — Phase 10's procedural layer decisions (D-04 through D-09). Bone-masking changes in this phase must not break Phase 10's additive breathing/head-movement/nodding/thinking-tilt/gaze-aversion/finger-curl deltas, which are applied unconditionally in the `useFrame` loop regardless of which FBX clip is currently bound.

### VRM API Reference
- `node_modules/@pixiv/three-vrm/` — `vrm.humanoid.getNormalizedBoneNode(boneName)` for bone lookup; `THREE.AnimationMixer.clipAction(clip, optionalRoot)` — multiple actions can be bound to the same mixer/root as long as their tracks target disjoint properties, which is exactly what the base/upper track-filtering achieves (no blend-weight conflict between simultaneously-playing base and upper actions).

### No External Specs
No external specs or ADRs beyond the roadmap and code above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`processedClips` memo** (`VRMAvatar.tsx` ~line 328): Already produces one full-skeleton `THREE.AnimationClip` per animation key via `remapMixamoAnimationToVrm`. New bone-filtering logic derives base/upper sub-clips FROM these, not from raw loaded data.
- **Existing crossfade pattern** (`currentAnimation` effect, ~line 489-521): `newAction.reset().fadeIn(0.3).play()` / `currentActionRef.current.fadeOut(0.3)` — reuse this exact fade pattern for the new upper-body-layer crossfade, just scoped to upper-only actions instead of whole-skeleton actions.
- **`chatStatus` auto-mapping effect** (~line 428-486): Already distinguishes the four status keys (`idle`/`listening`/`thinking`/`speaking`) from arbitrary `animate()` calls — this effect is the natural place to branch: status-key transitions drive the new upper/lower dual-layer path, everything else keeps calling `animate()` into the existing single-`currentAnimation` full-skeleton path unchanged.

### Established Patterns
- **Ref-based per-frame state** (not useState): mixer/action refs, timing refs — all `useRef`. New base/upper mixer-or-action refs should follow the same pattern (e.g., `baseActionRef`, `upperActionRef` alongside the existing `currentActionRef`).
- **Additive-after-mixer ordering** (Phase 10, D-06): procedural bone deltas apply strictly after `mixer.update(delta)` and before `currentVrm.update(delta)`. With two layers, both mixer/action updates must happen before procedural deltas so additive breathing/head/finger noise still layers on top of whichever base+upper blend result is current.

### Integration Points
- **Single mixer vs. dual mixer**: Since `THREE.AnimationMixer.clipAction()` can bind multiple actions to the same mixer/root, a single `mixerRef.current` can likely host both the base-lower action and the upper-layer action simultaneously (disjoint tracks = no conflict), avoiding the need for a second `THREE.AnimationMixer` instance. This is Claude's implementation discretion, not a locked decision.
- **`animationsRef.current`**: Already the stale-closure-safe source of truth for available animation keys (Phase 10 Pitfall 3) — the new masking logic reads from `processedClips` clips by name, same as today.

</code_context>

<specifics>
## Specific Ideas

- Motivated by user feedback (recorded in STATE.md) that Phase 10's hard animation-swap "feels stupid" and collides with the procedural head layer on head-heavy FBX clips — the fix here is scoped to eliminating the full-body snap; the head-bone/procedural interaction itself is intentionally left as-is per D-03 (not a full head-collision fix, just no longer compounded by unrelated lower-body snapping).
- User confirmed the smaller-scoped crossfade timing (keep 0.3s) and the smaller-scoped custom-animation exemption (D-04) — both favor a minimal, well-contained change over a broader animation-system rewrite.

</specifics>

<deferred>
## Deferred Ideas

- Excluding head entirely from gesture-clip control (full procedural head ownership) — considered and explicitly rejected this phase (D-03); could be revisited in a future phase if the head-bone collision resurfaces as a distinct problem.
- Bone masking for developer-triggered custom animations (`animate('dance')` etc.) — explicitly out of scope this phase (D-04); would be a separate, larger change to the generic animation API.
- Tunable crossfade duration as a new prop — deferred; 0.3s stays hardcoded per D-06.
- Bone masking for non-Mixamo GLB clips with arbitrary bone names — not raised, likely fine to leave unhandled/falls back to old behavior; revisit if it becomes a real use case.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.

</deferred>

---

*Phase: 11-bone-masked-upper-body-animation-layering*
*Context gathered: 2026-07-01*
