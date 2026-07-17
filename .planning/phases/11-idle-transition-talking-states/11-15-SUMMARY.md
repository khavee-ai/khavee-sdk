---
phase: 11-idle-transition-talking-states
plan: 15
subsystem: animation
tags: [react, three.js, vrm, retargeting, crossfade, procedural-animation, gap-closure, headless-diagnostic]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: "11-13's shouldTriggerClipSwitch (G1/G3 fix), which relocated the base clip's first successful crossfade from never-before-Connect to page-load time -- the direct cause of G5 surfacing (11-14's human re-check finding); and 11-13's H-G3 finding (a smooth, always-present hips-Y settle ramp driven by the SAME crossfade this file always ran), which this plan's headless replay confirms is the same mechanism, now measured at page-load time"
provides:
  - "Headless runtime evidence CONFIRMING G5's mechanism: a real GLTFLoader.parse()+VRMLoaderPlugin-loaded male.vrm + FBXLoader-loaded Idle.fbx + the real remapMixamoAnimationToVrm retargeter + the real beginCrossfade/stepCrossfade, replayed across the real 1.2s TRANS-01/02 floor (chatStatus === \"stopped\" at page load, matching switchToClip's floor branch), recording frame-by-frame hips.position.y paired with idleAction.getEffectiveWeight() and confirming EVERY frame matches THREE's PropertyMixer single-action blend model (applied = original*(1-w) + animated*w)"
  - "remapMixamoAnimationToVrm.ts fix: the hips VectorKeyframeTrack normalization now anchors at the VRM bind-pose LOCAL hips Y (getNormalizedBoneNode(\"hips\").position.y) instead of 0, making both crossfade blend endpoints equal so the PropertyMixer blend is flat at every weight -- eliminating the drop with no mid-ramp overshoot and no controller-local gating"
  - "remapMixamoAnimationToVrm.test.ts: new unit test file (4 tests) proving the anchor-at-bind-pose behavior, a contrasting old-anchor-to-0 guard, a PropertyMixer flatness-across-weights simulation, and inter-clip height consistency"
  - "AnimationStateEngine.test.ts: new 'G5 fix' describe block driving a real beginCrossfade(null, idleAction, root)+stepCrossfade settle, asserting hips.position.y stays within a small tolerance of the bind-pose Y across the full real crossfade settle"
affects: ["11-16 (decisive human re-verification of G5, plus a final full regression pass)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Headless production-path replay extended to cover TEXTURE-loading environment gaps: GLTFLoader's image-decode path throws in headless Node (self is not defined; no Image element) even though this diagnosis only needs the skeleton/bone graph -- resolved by shimming globalThis.self and monkey-patching THREE.TextureLoader.prototype.load to resolve synchronously with an empty Texture, bypassing real image decode entirely (11-11/11-13's Node-ESM-loader workaround precedent, extended one layer further)."
    - "PropertyMixer blend-model verification against a TIME-VARYING animated value, not a snapshot: an isolated second AnimationMixer, driving a cloned bone at a fixed weight=1 in lockstep with the real crossfade's delta, samples what the clip's OWN Y value is at each frame's elapsed playback time -- necessary because the source clip (Idle.fbx) has its own inherent hip-bob motion as it plays, so 'animated' in original*(1-w)+animated*w is not simply the track's first keyframe once t>0."
    - "Anchor-time-normalization root-cause pattern: a retargeter's cross-clip height-consistency normalization (anchor every clip's first Y keyframe to a SHARED constant, so switching between clips of different authored heights never jumps) is correct in intent but can pick the WRONG shared constant (0) relative to what the consuming engine's blend actually starts FROM (the bind pose) -- the fix preserves the normalization's original purpose while changing only the anchor value to match the blend's other endpoint."

key-files:
  created:
    - packages/react/src/utils/remapMixamoAnimationToVrm.test.ts
  modified:
    - packages/react/src/utils/remapMixamoAnimationToVrm.ts
    - packages/react/src/animation/AnimationStateEngine.ts
    - packages/react/src/animation/AnimationStateEngine.test.ts

key-decisions:
  - "Diagnosed G5 via a faithful headless replay of the REAL page-load path (real male.vrm + Idle.fbx, real remapMixamoAnimationToVrm, real beginCrossfade/stepCrossfade across the real 1.2s floor chatStatus===\"stopped\" produces at page load) rather than assuming G5 is identical to 11-13's already-measured G3 mechanism -- confirmed with concrete numbers (startY 1.00825679, endY 0.00027984, totalDelta ~1.008, maxSingleFrameDelta ~4.1% of total, all 78 frames matching the PropertyMixer blend-model formula) that it IS the same character-(a) smooth eased ramp, just at a different (longer, since the floor differs) duration."
  - "Fixed at the retarget source (remapMixamoAnimationToVrm.ts), not with a controller-local weight-proportional correction in AnimationStateEngine.ts, per the plan's fix-site decision -- confirmed correct by the evidence itself: since every recorded frame matched a clean single-action original*(1-w)+animated*w blend, making the animated track's first frame equal the bind pose (both ~1.008) makes the blend flat at EVERY weight, with no need for a weight-proportional additive correction or any RestPoseAnchor/isBaseActionMeaningfullyDriving change."
  - "Anchored the retargeter at the LOCAL bind-pose hips Y (getNormalizedBoneNode(\"hips\").position.y), not the existing line-27 WORLD vrmHipsY, even though the two values coincide exactly for male.vrm (the VRM's scene root sits at world Y 0) -- THREE's AnimationMixer/PropertyMixer binds and blends the LOCAL hips.position property, so anchoring against anything other than the LOCAL value would be silently wrong for a rig whose scene root is offset from world-origin Y."
  - "requirements-completed intentionally left empty in this plan's frontmatter, matching 11-13's precedent: this plan's own <verification> section explicitly defers decisive live/visual confirmation of the eliminated drop to 11-16's human checkpoint -- code-level evidence (headless diagnosis + unit/integration tests + full suite green) is landed, but requirement completion is not claimed here."

requirements-completed: []  # NOT populated -- per this plan's own <verification> section, decisive live confirmation that the page-load Y-drop is actually eliminated is deferred to 11-16's human-verify checkpoint (11-13 precedent: code-level fixes have twice previously passed their own tests while the live app stayed broken, at 11-10 and 11-12).

# Metrics
duration: ~55min (headless harness build/environment-shimming/iteration + retarget fix + regression tests)
completed: 2026-07-17
---

# Phase 11 Plan 15: Fifth gap-closure pass — G5 root-caused via headless page-load replay and fixed by anchoring the retargeted hips track at the VRM bind-pose Y Summary

**Headless replay of the real page-load T-pose-to-idle settle (real male.vrm + Idle.fbx + the real retargeter/crossfade engine, all 78 sampled frames matching THREE's PropertyMixer blend-model formula) confirmed G5 is the same smooth eased hips-Y ramp 11-13 already measured for the connect-time G3 drop, root-caused it to `remapMixamoAnimationToVrm`'s hips track being anchored at Y=0 while the VRM's bind pose sits at ~1.008, and fixed it by anchoring the retargeted track at the bind-pose Y instead — making both crossfade blend endpoints equal so the blend is flat at every weight, with no mid-ramp overshoot and no controller-local gating needed.**

## Performance

- **Duration:** ~55 min (headless VRM/FBX diagnostic harness build, Node-headless texture-loading environment shims, iteration, retarget fix, regression tests)
- **Started:** ~2026-07-17T15:20Z (approx)
- **Completed:** 2026-07-17T15:35Z
- **Tasks:** 2 of 2 completed
- **Files modified:** 3 (+ 1 created)

## Accomplishments

- Built a headless diagnostic harness (Node `--experimental-strip-types` + the 11-11/11-13 custom ESM resolve hook, extended this round with `self`/`THREE.TextureLoader.prototype.load` shims so `GLTFLoader.parse()` can run headless in Node without throwing on the image-decode path that this diagnosis doesn't need) that loads the REAL `public/models/male.vrm` via `GLTFLoader.parse()` + `VRMLoaderPlugin`, `public/models/animations/Idle.fbx` via `FBXLoader`, remaps it through the REAL `remapMixamoAnimationToVrm`, and drives the REAL `beginCrossfade`/`stepCrossfade` from `crossfade.ts` with a deterministically-advanced `performance.now()`.
- **Bind-pose measurement:** `hips.position.y` (LOCAL bind pose, captured before any action ever played) measured `1.00825679`. The existing line-27 WORLD `vrmHipsY` measured the IDENTICAL value, because `male.vrm`'s scene root sits at world Y `0` — confirmed this coincidence is rig-specific (not something to rely on generally), so the fix explicitly reads the LOCAL value.
- **Replayed the exact real page-load sequence:** `chatStatus` is `"stopped"` at mount (`KhaveeProvider`'s initial state), so `switchToClip`'s TRANS-01/02 floor branch (`chatStatus === "starting" || "stopped"`) applies even for the idle/ready target — meaning the page-load base clip's first crossfade uses the SAME `1.2`s floor as any starting/stopped transition. Drove `beginCrossfade(null, idleAction, vrm.scene, 1.2)` for 78 simulated 60fps frames, recording `hips.position.y` and `idleAction.getEffectiveWeight()` every frame.
- **Measured:** `startY = 1.00825679` -> `endY = 0.00027984`, `totalDelta ≈ 1.00798`, `maxSingleFrameDelta ≈ 0.04085` (~4.1% of total — smooth, eased, no single frame dominates). At the frame where `getEffectiveWeight()` first crosses `0.05` (frame 18, `t≈0.300s`), `hips.position.y ≈ 0.95518` — confirming a hypothetical flat additive correction gated on `isBaseActionMeaningfullyDriving` would overshoot to `≈1.963` at that exact frame, exactly matching the plan's predicted overshoot and confirming why that approach would be wrong.
- **CONFIRMED all 78 frames match THREE's PropertyMixer single-action blend model** (`applied = original*(1-w) + animated*w`), where `animated` was sampled via an isolated weight-1 mixer driving a cloned hips bone in lockstep (NOT a constant — `Idle.fbx`'s hips track has its own inherent bob motion as the clip plays, on top of the retarget-time Y normalization). This confirms the retargeter-anchor fix site: making `animated`'s first frame equal `original` (bind pose) makes the blend flat at every weight.
- **CHARACTER DETERMINATION:** G5 is character-(a) — the IDENTICAL smooth eased ramp 11-13's H-G3 already measured for the connect-time drop, simply relocated to page-load time (a direct, expected consequence of 11-13's G1 fix). Not a distinct/discontinuous artifact.
- Recorded the full runtime-evidenced diagnosis, the character determination, and the fix-site decision as a new `11-15 gap closure` file-header block in `AnimationStateEngine.ts`, additive to (not replacing) the existing 11-09/11-11/11-13 blocks.
- **Fixed** `remapMixamoAnimationToVrm.ts`'s hips `VectorKeyframeTrack` normalization: instead of anchoring every retargeted clip's hips track to start at Y=`0` (`v - firstY`), it now anchors at the VRM bind-pose LOCAL hips Y (`v - firstY + bindPoseHipsY`). The original inter-clip jump-prevention purpose (every clip starts at the SAME shared height) is preserved — only the shared constant changed, from `0` to the bind pose.
- Added `remapMixamoAnimationToVrm.test.ts` (4 new tests): first-keyframe-Y-equals-bind-pose-Y assertion, a contrasting old-anchor-to-0 guard (re-derived from the fixed function's own output, not a separate hand-copy of the old formula), a PropertyMixer flatness-across-weights simulation (fixed stays flat at every `w`; old drops toward 0 as `w->1`), and an inter-clip consistency check (two different clips both land at the same bind-pose height).
- Added a new "G5 fix" describe block to `AnimationStateEngine.test.ts` (1 new test) driving a REAL `beginCrossfade(null, idleAction, root)` + `stepCrossfade` settle over the real 1.2s floor with a synthetic hips-position track built the way the fixed retargeter now produces one, asserting `hips.position.y` stays within a small tolerance (0.03) of the bind-pose Y across the ENTIRE settle — explicitly contrasted against the pre-fix ~1.008-unit drop.
- GLB path confirmed untouched: `grep remapMixamoAnimationToVrm packages/react/src/GLBAvatar.tsx` returns 0 matches — the fix cannot reach `happy.glb`'s already-correct hips heights.

## Task Commits

Each task was committed atomically:

1. **Task 1: Diagnose G5 at runtime via headless production-path replay** - `18ebf80` (fix — instrumentation + header diagnosis only, no production behavior change)
2. **Task 2: Fix G5 at the retarget source** - `856841c` (fix — bind-pose anchor in remapMixamoAnimationToVrm.ts + regression tests)

**Plan metadata:** committed alongside this SUMMARY (see final commit in git log)

## Files Created/Modified

- `packages/react/src/animation/AnimationStateEngine.ts` — new `11-15 gap closure` file-header diagnosis block (recorded headless production-path evidence, the character-(a) determination, the root-cause confirmation, and the fix-site decision), additive to the 11-09/11-11/11-13 blocks. No executable-logic lines changed (verified: `git diff` for Task 1's commit touches only comment lines).
- `packages/react/src/utils/remapMixamoAnimationToVrm.ts` — THE FIX: the hips `VectorKeyframeTrack` branch now reads the VRM bind-pose LOCAL hips Y (`getNormalizedBoneNode("hips")?.position.y`) and anchors the normalized track at that value instead of `0`; the vrm parameter type signature extended to expose `.position.y` on the humanoid bone-node return type.
- `packages/react/src/utils/remapMixamoAnimationToVrm.test.ts` (new) — 4 unit tests covering the bind-pose anchor, the contrasting old-behavior guard, the PropertyMixer flatness-across-weights simulation, and inter-clip consistency.
- `packages/react/src/animation/AnimationStateEngine.test.ts` — new "G5 fix — hips height holds at bind pose during the load-time idle settle (11-15)" describe block (1 test) driving the real `beginCrossfade`/`stepCrossfade` production path.

## Decisions Made

- Diagnosed via a faithful headless replay of the REAL page-load path (not assumed identical to G3 from code-reading alone) — this is what actually confirmed the character-(a) determination with concrete measurements, including the smooth-ramp evidence and the flat-additive-offset overshoot prediction the plan called for.
- Confirmed the retargeter-anchor fix-site is correct FROM the evidence itself (the single-action `original*(1-w)+animated*w` blend-model match across all 78 frames), rather than defaulting to the plan's controller-local fallback — the fallback was explicitly NOT triggered because the evidence showed the anchor approach works cleanly.
- Anchored at the LOCAL bind-pose hips Y, not the existing line-27 WORLD value, even though they coincide for this specific rig — chosen for correctness across any future rig whose scene root isn't at world Y 0, not just to pass this rig's measurement.
- `requirements-completed` intentionally left empty, mirroring 11-13's precedent: decisive live/visual confirmation that the drop is actually gone is deferred to 11-16's human checkpoint, since code-level fixes have twice previously (11-10, 11-12) passed their own tests while the live app stayed broken.

## Deviations from Plan

None — plan executed exactly as written, including the mandatory headless production-path replay (Task 1) and the retargeter-anchor fix confirmed as the correct site by the recorded evidence rather than needing the controller-local fallback (Task 2).

## Issues Encountered

- `GLTFLoader.parse()`'s texture/image-decode path throws `ReferenceError: self is not defined` in headless Node (no `self`/`Image`/`document` globals) even though this diagnosis only needs the skeleton/bone graph, not material textures. Resolved by shimming `globalThis.self = globalThis` and monkey-patching `THREE.TextureLoader.prototype.load` to resolve synchronously with an empty `THREE.Texture()`, bypassing real image decode entirely — extends the 11-11/11-13 headless-harness-environment-workaround precedent one layer further (Node ESM loader workaround -> now also texture-loading workaround).
- The first version of the frame-by-frame `predicted` value used the remapped clip's first-keyframe Y as a CONSTANT `animated` value in the PropertyMixer formula, which matched for early frames but diverged (up to several percent) from frame ~39 onward. Root cause: `Idle.fbx`'s hips track has its own inherent bob/motion as the clip plays (it's a looping idle animation, not a static pose), so the clip's OWN Y value changes over elapsed playback time, not just via the retarget-time normalization. Fixed by sampling the clip's time-varying Y from an isolated second `AnimationMixer` (weight always 1, driving a cloned hips bone) advanced in lockstep with the real crossfade — after this fix, all 78 frames matched the blend-model formula within floating-point tolerance.
- Both scratch harness files (`scratch-g5-diagnose.ts`, `scratch-resolve-hook.mjs`) needed to live inside the repo tree (not the session scratchpad directory) for Node's module resolution to find `node_modules` — placed under a temporary `scratch-tmp/` directory at the worktree root, then deleted before Task 1's commit; `git status --short` confirmed clean of scratch artifacts before staging.

## User Setup Required

None — no external service configuration required. This plan's evidence gathering ran entirely headless (no dev server, no browser, no human interaction) since decisive live/visual confirmation is explicitly deferred to 11-16.

## Next Phase Readiness

- G5 is root-caused (headless-evidenced, character-(a) — same eased ramp as G3, relocated to load time) and fixed at the retarget source, with the fix confirmed correct BY the same evidence that diagnosed the bug (the single-action PropertyMixer blend-model match).
- `AnimationStateEngine.ts` carries the full runtime-evidenced diagnosis in its `11-15 gap closure` file-header block for 11-16's human re-verification to cross-reference, alongside the existing 11-09/11-11/11-13 blocks.
- GLB path provably untouched (`grep remapMixamoAnimationToVrm GLBAvatar.tsx` == 0); no change to `RestPoseAnchor`, `resetToRestPoseIfNotDriven`, or `isBaseActionMeaningfullyDriving`.
- Full `@khaveeai/react` test suite green: 98/98 across 8 suites (up from 93/93 pre-plan — 4 new `remapMixamoAnimationToVrm.test.ts` tests + 1 new "G5 fix" test), including the preserved, unmodified 11-09 first-mount spin repro, 11-11 G1/G2 tests, and 11-13 G4 tests. `tsc --noEmit` clean in `packages/react`.
- Per this plan's own `<verification>` section, decisive visual confirmation that the page-load T-pose-to-idle drop is actually eliminated (no visible Y-drop before Connect, plus a re-confirmation that G1-G4 and the full 7-requirement regression sweep remain approved) is deferred to 11-16's human-verify checkpoint. This is the fifth round targeting this Y-drop mechanism's underlying cause; 11-16 is the decisive live gate.
- No STATE.md/ROADMAP.md/REQUIREMENTS.md updates were made by this worktree agent per the orchestrator's instructions; the orchestrator should record this plan's outcome (G5 diagnosed + fixed at the code level, live confirmation pending) and the pending 11-16 checkpoint when merging this worktree's results back.

---
*Phase: 11-idle-transition-talking-states*
*Completed: 2026-07-17*

## Self-Check: PASSED

`packages/react/src/animation/AnimationStateEngine.ts`, `packages/react/src/animation/AnimationStateEngine.test.ts`, `packages/react/src/utils/remapMixamoAnimationToVrm.ts`, `packages/react/src/utils/remapMixamoAnimationToVrm.test.ts`, and this SUMMARY.md confirmed present on disk. Commits `18ebf80` (Task 1 diagnosis) and `856841c` (Task 2 fix) confirmed present in `git log --oneline --all`.
