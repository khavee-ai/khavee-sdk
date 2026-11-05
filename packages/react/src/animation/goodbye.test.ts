import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ChatStatus } from "@khaveeai/core";
import { useAnimationController } from "./AnimationStateEngine";
import type { AvatarFormatAdapter } from "./types";

// Refs persist across "renders" by call order, so status changes can be
// simulated by calling the controller again (React itself isn't running).
const store: { current: unknown }[] = [];
let cursor = 0;
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: <T,>(initial: T) => {
      if (!store[cursor]) store[cursor] = { current: initial };
      return store[cursor++] as { current: T };
    },
    useEffect: (fn: () => void | (() => void)) => {
      fn();
    },
    useMemo: <T,>(fn: () => T) => fn(),
  };
});

function rig() {
  store.length = 0;
  const root = new THREE.Object3D();
  const bone = new THREE.Object3D();
  bone.name = "hips";
  root.add(bone);
  const mixer = new THREE.AnimationMixer(root);
  const clip = (name: string, duration: number) =>
    new THREE.AnimationClip(name, duration, [
      new THREE.VectorKeyframeTrack("hips.position", [0, duration], [0, 1, 0, 0, 1, 0]),
    ]);
  const clips = [clip("idle", 3), clip("bye", 2), clip("talk", 2)];
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
  const render = (chatStatus: ChatStatus) => {
    cursor = 0;
    return useAnimationController({
      adapter,
      chatStatus,
      currentAnimation: "idle",
      availableNames: clips.map((c) => c.name),
      getAction,
      getRoot: () => root,
      enableBlinking: false,
    });
  };
  const run = (controller: { update: (d: number) => void }, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.1) {
      mixer.update(0.1);
      controller.update(0.1);
    }
  };
  return { getAction, render, run };
}

describe("goodbye clip", () => {
  it("does not wave on the initial stopped before anyone talks", () => {
    const { getAction, render, run } = rig();
    run(render("stopped"), 1);
    expect(getAction("bye")!.isRunning()).toBe(false);
    expect(getAction("idle")!.isRunning()).toBe(true);
  });

  it("waves once when a live session ends, then settles into idle", () => {
    const { getAction, render, run } = rig();
    run(render("ready"), 1);
    const ended = render("stopped");
    run(ended, 0.5);
    const bye = getAction("bye")!;
    expect(bye.isRunning()).toBe(true);
    expect(bye.loop).toBe(THREE.LoopOnce);
    run(ended, 3); // past the 2s clip
    expect(getAction("idle")!.getEffectiveWeight()).toBeGreaterThan(0.9);
  });
});
