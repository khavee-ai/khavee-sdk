// Emotion tool factory for LLM tool-calling integration (D-09..D-11, D-13, D-16)
//
// Like toolGesture, this tool's `parameters` conforms to the FLAT
// RealtimeTool["parameters"] shape (a map of param-name -> schema), not
// toolAnimate's nested JSON-Schema `{ type: "object", properties, required }`
// envelope — see packages/core/src/types/realtime.ts's RealtimeTool interface.
//
// Unlike toolGesture, createEmotionTool() is a FACTORY that wires `execute`
// itself, taking the app's `setEmotionHint` callback and returning a fully
// ready-to-register RealtimeTool. This is what makes it zero-config (D-11) —
// a beginner registers the returned `tool` directly with no extra wiring.
//
// `execute` validates at the tool boundary because arguments arrive from an
// LLM tool call and are therefore untrusted input (T-18-03): `emotion` is
// checked with a strict, case-sensitive allow-list against EMOTION_NAMES, and
// `intensity` is clamped into [0, 1] with a safe default. Invalid input never
// reaches the setter and this function never throws.
//
// This tool only functions end-to-end with a provider that runs a real
// tool-call loop (OpenAIRealtimeProvider, GenericPipelineProvider).
// OpenAISTTTTSProvider never passes tools to its chat completion call, so
// registering this tool there silently no-ops (RESEARCH Pitfall 2) — that
// provider is deliberately NOT modified this milestone (project constraint).

import type { RealtimeTool } from "../types/realtime";

/**
 * The 6 core emotions this phase supports (D-13). Order is significant: it is
 * asserted on directly by tests and mirrored by the react package's local
 * duplicate of this tuple.
 */
export const EMOTION_NAMES = [
  "happy",
  "sad",
  "angry",
  "surprised",
  "neutral",
  "thinking",
] as const;

export type EmotionName = (typeof EMOTION_NAMES)[number];

/** Default intensity used whenever the LLM omits or malforms `intensity`. */
export const DEFAULT_EMOTION_INTENSITY = 0.7;

/**
 * Prose appended to a provider's system instructions so the LLM knows to call
 * `set_emotion` before speaking, once per turn, choosing from the 6 core
 * emotions with a 0.0-1.0 intensity (D-10, D-13, D-16).
 */
export const emotionSystemPrompt =
  "Before you speak your reply each turn, call the set_emotion tool exactly once, " +
  "before saying any words. Choose the emotion that best matches the emotional tone " +
  "of the reply you are about to give, from: happy, sad, angry, surprised, neutral, " +
  "thinking. Pick an intensity between 0.0 and 1.0 to convey how strongly you feel " +
  "it — roughly 0.3 for subtle, 0.7 for clear, 1.0 for strong. Use neutral for plain " +
  "informational replies, and thinking when you are reasoning through something or " +
  "unsure. Never mention the set_emotion tool or say the emotion's name out loud in " +
  "your reply.";

function clampIntensity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return DEFAULT_EMOTION_INTENSITY;
}

function isValidEmotion(value: unknown): value is EmotionName {
  return (
    typeof value === "string" &&
    (EMOTION_NAMES as readonly string[]).includes(value)
  );
}

/**
 * Build a zero-config `set_emotion` RealtimeTool plus a matching
 * system-prompt addition.
 *
 * @param setEmotionHint - Called with a validated `(emotion, intensity)` pair
 *   whenever the LLM makes a valid `set_emotion` call. Never called for
 *   invalid input.
 * @returns `{ tool, systemPromptAddition }` — register `tool` with your
 *   provider's tool-calling API and append `systemPromptAddition` to its
 *   instructions.
 *
 * @example
 * ```ts
 * const { tool, systemPromptAddition } = createEmotionTool(setEmotionHint);
 * provider.registerFunction(tool);
 * provider.instructions += systemPromptAddition;
 * ```
 */
export function createEmotionTool(
  setEmotionHint: (emotion: EmotionName, intensity: number) => void,
): { tool: RealtimeTool; systemPromptAddition: string } {
  const tool: RealtimeTool = {
    name: "set_emotion",
    description:
      "Call set_emotion once, before you begin speaking your reply this turn, to " +
      "signal the emotional tone the avatar's face and voice should convey. Choose " +
      "the emotion that matches the content you are about to say, and an intensity " +
      "for how strongly to convey it.",
    parameters: {
      emotion: {
        type: "string",
        required: true,
        enum: [...EMOTION_NAMES],
        description:
          "The emotion to display: one of happy, sad, angry, surprised, neutral, thinking.",
      },
      intensity: {
        type: "number",
        required: true,
        description:
          "How strongly to convey the emotion, from 0.0 (subtle) to 1.0 (strong). " +
          "About 0.3 is subtle, 0.7 is clear, 1.0 is strong.",
      },
    },
    execute: async (args: any) => {
      const emotionArg = args?.emotion;

      if (!isValidEmotion(emotionArg)) {
        return {
          success: false,
          message:
            "Invalid emotion. Expected one of: " + EMOTION_NAMES.join(", "),
        };
      }

      const intensity = clampIntensity(args?.intensity);
      setEmotionHint(emotionArg, intensity);

      return {
        success: true,
        message: `emotion set: ${emotionArg} (${intensity.toFixed(2)})`,
      };
    },
  };

  return { tool, systemPromptAddition: emotionSystemPrompt };
}
