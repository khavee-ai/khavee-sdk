/**
 * blink.test.ts — unit tests for the pure blink state machine, including
 * the new `forceBlink`/`coupled` external trigger surface (D-02, Phase 18).
 * Exercises `stepBlink`/`createBlinkState` directly via a stub
 * `AvatarFormatAdapter` with a stub expression manager (mirroring
 * gesture.test.ts's stubbing style) — no React rendering required.
 */

import { describe, expect, it, vi } from "vitest";
import type { VRMExpressionManager } from "@pixiv/three-vrm";
import { createBlinkState, stepBlink } from "./blink";
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
  it("starts a blink on the same call: value is sin(0.15*PI) and setValue receives it", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);

    stepBlink(state, adapter, true, 1000, { forceBlink: true, random: DETERMINISTIC_RANDOM });

    const expectedValue = Math.sin(0.15 * Math.PI);
    expect(state.isBlinking).toBe(true);
    expect(state.value).toBeCloseTo(expectedValue, 10);
    expect(expressionManager.setValue).toHaveBeenCalledWith("blinkLeft", expectedValue);
    expect(expressionManager.setValue).toHaveBeenCalledWith("blinkRight", expectedValue);
  });

  it("does not restart a blink already in progress — progress keeps advancing", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);

    stepBlink(state, adapter, true, 1000, { forceBlink: true, random: DETERMINISTIC_RANDOM });
    expect(state.progress).toBeCloseTo(0.15, 10);

    stepBlink(state, adapter, true, 1010, { forceBlink: true, random: DETERMINISTIC_RANDOM });
    expect(state.progress).toBeCloseTo(0.3, 10);
  });

  it("ignores a forced blink within MIN_FORCED_BLINK_GAP_MS (400ms) of the previous blink's end", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);

    // Run a full blink to completion via repeated forced triggers (only the
    // first actually starts it; the rest just advance progress).
    let t = 1000;
    for (let i = 0; i < 7; i++) {
      stepBlink(state, adapter, true, t, { forceBlink: true, random: DETERMINISTIC_RANDOM });
      t += 10;
    }
    expect(state.isBlinking).toBe(false);
    const endMs = state.lastBlinkEndMs;
    const progressAfterCompletion = state.progress;

    // Attempt another forced blink well within the 400ms gap.
    stepBlink(state, adapter, true, endMs + 100, { forceBlink: true, random: DETERMINISTIC_RANDOM });

    // No new blink was started — isBlinking stays false and progress is
    // untouched (a real restart would reset progress to 0 then advance it).
    expect(state.isBlinking).toBe(false);
    expect(state.progress).toBe(progressAfterCompletion);
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
  it("completes after ceil(1/0.15) = 7 calls, ending with value 0 and isBlinking=false", () => {
    const state = createBlinkState(0, DETERMINISTIC_RANDOM);
    const expressionManager = makeStubExpressionManager();
    const adapter = makeStubAdapter(expressionManager);

    let t = 1000;
    stepBlink(state, adapter, true, t, { forceBlink: true, random: DETERMINISTIC_RANDOM });
    expect(state.isBlinking).toBe(true);

    for (let i = 1; i < 7; i++) {
      t += 10;
      stepBlink(state, adapter, true, t, { random: DETERMINISTIC_RANDOM });
    }

    expect(state.isBlinking).toBe(false);
    expect(state.value).toBe(0);
  });
});
