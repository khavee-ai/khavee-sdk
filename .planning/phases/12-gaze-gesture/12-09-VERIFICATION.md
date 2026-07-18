# Phase 12 Plan 09: Human Re-Verification of Gap 1 + Gap 2 Fixes

**Status: GAPS_FOUND (PARTIAL)** — GAZE-01 is confirmed PASS. GAZE-02 remains an open gap: the gaze-easing half of the fix is confirmed, but the GLB-only idle-animation spin the 12-08 fix targeted is still observed live.

This is the re-verification checkpoint for the two Phase 12 gap-closure fixes:
- 12-07 (Gap 1): persistent frame-rate-independent gaze smoothing (replaces the one-shot ramp; fixes "snap, not smooth")
- 12-08 (Gap 2): group-rotation-agnostic gaze target + frontal-range relaxation (targets the GLB-only idle-animation spin)

GEST-01 and GEST-02 are unchanged since 12-06 (already confirmed PASS there) and were not re-tested in this checkpoint per the plan's own scope.

---

## Pre-Checkpoint Automated Gate

Executed before presenting the checklist to the human, at commit `4c1932a`:

| Check | Command | Result |
|---|---|---|
| `packages/react` test suite | `cd packages/react && pnpm test` | 150/150 passing |
| `packages/react` type-check | `cd packages/react && npx tsc --noEmit` | Clean (exit 0) |
| Dev server reachability | `pnpm dev`, then load both demo pages | `/openai-avatar-test` reachable, `/glb-avatar-test` reachable |

No objective gate failure blocked the human checkpoint.

---

## Human Verdict

The human's verdict was gathered across the original live report plus two clarifying follow-up questions.

### Per-State / Per-Format Verdicts

| Item | Format | Verdict | Notes |
|---|---|---|---|
| Gaze easing, `ready` | VRM (`male.vrm`) | **PASS** | Camera-relative gaze eases smoothly toward target, no snap |
| Gaze easing, `listening` | VRM (`male.vrm`) | **PASS** | Smooth soft-attend toward camera |
| Gaze easing, `speaking` | VRM (`male.vrm`) | **PASS** | Smooth soft-attend toward camera |
| Gaze easing, `thinking` | VRM (`male.vrm`) | **PASS** | Smooth brief look-away/aversion, eases in/out without snapping back through a neutral pose |
| Gaze easing (general) | GLB (`happy.glb`) | **PASS** | Human explicitly confirmed: head attending smoothly toward camera IS smooth and correct on GLB |
| Idle-animation body spin/twist | GLB (`happy.glb`) | **FAIL (open gap)** | Human explicitly stated: "The idle-animation spin/twist on glb is not gone." The 12-08 fix did not resolve the observed symptom. |

### GAZE-01 (VRM per-state gaze, `/openai-avatar-test`) — Sign-off: **PASS**

All four live states (`ready`, `listening`, `speaking`, `thinking`) confirmed smooth by the human, with no snapping. This closes GAZE-01 for Phase 12 purposes.

### GAZE-02 (GLB avatar symmetry, `/glb-avatar-test`) — Sign-off: **REMAINING GAP (NOT PASS)**

GAZE-02 requires BOTH (a) smooth gaze easing on GLB matching VRM's behavior, AND (b) no idle-animation spin/twist. Only (a) is confirmed:

- **(a) Gaze easing — PASS.** The human explicitly confirmed the head attends toward the camera smoothly on GLB, matching VRM's corrected behavior. The 12-07 smoothing fix generalizes correctly to the GLB rig.
- **(b) Idle-animation spin — FAIL, gap remains.** The human explicitly stated the idle-animation spin/twist on GLB is still present ("not gone"). This is the exact symptom Gap 2 (12-08) was scoped to close.

**GAZE-02 is NOT signed off as PASS.** It remains an open requirement.

**Recorded gap detail (state / format / symptom):**

| Field | Value |
|---|---|
| State | Idle animation (not a live conversational chatStatus — occurs while the avatar is idling, independent of `ready`/`listening`/`speaking`/`thinking` gaze targeting) |
| Format | GLB only (`happy.glb`, `/glb-avatar-test`). Not reproduced on VRM (`male.vrm`) in this or the prior 12-06 checkpoint. |
| Symptom | The model's body still spins/twists during idle animation, despite the 12-08 group-rotation-agnostic gaze target + frontal-range relaxation fix. |

**Root-cause implication:** 12-08's SUMMARY documents that its fix corrected the camera-relative gaze target math (deriving the target from the head's actual current world forward instead of an assumed absolute world -Z axis) and added a frontal-range relaxation to avoid persistently pinning the clamped gaze offset at `MAX_GAZE_ANGLE_RAD` when the camera sits outside a quarter-turn of the head's actual facing. 12-08 explicitly deferred live confirmation of whether this math fix eliminates the visible idle-spin symptom to this checkpoint (12-09) — see 12-08-SUMMARY.md's "Issues Encountered": *"A live-rendered, fully causal explanation for why the reported symptom manifests as visible spinning specifically on GLB ... was not conclusively pinned down at the unit-test level ... this plan's own `<done>` criteria for Task 2 explicitly defers live confirmation to 12-09."*

That live confirmation has now happened, and the result is negative: the spin persists. This means either:
- the root cause 12-08 diagnosed (world-target math treating a local bind-pose axis as an absolute world reference, causing large `setFromUnitVectors` axis swings near the antiparallel singularity) is not the (or not the only) cause of the visible idle-spin symptom specifically, or
- something else independent of the camera-relative gaze target computation is also driving the visible spin during idle — e.g. an interaction between gaze's additive `multiply()` write and GLB's idle animation/procedural stack (breathing/sway) that is not present or not visible on VRM's rig/mount.

This is recorded here as an open finding requiring further investigation. No diagnosis or fix is attempted in this plan (12-09 is verification-only, per its own scope) — a further gap-closure round (12-10) is required.

---

## Regression Note (Phase 11 idle: breathing/sway/blink)

**Not explicitly flagged as broken by the human.** No breathing/sway/blink regression was reported on either avatar format during this checkpoint. However, this was **not exhaustively re-confirmed** — the human's attention was primarily focused on the GLB idle-spin gap, and the regression check was not walked through state-by-state as thoroughly as in 12-06. Recorded here as "no regression reported" rather than "regression-free re-confirmed."

---

## Requirement Sign-off Summary

| Requirement | Verdict | Notes |
|---|---|---|
| GAZE-01 (VRM per-state gaze) | **PASS** | All four live states confirmed smooth, no snap |
| GAZE-02 (GLB avatar symmetry) | **REMAINING GAP** | Gaze-easing half confirmed PASS; idle-animation spin half still FAILS — 12-08's fix did not resolve the observed symptom |
| GEST-01 (manual Nod/Shake + LLM `set_gesture`) | PASS (unchanged, confirmed in 12-06) | Not re-tested this checkpoint |
| GEST-02 (gesture queued to loop boundary during speaking) | PASS (unchanged, confirmed in 12-06) | Not re-tested this checkpoint |

## Overall Verdict

**Phase 12 is NOT fully confirmed.** GAZE-01 is now closed (PASS). GEST-01/GEST-02 remain closed (PASS, from 12-06). GAZE-02 has an open gap: the GLB idle-animation spin/twist that Gap 2 (12-08) targeted is still present live, even though the underlying camera-relative gaze target math bug 12-08 diagnosed was fixed. A further gap-closure round (a 12-10 plan) is required to investigate why the idle spin persists after 12-08's fix — either the root cause is not fully what 12-08 diagnosed, or an additional factor specific to idle-animation-plus-gaze interaction on the GLB rig is also in play. Phase 12 cannot close until GAZE-02 is explicitly signed off as PASS in a subsequent verification round.
