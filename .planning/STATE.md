---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: Natural Avatar Animation
status: executing
stopped_at: 12-10 landed CR-01 gaze re-clamp fix + real-asset diagnosis; GAZE-02 human-verify checkpoint deferred by user (explicitly not urgent) -- GAZE-02 remains an open, low-priority gap and Phase 12 has not been closed
last_updated: "2026-07-19T00:35:00.000Z"
last_activity: 2026-07-19 -- 12-10 executed (Tasks 1-2 autonomous, Task 3 human-verify deferred by user decision)
progress:
  total_phases: 13
  completed_phases: 10
  total_plans: 68
  completed_plans: 68
  percent: 77
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-11)

**Core value (v2.2):** Replace `VRMAvatar`/`GLBAvatar`'s robotic chatStatus-driven animation switching with a unified, natural-feeling state architecture — shared internal module, procedural motion layer, and a zero-config public API.
**Current focus:** Phase 12 — gaze-gesture

## Current Position

Phase: 12 (gaze-gesture) — OPEN (GAZE-02 deferred, low priority)
Plan: 10 of 10
Status: All 10 plans have SUMMARY.md; phase not closed (GAZE-02 requirement open, deprioritized by user)
Last activity: 2026-07-19 -- 12-10 executed, GAZE-02 checkpoint deferred by user

Plan 12-06 result: Objective code-level gates G-1..G-9 all PASS. Live human verification confirmed GEST-01 and GEST-02 ("approved" on both). GAZE-01 and GAZE-02 FAILED: gaze snapped directly to its target instead of smoothly transitioning (Gap 1), and the GLB avatar additionally showed a GLB-only idle-animation spin regression (Gap 2). Full detail in `12-06-VERIFICATION.md`.

Plan 12-07 result: Fixed Gap 1 — added persistent frame-rate-independent smoothing to `stepGaze` so gaze eases toward its target instead of snapping; mode switches (camera↔aversion) now ease onward rather than routing through the neutral base. `packages/react` suite 147/147 green, tsc clean.

Plan 12-08 result: Root-caused and fixed Gap 2's underlying math — the camera-mode gaze target is now computed from the head's actual world-forward orientation (group-rotation-agnostic) instead of an assumed absolute world axis, plus a frontal-range relaxation. `packages/react` suite 150/150 green, tsc clean. This corrected a real bug affecting both VRM and GLB math, but did NOT fully resolve the visible GLB idle-spin symptom (see 12-09).

Plan 12-09 result (human re-verification): GAZE-01 (VRM) explicit PASS across all four live states — smooth, no snapping. GAZE-02 (GLB): gaze-easing itself confirmed smooth, but **the idle-animation spin/twist is still present** despite the 12-08 fix — human explicitly reported "the idle-animation spin/twist on glb is not gone." This means 12-08's diagnosed root cause was not the (or not the only) source of the visible spin. Full detail in `12-09-VERIFICATION.md` and `12-09-SUMMARY.md`.

Plan 12-10 result: Task 1 (autonomous, TDD) added a final-delta re-clamp to `stepGaze` (CR-01 fix) guaranteeing the applied head-bone delta never exceeds `MAX_GAZE_ANGLE_RAD` even under a discontinuous base-pose jump between frames — proven by 2 new RED-first regression tests (observed RED: 0.1766 rad camera-mode, 0.0822 rad aversion-mode, now GREEN); full suite 152/152, tsc clean. Task 2 (autonomous, measurement-only) ran a real-asset headless diagnostic against `happy.glb` and found gaze is **provably inactive** on `/glb-avatar-test` (`chatStatus` permanently `"stopped"` there — gaze's no-op branch), so the CR-01 fix cannot be the cause of the observed spin; the idle clip `"State 1 Idle (loop)"` itself has a measured ~0.202 rad head-bone discontinuity at its own loop seam, while breathing/sway spine delta is negligible (~0.00586 rad). Verdict: **"CR-01 NOT SUFFICIENT / FALLBACK PRIMARY."** Task 3 (blocking human-verify) was reached but the user explicitly declined live verification and directed it be **marked unresolved and deferred — not urgent**. GAZE-02 therefore remains OPEN (not signed off PASS, not confirmed-failing-live), tracked as a low-priority known gap. A future round (not yet scheduled/numbered) should investigate `happy.glb`'s own idle-clip loop-seam continuity if/when this becomes a priority again — NOT gaze.ts (ruled out) and NOT breathing.ts/sway.ts (ruled out).

Phase 12 is NOT complete — GAZE-02 is an open, deprioritized gap (user-deferred, not urgent). Requirements GEST-01, GEST-02, and GAZE-01 are confirmed PASS; GAZE-02 remains open with a confirmed-but-unverified root-cause hypothesis (happy.glb's own idle-clip loop seam).

Progress: [████████░░] 77% (10/13 roadmap phases fully closed; Phase 12's 10 plans all have SUMMARY.md on disk, but the phase itself has a deferred open gap (GAZE-02) and is not closed)

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
| 12 | 10/10 (GAZE-02 gap deferred) | - | - |
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
- [Phase 12]: Plan 12-06 verification found 2 gaps (gaze snapping, GLB idle spin). 12-07 fixed the snapping (persistent smoothing); 12-08 root-caused and fixed a group-rotation-dependence bug in the camera-relative gaze target. 12-09 re-verification: GAZE-01 (VRM) now PASS; GAZE-02 (GLB) gaze-easing is smooth but the idle-animation spin is STILL PRESENT — 12-08's fix did not fully resolve the visible symptom. 12-10 landed a CR-01 head-bone re-clamp fix (correct invariant regardless of cause) and empirically proved gaze.ts is inactive on the GLB test page, pointing the real cause at happy.glb's own idle-clip loop-seam (~0.202 rad discontinuity) rather than gaze/breathing/sway. The user explicitly deferred the blocking human-verify checkpoint as not urgent — GAZE-02 stays OPEN as a known, low-priority gap. Do not treat gaze as production-ready in Phase 13 until GAZE-02 is revisited and passes, but this is not currently blocking other work.

### Pending Todos

- GAZE-02 (Phase 12, GLB idle-animation spin) — deferred by user 2026-07-19, low priority, not urgent. Root-cause hypothesis confirmed via 12-10's real-asset diagnostic: `happy.glb`'s own idle-clip loop-seam discontinuity (~0.202 rad), independent of gaze.ts (ruled out — inactive on `/glb-avatar-test`) and breathing.ts/sway.ts (ruled out — negligible). Revisit with a live human-verify pass when this becomes a priority again.

### Blockers/Concerns

- v2.2: Phase 12 (gaze-gesture) has one open, DEFERRED gap as of 12-10 (2026-07-19) — GAZE-01 (VRM) and GEST-01/GEST-02 are confirmed PASS. GAZE-02 (GLB) is open: 12-10 landed a correct CR-01 head-bone re-clamp invariant fix and proved gaze.ts is inactive on `/glb-avatar-test` (so gaze.ts is NOT the cause there); the idle spin most likely originates in `happy.glb`'s own idle-clip loop-seam (~0.202 rad measured discontinuity), NOT breathing.ts/sway.ts (ruled out, negligible). The user explicitly declined live re-verification and asked this be marked unresolved/low-priority/not urgent — no further gap-closure round is scheduled. Revisit and live-verify before treating gaze as production-ready in Phase 13, but this is not currently blocking.
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
| 260719-1yq | Improve avatar render quality in SDK — shared renderQuality.tsx helper (mesh castShadow/receiveShadow, anisotropy, ACESFilmic tone mapping + sRGB color space, scoped AvatarLightRig), wired as 5 additive opt-out props on VRMAvatar/GLBAvatar, all forced-on by default | 2026-07-19 | 71f8542 | [260719-1yq-improve-avatar-render-quality-in-sdk-vrm](./quick/260719-1yq-improve-avatar-render-quality-in-sdk-vrm/) |
| 260712-qo9 | Fix src/app/openai-avatar-test/page.tsx — VRMAvatar was mounted without an animations prop, so resolveBaseClip always returns null and the avatar shows no animation at all | 2026-07-12 | 91f472d | [260712-qo9-fix-src-app-openai-avatar-test-page-tsx-](./quick/260712-qo9-fix-src-app-openai-avatar-test-page-tsx-/) |
| 260712-qvu | Extend resolveBaseClip in packages/react/src/animation/AnimationStateEngine.ts to add naming-convention-based clip matching for listening, thinking, starting, and stopped chatStatus values, mirroring the existing speaking pattern | 2026-07-12 | d304eee | [260712-qvu-extend-resolvebaseclip-in-packages-react](./quick/260712-qvu-extend-resolvebaseclip-in-packages-react/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Assets | ASSET-01..04 (final CC0 clips for stopped/listening/thinking, 2nd speaking variant, verified GLB rig) | Deferred to v2, tracked in GitHub issue #17 | v2.2 requirements definition (2026-07-12) |

## Session Continuity

Last session: 2026-07-19T00:35:00.000Z
Stopped at: 12-10 landed CR-01 gaze re-clamp fix + real-asset diagnosis; GAZE-02 human-verify checkpoint deferred by user (not urgent) -- GAZE-02 remains an open, low-priority gap
Resume file: .planning/phases/12-gaze-gesture/12-10-SUMMARY.md
