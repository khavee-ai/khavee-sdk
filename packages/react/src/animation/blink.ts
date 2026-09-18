/**
 * blink.ts — Ref-driven procedural blink delta (D-01), plus an external
 * trigger surface for blink-coupling (D-02, Phase 18).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Migrated verbatim from `VRMAvatar.tsx` lines 308-317 (refs) and 516-553
 * (per-frame logic) — the timing constants, blink curve, and scheduling are
 * unchanged from the original inline implementation. The only behavioral
 * difference from that original migration is that this module reads/writes
 * through `adapter.getExpressionManager()` instead of
 * `currentVrm.expressionManager` directly, so it becomes a no-op on GLB
 * (whose adapter returns null) rather than something only VRMAvatar could
 * run. Blink writes expression (blendshape) values only — it never touches
 * bone quaternions, so it has no interaction with the crossfade engine's
 * pose-gap measurement (RESEARCH Pitfall 6).
 *
 * PHASE 18 (D-02, RESEARCH Pitfall 5): `blink.ts`'s scheduling state used to
 * be fully private to `useBlink()`'s own closure — there was no way for
 * another module to force an early blink or influence the schedule. Real
 * eyes blink when they make a significant gaze shift; `eyeGaze.ts` (18-01
 * plan) reports a `shiftDetected` signal for exactly this, and
 * `AnimationStateEngine.ts` (wired in 18-04) passes it through as
 * `forceBlink`. `coupled: true` demotes the random idle-blink timer from
 * "the only thing that ever blinks" to a 3.5-7s SAFETY NET that still fires
 * if no gaze-shift-triggered blink happens in a while — every blink
 * (forced or timer) pushes that safety net back out, so a chatty avatar
 * whose eyes keep darting around gets blinks from its gaze shifts, not from
 * an independent, uncorrelated random clock.
 */

import { useRef } from "react";
import type { AvatarFormatAdapter } from "./types";

/** Progress advanced per `stepBlink` call while a blink is in flight — the blink completes after `ceil(1 / BLINK_PROGRESS_STEP)` calls. Unchanged from the original inline implementation. */
const BLINK_PROGRESS_STEP = 0.15;
/** Legacy (non-coupled) minimum gap (ms) before the next random idle blink after a timer-triggered blink. Unchanged from the original inline implementation. */
const LEGACY_NEXT_MIN_MS = 100;
/** Legacy (non-coupled) random jitter (ms) added on top of `LEGACY_NEXT_MIN_MS`. Unchanged from the original inline implementation. */
const LEGACY_NEXT_JITTER_MS = 4000;
/** Coupled-mode minimum gap (ms) before the safety-net timer fires again after ANY blink (forced or timer). Long enough that gaze-shift-triggered blinks are the dominant source in a normally-active conversation (D-02). */
const COUPLED_SAFETY_MIN_MS = 3500;
/** Coupled-mode random jitter (ms) added on top of `COUPLED_SAFETY_MIN_MS`. */
const COUPLED_SAFETY_JITTER_MS = 3500;
/** Minimum gap (ms) between a blink's end and the next FORCED blink — guards against a burst of rapid gaze shifts each trying to force their own blink in quick succession. */
const MIN_FORCED_BLINK_GAP_MS = 400;

/** Mutable scheduling/animation state for one blink instance. */
export interface BlinkState {
  /** Current blink blendshape value (0 = eyes open, sine-curved up to a peak mid-blink). */
  value: number;
  /** Timestamp (ms, `Date.now()`-scale) at which the next timer-triggered blink may begin. */
  nextBlinkTimeMs: number;
  /** Whether a blink is currently mid-animation. */
  isBlinking: boolean;
  /** Progress through the current blink's sine envelope, 0 to 1+. Only meaningful while `isBlinking`. */
  progress: number;
  /** Timestamp (ms) at which the most recent blink completed. `-Infinity` until the first blink ever completes, so an early forced blink is never blocked by `MIN_FORCED_BLINK_GAP_MS`. */
  lastBlinkEndMs: number;
}

/**
 * Creates a fresh blink state with the first idle blink scheduled per the
 * original migrated timing (`nowMs + 2000 + random() * 3000`).
 *
 * @param nowMs - Creation timestamp (ms, `Date.now()`-scale).
 * @param random - Injectable RNG for deterministic tests. Defaults to `Math.random`.
 */
export function createBlinkState(nowMs: number, random: () => number = Math.random): BlinkState {
  return {
    value: 0,
    nextBlinkTimeMs: nowMs + 2000 + random() * 3000,
    isBlinking: false,
    progress: 0,
    lastBlinkEndMs: -Infinity,
  };
}

/** External trigger/mode options for one `stepBlink` call. */
export interface BlinkStepOptions {
  /** Set by the caller (`eyeGaze.ts` via `AnimationStateEngine.ts`, D-02) the frame a significant gaze shift is detected. Starts a blink immediately unless one is already in progress or `MIN_FORCED_BLINK_GAP_MS` hasn't elapsed since the last blink ended. */
  forceBlink?: boolean;
  /** When `true`, the random idle-blink timer is rescheduled to `COUPLED_SAFETY_MIN_MS..+JITTER` after EVERY blink (forced or timer), acting as a safety net rather than the primary blink source. When `false`/omitted, the legacy schedule (`LEGACY_NEXT_MIN_MS..+JITTER`) applies, matching pre-Phase-18 behavior exactly. */
  coupled?: boolean;
  /** Injectable RNG for deterministic tests. Defaults to `Math.random`. */
  random?: () => number;
}

/**
 * Starts a new blink: resets the animation progress and reschedules the
 * timer per the coupled/legacy rule, regardless of whether this blink was
 * triggered by the timer or by an external `forceBlink`. Shared by both
 * trigger paths in `stepBlink` so the reschedule logic lives in one place
 * (RESEARCH Pitfall 5).
 */
function startBlink(state: BlinkState, nowMs: number, opts: { coupled: boolean; random: () => number }): void {
  state.isBlinking = true;
  state.progress = 0;
  state.nextBlinkTimeMs = opts.coupled
    ? nowMs + COUPLED_SAFETY_MIN_MS + opts.random() * COUPLED_SAFETY_JITTER_MS
    : nowMs + LEGACY_NEXT_MIN_MS + opts.random() * LEGACY_NEXT_JITTER_MS;
}

/**
 * Advances `state` by one call and writes the resulting blink value to the
 * adapter's expression manager. Pure with respect to time — the caller
 * supplies `nowMs` rather than this function reading `Date.now()` itself, so
 * it is independently unit-testable with deterministic timestamps.
 *
 * Evaluates the forced trigger before the timer trigger (D-02): a
 * gaze-shift-triggered blink should not have to wait for the idle timer to
 * also happen to be due.
 *
 * @param state - Mutable state from `createBlinkState()`.
 * @param adapter - Format adapter; a `null` expression manager (GLB) is a no-op.
 * @param enabled - When `false`, performs no work and no `setValue` calls at all.
 * @param nowMs - Current timestamp (ms, `Date.now()`-scale).
 * @param opts - Optional forced-trigger/coupled-mode/RNG overrides.
 */
export function stepBlink(
  state: BlinkState,
  adapter: AvatarFormatAdapter,
  enabled: boolean,
  nowMs: number,
  opts?: BlinkStepOptions,
): void {
  if (!enabled) return;

  const expressionManager = adapter.getExpressionManager();
  if (!expressionManager) return; // GLB (and any format with no expression system): automatic no-op.

  const random = opts?.random ?? Math.random;
  const coupled = opts?.coupled ?? false;

  // Forced trigger, evaluated first (D-02): only starts a blink if none is
  // already in progress and enough time has passed since the last blink
  // ended (MIN_FORCED_BLINK_GAP_MS).
  if (!state.isBlinking && opts?.forceBlink && nowMs - state.lastBlinkEndMs >= MIN_FORCED_BLINK_GAP_MS) {
    startBlink(state, nowMs, { coupled, random });
  }

  // Timer trigger — unchanged from the original migrated behavior, except
  // it no longer fires if the forced trigger above just started a blink
  // this same call (guarded by `!state.isBlinking`).
  if (!state.isBlinking && nowMs > state.nextBlinkTimeMs) {
    startBlink(state, nowMs, { coupled, random });
  }

  // Handle blink animation — advances the SAME call that started it, so a
  // forced blink's value is already non-zero by the time this call returns.
  if (state.isBlinking) {
    state.progress += BLINK_PROGRESS_STEP;
    if (state.progress >= 1) {
      state.isBlinking = false;
      state.value = 0;
      state.lastBlinkEndMs = nowMs;
    } else {
      // Smooth blink curve using sine.
      state.value = Math.sin(state.progress * Math.PI);
    }
  }

  // Apply blinking to the expression system.
  if (
    expressionManager.blinkExpressionNames.includes("blinkLeft") &&
    expressionManager.blinkExpressionNames.includes("blinkRight")
  ) {
    expressionManager.setValue("blinkLeft", state.value);
    expressionManager.setValue("blinkRight", state.value);
  }
}

/**
 * Ref-driven blink stepper. Call `useBlink()` once per component instance
 * and invoke the returned `step(adapter, enabled, opts?)` from inside the
 * same `useFrame` callback that updates the mixer, every frame.
 */
export function useBlink(): {
  step(adapter: AvatarFormatAdapter, enabled: boolean, opts?: BlinkStepOptions): void;
} {
  // blinkState is a ref, not React state: it's only ever read synchronously
  // within the same useFrame callback that writes it, never rendered in
  // JSX — calling a state setter here would re-render this component on
  // every single animation frame during a blink (blink lasts ~7 frames at
  // BLINK_PROGRESS_STEP's 0.15/frame step), fighting the R3F render loop for
  // the main thread and producing visible stutter.
  const stateRef = useRef<BlinkState>(createBlinkState(Date.now()));

  function step(adapter: AvatarFormatAdapter, enabled: boolean, opts?: BlinkStepOptions): void {
    stepBlink(stateRef.current, adapter, enabled, Date.now(), opts);
  }

  return { step };
}
