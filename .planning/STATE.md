---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: WordPress Plugin (Custom Mode)
status: planning
last_updated: "2026-06-21T12:20:42.573Z"
last_activity: 2026-06-21
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-17)

**Core value:** A developer can assemble a full voice pipeline (STT + LLM + TTS, with tool-calling) from independently swappable vendor adapters — without being locked into OpenAI for every stage.
**Current focus:** Phase 04 — generic-demo-page

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-21 — Milestone v2.0 started

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |
| 03 | 2 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Milestone-wide: New `generic-stt-tts` package built alongside `openai-stt-tts`, not replacing it — avoids regression risk
- Milestone-wide: Tool-calling is plain object + handler, no Zod/decorators — beginner-DX constraint
- Milestone-wide: STT/TTS backend protocol is streaming-chunked HTTP (whole-utterance POST), not WebSocket — neither Thonburian Whisper nor JaiTTS support true incremental streaming

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: Must avoid baking OpenAI-shaped assumptions into "generic" interfaces — no real second LLM vendor exists yet to validate tool-calling abstraction against (mitigation: written Anthropic/Gemini sketch required before phase is done, per research)
- Phase 3: `thonburian-stt` and `jai-tts` live at sibling paths `/Users/whitemalt/Documents/thonburian-stt` and `/Users/whitemalt/Documents/jai-tts`, NOT inside khavee-sdk — currently empty, greenfield, no git history. Plans touching these must use absolute paths.
- Phase 3: Vendored `FlowTTSPipeline`/ThonburianTTS repo's exact dependency pins were not directly inspectable during research — resolve empirically when scaffolding
- Phase 5: VAD-loopback cooldown (currently a 500ms magic number tuned for OpenAI TTS) cannot be validated against JaiTTS until that service exists — must explicitly retest, not assume

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-19T07:53:13.086Z
Stopped at: Phase 4 context gathered
Resume file: .planning/phases/04-vendor-adapters-audio-contract/04-CONTEXT.md
