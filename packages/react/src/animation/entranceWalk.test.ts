import { describe, expect, it } from "vitest";
import { sampleEntranceWalk } from "./entranceWalk";

describe("sampleEntranceWalk", () => {
  it("starts off-frame on the right facing left, walking", () => {
    const s = sampleEntranceWalk(0);
    expect(s.x).toBeCloseTo(3);
    expect(s.yaw).toBeCloseTo(-Math.PI / 2);
    expect(s.walking).toBe(true);
  });

  it("walks at the given speed and arrives at its own spot", () => {
    expect(sampleEntranceWalk(1.25, { distance: 3, speed: 1.2 }).x).toBeCloseTo(1.5);
    const arrived = sampleEntranceWalk(2.5, { distance: 3, speed: 1.2 });
    expect(arrived.x).toBe(0);
    expect(arrived.walking).toBe(false);
    expect(arrived.done).toBe(false); // still turning
  });

  it("turns to face the camera, then is done", () => {
    const end = sampleEntranceWalk(3.1, { distance: 3, speed: 1.2, turnSeconds: 0.5 });
    expect(end.yaw).toBeCloseTo(0);
    expect(end.done).toBe(true);
  });

  it("mirrors when walking in from the left", () => {
    const s = sampleEntranceWalk(0, { from: "left" });
    expect(s.x).toBeCloseTo(-3);
    expect(s.yaw).toBeCloseTo(Math.PI / 2);
  });
});
