---
phase: 11-bone-masked-upper-body-animation-layering
plan: 02
subsystem: ui
tags: [three.js, vrm, animation, avatar, react]

# Dependency graph
requires:
  - phase: 11-bone-masked-upper-body-animation-layering (plan 01)
    provides: filterClipTracksByBoneSet, BASE_LOWER_BONES, UPPER_BONES
provides:
  - "Bone-masked upper-body layering in VRMAvatar.tsx: always-on base-lower action + upper-layer 0.3s crossfade for status-driven chatStatus transitions"
  - "D-04 whole-skeleton path preserved unchanged for developer-triggered custom animate() calls"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-action bone-masked layering: one always-on base-lower AnimationAction + one crossfading upper-layer AnimationAction, sharing a single AnimationMixer with disjoint tracks"
    - "statusDrivenKeyRef + statusDrivenEpoch state counter to distinguish status-driven animation keys from developer-triggered custom animate() calls, robust to React's same-value setState bailout"

key-files:
  created: []
  modified: [packages/react/src/VRMAvatar.tsx]

key-decisions:
  - "Only touch AnimationAction.setEffectiveWeight() for the two binary on/off transitions (entering/leaving the D-04 custom whole-skeleton path) — never while masking stays active across a gesture switch, because setEffectiveWeight() calls THREE's stopFading() internally and cancels any in-flight fadeIn/fadeOut"
  - "statusDrivenEpoch (real React state, not just a ref) is bumped only when the target animation key would NOT itself change currentAnimation — covers React's same-value setState bailout (e.g. the very first ready->idle transition) without introducing a premature/inconsistent intermediate render on real transitions"
  - "baseActionRef/upperActionRef are cleared in the SAME cleanup that clears mixerRef, so both effects correctly detect 'no action bound yet' if the mixer is torn down and recreated (e.g. by React Strict Mode's double-invoke-on-mount behavior)"

patterns-established:
  - "Cross-path weight coordination via setEffectiveWeight, gated on a tracked prev-active-state ref rather than called unconditionally every effect run"

requirements-completed: [BONE-02, BONE-03, BONE-04, BONE-05]

# Metrics
duration: ~3h (including checkpoint iteration)
completed: 2026-07-01
---

# Phase 11: Bone-Masked Upper-Body Animation Layering Summary (Plan 02)

**Bone-masked dual-action layering in VRMAvatar.tsx — an always-on base-lower action keeps the lower body animating continuously while a separate upper-layer action crossfades (0.3s) between idle and gesture clips on chatStatus transitions, with three real bugs found and fixed during checkpoint testing**

## Performance

- **Duration:** ~3h total (2 auto tasks + extensive checkpoint-driven debugging/fixing across 5 rounds of visual feedback)
- **Tasks:** 3 (2 auto + 1 checkpoint, checkpoint required 4 follow-up fix commits before approval)
- **Files modified:** 1 (`packages/react/src/VRMAvatar.tsx`)

## Accomplishments
- `baseActionRef` (always-on, hips/spine/legs) and `upperActionRef` (crossfading, chest/neck/head/arms) drive the mixer for status-driven chatStatus keys (ready/listening/thinking/speaking + speaking variants/keyword picks), while `statusDrivenKeyRef` + `boneMaskedClips` (from Plan 01) determine masking eligibility per key
- The pre-existing whole-skeleton crossfade effect is gated so it never double-drives a status-driven key, but remains fully intact for D-04 developer-triggered custom `animate()` calls
- Cross-path weight coordination via `setEffectiveWeight` correctly cedes/restores control between the bone-masked path and the custom whole-skeleton path without fighting on shared hips/spine/leg tracks
- Phase 10's procedural layer (breathing, head micro-movement, gaze, finger curl) and the single `mixer.update(delta)` call ordering are unchanged

## Task Commits

1. **Task 1: Bone-masked clip derivation + always-on base-lower action + status-driven provenance tracking** - `97e1c93` (feat)
2. **Task 2: Upper-layer crossfade + whole-skeleton gate + cross-path weight coordination** - `fc14a86` (feat)
3. **Checkpoint fix 1: stabilize `loadedAnimations` identity** - `78cce13` (fix)
4. **Checkpoint fix 2: stop crossfade from snapping instead of fading** - `727615a` (fix)
5. **Checkpoint fix 3: reset `baseActionRef`/`upperActionRef` when the mixer is torn down** - `8f40e82` (fix)

## Files Created/Modified
- `packages/react/src/VRMAvatar.tsx` - Bone-masked upper-body layering + three follow-up bug fixes found during checkpoint visual testing

## Decisions Made
- Introduced `statusDrivenEpoch` (React state, not just a ref) to force the masking-dependent effects to re-evaluate even when `animate(targetKey)` doesn't change `currentAnimation`'s value (React bails on same-value `setState`) — but only bump it when the key genuinely won't change `currentAnimation`, to avoid a transient inconsistent render on real transitions.
- Weight coordination (`setEffectiveWeight`) is now conditional: only applied on the two binary on/off transitions (entering/leaving the custom whole-skeleton path), never while masking stays continuously active — calling it unconditionally was cancelling in-flight `fadeIn`/`fadeOut` calls every time (THREE's `setEffectiveWeight` internally calls `stopFading()`).
- `baseActionRef`/`upperActionRef` are now cleared in the mixer-teardown cleanup, alongside `mixerRef`/`currentActionRef`, so a mixer recreation (e.g. React Strict Mode's dev-mode double-invoke of effects with cleanups) can't leave an action permanently orphaned against a discarded mixer.

## Deviations from Plan

### Auto-fixed Issues (found via checkpoint human-verify testing, not part of the original two tasks)

**1. [Rule 1 - Bug] `loadedAnimations` object identity churned on every render**
- **Found during:** Checkpoint round 1 — user reported the torso oscillating/bending both directions, "too much," with occasional lag.
- **Issue:** `useAnimationFiles()` rebuilt its returned object from scratch every render (never memoized). `processedClips` and `boneMaskedClips` both depend on it, so they recomputed every render too, minting fresh `THREE.AnimationClip` UUIDs each time. The bone-masked upper-layer effect treated each new UUID as "the animation changed" and restarted its crossfade from scratch — with renders arriving faster than fades could settle, this produced a perpetually-restarting, overlapping crossfade.
- **Fix:** Memoized `useAnimationFiles()`'s return value keyed on the stable `useFBX`/`useGLTF` data references.
- **Verification:** Temporary render-count instrumentation showed the upper-layer effect firing continuously with a new clip UUID each time before the fix, and settling to 2 fires with a stable UUID after.
- **Committed in:** `78cce13`

**2. [Rule 1 - Bug] Crossfade snapped instead of fading; masking never activated for idle**
- **Found during:** Checkpoint round 2 — user reported "no crossfade, it just resets."
- **Issue:** Two compounding bugs. (a) `setEffectiveWeight()` calls THREE's `stopFading()` internally, cancelling any in-flight `fadeIn`/`fadeOut` — the cross-path weight-coordination code was calling it unconditionally right after scheduling a `fadeIn()` on the same action. (b) React's same-value `setState` bailout: the very first "ready -> idle" transition doesn't change `currentAnimation` (already the default), so the masking-dependent effects never re-ran to notice `statusDrivenKeyRef` had changed, leaving idle's upper body at weight 0 until the next real transition forced an instant-snap recovery.
- **Fix:** Only touch `setEffectiveWeight` for the two binary on/off transitions (entering/leaving the custom whole-skeleton path); added a `statusDrivenEpoch` state counter, bumped only when the target key won't itself change `currentAnimation`, to force re-evaluation without introducing a premature intermediate render on real transitions.
- **Verification:** Weight-sampling instrumentation confirmed a proper ramp (0 -> 0.11 -> 0.34 -> 0.56 -> 0.84 -> 1.0 over ~280ms) instead of an instant jump.
- **Committed in:** `727615a`

**3. [Rule 1 - Bug] Base-lower action permanently frozen against a discarded mixer**
- **Found during:** Checkpoint round 3 — user reported the torso still "moving weird," at rest, still bending too far.
- **Issue:** The mixer-init effect's cleanup calls `mixer.stopAllAction()` and nulls `mixerRef`/`currentActionRef` on teardown, but never cleared `baseActionRef`/`upperActionRef`. React Strict Mode (Next.js dev default) double-invokes effects with cleanups on the very first render (mount, cleanup, mount again). If base-lower's one-time-creation effect raced ahead of that cleanup, it bound permanently to the first (Strict-Mode-discarded) mixer — its own "create once" guard then refused to ever rebind it to the real, second mixer. The action's internal clock froze at exactly 0 forever, while the upper-layer action (which rebinds every render) kept animating normally against the live mixer — a static, frozen lower body next to a moving chest.
- **Fix:** Clear `baseActionRef`/`upperActionRef` in the same cleanup that clears `mixerRef`.
- **Verification:** Instrumentation confirmed `baseActionRef.current.time` was stuck at exactly `0.000` across a multi-second window before the fix, and advancing frame-over-frame after.
- **Committed in:** `8f40e82`

---

**Total deviations:** 3 auto-fixed (all Rule 1 - bugs found via checkpoint visual testing, none were scope creep — all three are within `VRMAvatar.tsx`, the plan's declared file, and directly caused the exact visual symptoms the checkpoint was designed to catch).
**Impact on plan:** All three fixes were necessary for the plan's own must-haves (no snap, smooth crossfade, idle-upper at rest) to actually hold at runtime. No architectural changes to the D-01/D-02 bone split itself were needed — a user-run A/B comparison (same `Idle.fbx` file through the old whole-skeleton path vs. the new split path) confirmed the split's pose reconstruction is correct once the above bugs were fixed.

## Issues Encountered

Diagnosing the checkpoint feedback required an unusual amount of empirical verification because the reported symptoms ("torso bends weird") were visual and not directly assertable by `tsc`/grep. A throwaway diagnostic page (`src/app/bone-layer-test/page.tsx`, not committed — left out of this plan's scope) plus headless Chromium screenshots/console/instrumentation were used to narrow down and confirm each of the three bugs above before applying fixes, rather than guessing blind. None of the three root causes were guessable from static code review alone; each required either render-count instrumentation, weight-sampling instrumentation, or action-state instrumentation to pin down definitively.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Bone-masked upper-body layering is complete and visually approved by the user after 3 rounds of checkpoint-driven bug fixes.
- No known blockers. The eye-gaze transition speed and finger-curl noise "creepiness" the user also flagged are confirmed pre-existing Phase 10 behaviors (untouched by any Phase 11 commit, verified via diff against the pre-phase baseline) — out of this phase's scope, logged as candidate follow-up items rather than fixed here.

---
*Phase: 11-bone-masked-upper-body-animation-layering*
*Completed: 2026-07-01*
