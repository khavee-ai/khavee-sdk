/**
 * packages/wp-bundle/src/preview/PreviewFloatingWidget.tsx — STUDIO-02 safe
 * floating-widget preview (quick task 260708-1ws; mic/chat controls + chat
 * sheet interactivity added later per direct request; the collapsed-launcher
 * step that briefly followed was then explicitly removed again — an admin
 * configuring the widget wants to see the expanded panel directly, not have
 * to click a launcher bubble first).
 *
 * Mirrors the real front-end floating widget's (../floating/FloatingWidget.tsx)
 * DOM structure/CSS classes verbatim — `.khaveeai-floating-widget` /
 * `-panel` / `-header` / `-avatar-area` / `-sheet` — so the Settings page's
 * live preview can never visually drift from the real widget: any future
 * style change to those classes in styles.css automatically applies to
 * both. `#khaveeai-floating-preview .khaveeai-floating-widget` (styles.css)
 * overrides `position: fixed` to `position: absolute` so this renders
 * inside the ~360x520 preview box instead of floating loose over the rest
 * of wp-admin.
 *
 * Always-expanded, no launcher (locked CONTEXT decision, re-confirmed):
 * unlike the real FloatingWidget.tsx, this renders with `data-open="true"`
 * hardcoded and never renders `.khaveeai-floating-launcher` — there is no
 * collapsed state in this preview at all. The header's close (X) button is
 * rendered for visual fidelity only (no onClick) since there is nothing to
 * return to.
 *
 * Preview-safe by construction: this file deliberately avoids importing the
 * live-session hook the front-end widget relies on to start/manage a real
 * voice connection, the browser microphone-capture API, the front-end's
 * WebRTC session-provider class, or any of the front-end's session-dependent
 * overlay/control components (ControlBar, ClickToTalkOverlay, ResponseBubble,
 * GreetingBubble all call useRealtime(), which throws given the preview's
 * null-provider KhaveeProvider — STUDIO-02). Instead:
 *   - isChatOpen/isMicMuted are local, ephemeral UI state — same shape as
 *     FloatingWidget.tsx's own isChatOpen, just not wired to a real
 *     connection.
 *   - The avatar area uses the shared, preview-safe PreviewAvatarCanvas.
 *     (No "Click to talk" CTA — removed per earlier request; the preview
 *     shows only the avatar, not the front-end's session-start affordance.)
 *   - The mic/chat control row icons are re-declared inline here (not
 *     imported from ControlBar.tsx) specifically to avoid pulling in
 *     useRealtime() at all, even transitively — same reasoning as the rest
 *     of this file.
 *   - The chat slot uses PreviewChatBox with a static example transcript
 *     (no live session hook, no live conversation).
 */
import { useState, type CSSProperties as PreviewStyle } from "react";
import { PreviewAvatarCanvas } from "./PreviewAvatarCanvas";
import { PreviewChatBox, type PreviewExampleMessage } from "./PreviewChatBox";
import type { PreviewAvatarConfig } from "./PreviewScene";

// Preserves the deliberate mock-chat content from quick task 260707-0u6
// (previously PHP-rendered via SettingsPage.php's now-removed
// render_floating_preview_mock_chat()) inside this shared, React-rendered
// chat slot.
const FLOATING_EXAMPLE_MESSAGES: PreviewExampleMessage[] = [
  { role: "assistant", text: "Hi! How can I help you today?" },
  { role: "user", text: "What are your opening hours?" },
  { role: "assistant", text: "We're open 9am to 6pm, Monday to Friday." },
];

export function PreviewFloatingWidget({
  config,
  onCameraAngleChange,
}: {
  config: PreviewAvatarConfig;
  onCameraAngleChange?: (deg: number, tiltDeg: number) => void;
}) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);

  const widgetStyle = config.primaryColor
    ? ({ "--khaveeai-primary": config.primaryColor } as PreviewStyle)
    : undefined;

  return (
    <div
      className="khaveeai-floating-widget"
      data-open="true"
      data-position="bottom-right"
      style={widgetStyle}
    >
      <div className="khaveeai-floating-panel">
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="khaveeai-floating-header">
          <div className="khaveeai-floating-header-identity">
            {/* Status dot omitted here (unlike the real FloatingWidget.tsx) —
                there is no live connection in a preview-safe mount, so an
                "online" dot would always read false and just be noise. */}
            <div className="khaveeai-floating-header-title">
              {config.floatingWidgetName || "AI Assistant"}
            </div>
          </div>
          <button
            type="button"
            className="khaveeai-floating-close"
            aria-label="Minimize"
            onClick={() => {
              /* no-op: always-expanded preview has no collapsed state to
                 return to (locked CONTEXT decision) */
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Avatar area ───────────────────────────────────────────────── */}
        {/* SettingsPage.php's render_floating_preview_mount() maps its five
            floating_ settings onto the GENERIC config keys PreviewAvatarCanvas
            and resolveSceneDefaults actually read (bgColor, bgTransparent,
            avatarScale, etc), not the floatingBgColor/floatingAvatarScale-style
            keys the real FloatingWidget.tsx reads from the published-page
            config — read the same generic keys here to match what PHP emits. */}
        <div
          className="khaveeai-floating-avatar-area"
          style={{
            // `||`, not `??`: rebuild()'s cfg.bgColor is always a string
            // ('#6929ff' fallback baked in there too, but kept here for
            // parity with the real front-end's same-shaped fallback chain).
            background: config.bgTransparent
              ? "transparent"
              : config.bgColor || config.primaryColor || "#6929ff",
          }}
        >
          <PreviewAvatarCanvas config={config} onCameraAngleChange={onCameraAngleChange} />

          {/* Mic mute/unmute + chat sheet toggle — mirrors ControlBar.tsx's
              markup/classes exactly (not imported, see file header) so it's
              visually identical without pulling in useRealtime(). Mic button
              is decorative (local isMicMuted only, no real mic anywhere in
              a preview). */}
          <div
            className={`khaveeai-controls khaveeai-floating-controls${isChatOpen ? " khaveeai-floating-controls--sheet-open" : ""}`}
          >
            <button
              type="button"
              className="khaveeai-control-btn khaveeai-control-btn--mic"
              onClick={() => setIsMicMuted((v) => !v)}
              aria-label={isMicMuted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={isMicMuted}
            >
              {isMicMuted ? <MicOffIcon /> : <MicIcon />}
            </button>
            <button
              type="button"
              className="khaveeai-control-btn khaveeai-control-btn--chat"
              onClick={() => setIsChatOpen((v) => !v)}
              aria-label={isChatOpen ? "Hide chat" : "Show chat"}
              aria-pressed={isChatOpen}
            >
              <ChatIcon />
            </button>
          </div>

          {/* ── Chat sheet ──────────────────────────────────────────────── */}
          <div
            className="khaveeai-floating-sheet"
            data-chat-open={isChatOpen ? "true" : "false"}
          >
            <div
              className="khaveeai-floating-sheet-handle"
              onClick={() => setIsChatOpen(false)}
              role="button"
              aria-label="Close chat"
            >
              <span className="khaveeai-floating-sheet-grip" />
            </div>
            <PreviewChatBox placement="below" exampleMessages={FLOATING_EXAMPLE_MESSAGES} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Re-declared rather than imported from ControlBar.tsx (see file header) —
// identical markup, no useRealtime() dependency.
function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 4.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a6.98 6.98 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
