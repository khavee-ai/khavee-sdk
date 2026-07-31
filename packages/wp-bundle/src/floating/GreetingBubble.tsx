/**
 * packages/wp-bundle/src/floating/GreetingBubble.tsx
 *
 * First-visit invite bubble shown near the closed launcher (UX finding:
 * the launcher was a bare icon with no context — a first-time visitor had
 * no idea this opens a voice AI, or any hint before the mic-permission ask
 * that follows). Purely presentational; all timing/dismissal-persistence
 * state lives in FloatingWidget.tsx (matches this codebase's existing
 * split — FloatingWidget owns local UI state, its children are dumb).
 */
export function GreetingBubble({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="khaveeai-floating-greeting" role="status">
      <button
        type="button"
        className="khaveeai-floating-greeting-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden="true"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <p>Talk to our AI assistant</p>
    </div>
  );
}
