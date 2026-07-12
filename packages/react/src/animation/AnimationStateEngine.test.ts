/**
 * AnimationStateEngine.test.ts — unit tests for `resolveBaseClip`, the pure
 * chatStatus/manual-animate -> base-clip resolver. `useAnimationController`
 * itself is verified by build here (tsc --noEmit) and by integration in
 * 10-03/10-04, where it's exercised through real R3F components.
 */

import { describe, expect, it } from "vitest";
import { resolveBaseClip } from "./AnimationStateEngine";

describe("resolveBaseClip", () => {
  it("speaking: prefers a talk/gesture/speak-named clip when one exists", () => {
    const result = resolveBaseClip("speaking", "idle", ["idle", "talk_01", "wave"]);
    expect(result).toBe("talk_01");
  });

  it("speaking: falls back to currentAnimation when no talk clip exists", () => {
    const result = resolveBaseClip("speaking", "idle", ["idle", "wave"]);
    expect(result).toBe("idle");
  });

  it("ready: returns currentAnimation when set", () => {
    const result = resolveBaseClip("ready", "wave", ["idle", "wave"]);
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
});
