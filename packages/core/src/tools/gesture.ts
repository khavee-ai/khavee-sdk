// Gesture tool for LLM tool-calling integration
//
// Unlike toolAnimate, this tool's `parameters` MUST conform to the FLAT
// RealtimeTool["parameters"] shape (a map of param-name -> schema), not a
// nested JSON-Schema `{ type: "object", properties, required }` envelope —
// see packages/core/src/types/realtime.ts's RealtimeTool interface.
export const toolGesture = {
  name: "set_gesture",
  description:
    "Call this as part of your normal response to signal a head gesture that should " +
    "accompany what you are saying this turn. Choose \"nod\" when you are affirming, " +
    "agreeing, or answering in the affirmative. Choose \"shake\" when you are denying, " +
    "disagreeing, or answering in the negative. Choose \"none\" when neither applies and " +
    "no gesture should play this turn. Base the choice on the semantic intent of your " +
    "reply, not on any specific language's keywords.",
  parameters: {
    gesture: {
      type: "string" as const,
      enum: ["nod", "shake", "none"],
      required: true,
      description:
        "The head gesture to play this turn: \"nod\" (affirm/agree/yes), " +
        "\"shake\" (deny/disagree/no), or \"none\" (no gesture).",
    },
  },
};
