---
phase: 12-gaze-gesture
verified: 2026-07-18T15:30:00Z
status: gaps_found
score: 2/4 must-haves verified
overrides_applied: 0
gaps:
  - truth: "GAZE-01: ready/listening/speaking show camera-relative soft gaze; thinking shows brief gaze aversion; starting/stopped get no separate gaze treatment"
    status: failed
    reason: "Gaze mode branching (camera/aversion/none) is implemented correctly and unit-tested, but the camera-relative offset snaps to its target every frame instead of smoothly transitioning once the 0.3s ramp-in saturates. Human-verify checkpoint (12-06) confirmed this live; independent code read confirms the root cause."
    artifacts:
      - path: "packages/react/src/animation/gaze.ts"
        issue: "stepGaze's ramp/ease logic (lines 211-274) only damps during the first RAMP_SECONDS (0.3s) after a mode change. Once `strength = Math.min(1, modeElapsed / RAMP_SECONDS)` saturates at 1, `_scratchEasedTarget.copy(_scratchCurrent).slerp(_scratchClampedTarget, strength)` collapses to exactly `_scratchClampedTarget` every frame. Since `_scratchCurrent` is captured fresh from the bone's actual current orientation each frame (line 220), the resulting delta closes the full gap to the target in one frame, every frame — a continuous hard snap toward a moving camera, not a continuously-damped approach. Confirmed by code review (12-REVIEW.md IN-01) and matches the human's exact report ('the gaze is snap, not smooth')."
    missing:
      - "Per-frame exponential/critically-damped approach toward the target once ramped in (e.g. slerp(current, clampedTarget, dampingFactor * delta) every frame), replacing the one-shot ramp-then-full-snap behavior."
  - truth: "GAZE-02: Gaze applies symmetrically to both VRM and GLB (bone-level behavior, not expression-dependent)"
    status: failed
    reason: "Shares GAZE-01's snapping root cause (same stepGaze code path used by both adapters via getHumanoidBoneNode('head'), confirmed bone-level/format-agnostic in principle) but additionally has a GLB-only idle-animation spin regression with no confirmed root cause, found live by the human checkpoint and not reproduced on VRM."
    artifacts:
      - path: "packages/react/src/animation/gaze.ts"
        issue: "Same snap mechanism as GAZE-01 (shared code path, not format-specific)."
      - path: "packages/react/src/GLBAvatar.tsx"
        issue: "GLB-only idle-animation spin regression reported live by human verification; root cause not isolated within Phase 12's files (12-REVIEW.md: 'did not find a definitive new root cause ... within the files in scope')."
    missing:
      - "Root-cause investigation and fix for the GLB-only idle-spin regression, verified specifically on the GLB avatar page with no regression to VRM."
      - "Re-confirmation that gaze reads symmetrically on both formats once Gap 1 (snapping) is fixed."
human_verification:
  - test: "Re-run the 12-06 human-verify checklist after a gaze-smoothing fix lands: observe ready/listening/speaking gaze on /openai-avatar-test (VRM) and the GLB avatar page, confirm the head/neck offset eases toward the camera rather than snapping."
    expected: "Gaze visibly interpolates toward the camera-relative target over a short, continuous damping window, with no discrete jump."
    why_human: "Smoothness/motion-quality is a subjective visual judgment that cannot be asserted from static code reads or unit tests alone."
  - test: "Re-run the GLB idle-animation observation specifically, with no chat activity, to confirm the reported spin no longer occurs."
    expected: "GLB avatar's idle animation looks the same as before Phase 12 (matching Phase 11's confirmed idle behavior) — no unexpected spin."
    why_human: "Visual regression with unknown root cause; requires live rendering to confirm resolution."
---

# Phase 12: Gaze & Gesture Verification Report

**Phase Goal:** Ship camera-relative soft-gaze (GAZE-01/02) and LLM-tool-triggered nod/shake gestures (GEST-01/02) as procedural animation layers, wired end-to-end into VRM and GLB avatars and a live demo.
**Verified:** 2026-07-18T15:30:00Z
**Status:** gaps_found
**Re-verification:** No — this is the phase-level VERIFICATION.md; it builds on and independently confirms the in-phase human-verify checkpoint recorded in `12-06-VERIFICATION.md`.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GAZE-01: per-state camera-relative gaze (ready/listening/speaking) + thinking aversion + starting/stopped no-op | ✗ FAILED | Mode branching (`resolveMode`) and no-op gate verified correct and unit-tested (`gaze.ts:155-201`, `gaze.test.ts` 14 tests). But the delta math snaps instead of smoothly transitioning once ramp saturates — confirmed independently by reading `stepGaze` (`gaze.ts:211-274`) and corroborated by 12-06's live human-verify ("the gaze is snap, not smooth") and 12-REVIEW.md's IN-01 root-cause trace. |
| 2 | GAZE-02: gaze applies symmetrically to VRM and GLB (bone-level, adapter-agnostic) | ✗ FAILED | Code is format-agnostic by construction (`adapter.getHumanoidBoneNode("head")`, used identically by `VRMAvatar.tsx`/`GLBAvatar.tsx`). But human-verify found the same snap on GLB PLUS a GLB-only idle-animation spin regression not reproduced on VRM, with no root cause isolated in Phase 12's files. |
| 3 | GEST-01: LLM emits gesture hint via tool-calling (no separate classification call, no regex) | ✓ VERIFIED | `toolGesture` (`packages/core/src/tools/gesture.ts`) is a flat-shape tool schema exported from `@khaveeai/core`'s barrel (`index.ts:3`). Demo page registers it via `openaiProvider.registerFunction({...toolGesture, execute})` inside a `useEffect` (`src/app/openai-avatar-test/page.tsx:64-72`), execute calls `setGestureHint(args?.gesture ?? null)`. Human-verify confirmed "approved" for both manual buttons and LLM-triggered path. |
| 4 | GEST-02: triggered gestures are bone deltas, queued to next talk-cycle loop boundary during speaking, never interrupt mid-clip | ✓ VERIFIED | `stepGesture` (`gesture.ts:98-156`) triggers immediately outside `speaking`, and reuses `detectLoopBoundary` (extracted once in `talkCycle.ts:89`, imported by `gesture.ts:37`) to gate starts during `speaking`. Additive-only write via `head.quaternion.multiply(_scratchGesture)` (no new clip). Human-verify confirmed "approved." |

**Score:** 2/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/tools/gesture.ts` | `toolGesture` LLM tool schema (set_gesture) | ✓ VERIFIED | Flat shape, `enum: ["nod","shake","none"]`, name `"set_gesture"`, coaching description present. |
| `packages/core/src/index.ts` | Barrel re-export of `toolGesture` | ✓ VERIFIED | `export { toolGesture } from './tools/gesture';` present (line 3). |
| `packages/react/src/animation/gaze.ts` | Camera-relative + aversion gaze, additive, no-op starting/stopped | ⚠️ VERIFIED-WITH-BUG | Exists, substantive, wired, additive (`multiply`, no `.lookAt()`/`.set()`), correctly gates starting/stopped — but the eased-target math is defective (snaps once ramp saturates). Level 1-3 pass; behavior (Level 4 equivalent) fails. |
| `packages/react/src/animation/gaze.test.ts` | Per-state + clamp + additive-not-overwrite + no-op assertions | ✓ VERIFIED (as unit tests) | 14 tests pass — but tests exercise the ramp only at intermediate `strength` values / don't assert continuous-damping behavior once `strength` saturates at 1, so they did not catch the snap (consistent with the human-verify finding surfacing a gap the unit tests don't cover). |
| `packages/react/scripts/verify-head-axis.mjs` | Headless head-bone forward-axis empirical check | ✓ VERIFIED | Present, referenced in `gaze.ts` file header, both bundled rigs measured -Z forward. |
| `packages/react/src/animation/talkCycle.ts` | Extracted `detectLoopBoundary`, `stepTalkCycle` unchanged | ✓ VERIFIED | `export function detectLoopBoundary` at line 89, called by `stepTalkCycle` (line 127) and imported by `gesture.ts` (line 37). |
| `packages/react/src/animation/gesture.ts` | `useGesture()`/`stepGesture` triggered bone-delta pulse | ✓ VERIFIED | Exists, substantive, wired, additive-only, reuses `detectLoopBoundary`. |
| `packages/react/src/animation/gesture.test.ts` | Immediate-vs-queued + envelope + consume-once assertions | ✓ VERIFIED | 13 tests pass. |
| `packages/react/src/KhaveeProvider.tsx` | `gestureHint` + public `setGestureHint` (enum-validated) | ✓ VERIFIED | Lines 28-30 (context type), 104 (state), 306-312 (validated setter, stores null for unrecognized values, never throws). |
| `packages/react/src/animation/AnimationStateEngine.ts` | `useGaze`/`useGesture` instantiated, composition steps 10/11 appended, order 1-9 unchanged | ✓ VERIFIED (wiring); ⚠️ WARNING (guard bug) | Composition order confirmed unchanged through step 9, gaze appended step 10 (line 1190), gesture step 11 (lines 1199-1206). BUT: `if (camera) gaze.step(...)` (line 1190) incorrectly gates the ENTIRE gaze call on `camera` truthiness, silently disabling the camera-independent "thinking" aversion mode whenever no camera is passed — contradicts `gaze.ts`'s own documented contract and unit tests (12-REVIEW.md WR-01). Does not currently manifest in shipped `VRMAvatar`/`GLBAvatar` (both always pass a real camera), so it does not block GAZE-01/02 sign-off today, but is a real logic bug in the composed controller. |
| `packages/react/src/VRMAvatar.tsx` | `useThree()` camera + gestureHint/onGestureConsumed threaded into controller | ✓ VERIFIED | `useThree((state) => state.camera)` (line 314), `gestureHint`/`setGestureHint` destructured from `useKhavee()` (line 307), passed into `useAnimationController` (lines 475-486) with `onGestureConsumed: () => setGestureHint(null)`. |
| `packages/react/src/GLBAvatar.tsx` | Same wiring as VRMAvatar | ✓ VERIFIED | `useThree((state) => state.camera)` (line 103), gestureHint wiring (lines 97, 165-181), same pattern. |
| `src/app/openai-avatar-test/page.tsx` | End-to-end `set_gesture` registration for human verify | ✓ VERIFIED | `registerFunction({...toolGesture, execute})` inside `useEffect` (lines 64-72), manual Nod/Shake buttons call `setGestureHint('nod'/'shake')` directly (lines 120, 126). |
| `packages/react/src/index.ts` | gaze/gesture NOT exported from package barrel | ✓ VERIFIED | No `gaze`/`gesture` references in barrel. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `packages/core/src/index.ts` | `packages/core/src/tools/gesture.ts` | named re-export | ✓ WIRED | `export { toolGesture } from './tools/gesture';` |
| `packages/react/src/animation/gesture.ts` | `packages/react/src/animation/talkCycle.ts` | `import { detectLoopBoundary }` | ✓ WIRED | Line 37; called at line 117. |
| `packages/react/src/animation/AnimationStateEngine.ts` | `packages/react/src/animation/gaze.ts` | `useGaze` + `gaze.step(...)` in `update()` | ⚠️ WIRED-WITH-BUG | Wired, but gated by an incorrect `if (camera)` guard (WR-01) that suppresses camera-independent aversion mode when camera is falsy. Not exercised by shipped avatars today (both always supply a camera). |
| `packages/react/src/animation/AnimationStateEngine.ts` | `packages/react/src/animation/gesture.ts` | `useGesture` + `gesture.step(...)` in `update()` | ✓ WIRED | Lines 1199-1206. |
| `packages/react/src/KhaveeProvider.tsx` | `useKhavee` consumers | `setGestureHint` returned in context value | ✓ WIRED | Line 332. |
| `packages/react/src/VRMAvatar.tsx` / `GLBAvatar.tsx` | `useAnimationController` | camera + gestureHint + onGestureConsumed params | ✓ WIRED | Confirmed in both files. |
| `src/app/openai-avatar-test/page.tsx` | `setGestureHint` | `registerFunction({...toolGesture, execute})` in `useEffect` | ✓ WIRED | Confirmed. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|----------------|--------|---------------------|--------|
| `gaze.ts` `stepGaze` | camera-relative target quaternion | `camera.getWorldPosition()` / `head.getWorldPosition()` (real R3F scene camera, threaded from `useThree()`) | Yes — real, live camera position each frame | ✓ FLOWING (data is real; the *interpolation* applied to it is defective — see Gap 1) |
| `gesture.ts` `stepGesture` | `gestureHint` | `KhaveeProvider`'s `setGestureHint`, called from LLM tool `execute` or manual buttons | Yes — real hint value driven by live LLM tool call or button click | ✓ FLOWING |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|--------------|----------------|--------------|--------|----------|
| GAZE-01 | 12-02, 12-04, 12-05, 12-06 | Camera-relative soft gaze per-state + thinking aversion + starting/stopped no-op | ✗ BLOCKED | Mode logic correct; interpolation defective (snap). REQUIREMENTS.md correctly still shows this unchecked/"Pending." |
| GAZE-02 | 12-02, 12-04, 12-05, 12-06 | Gaze symmetric across VRM/GLB | ✗ BLOCKED | Shares Gap 1 (snap) plus a GLB-only idle-spin regression (Gap 2), unresolved. REQUIREMENTS.md correctly still shows this unchecked/"Pending." |
| GEST-01 | 12-01, 12-04, 12-05, 12-06 | LLM tool-calling gesture hint, no regex/keyword matching | ✓ SATISFIED | `toolGesture` schema + barrel export + demo registration + human "approved" verdict. REQUIREMENTS.md correctly shows this checked/"Complete." |
| GEST-02 | 12-03, 12-04, 12-05, 12-06 | Procedural bone-delta gesture, queued to loop boundary, never interrupts | ✓ SATISFIED | `stepGesture` + `detectLoopBoundary` reuse + human "approved" verdict. REQUIREMENTS.md correctly shows this checked/"Complete." |

No orphaned requirements: all four IDs declared in this phase's plan frontmatter (`12-01` through `12-06`) match exactly the four IDs REQUIREMENTS.md's traceability table maps to "Phase 12" (line 115: "Phase 12: GAZE-01/02, GEST-01/02").

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/react/src/animation/gaze.ts` | 211-274 | Ramp-then-full-snap logic (not a marker-comment debt, a genuine behavioral bug) | 🛑 Blocker (for GAZE-01/02) | Causes the human-confirmed snap; blocks GAZE-01/GAZE-02 sign-off. |
| `packages/react/src/animation/AnimationStateEngine.ts` | 1190 | `if (camera) gaze.step(...)` guard incorrectly suppresses camera-independent aversion mode | ⚠️ Warning | Does not block current requirement sign-off (shipped avatars always pass a camera), but is a real latent bug flagged by code review (WR-01); should be fixed in the same gap-closure round as Gap 1 since it touches the same call site. |
| `packages/react/src/animation/gaze.ts` | 255-266 | Shared angle clamp unconditionally applied to aversion offset, contradicting file-header comment claiming "no clamp is needed"; clamps aversion to ~79% of its nominal magnitude | ⚠️ Warning | Cosmetic/magnitude discrepancy, not a functional break; code review WR-02. Comment and code should be reconciled. |
| No `TBD`/`FIXME`/`XXX` markers found | — | — | — | Debt-marker gate: clean. `grep` for `TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER` across all phase-modified files in `packages/core`, `packages/react`, and the demo page returned no matches. |

### Human Verification Required

### 1. Gaze smoothness re-check (post-fix)

**Test:** After a gaze-smoothing fix lands, observe `ready`/`listening`/`speaking` gaze on both the VRM avatar (`/openai-avatar-test`) and the GLB avatar page while moving the camera or observing continuously.
**Expected:** The head/neck offset visibly eases toward the camera-relative target rather than snapping to it every frame.
**Why human:** Motion smoothness/quality is a subjective visual judgment; cannot be asserted from static code or unit tests (the existing 14 `gaze.test.ts` cases did not catch this, since they check state at discrete ramp fractions, not continuous per-frame behavior after saturation).

### 2. GLB idle-spin regression re-check (post-fix)

**Test:** With no chat activity, observe the GLB avatar's idle animation specifically for the reported unexpected spin.
**Expected:** GLB idle animation behaves as it did before Phase 12 (matching Phase 11's confirmed idle baseline) — no spin.
**Why human:** Visual regression with an unconfirmed root cause (code review could not isolate it within Phase 12's file scope); requires live rendering to confirm resolution.

### Gaps Summary

Phase 12's wiring is comprehensively correct: `toolGesture` is packaged and barrel-exported, `gestureHint`/`setGestureHint` flow end-to-end from the LLM tool call (or manual buttons) through `KhaveeProvider` into both `VRMAvatar` and `GLBAvatar`'s `useAnimationController`, gesture bone-deltas correctly reuse `detectLoopBoundary` to never interrupt a talk-cycle clip mid-play, and all 9 objective code-level gates (no live-bone `lookAt()`, additive-only composition, starting/stopped no-op, no duplicated loop-boundary math, unreordered composition steps 1-9 with gaze/gesture appended as 10/11, `toolGesture` barrel export, internal-only gaze/gesture, no per-frame allocation, green test suites + clean `tsc`) pass. GEST-01 and GEST-02 are genuinely done — both wiring and human-observed behavior confirm this independently.

GAZE-01 and GAZE-02, however, are NOT achieved. Independent code review of `gaze.ts`'s `stepGaze` confirms the exact mechanism the human-verify checkpoint (12-06) and the code review (12-REVIEW.md IN-01) already identified: the ramp-in fraction (`strength`) saturates to 1 after 0.3s and the eased-target computation collapses to the raw clamped target every frame thereafter, producing a continuous per-frame snap toward a moving camera rather than a damped approach. GAZE-02 additionally carries an unresolved GLB-only idle-animation spin regression with no confirmed root cause. Neither requirement can be marked satisfied. This verification concurs with 12-06-VERIFICATION.md's `gaps_found` status and finds no evidence to override it — the phase goal ("ship camera-relative soft-gaze... as procedural animation layers, wired end-to-end") is only half-achieved: the gesture half ships; the gaze half is wired correctly but behaviorally broken.

Additionally, this independent review surfaces one further nuance not present in 12-06's must-have list but relevant to closing the gap: `AnimationStateEngine.ts`'s `if (camera) gaze.step(...)` guard (WR-01) will need to be fixed in the same round, since any future headless/no-camera consumer would otherwise silently lose `thinking`-state aversion gaze — this doesn't block GAZE-01/02 sign-off today (shipped avatars always pass a camera) but should be bundled into the gap-closure plan since it touches the exact same call site as the snap fix.

---

_Verified: 2026-07-18T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
