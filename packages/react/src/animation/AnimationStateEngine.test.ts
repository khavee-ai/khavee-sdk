/**
 * AnimationStateEngine.test.ts — unit tests for `resolveBaseClip`, the pure
 * chatStatus/manual-animate -> base-clip resolver, plus (12-04) targeted
 * `useAnimationController` integration tests for the new gaze/gesture
 * composition steps.
 *
 * 12-04 NOTE on how `useAnimationController` (a real hook, using `useRef`/
 * `useEffect`) is exercised below without a React renderer: this repo has no
 * @testing-library/react or react-test-renderer devDependency (see
 * vitest.config.ts's `environment: "node"` and this package's package.json —
 * adding one is a package-manager install, out of this plan's scope). Every
 * hook this controller composes (directly, and via useGaze/useGesture/
 * useBlink/useBreathing/useSway/useExpressionDrift/useTalkCycle) uses ONLY
 * `useRef`/`useEffect` from "react" — never `useState` or anything requiring
 * true React reconciliation (verified via `grep -n "^import.*react"` across
 * every animation/*.ts module). Since this suite only ever calls
 * `useAnimationController` ONCE per test (never simulating a re-render of
 * the same "component instance"), a minimal mock of just those two
 * primitives — `useRef` returning a fresh `{ current: initial }` object and
 * `useEffect` running its callback synchronously — is behaviorally
 * equivalent to a real single-render hook call for this controller's
 * purposes, without needing a renderer dependency. This mock is scoped to
 * this file only and does not affect the plain pure-function tests above/
 * below it (`resolveBaseClip`, `stepBreathing`, etc. call no hooks at all).
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  resolveBaseClip,
  shouldRunProceduralBoneWrites,
  resetToRestPoseIfNotDriven,
  isBaseActionMeaningfullyDriving,
  shouldTriggerClipSwitch,
  shouldDisableProceduralForManualClip,
  resolveOrphanedBlendAction,
  useAnimationController,
  type RestPoseAnchor,
} from "./AnimationStateEngine";
import { createBreathingState, stepBreathing } from "./breathing";
import { createSwayState, stepSway } from "./sway";
import {
  beginCrossfade,
  stepCrossfade,
  easeInOutCubic,
  beginOrphanFade,
  stepOrphanFade,
  type BlendState,
} from "./crossfade";
import type { AvatarFormatAdapter } from "./types";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: (fn: () => void | (() => void)) => {
      fn();
    },
  };
});

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
      getEffectiveWeight: () => 1,
      isRunning: () => false,
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

describe("shouldTriggerClipSwitch (11-13 G1 fix)", () => {
  // This is the SAME pure function both the crossfade-trigger useEffect AND
  // update()'s per-frame retry call (see AnimationStateEngine.ts) -- calling
  // it directly here, rather than hand-rolling a replay of "what the effect
  // does," is what makes this test actually exercise the shipped hook's
  // real decision logic (the gap the 11-13 plan-checker blocker flagged:
  // a hand-rolled replay could pass while the live app stayed broken, as
  // happened across 11-10/11-12's rounds).

  it("returns false when targetName is null", () => {
    expect(
      shouldTriggerClipSwitch({
        targetName: null,
        chatStatus: "stopped",
        currentClipName: null,
        canResolveAction: true,
        canResolveRoot: true,
      }),
    ).toBe(false);
  });

  it("returns false when clips/root are not yet resolvable, even though targetName is set (the pre-connect stall)", () => {
    expect(
      shouldTriggerClipSwitch({
        targetName: "idle",
        chatStatus: "stopped",
        currentClipName: null,
        canResolveAction: false,
        canResolveRoot: false,
      }),
    ).toBe(false);
  });

  it("returns true once clips/root become resolvable, WITHOUT targetName or chatStatus changing -- the exact pre-connect ordering 11-11's fix missed (see file header 11-13 diagnosis block, H-G1)", () => {
    // Mirrors the real pre-connect sequence: KhaveeProvider defaults
    // chatStatus="stopped" and currentAnimation="idle" BEFORE Connect is
    // ever pressed, and neither value changes when the VRM/clips finish
    // their async, non-suspending load -- only readiness changes.
    const unready = {
      targetName: "idle",
      chatStatus: "stopped" as const,
      currentClipName: null,
      canResolveAction: false,
      canResolveRoot: false,
    };
    expect(shouldTriggerClipSwitch(unready)).toBe(false);

    const ready = { ...unready, canResolveAction: true, canResolveRoot: true };
    expect(shouldTriggerClipSwitch(ready)).toBe(true);
  });

  it("returns false once targetName already matches currentClipName (already showing this clip)", () => {
    expect(
      shouldTriggerClipSwitch({
        targetName: "idle",
        chatStatus: "stopped",
        currentClipName: "idle",
        canResolveAction: true,
        canResolveRoot: true,
      }),
    ).toBe(false);
  });

  it("preserves the TALK-01/TRANS-01 speaking-variant ownership guard (talkCycle already advanced past the first-matched speaking clip)", () => {
    expect(
      shouldTriggerClipSwitch({
        targetName: "talking", // resolveBaseClip's first .find()-matched speaking clip
        chatStatus: "speaking",
        currentClipName: "talking2", // talkCycle already advanced to a later variant
        canResolveAction: true,
        canResolveRoot: true,
      }),
    ).toBe(false);
  });

  it("does NOT apply the speaking-variant guard for the initial idle -> speaking switch (currentClipName is the base clip, not a speaking-matched one)", () => {
    expect(
      shouldTriggerClipSwitch({
        targetName: "talking",
        chatStatus: "speaking",
        currentClipName: "idle",
        canResolveAction: true,
        canResolveRoot: true,
      }),
    ).toBe(true);
  });
});

describe("G1 fix wired end-to-end through switchToClip (11-13)", () => {
  // Extends the shouldTriggerClipSwitch unit tests above one level up:
  // confirms that once the pure decision returns true, actually invoking
  // switchToClip's beginCrossfade/stepCrossfade (the real crossfade.ts
  // functions) ramps the base action from 0 to full weight over multiple
  // frames -- proving the fix is not just a passing unit test in isolation,
  // but produces the same observable effect (currentActionRef becomes
  // non-null, weight ramps) the file-header 11-13 diagnostic measured was
  // missing before this fix.
  function makeStubAction(clip: THREE.AnimationClip) {
    return {
      reset: vi.fn().mockReturnThis(),
      enabled: false,
      play: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      setEffectiveWeight: vi.fn(),
      getEffectiveWeight: () => 1,
      isRunning: () => false,
      getClip: () => clip,
    } as unknown as THREE.AnimationAction;
  }

  it("clips unresolvable pre-connect -> becomes resolvable without targetName/chatStatus changing -> retry succeeds -> weight ramps to full over multiple frames", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(0);

    const scene = new THREE.Object3D();
    const idleClip = new THREE.AnimationClip("idle", -1, []);
    const idleAction = makeStubAction(idleClip);

    let currentAction: THREE.AnimationAction | null = null;
    let currentClipName: string | null = null;
    let clipsReady = false;

    const getAction = (name: string) => (clipsReady && name === "idle" ? idleAction : null);
    const getRoot = () => (clipsReady ? scene : null);

    function attemptSwitch(targetName: string, chatStatus: "stopped") {
      if (
        shouldTriggerClipSwitch({
          targetName,
          chatStatus,
          currentClipName,
          canResolveAction: !!getAction(targetName),
          canResolveRoot: !!getRoot(),
        })
      ) {
        const toAction = getAction(targetName)!;
        const root = getRoot()!;
        return { switched: true, blend: beginCrossfade(currentAction, toAction, root) };
      }
      return { switched: false, blend: null };
    }

    // Effect run #1 (mount time): clips not yet resolvable.
    const first = attemptSwitch("idle", "stopped");
    expect(first.switched).toBe(false);
    expect(currentAction).toBeNull();

    // Clips/root become resolvable -- targetName/chatStatus UNCHANGED.
    clipsReady = true;

    // update()'s per-frame retry (step 0): calls the SAME shouldTriggerClipSwitch.
    const retry = attemptSwitch("idle", "stopped");
    expect(retry.switched).toBe(true);
    currentAction = idleAction;
    currentClipName = "idle";

    const blend = retry.blend!;
    expect(blend.active).toBe(true);

    // Ramp verification (mirrors the pre-existing G2 multi-frame-ramp test).
    const weightsAtSteps: number[] = [];
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      nowSpy.mockReturnValue(blend.duration * 1000 * fraction);
      stepCrossfade(blend);
      const lastCall = (idleAction.setEffectiveWeight as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      weightsAtSteps.push(lastCall![0] as number);
    }

    expect(weightsAtSteps[0]).toBeLessThan(weightsAtSteps[1]);
    expect(weightsAtSteps[1]).toBeLessThan(weightsAtSteps[2]);
    expect(weightsAtSteps[2]).toBeLessThan(weightsAtSteps[3]);
    expect(weightsAtSteps[3]).toBeCloseTo(1, 5);

    // A second retry attempt (e.g. the very next frame) must now be a no-op
    // -- self-terminating, no repeated re-triggering once switched.
    const secondRetry = attemptSwitch("idle", "stopped");
    expect(secondRetry.switched).toBe(false);

    nowSpy.mockRestore();
  });
});

describe("isBaseActionMeaningfullyDriving (11-13 G4 fix)", () => {
  it("returns false when neither the current action nor a from-action exist (true first-mount case)", () => {
    expect(isBaseActionMeaningfullyDriving(null, null)).toBe(false);
  });

  it("returns false when the current action's weight is below threshold AND there is no from-action", () => {
    const action = { getEffectiveWeight: () => 0.01 } as unknown as THREE.AnimationAction;
    expect(isBaseActionMeaningfullyDriving(action, null)).toBe(false);
  });

  it("returns true when the current action's own weight has ramped past threshold, regardless of from-action", () => {
    const action = { getEffectiveWeight: () => 0.5 } as unknown as THREE.AnimationAction;
    expect(isBaseActionMeaningfullyDriving(action, null)).toBe(true);
  });

  it("returns true when the current (incoming) action's weight is still near-zero BUT a real from-action exists (mid-crossfade between two real actions -- the G4 case)", () => {
    const incoming = { getEffectiveWeight: () => 0.01 } as unknown as THREE.AnimationAction;
    const outgoing = { getEffectiveWeight: () => 0.9 } as unknown as THREE.AnimationAction;
    expect(isBaseActionMeaningfullyDriving(incoming, outgoing)).toBe(true);
  });
});

describe("G4 fix — resetToRestPoseIfNotDriven does not snap the torso during a real two-action crossfade (11-13)", () => {
  // Reproduces the confirmed 11-13 H-G4 mechanism (file-header diagnosis
  // block): during a talk-variant switch (e.g. talking -> talking1), the
  // INCOMING action's weight starts near 0 while the OUTGOING action is
  // still contributing ~0.9-1.0 weight. The OLD gate
  // (shouldRunProceduralBoneWrites alone) only inspects the incoming
  // action, so it reports "not driving" and resetToRestPoseIfNotDriven
  // snaps spine/chest/hips toward the bind anchor even though the mixer
  // itself is still producing a live, real two-action blend -- the jiggle.
  // The NEW isBaseActionMeaningfullyDriving check (which also treats a
  // real, non-null from-action as driving) must prevent that snap.
  function makeBones() {
    return {
      spine: new THREE.Object3D(),
      chest: new THREE.Object3D(),
      hips: new THREE.Object3D(),
    };
  }

  it("does not reset toward the bind anchor while a real outgoing action is still contributing weight (NEW behavior)", () => {
    const bones = makeBones();
    const restPose: RestPoseAnchor = {
      spine: new THREE.Quaternion(),
      chest: new THREE.Quaternion(),
      hips: new THREE.Quaternion(),
    };

    // Simulate the mixer's own blended pose for spine during a real
    // talking->talking1 crossfade: two fixed, non-identity "real" clip
    // orientations blending by incoming weight (mirrors what
    // THREE.AnimationMixer produces for two active, real actions bound to
    // the same property -- a fresh recompute every frame, not an
    // accumulation across frames, matching the file-header 11-13 rationale).
    const outgoingPose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);
    const incomingPose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);

    const outgoingAction = { getEffectiveWeight: () => 0.95 } as unknown as THREE.AnimationAction;
    let incomingWeight = 0;
    const incomingAction = {
      getEffectiveWeight: () => incomingWeight,
    } as unknown as THREE.AnimationAction;

    const deviationsFromMixerPose: number[] = [];
    for (let i = 1; i <= 5; i++) {
      incomingWeight = i * 0.01; // stays well below MIN_BASE_ACTION_WEIGHT (0.05)
      // The mixer writes a fresh blended pose every frame.
      bones.spine.quaternion.copy(outgoingPose).slerp(incomingPose, incomingWeight);
      const mixerPose = bones.spine.quaternion.clone();

      const driving = isBaseActionMeaningfullyDriving(incomingAction, outgoingAction);
      resetToRestPoseIfNotDriven(bones, restPose, driving);

      deviationsFromMixerPose.push(mixerPose.angleTo(bones.spine.quaternion));
    }

    // With the G4 fix, since a real outgoingAction is contributing, driving
    // is true throughout this window -- the reset never fires, so spine
    // stays at (within floating-point tolerance of) the mixer's own
    // blended pose each frame -- nowhere near the ~0.079rad the OLD gate
    // produces (see the contrast test below).
    for (const d of deviationsFromMixerPose) {
      expect(d).toBeLessThan(1e-5);
    }
  });

  it("(contrast, documents the bug) using the OLD incoming-weight-only gate in the same window snaps the torso toward the bind anchor, away from the mixer's own blend", () => {
    const bones = makeBones();
    const restPose: RestPoseAnchor = {
      spine: new THREE.Quaternion(),
      chest: new THREE.Quaternion(),
      hips: new THREE.Quaternion(),
    };
    const outgoingPose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);
    const incomingPose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
    let incomingWeight = 0;
    const incomingAction = {
      getEffectiveWeight: () => incomingWeight,
    } as unknown as THREE.AnimationAction;

    let maxDeviationFromMixerPose = 0;
    for (let i = 1; i <= 5; i++) {
      incomingWeight = i * 0.01;
      bones.spine.quaternion.copy(outgoingPose).slerp(incomingPose, incomingWeight);
      const mixerPose = bones.spine.quaternion.clone();

      // OLD gate: shouldRunProceduralBoneWrites alone, ignoring the
      // from-action entirely.
      const driving = shouldRunProceduralBoneWrites(incomingAction);
      resetToRestPoseIfNotDriven(bones, restPose, driving);

      const deviation = mixerPose.angleTo(bones.spine.quaternion);
      if (deviation > maxDeviationFromMixerPose) maxDeviationFromMixerPose = deviation;
    }

    // The OLD gate resets every one of these frames (driving is always
    // false, since incomingWeight never exceeds 0.05 in this window),
    // snapping spine all the way to the bind anchor -- a real, measurable
    // deviation from the mixer's own blended pose (matches the ~0.079rad
    // magnitude recorded in the file-header 11-13 diagnosis).
    expect(maxDeviationFromMixerPose).toBeGreaterThan(0.05);
  });
});

describe("G5 fix — hips height holds at bind pose during the load-time idle settle (11-15)", () => {
  // Drives a REAL beginCrossfade(null, idleAction, root) + stepCrossfade
  // settle (the production path, not a stub) with a synthetic hips position
  // track built the way the FIXED remapMixamoAnimationToVrm.ts now produces
  // one -- anchored at the bind-pose Y, not 0 (see remapMixamoAnimationToVrm.
  // test.ts for the retargeter-level unit tests, and this file's "11-15 gap
  // closure" header block for the headless production-path evidence this
  // fix targets). Before the fix, an identical setup with the track anchored
  // at 0 would have shown hips.position.y ramp the FULL ~1.008-unit distance
  // from the bind pose down toward 0 across this exact settle.
  it("hips.position.y stays within a small tolerance of the bind-pose Y across the full real crossfade settle (matches the 11-15 fix, not the pre-fix ~1-unit drop)", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(0);

    const root = new THREE.Object3D();
    const hips = new THREE.Object3D();
    hips.name = "hips";
    root.add(hips);

    const bindPoseHipsY = 1.008;
    // The bind pose, exactly as it would read before any action has ever
    // played (mirrors the 11-15 headless diagnosis's captured
    // `hips.position.y` measurement, 1.00825679, rounded here for a clean
    // fixture).
    hips.position.set(0, bindPoseHipsY, 0);

    // Simulated FIXED remapped clip: hips position track anchored at the
    // bind-pose Y (11-15 fix), NOT 0 -- mirrors what
    // remapMixamoAnimationToVrm.ts's hips VectorKeyframeTrack branch now
    // produces. A small amount of secondary motion (+-0.02) is included so
    // this test also proves the clip's own natural idle-bob motion stays
    // bounded, not just a single frozen value.
    const track = new THREE.VectorKeyframeTrack(
      "hips.position",
      [0, 0.5, 1],
      [0, bindPoseHipsY, 0, 0, bindPoseHipsY - 0.02, 0, 0, bindPoseHipsY + 0.01, 0],
    );
    const clip = new THREE.AnimationClip("idle", 1, [track]);

    const mixer = new THREE.AnimationMixer(root);
    const idleAction = mixer.clipAction(clip);

    // chatStatus === "stopped" at page load (KhaveeProvider's initial
    // state) means switchToClip's TRANS-01/02 floor branch applies even for
    // the idle target -- see the 11-15 header diagnosis. floorSeconds=1.2
    // reproduces that exact real page-load duration.
    const blend = beginCrossfade(null, idleAction, root, 1.2);
    expect(blend.duration).toBeCloseTo(1.2, 6);

    // Generously above the fixture's own +-0.02 secondary motion, and two
    // orders of magnitude below the ~1.008-unit pre-fix drop this test
    // guards against.
    const TOLERANCE = 0.03;
    const frameMs = 1000 / 60;
    let simulatedMs = 0;
    const totalFrames = Math.ceil((blend.duration * 1000) / frameMs) + 5;

    const sampledYs: number[] = [];
    for (let frame = 0; frame <= totalFrames; frame++) {
      const delta = frame === 0 ? 0 : frameMs / 1000;
      mixer.update(delta);
      sampledYs.push(hips.position.y);

      nowSpy.mockReturnValue(simulatedMs);
      stepCrossfade(blend);
      simulatedMs += frameMs;
    }

    for (const y of sampledYs) {
      expect(y).toBeGreaterThan(bindPoseHipsY - TOLERANCE);
      expect(y).toBeLessThan(bindPoseHipsY + TOLERANCE);
    }

    // Explicit contrast with the pre-fix magnitude: no single frame comes
    // anywhere close to the OLD anchor-to-0 behavior's ~1.008-unit total
    // drop toward 0.
    expect(Math.min(...sampledYs)).toBeGreaterThan(0.5);

    nowSpy.mockRestore();
  });
});

describe("11-17 — GLB manual-clip procedural gate (OPEN ISSUE 2)", () => {
  const IDLE_CLIP = "State 1 Idle (loop)";
  const MANUAL_CLIP = "State 3 Welcome (loop)";

  it("returns false when enabled is false (VRM path / gate off), regardless of other inputs", () => {
    expect(
      shouldDisableProceduralForManualClip({
        enabled: false,
        chatStatus: "stopped",
        currentAnimation: MANUAL_CLIP,
        activeClipName: MANUAL_CLIP,
      }),
    ).toBe(false);
  });

  it("returns false when chatStatus is a status-driven state (e.g. speaking), even when clip === currentAnimation", () => {
    expect(
      shouldDisableProceduralForManualClip({
        enabled: true,
        chatStatus: "speaking",
        currentAnimation: MANUAL_CLIP,
        activeClipName: MANUAL_CLIP,
      }),
    ).toBe(false);
  });

  it("returns false when currentAnimation is null", () => {
    expect(
      shouldDisableProceduralForManualClip({
        enabled: true,
        chatStatus: "stopped",
        currentAnimation: null,
        activeClipName: MANUAL_CLIP,
      }),
    ).toBe(false);
  });

  it("returns false when activeClipName is null", () => {
    expect(
      shouldDisableProceduralForManualClip({
        enabled: true,
        chatStatus: "stopped",
        currentAnimation: MANUAL_CLIP,
        activeClipName: null,
      }),
    ).toBe(false);
  });

  it("returns false when activeClipName !== currentAnimation (showing clip is not the user's explicit selection)", () => {
    expect(
      shouldDisableProceduralForManualClip({
        enabled: true,
        chatStatus: "stopped",
        currentAnimation: MANUAL_CLIP,
        activeClipName: IDLE_CLIP,
      }),
    ).toBe(false);
  });

  it("returns false when activeClipName matches the ready/idle pattern (the default idle base clip stays on)", () => {
    expect(
      shouldDisableProceduralForManualClip({
        enabled: true,
        chatStatus: "ready",
        currentAnimation: IDLE_CLIP,
        activeClipName: IDLE_CLIP,
      }),
    ).toBe(false);
  });

  it("returns true when enabled + stopped/ready + a manually-selected non-idle clip is showing", () => {
    expect(
      shouldDisableProceduralForManualClip({
        enabled: true,
        chatStatus: "stopped",
        currentAnimation: MANUAL_CLIP,
        activeClipName: MANUAL_CLIP,
      }),
    ).toBe(true);

    expect(
      shouldDisableProceduralForManualClip({
        enabled: true,
        chatStatus: "ready",
        currentAnimation: MANUAL_CLIP,
        activeClipName: MANUAL_CLIP,
      }),
    ).toBe(true);
  });
});

describe("useAnimationController — gaze/gesture integration (12-04)", () => {
  function makeAdapter(head: THREE.Object3D | null = null): AvatarFormatAdapter {
    return {
      getMixer: () => {
        throw new Error("not used in this test");
      },
      getBoneNode: () => null,
      getHumanoidBoneNode: (role) => (role === "head" ? head : null),
      getExpressionManager: () => null,
    };
  }

  it("update() runs without throwing when camera/gestureHint are omitted (backward-compatible)", () => {
    const adapter = makeAdapter();

    const controller = useAnimationController({
      adapter,
      chatStatus: "ready",
      currentAnimation: null,
      availableNames: [],
      getAction: () => null,
      getRoot: () => null,
      enableBlinking: false,
    });

    expect(() => controller.update(1 / 30)).not.toThrow();
  });

  it("calls onGestureConsumed the frame a gesture hint arrives outside speaking (D-06 immediate path)", () => {
    const head = new THREE.Object3D();
    const adapter = makeAdapter(head);
    const onGestureConsumed = vi.fn();

    const controller = useAnimationController({
      adapter,
      chatStatus: "ready",
      currentAnimation: null,
      availableNames: [],
      getAction: () => null,
      getRoot: () => null,
      enableBlinking: false,
      gestureHint: "nod",
      onGestureConsumed,
    });

    controller.update(1 / 30);

    expect(onGestureConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a camera is supplied alongside a gesture hint (steps 10 and 11 both run)", () => {
    const head = new THREE.Object3D();
    const adapter = makeAdapter(head);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 3);

    const controller = useAnimationController({
      adapter,
      chatStatus: "listening",
      currentAnimation: null,
      availableNames: [],
      getAction: () => null,
      getRoot: () => null,
      enableBlinking: false,
      camera,
      gestureHint: "shake",
      onGestureConsumed: vi.fn(),
    });

    expect(() => controller.update(1 / 30)).not.toThrow();
  });

  it("does not call onGestureConsumed when gestureHint is omitted (no spurious trigger)", () => {
    const head = new THREE.Object3D();
    const adapter = makeAdapter(head);
    const onGestureConsumed = vi.fn();

    const controller = useAnimationController({
      adapter,
      chatStatus: "ready",
      currentAnimation: null,
      availableNames: [],
      getAction: () => null,
      getRoot: () => null,
      enableBlinking: false,
      onGestureConsumed,
    });

    controller.update(1 / 30);

    expect(onGestureConsumed).not.toHaveBeenCalled();
  });
});

describe("resolveOrphanedBlendAction (T-pose/bind-pose snap fix, part 2)", () => {
  // Debug session: .planning/debug/tpose-snap-speak-toggle.md. See
  // crossfade.ts's beginCrossfade doc comment for part 1 (weight-seeding),
  // and this function's own doc comment (AnimationStateEngine.ts) for the
  // full orphaned-action mechanism this covers.
  function makeStubAction() {
    return { stop: vi.fn() } as unknown as THREE.AnimationAction;
  }

  function makeBlend(overrides: Partial<BlendState>): BlendState {
    return {
      active: false,
      from: null,
      to: null,
      startTime: 0,
      duration: 0.3,
      fromStartWeight: 0,
      toStartWeight: 0,
      ...overrides,
    };
  }

  it("returns null when the previous blend is not active (already settled -- nothing to orphan)", () => {
    const to = makeStubAction();
    const blend = makeBlend({ active: false, from: makeStubAction() });
    expect(resolveOrphanedBlendAction(blend, to)).toBeNull();
  });

  it("returns null when the previous blend has no from-action (true first-mount case)", () => {
    const to = makeStubAction();
    const blend = makeBlend({ active: true, from: null });
    expect(resolveOrphanedBlendAction(blend, to)).toBeNull();
  });

  it("returns null when the new target IS the previous blend's from-action (toggling back to the fading-out clip -- beginCrossfade's own weight seeding handles this, not an orphan)", () => {
    const idle = makeStubAction();
    const blend = makeBlend({ active: true, from: idle });
    expect(resolveOrphanedBlendAction(blend, idle)).toBeNull();
  });

  it("returns the previous blend's from-action when it is about to be orphaned by a switch to a THIRD, unrelated clip", () => {
    const talking = makeStubAction();
    const talking1 = makeStubAction();
    const idle = makeStubAction();
    // Mirrors: idle -> talking (settled) -> talking1 (interrupted mid-blend,
    // blend2 = {from: talking, to: talking1}) -> idle (this switch).
    const blend2 = makeBlend({ active: true, from: talking, to: talking1 });
    expect(resolveOrphanedBlendAction(blend2, idle)).toBe(talking);
  });
});

describe("3+-deep interruption chain: orphaned action fades out smoothly, never left dangling at stale weight AND never dropped to 0 in one frame (T-pose/bind-pose snap fix, parts 2+3)", () => {
  // Mirrors switchToClip's real call sequence -- beginCrossfade, then (part 2)
  // resolveOrphanedBlendAction(prevBlend, toAction), then (part 3, 2026-08-21
  // follow-up -- see .planning/debug/tpose-snap-speak-toggle.md)
  // beginOrphanFade(orphan, newBlend.duration) instead of an immediate
  // `.stop()` -- across consecutive interrupted switches (idle -> talking ->
  // talking1 -> idle), where the LAST switch interrupts a blend that itself
  // interrupted an earlier one, matching a fast real-world talk-cycle-
  // variant-switch-then-speaking-ends sequence (TALK-01 + this fix).
  //
  // Part 3 exists because part 2's immediate `.stop()` reintroduced the
  // exact bug class it was fixing: `.stop()` removes an action's weight
  // contribution from the mixer with no ramp, and an orphan -- by
  // construction -- often still holds real weight the instant it's
  // identified (its own fade-out was itself interrupted before t>=1).
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

  it("fades the orphaned action's weight smoothly to 0 (no one-frame drop) and stops it once settled, instead of either leaving it dangling forever or cutting it off abruptly", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(0);

    const scene = new THREE.Object3D();
    const idleAction = makeStatefulStubAction(new THREE.AnimationClip("idle", -1, []));
    const talkAction = makeStatefulStubAction(new THREE.AnimationClip("talking", -1, []));
    const talk1Action = makeStatefulStubAction(new THREE.AnimationClip("talking1", -1, []));

    idleAction.play();
    idleAction.setEffectiveWeight(1);

    // Switch 1: idle -> talking, allowed to settle fully (no interruption).
    const blend1 = beginCrossfade(idleAction, talkAction, scene);
    nowSpy.mockReturnValue(blend1.duration * 1000 + 50);
    stepCrossfade(blend1);
    expect(idleAction.stop).toHaveBeenCalledTimes(1); // natural completion

    // Switch 2 (talk-cycle variant switch): talking -> talking1.
    const switch2Start = blend1.duration * 1000 + 50;
    nowSpy.mockReturnValue(switch2Start);
    expect(resolveOrphanedBlendAction(blend1, talk1Action)).toBeNull(); // blend1 already settled, nothing to orphan
    const blend2 = beginCrossfade(talkAction, talk1Action, scene);

    // Advance blend2 PARTWAY -- it never reaches t>=1 before switch 3 below.
    nowSpy.mockReturnValue(switch2Start + blend2.duration * 1000 * 0.3);
    stepCrossfade(blend2);
    expect(talkAction.stop).not.toHaveBeenCalled(); // blend2 still active; talking is its live `from`
    const talkWeightBeforeOrphaning = talkAction.getEffectiveWeight();
    const talk1WeightBeforeOrphaning = talk1Action.getEffectiveWeight();
    expect(talkWeightBeforeOrphaning).toBeGreaterThan(0);

    // Switch 3: interrupted again, back to idle. "talking" (blend2's `from`)
    // is about to be orphaned -- referenced by no BlendState from this point
    // on. switchToClip's real sequence (part 3, 2026-08-21 follow-up) starts
    // an OrphanFade for it instead of calling `.stop()` immediately.
    const orphan = resolveOrphanedBlendAction(blend2, idleAction);
    expect(orphan).toBe(talkAction);
    const blend3 = beginCrossfade(talk1Action, idleAction, scene);
    const orphanFade = beginOrphanFade(orphan!, blend3.duration);

    // The instant the orphan fade starts, its weight must be UNCHANGED from
    // what it was the frame before -- not dropped to 0. This is the part-3
    // regression check: total weight across talkAction + talk1Action +
    // idleAction must stay close to what it was pre-interruption (~1), not
    // collapse to just talk1Action's small share.
    expect(talkAction.getEffectiveWeight()).toBeCloseTo(talkWeightBeforeOrphaning, 5);
    expect(talkAction.stop).not.toHaveBeenCalled();
    const totalRightAfterInterrupt =
      talkAction.getEffectiveWeight() + talk1Action.getEffectiveWeight() + idleAction.getEffectiveWeight();
    expect(totalRightAfterInterrupt).toBeCloseTo(talkWeightBeforeOrphaning + talk1WeightBeforeOrphaning, 5);
    expect(totalRightAfterInterrupt).toBeGreaterThan(0.5); // nowhere near the old ~0.11 cliff

    // Eventually (once the fade completes), the orphan IS stopped -- it does
    // not linger forever either.
    nowSpy.mockReturnValue(switch2Start + blend2.duration * 1000 * 0.3 + blend3.duration * 1000 + 50);
    const faded = stepOrphanFade(orphanFade);
    expect(faded).toBe(true);
    expect(talkAction.getEffectiveWeight()).toBe(0);
    expect(talkAction.stop).toHaveBeenCalledTimes(1);
  });
});
