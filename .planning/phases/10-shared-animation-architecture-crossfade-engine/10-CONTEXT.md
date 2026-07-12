# Phase 10: Shared Animation Architecture & Crossfade Engine - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning

<domain>
## Phase Boundary

`VRMAvatar` and `GLBAvatar` are both driven by one shared internal animation-state module (state layer + procedural delta layer) via a format-adapter interface, replacing today's format-specific ad-hoc switching code, with every chatStatus transition crossfading on an eased, pose-gap-adaptive timing curve. Covers ANIM-01, ANIM-02, ANIM-03, XFADE-01 only — idle/talking/gaze/gesture procedural *behaviors* and the new public API surface are later phases (11-13). Model loading/parsing (`useLoadVRM`, `useGLTF`) is explicitly untouched.

**Architecture is almost entirely pre-decided.** This milestone follows a completed wayfinder design map (GitHub issue [khavee-ai/khavee-sdk#1](https://github.com/khavee-ai/khavee-sdk/issues/1), 14 closed tickets) — Phase 10's job is implementation, not design. Discussion here focused only on the few scoping questions the wayfinder map left genuinely open for this specific phase.

</domain>

<decisions>
## Implementation Decisions

### Procedural delta layer scope this phase
- **D-01:** Migrate `VRMAvatar.tsx`'s existing blink system (currently inline, `useFrame`-driven, ref-based state — see `code_context` below) into the new shared module's procedural delta layer during Phase 10, rather than leaving it in place and deferring all procedural work to Phase 11. Rationale: blink is exactly the "already-proven pattern" wayfinder ticket #2 said the procedural delta layer should extend, so migrating it now proves the layer works end-to-end with one real behavior instead of shipping an empty stub. As a side effect, `GLBAvatar` gets blink for the first time (it currently has none).
- Phase 11 still owns breathing, weight-shift sway, expression rest-state drift, and all other procedural behaviors (IDLE-01/02, TALK-01/02, PERF-01) — only blink migrates early.

### Crossfade prototype reuse
- **D-02:** Port the actual implementation from the local prototype branch `wayfinder/5-crossfade-prototype` (commit `6d0b9d7`) as the starting point for the crossfade engine, rather than reimplementing the formula from scratch off the decision notes alone. The prototype's `setEffectiveWeight`-based manual blending (validated against real pose data on `happy.glb`'s `Idle`/`Taking`/`listening` clips) is the reference implementation to adapt into the new shared module — reduces risk of re-deriving the max-vs-average pose-gap formula incorrectly a second time.
- Note: `main`'s copy of `src/app/glb/page.tsx` was already reverted to its pre-prototype state — only the branch/commit itself retains the prototype code, not any file currently on `main`.

### Test assets for this phase
- **D-03:** Build and verify Phase 10's architecture (shared module, format-adapter, crossfade engine) against the clips already bundled in the repo — `public/models/animations/{Idle,talking,talking1}.fbx` for VRM, and `happy.glb`'s embedded `Idle`/`Taking`/`listening` clips for GLB (same fixtures the prototype used). Do not wait on or attempt to source the final CC0 clips tracked in issue [#17](https://github.com/khavee-ai/khavee-sdk/issues/17) (`stopped`, `listening`×2+, `thinking`×2+, `speaking` 2nd variant) — those are out of reach this phase. The bundled clips' redistribution-license risk (tracked separately in issue [#11](https://github.com/khavee-ai/khavee-sdk/issues/11)) is a known, separately-tracked compliance issue, not a blocker for using them as architecture-verification placeholders now.

### Claude's Discretion
- Exact file/module location and naming for the new shared internal module within `packages/react/src` — wayfinder ticket #8 explicitly left this unspecified, only requiring it stay internal (not exported from the package's public `index.ts`), matching the existing internal-only pattern (`AudioRecorder`, `STTClient` in `openai-stt-tts`).
- Whether the format-adapter interface is a TypeScript `interface` or an object literal shape — ticket #8 only specified the method signatures (`getMixer()`, `getBoneNode(name)`, `getExpressionManager(): ExpressionManager | null`), not the exact type-declaration mechanics.
- How existing public props (`enableBlinking`, `enableTalkingAnimations` on `VRMAvatar`; `autoPlayAnimation` on `GLBAvatar`) map onto or coexist with the new internal module during this phase — Phase 13 owns the actual new public API surface (API-01..04); Phase 10 just needs the existing public behavior to keep working from the outside.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wayfinder map — locked architecture decisions (source of truth for this phase)
- GitHub issue [khavee-ai/khavee-sdk#2](https://github.com/khavee-ai/khavee-sdk/issues/2) — Hybrid state layer + procedural delta layer pattern (the core architecture ANIM-01 implements). Corrected by #6: `stopped` is not idle-equivalent to `ready`.
- GitHub issue [khavee-ai/khavee-sdk#5](https://github.com/khavee-ai/khavee-sdk/issues/5) — Crossfade formula (XFADE-01): `easeInOutCubic` easing, duration `lerp(0.3s, 0.9s, clamp(maxBoneAngle / 90°, 0, 1))`, pose-gap measured by **max** (not average) per-bone quaternion angular distance, implemented via per-frame manual `setEffectiveWeight` interpolation on both actions (not THREE's built-in `fadeIn`/`fadeOut`, which supports neither adaptive duration nor custom easing).
- GitHub issue [khavee-ai/khavee-sdk#8](https://github.com/khavee-ai/khavee-sdk/issues/8) — VRM/GLB unification strategy: one shared internal module + format-adapter interface (`getMixer()`, `getBoneNode(name)`, `getExpressionManager(): ExpressionManager | null`, null for GLB). Module is internal-only, not exported from public `index.ts`. Loading/parsing explicitly out of scope (ANIM-03).
- GitHub issue [khavee-ai/khavee-sdk#1](https://github.com/khavee-ai/khavee-sdk/issues/1) — Wayfinder map overview/index, links all 14 resolved tickets and explains what's in vs. out of scope for the whole milestone.
- `.planning/phases/wayfinder-map-1-animation-architecture/VERIFICATION-CHECKLIST.md` — full milestone verification checklist (objective + subjective). Only the objective items about old-pattern removal, max-not-average pose-gap, and no-live-clock-interrupts-in-speaking apply cleanly to Phase 10 alone; most subjective per-state checks depend on Phase 11/12 procedural work not existing yet.
- `.planning/phases/wayfinder-map-1-animation-architecture/PERFORMANCE-BUDGET.md` — procedural delta layer frame-time budget (~1-2ms synthesized target, additive quaternion-multiply composition, tiered degradation). Primarily Phase 11 scope, but relevant if migrating blink (D-01) touches the composition order.

### Crossfade prototype (reference implementation, not on main)
- Local git branch `wayfinder/5-crossfade-prototype`, commit `6d0b9d7` — three-variant (`?variant=A|B|C`) crossfade comparison built on a since-reverted copy of `src/app/glb/page.tsx`, using `happy.glb`'s real `Idle`/`Taking`/`listening` clips. Per D-02, port this implementation rather than rebuilding from notes.

### Project-level requirements
- `.planning/REQUIREMENTS.md` — ANIM-01, ANIM-02, ANIM-03, XFADE-01 (this phase's exact requirement text)
- `.planning/PROJECT.md` — milestone-level constraints and standing instructions (see below)

**Standing instruction (repeated for visibility):** Do not reference, mine, or build on the abandoned `worktree-agent-*` branches or the `fix/emotion-analyzer-provider-agnostic` branch — explicit user direction carried over from the wayfinder design session. This applies to implementation, not just design.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/react/src/VRMAvatar.tsx` lines ~308-560 — working blink system (`blinkState`, `nextBlinkTime`, `isBlinking`, `blinkAnimationRef`, all `useRef` not `useState` — deliberately avoids re-render cost, per the file's own inline comment). This is the "already-proven pattern" wayfinder ticket #2 pointed to, and per D-01 gets migrated into the shared procedural delta layer this phase.
- `packages/react/src/VRMAvatar.tsx` lines 429-467 — current crossfade code (`fadeOut(0.3)` / `reset().fadeIn(0.3).play()`), the fixed-duration linear pattern XFADE-01 replaces.
- `packages/react/src/GLBAvatar.tsx` lines 165-203 — the real `setTimeout`-driven loop-back-to-idle pattern ANIM-02 requires removed (chatStatus === 'speaking' → picks a random talk/gesture/speak-named clip, sets a 3-5s `setTimeout` to revert to the first animation). This is the clearest, most concrete instance of the anti-pattern in the codebase.
- `packages/react/src/KhaveeProvider.tsx` — owns `currentAnimation`/`animate()`/`chatStatus` state consumed by both avatar components today; the new shared module's state layer will need to read `chatStatus` from here (or an equivalent seam) to drive automatic transitions.

### Established Patterns
- **Finding:** `VRMAvatar.tsx`'s JSDoc (lines 204-206, 217) describes chatStatus-driven automatic talking-animation switching ("randomly plays animations whose names include 'talk', 'gesture', or 'speak'") and documents an `enableTalkingAnimations` prop — but grepping the component body confirms neither is actually implemented; the prop isn't even destructured. `VRMAvatar` currently only responds to manual `animate()` calls via context, not automatic chatStatus switching. Only `GLBAvatar` has real (if crude) automatic chatStatus-driven switching. The planner should not assume ANIM-02's "VRMAvatar's old useEffect+if-statement chatStatus switching" refers to literal existing code in `VRMAvatar.tsx` — treat this as stale/aspirational documentation to be corrected, not a working pattern to "remove."
- Existing crossfade in both components uses THREE's built-in `AnimationAction.fadeIn`/`fadeOut(0.3)` — both need replacing with the manual `setEffectiveWeight` approach per D-02/issue #5.
- Nullable-return pattern already exists elsewhere in the codebase (e.g. `VRMParseResult`'s optional `vrm?: VRM`) — matches the `getExpressionManager(): ExpressionManager | null` shape ticket #8 specified for the format-adapter.

### Integration Points
- `packages/react/src/hooks/useRealtime.ts` — mirrors provider `chatStatus` into React state (line ~124); this is upstream of whatever seam the new state layer taps into.
- Test/demo pages that currently exercise avatar animation: `src/app/glb/page.tsx` (GLB test page, prototype was built here), plus other pages referencing `chatStatus` (`src/app/generic-demo/page.tsx`, `src/app/rag-realtime/page.tsx`).

</code_context>

<specifics>
## Specific Ideas

- Blink migration into the shared procedural delta layer should happen this phase (D-01) — not deferred.
- Crossfade engine should be a direct port/adaptation of the `wayfinder/5-crossfade-prototype` branch's `setEffectiveWeight` logic (D-02), not a fresh reimplementation.
- Verify against existing bundled clips (`Idle.fbx`, `talking.fbx`, `talking1.fbx`, `happy.glb`'s embedded clips) — no new asset sourcing needed or expected this phase (D-03).

</specifics>

<deferred>
## Deferred Ideas

- Sourcing final CC0 clips for `stopped`/`listening`/`thinking`/2nd `speaking` variant — tracked in issue #17, explicitly out of reach this phase (D-03).
- Fixing the bundled Mixamo files' redistribution-license risk — tracked separately in issue #11, unrelated compliance work.
- All idle/talking/gaze/gesture procedural *behaviors* (breathing, sway, expression drift, audio-reactive amplitude, gaze, semantic gestures) — Phase 11/12 scope (IDLE-01/02, TRANS-01/02, TALK-01/02, PERF-01, GAZE-01/02, GEST-01/02).
- New public API surface (`enableNaturalMotion`, reserved `animations` keys, zero-config defaults) — Phase 13 scope (API-01..04).

None — discussion stayed within phase scope otherwise.

</deferred>

---

*Phase: 10-shared-animation-architecture-crossfade-engine*
*Context gathered: 2026-07-12*
