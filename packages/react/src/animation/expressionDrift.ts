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
 * 11-07 gap closure (IDLE-02 empirical findings): both bundled VRM models
 * are VRoid VRM 0.x exports normalized at load time by three-vrm's
 * `v0v1PresetNameMap` (fun -> relaxed, joy -> happy, neutral -> neutral).
 * Neither model exposes `browInnerUp` or `surprised` (dropped by the
 * normalization map). The original candidate list (`neutral`,
 * `browInnerUp`) was diagnosed as the IDLE-02 root cause on these assets:
 * `browInnerUp` is absent (silently skipped) and `neutral` IS the default
 * rest face, so drifting its weight is visually inert — the exact "no
 * visible drift" symptom reported in 11-06. `relaxed`/`happy` are present
 * via normalization AND produce a subtle, visible change, so they now lead
 * the candidate list; `browInnerUp` remains as a fallback for rigs that do
 * expose it (e.g. ARKit-style custom blendshapes).
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
 *       set of subtle NON-EMOTION-DRIVEN rest-state expressions that
 *       consuming apps do not typically drive via `setExpression`.
 *
 *   (b) RUNTIME GUARD (ownership tracking, 11-07): before drifting a
 *       candidate this frame, its current manager value is read via
 *       `em.getValue(name)` and compared against `state.lastWritten[name]`
 *       — the value drift itself wrote last frame (or `undefined` if drift
 *       has never written it). If the current value is non-zero AND differs
 *       from drift's own last write beyond EPSILON, some OTHER writer
 *       changed it since drift last ran (most likely the app's own
 *       `setExpression`), so drift SKIPS that candidate this frame and
 *       relinquishes ownership (does not update `lastWritten`, so it keeps
 *       yielding until the app's value happens to coincide with a future
 *       drift-computed weight). This replaces the original bare
 *       `current !== 0` guard, which was the second diagnosed IDLE-02 root
 *       cause: it read back drift's OWN prior non-zero write on frame 2 and
 *       incorrectly treated that as "someone else set it," permanently
 *       freezing drift after its first frame.
 *
 * Each candidate is also checked for presence on the manager
 * (`em.getExpression(name) !== null`) before writing, so this degrades
 * cleanly on VRMs that lack a given expression (custom-name candidates are
 * not guaranteed to exist on every model). At most `MAX_ACTIVE_CANDIDATES`
 * (2) candidates are actively drifted per instance, in `DRIFT_CANDIDATES`
 * order, so a rig exposing all three never drifts more than two at once.
 *
 * Note: expression values are additive-by-convention via `setValue` on
 * manager-owned scalars — this is NOT a bone-quaternion writer, so PERF-01's
 * `multiply()`-not-`.set()` composition rule does not apply here.
 *
 * 11-09 gap closure (IDLE-02 STILL invisible after 11-07's candidate/
 * ownership fix): a fresh runtime diagnosis was run against three
 * hypotheses, NOT a repeat of the 11-07 investigation above:
 *
 *   H1 (present names) — CONFIRMED NOT the dominant cause. A throwaway
 *   headless script (`GLTFLoader.parse()` + `@pixiv/three-vrm`'s
 *   `VRMCoreLoaderPlugin`, run against the actual bundled
 *   `public/models/male.vrm` and a second bundled VRoid model —
 *   `public/models/female/blue-female.vrm` referenced by the plan does not
 *   exist in this worktree, a substitution documented in the 11-09 SUMMARY)
 *   confirmed BOTH loaded VRMs expose `relaxed` and `happy` as real,
 *   present expression names (`browInnerUp` is absent on both, as 11-07
 *   already found). 11-07's candidate choice was correct; this is not the
 *   remaining bug.
 *
 *   H3 (downstream overwrite) — CONFIRMED NOT the cause. `VRMAvatar.tsx`'s
 *   `lerpExpression` loop only iterates the app-driven `expressions` map
 *   (empty by default), runs BEFORE `controller.update(delta)` (which
 *   contains this module's `step`), and `VRMExpressionManager.update()`
 *   (called via `currentVrm.update(delta)`, which runs AFTER
 *   `controller.update`) reads each expression's already-set `.weight` and
 *   applies a blink/lookAt/mouth EXCLUSIVITY MULTIPLIER — it does not
 *   reset or overwrite the weight field itself. `relaxed`/`happy` are not
 *   in any of those three exclusive-name lists, so their multiplier is
 *   always 1 and drift's write reaches the model unmodified.
 *
 *   H2 (amplitude / settle-scale damping) — CONFIRMED the dominant cause.
 *   `AnimationStateEngine.ts`'s `SETTLE_SCALE = 0.15` damps ALL procedural
 *   amplitude (including this module's `amplitudeScale` parameter) while
 *   `chatStatus === "stopped"`. The `openai-avatar-test` demo page (the
 *   page used for the 11-08 human re-verification) mounts with the SDK's
 *   default `chatStatus`, which is `"stopped"` until the human clicks
 *   Connect — so the human was observing `DEFAULT_AMPLITUDE (0.12) *
 *   SETTLE_SCALE (0.15) = 0.018` peak weight, an objectively imperceptible
 *   facial change. Even the FULL `ready`-state peak (the old 0.12) is
 *   plausibly too subtle a rest-face weight to read as "expression
 *   changing" rather than "wrinkle equal to normal small facial noise."
 *
 * Fix: `DEFAULT_AMPLITUDE` raised from 0.12 to 0.35 — chosen from the
 * documented ~0.25-0.45 perceptible-relaxed/happy-on-VRoid-rigs band
 * (Claude's Discretion per CONTEXT.md), landing on a value that reads as a
 * clearly visible, still-subtle mild rest smile rather than a jarring full
 * emotion pop. This does NOT touch: the `lastWritten` ownership guard, the
 * present-name `getExpression(name) !== null` check, `MAX_ACTIVE_
 * CANDIDATES`, `phaseOffsets`, or `DRIFT_CANDIDATES` order — all four
 * remain exactly as 11-07 left them. The TRANS-02 stopped-settle damping
 * (`SETTLE_SCALE` in `AnimationStateEngine.ts`) is intentionally NOT
 * removed: `stopped`'s peak is now `0.35 * 0.15 ≈ 0.0525` — still visibly
 * damped relative to `ready`'s `0.35`, preserving the settle-to-rest cue,
 * but built on a base amplitude high enough that even the damped state
 * reads as "gently returning to rest," not "off."
 *
 * `PERCEPTIBLE_MIN_WEIGHT` documents the floor of visibility this fix
 * targets (asserted in `expressionDrift.test.ts`'s ready-state peak test):
 * any candidate weight below this is treated as "not reliably visible on a
 * VRoid rig's relaxed/happy blendshape," independent of the exact
 * `DEFAULT_AMPLITUDE` value chosen above.
 *
 * Dev-only diagnostic: `DRIFT_DEBUG` (module-scoped, hardcoded `false`,
 * never wired to a build flag or exported) gates a one-time-per-instance
 * `console.debug` logging the present expression names, the
 * `DRIFT_CANDIDATES` subset actually present, and the computed peak
 * weight/amplitudeScale — so a human re-verifying IDLE-02 live can cross-
 * check the same H1/H2 data this diagnosis used, directly in devtools.
 * Left off by default; not a production logging path (see the Logging
 * conventions in CLAUDE.md — this is an internal, non-exported module).
 */

import { useRef } from "react";
import type { AvatarFormatAdapter } from "./types";

/**
 * Non-emotion rest-state expression candidates, in documented preference
 * order. Each is checked for presence on the manager before any write, so
 * this degrades gracefully on VRMs lacking any given one. At most
 * `MAX_ACTIVE_CANDIDATES` present candidates are actively drifted.
 *
 * - "relaxed": VRM 1.0-normalized target of VRoid's "fun" preset — present
 *   and visually subtle-but-visible on both bundled VRoid VRM 0.x models
 *   (empirically verified 11-07). Not one of the emotion presets a
 *   consuming app drives directly as its primary expression (apps
 *   typically drive `happy`/`angry`/`sad`/`surprised` for reactive
 *   emotion), so it is safe to drift subtly as a rest-state "life" signal.
 * - "happy": VRM 1.0-normalized target of VRoid's "joy" preset — same
 *   presence/visibility profile as "relaxed" on the bundled models.
 * - "browInnerUp": a common custom/ARKit-style blendshape name for a subtle
 *   inner-brow-raise rest variation. Not a VRM standard preset — present
 *   only on some avatar rigs; the presence check makes this a no-op
 *   elsewhere. Kept as a fallback candidate for rigs where `relaxed`/
 *   `happy` are absent.
 */
const DRIFT_CANDIDATES = ["relaxed", "happy", "browInnerUp"] as const;

/** Maximum number of present candidates actively drifted at once. */
const MAX_ACTIVE_CANDIDATES = 2;

// Slow independent sine period band (seconds) — distinct from breathing's
// (4.0-6.0s) and sway's (7.0-10.0s) bands so all three idle cycles read as
// unsynchronized "life," not a single robotic pulse.
const PERIOD_MIN = 8.0;
const PERIOD_MAX = 12.0;

// Small amplitude band: weight oscillates in [0, amplitude], never
// negative (VRMExpressionManager weights are 0..1 scalars). Exported for
// test assertions (expressionDrift.test.ts) and consumers wanting the raw
// ceiling value.
//
// 11-09 gap closure (IDLE-02 H2 fix): raised from 0.12 to 0.35 — the old
// value, combined with AnimationStateEngine's stopped-state SETTLE_SCALE
// (0.15), produced an objectively imperceptible 0.018 peak weight on the
// demo page's default pre-connect `stopped` chatStatus, and even the full
// 0.12 ready-state peak was plausibly too subtle to read as visible
// expression change. See the file-header 11-09 diagnosis block above.
export const DEFAULT_AMPLITUDE = 0.35;

// Documented floor of visibility this fix targets: any drifted candidate
// weight below this is not reliably perceptible as "expression changing"
// on a VRoid rig's relaxed/happy blendshape. Asserted directly in
// expressionDrift.test.ts's ready-state peak test (11-09 Task 1, Test A).
export const PERCEPTIBLE_MIN_WEIGHT = 0.15;

// Threshold below which a manager value is treated as "not app-owned" /
// "matches drift's own last write" — guards against float-equality noise
// from repeated sine/setValue round-trips.
const EPSILON = 1e-4;

// 11-09 gap closure dev-only diagnostic: hardcoded off, never wired to a
// build flag. Flip to true locally (never commit as true) to log, once per
// drift instance, the present expression names / DRIFT_CANDIDATES subset /
// computed peak weight so a human re-verifying IDLE-02 live can cross-check
// the same H1/H2 data this diagnosis used, directly in devtools.
const DRIFT_DEBUG = false;

/** Mutable phase/period/ownership state for one expression-drift instance. */
export interface ExpressionDriftState {
  phase: number;
  period: number;
  /**
   * The weight drift itself last wrote for each candidate name, keyed by
   * candidate. Used by the runtime ownership guard (11-07) to distinguish
   * "the manager still holds drift's own prior write" from "something else
   * (the app) wrote a different value since," without permanently freezing
   * on drift's own non-zero output the way the original bare-non-zero guard
   * did.
   */
  lastWritten: Record<string, number>;
  /**
   * A small, randomized-once-per-instance phase offset per candidate name,
   * so multiple actively-drifted candidates (e.g. "relaxed" and "happy"
   * both present) oscillate out of lock-step with each other rather than
   * rising and falling in perfect unison.
   */
  phaseOffsets: Record<string, number>;
  /**
   * 11-09 dev-diagnostic bookkeeping: set true after the DRIFT_DEBUG
   * one-time log has fired for this instance, so the log runs exactly once
   * per drift instance rather than every frame. No effect when DRIFT_DEBUG
   * is false (the default).
   */
  debugLogged?: boolean;
}

/**
 * Creates a fresh expression-drift state with a randomized period drawn
 * from the default band, and a randomized phase offset for every known
 * candidate name (assigned up front so ordering/lookup is stable
 * regardless of which candidates end up present on a given rig).
 */
export function createExpressionDriftState(): ExpressionDriftState {
  const phaseOffsets: Record<string, number> = {};
  for (const name of DRIFT_CANDIDATES) {
    phaseOffsets[name] = Math.random() * Math.PI * 2;
  }
  return {
    phase: 0,
    period: PERIOD_MIN + Math.random() * (PERIOD_MAX - PERIOD_MIN),
    lastWritten: {},
    phaseOffsets,
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
 * Advances `state` by `delta` seconds and drifts up to `MAX_ACTIVE_
 * CANDIDATES` present, non-app-owned candidates from `DRIFT_CANDIDATES` on
 * the adapter's expression manager. No-ops (returns immediately) when the
 * adapter has no expression manager (GLB) — IDLE-02's required VRM-only
 * behavior.
 *
 * @param amplitudeScale - Multiplier on the computed drift weight, default
 *   1 (neutral). Lets callers (AnimationStateEngine's stopped-settle ramp,
 *   11-07 Task 3) ease facial drift amplitude in step with the body's
 *   procedural settle scale instead of hard-gating it on/off.
 */
export function stepExpressionDrift(
  state: ExpressionDriftState,
  adapter: AvatarFormatAdapter,
  delta: number,
  amplitudeScale = 1,
): void {
  const em = adapter.getExpressionManager();
  if (!em) return; // GLB (and any format with no expression system): automatic no-op.

  // 11-09 dev-only diagnostic (off by default — see DRIFT_DEBUG above):
  // logs once per instance so a human re-verifying IDLE-02 live can
  // cross-check the same present-name/amplitude data this gap-closure
  // pass's diagnosis used, directly in devtools.
  if (DRIFT_DEBUG && !state.debugLogged) {
    const presentNames = em.expressions.map((e) => e.expressionName);
    const presentCandidates = DRIFT_CANDIDATES.filter((name) => em.getExpression(name) !== null);
    // eslint-disable-next-line no-console
    console.debug("[expressionDrift] diagnostic", {
      presentExpressionNames: presentNames,
      presentDriftCandidates: presentCandidates,
      peakWeight: DEFAULT_AMPLITUDE * amplitudeScale,
      amplitudeScale,
    });
    state.debugLogged = true;
  }

  state.phase += (delta / state.period) * Math.PI * 2;

  let activeCount = 0;
  for (const name of DRIFT_CANDIDATES) {
    if (activeCount >= MAX_ACTIVE_CANDIDATES) break;
    if (em.getExpression(name) === null) continue; // Not present on this rig — skip.

    const current = em.getValue(name);
    const lastWritten = state.lastWritten[name];
    const currentDiffersFromLastWritten =
      lastWritten === undefined || Math.abs(current! - lastWritten) > EPSILON;

    // Ownership guard (11-07): only treat this candidate as "app-owned this
    // frame" (and relinquish it) when its current value is meaningfully
    // non-zero AND differs from what drift itself last wrote here. A value
    // that still matches drift's own prior write is NOT evidence of an
    // external writer — it's just the manager holding drift's last output,
    // which is exactly what continuous drift is supposed to build on.
    if (current !== null && Math.abs(current) > EPSILON && currentDiffersFromLastWritten) {
      continue; // Relinquish: do not write, do not update lastWritten.
    }

    const offset = state.phaseOffsets[name] ?? 0;
    const weight = expressionDriftWeight(
      state.phase + offset,
      DEFAULT_AMPLITUDE * amplitudeScale,
    );
    em.setValue(name, weight);
    state.lastWritten[name] = weight;
    activeCount++;
  }
}

/**
 * Ref-driven expression-drift stepper. Call `useExpressionDrift()` once per
 * component instance and invoke the returned `step(adapter, delta,
 * amplitudeScale?)` from inside the same `useFrame` callback that updates
 * the mixer, every frame.
 */
export function useExpressionDrift(): {
  step(adapter: AvatarFormatAdapter, delta: number, amplitudeScale?: number): void;
} {
  // A single ref holding a plain mutable state object — not React's other
  // state hook, for the same reason blink.ts's blinkState is a ref.
  const state = useRef(createExpressionDriftState());

  function step(adapter: AvatarFormatAdapter, delta: number, amplitudeScale = 1): void {
    stepExpressionDrift(state.current, adapter, delta, amplitudeScale);
  }

  return { step };
}
