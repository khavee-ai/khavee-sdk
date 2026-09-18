/**
 * talkCycle.ts — loop-completion-driven status clip cycler (TALK-01,
 * generalized by 260918-gzb from a speaking-only variant selector into a
 * cycler covering every "cycling" chatStatus: ready, listening, thinking,
 * and speaking).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * `resolveBaseClip` (AnimationStateEngine.ts) always resolves the FIRST
 * matching clip for the current status via `.find()` — it never cycles
 * across multiple clips that share a status's naming pattern (RESEARCH
 * Pitfall 4). This module is the decision function that names the NEXT
 * variant to switch to; the controller in AnimationStateEngine.ts is the one
 * that actually calls `beginCrossfade` with that name.
 *
 * Deliberately timer-free: switching is driven by (a) detecting that the
 * currently-playing action has crossed a loop-completion boundary — read
 * from `action.time` vs `action.getClip().duration`, never a live clock —
 * and (b) a minimum dwell floor accumulated from the same per-frame `delta`
 * every other procedural system uses. This intentionally avoids reintroducing
 * the anti-pattern removed in Phase 10: GLBAvatar's old wall-clock-timeout-
 * driven (3000 + random 0-2000 ms) talking loop-back, which switched clips
 * on a fixed wall-clock interval with no relationship to where the
 * currently-playing clip actually was in its loop.
 *
 * All state (dwell accumulator, previous action time for wrap detection,
 * last-seen status) is pure/explicit in `ClipCycleState`, so the state
 * machine itself (`stepClipCycle`) is testable without React. `useClipCycle()`
 * is a thin ref-backed wrapper around it (never React render state — this is
 * per-frame mutated state that must never trigger a re-render).
 */

import { useRef } from "react";
import type * as THREE from "three";
import type { ChatStatus } from "@khaveeai/core";

/** Minimum time a clip must remain active before it may be swapped, in seconds. This is the default for the `animationMinDwellSeconds` prop and applies to every cycling status (ready/listening/thinking/speaking). */
export const MIN_TALK_DWELL_SECONDS = 2.0;

/**
 * The chatStatus values whose base clip is eligible to cycle across multiple
 * matching clips. `starting` and `stopped` are deliberately excluded — they
 * are one-shot transitions, not steady states a user lingers in, so they
 * never cycle.
 */
export const CYCLING_STATUSES: readonly ChatStatus[] = ["ready", "listening", "thinking", "speaking"];

/** How the cycler picks the next clip when a status has 2+ matching clips. */
export type AnimationCycleOrder = "random" | "sequential";

/** Explicit, ref-held state for one avatar's clip-cycle instance. */
export interface ClipCycleState {
  /** Seconds accumulated since the last variant switch (or since the current cycling status began). */
  dwellSeconds: number;
  /** `currentAction.time` observed on the previous step call, used to detect a loop wrap/crossing. Null until the first primed frame. */
  prevActionTime: number | null;
  /** The chatStatus observed on the previous step call, used to detect a cycling-to-cycling status change so dwell/prevActionTime can be reset. Null until the first step call. */
  lastStatus: ChatStatus | null;
}

export function createClipCycleState(): ClipCycleState {
  return { dwellSeconds: 0, prevActionTime: null, lastStatus: null };
}

export interface ClipCycleStepParams {
  chatStatus: ChatStatus;
  currentAction: THREE.AnimationAction | null;
  currentClipName: string | null;
  /** The clips matching the CURRENT status's pattern, filtered by the caller. */
  variants: string[];
  delta: number;
  /** Sequential keeps round-robin/first-match entry (legacy behavior); random never repeats back-to-back and randomizes entry. Default: "sequential" — the public prop default of "random" is applied by useAnimationController, not here. */
  order?: AnimationCycleOrder;
  /** Minimum seconds a clip plays before the cycle may swap it. Default: MIN_TALK_DWELL_SECONDS. */
  minDwellSeconds?: number;
  /** Injectable random source for order "random". Default: Math.random. */
  rng?: () => number;
}

/**
 * Pure round-robin index helper: given the current variant's index within
 * the variant list (-1 if unknown/not found) and the list length, returns
 * the index of the NEXT variant. Always differs from `currentIndex` when
 * `length >= 2` (adding 1 mod length can never land back on the same slot).
 */
export function nextVariantIndex(currentIndex: number, length: number): number {
  if (length <= 0) return 0;
  const normalizedCurrent = currentIndex < 0 ? -1 : currentIndex % length;
  return (normalizedCurrent + 1) % length;
}

/**
 * Pure random index helper: given the current variant's index (-1 if
 * unknown/entering the status fresh) and the list length, returns a random
 * index that is NEVER the current index when `length >= 2`. Draws from the
 * `length - 1` slots that exclude `currentIndex` directly (no retry loop
 * needed): `idx = min(floor(rng() * (length - 1)), length - 2)`, then shifts
 * up by 1 if `idx >= currentIndex` to skip over the excluded slot. With
 * `currentIndex < 0` (no current clip, e.g. entering the status), there is
 * nothing to exclude, so it draws uniformly from the full list instead:
 * `idx = min(floor(rng() * length), length - 1)`. For `length <= 1`, there
 * is nothing to choose between, so it always returns 0.
 */
export function pickRandomVariantIndex(
  currentIndex: number,
  length: number,
  rng: () => number = Math.random,
): number {
  if (length <= 1) return 0;
  if (currentIndex < 0) {
    return Math.min(Math.floor(rng() * length), length - 1);
  }
  const idx = Math.min(Math.floor(rng() * (length - 1)), length - 2);
  return idx >= currentIndex ? idx + 1 : idx;
}

/**
 * Pure loop-boundary detector, shared by both the clip cycler and gesture
 * queuing (GEST-02) so the two consumers can never silently disagree on
 * where a loop boundary is.
 *
 * Returns `false` when there isn't enough information to decide (no current
 * time/duration, non-positive duration, or no previous sample to compare
 * against yet — the very first frame of an action).
 *
 * A boundary is detected when EITHER:
 * - `currentTime` decreased frame-over-frame (a wrap), or
 * - `currentTime` has crossed `duration` without necessarily wrapping (e.g. a
 *   non-looping action clamped at its end) while `prevTime` was still under
 *   `duration`.
 *
 * Comparing against the PREVIOUS frame's time means each boundary fires
 * exactly once per loop, not every frame the clip sits near its end.
 *
 * Callers own tracking/advancing their own `prevTime` each frame — this
 * function only computes the boolean decision, it never mutates state.
 */
export function detectLoopBoundary(
  currentTime: number | null,
  prevTime: number | null,
  duration: number | null,
): boolean {
  if (currentTime === null || duration === null || duration <= 0) return false;
  if (prevTime === null) return false;
  return currentTime < prevTime || (currentTime >= duration && prevTime < duration);
}

/**
 * Advances the clip-cycle state machine by one frame and returns the name
 * of the next clip to switch to, or null if no switch should happen this
 * frame.
 *
 * Mutates `state` in place (dwell accumulator + previous-time/status
 * tracking).
 */
export function stepClipCycle(state: ClipCycleState, params: ClipCycleStepParams): string | null {
  const {
    chatStatus,
    currentAction,
    currentClipName,
    variants,
    delta,
    order = "sequential",
    minDwellSeconds = MIN_TALK_DWELL_SECONDS,
    rng = Math.random,
  } = params;

  if (!CYCLING_STATUSES.includes(chatStatus)) {
    // Reset tracking outside a cycling status so stale dwell/loop data from a
    // previous cycling session can never cause an instant switch the moment
    // a cycling status resumes.
    state.dwellSeconds = 0;
    state.prevActionTime = null;
    state.lastStatus = null;
    return null;
  }

  if (chatStatus !== state.lastStatus) {
    // A cycling-to-cycling status change (e.g. listening -> thinking) must
    // reset dwell/prevActionTime too — otherwise a status swap that happens
    // to land on a value that reads as a loop wrap for the NEW status's
    // clip could switch on its very first frame.
    state.dwellSeconds = 0;
    state.prevActionTime = null;
    state.lastStatus = chatStatus;
  }

  if (variants.length < 2) {
    return null;
  }

  state.dwellSeconds += delta;

  const currentTime = currentAction ? currentAction.time : null;
  const duration = currentAction ? currentAction.getClip().duration : null;

  const loopBoundary = detectLoopBoundary(currentTime, state.prevActionTime, duration);
  if (currentTime !== null && duration !== null && duration > 0) {
    state.prevActionTime = currentTime;
  }

  if (!loopBoundary || state.dwellSeconds < minDwellSeconds) {
    return null;
  }

  const currentIndex = currentClipName ? variants.indexOf(currentClipName) : -1;
  const nextIndex =
    order === "random" ? pickRandomVariantIndex(currentIndex, variants.length, rng) : nextVariantIndex(currentIndex, variants.length);
  state.dwellSeconds = 0;
  return variants[nextIndex];
}

/**
 * Ref-driven clip-cycle hook. Call `useClipCycle()` once per component
 * instance and invoke the returned `step(params)` from inside the same
 * per-frame `update(delta)` call the crossfade/blink systems use.
 */
export function useClipCycle(): { step(params: ClipCycleStepParams): string | null } {
  const stateRef = useRef<ClipCycleState>(createClipCycleState());

  function step(params: ClipCycleStepParams): string | null {
    return stepClipCycle(stateRef.current, params);
  }

  return { step };
}
