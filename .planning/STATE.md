---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: Natural Avatar Animation
status: executing
stopped_at: Phase 11 gap closure round 4 needed — 11-12 checkpoint found G1 (T-pose) still failing pre-connect, plus a new Y-axis-drop-on-connect regression and a minor TALK-01 jiggle
last_updated: "2026-07-17T01:52:00.000Z"
last_activity: 2026-07-17 -- Phase 11 plans 11-11/11-12 executed (--gaps-only): 11-11 diagnosed the real G1/G2 root cause (shouldRunProceduralBoneWrites re-closing on every switchToClip, not just first mount) and fixed with a per-frame rest-pose reset (80/80 tests); 11-12 human re-verification confirmed G2 fixed, but G1 still fails pre-connect and surfaced 2 new findings (Y-axis drop on connect, minor TALK-01 jiggle)
progress:
  total_phases: 13
  completed_phases: 9
  total_plans: 52
  completed_plans: 52
  percent: 69
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-11)

**Core value (v2.2):** Replace `VRMAvatar`/`GLBAvatar`'s robotic chatStatus-driven animation switching with a unified, natural-feeling state architecture — shared internal module, procedural motion layer, and a zero-config public API.
**Current focus:** Phase 11 — idle-transition-talking-states (gap closure — not yet done)

## Current Position

Phase: 11 (idle-transition-talking-states) — GAP CLOSURE IN PROGRESS (round 4 needed)
Plan: 12 of 14 (11-01..11-12 have SUMMARY.md; 11-13/11-14 not yet planned; phase requirements not fully satisfied)
Status: 11-11 (fix) and 11-12 (re-verification) both executed. 11-11 found the REAL root cause via headless runtime evidence: `shouldRunProceduralBoneWrites` re-closed on EVERY `switchToClip` call, not just first mount — fixed with a per-frame rest-pose reset instead of a blocking gate (80/80 tests). 11-12 result: G2 (idle→talking snap) CONFIRMED FIXED. But G1 (T-pose on load) STILL FAILS — persists pre-connect, only resolves after pressing Connect, meaning 11-11's fix covered a post-connect case but not the actual pre-connect resting state. Two new findings also surfaced: (G3) avatar visibly drops on the Y axis when Connect is first pressed, (G4) minor jiggle during TALK-01's talk-clip cycling. None of G1/G3/G4 are root-caused yet. The other 6 original requirements were not explicitly re-confirmed this round.
Last activity: 2026-07-17 -- Phase 11 gap-closure wave (11-11, 11-12) executed via /gsd-execute-phase 11 --gaps-only

Next: plan a fourth gap-closure pass (11-13/11-14) to root-cause and fix G1 (pre-connect T-pose — likely `update(delta)` never running before the first Connect/switchToClip), G3 (Y-drop-on-connect), and G4 (TALK-01 jiggle), then a full regression re-check — e.g. `/gsd-plan-phase 11 --gaps`. Phase 11 cannot be marked complete until these are resolved.

Progress: [████████░░] 75% (v2.2 milestone; v2.1 Phase 9 tracked separately at 5/6 plans complete)

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
| 10 | 0/TBD | - | - |
| 11 | 0/TBD | - | - |
| 12 | 0/TBD | - | - |
| 13 | 0/TBD | - | - |

**Recent Trend:**

- Last 5 plans: 09-01, 09-02, 09-03, 09-04, 09-05
- Trend: v2.1 Phase 9 (Block Studio) at 5/6 plans, blocked on 09-06 live UAT checkpoint. v2.2 roadmap just created — 4 phases (10-13), no plans decomposed yet.

*Updated after each plan completion*

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

### Pending Todos

None yet.

### Blockers/Concerns

- v2.2: Phase 11 not fully closed after gap-closure wave (11-11/11-12, 2026-07-17): 11-11 correctly root-caused the ACTUAL G1/G2 mechanism via headless runtime evidence (the 11-09 gate re-closed on every `switchToClip`, not just first mount) and fixed it with a per-frame rest-pose reset. G2 is now confirmed fixed. But G1 (T-pose on load) STILL FAILS — persists pre-connect, only resolves after pressing Connect, meaning the fix covers a post-connect case, not the true pre-connect resting state. Two new findings: (G3) avatar drops on the Y axis when Connect is pressed, (G4) minor jiggle during TALK-01 clip cycling. None root-caused yet. Needs a fourth gap-closure plan (11-13/11-14) before Phase 11 can be marked complete.
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

Last session: 2026-07-17T01:52:00.000Z
Stopped at: Phase 11 gap closure round 3 (11-11/11-12 executed; G2 fixed; G1 still fails pre-connect; G3/G4 new findings — needs round 4)
Resume file: .planning/phases/11-idle-transition-talking-states/11-12-SUMMARY.md
