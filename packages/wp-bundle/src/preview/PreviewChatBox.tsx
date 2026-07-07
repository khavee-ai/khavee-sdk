/**
 * packages/wp-bundle/src/preview/PreviewChatBox.tsx — STUDIO-02 safe chat
 * panel mockup for the editor preview.
 *
 * The real ChatBox (ui/ChatBox.tsx) calls useRealtime(), which throws when
 * the realtime provider is null (useRealtime.ts:36-40) — and the preview's
 * KhaveeProvider is deliberately given no realtime config (STUDIO-02: no
 * mic, no token, no live session in the editor). So this component reuses
 * ChatBox's markup/CSS classes to preview layout and placement (beside/below)
 * WYSIWYG.
 *
 * By default it renders a static "disconnected" body (no session to show
 * messages from). When the optional `exampleMessages` prop is provided
 * (non-empty), it instead renders a static example transcript using the
 * SAME `.khaveeai-chat__transcript` / `.khaveeai-chat__bubble--{role}`
 * classes/nesting the real ChatBox.tsx uses for a live conversation — quick
 * task 260708-1ws uses this to move the floating-preview's mock chat content
 * (previously PHP-rendered, quick task 260707-0u6) into this shared,
 * React-rendered component.
 */
export interface PreviewExampleMessage {
  role: "assistant" | "user";
  text: string;
}

export function PreviewChatBox({
  placement,
  exampleMessages,
}: {
  placement: "beside" | "below";
  exampleMessages?: PreviewExampleMessage[];
}) {
  const hasExamples = !!exampleMessages && exampleMessages.length > 0;

  return (
    <div className={`khaveeai-chat khaveeai-chat--${placement} khaveeai-chat--ready`}>
      <div className="khaveeai-chat__header">AI Assistant</div>
      {hasExamples ? (
        <div className="khaveeai-chat__transcript">
          {exampleMessages!.map((msg, i) => (
            <div
              key={i}
              className={`khaveeai-chat__bubble khaveeai-chat__bubble--${msg.role}`}
            >
              {msg.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="khaveeai-chat__disconnected">
          Click the avatar to start, then type here.
        </div>
      )}
    </div>
  );
}
