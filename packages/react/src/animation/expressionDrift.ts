/**
 * expressionDrift.ts — VRM-only rest-state expression drift (IDLE-02).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Gates on `adapter.getExpressionManager()` returning non-null — the same
 * proven no-op-on-GLB pattern `blink.ts` already uses (a null-check, not a
 * format branch). VRM gets 1-2 subtle rest-state expression values drifting
 * on a slow sine; GLB's null manager makes this an automatic no-op.
 *
 * NON-CLOBBER REQUIREMENT: `KhaveeProvider.tsx`'s `setExpression`/
 * `expressions` is the app-driven expression path. `VRMAvatar.tsx` applies
 * those values every frame via `lerpExpression` BEFORE `controller.update
 * (delta)` runs, and `expressionDrift.step` runs INSIDE that
 * `controller.update(delta)` call — i.e. strictly after the app's own
 * per-frame write. `VRMExpressionManager.setValue(name, weight)` is an
 * ABSOLUTE overwrite (no compose/blend), so drift must never clobber an
 * actively app-driven expression. Enforced two ways:
 *
 *   (a) ALLOW-LIST: drift candidates are restricted to a small, documented
 *       set of subtle NON-EMOTION rest-state expressions that consuming
 *       apps do not typically drive via `setExpression`. Explicitly
 *       EXCLUDED: the standard app-driven VRM emotion presets (`happy`,
 *       `angry`, `sad`, `surprised`, `relaxed`), every mouth/viseme preset
 *       (`aa`, `ih`, `ou`, `ee`, `oh`), and the blink presets (`blink`,
 *       `blinkLeft`, `blinkRight` — already owned by `blink.ts`).
 *
 *   (b) RUNTIME GUARD: before drifting a candidate this frame, its current
 *       manager value is read via `em.getValue(name)`. If it is already
 *       non-zero (i.e. something else — most likely the app's own
 *       `setExpression` — set it this frame), drift SKIPS that candidate
 *       entirely this frame rather than overwriting it.
 *
 * Each candidate is also checked for presence on the manager
 * (`em.getExpression(name) !== null`) before writing, so this degrades
 * cleanly on VRMs that lack a given expression (custom-name candidates are
 * not guaranteed to exist on every model).
 *
 * Note: expression values are additive-by-convention via `setValue` on
 * manager-owned scalars — this is NOT a bone-quaternion writer, so PERF-01's
 * `multiply()`-not-`.set()` composition rule does not apply here.
 */

import { useRef } from "react";
import type { AvatarFormatAdapter } from "./types";

/**
 * Non-emotion rest-state expression candidates, in documented preference
 * order. Both are checked for presence on the manager before any write, so
 * this degrades gracefully on VRMs lacking either one.
 *
 * - "neutral": the standard VRM preset representing a relaxed/neutral face.
 *   Not one of the emotion presets a consuming app drives via
 *   `setExpression` (those are `happy`/`angry`/`sad`/`surprised`/
 *   `relaxed`), so it is safe to drift subtly as a rest-state "life" signal.
 * - "browInnerUp": a common custom/ARKit-style blendshape name for a subtle
 *   inner-brow-raise rest variation. Not a VRM standard preset — present
 *   only on some avatar rigs; the presence check makes this a no-op
 *   elsewhere.
 */
const DRIFT_CANDIDATES = ["neutral", "browInnerUp"] as const;

// Slow independent sine period band (seconds) — distinct from breathing's
// (4.0-6.0s) and sway's (7.0-10.0s) bands so all three idle cycles read as
// unsynchronized "life," not a single robotic pulse.
const PERIOD_MIN = 8.0;
const PERIOD_MAX = 12.0;

// Small amplitude band: weight oscillates in [0, amplitude], never
// negative (VRMExpressionManager weights are 0..1 scalars).
const DEFAULT_AMPLITUDE = 0.12;

/** Mutable phase/period state for one expression-drift instance. */
export interface ExpressionDriftState {
  phase: number;
  period: number;
}

/**
 * Creates a fresh expression-drift state with a randomized period drawn
 * from the default band.
 */
export function createExpressionDriftState(): ExpressionDriftState {
  return {
    phase: 0,
    period: PERIOD_MIN + Math.random() * (PERIOD_MAX - PERIOD_MIN),
  };
}

/**
 * Pure sine-to-weight helper, exported for unit testing without a scene.
 * Maps `phase` to a weight in `[0, amplitude]` (never negative) via a
 * half-rectified sine, so the drift eases in and out of neutral instead of
 * jumping or going negative.
 */
export function expressionDriftWeight(phase: number, amplitude: number): number {
  return amplitude * (0.5 + 0.5 * Math.sin(phase));
}

/**
 * Advances `state` by `delta` seconds and drifts present, non-app-driven
 * candidates from `DRIFT_CANDIDATES` on the adapter's expression manager.
 * No-ops (returns immediately) when the adapter has no expression manager
 * (GLB) — IDLE-02's required VRM-only behavior.
 */
export function stepExpressionDrift(
  state: ExpressionDriftState,
  adapter: AvatarFormatAdapter,
  delta: number,
): void {
  const em = adapter.getExpressionManager();
  if (!em) return; // GLB (and any format with no expression system): automatic no-op.

  state.phase += (delta / state.period) * Math.PI * 2;
  const weight = expressionDriftWeight(state.phase, DEFAULT_AMPLITUDE);

  for (const name of DRIFT_CANDIDATES) {
    if (em.getExpression(name) === null) continue; // Not present on this rig — skip.

    const current = em.getValue(name);
    // Skip if something else (most likely the app's own setExpression via
    // VRMAvatar's lerpExpression, which runs earlier this frame) already
    // set this expression to a non-zero value — never clobber it.
    if (current !== null && current !== 0) continue;

    em.setValue(name, weight);
  }
}

/**
 * Ref-driven expression-drift stepper. Call `useExpressionDrift()` once per
 * component instance and invoke the returned `step(adapter, delta)` from
 * inside the same `useFrame` callback that updates the mixer, every frame.
 */
export function useExpressionDrift(): {
  step(adapter: AvatarFormatAdapter, delta: number): void;
} {
  // A single ref holding a plain mutable state object — not React's other
  // state hook, for the same reason blink.ts's blinkState is a ref.
  const state = useRef(createExpressionDriftState());

  function step(adapter: AvatarFormatAdapter, delta: number): void {
    stepExpressionDrift(state.current, adapter, delta);
  }

  return { step };
}
