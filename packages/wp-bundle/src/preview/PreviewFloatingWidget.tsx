/**
 * packages/wp-bundle/src/preview/PreviewFloatingWidget.tsx — STUDIO-02 safe
 * floating-widget preview (quick task 260708-1ws).
 *
 * Mirrors the real front-end floating widget's (../floating/FloatingWidget.tsx)
 * panel structure/CSS classes verbatim — `.khaveeai-floating-panel` /
 * `-header` / `-avatar-area` / `-chat` — so the Settings page's live preview
 * can never visually drift from the real widget: any future style change to
 * those classes in styles.css automatically applies to both.
 *
 * Preview-safe by construction: this file deliberately avoids importing the
 * live-session hook the front-end widget relies on to start/manage a real
 * voice connection, the browser microphone-capture API, the front-end's
 * WebRTC session-provider class, or any of the front-end's session-dependent
 * overlay/control components — all of those depend on that live-session
 * hook, which throws given the preview's null-provider KhaveeProvider
 * (STUDIO-02). Instead:
 *   - The avatar area uses the shared, preview-safe PreviewAvatarCanvas.
 *     (No "Click to talk" CTA — removed per user request; the preview
 *     shows only the avatar, not the front-end's session-start affordance.)
 *   - The chat slot uses PreviewChatBox with a static example transcript
 *     (no live session hook, no live conversation).
 *
 * Always-expanded, no launcher (locked CONTEXT decision): unlike the real
 * FloatingWidget.tsx, this component renders ONLY `.khaveeai-floating-panel`
 * — no `.khaveeai-floating-widget` wrapper, no `data-open` toggle, no
 * `.khaveeai-floating-launcher` button. Admins configuring the floating
 * widget want to see the expanded panel state directly. The header's close
 * (X) button is rendered for visual fidelity only (no onClick) since there
 * is no collapsed state to return to in this preview context.
 */
import type { CSSProperties as PreviewStyle } from "react";
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
  return (
    <div
      className="khaveeai-floating-panel"
      style={
        config.primaryColor
          ? ({ "--khaveeai-primary": config.primaryColor } as PreviewStyle)
          : undefined
      }
    >
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
      </div>

      {/* ── Chat ──────────────────────────────────────────────────────── */}
      <div className="khaveeai-floating-chat">
        <PreviewChatBox placement="below" exampleMessages={FLOATING_EXAMPLE_MESSAGES} />
      </div>
    </div>
  );
}
