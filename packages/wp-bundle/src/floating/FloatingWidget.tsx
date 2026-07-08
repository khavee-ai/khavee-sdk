/**
 * packages/wp-bundle/src/floating/FloatingWidget.tsx
 *
 * Site-wide floating chat launcher (FLOAT-01, quick task 260704-77n). A new
 * LAYOUT/CONTAINER around the already-working avatar+chat pieces — NOT a
 * rebuild of the avatar/chat/voice pipeline. AppRoot (../mount.tsx) renders
 * this component in place of the inline embed layout when config.floating
 * is true; it still renders inside the same KhaveeProvider AppRoot's caller
 * (mountAvatarInstance) constructs, so AvatarScene/ChatBox/ClickToTalkOverlay/
 * ErrorOverlay/ControlBar all reach useRealtime()/useKhavee() normally.
 *
 * isOpen is local, ephemeral UI state (collapsed launcher vs. expanded
 * panel) — it does NOT gate the realtime connection or the chat transcript;
 * those are owned entirely by the existing pieces this component wraps.
 *
 * Design spec (mockup, verbatim colors/dimensions): solid #6929ff, #dde1ea
 * border, 20px panel radius, 220ms cubic-bezier(0.2,0.8,0.2,1) transform
 * transition — NO box-shadow, NO gradient anywhere (see styles.css).
 *
 * Bugfix (found live against wp-env, 2026-07-04): AvatarScene is wrapped in
 * AvatarErrorBoundary (../ui/AvatarErrorBoundary) because @react-three/fiber's
 * <Canvas> re-throws any internally-caught render error on its own next
 * render — an uncaught GLB/VRM load failure (e.g. a CORS-rejected S3 avatar
 * URL) would otherwise propagate all the way out and unmount this ENTIRE
 * mount point's React root (chat transcript, launcher, everything), even
 * though only the avatar itself is broken. See AvatarErrorBoundary.tsx for
 * the full root-cause writeup.
 */
import { useState } from "react";
import { AvatarScene } from "../mount";
import { ChatBox } from "../ui/ChatBox";
import { ClickToTalkOverlay } from "../ui/ClickToTalkOverlay";
import { ErrorOverlay } from "../ui/ErrorOverlay";
import { ControlBar } from "../ui/ControlBar";
import { AvatarErrorBoundary } from "../ui/AvatarErrorBoundary";
import type { KhaveeAvatarConfig } from "../config";

export function FloatingWidget({ config }: { config: KhaveeAvatarConfig }) {
  const [isOpen, setIsOpen] = useState(false);

  // Derived scene config for the floating avatar area ONLY: maps the
  // floating*-prefixed fields onto the keys AvatarScene actually reads
  // (avatarScale/avatarOffsetX/avatarOffsetY/bgTransparent), with fixed
  // defaults (not the global inline-embed values) so the floating widget
  // is independently configurable (quick task 260705-p30).
  const floatingSceneConfig: KhaveeAvatarConfig = {
    ...config,
    avatarScale: config.floatingAvatarScale ?? 1.0,
    avatarOffsetX: config.floatingAvatarOffsetX ?? 0.0,
    avatarOffsetY: config.floatingAvatarOffsetY ?? 0.0,
    bgTransparent: config.floatingBgTransparent ?? false,
    cameraRotationY: config.floatingCameraRotationY ?? 0.0,
  };

  return (
    <div
      className="khaveeai-floating-widget"
      data-open={isOpen ? "true" : "false"}
    >
      <div className="khaveeai-floating-panel">
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="khaveeai-floating-header">
          <div className="khaveeai-floating-header-title">AI Assistant</div>
          <button
            type="button"
            className="khaveeai-floating-close"
            aria-label="Minimize"
            onClick={() => setIsOpen(false)}
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
        {/* Real AvatarScene + ClickToTalkOverlay (the actual "Click to talk"
            CTA, not the mockup's static button) + ErrorOverlay so connect
            errors surface inside the panel. */}
        <div
          className="khaveeai-floating-avatar-area"
          style={{
            background: config.floatingBgTransparent
              ? "transparent"
              : config.floatingBgColor ?? "#6929ff",
          }}
        >
          {config.avatarUrl ? (
            <AvatarErrorBoundary>
              <AvatarScene config={floatingSceneConfig} />
            </AvatarErrorBoundary>
          ) : null}
          <ClickToTalkOverlay />
          <ErrorOverlay />
          {/* Mic mute/unmute only (no chat toggle) — anchored bottom-right of
              this avatar area, clear of the centered ClickToTalkOverlay CTA.
              No-op chat toggle since the panel's own launcher/close already
              governs visibility. */}
          <ControlBar
            chatEnabled
            isChatOpen
            onToggleChat={() => {
              /* no-op: panel open/close is governed by the launcher/close button */
            }}
            showChatToggle={false}
            className="khaveeai-floating-controls"
          />
        </div>

        {/* ── Chat ──────────────────────────────────────────────────────── */}
        <div className="khaveeai-floating-chat">
          <ChatBox placement="below" />
        </div>
      </div>

      <button
        type="button"
        className="khaveeai-floating-launcher"
        aria-label="Open chat with AI Assistant"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
      >
        <svg
          className="khaveeai-floating-icon-chat"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <svg
          className="khaveeai-floating-icon-close"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
