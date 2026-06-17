import { describe, it, expect, vi, afterEach } from "vitest";
import { ToolExecutor } from "../types/tools";

afterEach(() => {
  vi.restoreAllMocks();
});

// ── CORE-04: ToolExecutor.execute() result normalization unit tests ────────

describe("ToolExecutor.execute", () => {
  it("returns a resolved {success, message} result unchanged (success path)", async () => {
    const executor = new ToolExecutor();
    executor.register("vendorA", async () => ({
      success: true,
      message: "vendor-a ok",
    }));

    const result = await executor.execute("vendorA", {});

    expect(result).toEqual({ success: true, message: "vendor-a ok" });
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.message).toBe("string");
  });

  it("normalizes a thrown error to {success: false, message} (error path)", async () => {
    const executor = new ToolExecutor();
    executor.register("vendorB", async () => {
      throw new Error("vendor-b failed");
    });

    const result = await executor.execute("vendorB", {});

    expect(result.success).toBe(false);
    expect(result.message).toContain("vendor-b failed");
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.message).toBe("string");
  });

  it("returns {success: false, message: \"Function 'unknown' not found\"} for an unregistered tool", async () => {
    const executor = new ToolExecutor();

    const result = await executor.execute("unknown", {});

    expect(result).toEqual({
      success: false,
      message: "Function 'unknown' not found",
    });
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.message).toBe("string");
  });

  it("getRegisteredFunctions() returns the list of registered names", () => {
    const executor = new ToolExecutor();
    executor.register("vendorA", async () => ({ success: true, message: "ok" }));
    executor.register("vendorB", async () => ({ success: true, message: "ok" }));

    expect(executor.getRegisteredFunctions()).toEqual(["vendorA", "vendorB"]);
  });
});
