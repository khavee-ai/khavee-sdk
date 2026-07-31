/**
 * packages/wp-bundle/src/ui/TypingIndicator.tsx
 *
 * Three-dot "thinking" bubble shown in the transcript while the assistant
 * is processing a response (isThinking from useRealtime()) and hasn't
 * started streaming text yet. Wires up the khaveeai-chat--{chatStatus}
 * class hook ChatBox.tsx already applies but that previously had no
 * corresponding CSS (comment there said "later" — this is it).
 */
export function TypingIndicator() {
  return (
    <div
      className="khaveeai-chat__typing"
      role="status"
      aria-label="Assistant is thinking"
    >
      <span className="khaveeai-chat__typing-dot" />
      <span className="khaveeai-chat__typing-dot" />
      <span className="khaveeai-chat__typing-dot" />
    </div>
  );
}
