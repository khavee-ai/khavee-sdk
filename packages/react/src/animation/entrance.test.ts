import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { useAnimationController } from "./AnimationStateEngine";
import { ENTRANCE_CLIP_NAME, isEntranceHandoffDue, startEntrance, withoutEntrance } from "./entrance";
import type { AvatarFormatAdapter } from "./types";

// Same hook stand-ins as AnimationStateEngine.test.ts: the controller is
// called directly, outside React.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: (fn: () => void | (() => void)) => {
      fn();
    },
    useMemo: <T,>(fn: () => T) => fn(),
  };
});

function rig() {
  const root = new THREE.Object3D();
  const bone = new THREE.Object3D();
  bone.name = "hips";
  root.add(bone);
  const mixer = new THREE.AnimationMixer(root);
  const clip = (name: string, duration: number) =>
    new THREE.AnimationClip(name, duration, [
      new THREE.VectorKeyframeTrack("hips.position", [0, duration], [0, 2, 0, 0, 1, 0]),
    ]);
  const clips = [clip(ENTRANCE_CLIP_NAME, 2), clip("idle", 3)];
  const getAction = (name: string) => {
    const found = clips.find((c) => c.name === name);
    return found ? mixer.clipAction(found) : null;
  };
  const adapter: AvatarFormatAdapter = {
    getMixer: () => mixer,
    getBoneNode: () => null,
    getHumanoidBoneNode: () => null,
    getExpressionManager: () => null,
  };
  return { root, mixer, getAction, adapter, names: clips.map((c) => c.name) };
}

describe("entrance helpers", () => {
  it("keeps the entrance out of status clip names", () => {
    expect(withoutEntrance([ENTRANCE_CLIP_NAME, "idle_0"])).toEqual(["idle_0"]);
  });

  it("plays once, holds the last frame, and hands over near the end", () => {
    const { mixer, getAction } = rig();
    const action = getAction(ENTRANCE_CLIP_NAME)!;
    startEntrance(action);
    expect(action.loop).toBe(THREE.LoopOnce);
    expect(action.clampWhenFinished).toBe(true);
    mixer.update(1);
    expect(isEntranceHandoffDue(action)).toBe(false);
    mixer.update(0.6);
    expect(isEntranceHandoffDue(action)).toBe(true);
  });
});

describe("useAnimationController with an entrance clip", () => {
  it("plays the entrance before idle, then crossfades to idle", () => {
    const { root, mixer, getAction, adapter, names } = rig();
    const controller = useAnimationController({
      adapter,
      chatStatus: "ready",
      currentAnimation: null,
      availableNames: names,
      getAction,
      getRoot: () => root,
      enableBlinking: false,
    });
    const entrance = getAction(ENTRANCE_CLIP_NAME)!;
    const idle = getAction("idle")!;
    expect(entrance.isRunning()).toBe(true);
    expect(idle.isRunning()).toBe(false);

    for (let t = 0; t < 1; t += 0.1) {
      mixer.update(0.1);
      controller.update(0.1);
    }
    expect(idle.isRunning()).toBe(false); // still dropping in

    for (let t = 0; t < 1; t += 0.1) {
      mixer.update(0.1);
      controller.update(0.1);
    }
    expect(idle.isRunning()).toBe(true); // handed over
  });

  it("goes straight to idle when no entrance clip is configured", () => {
    const { root, getAction, adapter } = rig();
    useAnimationController({
      adapter,
      chatStatus: "ready",
      currentAnimation: null,
      availableNames: ["idle"],
      getAction,
      getRoot: () => root,
      enableBlinking: false,
    });
    expect(getAction("idle")!.isRunning()).toBe(true);
    expect(getAction(ENTRANCE_CLIP_NAME)!.isRunning()).toBe(false);
  });
});
