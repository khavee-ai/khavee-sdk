/**
 * talkCycle.ts — loop-completion-driven talk-clip variant selector (TALK-01).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * `resolveBaseClip` (AnimationStateEngine.ts) always resolves the FIRST
 * matching `speaking`-named clip via `.find()` — it never cycles across
 * multiple talk variants (RESEARCH Pitfall 4). This module is the decision
 * function that names the NEXT variant to switch to; Plan 05's controller
 * is the one that actually calls `beginCrossfade` with that name.
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
 * All state (dwell accumulator, previous action time for wrap detection) is
 * pure/explicit in `TalkCycleState`, so the state machine itself
 * (`stepTalkCycle`) is testable without React. `useTalkCycle()` is a thin
 * ref-backed wrapper around it (never React render state — this is
 * per-frame mutated state that must never trigger a re-render).
 */

import { useRef } from "react";
import type * as THREE from "three";
import type { ChatStatus } from "@khaveeai/core";

/** Minimum time a talk variant must remain active before it may be swapped, in seconds. */
export const MIN_TALK_DWELL_SECONDS = 2.0;

/** Explicit, ref-held state for one avatar's talk-cycle instance. */
export interface TalkCycleState {
  /** Seconds accumulated since the last variant switch (or since speaking began). */
  dwellSeconds: number;
  /** `currentAction.time` observed on the previous step call, used to detect a loop wrap/crossing. Null until the first speaking frame. */
  prevActionTime: number | null;
}

export function createTalkCycleState(): TalkCycleState {
  return { dwellSeconds: 0, prevActionTime: null };
}

export interface TalkCycleStepParams {
  chatStatus: ChatStatus;
  currentAction: THREE.AnimationAction | null;
  currentClipName: string | null;
  speakingVariants: string[];
  delta: number;
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
 * Advances the talk-cycle state machine by one frame and returns the name
 * of the next talk variant to switch to, or null if no switch should happen
 * this frame.
 *
 * Mutates `state` in place (dwell accumulator + previous-time tracking).
 */
export function stepTalkCycle(state: TalkCycleState, params: TalkCycleStepParams): string | null {
  const { chatStatus, currentAction, currentClipName, speakingVariants, delta } = params;

  if (chatStatus !== "speaking") {
    // Reset tracking outside the talk state so stale dwell/loop data from a
    // previous speaking session can never cause an instant switch the
    // moment speaking resumes.
    state.dwellSeconds = 0;
    state.prevActionTime = null;
    return null;
  }

  if (speakingVariants.length < 2) {
    return null;
  }

  state.dwellSeconds += delta;

  const currentTime = currentAction ? currentAction.time : null;
  const duration = currentAction ? currentAction.getClip().duration : null;

  let loopBoundary = false;
  if (currentTime !== null && duration !== null && duration > 0) {
    if (state.prevActionTime !== null) {
      // A wrap (time decreased frame-over-frame) or a crossing of the clip's
      // duration (without necessarily wrapping, e.g. a non-looping action
      // clamped at its end) both count as one completed loop. Comparing
      // against the PREVIOUS frame's time means each boundary fires exactly
      // once per loop, not every frame the clip sits near its end.
      loopBoundary =
        currentTime < state.prevActionTime ||
        (currentTime >= duration && state.prevActionTime < duration);
    }
    state.prevActionTime = currentTime;
  }

  if (!loopBoundary || state.dwellSeconds < MIN_TALK_DWELL_SECONDS) {
    return null;
  }

  const currentIndex = currentClipName ? speakingVariants.indexOf(currentClipName) : -1;
  const nextIndex = nextVariantIndex(currentIndex, speakingVariants.length);
  state.dwellSeconds = 0;
  return speakingVariants[nextIndex];
}

/**
 * Ref-driven talk-cycle hook. Call `useTalkCycle()` once per component
 * instance and invoke the returned `step(params)` from inside the same
 * per-frame `update(delta)` call the crossfade/blink systems use.
 */
export function useTalkCycle(): { step(params: TalkCycleStepParams): string | null } {
  const stateRef = useRef<TalkCycleState>(createTalkCycleState());

  function step(params: TalkCycleStepParams): string | null {
    return stepTalkCycle(stateRef.current, params);
  }

  return { step };
}
