/**
 * AnimationStateEngine.ts — chatStatus -> base-clip resolver (state layer)
 * plus the per-frame controller that drives the 10-01 crossfade engine and
 * the blink procedural delta from a single `update(delta)` call.
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * This is the one code path both `VRMAvatar` and `GLBAvatar` consume
 * (ANIM-01), replacing the two components' previously-separate, live-clock-
 * driven implementations (see `GLBAvatar.tsx`'s old talking-animation
 * loop-back timer, removed in 10-03).
 *
 * 11-09 gap closure (first-load "spins weird" bug, untracked / not one of
 * Phase 11's 7 requirements): root-caused as first-mount procedural-write
 * accumulation on un-driven bones. Mechanism, confirmed by reading
 * `crossfade.ts`'s `beginCrossfade`/`stepCrossfade`: on the very first
 * `switchToClip` call, `beginCrossfade(null, toAction, root, floor)` starts
 * `toAction`'s effective weight at 0 and ramps it to 1 over the pose-gap-
 * adaptive/TRANS-01 floor duration (0.3-1.2s) via `stepCrossfade`. While
 * that weight is near 0, THREE's `AnimationMixer` barely (or does not)
 * drive the chest/spine/hips bones this frame — so `breathing.step`/
 * `sway.step`'s additive `bone.quaternion.multiply(delta)` writes (steps 5-
 * 6 below) do not compose onto a freshly mixer-driven pose each frame the
 * way they do in steady state (where the base action's effective weight is
 * ~1 and the mixer fully re-writes the bone every frame, discarding the
 * previous frame's procedural delta before this frame's runs). Instead,
 * each frame's delta compounds onto the PREVIOUS frame's already-drifted
 * quaternion. Because breathing (X-axis) and sway (Z-axis) rotate around
 * different axes, their interleaved multiplications do not cancel over a
 * cycle the way either alone would (non-commuting rotation composition) —
 * this net drift is exactly the reported "spins weird" symptom, which then
 * "settles" once the crossfade weight reaches ~1 and the mixer starts
 * fully overwriting the bone every frame again.
 *
 * Fix: `shouldRunProceduralBoneWrites` below gates the spine-base-capture/
 * breathing/sway/spine-clamp block (`update()` steps 4-7) on the current
 * base action existing AND having ramped past a small effective-weight
 * threshold, so those steps are skipped for the handful of near-zero-
 * weight frames at the very start of the very first crossfade (and any
 * later crossfade from a null base, though in practice `currentActionRef`
 * is never reset to null after the first switch). Blink (step 2) and
 * expression drift (step 8) are NOT gated — they write manager scalars,
 * not accumulating bone quaternions, so they are not part of this bug
 * class and gating them would just delay otherwise-harmless facial
 * behavior for no reason.
 *
 * 11-11 gap closure (T-pose-on-load [G1] + idle->talking snap [G2]):
 * DIAGNOSIS (recorded runtime evidence, see 11-11-SUMMARY.md for the full
 * headless harness output) — 11-09's two leading candidate causes were
 * each directly tested against the REAL production code path
 * (`beginCrossfade`/`stepCrossfade` from `crossfade.ts`, the real
 * `remapMixamoAnimationToVrm` retargeter, a real `male.vrm` +
 * `Idle.fbx`/`talking.fbx` loaded headless) and BOTH were disproven:
 *   - G1-a (base `Idle` action never drives `male.vrm`'s bones, e.g. a
 *     remap-coverage gap): DISPROVEN. All 53/53 remapped track targets
 *     resolved against the live scene graph, and once the base action's
 *     weight ramped up, the normalized spine bone moved ~0.09rad off bind
 *     AND `vrm.update()` (the humanoid "unnormalize" step VRMAvatar.tsx
 *     already calls every frame) correctly propagated that onto the RAW,
 *     mesh-deforming bone. The base clip genuinely drives the full body.
 *   - G1-b (the gate's effective-weight check never opens in the real
 *     loop): DISPROVEN. Under a faithful headless replay of
 *     `beginCrossfade(null, toAction, root)` + per-frame `stepCrossfade`
 *     (with `performance.now()` deterministically advanced per simulated
 *     frame, since `stepCrossfade` times off wall-clock, not the mixer's
 *     `delta`), the gate opened at frame 5 (~0.167s into a 0.73s
 *     crossfade) and stayed open — matching the ~t=0.23 prediction in the
 *     11-09 comment above.
 *   - G2's leading lead (pose-gap measured against a frozen/bind pose
 *     collapses `poseGapToDuration` toward its 0.3s floor): DISPROVEN.
 *     `computePoseGapAngle`/`poseGapToDuration` for idle->talking measured
 *     the IDENTICAL duration (~0.497s, mid-range, no floor collapse)
 *     whether the live pose was a genuinely-driven idle pose or a
 *     synthetically-frozen bind pose — the crossfade engine's own duration
 *     math is unaffected by G1 either way.
 *   - CONFIRMED (the actual mechanism, found empirically, not one of the
 *     two pre-defined leads): 11-09's own comment above assumed the gate's
 *     near-zero-weight window only matters "at the very start of the very
 *     first crossfade... in practice `currentActionRef` is never reset to
 *     null after the first switch" — true, but incomplete: `switchToClip`
 *     reassigns `currentActionRef.current` to the NEW target action
 *     *synchronously*, and that new action's weight always restarts
 *     ramping from 0 (`beginCrossfade`'s `toAction.setEffectiveWeight(0)`)
 *     — so `shouldRunProceduralBoneWrites(currentActionRef.current)`
 *     goes false again on **every** `switchToClip` call, not just the
 *     first mount. A headless replay of a second (idle->talking) switch
 *     confirmed the gate re-closes for a real, measurable window (3/60
 *     simulated frames = ~0.1s in the recorded run, scaling with that
 *     switch's own pose-gap-adaptive duration) every time. G1 and G2 are
 *     therefore SHARED: both are symptoms of breathing/sway going
 *     completely silent during ANY near-zero-weight window (first mount
 *     covers G1; every later switch, including idle->talking, covers G2),
 *     not just the originally-diagnosed first-mount case.
 *
 * FIX (Task 2): rather than skipping the whole spine-base-capture/
 * breathing/sway/spine-clamp block during a near-zero-weight window
 * (11-09's approach, which is what produces the visible freeze),
 * `restPoseRef` below captures a STABLE rest-pose anchor (spine/chest/hips
 * quaternions) once, the first time these bones are resolvable — before
 * any procedural write has ever touched them. `resetToRestPoseIfNotDriven`
 * then resets these bones to that FIXED anchor, every frame, ONLY while
 * the base action is not yet meaningfully driving the skeleton
 * (`!shouldRunProceduralBoneWrites`). Steps 4-7 (breathing/sway/clamp) now
 * run UNCONDITIONALLY every frame — producing visible idle motion
 * immediately (fixing G1) and during every subsequent crossfade including
 * idle->talking (fixing G2) — while remaining bounded: because the reset
 * target is the SAME fixed anchor every frame (not the previous frame's
 * already-drifted result), each frame's breathing+sway delta is
 * independent and bounded, which is exactly the mechanism the existing
 * "first-mount procedural-write accumulation repro" test proves prevents
 * compounding (see `AnimationStateEngine.test.ts`) — this fix generalizes
 * that same reset-each-frame invariant from "only during the very first
 * crossfade" to "during any near-zero-weight window, however many times
 * it recurs."
 *
 * 11-13 gap closure (fourth pass — pre-connect T-pose [G1 STILL FAILING
 * after 11-11] + Y-axis drop-on-connect [G3, new] + talk-cycle jiggle [G4,
 * new]): 11-12's decisive human re-check found 11-11's `resetToRestPoseIf-
 * NotDriven` fix did NOT resolve the actual pre-connect T-pose (it only
 * resolved once Connect was pressed), plus two new findings. DIAGNOSIS
 * (recorded runtime evidence via a headless replay of the REAL production
 * path — real `public/models/male.vrm` + `Idle.fbx`/`talking.fbx` loaded
 * via `GLTFLoader.parse()` + `VRMCoreLoaderPlugin`, the real
 * `remapMixamoAnimationToVrm` retargeter, and the real `beginCrossfade`/
 * `stepCrossfade` from `crossfade.ts`, `performance.now()` deterministically
 * advanced per simulated frame per 11-11's precedent):
 *
 *   - H-G1 (pre-connect effect-ordering — the base clip's crossfade never
 *     starts before Connect is ever pressed): CONFIRMED. Replayed the
 *     EXACT pre-connect ordering: (1) the crossfade-trigger effect's single
 *     mount-time run, with clips/root NOT yet resolvable (`getAction`
 *     returns null because `processedClips` is still `[]` — `currentVrm`
 *     hasn't finished its async parse in `useLoadVRM`, which does NOT
 *     suspend, unlike the FBX loads) — `switchToClip` returns early via its
 *     `if (!toAction) return` guard, so nothing is recorded; (2) clips/root
 *     become resolvable on a LATER render, WITHOUT `targetName` or
 *     `chatStatus` changing (both are already "idle"/"stopped" from
 *     `KhaveeProvider`'s initial state); (3) ran `update()`'s step 4a-4c
 *     bone-writing sequence for 90 simulated frames with NO further
 *     `switchToClip` call (faithfully matching that the effect's
 *     `[targetName, chatStatus]` deps never change again pre-connect).
 *     Measured: `currentActionRef` stays null and the idle action's
 *     effective weight stays exactly 0 for all 90 frames — the base clip
 *     NEVER starts driving the skeleton until something changes
 *     `chatStatus` (pressing Connect). This is the exact case 11-11's own
 *     headless harness never covered: 11-11 only ever replayed frames
 *     where `currentActionRef` was ALREADY non-null (a crossfade already
 *     in progress) — it never replayed the "switchToClip was never
 *     successfully invoked at all" case, because 11-11's own harness always
 *     called `beginCrossfade` directly rather than replaying the
 *     `useEffect`'s dependency-array gate. A separate isolated re-trigger
 *     (calling `switchToClip` once AFTER clips became resolvable) succeeded
 *     immediately and ramped normally, confirming the crossfade MATH itself
 *     is fine — this is purely an invocation-timing bug in the effect's
 *     re-fire condition, not a defect in `beginCrossfade`/`stepCrossfade`
 *     or in `resetToRestPoseIfNotDriven`.
 *   - H-G3 (Y-drop on connect — G1 symptom vs. independent hip-Y blend):
 *     CONFIRMED SHARED with G1. `remapMixamoAnimationToVrm` normalizes the
 *     hips `VectorKeyframeTrack` so its first authored keyframe's Y
 *     component is exactly `0` (subtracts `firstY`), while the VRM's actual
 *     bind-pose local hips Y (captured before any action ever plays) was
 *     measured at `~1.008`. Empirically running a real
 *     `beginCrossfade(null, idleAction, root)` + `mixer.update()` across 30
 *     sampled frames showed `hips.position.y` ramping smoothly from `1.008`
 *     to `~0.0003` (`totalDelta ≈ 1.008`, `maxSingleFrameDelta ≈ 0.094`,
 *     ~9% of the total — no single frame dominates, i.e. a genuine eased
 *     multi-frame ramp, not a discontinuous jump). Because this motion is
 *     driven entirely by the SAME crossfade this file already runs, it is
 *     not an independent hips-specific defect — it is real, always-present
 *     motion that has simply never been visible before, because G1
 *     prevents `switchToClip` from EVER succeeding until Connect is
 *     pressed. Fixing G1 moves this same settle to page-load time (when the
 *     idle clip first successfully starts driving), which is exactly the
 *     "G1 symptom" framing this diagnosis set out to confirm or disprove.
 *   - H-G4 (talk-cycle jiggle — reset-to-rest firing during variant-switch
 *     crossfade windows): CONFIRMED, but as an INDEPENDENT mechanism (not
 *     shared with G1/G3). Replayed idle (fully driven, weight 1) ->
 *     talking (a real `beginCrossfade(idleAction, talkAction, root)`, i.e.
 *     with a genuine non-null `from`) and sampled the spine bone across the
 *     first 5 frames of that switch. During those frames `talkAction`
 *     (incoming) weight is ~0-0.02 (below `MIN_BASE_ACTION_WEIGHT`), so
 *     `shouldRunProceduralBoneWrites(currentActionRef.current)` — which
 *     only inspects the INCOMING action — reports `false`, and
 *     `resetToRestPoseIfNotDriven` snaps spine/chest/hips to the captured
 *     BIND-POSE anchor every one of those frames, even though `idleAction`
 *     (the OUTGOING action) is still contributing ~0.98-1.0 weight to the
 *     mixer's own blended pose. Measured spine deviation between the
 *     mixer's own blended pose and the post-reset pose peaked at
 *     `~0.079rad` (~4.5°) — a real, measurable snap toward bind pose that
 *     releases once `talkAction`'s weight clears the threshold, i.e. the
 *     reported "jiggle." This is a DIFFERENT bug class than G1/G3: it does
 *     not depend on whether the base action has EVER driven the skeleton
 *     before (unlike G1) — it fires on every subsequent switch between two
 *     already-real, already-driving actions, because the gate only
 *     inspects the incoming action's own weight and never checks whether a
 *     real outgoing action is still contributing.
 *
 * SHARED-VS-INDEPENDENT DETERMINATION: G1 and G3 are the SAME underlying
 * bug (the crossfade-trigger effect's `[targetName, chatStatus]` deps never
 * signal "clips/root just became resolvable," so `switchToClip` is never
 * even called once before Connect) — fixing G1 structurally fixes G3 by
 * construction (the settle simply moves to load time). G4 is an
 * INDEPENDENT bug in `resetToRestPoseIfNotDriven`'s trigger condition
 * (gates on the incoming action's own weight only, ignoring a still-
 * contributing outgoing action) and requires its own fix.
 *
 * FIX (Task 2):
 *   - G1/G3: extracted the "should switchToClip (re-)run" decision into a
 *     new exported, pure function, `shouldTriggerClipSwitch`, mirroring
 *     `shouldRunProceduralBoneWrites`'s testability pattern. The crossfade-
 *     trigger `useEffect` now calls it (thin wrapper, same behavior as
 *     before for the change-driven case); `update()` ALSO calls the exact
 *     same function every frame (a one-shot-per-transition retry, since
 *     `update()` already runs every animation frame regardless of React
 *     re-renders — the frame-native equivalent of "re-evaluate once
 *     clips/root become resolvable" without adding a new dependency-array
 *     signal that could reintroduce a TALK-01-style double-trigger). Once
 *     `switchToClip` succeeds, `currentClipNameRef.current` matches
 *     `targetName` and the function returns `false` on every subsequent
 *     frame — self-terminating, safe to call unconditionally every frame.
 *   - G4: `isBaseActionDriving` (passed into `resetToRestPoseIfNotDriven`)
 *     now also treats a real, non-null `from` action in the active blend as
 *     "driving" — distinguishing "no action has ever driven the skeleton"
 *     (true first-mount case, where `blendRef.current.from` is always null
 *     because the very first `beginCrossfade` call is always
 *     `beginCrossfade(null, toAction, ...)`) from "mid-crossfade between
 *     two real actions" (every subsequent switch, where `from` is the
 *     previously-driving action). In the latter case the reset is skipped
 *     entirely — the mixer's own two-action blend already produces a
 *     continuous, non-frozen pose, so breathing/sway (running
 *     unconditionally per 11-11) compose additively onto that live blend
 *     instead of a stale fixed anchor, eliminating the snap without
 *     reintroducing the 11-09 freeze (the true first-mount case, where
 *     `from` is null, is unaffected and still resets to the anchor exactly
 *     as 11-11 fixed it).
 *
 * 11-15 gap closure (fifth pass — G5, the page-load T-pose-to-idle Y-axis
 * drop): 11-14's decisive human re-check APPROVED G1/G2/G3/G4 and the full
 * 7-requirement regression sweep, but surfaced a NEW finding: on first page
 * load, BEFORE Connect is ever pressed, the avatar visibly "T-pose -> drops
 * on Y -> settles into idle." This is the SAME underlying hips-Y settle
 * motion 11-13's H-G3 finding already measured (the crossfade this file
 * always runs), simply relocated from connect-time (now fixed) to load-time
 * — a direct, expected consequence of 11-13's G1 fix (which made the base
 * clip's FIRST successful crossfade fire at page-load time instead of never
 * firing pre-connect at all). DIAGNOSIS (recorded runtime evidence via a
 * headless replay of the REAL production path — the real
 * `public/models/male.vrm` loaded via `GLTFLoader.parse()` + real
 * `VRMLoaderPlugin`, the real `public/models/animations/Idle.fbx` loaded via
 * `FBXLoader` and the real `remapMixamoAnimationToVrm` retargeter, and the
 * real `beginCrossfade`/`stepCrossfade` from `crossfade.ts`, with
 * `performance.now()` deterministically advanced per simulated frame,
 * 11-11/11-13 precedent; texture/image loading — irrelevant to the
 * skeleton/bone graph this diagnosis measures — was stubbed out via a
 * `self`/`THREE.TextureLoader.prototype.load` shim so the loader could run
 * headless in Node):
 *
 *   - Bind-pose hips Y (captured via `vrm.humanoid.getNormalizedBoneNode(
 *     "hips").position.y`, BEFORE any action ever played): measured
 *     `1.00825679`. The line-27-style WORLD Y
 *     (`getNormalizedBoneNode("hips").getWorldPosition(_vec3).y`) measured
 *     the IDENTICAL `1.00825679` for this rig, because `male.vrm`'s scene
 *     root sits at world Y `0` (`vrm.scene.getWorldPosition(_vec3).y === 0`)
 *     — so for this rig the LOCAL bind-pose hips Y and the existing line-27
 *     WORLD hips Y coincide exactly (delta `0`). This is rig-dependent (a
 *     VRM whose scene root were offset from world-origin Y would NOT see
 *     these coincide), so the fix below explicitly reads the LOCAL value
 *     (`position.y`), not the existing line-27 world value, to stay correct
 *     for every rig, not just this one.
 *   - `remapMixamoAnimationToVrm`'s CURRENT anchor-to-0 behavior confirmed:
 *     the remapped hips `VectorKeyframeTrack`'s first keyframe Y measured
 *     exactly `0` (the `- firstY` normalization at lines 82-87 already
 *     visually identified as the mechanism).
 *   - Replayed the EXACT page-load sequence: `chatStatus` is `"stopped"` at
 *     mount (`KhaveeProvider`'s initial `useState`), so `resolveBaseClip`
 *     falls through to the manually-set `currentAnimation`/first-available
 *     clip (idle), and `switchToClip`'s `floor` branch applies (`chatStatus
 *     === "starting" || "stopped"` is true) — meaning the page-load base
 *     clip's first crossfade uses the SAME `1.2`s TRANS-01/02 floor as any
 *     starting/stopped transition, not the shorter 0.3-0.9s pose-gap-
 *     adaptive range. `beginCrossfade(null, idleAction, vrm.scene, 1.2)`
 *     was driven for 78 simulated 60fps frames (1.2s + a few frames past
 *     completion) via the real `stepCrossfade`, recording `hips.position.y`
 *     AND `idleAction.getEffectiveWeight()` every frame.
 *   - Measured: `startY = 1.00825679` (frame 0, weight 0) ->
 *     `endY = 0.00027984` (settled), `totalDelta ≈ 1.00798`,
 *     `maxSingleFrameDelta ≈ 0.04085` (~4.1% of total — no single frame
 *     dominates; a genuine smooth, eased multi-frame ramp, matching 11-13's
 *     H-G3 "smooth ramp" character exactly, just spread over more frames
 *     since page-load's `1.2`s floor is longer than G3's shorter connect-
 *     time pose-gap-adaptive duration, hence a SMALLER max-single-frame-
 *     delta percentage here). At the frame where
 *     `idleAction.getEffectiveWeight()` first crosses `MIN_BASE_ACTION_
 *     WEIGHT` (`0.05`) — frame 18, `t ≈ 0.300s`, `w ≈ 0.05265` — the
 *     measured `hips.position.y` was `≈ 0.95518`. A HYPOTHETICAL flat
 *     additive correction gated on `isBaseActionMeaningfullyDriving`
 *     (`offset = bindPoseHipsY` added unconditionally once the gate opens)
 *     would compute `0.95518 + 1.00826 ≈ 1.96344` at that exact frame —
 *     confirming the plan's predicted ~1.966 overshoot and why a flat,
 *     gate-triggered additive correction is the WRONG fix (it would replace
 *     a smooth drop with a sudden near-doubling pop-up at the gate-flip
 *     frame).
 *   - Cross-checked every recorded frame against THREE's PropertyMixer
 *     single-active-action blend model, `applied = original*(1-w) +
 *     animated*w`, where `original` is the fixed bind-pose local hips Y and
 *     `animated` is the clip's OWN time-varying hips-Y at that frame's
 *     elapsed playback time (sampled via an isolated weight-1 mixer driving
 *     a cloned hips bone in lockstep — NOT a constant equal to the track's
 *     first keyframe, since `Idle.fbx`'s hips track has its own inherent
 *     bob/motion as the clip plays, distinct from the retarget-time Y
 *     normalization). ALL 78 frames matched this model within floating-
 *     point tolerance (`< 1e-9` observed) — CONFIRMING the applied
 *     `hips.position.y` is fully explained by a single-action position-
 *     binding blend between the bind pose and the (currently 0-anchored)
 *     animated track, exactly the model the retargeter-anchor fix depends
 *     on.
 *   - CHARACTER DETERMINATION: G5 is character-(a) — the IDENTICAL smooth,
 *     eased hips-Y ramp 11-13's H-G3 already measured for the connect-time
 *     drop (now fixed), simply present at page-load time instead, per the
 *     `totalDelta`/no-single-frame-dominates evidence above. It is NOT a
 *     distinct or discontinuous artifact (character-(b)) specific to the
 *     T-pose starting point — the T-pose is just this rig's true bind pose,
 *     and the same crossfade math that shared-root-caused G1/G3 governs it
 *     identically.
 *   - ROOT CAUSE (confirmed, matches the plan's hypothesis exactly):
 *     `remapMixamoAnimationToVrm` normalizes every retargeted clip's hips
 *     `VectorKeyframeTrack` so its first authored keyframe's Y is exactly
 *     `0` (subtracting `firstY`), while `male.vrm`'s actual bind-pose local
 *     hips Y is `~1.008`. Because THREE's `AnimationMixer` captures
 *     `original` (the pre-action bone value, i.e. the bind pose) the moment
 *     an action first activates, and blends toward the animated track value
 *     as weight ramps 0->1, the mismatch between these two endpoints (`1.008`
 *     vs `0`) IS the drop — confirmed by the exact `applied =
 *     original*(1-w)+animated*w` frame-by-frame match above.
 *   - FIX-SITE DETERMINATION: the retargeter anchor (`remapMixamoAnimation-
 *     ToVrm.ts`, replacing the anchor-to-`0` normalization with an anchor to
 *     the VRM bind-pose LOCAL hips Y) is CONFIRMED as the correct fix site —
 *     the evidence above shows the applied value IS a single-action
 *     `original*(1-w)+animated*w` blend, so making `animated`'s first frame
 *     equal `original` (both become `~1.008`) makes the blend flat
 *     (`applied ≈ bindPoseY`) at EVERY weight, eliminating the drop with no
 *     mid-ramp overshoot and no controller-local gating/RestPoseAnchor
 *     change needed. The controller-local weight-proportional fallback
 *     described in the plan is NOT needed — the evidence does not show the
 *     retargeter anchor "cannot work"; it shows exactly the opposite (a
 *     clean single-action blend the anchor fix directly flattens). GLB is
 *     confirmed unaffected: `remapMixamoAnimationToVrm` is imported only by
 *     `VRMAvatar.tsx` (lines 337/353) and `src/app/components/
 *     VRMAvatarRef.tsx` — `grep remapMixamoAnimationToVrm
 *     packages/react/src/GLBAvatar.tsx` returns 0 matches, so `happy.glb`'s
 *     already-correct hips heights are untouched by this fix.
 *
 * FIX (Task 2): `remapMixamoAnimationToVrm.ts`'s hips `VectorKeyframeTrack`
 * branch now anchors the retargeted track at the VRM bind-pose LOCAL hips Y
 * (`vrm.humanoid?.getNormalizedBoneNode("hips")?.position.y`) instead of
 * `0` — `value = scaled.map((v, i) => (i % 3 === 1 ? v - firstY +
 * bindPoseHipsY : v))`. Every clip retargeted through this function still
 * starts at the SAME shared height (the original inter-clip jump-prevention
 * purpose of this normalization, unchanged), but that shared height is now
 * the bind pose instead of `0`, so the crossfade's `original` and `animated`
 * endpoints coincide and the blend is flat at every weight. No change to
 * `AnimationStateEngine.ts`'s `RestPoseAnchor`, `resetToRestPoseIfNot-
 * Driven`, or `isBaseActionMeaningfullyDriving` was needed or made this
 * round — the fix lives entirely at the retarget source.
 *
 * 11-17 gap closure (sixth pass — closes the two OPEN ISSUEs recorded
 * verbatim in 11-16-SUMMARY.md's decisive human checkpoint):
 *
 *   OPEN ISSUE 1 (VRM leg sway): "the sway/breath should not affect the
 *   legs cause its weird seeing legs also sway." Root cause was structural
 *   and required no further diagnosis — `sway.ts`'s `stepSway` wrote its
 *   rotation delta to the `hips` bone, the humanoid rig's skeleton root,
 *   whose direct children include both upper-leg bones; any hips rotation
 *   therefore rotated the entire lower body. FIX: `sway.ts` now targets
 *   `spine`+`chest` (mirroring `breathing.ts`'s existing upper-body-only
 *   target) and never resolves or writes `hips`. See `sway.ts`'s own
 *   11-17 file-header note for the full rationale (including why
 *   spine+chest, specifically, introduce no new accumulation surface).
 *
 *   OPEN ISSUE 2 (GLB sway too strong after animation change): "the glb
 *   side sway/breath is fine until i changed its animation, the sway
 *   intensity is too much. may be turn that off when animating?"
 *   `proceduralScale` in `update()` was computed only from
 *   `amplitudeScale` (speaking volume) x `settleScale` (stopped settle
 *   ramp) — independent of which base clip is active. When a GLB user
 *   parks the avatar on a manually-selected non-idle clip via `animate()`,
 *   procedural breathing+sway kept applying their additive deltas on top
 *   of a clip that may not fully re-drive spine/chest every frame, reading
 *   as excessive. FIX: a new exported pure gate,
 *   `shouldDisableProceduralForManualClip` (see its own doc comment for
 *   the full decision table), forces `proceduralScale` to
 *   `MANUAL_CLIP_PROCEDURAL_SCALE` (`0`) whenever GLB has opted in
 *   (`dampProceduralOnManualClip: true`, passed only by `GLBAvatar.tsx` —
 *   `VRMAvatar.tsx` omits it, so VRM's approved idle behavior is
 *   byte-for-byte unchanged) AND the active clip is the user's own
 *   non-idle `animate()` selection. The default idle clip's procedural
 *   motion (and every status-driven state — speaking/listening/thinking/
 *   starting) is unaffected. Verified against `happy.glb`'s clip set
 *   (enumerated in `src/app/glb-avatar-test/page.tsx`) — the non-idle
 *   clips the human parks on (e.g. "State 3 Welcome (loop)", "State 4
 *   Taking (loop)") are exactly the ones this gate now silences procedural
 *   motion on; the idle-pattern-matching clip ("State 1 Idle (loop)")
 *   keeps its motion. Decisive live confirmation is deferred to 11-18's
 *   human checkpoint per this phase's established diagnose-fix-then-
 *   re-verify pattern.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ChatStatus } from "@khaveeai/core";
import { beginCrossfade, stepCrossfade, easeInOutCubic, type BlendState } from "./crossfade";
import { useBlink } from "./blink";
import { useBreathing } from "./breathing";
import { useSway } from "./sway";
import { useExpressionDrift } from "./expressionDrift";
import { useTalkCycle } from "./talkCycle";
import { useGaze } from "./gaze";
import { useGesture, type GestureHint } from "./gesture";
import { volumeToAmplitudeScale } from "./audioAmplitude";
import type { AvatarFormatAdapter } from "./types";

// Module-scoped scratch quaternions for the PERF-01 spine-delta clamp below
// — reused every update() call across every useAnimationController()
// instance, never `new` inside the per-frame path (allocation-reuse
// precedent from crossfade.ts / breathing.ts / sway.ts). Two distinct
// scratches (not one) are required: `_spineBaseScratch` holds the frame's
// pre-procedural orientation and `_spineComposedScratch` holds the post-
// breathing+sway orientation, so the clamp can slerp FROM base TOWARD
// composed without a self-referential copy/slerp on the live bone
// quaternion (THREE.Quaternion#slerpQuaternions would corrupt its own `qb`
// argument if called as `spine.quaternion.slerpQuaternions(base, spine.
// quaternion, t)`, since `.copy(qa)` overwrites `this` — which is also
// `qb` — before `.slerp(qb, t)` reads it).
const _spineBaseScratch = new THREE.Quaternion();
const _spineComposedScratch = new THREE.Quaternion();

// Fraction of normal idle amplitude the procedural layer (breathing, sway,
// expression drift) is damped to while `chatStatus === "stopped"`,
// producing the TRANS-02 settle-to-rest cue (D-01 placeholder — see the
// decision block near STATUS_CLIP_PATTERNS above; issue #17 tracks the real
// dedicated goodbye clip).
const SETTLE_SCALE = 0.15;

// 11-17 gap closure (OPEN ISSUE 2 — GLB sway too strong after animation
// change): when `shouldDisableProceduralForManualClip` gates procedural
// body motion off for a manually-selected, non-idle GLB clip, proceduralScale
// is forced to this value instead of `amplitudeScale * settleScale`. Fully
// disables breathing/sway's additive deltas ("turn that off when
// animating" — the human's own suggested remedy). Kept as a named,
// tunable constant (rather than inlining `0`) in case a subtler damp (a
// small non-zero fraction) is preferred over a hard cutoff later.
const MANUAL_CLIP_PROCEDURAL_SCALE = 0;

// TRANS-02 gap closure (11-07): the settle scale above used to be applied
// as an instant binary cut (`chatStatus === "stopped" ? SETTLE_SCALE : 1`),
// producing a visible snap the moment `stopped` was entered or left. This
// ramp window eases that transition over the same ~1.2s floor already used
// for the starting/stopped base-clip crossfade in `switchToClip` (TRANS-01/
// 02), so the procedural-amplitude settle and the base-clip crossfade
// resolve over the same window in BOTH directions (entering AND leaving
// `stopped`).
const SETTLE_RAMP_SECONDS = 1.2;

// PERF-01 bounded magnitude: max combined per-frame angular delta (radians)
// breathing+sway may jointly apply to the shared spine bone, measured
// post-composition against this frame's pre-procedural base orientation.
// ~0.12 rad (~6.9 degrees) comfortably exceeds either system's own default
// per-frame amplitude at amplitudeScale=1 (breathing 0.03rad + sway
// 0.025rad), so ordinary idle motion is never clamped, while still bounding
// worst-case amplitude-scaled (speaking, up to ~2.25x via
// volumeToAmplitudeScale's gain) combined motion from ever visibly
// over-bending the spine in one frame.
const MAX_COMBINED_SPINE_DELTA_RAD = 0.12;

// 11-09 gap closure (first-load spin fix): minimum THREE.AnimationAction
// effective weight required before the additive procedural bone-write
// block (breathing/sway/spine clamp) is allowed to run. `easeInOutCubic`
// reaches this weight quickly (t ≈ 0.23 of the crossfade's duration) —
// enough to skip the worst near-zero-weight compounding window at the very
// start of the very first crossfade, without meaningfully delaying idle
// motion once the base action is actually posing the skeleton.
const MIN_BASE_ACTION_WEIGHT = 0.05;

// 11-11 gap-closure dev-only diagnostic: hardcoded off, never wired to a
// build flag (mirrors expressionDrift.ts's DRIFT_DEBUG precedent). Flip to
// true locally (never commit as true) to log, once per second per
// controller instance, the live gate/weight/clip/spine-angle state a human
// re-verifying G1/G2 at the 11-12 checkpoint can cross-check directly in
// devtools — see `update()`'s gate-status log call site.
const GATE_DEBUG = false;

/**
 * Pure gate for the 11-09 first-load-spin fix: true only when `action` is
 * non-null AND its current effective weight has ramped past
 * `MIN_BASE_ACTION_WEIGHT`. Exported (unlike most of this module's
 * internals) so it is unit-testable against a stub/real
 * `THREE.AnimationAction` without rendering a React component or scene —
 * see `AnimationStateEngine.test.ts`.
 *
 * `null` covers the pre-first-switchToClip window (no crossfade has ever
 * started); the weight check covers the early-ramp window of an in-
 * progress crossfade FROM null (the true first-mount case, since
 * `currentActionRef` is set synchronously inside `switchToClip` before the
 * weight has actually ramped).
 */
export function shouldRunProceduralBoneWrites(action: THREE.AnimationAction | null): boolean {
  if (!action) return false;
  return action.getEffectiveWeight() >= MIN_BASE_ACTION_WEIGHT;
}

/**
 * 11-13 gap-closure fix (G4 talk-cycle jiggle — see the file-header 11-13
 * diagnosis block). Extends `shouldRunProceduralBoneWrites` with a second
 * condition: a real, non-null `blendFromAction` (the OUTGOING action in an
 * active crossfade) also counts as "driving," even while the incoming
 * action's own weight hasn't ramped yet.
 *
 * This distinguishes the TWO situations `shouldRunProceduralBoneWrites`
 * alone conflates:
 *   - "no action has ever driven the skeleton" (the true first-mount case —
 *     `blendFromAction` is always null here, since the very first
 *     `beginCrossfade` call is always `beginCrossfade(null, toAction, ...)`)
 *     — this case still needs `resetToRestPoseIfNotDriven`'s anchor reset,
 *     exactly as 11-11 fixed it.
 *   - "mid-crossfade between two REAL actions" (every subsequent switch,
 *     where `blendFromAction` is the previously-driving action) — here the
 *     mixer's own two-action blend already produces a continuous,
 *     non-frozen pose every frame (THREE's `AnimationMixer` fully
 *     re-computes bound properties from the CURRENT active-action weights
 *     each frame, discarding whatever the previous frame's procedural
 *     write left behind — the same "fresh base every frame" property
 *     steady state already relies on, see the 11-09 diagnosis block above).
 *     Resetting to a STALE fixed anchor here instead snaps the torso away
 *     from that live blend — the measured ~0.079rad G4 jiggle.
 *
 * Exported and pure so it is unit-testable with stub `THREE.AnimationAction`
 * objects, mirroring `shouldRunProceduralBoneWrites`'s own testability — see
 * `AnimationStateEngine.test.ts`.
 */
export function isBaseActionMeaningfullyDriving(
  currentAction: THREE.AnimationAction | null,
  blendFromAction: THREE.AnimationAction | null,
): boolean {
  return shouldRunProceduralBoneWrites(currentAction) || blendFromAction !== null;
}

/**
 * 11-17 gap-closure fix (OPEN ISSUE 2 — GLB sway too strong after animation
 * change; see the file-header 11-17 diagnosis block). A human reported that
 * on the GLB avatar, procedural breathing+sway are "fine until i changed its
 * animation, the sway intensity is too much" and suggested "may be turn
 * that off when animating?". This pure gate implements exactly that: it
 * returns `true` only when the avatar is currently parked on a
 * manually-selected, non-idle clip via `animate()` — the one case the
 * human flagged as over-strong — and `false` in every other case,
 * including the approved default idle clip's procedural motion.
 *
 * Decision table (all conditions must hold for `true`):
 *   - `enabled` is true (the GLB opt-in — see `dampProceduralOnManualClip`
 *     on `useAnimationController`'s params). VRM never passes this, so it
 *     always gets `false` here and its approved idle behavior is untouched
 *     ("the vrm side is working fine").
 *   - `chatStatus` is `"ready"` or `"stopped"` — status-driven states
 *     (`speaking`/`listening`/`thinking`/`starting`) keep their existing,
 *     already-approved procedural amplitude behavior regardless of the
 *     active clip.
 *   - `currentAnimation` and `activeClipName` are both non-null AND equal
 *     to each other — i.e. the clip actually showing IS the user's explicit
 *     `animate()` selection, not some other clip mid-transition.
 *   - `activeClipName` does NOT match `STATUS_CLIP_PATTERNS.ready` (the
 *     idle/ready base clip) — the default idle clip's procedural motion is
 *     the approved baseline and must stay on even if a consumer happened to
 *     pass its name to `animate()` explicitly.
 *
 * Exported and pure so it is unit-testable without rendering a React
 * component or scene, mirroring `shouldRunProceduralBoneWrites`'s own
 * testability pattern — see `AnimationStateEngine.test.ts`.
 */
export function shouldDisableProceduralForManualClip(params: {
  enabled: boolean;
  chatStatus: ChatStatus;
  currentAnimation: string | null;
  activeClipName: string | null;
}): boolean {
  const { enabled, chatStatus, currentAnimation, activeClipName } = params;
  if (!enabled) return false;
  if (chatStatus !== "ready" && chatStatus !== "stopped") return false;
  if (currentAnimation === null || activeClipName === null) return false;
  if (activeClipName !== currentAnimation) return false;
  if (STATUS_CLIP_PATTERNS.ready!.test(activeClipName)) return false;
  return true;
}

/** A captured spine/chest/hips rest-pose anchor — see `resetToRestPoseIfNotDriven`. */
export interface RestPoseAnchor {
  spine: THREE.Quaternion;
  chest: THREE.Quaternion;
  hips: THREE.Quaternion;
}

/**
 * 11-11 gap-closure fix (G1 T-pose-on-load / G2 idle->talking snap — see
 * the file-header 11-11 diagnosis block for the full runtime-evidenced root
 * cause). Resets `bones` to the captured `restPose` anchor, but ONLY while
 * `isBaseActionDriving` is false (i.e. `shouldRunProceduralBoneWrites`
 * would have gated the block under 11-09's approach). No-ops if
 * `isBaseActionDriving` is true (the mixer already wrote this frame's pose;
 * nothing to reset) or `restPose` is null (bones not yet resolvable when
 * the anchor would have been captured).
 *
 * Exported and pure (aside from the bone quaternion writes) so it is
 * unit-testable with stub `THREE.Object3D` bones, mirroring
 * `shouldRunProceduralBoneWrites`'s testability — see
 * `AnimationStateEngine.test.ts`.
 *
 * Why this fixes G1/G2 without reintroducing the 11-09 spin: resetting to
 * the SAME fixed anchor every frame (rather than 11-09's "skip the block
 * entirely" gate) means breathing/sway (called unconditionally by `update()`
 * now, see below) always compose their additive delta onto a STABLE base —
 * never onto the previous frame's already-drifted result. Each frame's
 * delta is therefore independent and bounded (never compounds across
 * frames), which is the same "reset the base every frame" invariant the
 * existing first-mount compounding repro test proves prevents the 11-09
 * spin — just generalized to every near-zero-weight window (first mount
 * AND every later `switchToClip` call), not only the very first crossfade.
 */
export function resetToRestPoseIfNotDriven(
  bones: {
    spine: THREE.Object3D | null;
    chest: THREE.Object3D | null;
    hips: THREE.Object3D | null;
  },
  restPose: RestPoseAnchor | null,
  isBaseActionDriving: boolean,
): void {
  if (isBaseActionDriving || !restPose) return;
  bones.spine?.quaternion.copy(restPose.spine);
  bones.chest?.quaternion.copy(restPose.chest);
  bones.hips?.quaternion.copy(restPose.hips);
}

/**
 * Per-status naming convention: when a chatStatus has an entry here and
 * `availableNames` contains a clip matching its pattern, that clip is
 * preferred over the manually-set `currentAnimation`. Statuses without an
 * entry (`ready`) always fall through to `currentAnimation`/first-available.
 *
 * This is timer-free and clip-set-agnostic — a clip set with conventionally
 * named files (e.g. containing "listen", "think", "welcome"/"greet",
 * "stop"/"bye") auto-wires for that status with zero further code changes,
 * the same mechanism `speaking` already used before this table existed.
 */
const STATUS_CLIP_PATTERNS: Partial<Record<ChatStatus, RegExp>> = {
  // "taking" is a documented one-off accommodation for the bundled GLB
  // placeholder clip `happy.glb`'s "State 4 Taking (loop)" (spelled "Taking",
  // not "Talking" — RESEARCH Pitfall 2), so it resolves as the speaking base
  // clip until a correctly-named replacement lands (D-01 placeholder asset).
  speaking: /talk|gesture|speak|taking/i,
  listening: /listen/i,
  thinking: /think/i,
  starting: /welcome|greet|hello|intro/i,
  // ready: lets a conventionally-named idle-loop clip (e.g. GLB's
  // "State 1 Idle (loop)") resolve as the moving idle base, instead of a
  // frozen "Pose", so IDLE-01's breathing/sway layer has motion to compose
  // onto (RESEARCH Pitfall 3). Additive-only: see resolveBaseClip's
  // regression test for why this never overrides an explicit, non-matching
  // app-set currentAnimation.
  ready: /idle|ready|rest/i,
  stopped: /stop|bye|goodbye|outro/i,
};

// TRANS-02 / D-01 / issue #17 (ASSET-01) — stopped-state placeholder decision:
// no bundled clip on EITHER format (VRM or GLB) matches the `stopped` pattern
// above, so this phase does NOT ship a dedicated goodbye clip. Instead,
// `update(delta)` (Task 2) applies a procedural SETTLE cue — the always-on
// idle layer (breathing + sway + expression drift) is damped toward
// stillness for the duration of the `stopped` crossfade floor, producing a
// "settling to rest" read that is distinct from the live breathing idle base
// on both formats without depending on a dedicated asset. `stopped`'s entry
// in STATUS_CLIP_PATTERNS above is left unchanged (harmless/forward-
// compatible): if a consumer later loads a conventionally-named goodbye
// clip, it still auto-resolves and the settle layers on top of it. This is a
// placeholder per D-01, not a scope reduction — the real clip is tracked in
// issue #17.

/**
 * Pure function mapping the current chatStatus + manual `animate()` override
 * to a target base-clip name.
 *
 * Looks up `chatStatus` in `STATUS_CLIP_PATTERNS`; if a pattern exists and a
 * clip in `availableNames` matches it, that clip wins. Otherwise (no pattern
 * for this status, or no matching clip name) falls back to the manually-set
 * `currentAnimation`, then the first available clip, then null.
 *
 * Phase 11 (TRANS-01/02, TALK-01/02) still owns the richer systems this
 * table does not attempt: loop-boundary-driven cycling, minimum-duration
 * enforcement for starting/stopped, and multiple talk-clip variants — this
 * is naming-convention resolution only, not those systems.
 */
export function resolveBaseClip(
  chatStatus: ChatStatus,
  currentAnimation: string | null,
  availableNames: string[],
): string | null {
  const pattern = STATUS_CLIP_PATTERNS[chatStatus];
  if (pattern) {
    const match = availableNames.find((name) => pattern.test(name));
    if (match) return match;
  }
  return currentAnimation ?? availableNames[0] ?? null;
}

/**
 * 11-13 gap-closure fix (G1 pre-connect T-pose / G3 Y-drop-on-connect — see
 * the file-header 11-13 diagnosis block). Pure decision: should
 * `switchToClip(targetName)` (re-)run right now? Centralizes the FULL
 * "should switchToClip run" decision — including the TALK-01/TRANS-01
 * speaking-variant ownership guard — so the crossfade-trigger `useEffect`
 * AND `update()`'s per-frame retry (added below to close G1) call the
 * EXACT SAME logic. This is deliberately not duplicated inline in two
 * places: a hand-rolled test-only replay of "what the effect does" could
 * silently diverge from what the real hook does — which is exactly how a
 * wrong G1 fix could pass its own test while the live app stayed broken
 * (the failure mode 11-12's human re-check exposed for 11-11's fix, and
 * 11-10's before it). Exported and pure so it is unit-testable without
 * rendering a React component or scene — see `AnimationStateEngine.test.ts`.
 *
 * Returns `false` when: `targetName` is null; `targetName` already matches
 * `currentClipName` (already showing this clip — nothing to do);
 * `canResolveAction` or `canResolveRoot` is false (clips/root not yet
 * resolvable — the exact case that silently stalled G1 before this fix,
 * since neither `targetName` nor `chatStatus` change once they DO become
 * resolvable, so a plain `useEffect` alone never gets a chance to re-fire);
 * or the speaking-variant ownership guard applies (while `speaking`,
 * `talkCycle` inside `update()` is the SOLE owner of which talk variant is
 * showing — re-asserting `resolveBaseClip`'s always-first-matched speaking
 * clip here would fight an already-advanced variant, the bug reported in
 * 11-06/TALK-01).
 */
export function shouldTriggerClipSwitch(params: {
  targetName: string | null;
  chatStatus: ChatStatus;
  currentClipName: string | null;
  canResolveAction: boolean;
  canResolveRoot: boolean;
}): boolean {
  const { targetName, chatStatus, currentClipName, canResolveAction, canResolveRoot } = params;
  if (!targetName) return false;
  if (targetName === currentClipName) return false;
  if (!canResolveAction || !canResolveRoot) return false;
  if (
    chatStatus === "speaking" &&
    currentClipName !== null &&
    STATUS_CLIP_PATTERNS.speaking!.test(currentClipName)
  ) {
    return false;
  }
  return true;
}

/**
 * T-pose/bind-pose snap fix, part 2 (orphaned-action leg — see
 * crossfade.ts's `beginCrossfade` doc comment for part 1, and
 * .planning/debug/tpose-snap-speak-toggle.md for the full diagnosis). Pure
 * decision: when a new `switchToClip(toAction)` call is about to interrupt
 * an already-active `prevBlend` (i.e. start a fresh `beginCrossfade` before
 * `prevBlend` reached `t>=1`), which action — if any — is about to become
 * orphaned and should be explicitly `.stop()`-ed right now?
 *
 * Only `prevBlend.from` can be orphaned by an interruption: the new blend's
 * `from` argument is always `currentActionRef.current`, which is
 * `prevBlend.to` (the previous blend's incoming leg) — so `prevBlend.to` is
 * always carried forward into the new blend and never orphaned.
 * `prevBlend.from`, however, is referenced by NO BlendState going forward
 * unless the new switch happens to target that exact same clip again (i.e.
 * `toAction === prevBlend.from` — toggling back to the clip that was
 * fading out). In every other case, `prevBlend.from` would otherwise keep
 * whatever weight it last had via `setEffectiveWeight` (from `prevBlend`'s
 * last `stepCrossfade` call) and keep contributing to the mixer forever —
 * `stepCrossfade` only ever stops `blend.from` at natural completion
 * (`t>=1`), which an interrupted blend never reaches. This matters most for
 * 3+-deep interruption chains (e.g. idle -> talking -> talking1 ->
 * [interrupted back to idle]), where plain "talking" (blend2's `from`) is
 * the orphan — `beginCrossfade`'s own toStartWeight/fromStartWeight seeding
 * (part 1 of this fix) only ever inspects the TWO actions directly involved
 * in the NEW blend, so it cannot on its own account for a THIRD, no-longer-
 * referenced action left over from an earlier interruption.
 *
 * Exported and pure so it is unit-testable without rendering a React
 * component or scene, mirroring `shouldTriggerClipSwitch`'s own testability
 * pattern — see `AnimationStateEngine.test.ts`.
 */
export function resolveOrphanedBlendAction(
  prevBlend: BlendState,
  toAction: THREE.AnimationAction,
): THREE.AnimationAction | null {
  if (!prevBlend.active || !prevBlend.from) return null;
  if (prevBlend.from === toAction) return null;
  return prevBlend.from;
}

/**
 * Drives one avatar's animation: on a resolved base-clip target change,
 * starts an eased, pose-gap-adaptive crossfade via `beginCrossfade`/
 * `stepCrossfade` (never a live-clock timer); on every `update(delta)` call,
 * advances that crossfade and steps the blink procedural delta.
 *
 * Frame-ordering contract (RESEARCH Pitfall 6) — this hook does NOT call
 * `mixer.update(delta)`: mixer ownership stays with the component (VRM
 * explicitly via `mixerRef.current.update(delta)`, GLB implicitly via
 * drei). The expected per-frame order is:
 *   mixer.update(delta) -> controller.update(delta) -> vrm.update(delta)
 * This keeps an obvious insertion point for Phase 11's additive bone-delta
 * layer, which will run alongside the crossfade ramp/blink step inside
 * `update(delta)`.
 */
export function useAnimationController(params: {
  adapter: AvatarFormatAdapter;
  chatStatus: ChatStatus;
  currentAnimation: string | null;
  availableNames: string[];
  getAction: (name: string) => THREE.AnimationAction | null;
  /** The animated-bones root passed to beginCrossfade/computePoseGapAngle (VRM: scene; GLB: groupRef.current). */
  getRoot: () => THREE.Object3D | null;
  enableBlinking: boolean;
  /** Live TTS playback volume (0-1), from useKhavee(). Scales speaking-only procedural amplitude (TALK-02); undefined/omitted is treated as 0 (neutral). */
  currentVolume?: number;
  /**
   * GLB opt-in (11-17, OPEN ISSUE 2): when true, procedural breathing/sway
   * are disabled while a manually-selected non-idle clip is the active base
   * (see `shouldDisableProceduralForManualClip`). VRM omits this (default
   * false) so its approved idle behavior is untouched.
   */
  dampProceduralOnManualClip?: boolean;
  /**
   * The R3F active scene camera (D-04, e.g. `useThree().camera` or
   * `useFrame`'s first-argument `state.camera`), threaded through so
   * camera-relative gaze (GAZE-01) has a moving reference to track. Optional
   * — omitted/null is a full no-op for gaze's camera mode (see gaze.ts).
   */
  camera?: THREE.Camera | null;
  /**
   * The latest gesture hint from `useKhavee()` (GEST-01/02), typically
   * written by an LLM tool's `execute` callback via the public
   * `setGestureHint` (see `KhaveeProvider.tsx`). Optional — omitted/null/
   * "none" is a no-op for gesture (see gesture.ts).
   */
  gestureHint?: GestureHint;
  /**
   * Called exactly once, the frame a queued/immediate gesture pulse actually
   * begins — wired by the avatar component to `() => setGestureHint(null)`
   * so the consumed hint is cleared and cannot re-trigger.
   */
  onGestureConsumed?: () => void;
}): { update: (delta: number) => void } {
  const {
    adapter,
    chatStatus,
    currentAnimation,
    availableNames,
    getAction,
    getRoot,
    enableBlinking,
    currentVolume,
    dampProceduralOnManualClip,
    camera,
    gestureHint,
    onGestureConsumed,
  } = params;

  const blink = useBlink();
  const breathing = useBreathing();
  const sway = useSway();
  const expressionDrift = useExpressionDrift();
  const talkCycle = useTalkCycle();
  const gaze = useGaze();
  const gesture = useGesture();

  // Never useState — mutated every frame (blendRef via stepCrossfade) or on
  // every base-clip change (currentActionRef/currentClipNameRef), neither
  // of which should trigger a React re-render (see the codebase-wide
  // useRef-for-per-frame-state convention documented in blink.ts).
  const blendRef = useRef<BlendState>({
    active: false,
    from: null,
    to: null,
    startTime: 0,
    duration: 0,
    fromStartWeight: 0,
    toStartWeight: 0,
  });
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentClipNameRef = useRef<string | null>(null);
  // TRANS-02 eased settle ramp state — never useState, mutated every frame
  // in update() step 3 (same per-frame-state convention as the refs above).
  // `current` is the live eased value consumed as settleScale; `from`/
  // `target` capture the ramp's endpoints; `elapsed` accumulates seconds
  // since the ramp's current leg (toward `target`) began.
  const settleRampRef = useRef({ current: 1, from: 1, target: 1, elapsed: 0 });
  // 11-11 gap closure — captured once, lazily, the first frame spine/chest/
  // hips are resolvable (before any procedural write has ever touched
  // them). See `resetToRestPoseIfNotDriven` and the file-header 11-11
  // diagnosis block.
  const restPoseRef = useRef<RestPoseAnchor | null>(null);
  // 11-11 GATE_DEBUG bookkeeping only — accumulates seconds since the last
  // debug log so it fires at most once per second per instance. Inert (never
  // read) when GATE_DEBUG is false.
  const gateDebugElapsedRef = useRef(0);

  const targetName = resolveBaseClip(chatStatus, currentAnimation, availableNames);

  // Single-owner crossfade-trigger helper: starts (or no-ops on) a
  // pose-gap-adaptive crossfade to the clip named `name` and updates
  // currentActionRef/currentClipNameRef/blendRef. Reused by BOTH the
  // chatStatus-driven effect below AND the talk-cycle variant switch inside
  // `update()`, so blend state has exactly one writer regardless of which
  // system triggered the switch.
  function switchToClip(name: string): void {
    const toAction = getAction(name);
    if (!toAction) return;
    if (toAction === currentActionRef.current) return; // already showing this clip, nothing to do

    const root = getRoot();
    if (!root) return;

    // T-pose/bind-pose snap fix, part 2 — see resolveOrphanedBlendAction's
    // doc comment for the full mechanism (and crossfade.ts's beginCrossfade
    // doc comment for part 1).
    resolveOrphanedBlendAction(blendRef.current, toAction)?.stop();

    // TRANS-01/02: starting/stopped get a ~1.2s minimum-duration floor on
    // top of the 0.3-0.9s pose-gap-adaptive range, so the transition into/
    // out of a session always reads as a deliberate moment rather than a
    // snap-fast pose-gap-driven blend (1.2s sits within the locked
    // 1.0-1.5s range). Talk-cycle-triggered switches (chatStatus ===
    // "speaking") never hit this branch, so they use the normal 0.3-0.9s
    // pose-gap-adaptive range like any other clip switch.
    const floor = chatStatus === "starting" || chatStatus === "stopped" ? 1.2 : undefined;

    blendRef.current = beginCrossfade(currentActionRef.current, toAction, root, floor);
    currentActionRef.current = toAction;
    currentClipNameRef.current = name;
  }

  // 11-13 gap-closure fix (G1/G3 — see the file-header 11-13 diagnosis
  // block): the "should switchToClip run" decision (including the
  // TALK-01/TRANS-01 speaking-variant ownership guard, previously inlined
  // here) now lives in the exported, pure `shouldTriggerClipSwitch`, so
  // this effect AND `update()`'s per-frame retry below call the exact same
  // logic. This effect alone is NOT sufficient to fix G1: its `[targetName,
  // chatStatus]` deps give it exactly one run in the pre-connect state, and
  // if clips/root are not yet resolvable at that moment (VRM/animations
  // still loading — see `useLoadVRM`'s async, non-suspending parse in
  // VRMAvatar.tsx), neither value changes again before Connect is pressed,
  // so this effect never gets a chance to re-fire. `update()`'s step 0
  // retry (below) is what actually closes that gap; this effect remains
  // for the ordinary chatStatus/targetName-change-driven case (Connect,
  // status transitions, `animate()` calls).
  useEffect(() => {
    if (
      shouldTriggerClipSwitch({
        targetName,
        chatStatus,
        currentClipName: currentClipNameRef.current,
        canResolveAction: targetName ? !!getAction(targetName) : false,
        canResolveRoot: !!getRoot(),
      })
    ) {
      switchToClip(targetName!);
    }
    // getRoot/getAction intentionally omitted from deps: they're stable
    // per-render accessor closures (memoized via useCallback in both
    // VRMAvatar/GLBAvatar as of Task 1's part C), not values whose identity
    // should retrigger a crossfade on their own. Including `getAction` here
    // previously caused this effect to re-fire on every render where its
    // closure identity changed (frequent during speaking, since
    // `currentVolume` updates every volume tick) even though `targetName`
    // and `chatStatus` hadn't changed — the root cause of TALK-01/TRANS-01's
    // double-trigger/snap-back. switchToClip is recreated every render
    // (closing over the latest chatStatus/getAction/getRoot) and is called
    // directly, not depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetName, chatStatus]);

  function update(delta: number): void {
    // PERF-01 fixed, documented composition order — every system below runs
    // every frame, in this exact order:
    //   1. crossfade ramp -> 2. blink -> 3. amplitude/settle scale compute
    //   -> 4a. lazily capture rest-pose anchor -> 4b. reset-if-not-driven
    //   -> 4c. capture spine base -> 5. breathing -> 6. sway -> 7. spine
    //   clamp -> 8. expression drift -> 9. talk-cycle -> 10. gaze ->
    //   11. gesture.
    // Any future addition to this stack should extend this list, not
    // reorder it silently. 11-11: steps 4a-7 now run UNCONDITIONALLY every
    // frame (11-09 previously skipped 4-7 entirely while
    // shouldRunProceduralBoneWrites(currentActionRef.current) was false;
    // 11-11 replaced that whole-block skip with the narrower 4b reset —
    // see the file-header 11-11 diagnosis block for why). 11-13 gap closure
    // added step 0 (below) and refined step 4b's driving check — see the
    // file-header 11-13 diagnosis block. 12-04 appended steps 10 (gaze) and
    // 11 (gesture) after talk-cycle — see their own inline comments below
    // for why gesture composes AFTER gaze (a discrete pulse on top of a
    // continuous camera-relative offset).

    // 0. 11-13 gap closure (G1/G3 fix): retry a pending clip switch every
    // frame, using the SAME `shouldTriggerClipSwitch` decision the effect
    // above calls. `update()` already runs every animation frame regardless
    // of React re-renders (mixer.update -> controller.update -> vrm.update,
    // per the frame-ordering contract above) — this is what actually closes
    // G1: if the effect's single pre-connect run happened while clips/root
    // were not yet resolvable, neither `targetName` nor `chatStatus` change
    // once they DO become resolvable, so the effect itself never gets a
    // chance to re-fire; this per-frame check does, on the very next frame
    // after clips/root resolve. Self-terminating and safe to run
    // unconditionally every frame: once `switchToClip` succeeds,
    // `currentClipNameRef.current` matches `targetName` and
    // `shouldTriggerClipSwitch` returns `false` on every subsequent frame
    // (no repeated re-triggering).
    if (
      shouldTriggerClipSwitch({
        targetName,
        chatStatus,
        currentClipName: currentClipNameRef.current,
        canResolveAction: targetName ? !!getAction(targetName) : false,
        canResolveRoot: !!getRoot(),
      })
    ) {
      switchToClip(targetName!);
    }

    // 1. Advance the in-progress base-clip crossfade, if any (existing).
    if (blendRef.current.active) {
      stepCrossfade(blendRef.current);
    }

    // 2. Blink procedural delta (existing) — expression-only, no bone
    // interaction, so it has no ordering dependency on the bone-writing
    // steps below.
    blink.step(adapter, enableBlinking);

    // 3. TALK-02: amplitudeScale scales procedural amplitude UP while
    // speaking, proportional to live TTS volume; it is exactly 1 (neutral)
    // for every other status. TRANS-02 gap closure (11-07): settleScale
    // damps procedural amplitude DOWN while stopped, producing the settle
    // cue — but now EASES toward its target over SETTLE_RAMP_SECONDS via
    // easeInOutCubic instead of applying an instant binary cut, in BOTH
    // directions (entering `stopped` damps down; leaving it back into any
    // live state ramps back up to full amplitude). This closes the
    // reported TRANS-02 snap (entering `stopped`) and smooths the
    // corresponding TRANS-01 amplitude jump when leaving it. `speaking` and
    // `stopped` are mutually exclusive ChatStatus values, so amplitudeScale
    // and settleScale never both deviate from 1 in the same frame —
    // multiplying them is always equivalent to whichever one is currently
    // active (or 1 * 1 = 1 the rest of the time).
    const settleTarget = chatStatus === "stopped" ? SETTLE_SCALE : 1;
    const ramp = settleRampRef.current;
    if (settleTarget !== ramp.target) {
      ramp.from = ramp.current;
      ramp.target = settleTarget;
      ramp.elapsed = 0;
    }
    ramp.elapsed += delta;
    const rampT = Math.min(ramp.elapsed / SETTLE_RAMP_SECONDS, 1);
    ramp.current = ramp.from + (ramp.target - ramp.from) * easeInOutCubic(rampT);

    const amplitudeScale = volumeToAmplitudeScale(currentVolume ?? 0, chatStatus);
    const settleScale = ramp.current;
    // 11-17 gap closure (OPEN ISSUE 2): on GLB, fully disable procedural
    // body motion (breathing+sway) while a manually-selected non-idle clip
    // is the active base — see `shouldDisableProceduralForManualClip`'s
    // doc comment for the full decision table. VRM never opts in
    // (dampProceduralOnManualClip is omitted there), so this is always
    // false on that path and proceduralScale is unaffected.
    const disableForManualClip = shouldDisableProceduralForManualClip({
      enabled: dampProceduralOnManualClip ?? false,
      chatStatus,
      currentAnimation,
      activeClipName: currentClipNameRef.current,
    });
    const proceduralScale = disableForManualClip
      ? MANUAL_CLIP_PROCEDURAL_SCALE
      : amplitudeScale * settleScale;

    // 4-7. 11-11 gap closure (G1 T-pose-on-load / G2 idle->talking snap —
    // see the file-header 11-11 diagnosis block): unlike 11-09's approach
    // (skip this whole block while shouldRunProceduralBoneWrites is
    // false), the spine-base-capture/breathing/sway/spine-clamp block below
    // now runs UNCONDITIONALLY every frame. Instead, step 4a resets
    // spine/chest/hips to a captured, FIXED rest-pose anchor whenever the
    // base action is not yet meaningfully driving the skeleton
    // (near-zero-weight window — first mount OR any later switchToClip
    // call, confirmed via 11-11's headless diagnostic to recur on every
    // switch, not just the first). Resetting to the SAME anchor every frame
    // (rather than skipping entirely) keeps breathing/sway producing
    // visible, bounded idle motion instead of a frozen hold, without
    // reintroducing the 11-09 compounding bug — see
    // `resetToRestPoseIfNotDriven`'s doc comment for why this bounds
    // accumulation identically to 11-09's fix. Blink (step 2, above) and
    // expression drift (step 8, below) remain unaffected either way — they
    // are manager-scalar writes, not accumulating bone quaternions.
    const spine = adapter.getHumanoidBoneNode("spine");
    const chest = adapter.getHumanoidBoneNode("chest");
    const hips = adapter.getHumanoidBoneNode("hips");

    // 4a. Lazily capture the rest-pose anchor once, the first frame all
    // three bones are resolvable — i.e. before any procedural write has
    // ever touched them (on the very first update() call, the base action
    // either doesn't exist yet or is at weight 0, so the bones are still
    // exactly at their true bind pose).
    if (!restPoseRef.current && spine && chest && hips) {
      restPoseRef.current = {
        spine: spine.quaternion.clone(),
        chest: chest.quaternion.clone(),
        hips: hips.quaternion.clone(),
      };
    }

    // 4b. Reset to the anchor while the base action isn't driving the
    // skeleton this frame; no-ops once it is (the mixer already wrote the
    // correct pose this frame, matching 11-09's steady-state behavior).
    // 11-13 gap closure (G4 fix — see the file-header 11-13 diagnosis
    // block): `isBaseActionMeaningfullyDriving` also treats a real, non-null
    // `blendRef.current.from` (the OUTGOING action in an active crossfade)
    // as driving, not just the incoming action's own ramped-up weight. This
    // distinguishes the true first-mount case (`from` is always null there)
    // from a real two-action crossfade (idle->talking, talking->talking1,
    // etc.), where the mixer's own blend already produces a continuous,
    // non-frozen pose and resetting to the stale fixed anchor instead
    // snapped the torso away from that live blend — the G4 jiggle.
    const baseActionDriving = isBaseActionMeaningfullyDriving(
      currentActionRef.current,
      blendRef.current.from,
    );
    resetToRestPoseIfNotDriven({ spine, chest, hips }, restPoseRef.current, baseActionDriving);

    // 11-11 dev-only diagnostic (off by default — see GATE_DEBUG above):
    // logs at most once per second per instance so a human re-verifying
    // G1/G2 live can cross-check the same gate/weight/clip/spine-angle data
    // this gap-closure pass's diagnosis used, directly in devtools.
    if (GATE_DEBUG) {
      gateDebugElapsedRef.current += delta;
      if (gateDebugElapsedRef.current >= 1) {
        gateDebugElapsedRef.current = 0;
        const identity = new THREE.Quaternion();
        // eslint-disable-next-line no-console
        console.debug("[AnimationStateEngine] gate diagnostic", {
          currentClipName: currentClipNameRef.current,
          effectiveWeight: currentActionRef.current?.getEffectiveWeight() ?? null,
          baseActionDriving,
          spineAngleFromIdentity: spine ? spine.quaternion.angleTo(identity) : null,
        });
      }
    }

    // 4c. Capture the spine bone's orientation BEFORE any procedural write
    // this frame (i.e. after the mixer/crossfade/blink steps above, and
    // the 4a-4b reset, have already run, but before breathing/sway touch
    // it) — this is the base the PERF-01 clamp measures the COMBINED
    // breathing+sway delta against.
    if (spine) {
      _spineBaseScratch.copy(spine.quaternion);
    }

    // 5. Breathing writes its additive delta to chest+spine first...
    breathing.step(adapter, delta, proceduralScale);
    // 6. ...then sway composes on top via its own multiply() (never
    // .set()), so sway's delta layers onto breathing's already-written
    // spine orientation rather than the reverse. This is an arbitrary but
    // fixed order (PERF-01 requires *a* documented order, not a specific
    // one) — breathing before sway matches this module's own read order in
    // the interface comment block. 11-17 gap closure: breathing writes
    // chest+spine and sway now ALSO writes spine+chest (upper-body only) —
    // hips is intentionally never written by either system, so leg bones
    // (children of hips) stay static regardless of procedural amplitude.
    sway.step(adapter, delta, proceduralScale);

    // 7. PERF-01 bounded magnitude: clamp the COMBINED breathing+sway
    // delta on the shared spine bone, measured post-composition (not
    // per-system) since it's the one bone both systems write additively
    // to. Clamping post-composition (rather than pre-scaling each system
    // individually) is what actually bounds the worst case — an
    // amplitude-scaled breathing peak and an amplitude-scaled sway peak
    // landing in the same frame's phase.
    if (spine) {
      _spineComposedScratch.copy(spine.quaternion);
      const combinedAngle = _spineBaseScratch.angleTo(_spineComposedScratch);
      if (combinedAngle > MAX_COMBINED_SPINE_DELTA_RAD) {
        const t = MAX_COMBINED_SPINE_DELTA_RAD / combinedAngle;
        // Slerp FROM the captured pre-procedural base TOWARD the composed
        // (breathing+sway) result, capping the net delta at the bound.
        // Writes through two independent scratches (never
        // slerpQuaternions(base, spine.quaternion, t) directly on the
        // live bone) — see the scratch-declaration comment above for why
        // that form would self-corrupt.
        spine.quaternion.copy(_spineBaseScratch).slerp(_spineComposedScratch, t);
      }
    }

    // 8. Expression drift (VRM-only; automatic no-op on GLB via the
    // adapter's null expression manager). TRANS-02 gap closure (11-07):
    // previously hard-gated off entirely while `stopped`; now always runs,
    // passing the same eased `settleScale` ramp the body's breathing/sway
    // consume via `proceduralScale` (step 3 above) as its amplitudeScale.
    // Facial drift now damps/restores with the same eased ~1.2s ramp as the
    // body instead of hard-cutting on/off at the `stopped` boundary.
    expressionDrift.step(adapter, delta, settleScale);

    // 9. Talk-cycle (TALK-01/02): the ONLY place talk variants advance,
    // driven by loop-boundary + dwell floor detection inside talkCycle.ts,
    // never a timer. Deliberately NOT gated on proceduralScale/
    // amplitudeScale — audio only scales procedural amplitude (step 3
    // above), never clip selection.
    const speakingVariants = availableNames.filter((name) =>
      STATUS_CLIP_PATTERNS.speaking!.test(name),
    );
    const nextVariant = talkCycle.step({
      chatStatus,
      currentAction: currentActionRef.current,
      currentClipName: currentClipNameRef.current,
      speakingVariants,
      delta,
    });
    if (nextVariant) {
      switchToClip(nextVariant);
    }

    // 10. Gaze (GAZE-01/02): continuous, camera-relative head tracking
    // (ready/listening/speaking), fixed aversion (thinking), full no-op
    // (starting/stopped) — see gaze.ts's own per-state branch. Composes
    // additively on top of the mixer/breathing/sway/talk-cycle writes above
    // via its own multiply(), targeting only the head bone — breathing/sway
    // (steps 5-6) target spine/chest, so there is no bone overlap and no
    // additional clamp interaction is expected between gaze and the spine
    // clamp (step 7). No-ops internally (gaze.ts) when no camera is
    // supplied for camera mode, but the `if (camera)` guard here also
    // short-circuits the call entirely when the consumer never threads a
    // camera through (e.g. a controller instance not yet wired to R3F).
    if (camera) gaze.step(adapter, camera, chatStatus, delta);

    // 11. Gesture (GEST-01/02): a discrete, triggered one-shot pulse
    // (nod/shake) that composes ON TOP of gaze's continuous offset — this is
    // why gesture is step 11, after gaze. Immediate outside `speaking`;
    // queued to the next talk-cycle loop boundary while `speaking` (D-06) —
    // see gesture.ts's own trigger logic. `onConsume` fires exactly once,
    // the frame the pulse begins, wired to clear the consumed hint via
    // `onGestureConsumed` so it cannot re-trigger.
    gesture.step({
      adapter,
      chatStatus,
      gestureHint: gestureHint ?? null,
      currentAction: currentActionRef.current,
      delta,
      onConsume: () => onGestureConsumed?.(),
    });
  }

  return { update };
}
