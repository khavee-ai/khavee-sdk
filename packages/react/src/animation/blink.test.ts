/**
 * blink.test.ts — unit tests for the pure blink state machine, including
 * the new `forceBlink`/`coupled` external trigger surface (D-02, Phase 18).
 * Exercises `stepBlink`/`createBlinkState` directly via a stub
 * `AvatarFormatAdapter` with a stub expression manager (mirroring
 * gesture.test.ts's stubbing style) — no React rendering required.
 */

import { describe, expect, it, vi } from "vitest";
import type { VRMExpressionManager } from "@pixiv/three-vrm";
import { BLINK_DURATION_MS, blinkCurve, createBlinkState, stepBlink } from "./blink";
import type { AvatarFormatAdapter } from "./types";

function makeStubExpressionManager(
  blinkExpressionNames: string[] = ["blinkLeft", "blinkRight"],
): VRMExpressionManager & { setValue: ReturnType<typeof vi.fn> } {
  return {
    blinkExpressionNames,
    setValue: vi.fn(),
  } as unknown as VRMExpressionManager & { setValue: ReturnType<typeof vi.fn> };
}

function makeStubAdapter(
  expressionManager: VRMExpressionManager | null,
): AvatarFormatAdapter {
  return {
    getMixer: () => {
      throw new Error("not used by blink.ts");
    },
    getBoneNode: () => null,
    getHumanoidBoneNode: () => null,
    getExpressionManager: () => expressionManager,
  };
}

const DETERMINISTIC_RANDOM = () => 0.5;

describe("createBlinkState", () => {
  it("schedules the first blink at nowMs + 2000 + random()*3000", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    expect(state.nextBlinkTimeMs).toBe(0 + 2000 + 0.5 * 3000);
    expect(state.isBlinking).toBe(false);
    expect(state.lastBlinkEndMs).toBe(-Infinity);
  });
});

describe("stepBlink — legacy schedule (no options)", () => {
  it("does not blink before the scheduled time", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);

    stepBlink(state, adapter, true, state.nextBlinkTimeMs - 1);

    expect(state.isBlinking).toBe(false);
  });

  it("starts a blink once nowMs passes the scheduled time, and reschedules to now + 100 + random()*4000", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);
    const triggerTime = state.nextBlinkTimeMs + 1;

    stepBlink(state, adapter, true, triggerTime, { random: DETERMINISTIC_RANDOM });

    expect(state.isBlinking).toBe(true);
    expect(state.nextBlinkTimeMs).toBe(triggerTime + 100 + 0.5 * 4000);
  });
});

describe("stepBlink — forceBlink (D-02)", () => {
  it("starts a blink on the same call, eyes still open, then closes over the following frames", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);

    stepBlink(state, adapter, true, 1000, { forceBlink: true, random: DETERMINISTIC_RANDOM });
    expect(state.isBlinking).toBe(true);
    expect(state.startedAtMs).toBe(1000);
    expect(state.value).toBe(0);

    stepBlink(state, adapter, true, 1060, { random: DETERMINISTIC_RANDOM });
    expect(state.value).toBeCloseTo(blinkCurve(60), 10);
    expect(expressionManager.setValue).toHaveBeenCalledWith("blinkLeft", state.value);
    expect(expressionManager.setValue).toHaveBeenCalledWith("blinkRight", state.value);
  });

  it("does not restart a blink already in progress", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const adapter = makeStubAdapter(makeStubExpressionManager());

    stepBlink(state, adapter, true, 1000, { forceBlink: true, random: DETERMINISTIC_RANDOM });
    stepBlink(state, adapter, true, 1050, { forceBlink: true, random: DETERMINISTIC_RANDOM });
    expect(state.startedAtMs).toBe(1000);
    expect(state.value).toBeCloseTo(blinkCurve(50), 10);
  });

  it("ignores a forced blink within MIN_FORCED_BLINK_GAP_MS (400ms) of the previous blink's end", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);

    // Run a full blink to completion via repeated forced triggers (only the
    // first actually starts it; the rest just advance it).
    let t = 1000;
    do {
      stepBlink(state, adapter, true, t, { forceBlink: true, random: DETERMINISTIC_RANDOM });
      t += 16;
    } while (state.isBlinking && t < 1000 + 2 * BLINK_DURATION_MS);
    expect(state.isBlinking).toBe(false);
    const endMs = state.lastBlinkEndMs;
    const startedAtCompletion = state.startedAtMs;

    // Attempt another forced blink well within the 400ms gap.
    stepBlink(state, adapter, true, endMs + 100, { forceBlink: true, random: DETERMINISTIC_RANDOM });

    // No new blink was started — a restart would set a new startedAtMs.
    expect(state.isBlinking).toBe(false);
    expect(state.startedAtMs).toBe(startedAtCompletion);
  });
});

describe("stepBlink — coupled mode (D-02)", () => {
  it("reschedules the safety-net timer to now + 3500 + random()*3500 on a forced blink", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);

    stepBlink(state, adapter, true, 1000, {
      forceBlink: true,
      coupled: true,
      random: DETERMINISTIC_RANDOM,
    });

    expect(state.nextBlinkTimeMs).toBe(1000 + 3500 + 0.5 * 3500);
  });

  it("also reschedules the safety-net timer on a timer-triggered blink", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);
    const triggerTime = state.nextBlinkTimeMs + 1;

    stepBlink(state, adapter, true, triggerTime, { coupled: true, random: DETERMINISTIC_RANDOM });

    expect(state.nextBlinkTimeMs).toBe(triggerTime + 3500 + 0.5 * 3500);
  });
});

describe("stepBlink — enabled/expression-manager guards", () => {
  it("performs no setValue calls when enabled is false", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);

    stepBlink(state, adapter, false, 1000, { forceBlink: true, random: DETERMINISTIC_RANDOM });

    expect(expressionManager.setValue).not.toHaveBeenCalled();
    expect(state.isBlinking).toBe(false);
  });

  it("is a no-op with no throw when the expression manager is null", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const adapter = makeStubAdapter(null);

    expect(() => {
      stepBlink(state, adapter, true, 1000, { forceBlink: true, random: DETERMINISTIC_RANDOM });
    }).not.toThrow();
    expect(state.isBlinking).toBe(false);
  });

  it("does not call setValue when blinkExpressionNames lacks blinkLeft or blinkRight", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager(["blinkLeft"]);
    const adapter = makeStubAdapter(expressionManager);

    stepBlink(state, adapter, true, 1000, { forceBlink: true, random: DETERMINISTIC_RANDOM });

    expect(expressionManager.setValue).not.toHaveBeenCalled();
  });
});

describe("stepBlink — completion", () => {
  it("completes once BLINK_DURATION_MS has elapsed, ending with value 0 and isBlinking=false", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const adapter = makeStubAdapter(makeStubExpressionManager());

    stepBlink(state, adapter, true, 1000, { forceBlink: true, random: DETERMINISTIC_RANDOM });
    stepBlink(state, adapter, true, 1000 + BLINK_DURATION_MS - 1, { random: DETERMINISTIC_RANDOM });
    expect(state.isBlinking).toBe(true);

    stepBlink(state, adapter, true, 1000 + BLINK_DURATION_MS, { random: DETERMINISTIC_RANDOM });
    expect(state.isBlinking).toBe(false);
    expect(state.value).toBe(0);
    expect(state.lastBlinkEndMs).toBe(1000 + BLINK_DURATION_MS);
  });
});

describe("blinkCurve", () => {
  it("is open at both ends and fully closed through the hold", () => {
    expect(blinkCurve(0)).toBe(0);
    expect(blinkCurve(90)).toBe(1);
    expect(blinkCurve(110)).toBe(1);
    expect(blinkCurve(BLINK_DURATION_MS)).toBe(0);
    expect(blinkCurve(-5)).toBe(0);
  });

  it("closes monotonically and opens monotonically, staying within [0, 1]", () => {
    let prev = 0;
    for (let t = 0; t <= 90; t += 5) {
      expect(blinkCurve(t)).toBeGreaterThanOrEqual(prev);
      prev = blinkCurve(t);
    }
    for (let t = 120; t < BLINK_DURATION_MS; t += 5) {
      const v = blinkCurve(t);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      prev = v;
    }
  });

  it("opens slower than it closes — the lid is still a quarter shut 90ms into opening", () => {
    expect(blinkCurve(120 + 90)).toBeGreaterThan(0.2);
  });
});

describe("stepBlink — frame-rate independence", () => {
  function blinkAt(hz: number): { durationMs: number; peak: number } {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const adapter = makeStubAdapter(makeStubExpressionManager());
    const frameMs = 1000 / hz;
    let t = 1000;
    let peak = 0;
    stepBlink(state, adapter, true, t, { forceBlink: true, random: DETERMINISTIC_RANDOM });
    while (state.isBlinking) {
      t += frameMs;
      stepBlink(state, adapter, true, t, { random: DETERMINISTIC_RANDOM });
      peak = Math.max(peak, state.value);
    }
    return { durationMs: state.lastBlinkEndMs - 1000, peak };
  }

  it("takes the same time and fully closes at 60Hz, 120Hz and 144Hz", () => {
    for (const hz of [60, 120, 144]) {
      const { durationMs, peak } = blinkAt(hz);
      expect(durationMs).toBeGreaterThanOrEqual(BLINK_DURATION_MS);
      expect(durationMs).toBeLessThan(BLINK_DURATION_MS + 1000 / hz + 1e-6);
      expect(peak).toBe(1);
    }
  });
});
