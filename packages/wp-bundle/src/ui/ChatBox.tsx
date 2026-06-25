/**
 * packages/wp-bundle/src/ui/ChatBox.tsx
 *
 * Bespoke, dependency-free chat panel for the Khavee WP embed (STUDIO-03).
 * Consumes useRealtime() from @khaveeai/react — the realtime provider is the
 * single source of truth for the transcript and sendMessage. No local useState
 * transcript; no second connection; no icon library.
 *
 * Security (T-09-04-01): assistant messages render as {msg.text} (React
 * auto-escapes all string interpolation). Plain-text-only rendering — no
 * raw HTML injection, no markdown parsing anywhere in this file.
 *
 * Connection model: the ChatBox NEVER calls connect() itself. Connection is
 * always initiated by the existing ClickToTalkOverlay (EMBED-05, T-08-02).
 * When isConnected is false this component shows a helper text — NOT a
 * "Connect to AI" button — to avoid a competing connect affordance.
 */
import { useState, useEffect, useRef } from "react";
import { useRealtime } from "@khaveeai/react";

export function ChatBox({ placement }: { placement: "beside" | "below" }) {
  const { conversation, sendMessage, chatStatus, isConnected } = useRealtime();
  const [input, setInput] = useState("");
  // scrollRef: the scrollable transcript container, used for the pinned-to-bottom check.
  const scrollRef = useRef<HTMLDivElement>(null);
  // endRef: empty sentinel div at the end of the transcript; scrollIntoView anchor.
  const endRef = useRef<HTMLDivElement>(null);

  // ── Auto-scroll (pinned-to-bottom rule) ──────────────────────────────────────
  // Lifted from khavee-app ChatBox.tsx:41-48 + RESEARCH pinned-to-bottom rule
  // (UI-SPEC §Interaction-States "ChatBox — scrollback" row).
  // Only auto-scrolls if the visitor is already within 80px of the bottom.
  // Visitors who have scrolled up to read history are NOT yanked back down.
  useEffect(() => {
    if (
      scrollRef.current &&
      scrollRef.current.scrollHeight -
        scrollRef.current.scrollTop -
        scrollRef.current.clientHeight <
        80
    ) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [conversation]);

  // ── Send handler ─────────────────────────────────────────────────────────────
  // Guards against empty/whitespace messages and messages sent while disconnected.
  function handleSend() {
    const text = input.trim();
    if (!text || !isConnected) return;
    // sendMessage joins the existing realtime session (no new connection).
    sendMessage(text);
    setInput("");
  }

  // ── Keyboard handler (lifted from khavee-app ChatBox.tsx:57-62) ──────────────
  // Enter (no Shift) prevents default and sends.
  // Shift+Enter is left as default browser behaviour (inserts a newline).
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    // chatStatus class hook lets CSS animate a "thinking" indicator later
    // (UI-SPEC §Interaction-States "Active — listening / thinking").
    <div
      className={`khaveeai-chat khaveeai-chat--${placement} khaveeai-chat--${chatStatus}`}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      {/* "AI Assistant" — verbatim UI-SPEC copywriting; white-label WP embed uses no brand name */}
      <div className="khaveeai-chat__header">AI Assistant</div>

      {/* ── Body: three mutually exclusive states ────────────────────────── */}

      {!isConnected ? (
        // Disconnected state: helper text only — no Connect button.
        // UI-SPEC copywriting verbatim; ClickToTalkOverlay is the only connect affordance.
        <div className="khaveeai-chat__disconnected">
          Click the avatar to start, then type here.
        </div>
      ) : conversation.length === 0 ? (
        // Connected but no messages yet: empty state.
        // UI-SPEC copywriting verbatim.
        <div className="khaveeai-chat__empty-state">
          <p className="khaveeai-chat__empty-heading">Start the conversation</p>
          <p className="khaveeai-chat__empty-body">
            Type a message below or click the avatar to talk.
          </p>
        </div>
      ) : (
        // Connected with messages: scrollable transcript.
        <div className="khaveeai-chat__transcript" ref={scrollRef}>
          {conversation.map((msg, i) => (
            // bubble--user: right-aligned, accent bg (#2271b1)
            // bubble--assistant: left-aligned, neutral translucent bg
            // Plain {msg.text} — React auto-escapes; XSS-safe (T-09-04-01)
            <div
              key={i}
              className={`khaveeai-chat__bubble khaveeai-chat__bubble--${msg.role}`}
            >
              {msg.text}
            </div>
          ))}
          {/* Scroll-to-bottom anchor */}
          <div ref={endRef} />
        </div>
      )}

      {/* ── Input row (only rendered when connected) ────────────────────── */}
      {isConnected && (
        <div className="khaveeai-chat__input-row">
          <textarea
            className="khaveeai-chat__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            aria-label="Message"
          />
          <button
            type="button"
            className="khaveeai-chat__send"
            onClick={handleSend}
            aria-label="Send message"
          >
            {/* Paper-plane icon — single inline SVG, no icon library (UI-SPEC §Design System) */}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
              fill="currentColor"
            >
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
