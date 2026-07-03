/**
 * packages/wp-bundle/src/ui/ControlBar.tsx
 *
 * Bottom-center overlay row of icon-only controls shown once connected —
 * mic mute/unmute and chat panel show/hide, mirroring khavee-app's
 * PreviewControls.tsx. Only rendered while isConnected: before that,
 * ClickToTalkOverlay is the sole affordance and this never calls connect()
 * itself (keeps the "one connect button" rule from ClickToTalkOverlay's
 * own header comment intact).
 *
 * Icons are inline SVGs (no icon library), matching the existing convention
 * in ChatBox.tsx's send button.
 */
import { useRealtime } from "@khaveeai/react";

export function ControlBar({
  chatEnabled,
  isChatOpen,
  onToggleChat,
}: {
  /** Whether the admin config allows a chat panel to exist at all (config.chatShow). */
  chatEnabled: boolean;
  isChatOpen: boolean;
  onToggleChat: () => void;
}) {
  const { isConnected, isMicEnabled, toggleMicrophone } = useRealtime();

  if (!isConnected) {
    return null;
  }

  return (
    <div className="khaveeai-controls">
      <button
        type="button"
        className="khaveeai-control-btn khaveeai-control-btn--mic"
        onClick={() => toggleMicrophone()}
        aria-label={isMicEnabled ? "Mute microphone" : "Unmute microphone"}
        aria-pressed={!isMicEnabled}
      >
        {isMicEnabled ? <MicIcon /> : <MicOffIcon />}
      </button>
      {chatEnabled && (
        <button
          type="button"
          className="khaveeai-control-btn khaveeai-control-btn--chat"
          onClick={onToggleChat}
          aria-label={isChatOpen ? "Hide chat" : "Show chat"}
          aria-pressed={isChatOpen}
        >
          <ChatIcon />
        </button>
      )}
    </div>
  );
}

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
