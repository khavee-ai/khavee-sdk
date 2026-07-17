# Phase 12: Gaze & Gesture - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 12-gaze-gesture
**Areas discussed:** Gesture tool shape & LLM nudge, Gaze camera source, Gesture queuing outside speaking

---

## Gesture tool shape & LLM nudge

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — mirror toolAnimate exactly | New file packages/core/src/tools/gesture.ts exporting a plain object (name, description, parameters, no execute) — same shape as toolAnimate's trigger_animation. Consuming app supplies execute. | ✓ |
| SDK auto-registers it | KhaveeProvider or the RealtimeProvider construction path auto-injects the gesture tool + execute with zero consumer setup. | |

**User's choice:** Mirror toolAnimate exactly (D-01).

| Option | Description | Selected |
|--------|-------------|----------|
| set_gesture / nod,shake,none | Matches ticket #13's example verbatim and toolAnimate's snake_case tool-name convention. | ✓ |
| trigger_gesture / nod,shake,none | Mirrors toolAnimate's verb-first 'trigger_animation' naming more closely. | |

**User's choice:** `set_gesture` / `['nod', 'shake', 'none']` (D-02).

| Option | Description | Selected |
|--------|-------------|----------|
| Coach it in the description | Bake nod=agree/shake=disagree guidance into the tool description for zero-config, language-agnostic correctness. | ✓ |
| Keep it generic | Match toolAnimate's minimal description style; usage guidance is the consuming app's responsibility. | |

**User's choice:** Coach it in the description (D-03).
**Notes:** Rationale tied to this SDK's existing Thai-language support (Thonburian STT/JaiTTS) — English keyword coaching in system prompts would be a dead end, so baking semantics into the tool description itself is language-agnostic by construction.

---

## Gaze camera source

| Option | Description | Selected |
|--------|-------------|----------|
| R3F's active scene camera | useThree().camera — matches ticket #12's stated rationale exactly, symmetric across VRM/GLB by construction. | ✓ |
| The avatar's own cameras prop | Use VRMAvatar's existing cameras[0] with fallback — respects explicit app configuration at the cost of asymmetry with GLBAvatar. | |

**User's choice:** R3F's active scene camera (D-04).
**Notes:** Verified via grep that `GLBAvatar.tsx` has no `cameras` prop equivalent — confirms `useThree().camera` is the only symmetric option.

| Option | Description | Selected |
|--------|-------------|----------|
| Continuous subtle tracking | Head/neck holds a small, constantly-updated offset toward the camera, mirroring breathing/sway's always-on sine-driven pattern. | ✓ |
| Occasional glances (saccade-like) | Mostly neutral forward gaze with periodic brief glances on a randomized timer. | |

**User's choice:** Continuous subtle tracking (D-05).

---

## Gesture queuing outside `speaking`

| Option | Description | Selected |
|--------|-------------|----------|
| Apply immediately | No loop-boundary constraint exists outside speaking (that constraint protects talk-clip cycling specifically), so a nod/shake plays as soon as received. | ✓ |
| Queue until speaking starts | Hold every gesture hint regardless of state, only release at a speaking-state loop boundary. | |
| Drop hints received outside speaking | Only honor gesture hints that arrive while speaking. | |

**User's choice:** Apply immediately (D-06).

---

## Claude's Discretion

- Exact numeric parameters for gaze intensity (max offset angle, ramp/settle timing) and gesture delta magnitude/duration — follow `breathing.ts`'s numeric-specificity precedent.
- Module boundaries: gaze and gesture may live in one new module or two small ones alongside `breathing.ts`/`sway.ts`/`expressionDrift.ts` — no mandate beyond staying internal.
- Exact plumbing mechanism for threading the gesture-hint signal into `useKhavee()`/`KhaveeProvider` context — follow Phase 11's `currentVolume` precedent.
- Composition-order interaction between gaze's head/neck delta and existing procedural systems — extend Phase 11's `PERF-01` fixed, documented, bounded-magnitude composition rule.

## Deferred Ideas

- Tracked-user-position gaze mode — out of scope per ticket #12 and REQUIREMENTS.md.
- Semantic/keyword-triggered gestures beyond nod/shake — out of scope per ticket #13 and REQUIREMENTS.md.
- New public API surface (`enableNaturalMotion`, reserved `animations` keys, per-behavior flags) — Phase 13 scope.
- Frame-budget adaptive throttling for the full procedural stack — Phase 13's PERF-02, if still needed after profiling.
