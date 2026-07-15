/**
 * packages/wp-bundle/src/floating/FloatingWidget.tsx
 *
 * Site-wide floating chat launcher (FLOAT-01, quick task 260704-77n;
 * redesigned as a mobile bottom-sheet in quick task 260715-2ih). A new
 * LAYOUT/CONTAINER around the already-working avatar+chat pieces — NOT a
 * rebuild of the avatar/chat/voice pipeline. AppRoot (../mount.tsx) renders
 * this component in place of the inline embed layout when config.floating
 * is true; it still renders inside the same KhaveeProvider AppRoot's caller
 * (mountAvatarInstance) constructs, so AvatarScene/ChatBox/ClickToTalkOverlay/
 * ErrorOverlay/ControlBar all reach useRealtime()/useKhavee() normally.
 *
 * isOpen is local, ephemeral UI state (collapsed launcher vs. expanded
 * panel) — it governs the visibility of the ENTIRE widget (header + avatar
 * area + chat sheet), same as before. It does NOT gate the realtime
 * connection or the chat transcript; those are owned entirely by the
 * existing pieces this component wraps.
 *
 * isChatOpen is a second, independent piece of local UI state (260715-2ih):
 * once the widget itself is open, the avatar area (with its centered
 * mic + chat ControlBar) is ALWAYS visible — there is no longer a nested
 * "reveal the avatar" step. The chatbox is closed by default and slides up
 * as a bottom sheet from the bottom of the screen when the chat-toggle
 * button is tapped; it does not hide or collapse the avatar area. This
 * mirrors khavee-app's PreviewControls.tsx mobile bottom-sheet chat model
 * (reference only — behavior translated, not copied).
 *
 * Design spec (mockup, verbatim dimensions): #dde1ea border, 20px panel
 * radius, 220ms cubic-bezier(0.2,0.8,0.2,1) transform transition — NO
 * box-shadow, NO gradient anywhere (see styles.css). Accent color was
 * originally a hardcoded solid #6929ff purple; made themeable per-site via
 * floatingPrimaryColor (260716-primary-color) — defaults to the same
 * #6929ff if unset, so this is a no-op for every existing embed.
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
import { useRef, useState, type CSSProperties } from "react";
import { AvatarScene } from "../mount";
import { ChatBox } from "../ui/ChatBox";
import { ClickToTalkOverlay } from "../ui/ClickToTalkOverlay";
import { ErrorOverlay } from "../ui/ErrorOverlay";
import { ControlBar } from "../ui/ControlBar";
import { AvatarErrorBoundary } from "../ui/AvatarErrorBoundary";
import type { KhaveeAvatarConfig } from "../config";

export function FloatingWidget({ config }: { config: KhaveeAvatarConfig }) {
  const [isOpen, setIsOpen] = useState(false);
  // Bottom-sheet chat visibility (260715-2ih): closed by default, pure UI
  // state — NOT wired to the realtime connection or transcript.
  const [isChatOpen, setIsChatOpen] = useState(false);
  // Swipe-down-to-close bookkeeping for the bottom sheet.
  const touchStartY = useRef<number>(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  function handleSheetTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    touchStartY.current = e.touches[0].clientY;
  }

  function handleSheetTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    if (deltaY >= -50) return; // not a downward swipe past the threshold

    // Only close on a downward swipe if the transcript is scrolled to the
    // top (or has no transcript yet — empty/disconnected states) so the
    // gesture doesn't fight the transcript's own internal scrolling.
    const transcript = sheetRef.current?.querySelector(
      ".khaveeai-chat__transcript",
    );
    const atTop = !transcript || transcript.scrollTop === 0;
    if (atTop) {
      setIsChatOpen(false);
    }
  }

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

  // Page-placement (260715-75r): which corner to anchor to (styles.css'
  // default rule is bottom-right; [data-position="bottom-left"] flips the
  // side) and a pixel Y-nudge on top of the base inset, so a site owner
  // whose page already has another floating widget in the same corner
  // (Intercom/Crisp/Drift, etc.) can lift Khavee's clear of it. Passed as a
  // CSS custom property rather than a hardcoded inline `bottom` style so
  // styles.css' existing `bottom: 24px` / `right: 24px` rules stay the
  // single source of the base inset — this only adds to it.
  const floatingPosition = config.floatingPosition ?? "bottom-right";
  const floatingOffsetY = config.floatingOffsetY ?? 0;

  // Brand/accent color (260716-primary-color): overrides --khaveeai-primary
  // (declared with the historical #6929ff purple as its default on
  // .khaveeai-root in styles.css) on this widget's own root, which cascades
  // into every var(--khaveeai-primary) reference nested inside — the
  // header/launcher/mic-button AND the shared ChatBox bubbles/send-button
  // styles the bottom sheet reuses — without touching the inline embed's
  // rendering (it never sets this override, so it keeps the default).
  const floatingPrimaryColor = config.floatingPrimaryColor;

  const widgetStyle: CSSProperties = {};
  if (floatingOffsetY) {
    (widgetStyle as Record<string, string>)["--khaveeai-floating-offset-y"] =
      `${floatingOffsetY}px`;
  }
  if (floatingPrimaryColor) {
    (widgetStyle as Record<string, string>)["--khaveeai-primary"] =
      floatingPrimaryColor;
  }

  return (
    <div
      className="khaveeai-floating-widget"
      data-open={isOpen ? "true" : "false"}
      data-position={floatingPosition}
      style={Object.keys(widgetStyle).length ? widgetStyle : undefined}
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
            // floatingBgColor stays independently settable (a site may want
            // the avatar canvas a different shade than its buttons/header),
            // but when it's unset the avatar area now follows
            // floatingPrimaryColor too, not a hardcoded purple — setting
            // just a primary color re-themes the whole widget consistently.
            // `||`, not `??`: AvatarRenderer.php always emits floatingBgColor
            // as a string, '' when unset (never undefined/null) — nullish
            // coalescing would never fall through to floatingPrimaryColor
            // (this exact PHP-empty-string-vs-JS-nullish gotcha is already
            // documented in PreviewScene.tsx's chatPlacement fallback).
            background: config.floatingBgTransparent
              ? "transparent"
              : config.floatingBgColor || floatingPrimaryColor || "#6929ff",
          }}
        >
          {config.avatarUrl ? (
            <AvatarErrorBoundary>
              <AvatarScene config={floatingSceneConfig} />
            </AvatarErrorBoundary>
          ) : null}
          <ClickToTalkOverlay />
          <ErrorOverlay />
          {/* Mic mute/unmute + chat sheet toggle — centered near the bottom
              of the always-visible avatar area, clear of the centered
              ClickToTalkOverlay CTA. onToggleChat now drives the bottom
              sheet below, not the whole-widget open/close.
              Base .khaveeai-controls has z-index:30 (so it sits above the
              inline embed's canvas), which put it ABOVE the sheet
              (z-index:5) too — found live-testing 260715: buttons floated
              on top of the sheet's message input, blocking it. Faded out
              (not unmounted, so ControlBar's mic/connection state survives)
              via the --hidden modifier below whenever the sheet is open. */}
          <ControlBar
            chatEnabled
            isChatOpen={isChatOpen}
            onToggleChat={() => setIsChatOpen((v) => !v)}
            className={`khaveeai-floating-controls${isChatOpen ? " khaveeai-floating-controls--hidden" : ""}`}
          />

          {/* ── Chat sheet ────────────────────────────────────────────────
              Nested INSIDE the avatar area (not a sibling of the panel) so
              it can overlay the bottom portion of the avatar without
              spilling past the panel's own edges or covering the launcher
              button below. Sized to cover roughly the bottom 60% of the
              avatar area, leaving the top ~40% (the avatar's face/upper
              body) visible while open. Closed by default; slides up on
              isChatOpen. */}
          <div
            ref={sheetRef}
            className="khaveeai-floating-sheet"
            data-chat-open={isChatOpen ? "true" : "false"}
            onTouchStart={handleSheetTouchStart}
            onTouchEnd={handleSheetTouchEnd}
          >
            <div
              className="khaveeai-floating-sheet-handle"
              onClick={() => setIsChatOpen(false)}
              role="button"
              aria-label="Close chat"
            >
              <span className="khaveeai-floating-sheet-grip" />
            </div>
            <ChatBox
              placement="below"
              onClose={() => setIsChatOpen(false)}
            />
          </div>
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
