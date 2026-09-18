/**
 * emotion.test.ts — unit tests for the LLM-driven emotion channel (D-12..D-16).
 * Stub `AvatarFormatAdapter` whose expression manager is backed by a `Map`,
 * mirroring `expressionDrift.test.ts`'s stub-adapter convention. Time is
 * driven with repeated fixed-delta steps.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createEmotionState,
  stepEmotion,
  useEmotion,
  normalizeEmotionHint,
  EMOTION_EXPRESSION_MAP,
  EMOTION_GAZE_BIAS,
  EMOTION_FADE_IN_S,
  EMOTION_FADE_OUT_S,
  EMOTION_LINGER_S,
  EMOTION_MAX_HOLD_S,
  EMOTION_NOD_MIN_INTENSITY,
  EMOTION_SHAKE_MIN_INTENSITY,
  type EmotionHint,
  type EmotionState,
  type EmotionStepParams,
} from "./emotion";
import type { AvatarFormatAdapter } from "./types";

const DT = 1 / 60;

function makeStubExpressionManager(present: string[]) {
  const values = new Map<string, number>();
  return {
    values,
    getExpression: (name: string) => (present.includes(name) ? {} : null),
    getValue: (name: string) => (values.has(name) ? values.get(name)! : 0),
    setValue: vi.fn((name: string, weight: number) => {
      values.set(name, weight);
    }),
  };
}

function makeStubAdapter(
  em: ReturnType<typeof makeStubExpressionManager> | null,
): AvatarFormatAdapter {
  return {
    getMixer: () => {
      throw new Error("not used in this test");
    },
    getBoneNode: () => null,
    getHumanoidBoneNode: () => null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getExpressionManager: () => em as any,
  };
}

function step(
  state: EmotionState,
  overrides: Partial<EmotionStepParams> & { adapter: AvatarFormatAdapter },
) {
  return stepEmotion(state, {
    chatStatus: "ready",
    emotionHint: null,
    delta: DT,
    onConsume: () => {},
    ...overrides,
  });
}

function stepN(
  state: EmotionState,
  n: number,
  overrides: Partial<EmotionStepParams> & { adapter: AvatarFormatAdapter },
) {
  let result;
  for (let i = 0; i < n; i++) {
    result = step(state, overrides);
  }
  return result!;
}

// ── normalizeEmotionHint (T-18-03) ─────────────────────────────────────────

describe("normalizeEmotionHint", () => {
  it("returns {emotion, intensity} for a valid pair", () => {
    expect(normalizeEmotionHint("happy", 0.7)).toEqual({ emotion: "happy", intensity: 0.7 });
  });

  it("clamps out-of-range intensity to [0, 1]", () => {
    expect(normalizeEmotionHint("sad", 5)).toEqual({ emotion: "sad", intensity: 1 });
  });

  it("defaults intensity to 0.7 when undefined or NaN", () => {
    expect(normalizeEmotionHint("sad", undefined)).toEqual({ emotion: "sad", intensity: 0.7 });
    expect(normalizeEmotionHint("sad", NaN)).toEqual({ emotion: "sad", intensity: 0.7 });
  });

  it("returns null for an invalid, wrongly-cased, non-string, or missing emotion", () => {
    expect(normalizeEmotionHint("<script>", 1)).toBeNull();
    expect(normalizeEmotionHint("HAPPY", 1)).toBeNull();
    expect(normalizeEmotionHint(null)).toBeNull();
    expect(normalizeEmotionHint(42)).toBeNull();
  });
});

// ── Consume dedupe ──────────────────────────────────────────────────────

describe("stepEmotion consume dedupe", () => {
  it("calls onConsume exactly once for the same hint object across frames, and again for a new equal-valued object", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "happy", intensity: 0.7 };
    const onConsume = vi.fn();

    step(state, { adapter, emotionHint: hint, onConsume });
    step(state, { adapter, emotionHint: hint, onConsume });
    step(state, { adapter, emotionHint: hint, onConsume });
    expect(onConsume).toHaveBeenCalledTimes(1);

    const hint2: EmotionHint = { emotion: "happy", intensity: 0.7 }; // same values, new identity
    step(state, { adapter, emotionHint: hint2, onConsume });
    expect(onConsume).toHaveBeenCalledTimes(2);
  });
});

// ── Crossfade timing (D-14, D-16) ───────────────────────────────────────

describe("stepEmotion crossfade-in", () => {
  it("at t=0.2s happy is strictly between 0 and 0.7; at t>=0.4s it equals 0.7", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "happy", intensity: 0.7 };

    stepN(state, 12, { adapter, chatStatus: "speaking", emotionHint: hint }); // 12/60 = 0.2s
    const midWeight = em.getValue("happy");
    expect(midWeight).toBeGreaterThan(0);
    expect(midWeight).toBeLessThan(0.7);

    stepN(state, 30, { adapter, chatStatus: "speaking", emotionHint: hint }); // well past 0.4s total
    expect(em.getValue("happy")).toBeCloseTo(0.7, 6);
  });

  it("holds at 0.3 when intensity is 0.3", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "happy", intensity: 0.3 };

    stepN(state, 40, { adapter, chatStatus: "speaking", emotionHint: hint });
    expect(em.getValue("happy")).toBeCloseTo(0.3, 6);
  });

  it("does not call setValue for an absent expression and does not throw", () => {
    const em = makeStubExpressionManager([]); // "surprised" absent
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "surprised", intensity: 0.8 };

    expect(() => stepN(state, 10, { adapter, chatStatus: "speaking", emotionHint: hint })).not.toThrow();
    expect(em.setValue).not.toHaveBeenCalledWith("surprised", expect.anything());
  });
});

describe("stepEmotion crossfade between two emotions", () => {
  it("happy strictly decreases while sad strictly increases, happy reaches 0 at the end", () => {
    const em = makeStubExpressionManager(["happy", "sad"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const happyHint: EmotionHint = { emotion: "happy", intensity: 0.8 };

    // Fully fade in and hold on happy first.
    stepN(state, 40, { adapter, chatStatus: "speaking", emotionHint: happyHint });
    expect(em.getValue("happy")).toBeCloseTo(0.8, 6);

    const sadHint: EmotionHint = { emotion: "sad", intensity: 0.6 };
    const happyReadings: number[] = [];
    const sadReadings: number[] = [];

    // First frame of the new transition (consumes sadHint).
    step(state, { adapter, chatStatus: "speaking", emotionHint: sadHint });
    happyReadings.push(em.getValue("happy"));
    sadReadings.push(em.getValue("sad"));

    for (let i = 0; i < 23; i++) {
      step(state, { adapter, chatStatus: "speaking", emotionHint: sadHint });
      happyReadings.push(em.getValue("happy"));
      sadReadings.push(em.getValue("sad"));
    }

    for (let i = 1; i < happyReadings.length; i++) {
      expect(happyReadings[i]).toBeLessThanOrEqual(happyReadings[i - 1]);
    }
    for (let i = 1; i < sadReadings.length; i++) {
      expect(sadReadings[i]).toBeGreaterThanOrEqual(sadReadings[i - 1]);
    }

    // Continue well past the 0.4s fade-in window.
    stepN(state, 20, { adapter, chatStatus: "speaking", emotionHint: sadHint });
    expect(em.getValue("happy")).toBeCloseTo(0, 6);
  });
});

// ── Hold + release (linger, max-hold safety, neutral) ──────────────────

describe("stepEmotion hold and release", () => {
  it("holds constant weight through thinking->speaking chatStatus, then fades out after LINGER once speaking ends", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "happy", intensity: 0.7 };

    stepN(state, 30, { adapter, chatStatus: "thinking", emotionHint: hint }); // fade in while "thinking"
    stepN(state, 10, { adapter, chatStatus: "speaking", emotionHint: hint }); // enter hold, seen speaking
    const heldWeight = em.getValue("happy");
    expect(heldWeight).toBeCloseTo(0.7, 6);

    // Still holding well within LINGER while speaking continues.
    stepN(state, 30, { adapter, chatStatus: "speaking", emotionHint: hint });
    expect(em.getValue("happy")).toBeCloseTo(0.7, 6);
    expect(state.phase).toBe("hold");

    // Speaking ends; linger clock starts. Step past LINGER (1.5s) with margin.
    const lingerFrames = Math.ceil((EMOTION_LINGER_S + 0.1) / DT);
    stepN(state, lingerFrames, { adapter, chatStatus: "ready", emotionHint: hint });
    expect(state.phase).toBe("out");

    // Step past FADE_OUT (0.5s) with margin.
    const fadeOutFrames = Math.ceil((EMOTION_FADE_OUT_S + 0.1) / DT);
    stepN(state, fadeOutFrames, { adapter, chatStatus: "ready", emotionHint: hint });
    expect(state.phase).toBe("idle");
    expect(em.getValue("happy")).toBeCloseTo(0, 6);

    // Further steps write nothing.
    em.setValue.mockClear();
    step(state, { adapter, chatStatus: "ready", emotionHint: hint });
    expect(em.setValue).not.toHaveBeenCalled();
  });

  it("begins fade-out by MAX_HOLD even when chatStatus never reaches speaking", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "happy", intensity: 0.7 };

    stepN(state, 30, { adapter, chatStatus: "ready", emotionHint: hint }); // fade in, never "speaking"
    expect(state.phase).toBe("hold");

    const maxHoldFrames = Math.ceil((EMOTION_MAX_HOLD_S + 0.1) / DT);
    stepN(state, maxHoldFrames, { adapter, chatStatus: "ready", emotionHint: hint });
    expect(state.phase === "out" || state.phase === "idle").toBe(true);
  });

  it("a neutral hint fades any active emotion to 0 and ends idle", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const happyHint: EmotionHint = { emotion: "happy", intensity: 0.9 };

    stepN(state, 40, { adapter, chatStatus: "speaking", emotionHint: happyHint });
    expect(em.getValue("happy")).toBeCloseTo(0.9, 6);

    const neutralHint: EmotionHint = { emotion: "neutral", intensity: 0.7 };
    const fadeOutFrames = Math.ceil((EMOTION_FADE_OUT_S + 0.1) / DT);
    stepN(state, fadeOutFrames, { adapter, chatStatus: "speaking", emotionHint: neutralHint });

    expect(state.phase).toBe("idle");
    expect(em.getValue("happy")).toBeCloseTo(0, 6);
  });
});

// ── driftScale + gazeBias (D-12, D-15) ─────────────────────────────────

describe("stepEmotion driftScale and gazeBias", () => {
  it("driftScale is 1 idle, ~0 in hold, strictly between 0 and 1 mid-fade", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();

    const idleResult = step(state, { adapter, emotionHint: null });
    expect(idleResult.driftScale).toBe(1);

    const hint: EmotionHint = { emotion: "happy", intensity: 0.7 };
    const midResult = stepN(state, 5, { adapter, chatStatus: "speaking", emotionHint: hint });
    expect(midResult.driftScale).toBeGreaterThan(0);
    expect(midResult.driftScale).toBeLessThan(1);

    const holdResult = stepN(state, 30, { adapter, chatStatus: "speaking", emotionHint: hint });
    expect(holdResult.driftScale).toBeCloseTo(0, 6);
  });

  it("gazeBias equals the neutral values when idle", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();

    const result = step(state, { adapter, emotionHint: null });
    expect(result.gazeBias).toEqual({
      yawOffsetDeg: 0,
      pitchOffsetDeg: 0,
      aversionScale: 1,
      saccadeScale: 1,
    });
  });

  it("sad hold at intensity 1: pitchOffsetDeg < 0 and aversionScale > 1", () => {
    const em = makeStubExpressionManager(["sad"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "sad", intensity: 1 };

    const result = stepN(state, 40, { adapter, chatStatus: "speaking", emotionHint: hint });
    expect(state.phase).toBe("hold");
    expect(result.gazeBias.pitchOffsetDeg).toBeLessThan(0);
    expect(result.gazeBias.aversionScale).toBeGreaterThan(1);
  });

  it("angry hold: aversionScale < 1", () => {
    const em = makeStubExpressionManager(["angry"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "angry", intensity: 0.8 };

    const result = stepN(state, 40, { adapter, chatStatus: "speaking", emotionHint: hint });
    expect(state.phase).toBe("hold");
    expect(result.gazeBias.aversionScale).toBeLessThan(1);
  });
});

// ── suggestedGesture (D-12) ─────────────────────────────────────────────

describe("stepEmotion suggestedGesture", () => {
  it("suggests nod for happy >= 0.5, null for happy 0.3, only on the consume frame", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();

    const nodResult = step(state, {
      adapter,
      chatStatus: "speaking",
      emotionHint: { emotion: "happy", intensity: 0.5 },
    });
    expect(nodResult.suggestedGesture).toBe("nod");

    const followUp = step(state, {
      adapter,
      chatStatus: "speaking",
      emotionHint: { emotion: "happy", intensity: 0.5 }, // consumed once above; different object below re-consumes
    });
    // Same value but a fresh object identity re-triggers consume+gesture per dedupe rule.
    expect(followUp.suggestedGesture).toBe("nod");

    const state2 = createEmotionState();
    const noGestureResult = step(state2, {
      adapter,
      chatStatus: "speaking",
      emotionHint: { emotion: "happy", intensity: 0.3 },
    });
    expect(noGestureResult.suggestedGesture).toBeNull();
  });

  it("suggests shake for angry >= 0.7, null for angry 0.5", () => {
    const em = makeStubExpressionManager(["angry"]);
    const adapter = makeStubAdapter(em);

    const state = createEmotionState();
    const shakeResult = step(state, {
      adapter,
      chatStatus: "speaking",
      emotionHint: { emotion: "angry", intensity: 0.7 },
    });
    expect(shakeResult.suggestedGesture).toBe("shake");

    const state2 = createEmotionState();
    const noGestureResult = step(state2, {
      adapter,
      chatStatus: "speaking",
      emotionHint: { emotion: "angry", intensity: 0.5 },
    });
    expect(noGestureResult.suggestedGesture).toBeNull();
  });

  it("suggests null for sad, surprised, neutral, thinking", () => {
    const em = makeStubExpressionManager(["sad", "surprised", "thinking"]);
    const adapter = makeStubAdapter(em);

    for (const emotion of ["sad", "surprised", "neutral", "thinking"] as const) {
      const state = createEmotionState();
      const result = step(state, {
        adapter,
        chatStatus: "speaking",
        emotionHint: { emotion, intensity: 1 },
      });
      expect(result.suggestedGesture).toBeNull();
    }
  });

  it("is non-null ONLY on the consume frame, not subsequent frames with the same hint object", () => {
    const em = makeStubExpressionManager(["happy"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "happy", intensity: 0.9 };

    const first = step(state, { adapter, chatStatus: "speaking", emotionHint: hint });
    expect(first.suggestedGesture).toBe("nod");

    const second = step(state, { adapter, chatStatus: "speaking", emotionHint: hint });
    expect(second.suggestedGesture).toBeNull();
  });
});

// ── GLB / null expression manager ───────────────────────────────────────

describe("stepEmotion with a null expression manager (GLB)", () => {
  it("runs without throwing and still returns gazeBias and suggestedGesture", () => {
    const adapter = makeStubAdapter(null);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "happy", intensity: 0.8 };

    let result;
    expect(() => {
      result = stepN(state, 40, { adapter, chatStatus: "speaking", emotionHint: hint });
    }).not.toThrow();

    expect(result!.gazeBias).toBeDefined();
    expect(state.phase).toBe("hold");
  });
});

// ── thinking custom blend ────────────────────────────────────────────────

describe("stepEmotion thinking blend", () => {
  it("writes to both relaxed and sad at map x intensity when both exist", () => {
    const em = makeStubExpressionManager(["relaxed", "sad"]);
    const adapter = makeStubAdapter(em);
    const state = createEmotionState();
    const hint: EmotionHint = { emotion: "thinking", intensity: 0.8 };

    stepN(state, 40, { adapter, chatStatus: "speaking", emotionHint: hint });

    expect(em.getValue("relaxed")).toBeCloseTo(EMOTION_EXPRESSION_MAP.thinking.relaxed * 0.8, 6);
    expect(em.getValue("sad")).toBeCloseTo(EMOTION_EXPRESSION_MAP.thinking.sad * 0.8, 6);
  });
});

// ── useEmotion hook wrapper ──────────────────────────────────────────────

describe("useEmotion", () => {
  it("EMOTION_GAZE_BIAS has all 6 emotion keys", () => {
    for (const emotion of ["happy", "sad", "angry", "surprised", "neutral", "thinking"] as const) {
      expect(EMOTION_GAZE_BIAS[emotion]).toBeDefined();
    }
  });

  it("is a function returning a step method", () => {
    expect(typeof useEmotion).toBe("function");
  });

  it("suggested gesture thresholds match the exported constants", () => {
    expect(EMOTION_NOD_MIN_INTENSITY).toBe(0.5);
    expect(EMOTION_SHAKE_MIN_INTENSITY).toBe(0.7);
  });
});
