/**
 * packages/wp-bundle/src/ui/ErrorOverlay.tsx
 *
 * Generic, visitor-facing runtime connect-error state. OpenAIRealtimeProvider
 * never rejects/throws out of connect() for foreseeable failures (mic
 * permission denied, network) — it catches internally, calls
 * onError?.(error), then resets chatStatus back to "stopped" (see
 * OpenAIRealtimeProvider.connect()'s catch block). This component chains
 * onto that same onError callback (preserving any existing subscriber,
 * exactly as useRealtime() chains onChatStatusChange) so a sibling consumer
 * of the same KhaveeProvider context can surface a generic failure message
 * without ever exposing the raw error/HTTP status to the visitor.
 *
 * "Try again" simply clears local error state — chatStatus is already
 * "stopped" by the time this renders, so the next click re-enters the
 * normal click-to-connect flow in ClickToTalkOverlay (no auto-retry).
 */
import { useEffect, useState } from "react";
import { useKhavee } from "@khaveeai/react";

export function ErrorOverlay() {
  const { realtimeProvider } = useKhavee();
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!realtimeProvider) return;

    const upstreamOnError = realtimeProvider.onError;
    realtimeProvider.onError = (error: Error) => {
      upstreamOnError?.(error);
      setHasError(true);
    };

    return () => {
      realtimeProvider.onError = upstreamOnError;
    };
  }, [realtimeProvider]);

  if (!hasError) {
    return null;
  }

  return (
    <div className="khaveeai-overlay khaveeai-overlay--error">
      <span className="khaveeai-error-text">Couldn&apos;t connect.</span>
      <button
        type="button"
        className="khaveeai-cta-button khaveeai-cta-button--retry"
        onClick={() => setHasError(false)}
      >
        Try again
      </button>
    </div>
  );
}
