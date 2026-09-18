/**
 * talkCycle.test.ts — unit tests for the loop-boundary-driven status clip
 * cycler (TALK-01, generalized by 260918-gzb to cover ready/listening/
 * thinking/speaking). Exercises the pure `stepClipCycle` state machine
 * directly (mirroring crossfade.test.ts's stub-action pattern) rather than
 * `useClipCycle()` itself, since the hook is a thin `useRef` wrapper with no
 * behavior of its own beyond delegating to `stepClipCycle`.
 */

import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import {
  createClipCycleState,
  CYCLING_STATUSES,
  detectLoopBoundary,
  MIN_TALK_DWELL_SECONDS,
  nextVariantIndex,
  pickRandomVariantIndex,
  stepClipCycle,
  type ClipCycleState,
} from "./talkCycle";

/** Stub AnimationAction exposing only what talkCycle reads: .time and getClip().duration. */
function makeStubAction(time: number, duration: number): THREE.AnimationAction {
  return {
    time,
    getClip: () => ({ duration }) as THREE.AnimationClip,
  } as unknown as THREE.AnimationAction;
}

describe("nextVariantIndex", () => {
  it("advances to the next index, wrapping at the end of the list", () => {
    expect(nextVariantIndex(0, 3)).toBe(1);
    expect(nextVariantIndex(1, 3)).toBe(2);
    expect(nextVariantIndex(2, 3)).toBe(0);
  });

  it("never returns the current index for any 2+ length list", () => {
    for (let length = 2; length <= 5; length++) {
      for (let current = 0; current < length; current++) {
        expect(nextVariantIndex(current, length)).not.toBe(current);
      }
    }
  });

  it("treats an unknown current index (-1) as starting at index 0", () => {
    expect(nextVariantIndex(-1, 3)).toBe(0);
  });
});

describe("detectLoopBoundary", () => {
  it("returns false when currentTime is null", () => {
    expect(detectLoopBoundary(null, 0.5, 1.0)).toBe(false);
  });

  it("returns false when duration is null", () => {
    expect(detectLoopBoundary(0.5, 0.4, null)).toBe(false);
  });

  it("returns false when duration is non-positive", () => {
    expect(detectLoopBoundary(0.5, 0.4, 0)).toBe(false);
    expect(detectLoopBoundary(0.5, 0.4, -1)).toBe(false);
  });

  it("returns false when prevTime is null (first frame — no prior sample)", () => {
    expect(detectLoopBoundary(0.95, null, 1.0)).toBe(false);
  });

  it("returns true when currentTime < prevTime (wrap)", () => {
    expect(detectLoopBoundary(0.05, 0.9, 1.0)).toBe(true);
  });

  it("returns true when currentTime crosses duration without wrapping (non-looping clip clamped at end)", () => {
    expect(detectLoopBoundary(1.0, 0.95, 1.0)).toBe(true);
  });

  it("returns false mid-clip with no boundary", () => {
    expect(detectLoopBoundary(0.5, 0.3, 1.0)).toBe(false);
  });
});

describe("pickRandomVariantIndex", () => {
  it("returns 0 for length 0", () => {
    expect(pickRandomVariantIndex(-1, 0, () => 0.5)).toBe(0);
    expect(pickRandomVariantIndex(0, 0, () => 0.5)).toBe(0);
  });

  it("returns 0 for length 1", () => {
    expect(pickRandomVariantIndex(-1, 1, () => 0.5)).toBe(0);
    expect(pickRandomVariantIndex(0, 1, () => 0.999999)).toBe(0);
  });

  it("with length >= 2 and a valid currentIndex, never returns currentIndex for rng values 0, 0.5, 0.999999, or 1 (clamp)", () => {
    for (let length = 2; length <= 5; length++) {
      for (let current = 0; current < length; current++) {
        for (const rngValue of [0, 0.5, 0.999999, 1]) {
          const result = pickRandomVariantIndex(current, length, () => rngValue);
          expect(result).not.toBe(current);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(length);
        }
      }
    }
  });

  it("with currentIndex -1, returns floor(rng()*length) clamped to length-1", () => {
    expect(pickRandomVariantIndex(-1, 4, () => 0)).toBe(0);
    expect(pickRandomVariantIndex(-1, 4, () => 0.5)).toBe(2);
    expect(pickRandomVariantIndex(-1, 4, () => 0.999999)).toBe(3);
    expect(pickRandomVariantIndex(-1, 4, () => 1)).toBe(3);
  });
});

describe("stepClipCycle", () => {
  it("returns null and resets state for 'starting', even with a loop boundary and dwell satisfied", () => {
    const state = createClipCycleState();
    const variants = ["welcome_a", "welcome_b"];

    // Prime prevActionTime as if we had been cycling a status...
    stepClipCycle(state, {
      chatStatus: "ready",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName: "welcome_a",
      variants,
      delta: MIN_TALK_DWELL_SECONDS + 1,
    });

    // ...then switch to "starting" with a value that would otherwise read as
    // a loop wrap.
    const result = stepClipCycle(state, {
      chatStatus: "starting",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName: "welcome_a",
      variants,
      delta: 5,
    });

    expect(result).toBeNull();
  });

  it("returns null and resets state for 'stopped'", () => {
    const state = createClipCycleState();
    const variants = ["goodbye_a", "goodbye_b"];

    stepClipCycle(state, {
      chatStatus: "ready",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName: "goodbye_a",
      variants,
      delta: MIN_TALK_DWELL_SECONDS + 1,
    });

    const result = stepClipCycle(state, {
      chatStatus: "stopped",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName: "goodbye_a",
      variants,
      delta: 5,
    });

    expect(result).toBeNull();
  });

  it("returns null with fewer than 2 variants, even across many boundary-crossing frames", () => {
    const state = createClipCycleState();
    const variants = ["talk_a"];

    let result: string | null = null;
    let time = 0;
    for (let frame = 0; frame < 5; frame++) {
      time = frame % 2 === 0 ? 0.9 : 0.05; // alternate to trigger wrap detection each pass
      result = stepClipCycle(state, {
        chatStatus: "speaking",
        currentAction: makeStubAction(time, 1.0),
        currentClipName: "talk_a",
        variants,
        delta: MIN_TALK_DWELL_SECONDS,
      });
    }

    expect(result).toBeNull();
  });

  for (const status of CYCLING_STATUSES) {
    it(`cycles for "${status}" using the same prime-frame then wrap-after-dwell pattern (order "sequential")`, () => {
      const state = createClipCycleState();
      const variants = [`${status}_a`, `${status}_b`];

      // Frame 1: prime prevActionTime, still under dwell floor, no boundary yet.
      let result = stepClipCycle(state, {
        chatStatus: status,
        currentAction: makeStubAction(0.1, 1.0),
        currentClipName: `${status}_a`,
        variants,
        delta: 1.0,
        order: "sequential",
      });
      expect(result).toBeNull();

      // Frame 2: dwell now >= MIN_TALK_DWELL_SECONDS, and time wraps (0.9 -> 0.05) = loop boundary.
      result = stepClipCycle(state, {
        chatStatus: status,
        currentAction: makeStubAction(0.05, 1.0),
        currentClipName: `${status}_a`,
        variants,
        delta: 1.5,
        order: "sequential",
      });

      expect(result).toBe(`${status}_b`);
    });
  }

  it("a chatStatus change between two cycling statuses (listening to thinking) resets dwell and prevActionTime, so the first frame after the change can never switch", () => {
    const state = createClipCycleState();
    const listenVariants = ["listen_a", "listen_b"];
    const thinkVariants = ["think_a", "think_b"];

    // Get listening fully primed and past the dwell floor.
    stepClipCycle(state, {
      chatStatus: "listening",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName: "listen_a",
      variants: listenVariants,
      delta: MIN_TALK_DWELL_SECONDS + 1,
    });

    // Switch to thinking with a value that would otherwise read as a loop
    // wrap AND with dwell already over the floor from the accumulation above
    // — the status-change reset must override both.
    const result = stepClipCycle(state, {
      chatStatus: "thinking",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName: "think_a",
      variants: thinkVariants,
      delta: 0.1,
    });

    expect(result).toBeNull();
  });

  it('order "sequential" gives today\'s round-robin (3-variant a -> b -> c -> a) and never returns the currently-playing variant', () => {
    const state = createClipCycleState();
    const variants = ["talk_a", "talk_b", "talk_c"];
    let currentClipName = "talk_a";

    function crossBoundaryAfterDwell(): string | null {
      // Prime.
      stepClipCycle(state, {
        chatStatus: "speaking",
        currentAction: makeStubAction(0.1, 1.0),
        currentClipName,
        variants,
        delta: MIN_TALK_DWELL_SECONDS,
        order: "sequential",
      });
      // Cross the boundary with dwell already satisfied.
      return stepClipCycle(state, {
        chatStatus: "speaking",
        currentAction: makeStubAction(0.05, 1.0),
        currentClipName,
        variants,
        delta: 0.1,
        order: "sequential",
      });
    }

    const first = crossBoundaryAfterDwell();
    expect(first).toBe("talk_b");
    expect(first).not.toBe(currentClipName);
    currentClipName = first as string;

    const second = crossBoundaryAfterDwell();
    expect(second).toBe("talk_c");
    expect(second).not.toBe(currentClipName);
    currentClipName = second as string;

    const third = crossBoundaryAfterDwell();
    expect(third).toBe("talk_a");
    expect(third).not.toBe(currentClipName);
  });

  it('order "random" with a stub rng returns the rng-chosen index and never the current clip', () => {
    const state = createClipCycleState();
    const variants = ["talk_a", "talk_b", "talk_c"];
    const currentClipName = "talk_a";

    // Prime.
    stepClipCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName,
      variants,
      delta: MIN_TALK_DWELL_SECONDS,
      order: "random",
      rng: () => 0.99,
    });
    // Cross the boundary with dwell already satisfied. rng() => 0.99 with
    // currentIndex 0 picks from the length-1=2 slots: idx =
    // min(floor(0.99*2),1)=1, and since idx(1) >= currentIndex(0), +1 => 2.
    const result = stepClipCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName,
      variants,
      delta: 0.1,
      order: "random",
      rng: () => 0.99,
    });

    expect(result).toBe("talk_c");
    expect(result).not.toBe(currentClipName);
  });

  it("minDwellSeconds overrides the floor: with minDwellSeconds 0.5, a boundary at 0.6s dwell switches", () => {
    const state = createClipCycleState();
    const variants = ["talk_a", "talk_b"];

    // Prime.
    stepClipCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName: "talk_a",
      variants,
      delta: 0.3,
      minDwellSeconds: 0.5,
    });

    // Dwell now 0.6s (>= 0.5 floor), boundary crossed.
    const result = stepClipCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName: "talk_a",
      variants,
      delta: 0.3,
      minDwellSeconds: 0.5,
    });

    expect(result).toBe("talk_b");
  });

  it("with the default minDwellSeconds, a boundary at 0.6s dwell does NOT switch", () => {
    const state = createClipCycleState();
    const variants = ["talk_a", "talk_b"];

    stepClipCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName: "talk_a",
      variants,
      delta: 0.3,
    });

    const result = stepClipCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName: "talk_a",
      variants,
      delta: 0.3,
    });

    expect(result).toBeNull();
  });

  it("does NOT switch before the minimum dwell even when a loop boundary is detected early", () => {
    const state = createClipCycleState();
    const variants = ["talk_a", "talk_b"];

    // Frame 1: prime.
    stepClipCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName: "talk_a",
      variants,
      delta: 0.2,
    });

    // Frame 2: loop boundary fires (wrap), but total dwell is only 0.4s — well under the floor.
    const result = stepClipCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName: "talk_a",
      variants,
      delta: 0.2,
    });

    expect(result).toBeNull();
  });

  it("never derives a boundary from the very first speaking frame (no previous time to compare against)", () => {
    const freshState: ClipCycleState = createClipCycleState();
    const result = stepClipCycle(freshState, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.95, 1.0),
      currentClipName: "talk_a",
      variants: ["talk_a", "talk_b"],
      delta: MIN_TALK_DWELL_SECONDS + 1,
    });
    expect(result).toBeNull();
  });
});
