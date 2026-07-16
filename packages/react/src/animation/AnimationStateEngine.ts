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
  } = params;

  const blink = useBlink();
  const breathing = useBreathing();
  const sway = useSway();
  const expressionDrift = useExpressionDrift();
  const talkCycle = useTalkCycle();

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

  useEffect(() => {
    if (!targetName) return;

    // TALK-01/TRANS-01 speaking-variant ownership guard: while `speaking`,
    // `talkCycle` (inside `update()`, step 9) is the SOLE owner of which
    // talk variant is showing, driven by loop-boundary + dwell detection.
    // `resolveBaseClip` always resolves the FIRST speaking-matched clip via
    // `.find()` (RESEARCH Pitfall 4), so if this effect re-fires mid-speech
    // (e.g. from a `currentVolume` tick re-render) and re-asserts that first
    // clip, it fights talkCycle's already-advanced variant and snaps back to
    // variant 1 — the bug reported in 11-06 (TALK-01). Guard: if we're
    // already showing a speaking-matched clip while `speaking`, this effect
    // has nothing useful to do — return without switching. The initial
    // idle -> speaking switch is unaffected: at that moment
    // currentClipNameRef.current still points at the idle/base clip, not a
    // speaking variant, so the guard passes through and the first talk clip
    // is selected normally.
    if (
      chatStatus === "speaking" &&
      currentClipNameRef.current !== null &&
      STATUS_CLIP_PATTERNS.speaking!.test(currentClipNameRef.current)
    ) {
      return;
    }

    switchToClip(targetName);
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
    //   clamp -> 8. expression drift -> 9. talk-cycle.
    // Any future addition to this stack should extend this list, not
    // reorder it silently. 11-11: steps 4a-7 now run UNCONDITIONALLY every
    // frame (11-09 previously skipped 4-7 entirely while
    // shouldRunProceduralBoneWrites(currentActionRef.current) was false;
    // 11-11 replaced that whole-block skip with the narrower 4b reset —
    // see the file-header 11-11 diagnosis block for why).

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
    const proceduralScale = amplitudeScale * settleScale;

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
    const baseActionDriving = shouldRunProceduralBoneWrites(currentActionRef.current);
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
    // the interface comment block and keeps chest-first, hips-second
    // grouped with their driving systems.
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
  }

  return { update };
}
