/**
 * gesture.ts — Triggered, consumed-and-cleared procedural bone-delta pulse
 * for semantic nod/shake gestures (GEST-01, GEST-02).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Unlike `breathing.ts`/`sway.ts` (always-on, continuously oscillating), a
 * gesture is TRIGGERED by an external hint (an LLM tool call, plumbed in
 * through context — see 12-CONTEXT.md's Integration Points) and plays a
 * single bounded one-shot pulse before clearing itself, mirroring
 * `blink.ts`'s triggered sine-pulse envelope shape
 * (`Math.sin(anim * PI)` over an elapsed accumulator) rather than
 * breathing/sway's perpetual sine.
 *
 * Timing rule (D-06 / GEST-02): a gesture must NEVER interrupt a playing
 * talk-cycle clip mid-play.
 * - When `chatStatus !== "speaking"` there is no clip cycle to protect, so
 *   the pulse begins immediately, the same frame the hint arrives (D-06).
 * - When `chatStatus === "speaking"`, the pulse is queued until the
 *   ambient talk-cycle's currently-playing action crosses its next natural
 *   loop boundary — detected via the SAME `detectLoopBoundary` primitive
 *   `talkCycle.ts`'s `stepTalkCycle` uses, so gesture-queuing and talk-cycle
 *   variant-switching can never silently disagree on where a loop boundary
 *   is (RESEARCH mandate: extract-and-reuse, not reimplement). This module
 *   tracks its own `prevActionTime` independently of `talkCycle.ts`'s —
 *   each consumer of `detectLoopBoundary` owns its own previous-time sample.
 *
 * Composition (PERF-01): additive delta-quaternion via
 * `bone.quaternion.multiply(scratch)`, never `.set()` — module-scoped
 * scratch quaternion, reused every step (no per-frame `new`), matching
 * `breathing.ts`'s allocation-reuse precedent.
 */

import { useRef } from "react";
import * as THREE from "three";
import type { ChatStatus } from "@khaveeai/core";
import { detectLoopBoundary } from "./talkCycle";
import type { AvatarFormatAdapter } from "./types";

// Module-scoped scratch quaternion, reused every stepGesture() call across
// every useGesture() instance — never `new` inside the per-frame path.
const _scratchGesture = new THREE.Quaternion();

// nod = a head-PITCH delta (rotation about the lateral/X axis — a "yes" nod).
const NOD_AXIS = new THREE.Vector3(1, 0, 0);
// shake = a head-YAW delta (rotation about the vertical/Y axis — a "no" shake).
const SHAKE_AXIS = new THREE.Vector3(0, 1, 0);

// Bounded pulse magnitude (radians). ~0.25rad ≈ 14 degrees — visibly a
// deliberate nod/shake (larger than breathing's ~0.03rad "alive" idle
// amplitude) while remaining a subtle procedural delta, not a full head turn.
const GESTURE_AMPLITUDE = 0.25;

// Total pulse duration (seconds), rise-then-fall. ~0.5s reads as one
// deliberate nod/shake beat — noticeably longer than blink's ~150ms envelope
// (a much smaller, purely cosmetic motion) since a gesture must be legible
// as an intentional communicative signal.
const GESTURE_DURATION_SECONDS = 0.5;

/** The two gesture kinds this module can play. `"none"`/null/anything else is a no-op. */
export type GestureHint = "nod" | "shake" | "none" | null;

/** Mutable state for one avatar's gesture instance. */
export interface GestureState {
  /** The gesture currently mid-pulse, or null when idle/between pulses. */
  activeGesture: "nod" | "shake" | null;
  /** Seconds elapsed since the current pulse began. Only meaningful while `activeGesture` is set. */
  elapsed: number;
  /** `currentAction.time` observed on the previous step call while speaking, used to detect a loop boundary via `detectLoopBoundary`. Reset to null whenever `chatStatus` is not `"speaking"`. */
  prevActionTime: number | null;
}

export function createGestureState(): GestureState {
  return { activeGesture: null, elapsed: 0, prevActionTime: null };
}

export interface GestureStepParams {
  adapter: AvatarFormatAdapter;
  chatStatus: ChatStatus;
  /** The latest gesture hint from context (e.g. the `set_gesture` tool's `execute` callback). */
  gestureHint: GestureHint;
  /** The talk-cycle's currently-playing action, used ONLY for loop-boundary detection while `chatStatus === "speaking"`. */
  currentAction: THREE.AnimationAction | null;
  delta: number;
  /** Called exactly once, the frame a queued/immediate pulse actually begins — the caller wires this to clear the consumed hint from context. */
  onConsume: () => void;
}

/**
 * Advances the gesture state machine by one frame: decides whether to start
 * a new pulse (immediate outside `speaking`, queued to the next loop
 * boundary during `speaking`), then advances/applies any in-progress pulse
 * as an additive one-shot bone-delta on the head bone.
 *
 * Mutates `state` in place. Defensive early-return (without throwing) if the
 * head bone cannot be resolved.
 */
export function stepGesture(state: GestureState, params: GestureStepParams): void {
  const { adapter, chatStatus, gestureHint, currentAction, delta, onConsume } = params;

  const currentTime = currentAction ? currentAction.time : null;
  const duration = currentAction ? currentAction.getClip().duration : null;

  if (chatStatus !== "speaking") {
    // Mirror talkCycle.ts's reset: stale loop-boundary data from a previous
    // speaking session can never cause an instant (false) boundary read the
    // moment speaking resumes.
    state.prevActionTime = null;
  }

  // Trigger logic (D-06 / GEST-02): only consider starting a NEW pulse when
  // none is already active and the hint is a recognized gesture kind.
  if (state.activeGesture === null && (gestureHint === "nod" || gestureHint === "shake")) {
    const shouldStart =
      chatStatus !== "speaking"
        ? true // D-06: no clip cycle to protect outside `speaking` — apply immediately.
        : detectLoopBoundary(currentTime, state.prevActionTime, duration); // GEST-02: queue for the next natural loop boundary.

    if (shouldStart) {
      state.activeGesture = gestureHint;
      state.elapsed = 0;
      onConsume();
    }
  }

  // Track prevActionTime for next step's loop-boundary check, exactly as
  // talk-cycle does (only meaningful while speaking, only when the action
  // actually has a valid time/duration).
  if (chatStatus === "speaking" && currentTime !== null && duration !== null && duration > 0) {
    state.prevActionTime = currentTime;
  }

  if (state.activeGesture === null) return;

  const head = adapter.getHumanoidBoneNode("head");
  if (!head) return; // Defensive gate — scene not loaded, or rig has no head mapping.

  state.elapsed += delta;
  const progress = Math.min(state.elapsed / GESTURE_DURATION_SECONDS, 1);
  // Rise-then-fall envelope over the pulse's duration, mirroring blink.ts's
  // sin(anim * PI) shape: 0 at start, peaks at the midpoint, back to 0 at end.
  const envelope = Math.sin(progress * Math.PI);

  const axis = state.activeGesture === "nod" ? NOD_AXIS : SHAKE_AXIS;
  _scratchGesture.setFromAxisAngle(axis, envelope * GESTURE_AMPLITUDE);

  // Additive write (PERF-01): multiply(), never set() — preserves whatever
  // base orientation the mixer/pose/other procedural systems already wrote
  // to the head bone this frame.
  head.quaternion.multiply(_scratchGesture);

  if (state.elapsed >= GESTURE_DURATION_SECONDS) {
    state.activeGesture = null;
    state.elapsed = 0;
  }
}

/**
 * Ref-driven gesture stepper. Call `useGesture()` once per component
 * instance and invoke the returned `step(params)` from inside the same
 * `useFrame`/`update(delta)` callback the other procedural systems use.
 */
export function useGesture(): { step(params: GestureStepParams): void } {
  const stateRef = useRef<GestureState>(createGestureState());

  function step(params: GestureStepParams): void {
    stepGesture(stateRef.current, params);
  }

  return { step };
}
