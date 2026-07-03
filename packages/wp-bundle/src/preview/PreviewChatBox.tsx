/**
 * packages/wp-bundle/src/preview/PreviewChatBox.tsx — STUDIO-02 safe chat
 * panel mockup for the editor preview.
 *
 * The real ChatBox (ui/ChatBox.tsx) calls useRealtime(), which throws when
 * the realtime provider is null (useRealtime.ts:36-40) — and the preview's
 * KhaveeProvider is deliberately given no realtime config (STUDIO-02: no
 * mic, no token, no live session in the editor). So this component reuses
 * ChatBox's markup/CSS classes to preview layout and placement (beside/below)
 * WYSIWYG, but renders a static "disconnected" body instead of a live
 * transcript — there is no session to show messages from in the editor.
 */
export function PreviewChatBox({ placement }: { placement: "beside" | "below" }) {
  return (
    <div className={`khaveeai-chat khaveeai-chat--${placement} khaveeai-chat--ready`}>
      <div className="khaveeai-chat__header">AI Assistant</div>
      <div className="khaveeai-chat__disconnected">
        Click the avatar to start, then type here.
      </div>
    </div>
  );
}
