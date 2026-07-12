/**
 * sway.ts — Ref-driven procedural hips/spine weight-shift sway delta (IDLE-01).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Structurally identical to `breathing.ts` (same header/ref/gating/
 * allocation-reuse/additive-multiply rules) — only the target bone roles,
 * axis, and period band differ. Sway's period is drawn from an INDEPENDENT
 * band so it is never phase-locked to breathing (IDLE-01 "independent
 * cycles"); `AnimationStateEngine` runs breathing before sway in
 * `update(delta)`, and both compose on the shared spine bone via
 * `multiply()` (PERF-01), never `.set()`.
 *
 * Testability: the phase/period state and the per-frame write are factored
 * out of the hook into `createSwayState`/`stepSway` (plain functions
 * operating on a plain mutable object) so the delta math and the additive-
 * write behavior are unit-testable without rendering a React component or a
 * scene — `useSway()` itself is a thin `useRef` wrapper around them.
 */

import { useRef } from "react";
import * as THREE from "three";
import type { AvatarFormatAdapter } from "./types";

// Module-scoped scratch quaternion, reused every stepSway() call across
// every useSway() instance — allocation-reuse precedent from crossfade.ts's
// qLive/qTarget (T-11-03, DoS/frame-budget mitigation: never `new` inside
// the per-frame path). Independent from breathing.ts's scratch so the two
// systems never clobber each other's in-flight computation within the same
// frame.
const _scratchDelta = new THREE.Quaternion();

// Weight-shift sway rolls the hips/spine side to side around the
// forward/depth (Z) axis — a lateral roll, distinct from breathing's
// forward/back (X) nod.
const SWAY_AXIS = new THREE.Vector3(0, 0, 1);

// Small-degree default amplitude band (radians). ~0.025rad ≈ 1.4 degrees —
// a subtle weight shift, not a visible rock.
const DEFAULT_AMPLITUDE = 0.025;

// INDEPENDENT randomized period band (seconds) from breathing's 4.0-6.0s —
// sway is a slower cycle so the two never read as synchronized (IDLE-01).
const PERIOD_MIN = 7.0;
const PERIOD_MAX = 10.0;

/**
 * Pure sine delta-angle helper, exported for unit testing without a scene.
 *
 * @param phase - Current phase accumulator value (radians).
 * @param amplitude - Peak delta angle (radians) at amplitudeScale=1.
 * @param amplitudeScale - Multiplier on `amplitude`; 0 disables the delta,
 *   values >1 exaggerate it. Defaults to 1.
 */
export function swayDeltaAngle(phase: number, amplitude: number, amplitudeScale = 1): number {
  return Math.sin(phase) * amplitude * amplitudeScale;
}

/** Mutable phase/period state for one sway instance. */
export interface SwayState {
  phase: number;
  period: number;
}

/**
 * Creates a fresh sway state with a randomized period drawn from the
 * default band (independent of breathing's band).
 */
export function createSwayState(): SwayState {
  return {
    phase: 0,
    period: PERIOD_MIN + Math.random() * (PERIOD_MAX - PERIOD_MIN),
  };
}

/**
 * Advances `state` by `delta` seconds and applies the resulting additive
 * delta-quaternion to the adapter's hips/spine bones. Early-returns without
 * throwing if either bone cannot be resolved (defensive gate — scene not
 * loaded, or the rig has no mapping for that humanoid role).
 */
export function stepSway(
  state: SwayState,
  adapter: AvatarFormatAdapter,
  delta: number,
  amplitudeScale = 1,
): void {
  const hips = adapter.getHumanoidBoneNode("hips");
  const spine = adapter.getHumanoidBoneNode("spine");
  if (!hips || !spine) return;

  // Advance phase by a full 2*PI cycle every `state.period` seconds.
  state.phase += (delta / state.period) * Math.PI * 2;

  const angle = swayDeltaAngle(state.phase, DEFAULT_AMPLITUDE, amplitudeScale);
  _scratchDelta.setFromAxisAngle(SWAY_AXIS, angle);

  // Additive write (PERF-01): multiply(), never set() — preserves whatever
  // base orientation the mixer/pose already wrote to these bones this frame
  // (including breathing's own delta, which runs first).
  hips.quaternion.multiply(_scratchDelta);
  spine.quaternion.multiply(_scratchDelta);
}

/**
 * Ref-driven sway stepper. Call `useSway()` once per component instance and
 * invoke the returned `step(adapter, delta, amplitudeScale)` from inside
 * the same `useFrame` callback that updates the mixer, every frame.
 */
export function useSway(): {
  step(adapter: AvatarFormatAdapter, delta: number, amplitudeScale?: number): void;
} {
  // A single ref holding a plain mutable state object — not React's other
  // state hook, for the same reason blink.ts's blinkState is a ref (see
  // breathing.ts's file header for the full rationale).
  const state = useRef(createSwayState());

  function step(adapter: AvatarFormatAdapter, delta: number, amplitudeScale = 1): void {
    stepSway(state.current, adapter, delta, amplitudeScale);
  }

  return { step };
}
