# Requirements: Khavee Generic Voice Pipeline — v2.2 Natural Avatar Animation

**Defined:** 2026-07-12
**Core Value (this milestone):** A developer can assemble a full voice pipeline (STT + LLM + TTS, with tool-calling) from independently swappable vendor adapters — without being locked into OpenAI for every stage. This milestone extends that value to the avatar rendering layer: natural-feeling animation with zero-config setup.

Source: wayfinder map [khavee-ai/khavee-sdk#1](https://github.com/khavee-ai/khavee-sdk/issues/1), 14 closed tickets, all decisions already locked. Requirements below restate those decisions in checkable form; each ticket's resolution comment holds full rationale.

## v1 Requirements

### Architecture

- [ ] **ANIM-01**: The chatStatus→animation state layer and procedural delta layer are implemented once as a shared internal module (not exported from the package's public `index.ts`), consumed by both `VRMAvatar` and `GLBAvatar` via a format-adapter interface (`getMixer()`, `getBoneNode(name)`, `getExpressionManager(): ExpressionManager | null`)
- [ ] **ANIM-02**: `VRMAvatar.tsx`'s `useEffect`+if-statement chatStatus switching and `GLBAvatar.tsx`'s `setTimeout`-driven loop-back pattern are both removed, replaced by the shared module
- [ ] **ANIM-03**: Model loading/parsing (`useLoadVRM`, `useGLTF`) stays separate per format, untouched by this work

### Idle & Transition States

- [x] **IDLE-01**: `ready`/`stopped` base state has randomized-range procedural breathing (chest/spine bone rotation) and weight-shift sway (hip/spine), independent cycles
- [x] **IDLE-02**: VRM avatars additionally get subtle, randomized expression rest-state drift (1-2 expression values); GLB avatars do not (no expression system)
- [x] **TRANS-01**: `starting` plays a dedicated greeting/waking clip with a ~1.0–1.5s minimum duration floor (on top of pose-gap-adaptive timing)
- [x] **TRANS-02**: `stopped` plays a dedicated goodbye/settling clip, distinct from `ready`'s idle base, with the same minimum duration floor

### Talking & Crossfade

- [x] **TALK-01**: `speaking` cycles through 2+ talk-clip variants via loop-completion-driven switching (~2s minimum dwell floor) — no live-clock (`setInterval`/`setTimeout`) interrupts anywhere in this state
- [x] **TALK-02**: Live volume signal from `useAudioLipSync` scales procedural motion amplitude during `speaking` only — never affects clip selection or timing
- [ ] **XFADE-01**: All state transitions use `easeInOutCubic`-eased crossfades with pose-gap-adaptive duration (0.3–0.9s), where pose-gap is measured as the **max** (not average) per-bone quaternion angular distance

### Gaze & Gesture

- [ ] **GAZE-01**: `ready`/`listening`/`speaking` show camera-relative soft gaze (no tracked-user-position dependency); `thinking` shows brief gaze aversion; `starting`/`stopped` get no separate gaze treatment
- [ ] **GAZE-02**: Gaze applies symmetrically to both VRM and GLB (bone-level behavior, not expression-dependent)
- [x] **GEST-01**: The LLM can emit a gesture hint (`nod`/`shake`/`none`) via tool-calling as part of its normal response generation (no separate classification call, no keyword/regex matching)
- [ ] **GEST-02**: Triggered gestures are procedural bone deltas (no new animation clip), queued for the ambient talk-cycle's next natural loop boundary — never interrupt mid-clip

### Public API

- [ ] **API-01**: `enableNaturalMotion?: boolean` (default `true`) is a master flag; granular per-behavior override flags (`enableBreathing`, `enableWeightShift`, `enableExpressionDrift`, etc.) are available for fine control
- [ ] **API-02**: `animations` prop supports reserved ChatStatus-name keys (`ready`, `starting`, `listening`, `thinking`, `speaking`, `stopped`) driving automatic behavior, coexisting with arbitrary custom keys still usable via manual `animate(name)`
- [ ] **API-03**: Audio-reactive wiring (TALK-02) is fully automatic — no additional prop required
- [ ] **API-04**: A consuming dev passing zero `animations` prop still gets full natural behavior across all 6 states (SDK-bundled defaults) — see ASSET-01 for current bundling status

### Performance

- [x] **PERF-01**: Procedural systems touching the same bone (e.g. breathing + sway on spine) compose via additive delta-quaternion `multiply()`, not `.set()`/overwrite, in a fixed documented order, with combined magnitude bounded
- [ ] **PERF-02**: Under sustained frame-budget pressure, procedural systems degrade in tiers — blink never throttles, breathing/sway throttle first, expression drift throttles most aggressively, audio-reactive amplitude stays tied to its upstream hook's cadence

### Verification

- [ ] **VERIFY-01**: Implementation passes the objective checklist in `.planning/phases/wayfinder-map-1-animation-architecture/VERIFICATION-CHECKLIST.md` (old patterns removed, max-not-average pose-gap, no live-clock interrupts, zero-config works, reserved keys, frame-budget sanity check)
- [ ] **VERIFY-02**: Implementation passes the subjective per-state pass/fail review in the same checklist (one human reviewer, running build, concrete per-state prompts)

## v2 Requirements

Deferred — blocked on hands-on asset procurement outside this milestone's reach (tracked in [#17](https://github.com/khavee-ai/khavee-sdk/issues/17)).

### Assets

- **ASSET-01**: SDK bundles a final, fully CC0/redistribution-safe clip for `stopped` (goodbye) — no candidate sourced yet
- **ASSET-02**: SDK bundles 2+ final CC0 clips each for `listening` and `thinking` — no candidates sourced yet
- **ASSET-03**: SDK bundles a 2nd `speaking` clip variant distinct from the existing near-miss candidate — not yet resolved
- **ASSET-04**: SDK bundles a verified (bone-name-confirmed, not just circumstantial) default GLB avatar+rig sharing its skeleton with the bundled animation clips

Until these land, ANIM/IDLE/TALK/TRANS work should build and test against placeholder or the repo's existing (non-redistribution-safe, tracked separately in [#11](https://github.com/khavee-ai/khavee-sdk/issues/11)) clips — the architecture itself does not depend on final asset sourcing to be correct.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Emotion-driven expression/detection integration | Separate SDK concern, ruled out during wayfinder design (map #1) |
| Changes to `openai-stt-tts` / realtime provider packages | Unrelated to avatar animation, out of scope per wayfinder map #1 |
| Inverse kinematics, physics-based secondary motion (cloth/hair), procedural locomotion | Explicit architecture non-goals, locked in wayfinder ticket #2 |
| Semantic/keyword-triggered gestures beyond nod/shake, gaze tracked-user-position mode | Deliberately minimal scope per wayfinder tickets #12/#13 — avoid scope creep on a closing spec |
| Mining or referencing the abandoned `worktree-agent-*` / `fix/emotion-analyzer-provider-agnostic` branches | Explicit user direction carried over from the wayfinder design session |
| Fixing the existing bundled Mixamo files' licensing risk | Tracked separately as [#11](https://github.com/khavee-ai/khavee-sdk/issues/11) — pre-existing compliance issue, not new-feature work |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ANIM-01 | Phase 10 | Pending |
| ANIM-02 | Phase 10 | Pending |
| ANIM-03 | Phase 10 | Pending |
| IDLE-01 | Phase 11 | Complete (final re-confirmation 2026-07-17, 11-18 sixth gap-closure round — legs no longer sway, all other behavior confirmed) |
| IDLE-02 | Phase 11 | Complete (confirmed visible drift in `ready` state; re-confirmed 2026-07-17, 11-18) |
| TRANS-01 | Phase 11 | Complete (re-confirmed 2026-07-17, 11-18 sixth gap-closure round) |
| TRANS-02 | Phase 11 | Complete (re-confirmed 2026-07-17, 11-18 sixth gap-closure round) |
| TALK-01 | Phase 11 | Complete — G2 snap regression fixed and confirmed by 11-14 (2026-07-17), re-confirmed again 2026-07-17 in 11-18's final sweep |
| TALK-02 | Phase 11 | Complete (confirmed loud/quiet amplitude tracking, 2026-07-16 re-check; re-confirmed 2026-07-17, 11-18) |
| XFADE-01 | Phase 10 | Pending |
| GAZE-01 | Phase 12 | Pending |
| GAZE-02 | Phase 12 | Pending |
| GEST-01 | Phase 12 | Complete |
| GEST-02 | Phase 12 | Pending |
| API-01 | Phase 13 | Pending |
| API-02 | Phase 13 | Pending |
| API-03 | Phase 13 | Pending |
| API-04 | Phase 13 | Pending |
| PERF-01 | Phase 11 | Complete (re-confirmed 2026-07-17, 11-18 sixth gap-closure round, incl. GLB manual-clip procedural gate) |
| PERF-02 | Phase 13 | Pending |
| VERIFY-01 | Phase 13 | Pending |
| VERIFY-02 | Phase 13 | Pending |

**Untracked regressions (not mapped to a REQ-ID) — ALL RESOLVED as of 11-18 (2026-07-17):**
- G1: Avatar stuck in T-pose on first load — FIXED and confirmed by 11-14's round-4 human re-check (2026-07-17), re-confirmed by 11-18's sixth-round sweep. Root cause (found by 11-13 via headless production-path replay): the crossfade-trigger effect's single pre-connect run happened while clips/root were unresolvable and never re-fired when the VRM finished loading. Fixed with a new exported pure function `shouldTriggerClipSwitch`.
- G2: Idle→talking transition snap — FIXED and confirmed by 11-12's round-3 human re-check (2026-07-16), reconfirmed by 11-14 (2026-07-17) and 11-18 (2026-07-17).
- G3: Y-axis drop when Connect is first pressed — FIXED and confirmed by 11-14's round-4 human re-check (2026-07-17), reconfirmed by 11-18 (2026-07-17), sharing G1's root cause per 11-13's diagnosis.
- G4: minor jiggle during TALK-01's talk-clip cycling — FIXED and confirmed by 11-14's round-4 human re-check (2026-07-17), reconfirmed by 11-18 (2026-07-17). Root cause (11-13): `resetToRestPoseIfNotDriven` snapped toward the bind-pose anchor during a talk-variant switch while the outgoing action was still contributing. Fixed with a new exported pure function `isBaseActionMeaningfullyDriving`.
- G5: page-load Y-axis-drop settle (same class as G3, relocated to initial page load by 11-13's G1 fix) — FIXED by 11-15 (retargeter bind-pose Y anchor), confirmed on VRM by 11-16 (2026-07-17), and confirmed on BOTH VRM and GLB by 11-18's sixth-round sweep (2026-07-17).
- OPEN ISSUE 1 (new, found 2026-07-17 in 11-16's fifth-round check): VRM procedural sway/breathing visibly affected leg bones — FIXED by 11-17 (sway retargeted off hips onto spine+chest) and confirmed by 11-18 (2026-07-17).
- OPEN ISSUE 2 (new, found 2026-07-17 in 11-16's fifth-round check): GLB procedural sway intensity too strong after swapping the active animation clip — FIXED by 11-17 (`shouldDisableProceduralForManualClip` gate) and confirmed by 11-18 (2026-07-17).

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22 (Phase 10: ANIM-01/02/03, XFADE-01; Phase 11: IDLE-01/02, TRANS-01/02, TALK-01/02, PERF-01; Phase 12: GAZE-01/02, GEST-01/02; Phase 13: API-01/02/03/04, PERF-02, VERIFY-01/02)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-12*
*Last updated: 2026-07-12 — roadmap created, all 22 v1 requirements mapped to Phases 10-13*
