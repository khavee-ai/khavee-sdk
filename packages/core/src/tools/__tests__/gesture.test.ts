import { describe, it, expect } from "vitest";
import { toolGesture } from "../gesture";
import type { RealtimeTool } from "../../types/realtime";

// ── GEST-01: toolGesture shape + enum + RealtimeTool-conformance ───────────

describe("toolGesture", () => {
  it("has name === \"set_gesture\" (D-02)", () => {
    expect(toolGesture.name).toBe("set_gesture");
  });

  it("has NO execute property (app supplies it — D-01)", () => {
    expect("execute" in toolGesture).toBe(false);
  });

  it("uses the flat RealtimeTool parameters shape with a single 'gesture' key", () => {
    expect(Object.keys(toolGesture.parameters)).toEqual(["gesture"]);
    expect(toolGesture.parameters.gesture.type).toBe("string");
    expect(toolGesture.parameters.gesture.required).toBe(true);
    expect(typeof toolGesture.parameters.gesture.description).toBe("string");
  });

  it("declares enum exactly [\"nod\", \"shake\", \"none\"] in that order (D-02)", () => {
    expect(toolGesture.parameters.gesture.enum).toEqual(["nod", "shake", "none"]);
  });

  it("description coaches the LLM on affirm/deny/none semantics (D-03)", () => {
    const description = toolGesture.description.toLowerCase();
    expect(description).toContain("affirm");
    expect(description).toContain("agree");
    expect(description).toContain("deny");
    expect(description).toContain("disagree");
    expect(description).toContain("none");
  });

  it("is assignable to Omit<RealtimeTool, 'execute'> (compile-time conformance)", () => {
    const check: Omit<RealtimeTool, "execute"> = toolGesture;
    expect(check.name).toBe("set_gesture");
  });
});
