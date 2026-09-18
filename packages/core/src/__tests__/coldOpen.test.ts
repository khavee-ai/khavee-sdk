import { describe, it, expect } from "vitest";
import { buildColdOpenPrompt, DEFAULT_COLD_OPEN_PROMPT } from "../prompts/coldOpen";

describe("buildColdOpenPrompt", () => {
  it("returns the default improvise prompt when no greeting is given", () => {
    expect(buildColdOpenPrompt()).toBe(DEFAULT_COLD_OPEN_PROMPT);
    expect(buildColdOpenPrompt(undefined)).toBe(DEFAULT_COLD_OPEN_PROMPT);
  });

  it("treats a blank / whitespace-only greeting as unset", () => {
    expect(buildColdOpenPrompt("")).toBe(DEFAULT_COLD_OPEN_PROMPT);
    expect(buildColdOpenPrompt("   \n\t ")).toBe(DEFAULT_COLD_OPEN_PROMPT);
  });

  it("quotes the greeting verbatim and asks for word-for-word delivery", () => {
    const prompt = buildColdOpenPrompt("สวัสดีค่ะ ยินดีต้อนรับสู่ Khavee");
    expect(prompt).toContain('"สวัสดีค่ะ ยินดีต้อนรับสู่ Khavee"');
    expect(prompt).toContain("word for word");
    expect(prompt).toContain("in the language it is written in");
    expect(prompt).toContain("very start of the conversation");
    expect(prompt).not.toBe(DEFAULT_COLD_OPEN_PROMPT);
  });

  it("trims surrounding whitespace from the greeting before quoting it", () => {
    const prompt = buildColdOpenPrompt("  Hi there!  ");
    expect(prompt).toContain('"Hi there!"');
    expect(prompt).not.toContain('"  Hi there!  "');
  });
});
