import { describe, it, expect, vi } from "vitest";
import {
  createEmotionTool,
  emotionSystemPrompt,
  EMOTION_NAMES,
  DEFAULT_EMOTION_INTENSITY,
} from "../emotion";
import { ToolExecutor } from "../../types/tools";
import type { RealtimeTool } from "../../types/realtime";

// ── EMO-01: createEmotionTool shape, validation, ToolExecutor dispatch ─────

describe("EMOTION_NAMES", () => {
  it("equals the 6 core emotions in order (D-13)", () => {
    expect(EMOTION_NAMES).toEqual([
      "happy",
      "sad",
      "angry",
      "surprised",
      "neutral",
      "thinking",
    ]);
  });
});

describe("createEmotionTool", () => {
  it("returns a tool named set_emotion with flat emotion/intensity parameters", () => {
    const spy = vi.fn();
    const { tool } = createEmotionTool(spy);

    expect(tool.name).toBe("set_emotion");
    expect(Object.keys(tool.parameters)).toEqual(["emotion", "intensity"]);
    expect(tool.parameters.emotion.type).toBe("string");
    expect(tool.parameters.emotion.required).toBe(true);
    expect(tool.parameters.emotion.enum).toEqual([...EMOTION_NAMES]);
    expect(tool.parameters.intensity.type).toBe("number");
    expect(tool.parameters.intensity.required).toBe(true);
  });

  it("is assignable to RealtimeTool (compile-time conformance)", () => {
    const spy = vi.fn();
    const { tool } = createEmotionTool(spy);
    const check: RealtimeTool = tool;
    expect(check.name).toBe("set_emotion");
  });

  it("description and systemPromptAddition mention set_emotion and 'before' (D-10)", () => {
    const spy = vi.fn();
    const { tool, systemPromptAddition } = createEmotionTool(spy);

    expect(tool.description.toLowerCase()).toContain("set_emotion".toLowerCase());
    expect(tool.description.toLowerCase()).toContain("before");
    expect(systemPromptAddition.toLowerCase()).toContain("set_emotion");
    expect(systemPromptAddition.toLowerCase()).toContain("before");
  });

  it("systemPromptAddition names all 6 emotions", () => {
    const spy = vi.fn();
    const { systemPromptAddition } = createEmotionTool(spy);

    for (const name of EMOTION_NAMES) {
      expect(systemPromptAddition).toContain(name);
    }
  });

  it("returns systemPromptAddition === emotionSystemPrompt", () => {
    const spy = vi.fn();
    const { systemPromptAddition } = createEmotionTool(spy);
    expect(systemPromptAddition).toBe(emotionSystemPrompt);
  });

  it("dispatches through a real ToolExecutor for a valid call", async () => {
    const spy = vi.fn();
    const { tool } = createEmotionTool(spy);
    const executor = new ToolExecutor();
    executor.register(tool.name, tool.execute);

    const result = await executor.execute("set_emotion", {
      emotion: "happy",
      intensity: 0.7,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("happy", 0.7);
    expect(result.success).toBe(true);
    expect(result.message).toContain("happy");
  });

  it("clamps out-of-range intensity to [0, 1]", async () => {
    const spy = vi.fn();
    const { tool } = createEmotionTool(spy);

    await tool.execute({ emotion: "happy", intensity: 999 });
    expect(spy).toHaveBeenLastCalledWith("happy", 1);

    await tool.execute({ emotion: "happy", intensity: -3 });
    expect(spy).toHaveBeenLastCalledWith("happy", 0);
  });

  it("defaults intensity to 0.7 when missing, NaN, or a string", async () => {
    const spy = vi.fn();
    const { tool } = createEmotionTool(spy);

    await tool.execute({ emotion: "happy" });
    expect(spy).toHaveBeenLastCalledWith("happy", DEFAULT_EMOTION_INTENSITY);

    await tool.execute({ emotion: "happy", intensity: NaN });
    expect(spy).toHaveBeenLastCalledWith("happy", DEFAULT_EMOTION_INTENSITY);

    await tool.execute({ emotion: "happy", intensity: "high" });
    expect(spy).toHaveBeenLastCalledWith("happy", DEFAULT_EMOTION_INTENSITY);
  });

  it("rejects an invalid emotion string without calling the setter or throwing", async () => {
    const spy = vi.fn();
    const { tool } = createEmotionTool(spy);

    const result = await tool.execute({ emotion: "<script>", intensity: 0.5 });

    expect(spy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    for (const name of EMOTION_NAMES) {
      expect(result.message).toContain(name);
    }
  });

  it("rejects a differently-cased emotion (case-sensitive allow-list)", async () => {
    const spy = vi.fn();
    const { tool } = createEmotionTool(spy);

    const result = await tool.execute({ emotion: "HAPPY", intensity: 0.5 });

    expect(spy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("rejects a non-string emotion without throwing", async () => {
    const spy = vi.fn();
    const { tool } = createEmotionTool(spy);

    const result = await tool.execute({ emotion: 42, intensity: 0.5 });

    expect(spy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("rejects missing args (undefined/null) without throwing", async () => {
    const spy = vi.fn();
    const { tool } = createEmotionTool(spy);

    const undefinedResult = await tool.execute(undefined);
    expect(spy).not.toHaveBeenCalled();
    expect(undefinedResult.success).toBe(false);

    const nullResult = await tool.execute(null);
    expect(spy).not.toHaveBeenCalled();
    expect(nullResult.success).toBe(false);
  });
});
