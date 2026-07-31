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
 *
 * UX pass (260731): four findings from a team review of this widget —
 * (1) launcher gave zero context before the mic-permission ask → greeting
 * bubble; (2) minimizing mid-conversation gave no signal to reopen →
 * unread badge; (3) header read as generic/unbranded → configurable name +
 * online-status dot; (4) opening chat fully hid mic controls → ControlBar
 * repositions above the sheet instead of fading out. See GreetingBubble.tsx
 * and styles.css for the rest.
 *
 * UX pass round 2 (260731, follow-up from external UX/UI research): (5) the
 * idle "Click to talk" CTA was dead-center of the avatar area regardless of
 * framing, landing on the character's chest → moved lower, clear of both
 * the face and ControlBar (see .khaveeai-floating-avatar-area .khaveeai-overlay
 * in styles.css); (6) the greeting bubble's generic copy didn't say what the
 * assistant is → now names widgetName (GreetingBubble.tsx); (7) Escape
 * doesn't close anything, and focus isn't managed on open/close → keyboard
 * handling + focus-return added below (WCAG 2.2 keyboard/focus-visible
 * guidance); (8) the greeting's dismiss button was an 18x18 hit target,
 * under the 24x24 CSS px WCAG 2.2 minimum → bumped in styles.css.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRealtime } from "@khaveeai/react";
import { AvatarScene } from "../mount";
import { ChatBox } from "../ui/ChatBox";
import { ClickToTalkOverlay } from "../ui/ClickToTalkOverlay";
import { ErrorOverlay } from "../ui/ErrorOverlay";
import { ControlBar } from "../ui/ControlBar";
import { AvatarErrorBoundary } from "../ui/AvatarErrorBoundary";
import { GreetingBubble } from "./GreetingBubble";
import type { KhaveeAvatarConfig } from "../config";

const GREETING_STORAGE_KEY = "khaveeai-greeting-dismissed";
const GREETING_SHOW_DELAY_MS = 1500;
const GREETING_AUTO_HIDE_MS = 12000;

/** Reads localStorage defensively — some sites/browsers block it (privacy
 * mode, embedded iframes, tracker blockers); the greeting bubble degrades
 * to "always eligible to show" rather than throwing. */
function hasGreetingBeenDismissed(): boolean {
  try {
    return localStorage.getItem(GREETING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markGreetingDismissed(): void {
  try {
    localStorage.setItem(GREETING_STORAGE_KEY, "1");
  } catch {
    // Ignored — worst case the greeting reappears on the next page view.
  }
}

export function FloatingWidget({ config }: { config: KhaveeAvatarConfig }) {
  const [isOpen, setIsOpen] = useState(false);
  // Bottom-sheet chat visibility (260715-2ih): closed by default, pure UI
  // state — NOT wired to the realtime connection or transcript.
  const [isChatOpen, setIsChatOpen] = useState(false);
  // Swipe-down-to-close bookkeeping for the bottom sheet.
  const touchStartY = useRef<number>(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  // Focus management (UX pass round 2, finding #7): the launcher and the
  // panel's minimize button are the two focus anchors — opening moves focus
  // into the panel, closing returns it to the launcher, so keyboard users
  // never lose their place.
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  // First-visit invite bubble (UX finding #1) and unread badge (UX finding
  // #2) both key off the SAME underlying signal — the realtime transcript —
  // so FloatingWidget subscribes to useRealtime() directly here, alongside
  // its existing independent consumers (ChatBox/ControlBar/ClickToTalkOverlay
  // each already call it too; this is the established multi-consumer
  // pattern for this context, not a new architecture).
  const { conversation, isConnected } = useRealtime();
  const [showGreeting, setShowGreeting] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const prevConversationLengthRef = useRef(0);

  function dismissGreeting() {
    setShowGreeting(false);
    markGreetingDismissed();
  }

  // Show the greeting once, after a short delay so it doesn't flash on
  // page load, then auto-hide (and mark dismissed either way) if the
  // visitor never interacts with it.
  useEffect(() => {
    if (hasGreetingBeenDismissed()) return;

    const showTimer = setTimeout(() => setShowGreeting(true), GREETING_SHOW_DELAY_MS);
    return () => clearTimeout(showTimer);
  }, []);

  useEffect(() => {
    if (!showGreeting) return;

    const hideTimer = setTimeout(dismissGreeting, GREETING_AUTO_HIDE_MS);
    return () => clearTimeout(hideTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGreeting]);

  // Unread badge: while the panel is closed, a growing conversation with a
  // new assistant turn means something happened the visitor hasn't seen.
  useEffect(() => {
    if (isOpen) {
      // Reopening always clears it — the panel is the "read" state.
      setHasUnread(false);
      prevConversationLengthRef.current = conversation.length;
      return;
    }

    if (conversation.length > prevConversationLengthRef.current) {
      const newest = conversation[conversation.length - 1];
      if (newest?.role === "assistant") {
        setHasUnread(true);
      }
    }
    prevConversationLengthRef.current = conversation.length;
  }, [conversation, isOpen]);

  function handleLauncherClick() {
    setIsOpen((v) => !v);
    if (showGreeting) dismissGreeting();
  }

  // Move focus into the panel on open, and back to the launcher on close —
  // without this, a keyboard/screen-reader user who opens the panel stays
  // focused on a now-hidden launcher button (WCAG 2.2 Focus Not Obscured).
  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    } else if (wasOpenRef.current) {
      launcherRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // Escape closes the nearest open layer first (chat sheet, then panel)
  // rather than jumping straight to fully closed — mirrors the existing
  // sheet-handle-tap and header-close affordances, just from the keyboard.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (isChatOpen) {
        setIsChatOpen(false);
      } else if (isOpen) {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isChatOpen]);

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
  // Quick fix: shopping-cart-drawer/modal z-index conflicts — AvatarRenderer
  // always sends a resolved value (999999 default, or the site owner's
  // configured override), so this is set unconditionally rather than only
  // when truthy like floatingOffsetY above (whose real default IS 0/falsy).
  const floatingZIndex = config.floatingZIndex ?? 999999;
  // UX finding #3: generic "AI Assistant" felt unbranded. '' (PHP's unset
  // sentinel) falls through to the same default text as before, so every
  // existing install is unaffected until a site owner sets this.
  const widgetName = config.floatingWidgetName || "AI Assistant";

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
  (widgetStyle as Record<string, string>)["--khaveeai-floating-z-index"] =
    String(floatingZIndex);
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
          <div className="khaveeai-floating-header-identity">
            <span
              className={`khaveeai-floating-header-status${isConnected ? " khaveeai-floating-header-status--online" : ""}`}
              aria-hidden="true"
            />
            <div className="khaveeai-floating-header-title">{widgetName}</div>
          </div>
          <button
            ref={closeButtonRef}
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
              UX finding #4: this used to fade out entirely while the sheet
              was open (base .khaveeai-controls z-index:30 sat above the
              sheet's z-index:5, so it had to go — found live-testing
              260715). That meant losing mic-mute access AND the "tap again
              to close chat" affordance for the whole time you were typing.
              Now it's repositioned above the sheet instead (still visible,
              still clickable) via the --sheet-open modifier. */}
          <ControlBar
            chatEnabled
            isChatOpen={isChatOpen}
            onToggleChat={() => setIsChatOpen((v) => !v)}
            className={`khaveeai-floating-controls${isChatOpen ? " khaveeai-floating-controls--sheet-open" : ""}`}
          />

          {/* ── Chat sheet ────────────────────────────────────────────────
              Nested INSIDE the avatar area (not a sibling of the panel) so
              it can overlay the bottom portion of the avatar without
              spilling past the panel's own edges or covering the launcher
              button below. Sized to cover roughly the bottom 75% of the
              avatar area (bumped up from 60% — UX finding: chat had too
              little room), leaving the top ~120px (the avatar's face)
              visible while open. Closed by default; slides up on
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

      {/* UX finding #1: first-time visitors had no context before opening
          the panel and hitting a mic-permission prompt. Renders between
          the panel and the launcher — the panel is position:absolute (out
          of flow) while closed, so this sits directly above the launcher
          in the flex column. Only ever shown while the widget is closed. */}
      {!isOpen && showGreeting && (
        <GreetingBubble widgetName={widgetName} onDismiss={dismissGreeting} />
      )}

      <button
        ref={launcherRef}
        type="button"
        className="khaveeai-floating-launcher"
        aria-label={`Open chat with ${widgetName}`}
        aria-expanded={isOpen}
        onClick={handleLauncherClick}
      >
        {/* UX finding #2: minimizing mid-conversation gave no signal to
            reopen. Cleared on open (see the isOpen effect above). */}
        {hasUnread && (
          <span className="khaveeai-floating-launcher-badge" aria-hidden="true" />
        )}
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
