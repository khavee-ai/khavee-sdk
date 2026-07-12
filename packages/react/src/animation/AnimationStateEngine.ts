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
import type { AvatarFormatAdapter } from "./types";

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

  useEffect(() => {
    const toAction = targetName ? getAction(targetName) : null;
    if (!targetName || !toAction) return;
    if (toAction === currentActionRef.current) return; // already showing this clip, nothing to do

    const root = getRoot();
    if (!root) return;

    // TRANS-01/02: starting/stopped get a ~1.2s minimum-duration floor on
    // top of the 0.3-0.9s pose-gap-adaptive range, so the transition into/
    // out of a session always reads as a deliberate moment rather than a
    // snap-fast pose-gap-driven blend (1.2s sits within the locked
    // 1.0-1.5s range).
    const floor = chatStatus === "starting" || chatStatus === "stopped" ? 1.2 : undefined;

    blendRef.current = beginCrossfade(currentActionRef.current, toAction, root, floor);
    currentActionRef.current = toAction;
    currentClipNameRef.current = targetName;
    // getRoot intentionally omitted from deps: it's a stable per-render
    // accessor closure, not a value whose identity should retrigger a
    // crossfade on its own (matches getAction's role as an accessor too).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetName, getAction, chatStatus]);

  function update(delta: number): void {
    if (blendRef.current.active) {
      stepCrossfade(blendRef.current);
    }
    blink.step(adapter, enableBlinking);
  }

  return { update };
}
