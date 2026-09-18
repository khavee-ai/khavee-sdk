---
phase: 16-lighting-shadows-post-processing
plan: 06
subsystem: measurement-harness
tags: [measurement, lighting, contrast, verification]
requires: [16-02, 16-03, 16-04, 16-05]
provides: [MEASURE-01-harness, permanent-lighting-fixture]
affects: [apps/playground/src/app/lighting, packages/react/src]
tech_stack:
  added: []
  patterns: [procedural-fixtures, read-only-import, measurement-gating]
key_files:
  created:
    - apps/playground/src/app/lighting/page.tsx
    - apps/playground/src/app/lighting/fixtureTextures.ts
  modified:
    - packages/react/src/VRMAvatar.tsx
    - packages/react/src/utils/renderQuality.tsx
    - packages/react/src/utils/AvatarBackdrop.tsx
    - packages/react/src/utils/backgroundRim.ts
    - packages/react/src/utils/mtoonOutlines.ts
    - packages/react/src/utils/mtoonOutlines.assets.test.ts
    - .planning/spikes/MANIFEST.md
decisions:
  - id: D-06-01
    decision: "Procedural fixtures instead of binary assets"
    rationale: "No image assets enter repo; three aspect ratios exact by construction"
  - id: D-06-02
    decision: "Measure button disabled when background active, in UI not docs"
    rationale: "measureCanvas skips alpha < 128; backdrop makes it measure wallpaper instead of avatar"
  - id: D-06-03
    decision: "Tab visibility displayed with explicit warning"
    rationale: "Throttled tabs return confident false readings; hit again twice during this plan"
  - id: D-06-04
    decision: "Retune DEFAULT_LIGHT_RIG rather than accept the control-asset regression"
    rationale: "User decision 2026-09-14 after the three-point rig lost on the well-authored control"
  - id: D-06-05
    decision: "outlineWidth injects outlines on assets that authored none, superseding D-10's respect-existing-only scope"
    rationale: "User decision 2026-09-14: both test models showed no visible outline; male.vrm authors width 0"
metrics:
  completed_at: "2026-09-18"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
---

# Phase 16 Plan 06: Lighting Comparison Harness — SUMMARY

**One-liner:** The `/lighting` harness was built and used to verify the phase, and the verification found and fixed several real defects. After the fixes, the three-point rig beats the legacy rig on contrast on both test models, and backdrop fit, DOF, the D-13 fix, outlines and contact shadows are all confirmed working.

## Status

- **Task 1:** complete. The harness page was built (3bfb719).
- **Task 2:** complete. It first failed on the control model, and passed after the rig orientation fix and retune.
- **Task 3:** complete. Checks B, C, E, outlines and contact shadows pass. Check D (rim colour) is only weakly visible, and the user accepted it.

## Measurements

All measurements were taken in a visible tab, confirmed by `visibilityState: visible` at ~120 FPS. Each configuration was measured twice, and every repeat differed by ≤0.0005 in spread. Readings taken while the tab was hidden were thrown out.

### Task 2: contrast (value-spread), final defaults

| Model | legacy | three-point | Gate |
|---|---|---|---|
| male.vrm | 0.2844 / 0.2846 | 0.2872 / 0.2876 | pass |
| 3636451243928341470.vrm | 0.0929 / 0.0926 | 0.0972 / 0.0971 | pass |

The first run with the original spike-005 defaults failed on the control model: 0.0784 for three-point against 0.0930 for legacy. The user's own run from the same session agreed, with 0.0781 against 0.0929. The rest of this section explains why.

### Task 3

| Check | Result |
|---|---|
| A: outline cost | `male.vrm`: 104 draw calls with no width set, 200 with `outlineWidth={0.003}` (+96), back to 104 with outlines hidden. Frame time did not change measurably: FPS sits at the 120 FPS vsync cap in every state. |
| B: backdrop fit | Pass. 16:9 fills the frame under `cover`; 9:16 under `contain` shows all four corners, undistorted. |
| C: DOF | Pass, after fixing focus. The avatar stays sharp and the backdrop blurs, both still and while dollying. FPS drops from ~120 to ~45 with DOF on (see review WR-01). |
| D: rim colour | Weak. A blue background puts a slightly bluer tint on the sleeve and hair edges than grey does; grey adds no hue. The rim now sits behind the avatar, so little of it faces the camera. Accepted by the user. |
| E: D-13 | Pass. With SMAA on, tone `none` gives sat 0.2885 and `cineon` gives 0.4646, which is close to the no-post-FX value. |
| Contact shadows (review CR-01) | Pass. With the shadow floor off and viewed from above, the backdrop reads 191 luminance away from the avatar, and falls to 186 → 174 near the torso and 183 near the arms, in a soft gradient. Nothing else can darken that plane. |

## Defects found by the harness, and their fixes

| Commit | Defect |
|---|---|
| cccf8f6 | The harness generated its fixtures during SSR, so the `document is not defined` error crashed the page. |
| dd3e04e | The backdrop plane was placed at a fixed world Z, so with the camera at z=4 it filled only ~60% of the frame. |
| 8a726ce | The harness's shadow floor sat at y=0 while the avatar stood at -1.1, so the floor cut through the waist. |
| 9a54e35 | The light rig inside `VRMAvatar`'s 180°-rotated group lit the avatar from behind and put the rim on the face. This caused the control-asset failure. |
| e5fc508 | Retuned `DEFAULT_LIGHT_RIG` to ambient 0.25, key 1.2 at [4,4,1] and fill 0.15. |
| 3c9990a | The DOF tracker fed straight-line distance to a view-space-depth uniform, so the avatar blurred along with the background. |
| 1b0db80 | Switching from an image to a colour background kept the old image on the backdrop, tinted by the new colour. |
| 55716f1 | The outline toggle wrote to the surface material instead of the drawn clone, so it never hid anything. `outlineWidth` was added. |
| cd56ee6 | Fixed the five critical findings from the code review: contact shadows rendered nothing, inline `onError` reloaded the backdrop on every render, backdrop loads raced each other, the backdrop ignored parent transforms, and smooth shading dropped the outline geometry groups. |

## Deviations from Plan

- **The contrast gate first failed on the control asset.** The user chose to retune rather than accept it. The root cause was the rig's orientation, not its values.
- **The outline scope changed.** The plan assumed `male.vrm` had 6 authored outlines. It sets an outline mode on 6 materials but authors a width of 0, so three-vrm generates none. With the user's approval, `outlineWidth` now injects outlines, which supersedes D-10.
- **Most measurements were taken by browser automation, not by hand.** Every reading was gated on `visibilityState: visible` and a steady ~120 FPS. Readings from hidden tabs were discarded.

## Known Issues (open, from 16-REVIEW.md)

- **WR-06:** the rig's counter-rotation assumes a VRM0 model. VRM1 models such as `3636451243928341470.vrm` may be lit from the wrong side when rotated to face the camera.
- **WR-01:** each DOF focus update rebuilds the whole post-FX chain.
- **WR-02:** a fixed backdrop distance hides the avatar once the camera is further away than that distance.
- **WR-03, WR-04, WR-05, WR-07, WR-08, IN-01..IN-06:** see `16-REVIEW.md`.
- After `EffectComposer` has been mounted and unmounted once, saturation with no post-FX reads about 0.02 lower than on a fresh page load. Not investigated.

## Self-Check: PASSED

- The harness files exist, and `mtoon-spike/` is untouched.
- `pnpm --filter @khaveeai/react build` is clean. Tests pass 202/202. Playground `tsc` is clean.
- Spike 006 is marked discharged in `.planning/spikes/MANIFEST.md`, with the measured draw-call numbers.
