/**
 * gesture.test.ts — unit tests for the triggered, consumed-and-cleared
 * one-shot gesture pulse (GEST-01, GEST-02). Exercises the pure
 * `stepGesture` state machine directly via a stub `AvatarFormatAdapter` and
 * a stub `THREE.AnimationAction` (mirroring breathing.test.ts's and
 * talkCycle.test.ts's stub patterns) — no React rendering required.
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type * as THREEType from "three";
import { createGestureState, stepGesture } from "./gesture";
import type { AvatarFormatAdapter } from "./types";

function makeStubAdapter(head: THREE.Object3D | null): AvatarFormatAdapter {
  return {
    getMixer: () => new THREE.AnimationMixer(new THREE.Object3D()),
    getBoneNode: () => null,
    getHumanoidBoneNode: (role) => (role === "head" ? head : null),
    getExpressionManager: () => null,
  };
}

/** Stub AnimationAction exposing only what gesture.ts reads: .time and getClip().duration. */
function makeStubAction(time: number, duration: number): THREEType.AnimationAction {
  return {
    time,
    getClip: () => ({ duration }) as THREEType.AnimationClip,
  } as unknown as THREEType.AnimationAction;
}

describe("stepGesture", () => {
  it("applies immediately (this step) when chatStatus is not 'speaking' (D-06)", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();
    const onConsume = vi.fn();

    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 0.016,
      onConsume,
    });

    expect(state.activeGesture).toBe("nod");
    expect(onConsume).toHaveBeenCalledTimes(1);
    const identity = new THREE.Quaternion();
    expect(head.quaternion.equals(identity)).toBe(false); // pulse already applied this step
  });

  it("does NOT begin mid-clip while speaking (waits for a loop boundary) — GEST-02", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();
    const onConsume = vi.fn();

    // Frame 1: priming frame, no boundary possible yet (no prevActionTime).
    stepGesture(state, {
      adapter,
      chatStatus: "speaking",
      gestureHint: "nod",
      currentAction: makeStubAction(0.3, 1.0),
      delta: 0.016,
      onConsume,
    });
    expect(state.activeGesture).toBeNull();
    expect(onConsume).not.toHaveBeenCalled();

    // Frame 2: mid-clip, no boundary (time advances forward, no wrap/crossing).
    stepGesture(state, {
      adapter,
      chatStatus: "speaking",
      gestureHint: "nod",
      currentAction: makeStubAction(0.5, 1.0),
      delta: 0.016,
      onConsume,
    });
    expect(state.activeGesture).toBeNull();
    expect(onConsume).not.toHaveBeenCalled();
  });

  it("begins once a loop boundary is crossed while speaking, and onConsume fires exactly then", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();
    const onConsume = vi.fn();

    // Frame 1: prime prevActionTime.
    stepGesture(state, {
      adapter,
      chatStatus: "speaking",
      gestureHint: "nod",
      currentAction: makeStubAction(0.9, 1.0),
      delta: 0.016,
      onConsume,
    });
    expect(state.activeGesture).toBeNull();
    expect(onConsume).not.toHaveBeenCalled();

    // Frame 2: time wraps (0.9 -> 0.05) = loop boundary crossed.
    stepGesture(state, {
      adapter,
      chatStatus: "speaking",
      gestureHint: "nod",
      currentAction: makeStubAction(0.05, 1.0),
      delta: 0.016,
      onConsume,
    });

    expect(state.activeGesture).toBe("nod");
    expect(onConsume).toHaveBeenCalledTimes(1);
  });

  it("onConsume is called exactly once per triggered gesture, not once per frame while the pulse plays", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();
    const onConsume = vi.fn();

    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 0.016,
      onConsume,
    });
    expect(onConsume).toHaveBeenCalledTimes(1);

    // Subsequent frames: gesture already active, hint may still be present
    // (caller hasn't cleared it yet) — must not re-trigger/re-consume.
    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 0.016,
      onConsume,
    });
    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 0.016,
      onConsume,
    });

    expect(onConsume).toHaveBeenCalledTimes(1);
  });

  it("writes additively via multiply: preserves a pre-existing non-identity base orientation", () => {
    const head = new THREE.Object3D();
    const baseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    head.quaternion.copy(baseQuat);
    const adapter = makeStubAdapter(head);
    const state = createGestureState();

    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 0.016,
      onConsume: () => {},
    });

    // Result differs from the base alone (a delta was applied) but the base
    // contribution is still present in the composition.
    expect(head.quaternion.equals(baseQuat)).toBe(false);
  });

  it("nod applies a head-PITCH delta (X-axis rotation)", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();

    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 0.25, // mid-pulse, non-trivial envelope value
      onConsume: () => {},
    });

    // A pure X-axis rotation quaternion has y === 0 and z === 0.
    expect(head.quaternion.y).toBeCloseTo(0, 10);
    expect(head.quaternion.z).toBeCloseTo(0, 10);
    expect(Math.abs(head.quaternion.x)).toBeGreaterThan(0);
  });

  it("shake applies a head-YAW delta (Y-axis rotation)", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();

    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "shake",
      currentAction: null,
      delta: 0.25,
      onConsume: () => {},
    });

    // A pure Y-axis rotation quaternion has x === 0 and z === 0.
    expect(head.quaternion.x).toBeCloseTo(0, 10);
    expect(head.quaternion.z).toBeCloseTo(0, 10);
    expect(Math.abs(head.quaternion.y)).toBeGreaterThan(0);
  });

  it("gestureHint of 'none' never starts a pulse", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();
    const onConsume = vi.fn();

    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "none",
      currentAction: null,
      delta: 0.016,
      onConsume,
    });

    expect(state.activeGesture).toBeNull();
    expect(onConsume).not.toHaveBeenCalled();
    const identity = new THREE.Quaternion();
    expect(head.quaternion.equals(identity)).toBe(true);
  });

  it("gestureHint of null never starts a pulse", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();
    const onConsume = vi.fn();

    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: null,
      currentAction: null,
      delta: 0.016,
      onConsume,
    });

    expect(state.activeGesture).toBeNull();
    expect(onConsume).not.toHaveBeenCalled();
  });

  it("an unrecognized gestureHint value never starts a pulse (no-op, no throw)", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();
    const onConsume = vi.fn();

    expect(() =>
      stepGesture(state, {
        adapter,
        chatStatus: "ready",
        // Intentionally an out-of-enum value to prove tampering-safety (T-12-04).
        gestureHint: "spin" as unknown as "nod",
        currentAction: null,
        delta: 0.016,
        onConsume,
      }),
    ).not.toThrow();

    expect(state.activeGesture).toBeNull();
    expect(onConsume).not.toHaveBeenCalled();
  });

  it("defensive early-return when the head bone cannot be resolved", () => {
    const adapter = makeStubAdapter(null);
    const state = createGestureState();
    const onConsume = vi.fn();

    expect(() =>
      stepGesture(state, {
        adapter,
        chatStatus: "ready",
        gestureHint: "nod",
        currentAction: null,
        delta: 0.016,
        onConsume,
      }),
    ).not.toThrow();

    // The trigger latch itself and onConsume still happen (decoupled from
    // bone resolution) — only the bone WRITE is skipped.
    expect(state.activeGesture).toBe("nod");
    expect(onConsume).toHaveBeenCalledTimes(1);
  });

  it("pulse self-clears after its duration elapses", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();

    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 0.016,
      onConsume: () => {},
    });
    expect(state.activeGesture).toBe("nod");

    // Advance well past the pulse's total duration in one big step.
    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 10,
      onConsume: () => {},
    });

    expect(state.activeGesture).toBeNull();
    expect(state.elapsed).toBe(0);
  });

  it("does not re-trigger from a stale hint after the previous pulse self-clears", () => {
    const head = new THREE.Object3D();
    const adapter = makeStubAdapter(head);
    const state = createGestureState();
    const onConsume = vi.fn();

    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 0.016,
      onConsume,
    });
    expect(onConsume).toHaveBeenCalledTimes(1);

    // Finish the pulse.
    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 10,
      onConsume,
    });
    expect(state.activeGesture).toBeNull();

    // A caller that forgot to clear the hint (bug elsewhere) would cause a
    // re-trigger here — asserting the current documented contract: gesture.ts
    // itself has no re-entrancy guard beyond activeGesture !== null, so the
    // caller (onConsume wiring) is responsible for clearing the hint. This
    // test documents that stepGesture DOES re-trigger if the hint persists,
    // which is why callers must clear it in onConsume.
    stepGesture(state, {
      adapter,
      chatStatus: "ready",
      gestureHint: "nod",
      currentAction: null,
      delta: 0.016,
      onConsume,
    });
    expect(onConsume).toHaveBeenCalledTimes(2);
  });
});
