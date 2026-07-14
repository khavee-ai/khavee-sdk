---
task: 260715-2ih
title: Floating widget mobile bottom-sheet redesign
requirements: [FLOAT-REDESIGN-01]
key-files:
  created: []
  modified:
    - packages/wp-bundle/src/floating/FloatingWidget.tsx
    - packages/wp-bundle/styles.css
    - wordpress-plugin/build/khaveeai-bundle.js
    - wordpress-plugin/build/khaveeai-bundle.css
    - wordpress-plugin/build/khaveeai-preview.js
    - wordpress-plugin/build/khaveeai-preview.css
commit: c2376f5
date: 2026-07-15
---

# Quick Task 260715-2ih: Floating Widget Mobile Redesign Summary

Redesigned the WordPress plugin's site-wide FLOATING chat widget
(`config.floating === true` path) so the avatar area is always visible with
a centered mic + chat-toggle button pair, and the chatbox is a default-closed
bottom sheet that slides up from the bottom of the screen — matching the
Khavee Platform's shared/preview mobile layout (PreviewControls.tsx pattern,
translated not copied).

## What changed

### `packages/wp-bundle/src/floating/FloatingWidget.tsx`
- Added a second, independent piece of local UI state: `isChatOpen`
  (`useState(false)`), separate from the existing `isOpen` (whole-widget
  open/close, unchanged in behavior).
- `ControlBar` now renders both the mic button AND the chat-toggle button:
  removed `showChatToggle={false}` and the no-op `onToggleChat`; wired
  `isChatOpen={isChatOpen}` and `onToggleChat={() => setIsChatOpen(v => !v)}`.
- Removed the old inline `khaveeai-floating-chat` wrapper (`<ChatBox
  placement="below" />` used to render inside the panel body).
- Added a new `khaveeai-floating-sheet` element as a **sibling** of
  `khaveeai-floating-panel` (not nested inside it, so the panel's
  `overflow: hidden` never clips the sheet), containing:
  - A clickable drag-handle (`khaveeai-floating-sheet-handle` with a
    `khaveeai-floating-sheet-grip` pill) that calls `setIsChatOpen(false)`.
  - The reused `<ChatBox placement="below" />` (unmodified).
- Swipe-down-to-close: `onTouchStart`/`onTouchEnd` handlers on the sheet
  track `touchStartY` via a ref; a downward swipe past a 50px threshold
  closes the sheet, but only when the transcript (found via
  `sheetRef.current?.querySelector(".khaveeai-chat__transcript")`) is
  missing (disconnected/empty states) or scrolled to `scrollTop === 0`, so
  the gesture never fights the transcript's own internal scroll.
- Preserved unchanged: `isOpen` state, the launcher bubble, the header
  (title + close button that calls `setIsOpen(false)`), `AvatarErrorBoundary`
  wrapping `AvatarScene`, `ClickToTalkOverlay`, `ErrorOverlay`, the
  `data-open={isOpen}` root attribute, and all `floating*` config reads
  (`floatingAvatarScale`, `floatingAvatarOffsetX/Y`, `floatingBgTransparent`,
  `floatingBgColor`, `floatingCameraRotationY`).
- `ControlBar.tsx` and `ChatBox.tsx` were **not modified** — reused exactly
  as specified in the plan's interface contract.

### `packages/wp-bundle/styles.css`
Reworked only the "Floating widget (FLOAT-01 ...)" section (~line 428
onward); no shared base rules (`.khaveeai-controls`, `.khaveeai-chat--*`,
`.khaveeai-layout--*`) or inline-embed rules above that section were
touched.

- **Centered dual-button controls**: `.khaveeai-floating-avatar-area
  .khaveeai-controls.khaveeai-floating-controls` now centers the row
  (`left: 50%; transform: translateX(-50%);`) near the bottom of the avatar
  area (`bottom: calc(16px + env(safe-area-inset-bottom))`), flex row with
  16px gap.
- **Large circular buttons**: `.khaveeai-floating-controls
  .khaveeai-control-btn` sized to 72px diameter, `border-radius: 50%`,
  scoped so the inline embed's smaller `.khaveeai-controls` buttons are
  unaffected. Mic button: `#6929ff` accent purple / white icon, hover
  `#5a16eb`. Chat button: `#1f2430` dark neutral / white icon, hover
  `#12151d`.
- **Bottom sheet**: new `.khaveeai-floating-sheet` rules — `position: fixed;
  left:0; right:0; bottom:0;` full width, `height: 50dvh` (with a `50vh`
  fallback declared first), white background, `border-radius: 24px 24px 0
  0`, `z-index: 1000000` (above the widget root's `999999`), flex column
  layout. Closed state (`[data-chat-open="false"]`):
  `transform: translateY(100%); pointer-events: none;`. Open state
  (`[data-chat-open="true"]`): `transform: translateY(0);`. Transition:
  `transform 300ms ease-in-out`. `.khaveeai-floating-sheet
  .khaveeai-chat--below` fills the remaining height below the handle
  (`flex: 1; min-height: 0; width: 100%; max-height: none; margin: 0;
  border-radius: 0;`).
- **Drag-handle styling**: `.khaveeai-floating-sheet-handle` (centered flex
  row, small padding, `cursor: pointer`) and `.khaveeai-floating-sheet-grip`
  (48x6px pill, `#cdd2dc`).
- **Dead rule removal**: deleted `.khaveeai-floating-chat` and
  `.khaveeai-floating-chat .khaveeai-chat--below` (the panel no longer hosts
  an inline chat).
- **Panel resize**: `.khaveeai-floating-panel` height reduced from a fixed
  `520px` to `284px` (header ~52px + fixed 200px avatar area + small
  overlap allowance for the centered controls), since chat now lives
  externally in the sheet. Updated the `max-width: 480px` media query to
  match (was `calc(100vh - 140px)`, now `284px`) and added a `70dvh`/`70vh`
  sheet height override for mobile.
- **Reduced-motion**: extended the existing `@media (prefers-reduced-motion:
  reduce)` block to also disable `.khaveeai-floating-sheet` transitions.
- **Safety**: added `.khaveeai-floating-widget[data-open="false"]
  .khaveeai-floating-sheet { display: none; }` (Rule 2 addition, not in the
  plan's literal text) so that if a user closes the whole widget via the
  header/launcher while the chat sheet happens to be open, the sheet is
  fully hidden rather than left visibly slid-up behind/over a closed
  widget. Without this, `isChatOpen` state persisting across an `isOpen`
  toggle would leave a fixed-position white sheet floating on screen with
  no visible parent widget.

## Verification performed (this session, non-browser)

1. **Grep gates** (per plan's `<verify><automated>` blocks): all passed —
   `khaveeai-floating-sheet` and `setIsChatOpen` present in
   `FloatingWidget.tsx`, no `showChatToggle={false}` remaining;
   `khaveeai-floating-sheet`, `translateY(100%)`, and
   `khaveeai-floating-controls .khaveeai-control-btn` present in
   `styles.css`; no remaining `khaveeai-floating-chat` references.
2. **`pnpm --filter @khaveeai/wp-bundle build`**: succeeded, regenerated
   `wordpress-plugin/build/khaveeai-bundle.{js,css}` and
   `khaveeai-preview.{js,css}`, and printed `Build complete. Safety
   assertion passed for khaveeai-preview.js.` (STUDIO-02 gate).
3. **`pnpm --filter @khaveeai/wp-bundle typecheck`**: FAILED, but on a
   pre-existing, out-of-scope error in `packages/wp-bundle/src/mount.tsx`
   (`toggleMicrophone()` return type `Promise<boolean>` vs `boolean` on
   `OpenAIRealtimeProvider` vs `RealtimeProvider`). Confirmed via `git diff
   --stat HEAD` that `mount.tsx` was not touched by this plan, and via `git
   show ea89549:.../mount.tsx` that the file (and thus the error) predates
   this session's changes. Logged in
   `.planning/quick/260715-2ih-floating-widget-mobile-redesign/deferred-items.md`
   per the executor's scope-boundary rule (do not fix pre-existing,
   unrelated failures). This does not block the build gate: the actual
   `build` script uses esbuild, not `tsc`, and succeeded cleanly.

## Follow-up: live browser verification required

**This session did not perform live browser/wp-env testing.** The following
must be verified visually by the orchestrator in wp-env before considering
this feature fully done:

- The avatar area renders immediately (no separate "reveal avatar" click)
  once the floating widget is opened via the launcher.
- Mic and chat buttons render centered, side-by-side, near the bottom of
  the avatar area at the expected ~72px size, with correct colors (purple
  mic, dark chat).
- Tapping the chat button slides the bottom sheet up from the bottom of the
  screen with a smooth 300ms animation; the avatar area remains visible and
  is not obscured/collapsed.
- Tapping the chat button again, clicking the drag-handle, and swiping the
  sheet down (on an actual touch device or touch-emulated browser) all
  close the sheet correctly, respecting the "transcript scrolled to top"
  guard on swipe.
- Closing the header's minimize (X) button while the sheet is open fully
  hides the sheet (not just the panel).
- No visual regression to the panel header, close button, launcher bubble
  animation, or `ClickToTalkOverlay`/`ErrorOverlay` positioning.
- Confirm on a real narrow viewport (<=480px) that the sheet height (70dvh)
  and panel sizing look correct together.
- Confirm the inline (non-floating) embed layout is visually unaffected
  (this plan did not touch shared `.khaveeai-controls`/`.khaveeai-chat--*`
  base rules, but a live check is prudent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] Added `display: none` gate on the sheet when the whole widget is closed**
- **Found during:** Task 2 (CSS)
- **Issue:** The plan's CSS spec only gated the sheet's visibility via
  `[data-chat-open]` on the sheet itself. Since `isChatOpen` is independent
  state that is not reset when the widget-level `isOpen` becomes false
  (header close button), a user could close the whole widget while the
  chat sheet was open, leaving a fixed-position, fully-opaque white sheet
  visible with no parent widget/panel around it.
- **Fix:** Added `.khaveeai-floating-widget[data-open="false"]
  .khaveeai-floating-sheet { display: none; }` so the sheet is fully hidden
  whenever the overall widget is closed, regardless of `isChatOpen`.
- **Files modified:** `packages/wp-bundle/styles.css`
- **Commit:** c2376f5

### Deferred (out of scope, not fixed)

**1. Pre-existing tsc error in `mount.tsx`** — see
`.planning/quick/260715-2ih-floating-widget-mobile-redesign/deferred-items.md`.
Predates this plan; unrelated to `FloatingWidget.tsx`/`styles.css`; does not
affect the esbuild-based production build gate.

## Self-Check

- FOUND: packages/wp-bundle/src/floating/FloatingWidget.tsx
- FOUND: packages/wp-bundle/styles.css
- FOUND: commit c2376f5 in `git log --oneline`

## Self-Check: PASSED
