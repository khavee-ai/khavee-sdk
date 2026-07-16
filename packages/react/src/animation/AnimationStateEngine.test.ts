/**
 * AnimationStateEngine.test.ts — unit tests for `resolveBaseClip`, the pure
 * chatStatus/manual-animate -> base-clip resolver. `useAnimationController`
 * itself is verified by build here (tsc --noEmit) and by integration in
 * 10-03/10-04, where it's exercised through real R3F components.
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  resolveBaseClip,
  shouldRunProceduralBoneWrites,
  resetToRestPoseIfNotDriven,
  type RestPoseAnchor,
} from "./AnimationStateEngine";
import { createBreathingState, stepBreathing } from "./breathing";
import { createSwayState, stepSway } from "./sway";
import { beginCrossfade, stepCrossfade, easeInOutCubic } from "./crossfade";
import type { AvatarFormatAdapter } from "./types";

describe("resolveBaseClip", () => {
  it("speaking: prefers a talk/gesture/speak-named clip when one exists", () => {
    const result = resolveBaseClip("speaking", "idle", ["idle", "talk_01", "wave"]);
    expect(result).toBe("talk_01");
  });

  it("speaking: falls back to currentAnimation when no talk clip exists", () => {
    const result = resolveBaseClip("speaking", "idle", ["idle", "wave"]);
    expect(result).toBe("idle");
  });

  it("ready: returns currentAnimation when set and no available clip matches the ready pattern", () => {
    // Fixture deliberately avoids "idle"/"ready"/"rest"-named clips (Task 1
    // added a `ready` STATUS_CLIP_PATTERNS entry — see the precedence
    // regression test below) so this exercises the fallback branch, not the
    // pattern-match branch.
    const result = resolveBaseClip("ready", "wave", ["custom1", "wave"]);
    expect(result).toBe("wave");
  });

  it("listening: returns currentAnimation when set", () => {
    const result = resolveBaseClip("listening", "idle", ["idle", "talk_01"]);
    expect(result).toBe("idle");
  });

  it("listening: prefers a listen-named clip when one exists", () => {
    const result = resolveBaseClip("listening", "idle", ["idle", "listen_loop"]);
    expect(result).toBe("listen_loop");
  });

  it("listening: falls back to currentAnimation when no listen clip exists", () => {
    const result = resolveBaseClip("listening", "idle", ["idle", "talk_01"]);
    expect(result).toBe("idle");
  });

  it("thinking: returns currentAnimation when set", () => {
    const result = resolveBaseClip("thinking", "idle", ["idle", "talk_01"]);
    expect(result).toBe("idle");
  });

  it("thinking: prefers a think-named clip when one exists", () => {
    const result = resolveBaseClip("thinking", "idle", ["idle", "think_pose"]);
    expect(result).toBe("think_pose");
  });

  it("thinking: falls back to currentAnimation when no think clip exists", () => {
    const result = resolveBaseClip("thinking", "idle", ["idle", "talk_01"]);
    expect(result).toBe("idle");
  });

  it("starting: returns currentAnimation when set", () => {
    const result = resolveBaseClip("starting", "greet", ["idle", "greet"]);
    expect(result).toBe("greet");
  });

  it("starting: prefers a welcome/greet-named clip when one exists", () => {
    const result = resolveBaseClip("starting", "idle", ["idle", "welcome_wave"]);
    expect(result).toBe("welcome_wave");
  });

  it("stopped: returns currentAnimation when set", () => {
    const result = resolveBaseClip("stopped", "idle", ["idle", "talk_01"]);
    expect(result).toBe("idle");
  });

  it("stopped: prefers a stop/bye-named clip when one exists", () => {
    const result = resolveBaseClip("stopped", "idle", ["idle", "goodbye_wave"]);
    expect(result).toBe("goodbye_wave");
  });

  it("stopped: falls back to currentAnimation when no stop clip exists", () => {
    const result = resolveBaseClip("stopped", "idle", ["idle", "talk_01"]);
    expect(result).toBe("idle");
  });

  it("null currentAnimation falls back to availableNames[0]", () => {
    const result = resolveBaseClip("ready", null, ["idle", "wave"]);
    expect(result).toBe("idle");
  });

  it("empty availableNames + null currentAnimation returns null", () => {
    const result = resolveBaseClip("ready", null, []);
    expect(result).toBeNull();
  });

  it("ready: resolves a conventionally-named idle-loop clip via the new ready pattern", () => {
    const result = resolveBaseClip("ready", null, ["State 1 Idle (loop)", "Pose"]);
    expect(result).toBe("State 1 Idle (loop)");
  });

  it("speaking: resolves happy.glb's 'Taking' placeholder clip via the extended speaking regex", () => {
    const result = resolveBaseClip("speaking", null, ["State 4 Taking (loop)"]);
    expect(result).toBe("State 4 Taking (loop)");
  });

  it("ready-pattern precedence regression: a non-matching explicit currentAnimation still wins over availableNames when no clip matches /idle|ready|rest/i", () => {
    // "customAnim42" deliberately does NOT match /idle|ready|rest/i (unlike
    // e.g. "customIdleName", which would wrongly pass via the pattern-match
    // branch instead of exercising the fallback). This proves the added
    // `ready` pattern is additive, not a silent override of an app's
    // explicit, non-matching currentAnimation choice.
    const result = resolveBaseClip("ready", "customAnim42", ["customAnim42", "OtherClip"]);
    expect(result).toBe("customAnim42");
  });
});

describe("shouldRunProceduralBoneWrites (11-09 first-load spin fix)", () => {
  it("returns false when action is null (no base action has switched in yet)", () => {
    expect(shouldRunProceduralBoneWrites(null)).toBe(false);
  });

  it("returns false when action's effective weight is below the near-zero threshold (early crossfade ramp)", () => {
    const action = { getEffectiveWeight: () => 0.01 } as unknown as THREE.AnimationAction;
    expect(shouldRunProceduralBoneWrites(action)).toBe(false);
  });

  it("returns true once action's effective weight has ramped past the threshold", () => {
    const action = { getEffectiveWeight: () => 0.5 } as unknown as THREE.AnimationAction;
    expect(shouldRunProceduralBoneWrites(action)).toBe(true);
  });

  it("returns true at full weight (steady-state idle)", () => {
    const action = { getEffectiveWeight: () => 1 } as unknown as THREE.AnimationAction;
    expect(shouldRunProceduralBoneWrites(action)).toBe(true);
  });
});

describe("first-mount procedural-write accumulation repro (11-09)", () => {
  it("without a per-frame base-pose reset, breathing+sway deltas compound to a larger net spine rotation than when the base resets the bone every frame", () => {
    // This reproduces the mechanism the file-header 11-09 diagnosis block
    // describes: in steady state, the mixer (effective weight ~1) fully
    // re-writes the spine bone every frame BEFORE breathing/sway run,
    // discarding the previous frame's procedural delta -- so each frame's
    // combined breathing+sway delta is bounded and never compounds. During
    // the first-mount near-zero-weight window, that reset does not happen,
    // so successive frames' non-commuting (different-axis) rotations
    // accumulate instead of oscillating around a resting pose.
    const identity = new THREE.Quaternion();

    function runFrames(resetSpineEachFrame: boolean): number {
      const spine = new THREE.Object3D();
      const chest = new THREE.Object3D();
      const hips = new THREE.Object3D();
      const adapter: AvatarFormatAdapter = {
        getMixer: () => {
          throw new Error("not used in this test");
        },
        getBoneNode: () => null,
        getHumanoidBoneNode: (role) => {
          if (role === "spine") return spine;
          if (role === "chest") return chest;
          if (role === "hips") return hips;
          return null;
        },
        getExpressionManager: () => null,
      };

      const breathingState = createBreathingState();
      breathingState.period = 5.0;
      const swayState = createSwayState();
      swayState.period = 8.0;
      const delta = 1 / 30;

      for (let i = 0; i < 60; i++) {
        if (resetSpineEachFrame) {
          // Simulates the mixer fully re-driving the bone this frame
          // (effective weight ~1 steady state) before breathing/sway run.
          spine.quaternion.identity();
        }
        stepBreathing(breathingState, adapter, delta);
        stepSway(swayState, adapter, delta);
      }

      return spine.quaternion.angleTo(identity);
    }

    const withoutReset = runFrames(false);
    const withReset = runFrames(true);

    expect(withoutReset).toBeGreaterThan(withReset);
  });
});

describe("resetToRestPoseIfNotDriven (11-11 gap closure)", () => {
  function makeBones() {
    return {
      spine: new THREE.Object3D(),
      chest: new THREE.Object3D(),
      hips: new THREE.Object3D(),
    };
  }

  it("no-ops when isBaseActionDriving is true (mixer already wrote this frame's pose)", () => {
    const bones = makeBones();
    bones.spine.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    const before = bones.spine.quaternion.clone();
    const restPose: RestPoseAnchor = {
      spine: new THREE.Quaternion(),
      chest: new THREE.Quaternion(),
      hips: new THREE.Quaternion(),
    };

    resetToRestPoseIfNotDriven(bones, restPose, true);

    expect(bones.spine.quaternion.equals(before)).toBe(true);
  });

  it("no-ops when restPose is null (anchor not yet captured)", () => {
    const bones = makeBones();
    bones.spine.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    const before = bones.spine.quaternion.clone();

    resetToRestPoseIfNotDriven(bones, null, false);

    expect(bones.spine.quaternion.equals(before)).toBe(true);
  });

  it("resets spine/chest/hips to the anchor when isBaseActionDriving is false", () => {
    const bones = makeBones();
    // Simulate bones left drifted from a prior frame's procedural writes.
    bones.spine.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
    bones.chest.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2);
    bones.hips.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4);

    const restPose: RestPoseAnchor = {
      spine: new THREE.Quaternion(),
      chest: new THREE.Quaternion(),
      hips: new THREE.Quaternion(),
    };

    resetToRestPoseIfNotDriven(bones, restPose, false);

    expect(bones.spine.quaternion.equals(restPose.spine)).toBe(true);
    expect(bones.chest.quaternion.equals(restPose.chest)).toBe(true);
    expect(bones.hips.quaternion.equals(restPose.hips)).toBe(true);
  });
});

describe("G1 fix — visible idle motion during a persistently near-zero-weight window (11-11)", () => {
  // Reproduces the confirmed 11-11 mechanism: shouldRunProceduralBoneWrites
  // stays false for an extended window (first mount, or -- per the headless
  // diagnostic recorded in 11-11-SUMMARY.md -- any subsequent switchToClip
  // call, since the new action's weight always restarts ramping from 0).
  // Under 11-09's gate, this produced a frozen (T-pose-like) hold for the
  // whole window. Under the 11-11 fix (resetToRestPoseIfNotDriven +
  // unconditional breathing/sway), the same window must show VISIBLE,
  // non-static idle motion instead.
  it("produces non-static spine/chest/hips motion across frames even while the gate never opens", () => {
    const spine = new THREE.Object3D();
    const chest = new THREE.Object3D();
    const hips = new THREE.Object3D();
    const adapter: AvatarFormatAdapter = {
      getMixer: () => {
        throw new Error("not used in this test");
      },
      getBoneNode: () => null,
      getHumanoidBoneNode: (role) => {
        if (role === "spine") return spine;
        if (role === "chest") return chest;
        if (role === "hips") return hips;
        return null;
      },
      getExpressionManager: () => null,
    };

    const restPose: RestPoseAnchor = {
      spine: spine.quaternion.clone(),
      chest: chest.quaternion.clone(),
      hips: hips.quaternion.clone(),
    };

    const breathingState = createBreathingState();
    breathingState.period = 5.0;
    const swayState = createSwayState();
    swayState.period = 8.0;
    const delta = 1 / 30;

    const spineAngles: number[] = [];
    // Simulate 90 frames (a persistently near-zero-weight/"stuck" window --
    // much longer than any real crossfade's ~0.9s ramp) with the gate
    // NEVER opening (isBaseActionDriving always false), exactly mirroring
    // update()'s new step 4a-4c sequence.
    for (let i = 0; i < 90; i++) {
      resetToRestPoseIfNotDriven({ spine, chest, hips }, restPose, false);
      stepBreathing(breathingState, adapter, delta);
      stepSway(swayState, adapter, delta);
      spineAngles.push(spine.quaternion.angleTo(restPose.spine));
    }

    // Motion is visible (not frozen at the rest pose every frame).
    expect(Math.max(...spineAngles)).toBeGreaterThan(0.001);
    // And it's not a one-off blip -- most sampled frames show non-zero
    // motion, consistent with continuous oscillation rather than a single
    // spurious tick.
    const nonStaticFrameCount = spineAngles.filter((a) => a > 1e-6).length;
    expect(nonStaticFrameCount).toBeGreaterThan(spineAngles.length * 0.5);
  });

  it("stays BOUNDED across the same persistently-near-zero-weight window (11-09 spin not reintroduced)", () => {
    const spine = new THREE.Object3D();
    const chest = new THREE.Object3D();
    const hips = new THREE.Object3D();
    const adapter: AvatarFormatAdapter = {
      getMixer: () => {
        throw new Error("not used in this test");
      },
      getBoneNode: () => null,
      getHumanoidBoneNode: (role) => {
        if (role === "spine") return spine;
        if (role === "chest") return chest;
        if (role === "hips") return hips;
        return null;
      },
      getExpressionManager: () => null,
    };

    const restPose: RestPoseAnchor = {
      spine: spine.quaternion.clone(),
      chest: chest.quaternion.clone(),
      hips: hips.quaternion.clone(),
    };

    const breathingState = createBreathingState();
    breathingState.period = 5.0;
    const swayState = createSwayState();
    swayState.period = 8.0;
    const delta = 1 / 30;

    // Bound: breathing's own peak (0.03rad) + sway's own peak (0.025rad) at
    // amplitudeScale=1, matching the documented MAX_COMBINED_SPINE_DELTA_RAD
    // (0.12rad) rationale in AnimationStateEngine.ts -- comfortably above
    // either system's own per-frame peak, comfortably below what unbounded
    // 11-09-style compounding produces over many frames (the ORIGINAL repro
    // above shows unbounded compounding growing past this within 60 frames).
    const PLAUSIBLE_BOUND_RAD = 0.1;

    let maxAngle = 0;
    for (let i = 0; i < 300; i++) {
      // A much longer run than the G1 test above (300 vs 90 frames) to
      // prove this isn't just "bounded for a while" -- it must stay bounded
      // indefinitely, since resetToRestPoseIfNotDriven re-anchors every
      // single frame rather than letting drift persist.
      resetToRestPoseIfNotDriven({ spine, chest, hips }, restPose, false);
      stepBreathing(breathingState, adapter, delta);
      stepSway(swayState, adapter, delta);
      const angle = spine.quaternion.angleTo(restPose.spine);
      if (angle > maxAngle) maxAngle = angle;
    }

    expect(maxAngle).toBeLessThanOrEqual(PLAUSIBLE_BOUND_RAD);
  });
});

describe("G2 fix — idle->talking crossfade still ramps smoothly over multiple frames after a second switch (11-11)", () => {
  // 11-11's headless diagnostic (recorded in 11-11-SUMMARY.md) found
  // crossfade.ts's own duration/ramp math unaffected by G1 -- this test
  // guards that a SECOND switchToClip-style crossfade (idle -> talking,
  // mirroring beginCrossfade(fromAction, toAction, root) with a non-null
  // fromAction) still produces a genuine multi-frame eased ramp, not a
  // single-frame jump to full weight ("snap").
  function makeStubAction(clip: THREE.AnimationClip) {
    return {
      reset: vi.fn().mockReturnThis(),
      enabled: false,
      play: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      setEffectiveWeight: vi.fn(),
      getClip: () => clip,
    } as unknown as THREE.AnimationAction;
  }

  it("ramps the idle->talking blend over several distinct eased steps rather than jumping straight to full weight", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(0);

    const scene = new THREE.Object3D();
    const idleClip = new THREE.AnimationClip("idle", -1, []);
    const talkClip = new THREE.AnimationClip("talking", -1, []);
    const idleAction = makeStubAction(idleClip);
    const talkAction = makeStubAction(talkClip);

    // First switch (mirrors the very first switchToClip call).
    const firstBlend = beginCrossfade(null, idleAction, scene);
    nowSpy.mockReturnValue(firstBlend.duration * 1000 + 50); // let it complete
    stepCrossfade(firstBlend);

    // Second switch (idle -> talking), mirroring switchToClip's
    // `beginCrossfade(currentActionRef.current, toAction, root, floor)`
    // call with a non-null fromAction.
    const switchStartMs = firstBlend.duration * 1000 + 50;
    nowSpy.mockReturnValue(switchStartMs);
    const secondBlend = beginCrossfade(idleAction, talkAction, scene);
    expect(secondBlend.duration).toBeGreaterThan(0);

    const weightsAtQuarterSteps: number[] = [];
    for (const fraction of [0.25, 0.5, 0.75]) {
      nowSpy.mockReturnValue(switchStartMs + secondBlend.duration * 1000 * fraction);
      stepCrossfade(secondBlend);
      const lastCall = (talkAction.setEffectiveWeight as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      weightsAtQuarterSteps.push(lastCall![0] as number);
    }

    // A genuine multi-frame ramp: weight strictly increases across the
    // sampled steps, and none of the intermediate steps already sit at the
    // final value (which would indicate a single-frame snap rather than a
    // ramp).
    expect(weightsAtQuarterSteps[0]).toBeLessThan(weightsAtQuarterSteps[1]);
    expect(weightsAtQuarterSteps[1]).toBeLessThan(weightsAtQuarterSteps[2]);
    expect(weightsAtQuarterSteps[2]).toBeLessThan(1);
    expect(weightsAtQuarterSteps[0]).toBeCloseTo(easeInOutCubic(0.25), 5);

    nowSpy.mockRestore();
  });
});
