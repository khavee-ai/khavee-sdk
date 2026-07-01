---
phase: 11-bone-masked-upper-body-animation-layering
verified: 2026-07-01T00:00:00Z
status: human_needed
score: 9/9 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Trigger the exact sequence: status-driven idle -> developer custom animate('someCustomKey') -> a DIFFERENT status-driven gesture than whatever was active before the custom call (e.g. idle -> custom -> listening, where listening's upper clip differs from idle's upper clip)."
    expected: "The upper body should crossfade smoothly (~0.3s fadeIn) into the new gesture's upper-body pose — NOT snap instantly. This is the exact scenario code-review finding WR-01 was about; the fix (`fadeScheduledThisPass` guard in the upper-layer effect, packages/react/src/VRMAvatar.tsx:733-764) was applied directly during the code-review-gate step (commit fe3a332), AFTER the original checkpoint had already been approved by the user. The original checkpoint (11-02-SUMMARY.md) never exercised this specific custom-path-into-a-different-gesture sequence, so the fix's correctness has only been verified by static code tracing in this report, not by a human watching it run."
    why_human: "Crossfade smoothness/timing is a runtime visual behavior that tsc/grep cannot assert. The fix logic is subtle (interacting `setEffectiveWeight`/`fadeIn` ordering across two effects sharing a mixer) and was specifically the kind of bug that static review, not the prior checkpoint, caught — worth one targeted confirmation before treating it as fully hardened."
---

# Phase 11: Bone-Masked Upper-Body Animation Layering Verification Report

**Phase Goal:** Bone-masked upper-body animation layering — replace the whole-skeleton crossfade with a dual-layer approach (always-on base-lower body action + crossfading upper-body action) for chatStatus-driven animation transitions, so the lower body never snaps/resets while the upper body smoothly crossfades, while leaving the existing whole-skeleton path intact for developer-triggered custom animate() calls.
**Verified:** 2026-07-01
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A THREE.AnimationClip can be filtered to only tracks for a named VRM bone set, resolved per-VRM (BONE-01) | VERIFIED | `packages/react/src/utils/filterClipTracksByBoneSet.ts:81-92,115-129` resolves bones via `vrm.humanoid?.getNormalizedBoneNode()`, builds a node-name `Set`, filters `clip.tracks` by `track.name.split(".")[0]`. Zero `startsWith(` string-match anti-pattern (grep = 0). |
| 2 | BASE_LOWER_BONES ∪ UPPER_BONES covers every distinct `mixamoVRMRigMap` value, no bone dropped (BONE-01) | VERIFIED | Programmatic diff: `BASE_LOWER_BONES` = 10 entries, `UPPER_BONES` = 42 entries, union = 52, zero overlap, zero missing/extra vs. `mixamoVRMRigMap.ts`'s 52 distinct values (confirmed via Node script, not just eyeballed). |
| 3 | Filtered sub-clip keeps original clip's duration, never recomputed (BONE-01) | VERIFIED | `filterClipTracksByBoneSet.ts:128`: `new THREE.AnimationClip(newName, clip.duration, filteredTracks)`. `resetDuration` grep = 0. |
| 4 | On chatStatus transitions, the lower body (hips/spine/legs) keeps playing the idle clip continuously with no snap or reset (BONE-02) | VERIFIED | `baseActionRef` created once via `.reset().play()` with no fadeIn (`VRMAvatar.tsx:540-546`), never swapped on status change (its own effect only fires once per mixer lifetime, guarded by `baseActionRef.current` check). Weight-zeroing bug found by checkpoint round 3 (frozen action against a torn-down mixer) was fixed by clearing `baseActionRef`/`upperActionRef` in the same mixer-teardown cleanup (`VRMAvatar.tsx:504-516`), confirmed present in current code. |
| 5 | The upper body crossfades 0.3s from idle-upper to the gesture clip's upper-body tracks on status transitions, and back on return to ready (BONE-03) | VERIFIED | `VRMAvatar.tsx:692-766` upper-layer effect: `.reset().fadeIn(0.3).play()` / `.fadeOut(0.3)` scoped to `upperActionRef`, `upperKey` falls back to `"idle"` per D-05 (`VRMAvatar.tsx:719-724`). Code-review WR-01 fix (`fadeScheduledThisPass` guard, lines 733-764) prevents `setEffectiveWeight` from cancelling an in-flight fadeIn — confirmed present (see human-verification item below for one untested edge sequence). |
| 6 | At rest (ready), upper body plays idle clip's own upper-body motion, not frozen bind pose (BONE-03) | VERIFIED | `upperKey` defaults to `"idle"` whenever `statusDrivenKeyRef.current !== currentAnimation` or no maskable clip exists for the current key (`VRMAvatar.tsx:719-724`), and `boneMaskedClips.upperByKey["idle"]` is derived from the same `idleClip` used for `baseLower`. |
| 7 | A developer's custom animate('customKey') for a non-status key plays the full-skeleton clip cleanly, with base/upper actions ceded to weight 0 (BONE-04) | VERIFIED | `isBoneMaskingActive()` (`VRMAvatar.tsx:636-642`) requires `statusDrivenKeyRef.current === currentAnimation`; a custom key never sets that ref, so masking is false, the whole-skeleton effect (`VRMAvatar.tsx:649-690`) drives the clip normally, and the weight-coordination effect zeroes `baseActionRef`/`upperActionRef` (`VRMAvatar.tsx:710-715`). |
| 8 | Phase 10 procedural deltas still apply after mixer.update(delta) and before currentVrm.update(delta); head stays under gesture-clip FBX control (D-03) | VERIFIED | Exactly one `new THREE.AnimationMixer` (`VRMAvatar.tsx:487`), exactly one `mixerRef.current.update(delta)` call (`VRMAvatar.tsx:830`), procedural deltas (breathing, head, gaze, etc.) follow at lines 833+, `currentVrm.update(delta)` remains last (`VRMAvatar.tsx:1129`). No second mixer/update introduced. |
| 9 | currentAnimation still updates for status-driven transitions for observability (Open Q3) | VERIFIED | All three `animate(...)` call sites inside the chatStatus auto-mapping effect (`animate(pick)`, `animate(matchedKey)`, `animate(targetKey)`) are unchanged and co-located with the new `statusDrivenKeyRef` assignments (`VRMAvatar.tsx:567-576, 599-603, 620-625`). |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/react/src/utils/filterClipTracksByBoneSet.ts` | `filterClipTracksByBoneSet()` + `BASE_LOWER_BONES`/`UPPER_BONES` exports, `getNormalizedBoneNode` resolution | VERIFIED | 3/3 exports present, resolution path confirmed, no anti-patterns. |
| `packages/react/src/VRMAvatar.tsx` | `baseActionRef`, `upperActionRef`, `statusDrivenKeyRef`, `boneMaskedClips` memo, base-lower always-on effect, upper-layer crossfade effect, gated whole-skeleton effect, cross-path weight coordination | VERIFIED | All present and wired (grep counts match/exceed plan acceptance criteria; see below). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `VRMAvatar.tsx` | `filterClipTracksByBoneSet` | `boneMaskedClips` useMemo `[processedClips, currentVrm]` | WIRED | `VRMAvatar.tsx:445-482`; imports at line 10, 3 call sites in file. |
| `VRMAvatar.tsx` upper-layer effect | `mixerRef.current.clipAction(upperClip)` | `.reset().fadeIn(0.3).play()` / `.fadeOut(0.3)` scoped to `upperActionRef` | WIRED | `VRMAvatar.tsx:732-745`. |
| `VRMAvatar.tsx` whole-skeleton effect | `statusDrivenKeyRef` / `isBoneMaskingActive()` | early-return gate before existing `.clipAction(targetClip)` body | WIRED | `VRMAvatar.tsx:649-657`; dependency array unconditionally includes `boneMaskedClips` and `statusDrivenEpoch` (`:690`), per plan's re-fire requirement. |
| `VRMAvatar.tsx` weight coordination | `setEffectiveWeight` | zero base/upper weight when custom key authoritative; restore to 1 for status keys | WIRED | `VRMAvatar.tsx:710-715, 762-763`; runs BEFORE the `!upperClip` early return (WR-02 fix confirmed at `:696-730`). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `boneMaskedClips.baseLower` | `idleClip` from `processedClips` | `remapMixamoAnimationToVrm` output, filtered by `BASE_LOWER_BONES` | Yes — real filtered track subset, guarded by `tracks.length > 0` (WR-03 fix) | FLOWING |
| `boneMaskedClips.upperByKey[key]` | each `processedClips` entry | filtered by `UPPER_BONES`, `tracks.length > 0` guard (D-05/Pitfall 5) | Yes | FLOWING |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` grep = 0 across both phase-modified files) | — | — |

### Code-Review Follow-up Fixes (11-REVIEW.md) — Verified Present in Current Code

| Finding | Fix Description | Verified in Code | Commit |
|---------|------------------|-------------------|--------|
| WR-01 (weight-restore cancels legit fadeIn) | `fadeScheduledThisPass` local guards the `setEffectiveWeight(1)` restore-to-1 branch | Present: `VRMAvatar.tsx:733-734, 762-763` | `fe3a332` |
| WR-02 (weight-zeroing skippable via early return) | Weight-coordination block moved before the `if (!upperClip) return;` early return | Present: `VRMAvatar.tsx:699-716` precedes `:727` return | `fe3a332` |
| WR-03 (`baseLower` missing zero-track guard) | `baseLowerCandidate.tracks.length > 0` guard added, mirroring `upperByKey`'s existing guard | Present: `VRMAvatar.tsx:458-467` | `fe3a332` |
| WR-04 (variable-length `useMemo` deps in `useAnimationFiles`) | Replaced spread-array `useMemo` deps with manual ref-based memoization (fixed-shape comparison) | Present: `VRMAvatar.tsx:138-164` (`stableRef`, `unchanged` comparison, no `useMemo` deps array at all) | `fe3a332` |
| IN-01 (no diagnostic when "idle" key missing) | `console.warn` added when `processedClips.length > 0 && !idleClip` | Present: `VRMAvatar.tsx:452-457` | `fe3a332` |
| IN-02 (no test coverage) | Not fixed — explicitly marked non-blocking in review given project-wide no-test convention | Confirmed absent (`packages/react/src/utils/__tests__/` does not exist) — acceptable, non-blocking per review disposition | N/A |
| IN-03 (redundant upper-filtering of all clips) | Not fixed — explicitly marked optional/non-blocking performance note | Confirmed unchanged — acceptable, non-blocking per review disposition | N/A |

All 4 warnings + 1 blocking-adjacent info item from 11-REVIEW.md were independently re-traced against the live `packages/react/src/VRMAvatar.tsx` source (not the commit message) and confirmed correctly implemented at the exact line ranges the review cited as problematic. `git log` confirms a single follow-up commit `fe3a332 fix(11): address code review findings WR-01..04, IN-01` immediately following the three checkpoint bug-fix commits.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| BONE-01 | 11-01-PLAN.md | Bone-set track-filtering utility + bone-split constants | SATISFIED | Truths 1-3 above |
| BONE-02 | 11-02-PLAN.md | Always-on base-lower continuous action | SATISFIED | Truth 4 above |
| BONE-03 | 11-02-PLAN.md | Upper-layer crossfade idle-upper <-> gesture, 0.3s | SATISFIED | Truths 5-6 above |
| BONE-04 | 11-02-PLAN.md | Status-driven vs custom branching + currentAnimation observability | SATISFIED | Truths 7, 9 above |
| BONE-05 | 11-02-PLAN.md | Cross-path weight coordination / Pitfall 2 | SATISFIED | Truth 7 above; WR-01/WR-02 fixes further hardening this requirement |

**Note:** `.planning/REQUIREMENTS.md` contains no `Phase 11`/`BONE-*` entries — this is expected and consistent with both the PLAN frontmatter note and the ROADMAP.md phase entry, which both explicitly state Phase 11 requirements are planner-assigned, phase-local IDs with no formal REQ IDs defined in REQUIREMENTS.md (that file tracks an unrelated WordPress-plugin milestone). No orphaned requirements.

### Build Verification

`pnpm --filter @khaveeai/react build` (tsc) — PASSED, no type errors, run directly during this verification (not taken from SUMMARY claims).

### Behavioral Spot-Checks

Skipped for runtime crossfade timing/visual smoothness — no headless rendering harness exists in this repo and Web Audio/WebGL context can't be exercised via grep/CLI within the spot-check time budget. All logic-level assertions (weight zeroing precedes early return, fade-guard boolean gates the snap, base/upper refs cleared on teardown) were instead verified via direct source inspection (see Anti-Patterns / Code-Review Follow-up tables above).

### Human Verification Required

### 1. Custom-animation-then-different-gesture crossfade smoothness (WR-01 edge case)

**Test:** With a `VRMAvatar` mounted with `idle`/`listening`/`thinking`/`speaking` status animations plus at least one custom non-status animation (e.g. `dance`), trigger this exact sequence: let the avatar sit at `ready`/idle, call `animate('dance')` (a non-status custom key), then immediately trigger a chatStatus transition to a DIFFERENT status than idle (e.g. simulate `listening`).
**Expected:** The upper body should smoothly crossfade (~0.3s) from the custom `dance` pose into `listening`'s upper-body gesture — not snap instantly.
**Why human:** This is the precise scenario code-review finding WR-01 identified (a `setEffectiveWeight` call cancelling an in-flight `fadeIn` on the same action, in a sequence the prior checkpoint round never exercised). The fix (`fadeScheduledThisPass` guard) is present and logically sound per static tracing, but was applied to `VRMAvatar.tsx` AFTER the human checkpoint had already been approved — no human has watched this specific sequence run since the fix landed (commit `fe3a332`). Crossfade smoothness is a runtime visual/timing property `tsc`/grep cannot assert.

### Gaps Summary

No code-level gaps found. All 9 derived observable truths (BONE-01 through BONE-05) are verified present and correctly wired in the current codebase, not merely described in SUMMARY.md prose. All 4 warnings + 1 info item from the code-review gate (11-REVIEW.md) were independently re-traced against live source and confirmed fixed at the exact locations the review flagged, with the corresponding fix commit (`fe3a332`) present in `git log`. `pnpm --filter @khaveeai/react build` passes with zero type errors. The sole remaining item is a targeted human re-check of one narrow crossfade-timing edge case (WR-01's specific reachable sequence) that was fixed after the original checkpoint approval and has not been re-verified visually since — flagged as `human_needed` rather than a gap, per the phase's own convention of routing runtime/visual behavior to human verification.

---

*Verified: 2026-07-01*
*Verifier: Claude (gsd-verifier)*
