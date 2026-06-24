/**
 * packages/wp-bundle/src/ui/ClickToTalkOverlay.tsx
 *
 * Idle/connecting overlay for the avatar mount point (D-01/D-02). Reads
 * chatStatus via useRealtime() as a sibling consumer of the same
 * KhaveeProvider context the avatar canvas consumes — never prop-drilled.
 *
 * connect() is called ONLY from inside this component's onClick handler —
 * never at module scope, never in an effect, never on mount. The mic
 * permission prompt and the REST token-mint request both fire for the
 * first time only as a direct result of that click (EMBED-05, T-08-02).
 */
import { useState } from "react";
import { useRealtime } from "@khaveeai/react";

export function ClickToTalkOverlay() {
  const { connect, chatStatus } = useRealtime();
  const [isConnecting, setIsConnecting] = useState(false);

  if (chatStatus !== "stopped" && !isConnecting) {
    return null;
  }

  const handleClick = async (): Promise<void> => {
    setIsConnecting(true);
    try {
      await connect();
    } finally {
      setIsConnecting(false);
    }
  };

  const connecting = chatStatus === "starting" || isConnecting;

  return (
    <div className={`khaveeai-overlay ${connecting ? "khaveeai-overlay--connecting" : ""}`}>
      <button
        type="button"
        className="khaveeai-cta-button"
        onClick={handleClick}
        disabled={connecting}
      >
        {connecting ? "Connecting…" : "Click to talk"}
      </button>
    </div>
  );
}
