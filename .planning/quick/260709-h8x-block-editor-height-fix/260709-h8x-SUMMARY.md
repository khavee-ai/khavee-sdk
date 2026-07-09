---
status: complete
---

# Quick Task 260709-h8x: Block Editor Preview Height Overflow Fix — Summary

## What changed

`wordpress-plugin/src/editor.js`'s preview mount-point div previously only set `minHeight: 200`. When `containerHeight` was 0 ("global default"), no ancestor in the chain down to `.khaveeai-layout`/`.khaveeai-chat--beside`'s percentage-height rules had a resolvable height.

Added an explicit fallback height (`live.containerHeight > 0 ? live.containerHeight + 'px' : 400`) to the mount div, mirroring the fix already applied to the Settings-page preview (`SettingsPage.php:2140-2146`).

**That alone wasn't sufficient** — live-verified via Chrome devtools that the chain still broke one level deeper: `PreviewScene.tsx`'s own `containerStyle` div (the actual React root PreviewScene renders, nested one level inside the mount div) left `height` completely unset whenever `containerHeight` was 0. A plain block-level div with unset height is content-driven (auto), which is circular for its flex child (`.khaveeai-layout`) asking for `height:100%` of it — confirmed via computed-style inspection that Chromium clamps this exact circular case to `16777216px` (2^24) instead of collapsing, ballooning the whole chain and making the avatar canvas render at an effectively infinite size (invisible/off-screen).

Fixed by having `containerStyle.height` default to `"100%"` instead of staying unset (`packages/wp-bundle/src/preview/PreviewScene.tsx`), since every embedder (Settings-page preview, block editor mount) now always gives PreviewScene's mount point a real explicit height for the `100%` to resolve against.

## Files changed

- `wordpress-plugin/src/editor.js`
- `packages/wp-bundle/src/preview/PreviewScene.tsx`

## Verification

- `npm run build` (wp-scripts) — compiled clean
- `node build.mjs` (wp-bundle) — "Safety assertion passed for khaveeai-preview.js"
- Live-verified in wp-env via Chrome: canvas computed height went from `16777216px` (broken) to `800px` (bounded, correct); chat panel now stretches to match the avatar canvas's full height instead of floating as a small unstretched box
