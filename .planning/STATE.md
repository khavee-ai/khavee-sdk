---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: Natural Avatar Animation
status: executing
stopped_at: 12-06 verification complete with gaps recorded -- gap-closure round needed for GAZE-01/GAZE-02 before Phase 12 can close
last_updated: "2026-07-18T10:32:22.570Z"
last_activity: 2026-07-18 -- Phase 12 execution started
progress:
  total_phases: 13
  completed_phases: 10
  total_plans: 67
  completed_plans: 64
  percent: 77
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-11)

**Core value (v2.2):** Replace `VRMAvatar`/`GLBAvatar`'s robotic chatStatus-driven animation switching with a unified, natural-feeling state architecture — shared internal module, procedural motion layer, and a zero-config public API.
**Current focus:** Phase 12 — gaze-gesture

## Current Position

Phase: 12 (gaze-gesture) — EXECUTING
Plan: 1 of 9
Status: Executing Phase 12
Last activity: 2026-07-18 -- Phase 12 execution started

Plan 12-06 result: Objective code-level gates G-1..G-9 all PASS (no live-bone lookAt, additive-only composition, starting/stopped no-op, detectLoopBoundary reused, toolGesture exported, gaze/gesture internal-only, no per-frame allocation, both test suites green + tsc clean). Live human verification confirmed GEST-01 and GEST-02 ("approved" on both). GAZE-01 and GAZE-02 FAILED: gaze snaps directly to its target instead of smoothly transitioning (Gap 1, affects both VRM and GLB — likely a missing lerp/slerp/damping step in `gaze.ts`'s `stepGaze`), and the GLB avatar additionally shows a new, GLB-only idle-animation spin regression (Gap 2, root cause unknown, not reproduced on VRM). Phase 11's idle regression check (breathing/sway/blink) read normally on VRM — no Phase 11 regression. Full detail in `.planning/phases/12-gaze-gesture/12-06-VERIFICATION.md` and `12-06-SUMMARY.md`.

Phase 12 is NOT complete — a gap-closure round (planning + execution) is needed to fix Gap 1 (gaze snapping) and Gap 2 (GLB idle-spin regression) and re-verify GAZE-01/GAZE-02 before this phase can close. Requirements GEST-01 and GEST-02 are marked complete in REQUIREMENTS.md; GAZE-01 and GAZE-02 remain pending.

Progress: [████████░░] 77% (10/13 roadmap phases fully closed; Phase 12's 6 plans all have SUMMARY.md on disk, but the phase itself has open gaps and is not yet closed)

## Performance Metrics

**Velocity:**

- Total plans completed: 32 (15 v1.0 milestone Phases 1-4, + 4 v2.0 Phase 6, + 5 v2.0 Phase 7, + 5 v2.0 Phase 8, + 5 v2.1 Phase 9 so far)
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 3 | - | - |
| 2 | 7 | - | - |
| 3 | 2 | - | - |
| 4 | 3 | - | - |
| 6 | 4 | - | - |
| 7 | 5 | - | - |
| 8 | 5 | - | - |
| 9 | 5/6 | - | - |
| 10 | 4/4 | - | - |
| 11 | 18/18 | - | - |
| 12 | 6/6 (gaps open) | - | - |
| 13 | 0/TBD | - | - |

**Recent Trend:**

- Last 5 plans: 09-01, 09-02, 09-03, 09-04, 09-05
- Trend: v2.1 Phase 9 (Block Studio) at 5/6 plans, blocked on 09-06 live UAT checkpoint. v2.2 roadmap just created — 4 phases (10-13), no plans decomposed yet.

*Updated after each plan completion*
| Phase 11 P18 | 25min | 2 tasks | 1 files |
| Phase 12 P06 | 15min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v2.2: All 14 architecture decisions for natural avatar animation were resolved during wayfinder map khavee-ai/khavee-sdk#1 before this milestone started — roadmapping/implementation restates locked decisions, does not re-derive them
- v2.2: Phase numbering continues from Phase 9 (v2.1) — this milestone starts at Phase 10, deliberately running in parallel with the still-in-progress Phase 9, not sequenced after it
- v2.2: ASSET-01..04 (final CC0 clip/avatar sourcing) explicitly deferred to v2 / tracked in GitHub issue #17 — no phase created for them; ANIM/IDLE/TALK/TRANS work builds and tests against placeholder or existing (license-flagged, issue #11) clips meanwhile
- v2.2: Phase 10 (shared module + crossfade) sequenced first as the foundation every other phase's procedural systems route through; Phase 13 (public API + perf tiers + verification) sequenced last since it configures/gates behavior built in Phases 10-12
- v2.0: WordPress plugin targets `OpenAIRealtimeProvider` (full-duplex WebRTC), not `generic-stt-tts` — matches the WP embedding use case shape
- v2.0: Custom mode only this milestone (self-configured); Platform mode is an explicit fast-follow blocked on a `khavee-app` backend addition
- [Phase 11]: v2.2: Phase 11 gap closure fully resolved (11-18, 2026-07-17) - sway retargeted off hips onto spine+chest (no leg motion) and GLB manual-clip procedural gate silences sway/breathing when a non-idle clip is manually selected; all 7 phase requirements and G1-G5 (both VRM and GLB) explicitly re-confirmed by decisive human verdict
- [Phase 12]: Plan 12-06 verification: objective gates G-1..G-9 all PASS; human verification confirmed GEST-01/GEST-02 but found 2 gaps -- gaze snaps instead of smoothly transitioning (GAZE-01+GAZE-02, both VRM and GLB) and a GLB-only idle-animation spin regression (GAZE-02). Phase 12 requires a gap-closure round before it can close; do not treat gaze as production-ready in Phase 13.

### Pending Todos

None yet.

### Blockers/Concerns

- v2.2: Phase 12 (gaze-gesture) has open gaps as of 12-06 verification (2026-07-18) — GAZE-01 and GAZE-02 both FAIL live human verification: gaze snaps to target instead of smoothly transitioning (both VRM and GLB), and the GLB avatar additionally shows a new idle-animation spin regression not reproduced on VRM. GEST-01/GEST-02 are confirmed. A gap-closure round is required before Phase 12 closes; do not treat gaze as production-ready when planning/executing Phase 13.
- v2.2: Phase 11 is now fully CLOSED (2026-07-17, 11-18 sixth gap-closure round). History: 11-13 root-caused G1/G3 (shared cause: crossfade-trigger effect never re-fires when clips load post-mount) and G4 (reset-to-rest-pose firing mid-talk-variant-switch); 11-14 confirmed G1-G4 + 7-req sweep but surfaced G5 (page-load Y-drop, relocated from connect-time); 11-15 root-caused and fixed G5 (retargeter bind-pose Y anchor); 11-16 confirmed G5 fixed on VRM but surfaced two NEW findings (VRM leg-bone sway, GLB sway too strong after animation swap); 11-17 fixed both; 11-18's decisive human re-sweep confirmed everything — both new findings resolved, G1-G5 on both VRM and GLB, and all 7 requirements. No open issues remain.
- v2.2: A stray untracked directory `.planning/phases/11-bone-masked-upper-body-animation-layering/` exists on disk (dated 2026-07-01, pre-dates this milestone's requirements) — not referenced by this roadmap and should not be treated as this milestone's real Phase 11; likely debris from an abandoned branch (see PROJECT.md's standing instruction not to mine `worktree-agent-*`/`fix/emotion-analyzer-provider-agnostic` branches). Flagged for cleanup, not blocking.
- Phase 9 (v2.1): 09-06-PLAN.md (live UAT checkpoint) still pending — Block Studio not yet complete
- Phase 5 (v1.0): VAD-loopback cooldown (currently a 500ms magic number tuned for OpenAI TTS) cannot be validated against JaiTTS until that service exists — must explicitly retest, not assume
- Phase 7/8 (v2.0): VRM/GLB Media Library upload allow-list + magic-byte validation, and the Gutenberg editor/view script split, are both live-verified and closed — no longer active concerns, retained here only if referenced by future gap-closure work

### Quick Tasks Completed

See prior STATE.md history / `.planning/quick/` directory for the full v2.0/v2.1 quick-task log (not repeated here to keep this file under the size budget).

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260712-mfz | Create a new demo page wiring OpenAIRealtimeProvider together with an avatar component so lipsync and conversation-driven animation motion can be tested end-to-end against a real OpenAI Realtime session | 2026-07-12 | 09db9f0 | [260712-mfz-create-a-new-demo-page-wiring-openaireal](./quick/260712-mfz-create-a-new-demo-page-wiring-openaireal/) |
| 260712-pt8 | Fix src/app/api/negotiate/route.ts — it implemented a stale SDP-relay contract instead of the ephemeral-token-minting contract OpenAIRealtimeProvider.connect() expects, causing a 400 invalid_offer error | 2026-07-12 | 3939527 | [260712-pt8-fix-src-app-api-negotiate-route-ts-it-im](./quick/260712-pt8-fix-src-app-api-negotiate-route-ts-it-im/) |
| 260712-qo9 | Fix src/app/openai-avatar-test/page.tsx — VRMAvatar was mounted without an animations prop, so resolveBaseClip always returns null and the avatar shows no animation at all | 2026-07-12 | 91f472d | [260712-qo9-fix-src-app-openai-avatar-test-page-tsx-](./quick/260712-qo9-fix-src-app-openai-avatar-test-page-tsx-/) |
| 260712-qvu | Extend resolveBaseClip in packages/react/src/animation/AnimationStateEngine.ts to add naming-convention-based clip matching for listening, thinking, starting, and stopped chatStatus values, mirroring the existing speaking pattern | 2026-07-12 | d304eee | [260712-qvu-extend-resolvebaseclip-in-packages-react](./quick/260712-qvu-extend-resolvebaseclip-in-packages-react/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Assets | ASSET-01..04 (final CC0 clips for stopped/listening/thinking, 2nd speaking variant, verified GLB rig) | Deferred to v2, tracked in GitHub issue #17 | v2.2 requirements definition (2026-07-12) |

## Session Continuity

Last session: 2026-07-18T08:13:00.559Z
Stopped at: 12-06 verification complete with gaps recorded -- gap-closure round needed for GAZE-01/GAZE-02 before Phase 12 can close
Resume file: .planning/phases/12-gaze-gesture/12-06-VERIFICATION.md
