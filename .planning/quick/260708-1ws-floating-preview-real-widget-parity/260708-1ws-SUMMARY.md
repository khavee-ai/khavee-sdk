---
status: complete
---

# Quick Task 260708-1ws: Floating Preview Real-Widget Parity — Summary

## What changed

Rebuilt the WordPress Settings page's Floating Widget live preview so it is structurally built from the SAME CSS classes as the real front-end `FloatingWidget.tsx` — instead of an ad-hoc full-height avatar canvas plus a separately-appended static PHP mock chat.

1. **`packages/wp-bundle/src/preview/PreviewAvatarCanvas.tsx`** (new) — extracted the avatar-rendering Canvas block (camera controller, orbit controls, lighting, VRMAvatar, empty state, "Preview talking" pill) out of `PreviewScene.tsx`'s `PreviewSceneInner` into a standalone, reusable, dimension-agnostic component. The plain Avatar-section/Gutenberg-editor preview output is unchanged (pure extraction).
2. **`packages/wp-bundle/src/preview/PreviewChatBox.tsx`** — extended with an optional `exampleMessages` prop; when provided, renders a header + transcript of static bubbles (reusing the existing `.khaveeai-chat__*` classes); falls back to the original "Click the avatar to start..." placeholder when absent.
3. **`packages/wp-bundle/src/preview/PreviewFloatingWidget.tsx`** (new) — mirrors the real `FloatingWidget.tsx`'s JSX using its exact classes: `.khaveeai-floating-panel` > `.khaveeai-floating-header` (title/subtitle/close button) + `.khaveeai-floating-avatar-area` (fixed 200px, `PreviewAvatarCanvas` + a static non-functional "Click to talk" pill reusing `.khaveeai-overlay`/`.khaveeai-cta-button`) + `.khaveeai-floating-chat` (`PreviewChatBox` with the preserved 3-bubble example exchange from quick task 260707-0u6). No launcher button, no collapse/expand toggle — always renders expanded, per locked decision. STUDIO-02 safety preserved: no `useRealtime`, no `ClickToTalkOverlay`/`ErrorOverlay`/`ControlBar` imports.
4. **`packages/wp-bundle/src/preview/PreviewScene.tsx`** — branches to `PreviewFloatingWidget` when `config.previewMode === "floating"`, otherwise falls through to the existing plain layout unchanged.
5. **`wordpress-plugin/includes/Admin/SettingsPage.php`** — `render_floating_preview_mount()` now emits `previewMode: 'floating'` in both the initial PHP-rendered config and the inline `rebuild()` JS (so every field change preserves floating mode); removed `containerWidth`/`containerHeight` from the floating config (CSS now fully determines sizing: 360x520 panel, 200px avatar area); deleted the now-dead `render_floating_preview_mock_chat()` method entirely.
6. Rebuilt `wordpress-plugin/build/khaveeai-preview.js`/`khaveeai-bundle.js` — the build's own STUDIO-02 safety assertion (`grep`-based, checks compiled output for `RealtimeProvider|getUserMedia|ephemeral`) passed.

## Commits

- `77ef12d` — Task 1: extract PreviewAvatarCanvas, add exampleMessages to PreviewChatBox
- `c070ac3` — Task 2: build PreviewFloatingWidget, wire previewMode:floating
- `4053042` — Task 3: wire previewMode:floating into SettingsPage.php, drop dead PHP mock-chat
- `746cbd6` — Task 4: rebuild preview/bundle artifacts, STUDIO-02 assertion passed
- (worktree merge, see git log)

## Verification

**Automated:**
- `tsc --noEmit` clean in `packages/wp-bundle`
- `php -l` clean on `SettingsPage.php`; `render_floating_preview_mock_chat` fully removed (0 references); `previewMode` present in both the PHP config array and the inline `rebuild()` JS
- `node build.mjs` printed "Safety assertion passed for khaveeai-preview.js" — the real, build-time STUDIO-02 grep against the COMPILED bundle (not source, which legitimately mentions these terms in safety-guarantee doc-comments) confirms no realtime/mic/token code was pulled in

**Live human verification (wp-env, http://localhost:8888/wp-admin/admin.php?page=khaveeai-settings):**
- Floating Widget preview now shows ONE cohesive 360x520 panel: purple header ("AI Assistant" / "Usually replies instantly" / X close button), a fixed ~200px avatar area with the live VRM avatar and a centered purple "Click to talk" pill (correctly non-functional — clicking does nothing), and a chat region below showing the "AI Assistant" chat header and the 3 preserved example bubbles.
- No separate loose mock-chat block below the panel; no full-height avatar canvas — the old mismatched layout is gone.
- Toggled "Transparent floating background" on/off — preview correctly switches to transparent and back to the configured red, confirming the 260707-wa2 transparent-toggle fix still holds under the new layout.
- Confirmed the Avatar-section preview (higher on the page) is UNCHANGED — still a plain avatar-only box, no floating header/chat chrome, since `previewMode` only applies to the floating mount.

## Notes

- wp-env's Docker containers had stopped (exited ~14h earlier, likely a Docker restart during this long session) and had to be restarted (`npx @wordpress/env start`) before live verification could proceed — not a regression from this task.
- The executor hit an API session-limit interruption while investigating a false-positive in its own Task 4 verify command (a `grep` that flagged safety-guarantee doc-comments mentioning "useRealtime" as if they were real usage). The orchestrator confirmed this was a verify-script false positive (the actual build-time STUDIO-02 assertion, which checks compiled output, passed cleanly) and completed Task 4 (dependency builds + wp-bundle rebuild + verification) directly.
