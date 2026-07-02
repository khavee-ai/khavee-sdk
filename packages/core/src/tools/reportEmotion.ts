import type { RealtimeTool } from "../types/realtime";

export type ConversationEmotion = "happy" | "sad" | "neutral";

export interface CreateEmotionToolOptions {
  /** Called whenever the model reports a change in the conversation's emotional tone. */
  onEmotion: (emotion: ConversationEmotion) => void;
  toolName?: string;
  toolDescription?: string;
}

/**
 * Creates a RealtimeTool that lets the model report the conversation's
 * emotional tone directly, instead of relying on client-side keyword
 * matching (which breaks for any language the keyword list doesn't cover).
 * The model already understands tone/language/context — this just gives it
 * a way to surface that read so the avatar's expression can reflect it.
 */
export function createEmotionTool(options: CreateEmotionToolOptions): RealtimeTool {
  const {
    onEmotion,
    toolName = "report_emotion",
    toolDescription = "Report the current emotional tone of the conversation so the avatar's facial expression can reflect it. Call this whenever the tone shifts — e.g. the user seems happy or pleased, or the user seems upset, hostile, or is arguing with you. Call again with 'neutral' once the tone returns to normal.",
  } = options;

  return {
    name: toolName,
    description: toolDescription,
    parameters: {
      emotion: {
        type: "string",
        required: true,
        enum: ["happy", "sad", "neutral"],
        description:
          "The detected emotional tone: 'happy' for a positive/friendly tone, 'sad' for a negative/hostile/frustrated tone, 'neutral' otherwise.",
      },
    },
    execute: async (args: any) => {
      const emotion: ConversationEmotion =
        args?.emotion === "happy" || args?.emotion === "sad" ? args.emotion : "neutral";
      onEmotion(emotion);
      return { success: true, message: `Emotion set to ${emotion}` };
    },
  };
}
