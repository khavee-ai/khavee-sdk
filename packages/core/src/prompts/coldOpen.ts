/**
 * Cold-open prompt for the assistant's very first turn.
 *
 * Realtime providers (OpenAI WebRTC, xAI WebSocket) open a session with zero
 * conversation history and then request a response. Without an anchor the
 * model infers "start of conversation" purely from `instructions` — which
 * describe ongoing-conversation behaviour — and the greeting can read like a
 * reply to a question the user never asked. This prompt is that anchor.
 *
 * With a `greeting` configured, the anchor also pins the opening line so the
 * model says the configured text verbatim instead of improvising one.
 */

export const DEFAULT_COLD_OPEN_PROMPT =
  "This is the very start of the conversation — the user has not spoken or typed anything yet. Deliver your opening greeting now, exactly as instructed, without referencing or responding to anything as if the user had said something.";

/**
 * Build the cold-open prompt for the first response.
 *
 * @param greeting Optional fixed opening line. Blank/whitespace counts as unset.
 * @returns The default improvise-per-instructions prompt when no greeting is
 *   set; otherwise a prompt instructing the model to say the greeting word for
 *   word, in the language it is written in, with nothing added.
 */
export function buildColdOpenPrompt(greeting?: string): string {
  const text = greeting?.trim();
  if (!text) return DEFAULT_COLD_OPEN_PROMPT;
  return (
    "This is the very start of the conversation — the user has not spoken or typed anything yet. " +
    "Your opening line is fixed. Say exactly the following greeting, word for word, in the language it is written in — " +
    "do not translate it, do not shorten or expand it, do not add anything before or after it, " +
    "and do not respond as if the user had said something:\n\n" +
    `"${text}"`
  );
}
