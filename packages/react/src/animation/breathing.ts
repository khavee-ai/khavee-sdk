/**
 * breathing.ts — Ref-driven procedural chest/spine breathing delta (IDLE-01).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Mirrors `blink.ts`'s exact shape: a `use<Thing>()` hook that owns
 * `useRef`-backed per-frame state (never React's other state hook — a
 * setter from that hook would re-render the component every single
 * animation frame, fighting the R3F render loop for the main thread) and
 * returns a `step(adapter, ...)` function to be called from inside the
 * same `useFrame` callback that
 * updates the mixer.
 *
 * Composition (PERF-01): breathing writes an ADDITIVE delta-quaternion via
 * `bone.quaternion.multiply(scratch)`, never `.set()`. `AnimationStateEngine`
 * runs breathing before sway in `update(delta)` — both compose on the shared
 * spine bone, and multiply() preserves whatever the mixer/pose already wrote
 * to that bone this frame instead of overwriting it (see PERFORMANCE-BUDGET.md
 * §4 and crossfade.ts's allocation-reuse precedent, mirrored below via a
 * module-scoped scratch THREE.Quaternion that is set-and-reused, never `new`,
 * inside the per-frame path).
 *
 * Testability: the phase/period state and the per-frame write are factored
 * out of the hook into `createBreathingState`/`stepBreathing` (plain
 * functions operating on a plain mutable object) so the delta math and the
 * additive-write behavior are unit-testable without rendering a React
 * component or a scene (no @testing-library/react dependency needed) —
 * `useBreathing()` itself is a thin `useRef` wrapper around them.
 */

import { useRef } from "react";
import * as THREE from "three";
import type { AvatarFormatAdapter } from "./types";

// Module-scoped scratch quaternion, reused every stepBreathing() call across
// every useBreathing() instance — allocation-reuse precedent from
// crossfade.ts's qLive/qTarget (T-11-03, DoS/frame-budget mitigation: never
// `new` inside the per-frame path).
const _scratchDelta = new THREE.Quaternion();

// Breathing rocks the chest/spine forward/back around the lateral (X) axis —
// a subtle "chest rise" nod, not a twist or roll.
const BREATHING_AXIS = new THREE.Vector3(1, 0, 0);

// Small-degree default amplitude band (radians). ~0.03rad ≈ 1.7 degrees —
// enough to read as "alive" without looking like a nod or a twitch.
const DEFAULT_AMPLITUDE = 0.03;

// Randomized-range period band (seconds), per IDLE-01's "randomized-range
// procedural breathing" requirement — different avatar instances get
// different periods so they are not visibly phase-locked to one another.
const PERIOD_MIN = 4.0;
const PERIOD_MAX = 6.0;

/**
 * Pure sine delta-angle helper, exported for unit testing without a scene.
 *
 * @param phase - Current phase accumulator value (radians).
 * @param amplitude - Peak delta angle (radians) at amplitudeScale=1.
 * @param amplitudeScale - Multiplier on `amplitude`; 0 disables the delta,
 *   values >1 exaggerate it. Defaults to 1.
 */
export function breathingDeltaAngle(
  phase: number,
  amplitude: number,
  amplitudeScale = 1,
): number {
  return Math.sin(phase) * amplitude * amplitudeScale;
}

/** Mutable phase/period state for one breathing instance. */
export interface BreathingState {
  phase: number;
  period: number;
}

/**
 * Creates a fresh breathing state with a randomized period drawn from the
 * default band, so different avatar instances are not phase-locked.
 */
export function createBreathingState(): BreathingState {
  return {
    phase: 0,
    period: PERIOD_MIN + Math.random() * (PERIOD_MAX - PERIOD_MIN),
  };
}

/**
 * Advances `state` by `delta` seconds and applies the resulting additive
 * delta-quaternion to the adapter's chest/spine bones. Early-returns without
 * throwing if either bone cannot be resolved (defensive gate — scene not
 * loaded, or the rig has no mapping for that humanoid role).
 */
export function stepBreathing(
  state: BreathingState,
  adapter: AvatarFormatAdapter,
  delta: number,
  amplitudeScale = 1,
): void {
  const chest = adapter.getHumanoidBoneNode("chest");
  const spine = adapter.getHumanoidBoneNode("spine");
  if (!chest || !spine) return;

  // Advance phase by a full 2*PI cycle every `state.period` seconds.
  state.phase += (delta / state.period) * Math.PI * 2;

  const angle = breathingDeltaAngle(state.phase, DEFAULT_AMPLITUDE, amplitudeScale);
  _scratchDelta.setFromAxisAngle(BREATHING_AXIS, angle);

  // Additive write (PERF-01): multiply(), never set() — preserves whatever
  // base orientation the mixer/pose already wrote to these bones this frame.
  chest.quaternion.multiply(_scratchDelta);
  spine.quaternion.multiply(_scratchDelta);
}

/**
 * Ref-driven breathing stepper. Call `useBreathing()` once per component
 * instance and invoke the returned `step(adapter, delta, amplitudeScale)`
 * from inside the same `useFrame` callback that updates the mixer, every
 * frame.
 */
export function useBreathing(): {
  step(adapter: AvatarFormatAdapter, delta: number, amplitudeScale?: number): void;
} {
  // A single ref holding a plain mutable state object — not React's other
  // state hook, for the same reason blink.ts's blinkState is a ref (see
  // file header).
  const state = useRef(createBreathingState());

  function step(adapter: AvatarFormatAdapter, delta: number, amplitudeScale = 1): void {
    stepBreathing(state.current, adapter, delta, amplitudeScale);
  }

  return { step };
}
