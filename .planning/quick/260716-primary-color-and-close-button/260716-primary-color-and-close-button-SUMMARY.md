---
task: 260716-primary-color-and-close-button
title: Floating widget custom accent color + chat panel close button
requirements: [FLOAT-COLOR-01, FLOAT-CLOSE-01]
key-files:
  created: []
  modified:
    - packages/wp-bundle/styles.css
    - packages/wp-bundle/src/config.ts
    - packages/wp-bundle/src/floating/FloatingWidget.tsx
    - packages/wp-bundle/src/preview/PreviewScene.tsx
    - packages/wp-bundle/src/preview/PreviewFloatingWidget.tsx
    - packages/wp-bundle/src/ui/ChatBox.tsx
    - wordpress-plugin/includes/Admin/SettingsPage.php
    - wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php
    - wordpress-plugin/includes/Render/AvatarRenderer.php
    - wordpress-plugin/build/khaveeai-bundle.js
    - wordpress-plugin/build/khaveeai-bundle.css
    - wordpress-plugin/build/khaveeai-preview.js
    - wordpress-plugin/build/khaveeai-preview.css
status: complete
date: 2026-07-16
---

# Quick Task 260716: Floating Widget Accent Color + Chat Panel Close Button

Two related follow-ups to the floating widget work: (1) the widget's purple
was hardcoded everywhere and clashed with some sites — added a WP-admin
"Floating widget accent color" setting that re-themes the whole widget, not
just the launcher; (2) added a small explicit close (X) button to the chat
sheet's own header, alongside the existing drag-handle-tap-to-close.

## What changed

### Accent color (FLOAT-COLOR-01)

`packages/wp-bundle/styles.css`: every hardcoded `#6929ff`/`#5a16eb` (CTA
button, mic button, chat bubbles, send button, floating header/launcher/mic)
was replaced with `var(--khaveeai-primary)`, declared once on `.khaveeai-root`
with `#6929ff` as the default. Hover/tint shades are derived via
`color-mix()` instead of separate hardcoded hex values. This touches the
SHARED base rules (also used by the inline embed) as well as the
floating-only ones — but since the inline embed never sets an override, its
rendering is a no-op change (same visual default).

`FloatingWidget.tsx` sets `--khaveeai-primary` as an inline override on its
own root div when `config.floatingPrimaryColor` is set, which cascades into
everything nested — including the shared `ChatBox`/`ControlBar` styles the
bottom sheet reuses. The avatar-area's own background now falls back through
`floatingBgColor || floatingPrimaryColor || "#6929ff"` (note `||`, not `??`
— PHP always emits these as strings, `''` when unset, not `undefined`; this
exact gotcha is already documented elsewhere in this codebase for
`chatPlacement`).

WP admin: new "Floating widget accent color" field (`floating_primary_color`),
same wpColorPicker-enhanced text-input pattern as the existing "Floating
background color" field. Threaded through `WpOptionsConfigSource` ->
`AvatarRenderer::render_floating()` (as `floatingPrimaryColor`, added after
`public_safe()` so it never leaks into the inline embed's config) and into
the Settings page's own avatar-scene live preview (`render_floating_preview_mount()`
+ the `rebuild()` JS function). The `rebuild()` rewrite was non-trivial:
with two `.khaveeai-color-field` inputs now sharing the same wpColorPicker/
irischange handlers, the override logic had to become field-aware
(`colorOverrideId`) so editing one picker can't overwrite the other's value.

### Chat panel close button (FLOAT-CLOSE-01)

`ChatBox.tsx` gained an optional `onClose?: () => void` prop — renders a
small X button next to "AI Assistant" in the chat header when provided.
Undefined by default (the inline embed's `mount.tsx` usage never passes it,
so its header is unchanged). `FloatingWidget.tsx` passes
`onClose={() => setIsChatOpen(false)}` on its sheet's `<ChatBox placement="below">`
usage only. New `.khaveeai-chat__close` CSS class, styled for the header's
light/white background (neutral gray icon + subtle hover tint) — distinct
from `.khaveeai-floating-close` (white icon on translucent white, meant for
the purple/primary-colored outer panel header).

## Verification

- `pnpm --filter @khaveeai/wp-bundle build` — clean, STUDIO-02 safety
  assertion passed (twice, after each change).
- `php -l` on all three touched PHP files — no syntax errors.
- Live-tested against wp-env: set accent color to `#0d9488` (teal) in
  Settings, confirmed the Settings page's own live preview panel picked it
  up instantly (header went teal); saved, confirmed on the front page that
  the launcher, panel header, "Click to talk" CTA, and mic button all
  render teal; opened the chat sheet and confirmed the assistant bubble tint,
  send button, and input-row border all followed too; confirmed the new
  small close (X) button appears next to "AI Assistant" in the sheet's
  header and correctly closes the sheet (mic/chat controls fade back in).

## Deviations from plan

- Discovered and fixed a `??` vs `||` bug in my own first pass at the
  avatar-area background fallback chain (both the real front-end
  `FloatingWidget.tsx` and the preview `PreviewFloatingWidget.tsx`) before
  it ever shipped — PHP always emits `floatingBgColor`/`bgColor` as a string,
  so nullish coalescing never falls through to `floatingPrimaryColor` on an
  empty string. Caught and fixed during implementation, verified via the
  live color-mix test above.
