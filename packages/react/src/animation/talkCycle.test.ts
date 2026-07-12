/**
 * talkCycle.test.ts — unit tests for the loop-boundary-driven talk-variant
 * cycler (TALK-01). Exercises the pure `stepTalkCycle` state machine
 * directly (mirroring crossfade.test.ts's stub-action pattern) rather than
 * `useTalkCycle()` itself, since the hook is a thin `useRef` wrapper with no
 * behavior of its own beyond delegating to `stepTalkCycle`.
 */

import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import {
  createTalkCycleState,
  MIN_TALK_DWELL_SECONDS,
  nextVariantIndex,
  stepTalkCycle,
  type TalkCycleState,
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

describe("stepTalkCycle", () => {
  it("returns null when chatStatus is not 'speaking', even with a loop boundary and dwell satisfied", () => {
    const state = createTalkCycleState();
    const variants = ["talk_a", "talk_b"];

    // Prime prevActionTime as if we had been speaking...
    stepTalkCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName: "talk_a",
      speakingVariants: variants,
      delta: MIN_TALK_DWELL_SECONDS + 1,
    });

    // ...then switch away from speaking with a value that would otherwise
    // read as a loop wrap.
    const result = stepTalkCycle(state, {
      chatStatus: "listening",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName: "talk_a",
      speakingVariants: variants,
      delta: 5,
    });

    expect(result).toBeNull();
  });

  it("returns null with fewer than 2 speaking variants, even across many boundary-crossing frames", () => {
    const state = createTalkCycleState();
    const variants = ["talk_a"];

    let result: string | null = null;
    let time = 0;
    for (let frame = 0; frame < 5; frame++) {
      time = frame % 2 === 0 ? 0.9 : 0.05; // alternate to trigger wrap detection each pass
      result = stepTalkCycle(state, {
        chatStatus: "speaking",
        currentAction: makeStubAction(time, 1.0),
        currentClipName: "talk_a",
        speakingVariants: variants,
        delta: MIN_TALK_DWELL_SECONDS,
      });
    }

    expect(result).toBeNull();
  });

  it("returns the NEXT variant only once a loop boundary is crossed AND the ~2s minimum dwell has elapsed", () => {
    const state = createTalkCycleState();
    const variants = ["talk_a", "talk_b"];

    // Frame 1: prime prevActionTime, still under dwell floor, no boundary yet.
    let result = stepTalkCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName: "talk_a",
      speakingVariants: variants,
      delta: 1.0,
    });
    expect(result).toBeNull();

    // Frame 2: dwell now >= MIN_TALK_DWELL_SECONDS, and time wraps (0.9 -> 0.05) = loop boundary.
    result = stepTalkCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName: "talk_a",
      speakingVariants: variants,
      delta: 1.5,
    });

    expect(result).toBe("talk_b");
  });

  it("does NOT switch before the minimum dwell even when a loop boundary is detected early", () => {
    const state = createTalkCycleState();
    const variants = ["talk_a", "talk_b"];

    // Frame 1: prime.
    stepTalkCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.1, 1.0),
      currentClipName: "talk_a",
      speakingVariants: variants,
      delta: 0.2,
    });

    // Frame 2: loop boundary fires (wrap), but total dwell is only 0.4s — well under the floor.
    const result = stepTalkCycle(state, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.05, 1.0),
      currentClipName: "talk_a",
      speakingVariants: variants,
      delta: 0.2,
    });

    expect(result).toBeNull();
  });

  it("advances round-robin across 3+ variants and never returns the currently-playing variant", () => {
    const state = createTalkCycleState();
    const variants = ["talk_a", "talk_b", "talk_c"];
    let currentClipName = "talk_a";

    function crossBoundaryAfterDwell(): string | null {
      // Prime.
      stepTalkCycle(state, {
        chatStatus: "speaking",
        currentAction: makeStubAction(0.1, 1.0),
        currentClipName,
        speakingVariants: variants,
        delta: MIN_TALK_DWELL_SECONDS,
      });
      // Cross the boundary with dwell already satisfied.
      return stepTalkCycle(state, {
        chatStatus: "speaking",
        currentAction: makeStubAction(0.05, 1.0),
        currentClipName,
        speakingVariants: variants,
        delta: 0.1,
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

  it("never derives a boundary from the very first speaking frame (no previous time to compare against)", () => {
    const freshState: TalkCycleState = createTalkCycleState();
    const result = stepTalkCycle(freshState, {
      chatStatus: "speaking",
      currentAction: makeStubAction(0.95, 1.0),
      currentClipName: "talk_a",
      speakingVariants: ["talk_a", "talk_b"],
      delta: MIN_TALK_DWELL_SECONDS + 1,
    });
    expect(result).toBeNull();
  });
});
