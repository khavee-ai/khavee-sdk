---
phase: 11-bone-masked-upper-body-animation-layering
reviewed: 2026-07-01T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - packages/react/src/utils/filterClipTracksByBoneSet.ts
  - packages/react/src/VRMAvatar.tsx
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-07-01
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed `filterClipTracksByBoneSet.ts` (Plan 11-01) and `VRMAvatar.tsx` (Plan 11-02), with special attention to the three follow-up bug-fix commits made during checkpoint human-verification (`78cce13`, `727615a`, `8f40e82`) per the review brief.

`filterClipTracksByBoneSet.ts` is clean: the bone-name resolution correctly goes through `vrm.humanoid.getNormalizedBoneNode()` (never string-matches track names), the original `clip.duration` is always preserved (no `resetDuration()`), and `BASE_LOWER_BONES` (10) / `UPPER_BONES` (42) were verified programmatically against `mixamoVRMRigMap.ts` to be an exact, disjoint 52-value partition with zero omissions and zero overlap. No issues found in this file.

`VRMAvatar.tsx`'s three checkpoint fixes are each internally consistent and correctly reasoned for the specific failure modes they were built to address (stale `loadedAnimations` identity causing clip-UUID churn; `setEffectiveWeight()`'s undocumented `stopFading()` side effect cancelling in-flight fades; `baseActionRef`/`upperActionRef` orphaning against a Strict-Mode-discarded mixer). However, tracing the fully-composed cross-path weight-coordination logic (Pitfall 2 / Open Q2) surfaced **one remaining instance of the exact bug class fix #2 was built to solve** (a `setEffectiveWeight()` call cancelling a fadeIn scheduled moments earlier in the same effect pass, in a scenario the fix's own reasoning didn't cover), plus **two asymmetric fallback-handling gaps** relative to the plan's stated Pitfall-5/Pitfall-2 guarantees, and one fragile hooks pattern introduced by fix #1 itself. None of these are crashes or security issues; all are visual/behavioral correctness gaps in specific (but reachable) sequences that are worth fixing before this is considered fully hardened.

## Warnings

### WR-01: Cross-path weight restore can cancel a legitimately-scheduled upper-body fadeIn

**File:** `packages/react/src/VRMAvatar.tsx:683-722`
**Issue:** The upper-layer crossfade effect schedules a fade for `newUpperAction` (lines 685-693), then — later in the *same* effect invocation — the cross-path weight-coordination code may call `upperActionRef.current?.setEffectiveWeight(1)` on line 720 when `!prevMaskingActiveRef.current` (i.e. "just returned from the custom whole-skeleton path"). By this point `upperActionRef.current === newUpperAction` (reassigned on line 693). Per `AnimationAction.setEffectiveWeight()` (confirmed directly in `node_modules/three/src/animation/AnimationAction.js:276-285`), this call sets `this.weight` immediately and calls `this.stopFading()`, cancelling any in-flight fade interpolant.

This is exactly the bug class checkpoint fix `727615a` was built to eliminate — but that fix's reasoning ("recovers from a fully-zeroed weight, it is not interrupting an in-flight gesture crossfade, so an instant snap is correct here", line 718-719) only holds when the upper clip identity is *unchanged* across the custom-path excursion (e.g. `idle → dance → idle`, where `upperActionRef` never pointed anywhere else). It does **not** hold when a developer's custom `animate('dance')` call is immediately followed by a *different* status-driven gesture than whatever was active before the custom call (e.g. `idle → dance → listening`, where `listening`'s upper clip differs from `idle`'s). In that sequence, the same effect pass both (a) schedules `newUpperAction.reset().fadeIn(0.3).play()` for the `listening`-upper clip, and (b) immediately calls `setEffectiveWeight(1)` on that same action a few lines later — silently snapping it to full weight instead of fading, producing an instant pop instead of the 0.3s crossfade the plan's must-haves require ("the upper body crossfades over 0.3s ... on status transitions").
**Fix:** Guard the restore branch so it only snaps weight when the upper action identity has *not* just changed in this same pass, e.g.:
```typescript
const upperActionChangedThisPass = upperActionRef.current !== previousUpperActionBeforeThisEffect; // capture before reassignment
// ...
} else if (!prevMaskingActiveRef.current && !upperActionChangedThisPass) {
  upperActionRef.current?.setEffectiveWeight(1);
}
```
or simpler: only call the restore-to-1 `setEffectiveWeight` when no `fadeIn`/`fadeOut` was scheduled in this same invocation (track a local boolean set at the crossfade branch above).

### WR-02: Required weight-zeroing (Pitfall 2) can be silently skipped via an early return

**File:** `packages/react/src/VRMAvatar.tsx:668-681`
**Issue:** The upper-layer effect returns early on line 681 (`if (!upperClip) return;`) *before* reaching the cross-path weight-coordination code (lines 711-722). `upperClip` is undefined whenever `boneMaskedClips.upperByKey["idle"]` doesn't exist (the D-05 fallback key) and the current key isn't itself status-driven-and-maskable. This is possible whenever the "idle" clip's upper-body track filtering yields zero matched tracks (e.g. `currentVrm.humanoid` unexpectedly falsy — a condition this same file defensively guards against everywhere else in `useFrame`, e.g. lines 794, 811, 832, 881, 901, 969).

In that case, `boneMaskedClips.baseLower` can still be non-null (base-lower bone resolution can independently succeed or fail), so `isBoneMaskingActive()` may still report `true` for status-driven keys, the base-lower action still gets created and plays — but the REQUIRED weight-zeroing coordination (Task 2 step 4, "REQUIRED, not optional" per the plan) never executes for *any* animation on that model, because this effect bails out before reaching it. Any subsequent custom `animate('dance')` call would then leave `baseActionRef` at its default weight of 1, fighting the unfiltered custom clip's hips/spine/leg tracks — precisely the Pitfall 2 failure mode the required task exists to prevent.
**Fix:** Move the weight-coordination block above the `if (!upperClip) return;` early return (or duplicate it before the return), so cross-path weight zeroing/restoring always runs regardless of whether an upper clip was resolved this pass.

### WR-03: `boneMaskedClips.baseLower` has no Pitfall-5 zero-track guard, unlike `upperByKey`

**File:** `packages/react/src/VRMAvatar.tsx:436-451`
**Issue:** The `boneMaskedClips` memo applies a zero-track fallback check only to upper clips (`if (upperClip.tracks.length > 0) { upperByKey[clip.name] = upperClip; }`, line 448), per the plan's Pitfall 5 guidance. No equivalent check exists for `baseLower` (line 437-439): `filterClipTracksByBoneSet(idleClip, currentVrm, BASE_LOWER_BONES, "base-lower")` is assigned directly, even if the result has zero tracks (e.g. `currentVrm.humanoid` falsy, or an idle clip that genuinely contains no hips/spine/leg keyframes).

Since `isBoneMaskingActive()` (line 608-614) only checks `!boneMaskedClips?.baseLower` for null/undefined — not track count — a zero-track `baseLower` clip is treated as "present," bone-masking activates, and the base-lower action is created and played (line 512-518) even though it drives nothing. Once masking is active, the whole-skeleton gate (line 621-629) fades out and nulls `currentActionRef` for every status-driven key, meaning **nothing** would then be animating hips/spine/legs — silently freezing the lower body and violating D-01's stated invariant ("the lower body ... keeps playing the idle clip continuously with no snap or reset") with no error or console warning.
**Fix:** Apply the same `tracks.length > 0` guard to `baseLower`:
```typescript
const baseLowerCandidate = idleClip
  ? filterClipTracksByBoneSet(idleClip, currentVrm, BASE_LOWER_BONES, "base-lower")
  : null;
const baseLower = baseLowerCandidate && baseLowerCandidate.tracks.length > 0 ? baseLowerCandidate : null;
```

### WR-04: Variable-length `useMemo` dependency array in `useAnimationFiles()`

**File:** `packages/react/src/VRMAvatar.tsx:147-150`
**Issue:** The checkpoint-fix-1 memoization (`78cce13`) uses `useMemo(() => rawLoadedAnimations, [nameKey, ...dataRefs])`, where `dataRefs.length` equals the current number of loaded animation entries. React's own rules require a hook's dependency array to have a stable length/shape across renders — React logs a dev-mode warning ("The final argument passed to useMemo changed size between renders") whenever this isn't true, and the shallow-array-compare algorithm (`areHookInputsEqual`) is documented as relying on a fixed-length comparison. If the `animations` prop's key set ever changes after mount (e.g. an app conditionally adds/removes animation URLs, or resolves them asynchronously such that different keys appear on different renders before all loaders resolve), this array's length changes between renders, which is explicitly the anti-pattern the eslint-disable comment on the line above (`// eslint-disable-next-line react-hooks/exhaustive-deps`) suppresses detection of, but doesn't fix the underlying fragility.

This is the load-bearing fix underpinning the whole crossfade-stability checkpoint fix, so its fragility is worth flagging even though the common case (a static `animations` config object) won't trigger it.
**Fix:** Depend on a stable derived signature instead of a spread array, e.g. hash/join the data references' identities into a single string alongside `nameKey`, or key the memo only on `nameKey` (relying on `useFBX`/`useGLTF`'s own internal caching/suspense to guarantee referential stability per URL, which the comment already asserts is true) rather than spreading `dataRefs` into the dependency list.

## Info

### IN-01: No diagnostic when the "idle" convention key is missing

**File:** `packages/react/src/VRMAvatar.tsx:431-454`
**Issue:** The entire bone-masked layering system is gated on finding a clip literally named `"idle"` in `processedClips` (line 436). If a developer's `animations` config never defines an `"idle"` key (e.g. names it `"stand"` or `"default"`), `boneMaskedClips.baseLower` stays `null` forever and the feature silently, permanently falls back to the pre-Phase-11 whole-skeleton crossfade for every animation — with no `console.warn` explaining why bone-masking "isn't working" for that avatar.
**Fix:** Add a one-time `console.warn("[VRM Animation] No 'idle' animation key found — bone-masked upper-body layering is disabled; falling back to whole-skeleton crossfade.")` when `processedClips.length > 0 && !idleClip`.

### IN-02: No automated test coverage for the new bone-masked layering logic

**File:** `packages/react/src/VRMAvatar.tsx`, `packages/react/src/utils/filterClipTracksByBoneSet.ts`
**Issue:** `packages/react` has no test framework/tests at all (consistent with existing project conventions per CLAUDE.md), so none of this phase's new logic — `filterClipTracksByBoneSet`'s track filtering, the `boneMaskedClips` memo's fallback branches, or the multi-effect weight-coordination state machine — has any regression protection. Given the checkpoint round required 3 non-trivial follow-up bug fixes to get this logic correct, and this review found further edge cases (WR-01/02/03) that the manual checkpoint testing didn't happen to exercise, this is an area where even a small set of unit tests around `filterClipTracksByBoneSet` (pure function, easy to test) would have meaningfully reduced risk.
**Fix:** Not blocking given the project-wide convention, but consider adding `packages/react/src/utils/__tests__/filterClipTracksByBoneSet.test.ts` with a fake `VRM`/`AnimationClip` fixture as a follow-up.

### IN-03: `boneMaskedClips` recomputes upper-filtered clips for every processed clip on every VRM/animation change

**File:** `packages/react/src/VRMAvatar.tsx:441-451`
**Issue:** Every processed clip (not just status-mapped keys) is run through `filterClipTracksByBoneSet` with `UPPER_BONES` whenever `processedClips`/`currentVrm` changes, including clips that will only ever be used via the whole-skeleton D-04 path. This is a minor wasted-work note, not a correctness issue (performance is explicitly out of scope for this review), but is left here for awareness since the memo does noticeably more work than strictly required (only status-key clips + idle need upper-filtering).
**Fix:** Optional/non-blocking — could restrict upper-filtering to the animation keys that are actually reachable from the `chatStatus` auto-mapping effect if this ever becomes a measured hotspot.

---

_Reviewed: 2026-07-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
