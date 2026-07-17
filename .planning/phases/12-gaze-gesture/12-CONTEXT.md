# Phase 12: Gaze & Gesture - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning

<domain>
## Phase Boundary

The avatar visibly attends to the viewer (camera-relative soft gaze, per `chatStatus`) or looks away appropriately (`thinking`), and the LLM can trigger a `nod`/`shake` gesture through its normal tool-calling response that plays as a procedural bone-delta overlay without ever interrupting the ambient talk cycle. Covers GAZE-01, GAZE-02, GEST-01, GEST-02 only — idle/talking/transition procedural systems (Phase 11) and the public API surface (API-01..04, Phase 13) are out of scope here. Model loading and the crossfade engine (Phase 10) are untouched.

**Architecture is almost entirely pre-decided**, same as Phases 10 and 11. This milestone follows a completed wayfinder design map ([khavee-ai/khavee-sdk#1](https://github.com/khavee-ai/khavee-sdk/issues/1)) — Phase 12's job is implementation, not design. Discussion here focused on the genuinely open gaps the wayfinder tickets (#12, #13) left unresolved: exact tool shape/naming, gesture behavior outside the `speaking` state, and which camera reference gaze should track.

</domain>

<decisions>
## Implementation Decisions

### Gesture tool shape & LLM nudge
- **D-01:** The gesture-hint tool is a new exported plain-object factory, `packages/core/src/tools/gesture.ts`, mirroring `toolAnimate`'s existing shape (`packages/core/src/tools/animate.ts`) exactly — `name`, `description`, `parameters`, no `execute` field. The consuming app passes it into `config.tools` and wires `execute` itself (matching the beginner-DX "plain JS object, no schema library, app wires execute" pattern already established). The SDK does NOT auto-register this tool — it is opt-in, same as `toolAnimate`.
- **D-02:** Tool `name` is `set_gesture` (snake_case, matching `toolAnimate`'s `trigger_animation` convention and ticket #13's example verbatim). Parameter enum is exactly `['nod', 'shake', 'none']` — `'none'` lets the LLM explicitly opt out on a given turn rather than omitting the call.
- **D-03:** The tool's `description` field explicitly coaches the LLM on when to use each value (e.g., affirms/agrees/says-yes → `nod`; denies/disagrees/says-no → `shake`), unlike `toolAnimate`'s minimal/generic description. Rationale: nod/shake semantics are universal and language-agnostic (this SDK ships Thai support via Thonburian STT/JaiTTS — English-only keyword coaching would be a dead end), so baking guidance into the tool description gets zero-config correct behavior without every consuming app having to rediscover the right system-prompt wording.

### Gaze camera source
- **D-04:** Gaze targets R3F's active scene camera (`useThree().camera`), not `VRMAvatar`'s existing `cameras: THREE.Camera[]` prop. Matches ticket #12's stated rationale verbatim ("a THREE.Camera is always available in an R3F scene, zero new dependencies") and works even when a consuming app never passes the `cameras` prop. Confirmed symmetric: `GLBAvatar.tsx` has no `cameras` prop equivalent to check (`grep cameras GLBAvatar.tsx` returns 0 matches), so `useThree().camera` is the only option that's uniform across both formats by construction.
- **D-05:** Gaze is a **continuous subtle offset** toward the camera direction (a small, constantly-updated head/neck delta, clamped to a small max angle) — not occasional saccade-like glances. Mirrors breathing/sway's always-on sine-driven `step()` pattern exactly (same ref-driven shape, no new timing/scheduling system needed). Reads as steady attentiveness.

### Gesture queuing outside `speaking`
- **D-06:** When the LLM emits a gesture hint while `chatStatus` is `ready`/`listening`/`thinking` (i.e. no talk-clip cycle is running), the gesture **applies immediately** rather than queuing or being dropped. Rationale: ticket #13's "queue for the next natural loop boundary" constraint exists specifically to protect talk-clip cycling from being interrupted mid-play (GEST-02) — outside `speaking` there is no clip cycle to protect, so a nod/shake can play as soon as it's received. It remains a bounded procedural bone delta, not an interrupt of anything, consistent with the base decision in #13 that gestures never need a dedicated clip.

### Claude's Discretion
- Exact numeric parameters for gaze intensity (max offset angle, ramp/settle timing) and gesture delta magnitude/duration (head-pitch pulse for nod, head-yaw pulse for shake) — ticket #12 establishes the *mechanism* ("small-amplitude, randomized-range parameters, same precedent as #3's breathing/sway") but not exact numbers. Follow `breathing.ts`'s approach as the reference for how much numeric specificity this codebase expects.
- Whether gaze and gesture live in one new module or two small ones alongside `breathing.ts`/`sway.ts`/`expressionDrift.ts` — no mandate beyond staying internal (not exported from `index.ts`), matching the Phase 10/11 precedent.
- Exact plumbing mechanism for threading the gesture-hint signal from the tool's `execute` callback into `useKhavee()`/`KhaveeProvider` context (a new field/setter, likely mirroring how `currentVolume` was threaded through in Phase 11) — the planner should follow that established precedent rather than inventing a new seam.
- Composition order when gaze's head/neck delta and any existing procedural systems (breathing/sway target spine/chest/hips per Phase 11, so no direct bone overlap is expected) interact — PERF-01's fixed, documented, bounded-magnitude composition rule from Phase 11 (`AnimationStateEngine.ts`'s `update()`) is the pattern to extend, not redesign.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wayfinder map — locked architecture decisions (source of truth for this phase)
- GitHub issue [khavee-ai/khavee-sdk#12](https://github.com/khavee-ai/khavee-sdk/issues/12) — Gaze/attention system design (GAZE-01/02): in-scope, minimal, camera-relative (not tracked-user-position), per-state mapping (`ready`/`listening`/`speaking` → soft gaze toward camera, `thinking` → brief aversion, `starting`/`stopped` → no separate treatment), composed as an additive delta quaternion on head/neck, format-symmetric (bone-level, not expression-dependent).
- GitHub issue [khavee-ai/khavee-sdk#13](https://github.com/khavee-ai/khavee-sdk/issues/13) — Semantic gesture design (GEST-01/02): in-scope via LLM tool-calling (not keyword/regex, not a separate classification call — rejected specifically because keyword matching is English-only and this SDK ships Thai support), procedural (not a new clip), queues for the ambient talk-cycle's next natural loop boundary rather than interrupting mid-clip.
- GitHub issue [khavee-ai/khavee-sdk#1](https://github.com/khavee-ai/khavee-sdk/issues/1) — Wayfinder map overview/index, links all 14 resolved tickets.
- GitHub issue [khavee-ai/khavee-sdk#10](https://github.com/khavee-ai/khavee-sdk/issues/10) — Procedural delta layer performance budget research; gaze/gesture both cited in the objective checklist's frame-time budget item (`.planning/phases/wayfinder-map-1-animation-architecture/VERIFICATION-CHECKLIST.md`).
- `.planning/phases/wayfinder-map-1-animation-architecture/PERFORMANCE-BUDGET.md` — composition/allocation-reuse technique guidance (§4), directly informs how gaze/gesture's additive deltas should be written (multiply(), never set(), pre-allocated scratch quaternions).
- `.planning/phases/wayfinder-map-1-animation-architecture/VERIFICATION-CHECKLIST.md` — the objective "no live-clock interrupts in the speaking state" check explicitly names triggered semantic gestures (#13) queuing for the next natural loop boundary; the subjective `thinking` check ("does the gaze-aversion + posture actually read as processing") is this phase's human-verify target.

### Phase 10/11 precedent (procedural-layer pattern to extend)
- `packages/react/src/animation/breathing.ts` — the direct reference implementation pattern for gaze/gesture: a `use<Thing>()` ref-driven hook wrapping pure, unit-testable `create<Thing>State`/`step<Thing>` functions, additive `multiply()` writes via a module-scoped scratch `THREE.Quaternion`, randomized-range parameters. Follow this shape exactly.
- `packages/react/src/animation/types.ts` — `AvatarFormatAdapter.getHumanoidBoneNode(role)`, already supports `"neck"` and `"head"` roles (currently unused by any procedural system) — this is exactly the seam gaze/gesture need to find head/neck bones on both VRM and GLB via role-based (not literal-name) lookup, avoiding VRM's non-standardized literal bone names.
- `packages/react/src/animation/AnimationStateEngine.ts` — `update(delta)`'s fixed, documented composition order (crossfade ramp → blink → amplitude/settle scale → rest-pose reset → breathing → sway → spine clamp → expression drift → talk-cycle) is the single call site gaze/gesture steps get added to, alongside the existing systems. `MAX_COMBINED_SPINE_DELTA_RAD`-style bounded-magnitude clamping is the precedent for gaze/gesture's own bound, if their bone targets (head/neck) overlap with anything else (currently nothing else targets head/neck, so likely no clamp interaction needed, but verify during planning).
- `packages/react/src/KhaveeProvider.tsx` — `currentVolume`'s Phase-11 plumbing (added to `KhaveeContextType`, set via `useState`, read by `useAnimationController`) is the precedent for how a new gesture-hint signal should be threaded from a tool's `execute` callback into the animation layer.
- `packages/core/src/tools/animate.ts` — `toolAnimate`, the exact factory-object shape (`name`, `description`, `parameters`, no `execute`) the new `packages/core/src/tools/gesture.ts` must mirror (D-01/D-02/D-03).
- `packages/core/src/types/realtime.ts` — `RealtimeTool` interface (the type `toolGesture`'s consumer-supplied `execute` must satisfy) and `RealtimeConfig.tools`/`registerFunction` (the registration seam both `OpenAIRealtimeProvider` and `OpenAISTTTTSProvider` already implement identically — confirmed via direct inspection, so the new tool works with either provider with no additional plumbing).
- `.planning/phases/11-idle-transition-talking-states/11-CONTEXT.md` and `.planning/phases/10-shared-animation-architecture-crossfade-engine/10-CONTEXT.md` — prior-phase decisions and established patterns this phase builds directly on top of.

### Project-level requirements
- `.planning/REQUIREMENTS.md` — GAZE-01, GAZE-02, GEST-01, GEST-02 (this phase's exact requirement text)
- `.planning/PROJECT.md` — milestone-level constraints and standing instructions (see below)
- `.planning/STATE.md` — current milestone progress, Phase 11 completion record

**Standing instruction (repeated for visibility):** Do not reference, mine, or build on the abandoned `worktree-agent-*` branches or the `fix/emotion-analyzer-provider-agnostic` branch — explicit user direction carried over from the wayfinder design session. This applies to implementation, not just design.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/react/src/animation/breathing.ts` — direct pattern template for both gaze and gesture: ref-driven hook, pure testable step function, additive `multiply()` delta, module-scoped scratch quaternion, randomized-range amplitude/period constants.
- `packages/react/src/animation/types.ts`'s `AvatarFormatAdapter.getHumanoidBoneNode("neck" | "head")` — already exists in the interface, unused by any procedural system so far; exactly what gaze/gesture need.
- `packages/core/src/tools/animate.ts`'s `toolAnimate` — the shape template for the new `toolGesture` export.
- `packages/react/src/VRMAvatar.tsx` (`cameras: THREE.Camera[]` prop, line ~110) and R3F's `useThree()` hook — camera access options evaluated; `useThree().camera` chosen (D-04).

### Established Patterns
- Procedural systems are ref-driven, run inside the single `useFrame`/`update(delta)` callback already established by `useAnimationController`, never `useState`.
- Additive delta-quaternion composition via `bone.quaternion.multiply(scratch)`, never `.set()`/overwrite, with pre-allocated module-scoped scratch objects (no per-frame `new`).
- Tool factories in `packages/core/src/tools/` are plain exported objects (`name`/`description`/`parameters`, no `execute`) — the consuming app supplies `execute` and passes the tool into `RealtimeConfig.tools`.
- `RealtimeTool` registration (`config.tools` at construction, or `registerFunction()` post-construction) is implemented identically in both `OpenAIRealtimeProvider` and `OpenAISTTTTSProvider` — confirmed via direct inspection (`grep tools\|registerFunction` on both provider files).

### Integration Points
- `packages/react/src/KhaveeProvider.tsx` — will need a new gesture-hint field/setter added to `KhaveeContextType`, mirroring Phase 11's `currentVolume` addition, for a `set_gesture` tool's `execute` callback (wired by the consuming app) to reach the animation layer.
- `packages/react/src/animation/AnimationStateEngine.ts`'s `useAnimationController` — the single call site gaze (continuous, every frame) and gesture (triggered, consumed-and-cleared) both get added to, following the existing composition order.

</code_context>

<specifics>
## Specific Ideas

- Ticket #13's example tool call, `setGesture({ gesture: 'nod' | 'shake' | 'none' })`, is the direct basis for D-01/D-02's locked tool name (`set_gesture`) and parameter enum (`['nod', 'shake', 'none']`).

</specifics>

<deferred>
## Deferred Ideas

- Tracked-user-position gaze mode — explicitly out of scope per ticket #12's decision and `.planning/REQUIREMENTS.md`'s Out of Scope table.
- Semantic/keyword-triggered gestures beyond nod/shake — explicitly out of scope per ticket #13's decision and `.planning/REQUIREMENTS.md`'s Out of Scope table.
- New public API surface (`enableNaturalMotion`, reserved `animations` keys, per-behavior override flags) — Phase 13 scope (API-01..04).
- Frame-budget adaptive throttling for the full procedural stack including gaze/gesture — Phase 11's D-03 deferred the full tiered-degradation system; Phase 13's PERF-02 is where any throttling work would land if still needed after profiling.

None beyond the above — discussion stayed within phase scope otherwise.

</deferred>

---

*Phase: 12-gaze-gesture*
*Context gathered: 2026-07-17*
