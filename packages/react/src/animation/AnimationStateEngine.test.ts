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
