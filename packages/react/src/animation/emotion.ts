/**
 * emotion.ts — LLM-driven emotion channel: expression crossfade over the
 * expressionDrift base layer, plus gaze-bias and gesture-suggestion outputs
 * (D-12..D-16).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Composition order: this module is wired (in 18-04) to run as a step AFTER
 * `expressionDrift.ts` in the per-frame update. Because
 * `VRMExpressionManager.setValue` is an absolute overwrite, this module's
 * writes win for any shared expression slot while an emotion is active.
 * `expressionDrift.ts`'s own ownership guard (see its file header) already
 * relinquishes any slot whose value differs from drift's own last write, so
 * when this module writes zeros once at the end of a fade-out and then stops
 * writing (D-15), those slots are automatically handed back to drift on its
 * very next step — no explicit "release" handshake is needed between the two
 * modules.
 *
 * VRoid "happy"-preset caveat: at high weight some bundled VRoid rigs'
 * "happy" expression preset can dampen mouth-viseme motion (a shared
 * mouth-open blendshape channel). This is a known cross-system interaction
 * to eyeball during 18-06's live checkpoint, not something this module works
 * around — hacking around it here would couple this module to viseme
 * internals that don't exist yet in this plan.
 *
 * Packaging note: `packages/react` resolves `@khaveeai/core` from the
 * npm-published 0.1.5 (NOT the workspace build), so this module must not
 * import any new symbol from `@khaveeai/core`. `EMOTION_NAMES` and
 * `EmotionName` are therefore duplicated locally (mirroring the core
 * package's tuple/order exactly) rather than imported. The only import from
 * `@khaveeai/core` here is the type-only `ChatStatus`, which already exists
 * in the published 0.1.5.
 */

import { useRef } from "react";
import type { ChatStatus } from "@khaveeai/core";
import { easeInOutCubic } from "./crossfade";
import type { AvatarFormatAdapter } from "./types";

// ── Emotion vocabulary (duplicated from @khaveeai/core's emotion.ts — see
//    packaging note above) ───────────────────────────────────────────────

/** The 6 core emotions (D-13). Order matches the core package's EMOTION_NAMES. */
export const EMOTION_NAMES = [
  "happy",
  "sad",
  "angry",
  "surprised",
  "neutral",
  "thinking",
] as const;

export type EmotionName = (typeof EMOTION_NAMES)[number];

/** A validated emotion hint, or `null` when there is none / it was invalid. */
export type EmotionHint = { emotion: EmotionName; intensity: number } | null;

/** Default intensity used whenever intensity is missing, NaN, or out of range. */
export const DEFAULT_EMOTION_INTENSITY = 0.7;

/**
 * Allow-list + clamp used by `KhaveeProvider` (wired in 18-05) to turn a
 * `set_emotion` tool call's raw `(emotion, intensity)` pair into a validated
 * `EmotionHint` before it ever reaches this module's state machine
 * (T-18-03). Strict, case-sensitive membership check against `EMOTION_NAMES`.
 */
export function normalizeEmotionHint(
  emotion: unknown,
  intensity?: unknown,
): EmotionHint {
  if (
    typeof emotion !== "string" ||
    !(EMOTION_NAMES as readonly string[]).includes(emotion)
  ) {
    return null;
  }

  const validEmotion = emotion as EmotionName;
  const normalizedIntensity =
    typeof intensity === "number" && Number.isFinite(intensity)
      ? Math.max(0, Math.min(1, intensity))
      : DEFAULT_EMOTION_INTENSITY;

  return { emotion: validEmotion, intensity: normalizedIntensity };
}

// ── Expression + gaze mapping (Claude's Discretion, recorded per CONTEXT.md) ─

/**
 * Emotion -> VRM expression-name -> weight-at-intensity-1 map. Multiplied by
 * the active hint's intensity before being written (D-16). `neutral` is
 * intentionally empty — a neutral hint's purpose is to fade any active
 * emotion back to nothing, not to drive a "neutral" expression slot.
 * `thinking` uses a custom pensive blend (relaxed + a touch of sad) rather
 * than a single VRM standard preset.
 */
export const EMOTION_EXPRESSION_MAP: Record<EmotionName, Record<string, number>> = {
  happy: { happy: 1 },
  sad: { sad: 1 },
  angry: { angry: 1 },
  surprised: { surprised: 1 },
  neutral: {},
  thinking: { relaxed: 0.25, sad: 0.1 },
};

/**
 * Gaze-bias output shape. Field names deliberately match 18-01's
 * `EyeGazeBias` so the two are structurally compatible — this module does
 * NOT import from `eyeGaze.ts` (18-02 runs in parallel with 18-01), it just
 * mirrors the same shape by convention.
 */
export interface EmotionGazeBias {
  yawOffsetDeg: number;
  pitchOffsetDeg: number;
  aversionScale: number;
  saccadeScale: number;
}

const NEUTRAL_GAZE_BIAS: EmotionGazeBias = {
  yawOffsetDeg: 0,
  pitchOffsetDeg: 0,
  aversionScale: 1,
  saccadeScale: 1,
};

/**
 * Emotion -> full-intensity gaze-bias values (D-12, Claude's Discretion).
 * Sad and thinking pull toward more aversion (higher `aversionScale`, less
 * eye contact); angry pulls toward less aversion (a harder, more direct
 * stare); happy/surprised bias toward faster saccades (more eye "life").
 */
export const EMOTION_GAZE_BIAS: Record<EmotionName, EmotionGazeBias> = {
  happy: { yawOffsetDeg: 0, pitchOffsetDeg: 1, aversionScale: 0.6, saccadeScale: 1.2 },
  sad: { yawOffsetDeg: 0, pitchOffsetDeg: -6, aversionScale: 2.0, saccadeScale: 0.6 },
  angry: { yawOffsetDeg: 0, pitchOffsetDeg: -1, aversionScale: 0.3, saccadeScale: 0.5 },
  surprised: { yawOffsetDeg: 0, pitchOffsetDeg: 3, aversionScale: 0.4, saccadeScale: 1.6 },
  neutral: { ...NEUTRAL_GAZE_BIAS },
  thinking: { yawOffsetDeg: 8, pitchOffsetDeg: 5, aversionScale: 1.8, saccadeScale: 0.7 },
};

// ── Timing constants (Claude's Discretion, recorded per CONTEXT.md) ────────

/** Crossfade-in duration (seconds) when a new non-neutral emotion is consumed (D-14). */
export const EMOTION_FADE_IN_S = 0.4;
/** Crossfade-out duration (seconds) when an emotion releases back to drift (D-14). */
export const EMOTION_FADE_OUT_S = 0.5;
/** Seconds of non-"speaking" chatStatus (after having been seen "speaking") before an emotion begins to release. */
export const EMOTION_LINGER_S = 1.5;
/** Absolute safety ceiling (seconds) on how long an emotion can hold, regardless of chatStatus. */
export const EMOTION_MAX_HOLD_S = 20;
/** Minimum intensity for a "happy" hint to suggest a "nod" gesture. */
export const EMOTION_NOD_MIN_INTENSITY = 0.5;
/** Minimum intensity for an "angry" hint to suggest a "shake" gesture. */
export const EMOTION_SHAKE_MIN_INTENSITY = 0.7;

// ── State machine ───────────────────────────────────────────────────────

type EmotionPhase = "idle" | "in" | "hold" | "out";

/** Mutable state for one avatar's emotion-channel instance. */
export interface EmotionState {
  phase: EmotionPhase;
  emotion: EmotionName | null;
  intensity: number;
  /** Seconds elapsed within the current "in"/"out" transition. Unused in "idle"/"hold". */
  elapsed: number;
  /** Seconds elapsed within the current "hold" phase (safety-ceiling tracking). */
  holdElapsed: number;
  /** Seconds elapsed since chatStatus left "speaking" while holding (linger tracking). */
  lingerElapsed: number;
  /** Whether chatStatus has been observed as "speaking" at least once since the current hint was consumed. */
  sawSpeaking: boolean;
  /** Overall presence of the emotion layer, 0 (fully released) .. 1 (fully in). */
  presence: number;
  /** `presence` snapshotted at the start of the current transition. */
  presenceFrom: number;
  from: Record<string, number>;
  target: Record<string, number>;
  current: Record<string, number>;
  /** Reference to the last hint object actually consumed, for identity-based dedupe. */
  lastConsumedHint: EmotionHint;
}

export function createEmotionState(): EmotionState {
  return {
    phase: "idle",
    emotion: null,
    intensity: 0,
    elapsed: 0,
    holdElapsed: 0,
    lingerElapsed: 0,
    sawSpeaking: false,
    presence: 0,
    presenceFrom: 0,
    from: {},
    target: {},
    current: {},
    lastConsumedHint: null,
  };
}

export interface EmotionStepParams {
  adapter: AvatarFormatAdapter;
  chatStatus: ChatStatus;
  /** The latest emotion hint from context (already validated via `normalizeEmotionHint`). */
  emotionHint: EmotionHint;
  delta: number;
  /** Called exactly once, the frame a new hint is actually consumed — wire this to clear the consumed hint from context. */
  onConsume: () => void;
}

export interface EmotionStepResult {
  /** Non-null ONLY on the frame a hint is consumed; null every other frame. */
  suggestedGesture: "nod" | "shake" | null;
  /** 1 when idle (drift runs unsuppressed), 0 while fully held, in between mid-fade (D-15). */
  driftScale: number;
  gazeBias: EmotionGazeBias;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scaleMap(map: Record<string, number>, intensity: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(map)) {
    result[key] = map[key] * intensity;
  }
  return result;
}

function unionKeys(a: Record<string, number>, b: Record<string, number>): string[] {
  return Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
}

function computeSuggestedGesture(
  emotion: EmotionName,
  intensity: number,
): "nod" | "shake" | null {
  if (emotion === "happy" && intensity >= EMOTION_NOD_MIN_INTENSITY) return "nod";
  if (emotion === "angry" && intensity >= EMOTION_SHAKE_MIN_INTENSITY) return "shake";
  return null;
}

/**
 * Advances the emotion state machine by one frame: consumes a new hint (if
 * any), advances the current in/hold/out transition, writes the result onto
 * the adapter's expression manager (skipped entirely while idle, and no-op
 * on a null manager / GLB), and returns the gaze-bias + suggested-gesture
 * outputs 18-04 fans out to the gaze and gesture modules.
 *
 * Mutates `state` in place. Never throws.
 */
export function stepEmotion(state: EmotionState, params: EmotionStepParams): EmotionStepResult {
  const { adapter, chatStatus, emotionHint, delta, onConsume } = params;

  let consumedThisFrame = false;
  let suggestedGesture: "nod" | "shake" | null = null;

  // 1. Consume.
  if (emotionHint && emotionHint !== state.lastConsumedHint) {
    onConsume();
    state.lastConsumedHint = emotionHint;
    consumedThisFrame = true;

    state.from = { ...state.current };
    state.presenceFrom = state.presence;

    const isNeutral = emotionHint.emotion === "neutral";
    state.target = isNeutral
      ? {}
      : scaleMap(EMOTION_EXPRESSION_MAP[emotionHint.emotion], emotionHint.intensity);

    state.phase = isNeutral ? "out" : "in";
    state.elapsed = 0;
    state.holdElapsed = 0;
    state.lingerElapsed = 0;
    state.sawSpeaking = chatStatus === "speaking";
    state.emotion = emotionHint.emotion;
    state.intensity = emotionHint.intensity;

    suggestedGesture = computeSuggestedGesture(emotionHint.emotion, emotionHint.intensity);
  }

  // 2. Advance.
  if (state.phase === "in") {
    state.elapsed += delta;
    const t = easeInOutCubic(Math.min(1, state.elapsed / EMOTION_FADE_IN_S));
    for (const key of unionKeys(state.from, state.target)) {
      const fromValue = state.from[key] ?? 0;
      const targetValue = state.target[key] ?? 0;
      state.current[key] = fromValue + (targetValue - fromValue) * t;
    }
    state.presence = state.presenceFrom + (1 - state.presenceFrom) * t;

    if (t >= 1) {
      state.phase = "hold";
    }
  } else if (state.phase === "hold") {
    if (chatStatus === "speaking") {
      state.sawSpeaking = true;
    }
    state.holdElapsed += delta;
    if (state.sawSpeaking && chatStatus !== "speaking") {
      state.lingerElapsed += delta;
    }

    if (state.lingerElapsed >= EMOTION_LINGER_S || state.holdElapsed >= EMOTION_MAX_HOLD_S) {
      state.from = { ...state.current };
      state.target = {};
      state.presenceFrom = state.presence;
      state.phase = "out";
      state.elapsed = 0;
    }
  } else if (state.phase === "out") {
    state.elapsed += delta;
    const t = easeInOutCubic(Math.min(1, state.elapsed / EMOTION_FADE_OUT_S));
    for (const key of unionKeys(state.from, state.target)) {
      const fromValue = state.from[key] ?? 0;
      const targetValue = state.target[key] ?? 0;
      state.current[key] = fromValue + (targetValue - fromValue) * t;
    }
    state.presence = state.presenceFrom * (1 - t);
  }

  // 3. Write. Skipped entirely while idle, so expressionDrift keeps running
  //    as the base layer with nothing to yield to (D-15).
  const em = adapter.getExpressionManager();
  if (em && state.phase !== "idle") {
    for (const key of Object.keys(state.current)) {
      if (em.getExpression(key) !== null) {
        em.setValue(key, clamp01(state.current[key]));
      }
    }
  }

  // Finalize the "out" -> "idle" transition AFTER writing the (now ~zero)
  // values one last time, so the model visibly settles to zero before this
  // module stops writing and hands the slots back to drift (D-15).
  if (state.phase === "out") {
    const t = easeInOutCubic(Math.min(1, state.elapsed / EMOTION_FADE_OUT_S));
    if (t >= 1) {
      state.current = {};
      state.phase = "idle";
      state.emotion = null;
      state.presence = 0;
    }
  }

  // 4. Result.
  const gazeEmotion = state.emotion ?? "neutral";
  const bias = EMOTION_GAZE_BIAS[gazeEmotion];
  const k = state.presence * state.intensity;
  const gazeBias: EmotionGazeBias = {
    yawOffsetDeg: bias.yawOffsetDeg * k,
    pitchOffsetDeg: bias.pitchOffsetDeg * k,
    aversionScale: 1 + (bias.aversionScale - 1) * k,
    saccadeScale: 1 + (bias.saccadeScale - 1) * k,
  };

  return {
    suggestedGesture: consumedThisFrame ? suggestedGesture : null,
    driftScale: 1 - state.presence,
    gazeBias,
  };
}

/**
 * Ref-driven emotion stepper. Call `useEmotion()` once per component
 * instance and invoke the returned `step(params)` from inside the same
 * `useFrame`/`update(delta)` callback the other procedural systems use,
 * AFTER `expressionDrift`'s own step (see file header).
 */
export function useEmotion(): { step(params: EmotionStepParams): EmotionStepResult } {
  const stateRef = useRef<EmotionState>(createEmotionState());

  function step(params: EmotionStepParams): EmotionStepResult {
    return stepEmotion(stateRef.current, params);
  }

  return { step };
}
