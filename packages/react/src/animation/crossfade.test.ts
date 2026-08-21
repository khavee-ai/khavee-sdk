/**
 * crossfade.test.ts — unit tests for the pose-gap-adaptive eased crossfade
 * engine (XFADE-01). The single highest-signal assertion in this file is
 * that computePoseGapAngle tracks the maximum per-bone quaternion angle,
 * not the mean — see the "max, not the arithmetic mean" test below.
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  beginCrossfade,
  beginOrphanFade,
  computePoseGapAngle,
  easeInOutCubic,
  poseGapToDuration,
  stepCrossfade,
  stepOrphanFade,
  type BlendState,
} from "./crossfade";

describe("easeInOutCubic", () => {
  it("has fixed endpoints and midpoint", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });

  it("is monotonically increasing on [0, 1]", () => {
    let prev = easeInOutCubic(0);
    for (let t = 0.05; t <= 1; t += 0.05) {
      const value = easeInOutCubic(t);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });
});

describe("poseGapToDuration", () => {
  it("maps 0 rad to the 0.3s floor", () => {
    expect(poseGapToDuration(0)).toBeCloseTo(0.3, 5);
  });

  it("maps PI/2 rad to the 0.9s ceiling", () => {
    expect(poseGapToDuration(Math.PI / 2)).toBeCloseTo(0.9, 5);
  });

  it("clamps angles beyond PI/2 to the 0.9s ceiling", () => {
    expect(poseGapToDuration(Math.PI)).toBeCloseTo(0.9, 5);
  });

  it("interpolates linearly between the floor and ceiling", () => {
    const quarter = poseGapToDuration(Math.PI / 4); // half of maxExpectedAngle
    expect(quarter).toBeCloseTo(0.6, 5);
  });

  it("raises the minimum duration when floorSeconds is provided", () => {
    expect(poseGapToDuration(0, 1.2)).toBeGreaterThanOrEqual(1.2);
    expect(poseGapToDuration(Math.PI / 2, 1.2)).toBeGreaterThanOrEqual(1.2);
  });

  it("leaves default 0.3-0.9s behavior intact when floorSeconds is undefined", () => {
    expect(poseGapToDuration(0, undefined)).toBeCloseTo(0.3, 5);
  });
});

describe("computePoseGapAngle", () => {
  function buildScene() {
    const scene = new THREE.Object3D();
    const boneA = new THREE.Object3D();
    boneA.name = "boneA";
    const boneB = new THREE.Object3D();
    boneB.name = "boneB";
    scene.add(boneA);
    scene.add(boneB);
    return { scene, boneA, boneB };
  }

  function quaternionTrack(name: string, angleRad: number, axis: THREE.Vector3) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angleRad);
    return new THREE.QuaternionKeyframeTrack(name, [0], [q.x, q.y, q.z, q.w]);
  }

  it("returns the MAXIMUM per-bone angle, not the mean across bones", () => {
    const { scene } = buildScene();
    // boneA's live vs. target quaternion differ by ~0.05rad.
    // boneB's live vs. target quaternion differ by ~1.98rad (~113 degrees).
    const smallAngle = 0.05;
    const largeAngle = 1.98;
    const trackA = quaternionTrack("boneA.quaternion", smallAngle, new THREE.Vector3(1, 0, 0));
    const trackB = quaternionTrack("boneB.quaternion", largeAngle, new THREE.Vector3(0, 1, 0));
    const clip = new THREE.AnimationClip("test", -1, [trackA, trackB]);

    const result = computePoseGapAngle(scene, clip);
    const meanOfBoth = (smallAngle + largeAngle) / 2;

    expect(result).toBeCloseTo(largeAngle, 2);
    expect(result).toBeGreaterThan(meanOfBoth);
    expect(result).not.toBeCloseTo(meanOfBoth, 2);
  });

  it("ignores tracks that are not .quaternion tracks", () => {
    const { scene } = buildScene();
    const trackA = quaternionTrack("boneA.quaternion", 0.3, new THREE.Vector3(1, 0, 0));
    const positionTrack = new THREE.VectorKeyframeTrack("boneA.position", [0], [1, 2, 3]);
    const clip = new THREE.AnimationClip("test", -1, [trackA, positionTrack]);

    const result = computePoseGapAngle(scene, clip);
    expect(result).toBeCloseTo(0.3, 2);
  });

  it("ignores quaternion tracks whose bone is absent from the scene, returning 0 when nothing resolves", () => {
    const { scene } = buildScene();
    const trackC = quaternionTrack("boneC.quaternion", 1.2, new THREE.Vector3(0, 0, 1));
    const clip = new THREE.AnimationClip("test", -1, [trackC]);

    const result = computePoseGapAngle(scene, clip);
    expect(result).toBe(0);
  });
});

describe("beginCrossfade / stepCrossfade", () => {
  function makeStubAction(clip: THREE.AnimationClip) {
    return {
      reset: vi.fn().mockReturnThis(),
      enabled: false,
      play: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      setEffectiveWeight: vi.fn(),
      getEffectiveWeight: () => 1,
      // Never "already running" — these stubs model the ordinary,
      // non-interrupted case (see the dedicated stateful-stub describe
      // block below for the interrupted-crossfade weight-seeding tests).
      isRunning: () => false,
      getClip: () => clip,
    } as unknown as THREE.AnimationAction;
  }

  it("performs .enabled = true and .play() around setEffectiveWeight(0) when starting a blend", () => {
    const scene = new THREE.Object3D();
    const clip = new THREE.AnimationClip("target", -1, []);
    const toAction = makeStubAction(clip);
    const fromAction = makeStubAction(new THREE.AnimationClip("from", -1, []));

    const blend = beginCrossfade(fromAction, toAction, scene);

    expect(toAction.reset).toHaveBeenCalled();
    expect(toAction.enabled).toBe(true);
    expect(toAction.play).toHaveBeenCalled();
    expect(toAction.setEffectiveWeight).toHaveBeenCalledWith(0);
    expect(blend.active).toBe(true);
    expect(blend.to).toBe(toAction);
    expect(blend.from).toBe(fromAction);
    expect(blend.duration).toBeCloseTo(0.3, 5); // empty clip -> 0 pose gap -> floor duration
  });

  it("applies a floorSeconds minimum to the computed blend duration", () => {
    const scene = new THREE.Object3D();
    const clip = new THREE.AnimationClip("target", -1, []);
    const toAction = makeStubAction(clip);

    const blend = beginCrossfade(null, toAction, scene, 1.5);
    expect(blend.duration).toBeGreaterThanOrEqual(1.5);
  });

  it("ramps weights with easeInOutCubic and completes the blend at t>=1", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(0);

    const scene = new THREE.Object3D();
    const clip = new THREE.AnimationClip("target", -1, []);
    const toAction = makeStubAction(clip);
    const fromAction = makeStubAction(new THREE.AnimationClip("from", -1, []));

    const blend = beginCrossfade(fromAction, toAction, scene); // duration 0.3s

    // Halfway through the blend.
    nowSpy.mockReturnValue(150);
    stepCrossfade(blend);
    const halfwayEased = easeInOutCubic(0.5);
    expect(toAction.setEffectiveWeight).toHaveBeenLastCalledWith(halfwayEased);
    expect(fromAction.setEffectiveWeight).toHaveBeenLastCalledWith(1 - halfwayEased);
    expect(blend.active).toBe(true);

    // Past the end of the blend.
    nowSpy.mockReturnValue(400);
    stepCrossfade(blend);
    expect(toAction.setEffectiveWeight).toHaveBeenLastCalledWith(1);
    expect(fromAction.stop).toHaveBeenCalled();
    expect(blend.active).toBe(false);

    nowSpy.mockRestore();
  });

  it("does nothing when the blend is not active", () => {
    const inactive: BlendState = {
      active: false,
      from: null,
      to: null,
      startTime: 0,
      duration: 0.3,
      fromStartWeight: 0,
      toStartWeight: 0,
    };
    expect(() => stepCrossfade(inactive)).not.toThrow();
  });
});

describe("interrupted crossfade preserves total accumulated weight (T-pose/bind-pose snap fix)", () => {
  // Debug session: .planning/debug/tpose-snap-speak-toggle.md. A stateful
  // stub (unlike the vi.fn()-only stubs above) is required here because this
  // test reads back setEffectiveWeight/isRunning state, not just call args --
  // beginCrossfade's fix depends on inspecting toAction's ACTUAL current
  // weight/running state before deciding where to seed the new ramp from.
  function makeStatefulStubAction(clip: THREE.AnimationClip) {
    let weight = 1;
    let running = false;
    const action = {
      reset: vi.fn().mockReturnThis(),
      enabled: false,
      play: vi.fn(() => {
        running = true;
        return action;
      }),
      stop: vi.fn(() => {
        running = false;
        return action;
      }),
      setEffectiveWeight: vi.fn((w: number) => {
        weight = w;
      }),
      getEffectiveWeight: () => weight,
      isRunning: () => running,
      getClip: () => clip,
    };
    return action as unknown as THREE.AnimationAction;
  }

  it("keeps total weight continuous when a second beginCrossfade interrupts the first before it settles (t<1)", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(0);

    const scene = new THREE.Object3D();
    const idleAction = makeStatefulStubAction(new THREE.AnimationClip("idle", -1, []));
    const talkAction = makeStatefulStubAction(new THREE.AnimationClip("talking", -1, []));

    // Steady state: idle fully settled at weight 1, no crossfade active --
    // mirrors the real "idle playing" starting point before speaking begins.
    idleAction.play();
    idleAction.setEffectiveWeight(1);

    // Enter speaking: idle -> talking (mirrors switchToClip's real
    // beginCrossfade(currentActionRef.current, toAction, root, floor) call).
    const blend1 = beginCrossfade(idleAction, talkAction, scene);

    // Advance partway through the blend (t=0.3) -- NEITHER action has
    // reached its target weight yet.
    nowSpy.mockReturnValue(blend1.duration * 1000 * 0.3);
    stepCrossfade(blend1);
    const idleWeightMidBlend = idleAction.getEffectiveWeight();
    const talkWeightMidBlend = talkAction.getEffectiveWeight();
    expect(idleWeightMidBlend).toBeGreaterThan(0);
    expect(talkWeightMidBlend).toBeGreaterThan(0);
    expect(idleWeightMidBlend + talkWeightMidBlend).toBeCloseTo(1, 5);

    // Interrupt: exit speaking before blend1 ever reaches t>=1 (a quick
    // chatStatus toggle / short utterance). switchToClip's real call is
    // beginCrossfade(currentActionRef.current, toAction, root, floor) --
    // currentActionRef.current is talkAction (blend1's incoming leg), and
    // toAction is idleAction again.
    const blend2 = beginCrossfade(talkAction, idleAction, scene);

    // Read weights EXACTLY as they stand the instant beginCrossfade
    // returns -- i.e. before stepCrossfade(blend2) has ever run. This is
    // precisely what VRMAvatar's next mixer.update() call renders if
    // switchToClip fires between two useFrame ticks (mixer.update runs
    // before controller.update/stepCrossfade every frame).
    const idleWeightAfterInterrupt = idleAction.getEffectiveWeight();
    const talkWeightAfterInterrupt = talkAction.getEffectiveWeight();
    const totalAfterInterrupt = idleWeightAfterInterrupt + talkWeightAfterInterrupt;

    // Total weight must be preserved across the interruption -- no cliff.
    // Before the fix, beginCrossfade force-set idleAction (the new toAction)
    // to a hardcoded 0 even though it was still contributing
    // idleWeightMidBlend (~0.78) of real weight, dropping total weight to
    // ~talkWeightMidBlend (~0.22) for this frame -- the T-pose/bind-pose
    // flash (THREE's PropertyMixer fills the missing ~0.78 with the bind
    // pose when accumulated weight is under 1).
    expect(totalAfterInterrupt).toBeCloseTo(idleWeightMidBlend + talkWeightMidBlend, 5);
    expect(blend2.duration).toBeGreaterThan(0);

    nowSpy.mockRestore();
  });
});

describe("beginOrphanFade / stepOrphanFade (T-pose/bind-pose snap fix, part 3)", () => {
  // Debug session follow-up: .planning/debug/tpose-snap-speak-toggle.md
  // ("Follow-up (2026-08-21): part 3"). A stateful stub is required here for
  // the same reason as the "interrupted crossfade" describe block above --
  // these functions read back setEffectiveWeight/isRunning state, not just
  // call args.
  function makeStatefulStubAction(clip: THREE.AnimationClip) {
    let weight = 1;
    let running = false;
    const action = {
      reset: vi.fn().mockReturnThis(),
      enabled: false,
      play: vi.fn(() => {
        running = true;
        return action;
      }),
      stop: vi.fn(() => {
        running = false;
        return action;
      }),
      setEffectiveWeight: vi.fn((w: number) => {
        weight = w;
      }),
      getEffectiveWeight: () => weight,
      isRunning: () => running,
      getClip: () => clip,
    };
    return action as unknown as THREE.AnimationAction;
  }

  it("beginOrphanFade captures the orphan's ACTUAL current weight, not an assumed 1", () => {
    const action = makeStatefulStubAction(new THREE.AnimationClip("orphan", -1, []));
    action.play();
    action.setEffectiveWeight(0.42); // mid-ramp from an earlier interrupted blend

    const fade = beginOrphanFade(action, 0.5);
    expect(fade.startWeight).toBeCloseTo(0.42, 5);
    expect(fade.action).toBe(action);
    expect(fade.duration).toBe(0.5);
  });

  it("beginOrphanFade captures 0 for an action that is not running", () => {
    const action = makeStatefulStubAction(new THREE.AnimationClip("orphan", -1, []));
    const fade = beginOrphanFade(action, 0.5);
    expect(fade.startWeight).toBe(0);
  });

  it("stepOrphanFade ramps weight to 0 with easeInOutCubic and stops the action only at completion, not before", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(0);

    const action = makeStatefulStubAction(new THREE.AnimationClip("orphan", -1, []));
    action.play();
    action.setEffectiveWeight(0.89);

    const fade = beginOrphanFade(action, 0.4);

    // Partway through the fade: weight decays smoothly, action NOT yet stopped.
    nowSpy.mockReturnValue(120); // t = 0.3 of a 0.4s fade
    let done = stepOrphanFade(fade);
    expect(done).toBe(false);
    expect(action.stop).not.toHaveBeenCalled();
    const eased = easeInOutCubic(0.3);
    expect(action.getEffectiveWeight()).toBeCloseTo(0.89 * (1 - eased), 5);
    expect(action.getEffectiveWeight()).toBeGreaterThan(0);

    // Past the end of the fade: weight reaches 0, action IS stopped, and the
    // fade reports itself complete so the caller can discard it.
    nowSpy.mockReturnValue(500);
    done = stepOrphanFade(fade);
    expect(done).toBe(true);
    expect(action.getEffectiveWeight()).toBe(0);
    expect(action.stop).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("3+-deep interruption chain: the orphan's weight decays smoothly instead of dropping to 0 in one frame", () => {
    // Mirrors AnimationStateEngine.test.ts's "3+-deep interruption chain"
    // scenario at the exact instant the SECOND interruption identifies an
    // orphan (talkAction, at ~0.89 weight, blend2 only 30% through) -- this
    // is precisely the frame where the OLD `.stop()`-immediately approach
    // dropped total mixer weight to ~0.11 (talk1Action's weight alone),
    // reproducing the T-pose flash. With this fix, talkAction should still
    // be contributing real, non-zero weight to the mixer this same frame.
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(0);

    const scene = new THREE.Object3D();
    const talkAction = makeStatefulStubAction(new THREE.AnimationClip("talking", -1, []));
    const talk1Action = makeStatefulStubAction(new THREE.AnimationClip("talking1", -1, []));

    // talkAction is blend2's settled `from`, mid-fade-out at ~0.89 (t=0.3 of
    // a blend2 that started at fromStartWeight=1).
    talkAction.play();
    talkAction.setEffectiveWeight(0.89);
    // talk1Action is blend2's `to`, correspondingly at ~0.11.
    talk1Action.play();
    talk1Action.setEffectiveWeight(0.11);

    // The third switch orphans talkAction and starts its fade-out over the
    // new (idle-bound) blend's duration -- 0.3s here for simplicity.
    const fade = beginOrphanFade(talkAction, 0.3);

    // Read weights EXACTLY as they stand the instant beginOrphanFade
    // returns, before any stepOrphanFade call -- this is what the very next
    // mixer.update() renders.
    expect(talkAction.getEffectiveWeight()).toBeCloseTo(0.89, 5); // NOT dropped to 0
    const totalAfterOrphaning = talkAction.getEffectiveWeight() + talk1Action.getEffectiveWeight();
    expect(totalAfterOrphaning).toBeCloseTo(1, 5);

    nowSpy.mockRestore();
    void fade;
  });
});
