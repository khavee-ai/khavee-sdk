import { describe, expect, it } from "vitest";
import { expandAnimationConfig } from "./animationConfig";

describe("expandAnimationConfig", () => {
  it("returns empty array for undefined", () => {
    expect(expandAnimationConfig(undefined)).toEqual([]);
  });

  it("passes through plain string entries unchanged", () => {
    expect(expandAnimationConfig({ idle: "/a.fbx" })).toEqual([["idle", "/a.fbx"]]);
  });

  it("expands array entries to indexed names", () => {
    expect(
      expandAnimationConfig({ idle: ["/a.fbx", "/b.fbx"] }),
    ).toEqual([
      ["idle_0", "/a.fbx"],
      ["idle_1", "/b.fbx"],
    ]);
  });

  it("mixes plain strings and arrays, preserving insertion order", () => {
    expect(
      expandAnimationConfig({
        idle: ["/a.fbx", "/b.fbx"],
        talk: "/t.fbx",
      }),
    ).toEqual([
      ["idle_0", "/a.fbx"],
      ["idle_1", "/b.fbx"],
      ["talk", "/t.fbx"],
    ]);
  });

  it("skips empty arrays (no entries emitted)", () => {
    expect(expandAnimationConfig({ idle: [] })).toEqual([]);
  });

  it("single-element array returns indexed name", () => {
    expect(expandAnimationConfig({ idle: ["/a.fbx"] })).toEqual([
      ["idle_0", "/a.fbx"],
    ]);
  });
});
