# Quick Task 260708-1ws: Floating Preview Real-Widget Parity - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Task Boundary

Rebuild the Settings page's Floating Widget live preview (currently a hand-rolled PHP-mounted avatar canvas + a separately-appended static mock chat block) so its structure/markup/CSS classes are the SAME as the real front-end `FloatingWidget.tsx` component — not just visually similar, but built from the same CSS classes so future style changes to the real widget automatically apply to the preview too.

</domain>

<decisions>
## Implementation Decisions

### Scope of parity
- Match the REAL widget's exact DOM structure/classes: `.khaveeai-floating-panel` (360x520, white, bordered, rounded) containing `.khaveeai-floating-header` (purple, "AI Assistant" title + "Usually replies instantly" subtitle + close button) + `.khaveeai-floating-avatar-area` (FIXED 200px height, NOT the whole panel — this is the current bug: the preview currently gives the avatar canvas the full 520px instead of the real widget's fixed 200px) + `.khaveeai-floating-chat` (flex:1, remaining ~250-256px).
- Confirmed live in the real widget's CSS (`packages/wp-bundle/styles.css` lines 438-565): `.khaveeai-floating-avatar-area { height: 200px; }` is a FIXED height, with `.khaveeai-floating-chat { flex: 1; min-height: 0; }` taking the rest of the 520px panel. The current preview's `containerHeight: 520` config change (quick task 260708-0rs) was scoped to make the avatar CANVAS fill its box, but that box itself was never restructured to match the real widget's header+200px-avatar+flexed-chat composition — this task fixes that structural mismatch.

### Launcher/collapse toggle
- **Always show the panel expanded** in the preview — do NOT include the collapsed 60px launcher button or the open/close toggle interaction. Admins configuring the floating widget want to see the panel state, not click through a launcher first. The close (X) button in the header may be rendered for visual fidelity but should be non-functional (or simply omitted from interactivity) since there's no "collapsed" state to return to in this preview context.

### Click-to-talk CTA
- **Static, non-functional visual** — render the same "Click to talk" pill button appearance (matching `ClickToTalkOverlay`'s `.khaveeai-cta-button` class/markup) so the avatar area looks identical to the real widget's idle state, but clicking it does nothing (the real `ClickToTalkOverlay` calls `useRealtime().connect()`, which is unavailable/unsafe in the STUDIO-02 no-realtime preview context — a static stand-in avoids pulling in `useRealtime()` and preserves the existing safety guarantee that the preview bundle never calls `useRealtime()`/`getUserMedia`/hits the token endpoint).

### Chat panel
- Reuse the EXISTING `PreviewChatBox` component (`packages/wp-bundle/src/preview/PreviewChatBox.tsx`) with `placement="below"` inside `.khaveeai-floating-chat` — this already renders the same `.khaveeai-chat khaveeai-chat--below` classes the real `ChatBox` would render in this slot, so no new chat markup is needed. This REPLACES the current static PHP-rendered mock chat (`render_floating_preview_mock_chat()` in `SettingsPage.php`) — the mock chat's 3 example bubbles (or similar placeholder content) should move into/adapt to this same React-rendered slot, OR the PreviewChatBox component itself could optionally be extended to show a few static example bubbles instead of just "Click the avatar to start..." (implementer's call — see Claude's Discretion).

### Claude's Discretion
- Whether to keep a few static example chat bubbles (mirroring the current PHP mock chat's "Hi! How can I help you today?" / "What are your opening hours?" / "We're open 9am to 6pm..." exchange) inside the new React-rendered chat slot, vs. using `PreviewChatBox`'s existing plain "Click the avatar to start, then type here." placeholder — implementer's call, but the PRIOR mock-chat bubbles were added deliberately (quick task 260707-0u6) so the admin has something to look at; consider preserving that intent by extending `PreviewChatBox` (or a floating-specific variant) with the same static example bubbles rather than losing that content.
- Exact component structure: whether to build a new `PreviewFloatingWidget.tsx` component (mirroring `FloatingWidget.tsx`'s JSX almost verbatim but with preview-safe avatar rendering and the static CTA) that `PreviewScene.tsx`/`mountPreview.tsx` can render in a "floating" mode, vs. some other composition approach — implementer's call, but MUST reuse the real widget's exact CSS classes (`khaveeai-floating-panel`, `khaveeai-floating-header`, `khaveeai-floating-avatar-area`, `khaveeai-floating-chat`, etc.) rather than inventing new ones, so the preview and the real widget can never visually drift apart.
- How `SettingsPage.php`'s `render_floating_preview_mount()` signals "floating mode" to the preview bundle (e.g., a `previewMode: "floating"` key in the JSON config, consumed by `PreviewScene.tsx`/`mountPreview.tsx` to choose between the current plain-avatar layout and the new floating-parity layout) — implementer's call, but must not affect the Avatar-section preview or the Gutenberg block editor's own use of the same preview bundle (both of which should keep using the CURRENT plain-avatar-preview layout, unaffected by this change).
- Whether `render_floating_preview_mock_chat()` (the PHP method) is deleted entirely (since its job moves into React) or kept as dead code removed — implementer's call, but if the static PHP-rendered mock chat markup is no longer used, remove it rather than leaving unreachable code.

</decisions>

<specifics>
## Specific Ideas

- Real widget reference file: `packages/wp-bundle/src/floating/FloatingWidget.tsx` — read this in full before implementing; it's the canonical source of truth for markup/class structure/copy ("AI Assistant" title, "Usually replies instantly" subtitle, etc.).
- Real widget CSS: `packages/wp-bundle/styles.css` lines 428-630 (`.khaveeai-floating-*` rules) — the preview must consume these SAME classes, not new ones.
- Existing preview-safe chat stand-in: `packages/wp-bundle/src/preview/PreviewChatBox.tsx` (already reuses `.khaveeai-chat*` classes safely, no `useRealtime()` call).
- Existing preview-safe avatar rendering: `packages/wp-bundle/src/preview/PreviewScene.tsx`'s `PreviewSceneInner` (Canvas/CameraController/VRMAvatar/OrbitControls, no `useRealtime()` call) — this is the safe pattern to adapt for the floating preview's avatar area, NOT the real `AvatarScene` (`mount.tsx`), which is designed for the live realtime experience.
- Do NOT reuse `ClickToTalkOverlay.tsx`, `ErrorOverlay.tsx`, or `ControlBar.tsx` directly — all of these are realtime-dependent (`useRealtime()`) and unsafe in the preview's no-provider `KhaveeProvider` context (this is the same STUDIO-02 safety guarantee `PreviewScene.tsx`'s file-header comment documents: "never calls useRealtime(), never constructs OpenAIRealtimeProvider, never calls getUserMedia, never hits the token endpoint"). Build lightweight static stand-ins instead where visual parity is needed (the CTA pill).

</specifics>

<canonical_refs>
## Canonical References

- `packages/wp-bundle/src/floating/FloatingWidget.tsx` — the real widget, source of truth for structure/classes/copy.
- `packages/wp-bundle/styles.css` (lines 428-630) — the real widget's CSS, must be reused verbatim by the preview.
- `packages/wp-bundle/src/preview/PreviewScene.tsx` — existing STUDIO-02 safety pattern and file-header safety guarantees to preserve.
- `packages/wp-bundle/src/preview/PreviewChatBox.tsx` — existing safe chat stand-in to reuse.
- Quick task 260708-0rs (`containerHeight`/`containerWidth` sizing fix) and 260708-16h (VRMAvatar shared-scene fix) — both landed just before this task; this task's avatar-area restructure will change the Floating preview's `containerHeight` value (200px fixed, not 520px) since the avatar area itself is now only 200px of the 520px panel — confirm this doesn't reintroduce the "canvas collapses to intrinsic size" bug those tasks fixed (it shouldn't, since 200px is still an explicit, non-zero value).

</canonical_refs>
