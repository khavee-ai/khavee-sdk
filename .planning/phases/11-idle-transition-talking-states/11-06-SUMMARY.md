---
phase: 11-idle-transition-talking-states
plan: 06
subsystem: animation
tags: [verification, checkpoint, human-uat, gap-closure]

requires:
  - phase: 11-idle-transition-talking-states
    provides: "Full Phase 11 stack (plans 01-05) merged: bone adapter, currentVolume threading, breathing/sway/expressionDrift, talkCycle/audioAmplitude, controller integration"
provides:
  - "Objective invariant gate results (all passed)"
  - "Human per-state verification results (partial — 3 of 7 behaviors fail)"
  - "Diagnosed root causes for the 3 failing behaviors, ready for gap-closure planning"
affects: [phase-11-gap-closure]

key-files:
  created: []
  modified: []

requirements-completed: []
requirements-gapped: [IDLE-02, TRANS-01, TRANS-02, TALK-01]

duration: ~25min
completed: 2026-07-12
status: gaps_found
---

# Phase 11 Plan 06: Verification Summary — GAPS FOUND

**Task 1 (objective invariant gates) passed cleanly. Task 2 (human per-state verification) found 4 of 7 behaviors failing on a running build — root causes diagnosed by code inspection below. Phase 11 is NOT complete; gap-closure plans are needed before re-verification.**

## Task 1: Objective Invariant Gates — ALL PASSED

| Gate | Result |
|------|--------|
| No `setInterval`/`setTimeout` in `packages/react/src/animation/` | ✓ 0 matches |
| `breathing.ts`/`sway.ts`: 0 `.quaternion.set(`, ≥1 `.multiply(` | ✓ (breathing: 0/3, sway: 0/2) |
| `breathing\|sway\|expressionDrift\|talkCycle\|audioAmplitude` not exported from `index.ts` | ✓ 0 matches |
| `pnpm --filter @khaveeai/react test` | ✓ 62/62 tests passing |
| `pnpm --filter @khaveeai/react build` | ✓ clean |

## Task 2: Human Per-State Verification — 4/7 FAILED

Verified live against `pnpm dev` on the VRM (`/openai-avatar-test`) and GLB (`/glb-avatar-test`) test pages.

| # | Requirement | Result | Notes |
|---|-------------|--------|-------|
| 1 | IDLE-01 | Not reported as failing | Breathing + sway presumed OK (unchallenged) |
| 2 | IDLE-02 | **FAIL** | "no expression drift" visible on VRM |
| 3 | TRANS-01 | **FAIL** | "it snaps, not smooth" |
| 4 | TRANS-02 | **FAIL** | "it snaps, not smooth" |
| 5 | TALK-01 | **FAIL** | "at the end of first talking animation it snaps and plays the second a little (jitter) and snaps back to first" |
| 6 | TALK-02 | Not reported as failing | Amplitude reactivity presumed OK (unchallenged) |
| 7 | PERF-01 | Not reported as failing | Spine composition presumed OK (unchallenged) |

## Diagnosed Root Causes (code inspection, not yet fixed)

### TALK-01 — talk-variant snap-back (confirmed root cause)

`VRMAvatar.tsx` (and `GLBAvatar.tsx`) pass an **inline, non-memoized** `getAction` closure into `useAnimationController` on every render:
```ts
getAction: (name) => {
  const clip = processedClips.find((c) => c?.name === name);
  return clip && mixerRef.current ? mixerRef.current.clipAction(clip) : null;
},
```
`AnimationStateEngine.ts`'s crossfade-trigger `useEffect` (line ~218-227) lists `getAction` directly in its dependency array: `[targetName, getAction, chatStatus]`. Since `getAction` is a fresh function identity every render, this effect **re-fires on every render** of the avatar component.

Plan 11-05 wired `currentVolume` (TALK-02) from `useKhavee()` React context, which updates via `setState` on every live volume tick during speech — causing frequent re-renders during `speaking`. Each re-render re-fires the effect, which recomputes `targetName` via `resolveBaseClip`. For `speaking`, `resolveBaseClip` always resolves the **first** clip matching `/talk|gesture|speak|taking/i` via `.find()` — it has no awareness of which variant `talkCycle.ts` is currently cycled to. The effect then calls `switchToClip(targetName)` again, and since `mixerRef.current.clipAction(clip)` IS cache-stable (three.js caches per clip+root) but `currentActionRef.current` now points at the *second* variant (set by `talkCycle`'s own `switchToClip` call inside `update()`), the guard `toAction === currentActionRef.current` is false — triggering a fresh crossfade back to the first clip. This exactly matches "snap to second, jitter, snap back to first."

**Likely fix direction:** memoize `getAction`/`getRoot` (e.g. `useCallback` with stable deps), and/or drop `getAction` from the effect's dependency array (it's a stable-enough accessor per the existing comment's intent, just not actually stable in implementation), and/or make `resolveBaseClip`'s speaking-target resolution aware of the currently-cycled variant instead of always returning the first match.

### TRANS-01 / TRANS-02 — snap instead of smooth (partially diagnosed)

Two independent suspects, not mutually exclusive:

1. **Same effect re-fire mechanism as TALK-01.** Any state update around session start/stop (e.g. `isConnected`, `chatStatus`, `currentVolume` resetting) can re-fire the same unstable-`getAction` effect mid-blend. A burst of same-tick re-renders right at the transition boundary can call `beginCrossfade` more than once before the first frame's `stepCrossfade` runs, resetting `startTime`/`toAction.reset()` and disrupting the intended 1.2s ease.
2. **TRANS-02-specific: `settleScale` is a hard binary cut, not eased.** In `AnimationStateEngine.ts` (`update()`, step 3): `const settleScale = chatStatus === "stopped" ? SETTLE_SCALE : 1;` (`SETTLE_SCALE = 0.15`) applies identically from frame one of `stopped` — breathing/sway amplitude drops ~6.6x instantly, independent of and faster than the 1.2s base-clip crossfade. This alone would read as "it snaps" even if the crossfade itself were smooth.

**Likely fix direction:** for (1), same as TALK-01's fix. For (2), ease `settleScale` toward `SETTLE_SCALE` over the same ~1.2s floor window instead of applying it as an instant step.

### IDLE-02 — no visible expression drift (likely root cause)

`expressionDrift.ts`'s `DRIFT_CANDIDATES = ["neutral", "browInnerUp"]` are gated behind a presence check (`em.getExpression(name) === null` → skip) before any write. Neither name is guaranteed to exist on the bundled VRM models (`male.vrm`, `blue-female.vrm`): `"neutral"` is not one of the VRM 1.0 standard expression presets, and `"browInnerUp"` is an ARKit blendshape name that VRM rigs are not required to expose. If neither candidate is present on the loaded model, both are silently skipped every frame — a fully silent no-op with no error, log, or test failure (unit tests use a mocked expression manager that always has the candidates present).

**Likely fix direction:** inspect the actual expression names exposed by `male.vrm`/`blue-female.vrm` (e.g. via `vrm.expressionManager.expressions` at runtime) and either add real present-on-model candidate names to `DRIFT_CANDIDATES`, or broaden the candidate list with a documented fallback order.

## Deviations from Plan

Task 1 executed as specified — no deviations. Task 2's checkpoint resolved with **gaps reported**, which is an explicitly anticipated outcome per the plan's own `<resume-signal>` ("...or describe which state(s) failed and how (gap closure will follow)"). No code was modified during this plan; all diagnosis above is read-only code inspection performed to make the gap report actionable, not a fix.

## Next Phase Readiness

**Phase 11 is NOT complete.** Requirements IDLE-02, TRANS-01, TRANS-02, and TALK-01 need gap-closure plans before re-verification. Recommended path: `/gsd:plan-phase 11 --gaps` to generate fix plans from this SUMMARY, then `/gsd:execute-phase 11 --gaps-only` to execute them, followed by a re-run of this plan's human-verify checkpoint.

Requirements IDLE-01, TALK-02, and PERF-01 were not reported as failing during this verification pass but were not explicitly re-confirmed either — worth a quick re-check during the gap-closure verification pass since they share code paths (`update()`'s composition order) with the failing items.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-12*
