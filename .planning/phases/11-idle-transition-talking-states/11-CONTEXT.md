# Phase 11: Idle, Transition & Talking States - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning

<domain>
## Phase Boundary

The `ready`/`stopped` idle base, the `starting`/`stopped` transition moments, and the `speaking` talk cycle all read as alive and natural rather than static or robotic, with procedural systems on the same bone composing safely instead of overwriting each other. Covers IDLE-01, IDLE-02, TRANS-01, TRANS-02, TALK-01, TALK-02, PERF-01 only — gaze/gesture (GAZE-01/02, GEST-01/02) and the public API surface (API-01..04) are Phase 12/13. Model loading and the crossfade engine itself (Phase 10) are untouched.

**Architecture is almost entirely pre-decided**, same as Phase 10. This milestone follows a completed wayfinder design map ([khavee-ai/khavee-sdk#1](https://github.com/khavee-ai/khavee-sdk/issues/1)) — Phase 11's job is implementation, not design. Discussion here focused on the genuinely open gaps wayfinder's own research left unresolved: missing assets, an imprecise requirement wording, and an explicit scope boundary for graceful degradation.

</domain>

<decisions>
## Implementation Decisions

### Asset gap strategy
- **D-01:** Build Phase 11 against placeholder/reused clips now, matching Phase 10's D-03 precedent. Do not block this phase on sourcing final CC0 assets. Wayfinder's own asset-sourcing research (`ASSET-RESEARCH.md`, tickets #9/#16) found `stopped`(goodbye), `listening`(2+), and `thinking`(2+) clips are genuinely unresolved gaps — no clean CC0 candidates were found after two full sourcing passes (Quaternius Universal Animation Library 2, Kenney.nl). This is already deferred at the project level (`.planning/STATE.md`'s Deferred Items: ASSET-01..04, tracked in issue [#17](https://github.com/khavee-ai/khavee-sdk/issues/17)) — Phase 11 should not re-litigate whether to wait for real assets, only decide what to use as placeholders.
- **Candidate placeholder mapping (for the researcher/planner to verify against actual model content, not a locked decision):**
  - VRM (`public/models/animations/`): only `Idle.fbx`, `talking.fbx`, `talking1.fbx` exist. No listening/thinking/starting/stopped clips at all — those states will fall back to idle via `resolveBaseClip`'s existing fallback (`currentAnimation ?? availableNames[0] ?? null`), which is the correct current behavior, not a bug to fix this phase.
  - GLB (`happy.glb`'s embedded clips): `'State 1 Idle (loop)'`, `'State 2 present (loop)'`, `'State 3 Welcome (loop)'`, `'State 4 Taking (loop)'`, `'State 5 listening (loop)'`, `'Walk'`, `'Walk.001'`. The naming strongly suggests `'State 3 Welcome (loop)'` → `starting` and `'State 5 listening (loop)'` → `listening` are usable placeholders today, unverified visually. `thinking` has no clear candidate (`'State 2 present (loop)'` is the only unclaimed one — plausible but unconfirmed).
  - **Flagged discrepancy for research to verify:** `'State 4 Taking (loop)'` is spelled "Taking," not "Talking" — it does NOT match `resolveBaseClip`'s existing `/talk|gesture|speak/i` speaking-state pattern (added Phase 10, extended in a later quick-task). Unclear whether this clip was ever intended as GLB's speaking-state clip; needs verification before assuming it "just works" for TALK-01.

### Audio-reactive amplitude signal source (TALK-02)
- **D-02:** Wire TALK-02's live volume signal from `useRealtime()`'s `currentVolume` (sourced from `OpenAIRealtimeProvider.onVolumeChange`), not from `useAudioLipSync` as REQUIREMENTS.md's TALK-02 text literally names. Verified by direct inspection: `useAudioLipSync()` (`packages/react/src/hooks/useAudioLipSync.ts`) is built around analyzing pre-recorded audio files (`analyzeLipSync(audioUrl, options)`) and returns `{ analyzeLipSync, stopLipSync, isAnalyzing, currentPhoneme, audioElement }` — no live volume scalar exists on it at all. `currentVolume` is the only live, per-frame volume signal that actually exists in the codebase during a real conversation. Treat REQUIREMENTS.md's "useAudioLipSync" wording as imprecise shorthand for "the live audio-reactive signal," not a literal API pointer.
- **Known plumbing gap (for planner):** `currentVolume` is currently only returned from `useRealtime()` — it is NOT threaded through `KhaveeProvider`/`useKhavee()` context the way `chatStatus`/`currentAnimation` already are. `VRMAvatar`/`GLBAvatar` read `chatStatus` via `useKhavee()`, not via `useRealtime()` directly. Phase 11 will need to add `currentVolume` to `KhaveeProvider`'s context (or an equivalent seam) before the shared animation module can read it — this is new plumbing, not a trivial one-line addition.

### Graceful degradation scope (PERF-01)
- **D-03:** Build only the composition rule this phase — additive delta-quaternion `multiply()` (not `.set()`/overwrite), in a fixed documented order, with combined magnitude bounded. This is what PERF-01's actual requirement text requires. Do NOT build the full frame-time-pressure-detection/adaptive-throttling system described in `PERFORMANCE-BUDGET.md` §5 (rolling delta average, frame-counter-based per-system throttling, blink-never/breathing-first/expression-most-aggressive tiers) — that is a recommendation in the research doc, not a requirement in PERF-01's locked text. Single-avatar procedural cost is synthesized (not benchmarked) at ~1-2ms total for the full stack — likely not a real problem yet. Add throttling later if runtime profiling on real target hardware shows it's actually needed.

### Claude's Discretion
- Exact numeric parameters for breathing/sway (period, amplitude range, randomization bounds) — wayfinder ticket #3 and `PERFORMANCE-BUDGET.md` establish the *mechanism* (independent sine cycles on chest/spine and hip/spine) but not exact numbers. Follow the existing blink migration's approach (`packages/react/src/animation/blink.ts`) as the reference for how much numeric specificity this codebase expects from a procedural system — blink kept its original inline constants verbatim rather than re-deriving them.
- Fixed composition order for breathing → sway → audio-reactive amplitude when multiple systems touch the same bone (spine) — `PERFORMANCE-BUDGET.md` §4 suggests this exact order as an example, not a mandate; the planner may choose any fixed, documented order as long as it's deterministic frame-to-frame and the combined magnitude is bounded.
- Whether the new procedural systems (breathing, sway, expression drift) live in one new module or several small ones alongside `blink.ts` — Phase 10 established the pattern (`packages/react/src/animation/{crossfade,blink,types,AnimationStateEngine}.ts`, all internal, none exported from `index.ts`) but didn't mandate module boundaries beyond that.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wayfinder map — locked architecture decisions (source of truth for this phase)
- GitHub issue [khavee-ai/khavee-sdk#3](https://github.com/khavee-ai/khavee-sdk/issues/3) — Idle micro-motion approach (IDLE-01/02): procedural vs. authored-clip tradeoff, resolved toward procedural breathing/sway + VRM-only expression drift.
- GitHub issue [khavee-ai/khavee-sdk#4](https://github.com/khavee-ai/khavee-sdk/issues/4) — Talking variation & repetition-avoidance strategy (TALK-01/02): loop-completion-driven cycling, audio-amplitude-driven procedural motion, interaction with `useAudioLipSync`.
- GitHub issue [khavee-ai/khavee-sdk#6](https://github.com/khavee-ai/khavee-sdk/issues/6) — `starting`/`stopped` state treatment (TRANS-01/02): full states with dedicated clips, not just transition moments layered on neighbors.
- GitHub issue [khavee-ai/khavee-sdk#10](https://github.com/khavee-ai/khavee-sdk/issues/10) — Procedural delta layer performance budget research (source ticket for `PERFORMANCE-BUDGET.md`).
- GitHub issue [khavee-ai/khavee-sdk#9](https://github.com/khavee-ai/khavee-sdk/issues/9) — Per-chatStatus animation asset requirements (source ticket for `ASSET-RESEARCH.md` §1-6).
- GitHub issue [khavee-ai/khavee-sdk#15](https://github.com/khavee-ai/khavee-sdk/issues/15) — Listening/thinking clip variant count decision (locked: `starting` 1, `stopped` 1, `speaking` 2+, `listening` 2+, `thinking` 2+).
- GitHub issue [khavee-ai/khavee-sdk#16](https://github.com/khavee-ai/khavee-sdk/issues/16) — Asset-sourcing closing ticket (source for `ASSET-RESEARCH.md` §7 — the 4 remaining open asset gaps).
- GitHub issue [khavee-ai/khavee-sdk#1](https://github.com/khavee-ai/khavee-sdk/issues/1) — Wayfinder map overview/index, links all 14 resolved tickets.
- `.planning/phases/wayfinder-map-1-animation-architecture/PERFORMANCE-BUDGET.md` — full frame-budget research: stacking inventory (§1), ~1-2ms synthesized target (§2), per-operation cost findings (§3), composition/allocation-reuse technique guidance (§4, directly informs PERF-01), graceful-degradation proposal (§5, explicitly deferred per D-03 above).
- `.planning/phases/wayfinder-map-1-animation-architecture/ASSET-RESEARCH.md` — full asset sourcing research: per-state requirement recap (§1), Mixamo redistribution risk finding (§2-3, non-blocking this phase, tracked separately in issue #11), CC0 sourcing attempts (§4, §7.1-7.3), remaining open gaps (§7.5 summary table, directly informs D-01 above).
- `.planning/phases/wayfinder-map-1-animation-architecture/VERIFICATION-CHECKLIST.md` — the subjective per-state checks (`ready`, `starting`, `listening`, `thinking`, `speaking`, `stopped`) this phase's human-verify checkpoint should be measured against.

### Phase 10 precedent (procedural-layer pattern to extend)
- `packages/react/src/animation/blink.ts` — the "already-proven pattern" wayfinder ticket #2 pointed to; reference implementation for how a ref-driven procedural delta system reads through `AvatarFormatAdapter` and is a no-op on formats without the needed capability.
- `packages/react/src/animation/types.ts` — `AvatarFormatAdapter` interface; `getBoneNode(name)` is the seam breathing/sway will read/write bones through.
- `packages/react/src/animation/crossfade.ts` — existing manual-blend pattern (`beginCrossfade`/`stepCrossfade`), reference for allocation-reuse (pre-allocated `THREE.Quaternion` scratch objects, no per-frame `new`) per `PERFORMANCE-BUDGET.md` §4's explicit callout of this exact pattern.
- `packages/react/src/animation/AnimationStateEngine.ts` — `resolveBaseClip`'s `STATUS_CLIP_PATTERNS` table (added in a post-Phase-10 quick-task) already resolves `listening`/`thinking`/`starting`/`stopped` to a naming-convention-matched clip when one exists — this mechanism is ready to consume whatever placeholder/real clips Phase 11 wires in, no further code change needed there.
- `.planning/phases/10-shared-animation-architecture-crossfade-engine/10-04-SUMMARY.md` — confirms the crossfade engine and shared module are human-verified and working on a running build; Phase 11 builds on top of this, not around it.

### Project-level requirements
- `.planning/REQUIREMENTS.md` — IDLE-01, IDLE-02, TRANS-01, TRANS-02, TALK-01, TALK-02, PERF-01 (this phase's exact requirement text)
- `.planning/PROJECT.md` — milestone-level constraints and standing instructions (see below)
- `.planning/STATE.md` — Deferred Items section, ASSET-01..04 (issue #17), directly relevant to D-01 above

**Standing instruction (repeated for visibility):** Do not reference, mine, or build on the abandoned `worktree-agent-*` branches or the `fix/emotion-analyzer-provider-agnostic` branch — explicit user direction carried over from the wayfinder design session. This applies to implementation, not just design.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/react/src/animation/blink.ts` — ref-driven procedural delta pattern (never `useState`, gated on `adapter.getExpressionManager()` returning non-null). Breathing/sway/expression-drift should follow the same shape, gated on `adapter.getBoneNode(name)` returning non-null instead.
- `packages/react/src/animation/types.ts`'s `AvatarFormatAdapter.getBoneNode(name)` — already exists, unused by anything except crossfade's pose-gap measurement so far; this is exactly what breathing/sway need to find chest/spine/hip bones on both VRM and GLB.
- `packages/react/src/animation/AnimationStateEngine.ts`'s `STATUS_CLIP_PATTERNS` — already generalized to 5 statuses (`speaking`/`listening`/`thinking`/`starting`/`stopped`) via naming-convention regex matching. TRANS-01/02's dedicated clips and TALK-01's talk-cycling variants can plug into this immediately once clip names are decided (D-01).
- `packages/react/src/hooks/useRealtime.ts`'s `currentVolume` (line ~25, ~126, ~329) — the real live-volume source for TALK-02 (see D-02). Not yet threaded through `KhaveeProvider` context.

### Established Patterns
- Procedural systems are ref-driven, run inside the single `useFrame`/`update(delta)` callback already established by `useAnimationController` (`packages/react/src/animation/AnimationStateEngine.ts`), never `useState` (re-render cost, documented explicitly in `blink.ts`'s own inline comment).
- Frame-ordering contract already documented in `AnimationStateEngine.ts`: `mixer.update(delta) -> controller.update(delta) -> vrm.update(delta)`, with an explicit inline comment flagging this as "an obvious insertion point for Phase 11's additive bone-delta layer."
- Allocation-reuse: pre-allocate scratch `THREE.Quaternion`/`THREE.Euler` once (module- or ref-scoped), never `new` inside `useFrame` — established by the crossfade engine, reinforced by `PERFORMANCE-BUDGET.md` §4.

### Integration Points
- `packages/react/src/KhaveeProvider.tsx` — will need `currentVolume` added to its context shape for TALK-02 to be readable from `VRMAvatar`/`GLBAvatar` (see D-02's plumbing gap note).
- `packages/react/src/animation/AnimationStateEngine.ts`'s `useAnimationController` — the single call site both avatars already route through; breathing/sway/expression-drift/audio-reactive-amplitude all get added to its `update(delta)` body, alongside the existing crossfade-ramp and blink steps.

</code_context>

<specifics>
## Specific Ideas

- Placeholder clip mapping candidates surfaced during discussion (GLB: `'State 3 Welcome (loop)'` for starting, `'State 5 listening (loop)'` for listening) — unverified, flagged for researcher to confirm against actual model content before the planner locks them in.
- The `'State 4 Taking (loop)'` vs. `/talk/i` regex mismatch — flagged as a concrete thing to verify, not assumed to "just work."

</specifics>

<deferred>
## Deferred Ideas

- Sourcing final CC0 clips for `stopped`/`listening`(2+)/`thinking`(2+)/`speaking` 2nd clean variant — tracked in issue #17 (ASSET-01..04), explicitly out of reach this phase per D-01.
- Fixing the bundled Mixamo files' redistribution-license risk — tracked separately in issue #11, unrelated compliance work.
- Full graceful-degradation/adaptive-throttling system (`PERFORMANCE-BUDGET.md` §5) — deferred per D-03; revisit if runtime profiling shows the composition-only implementation is actually over budget.
- Gaze/attention system and semantic gestures — Phase 12 scope (GAZE-01/02, GEST-01/02).
- New public API surface (`enableNaturalMotion`, reserved `animations` keys, zero-config defaults, per-behavior flags) — Phase 13 scope (API-01..04).

None beyond the above — discussion stayed within phase scope otherwise.

</deferred>

---

*Phase: 11-idle-transition-talking-states*
*Context gathered: 2026-07-12*
