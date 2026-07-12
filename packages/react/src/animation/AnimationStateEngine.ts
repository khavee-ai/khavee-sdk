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
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ChatStatus } from "@khaveeai/core";
import { beginCrossfade, stepCrossfade, type BlendState } from "./crossfade";
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
    //   -> 4. capture spine base -> 5. breathing -> 6. sway -> 7. spine
    //   clamp -> 8. expression drift -> 9. talk-cycle.
    // Any future addition to this stack should extend this list, not
    // reorder it silently.

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
    // for every other status. TRANS-02 (D-01 placeholder): settleScale
    // damps procedural amplitude DOWN while stopped, producing the settle
    // cue. `speaking` and `stopped` are mutually exclusive ChatStatus
    // values, so amplitudeScale and settleScale never both deviate from 1
    // in the same frame — multiplying them is always equivalent to
    // whichever one is currently active (or 1 * 1 = 1 the rest of the
    // time).
    const amplitudeScale = volumeToAmplitudeScale(currentVolume ?? 0, chatStatus);
    const settleScale = chatStatus === "stopped" ? SETTLE_SCALE : 1;
    const proceduralScale = amplitudeScale * settleScale;

    // 4. Capture the spine bone's orientation BEFORE any procedural write
    // this frame (i.e. after the mixer/crossfade/blink steps above have
    // already run, but before breathing/sway touch it) — this is the base
    // the PERF-01 clamp measures the COMBINED breathing+sway delta against.
    const spine = adapter.getHumanoidBoneNode("spine");
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

    // 7. PERF-01 bounded magnitude: clamp the COMBINED breathing+sway delta
    // on the shared spine bone, measured post-composition (not per-system)
    // since it's the one bone both systems write additively to. Clamping
    // post-composition (rather than pre-scaling each system individually)
    // is what actually bounds the worst case — an amplitude-scaled
    // breathing peak and an amplitude-scaled sway peak landing in the same
    // frame's phase.
    if (spine) {
      _spineComposedScratch.copy(spine.quaternion);
      const combinedAngle = _spineBaseScratch.angleTo(_spineComposedScratch);
      if (combinedAngle > MAX_COMBINED_SPINE_DELTA_RAD) {
        const t = MAX_COMBINED_SPINE_DELTA_RAD / combinedAngle;
        // Slerp FROM the captured pre-procedural base TOWARD the composed
        // (breathing+sway) result, capping the net delta at the bound.
        // Writes through two independent scratches (never
        // slerpQuaternions(base, spine.quaternion, t) directly on the live
        // bone) — see the scratch-declaration comment above for why that
        // form would self-corrupt.
        spine.quaternion.copy(_spineBaseScratch).slerp(_spineComposedScratch, t);
      }
    }

    // 8. Expression drift (VRM-only; automatic no-op on GLB via the
    // adapter's null expression manager). Skipped entirely while
    // `stopped` — this is the facial half of the TRANS-02 settle cue:
    // rest-state facial "life" pauses along with the damped body motion
    // above, rather than being separately scaled.
    if (chatStatus !== "stopped") {
      expressionDrift.step(adapter, delta);
    }

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
