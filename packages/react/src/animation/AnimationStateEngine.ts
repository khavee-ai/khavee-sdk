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
 * Pure function mapping the current chatStatus + manual `animate()` override
 * to a target base-clip name.
 *
 * This phase's mapping is deliberately minimal and timer-free: `speaking`
 * prefers a talk/gesture/speak-named clip when one is available in
 * `availableNames`; every other status (and the `speaking` fallback when no
 * talk clip exists) simply returns the manually-set `currentAnimation`,
 * falling back to the first available clip, then null.
 *
 * Phase 11 (TRANS-01/02, TALK-01/02) extends this with real per-state clip
 * tables, dedicated greeting/goodbye clips, 2+ talk variants, and loop-
 * boundary-driven cycling — none of that richness is built here.
 */
export function resolveBaseClip(
  chatStatus: ChatStatus,
  currentAnimation: string | null,
  availableNames: string[],
): string | null {
  if (chatStatus === "speaking") {
    const talkClip = availableNames.find((name) => /talk|gesture|speak/i.test(name));
    if (talkClip) return talkClip;
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
}): { update: (delta: number) => void } {
  const { adapter, chatStatus, currentAnimation, availableNames, getAction, getRoot, enableBlinking } = params;

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

    blendRef.current = beginCrossfade(currentActionRef.current, toAction, root);
    currentActionRef.current = toAction;
    currentClipNameRef.current = targetName;
    // getRoot intentionally omitted from deps: it's a stable per-render
    // accessor closure, not a value whose identity should retrigger a
    // crossfade on its own (matches getAction's role as an accessor too).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetName, getAction]);

  function update(delta: number): void {
    if (blendRef.current.active) {
      stepCrossfade(blendRef.current);
    }
    blink.step(adapter, enableBlinking);
  }

  return { update };
}
