/**
 * packages/wp-bundle/src/floating/ResponseBubble.tsx
 *
 * Floating widget only: a plain white pill above ControlBar's mic/chat
 * buttons showing the AI's current reply, so a visitor can read along
 * without opening the chat sheet. Visible while chatStatus is "speaking";
 * stays up 5s after speaking ends, then fades out (300ms, styles.css).
 *
 * The element itself stays mounted (opacity:0, pointer-events:none) once
 * the AI has said anything at all — only the --visible class toggles.
 * Returning null on hide (the earlier version) would unmount the node
 * with no fade to animate; a plain CSS opacity transition needs the node
 * to still be there while it plays.
 *
 * Deliberately does NOT copy the assistant text into its own useState.
 * Both providers mutate the shared conversation array in place —
 * OpenAISTTTTSProvider pushes one complete entry per turn,
 * OpenAIRealtimeProvider streams deltas onto an existing entry via
 * `lastMsg.text += delta` — neither ever reassigns the array
 * (OpenAISTTTTSProvider.ts, OpenAIRealtimeProvider.ts). A useState
 * snapshot would go stale the same way ChatBox's old scroll effect did
 * (see its file header for the full root-cause writeup): dependency
 * checks use Object.is and can't see an in-place mutation. Reading
 * conversation fresh on every render sidesteps that — this component
 * already re-renders on every chatStatus/currentVolume tick useRealtime()
 * produces while the AI is speaking, so the visible text stays live
 * without needing its own change-detection.
 */
import { useEffect, useRef, useState } from "react";
import { useRealtime } from "@khaveeai/react";

const HIDE_DELAY_MS = 5000;

export function ResponseBubble({ hidden }: { hidden?: boolean }) {
  const { conversation, chatStatus } = useRealtime();
  const [isVisible, setIsVisible] = useState(false);
  const wasSpeakingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // chatStatus is a plain string primitive (unlike conversation), so it's
  // safe to depend on directly — show instantly on speaking start, and on
  // the speaking -> anything-else transition, keep the reply up for
  // HIDE_DELAY_MS before clearing it.
  useEffect(() => {
    const isSpeaking = chatStatus === "speaking";

    if (isSpeaking) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setIsVisible(true);
    } else if (wasSpeakingRef.current) {
      hideTimerRef.current = setTimeout(() => {
        setIsVisible(false);
        hideTimerRef.current = null;
      }, HIDE_DELAY_MS);
    }

    wasSpeakingRef.current = isSpeaking;
  }, [chatStatus]);

  // Clears a still-pending hide timer if the widget unmounts mid-countdown.
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (hidden) return null;

  const latestAssistantText = [...conversation]
    .reverse()
    .find((m) => m.role === "assistant")?.text;

  // Nothing has ever been said yet — no bubble to fade in from.
  if (!latestAssistantText) return null;

  return (
    <div
      className={`khaveeai-response-bubble${isVisible ? " khaveeai-response-bubble--visible" : ""}`}
      role="status"
    >
      {latestAssistantText}
    </div>
  );
}
