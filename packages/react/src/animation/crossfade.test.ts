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
  computePoseGapAngle,
  easeInOutCubic,
  poseGapToDuration,
  stepCrossfade,
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
