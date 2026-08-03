/**
 * packages/wp-bundle/src/ui/ClickToTalkOverlay.tsx
 *
 * Idle/connecting overlay for the avatar mount point (D-01/D-02). Reads
 * chatStatus via useRealtime() as a sibling consumer of the same
 * KhaveeProvider context the avatar canvas consumes — never prop-drilled.
 *
 * connect() is called ONLY from inside this component's onClick handlers —
 * never at module scope, never in an effect, never on mount. The mic
 * permission prompt and the REST token-mint request both fire for the
 * first time only as a direct result of a click (EMBED-05, T-08-02). This
 * now has TWO such onClick call sites — the CTA button itself, and each
 * suggested-prompt chip below it — both still direct, synchronous results
 * of a user click, so the invariant holds; it's just no longer a single
 * literal button element.
 *
 * suggestedPrompts (floating widget only — inline embed never passes it,
 * so this is a no-op there) renders tappable chips above the CTA button:
 * tapping one connects AND immediately sends that prompt as the first
 * message, in one gesture, rather than requiring "click to talk" then
 * type the same thing again.
 */
import { useState } from "react";
import { useRealtime } from "@khaveeai/react";

export function ClickToTalkOverlay({
  suggestedPrompts,
}: {
  suggestedPrompts?: string[];
}) {
  const { connect, sendMessage, chatStatus } = useRealtime();
  const [isConnecting, setIsConnecting] = useState(false);

  if (chatStatus !== "stopped" && !isConnecting) {
    return null;
  }

  const connecting = chatStatus === "starting" || isConnecting;

  // Shared by the CTA button (no promptText) and each suggested-prompt
  // chip (promptText set) — connect() first, then send the prompt once
  // the session is actually up, never before.
  async function startConversation(promptText?: string): Promise<void> {
    setIsConnecting(true);
    try {
      await connect();
      if (promptText) {
        sendMessage(promptText);
      }
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className={`khaveeai-overlay ${connecting ? "khaveeai-overlay--connecting" : ""}`}>
      {/* .khaveeai-overlay is a centering flex row with exactly one child
          by design (see its base rule in styles.css) — this wrapper keeps
          that true while stacking the chips above the button internally,
          rather than making chips + button separate row-level siblings. */}
      <div className="khaveeai-cta-stack">
        {!connecting && suggestedPrompts && suggestedPrompts.length > 0 && (
          <div className="khaveeai-suggested-prompts">
            {suggestedPrompts.map((prompt, i) => (
              <button
                key={i}
                type="button"
                className="khaveeai-suggested-prompt-chip"
                onClick={() => startConversation(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="khaveeai-cta-button"
          onClick={() => startConversation()}
          disabled={connecting}
        >
          {connecting ? (
            "Connecting…"
          ) : (
            <>
              <MicGlyph />
              Click to talk
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Small static mic glyph (UX finding: the CTA read as a generic pill with
// no visual cue that this starts a VOICE conversation, not a text chat).
// Deliberately not the same MicIcon as ControlBar's mute toggle — that one
// is sized/stroked for a 48px circular icon-only button; this one sits
// inline with text at a much smaller size.
function MicGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
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
