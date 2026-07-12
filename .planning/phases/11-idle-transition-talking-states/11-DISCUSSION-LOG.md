# Phase 11: Idle, Transition & Talking States - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-12
**Phase:** 11-idle-transition-talking-states
**Areas discussed:** Asset gap strategy, Audio signal source, Degradation scope

---

## Asset gap strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Build against placeholders now | Reuse/repurpose existing clips as placeholders (GLB's happy.glb named states; VRM falls back to idle for listening/thinking/stopped) matching Phase 10's D-03 precedent. Final CC0 assets stay tracked in issue #17. | ✓ |
| Block this phase on sourcing real clips first | Pause Phase 11 planning until dedicated listening/thinking/stopped clips are actually sourced. | |

**User's choice:** Build against placeholders now (recommended option).
**Notes:** Grounded in wayfinder's own asset-sourcing research (ASSET-RESEARCH.md, tickets #9/#16) finding these gaps genuinely unresolved after two full sourcing passes, and REQUIREMENTS.md/STATE.md already deferring them at the project level (ASSET-01..04, issue #17). Candidate placeholder mapping (GLB's happy.glb named clips) surfaced during research but flagged as unverified — not treated as locked.

---

## Audio signal source

| Option | Description | Selected |
|--------|-------------|----------|
| Use useRealtime's currentVolume | The only live, per-frame volume signal that actually exists in the codebase during a real conversation. | ✓ |
| Extend useAudioLipSync itself | Add a live volume value to useAudioLipSync's return, despite its current API shape (analyze one audio file at a time) not naturally fitting a continuous stream. | |

**User's choice:** Use useRealtime's currentVolume (recommended option).
**Notes:** Discovered via direct source inspection that useAudioLipSync() (packages/react/src/hooks/useAudioLipSync.ts) returns no live volume scalar at all — it's built around analyzing pre-recorded audio files. REQUIREMENTS.md's TALK-02 wording ("useAudioLipSync") is treated as imprecise shorthand for "the live audio-reactive signal," not a literal API pointer. Flagged a known plumbing gap: currentVolume isn't currently threaded through KhaveeProvider/useKhavee() context the way chatStatus already is — new plumbing needed.

---

## Degradation scope

| Option | Description | Selected |
|--------|-------------|----------|
| Build composition rule only, defer throttling | Implement additive delta-quaternion composition + bounded magnitude (what PERF-01 literally requires) this phase. Skip frame-time-pressure detection/adaptive throttling. | ✓ |
| Build the full degradation system now | Implement the complete tiered throttle scheme from PERFORMANCE-BUDGET.md §5 as part of Phase 11. | |

**User's choice:** Build composition rule only, defer throttling (recommended option).
**Notes:** PERF-01's actual requirement text only mandates the composition rule (additive multiply, fixed order, bounded magnitude) — the frame-time-pressure-detection/throttling system is a recommendation in PERFORMANCE-BUDGET.md §5, not a hard requirement. Single-avatar procedural cost is synthesized (not benchmarked) at ~1-2ms total, likely not a real problem yet.

---

## Claude's Discretion

- Exact numeric parameters for breathing/sway (period, amplitude range, randomization bounds) — follow blink.ts's approach (kept its original inline constants) as the reference for numeric specificity expected in this codebase.
- Fixed composition order for breathing → sway → audio-reactive amplitude when multiple systems touch the same bone — any fixed, documented, deterministic order is acceptable as long as combined magnitude is bounded.
- Whether new procedural systems live in one new module or several small ones alongside blink.ts — Phase 10 established the internal-only, not-exported-from-index.ts pattern but didn't mandate finer module boundaries.

## Deferred Ideas

- Sourcing final CC0 clips for stopped/listening(2+)/thinking(2+)/speaking 2nd clean variant — issue #17 (ASSET-01..04).
- Fixing the bundled Mixamo files' redistribution-license risk — issue #11, unrelated compliance work.
- Full graceful-degradation/adaptive-throttling system (PERFORMANCE-BUDGET.md §5) — revisit if runtime profiling shows the composition-only implementation is actually over budget.
- Gaze/attention system and semantic gestures — Phase 12 scope (GAZE-01/02, GEST-01/02).
- New public API surface (enableNaturalMotion, reserved animations keys, zero-config defaults) — Phase 13 scope (API-01..04).
