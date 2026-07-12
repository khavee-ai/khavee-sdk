/**
 * expressionDrift.test.ts — unit tests for the ref-driven VRM-only expression
 * drift (IDLE-02). Covers continuity-across-frames, yield-to-app ownership
 * tracking, GLB no-op, absent-candidate fallback, and amplitudeScale — via a
 * stub `AvatarFormatAdapter` whose expression manager is backed by a `Map`
 * (no React rendering required, mirroring `sway.test.ts`'s stub-adapter
 * convention).
 */

import { describe, expect, it } from "vitest";
import {
  createExpressionDriftState,
  stepExpressionDrift,
  DEFAULT_AMPLITUDE,
} from "./expressionDrift";
import type { AvatarFormatAdapter } from "./types";

/**
 * Minimal stub VRMExpressionManager backed by a Map. `present` controls
 * which names respond to `getExpression` (non-null); `getValue`/`setValue`
 * operate over the same backing map regardless of presence, matching the
 * real manager's shape closely enough for these unit tests.
 */
function makeStubExpressionManager(present: string[]) {
  const values = new Map<string, number>();
  return {
    values,
    getExpression: (name: string) => (present.includes(name) ? {} : null),
    getValue: (name: string) => (values.has(name) ? values.get(name)! : 0),
    setValue: (name: string, weight: number) => {
      values.set(name, weight);
    },
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

describe("stepExpressionDrift", () => {
  it("continuity: writes a changing weight each frame, never frozen, always within [0, DEFAULT_AMPLITUDE]", () => {
    const em = makeStubExpressionManager(["relaxed"]);
    const adapter = makeStubAdapter(em);
    const state = createExpressionDriftState();
    state.period = 8.0;

    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      stepExpressionDrift(state, adapter, 0.5);
      const w = em.getValue("relaxed");
      seen.push(w);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(DEFAULT_AMPLITUDE);
    }

    // Not frozen at frame 1's value — at least one later frame differs.
    const allSame = seen.every((v) => v === seen[0]);
    expect(allSame).toBe(false);
  });

  it("yield-to-app: an externally-written value drift did not write is not clobbered on the next step, and drift relinquishes ownership", () => {
    const em = makeStubExpressionManager(["relaxed"]);
    const adapter = makeStubAdapter(em);
    const state = createExpressionDriftState();
    state.period = 8.0;

    stepExpressionDrift(state, adapter, 0.5);
    // External writer (e.g. the app's own setExpression) overwrites it.
    em.setValue("relaxed", 0.5);

    stepExpressionDrift(state, adapter, 0.5);
    expect(em.getValue("relaxed")).toBe(0.5); // untouched by drift this step
  });

  it("GLB no-op: adapter.getExpressionManager() returning null does not throw and writes nothing", () => {
    const adapter = makeStubAdapter(null);
    const state = createExpressionDriftState();
    expect(() => stepExpressionDrift(state, adapter, 0.5)).not.toThrow();
  });

  it("absent-candidate fallback: relaxed/happy absent, browInnerUp present -> only browInnerUp is written", () => {
    const em = makeStubExpressionManager(["browInnerUp"]);
    const adapter = makeStubAdapter(em);
    const state = createExpressionDriftState();
    state.period = 8.0;

    stepExpressionDrift(state, adapter, 0.5);

    expect(em.values.has("browInnerUp")).toBe(true);
    expect(em.values.has("relaxed")).toBe(false);
    expect(em.values.has("happy")).toBe(false);
  });

  it("amplitudeScale=0 produces a written weight of ~0; scaling between 0 and 1 scales the peak proportionally", () => {
    const emZero = makeStubExpressionManager(["relaxed"]);
    const adapterZero = makeStubAdapter(emZero);
    const stateZero = createExpressionDriftState();
    stateZero.period = 8.0;
    stepExpressionDrift(stateZero, adapterZero, 0.5, 0);
    expect(emZero.getValue("relaxed")).toBeCloseTo(0, 10);

    const emFull = makeStubExpressionManager(["relaxed"]);
    const adapterFull = makeStubAdapter(emFull);
    const stateFull = createExpressionDriftState();
    stateFull.period = 8.0;
    stateFull.phase = Math.PI / 2; // peak of the half-rectified sine
    stateFull.phaseOffsets.relaxed = 0; // pin offset so both instances compare at the same effective phase
    stepExpressionDrift(stateFull, adapterFull, 0, 1);
    const fullWeight = emFull.getValue("relaxed");

    const emHalf = makeStubExpressionManager(["relaxed"]);
    const adapterHalf = makeStubAdapter(emHalf);
    const stateHalf = createExpressionDriftState();
    stateHalf.period = 8.0;
    stateHalf.phase = Math.PI / 2;
    stateHalf.phaseOffsets.relaxed = 0;
    stepExpressionDrift(stateHalf, adapterHalf, 0, 0.5);
    const halfWeight = emHalf.getValue("relaxed");

    expect(halfWeight).toBeCloseTo(fullWeight * 0.5, 10);
  });
});
