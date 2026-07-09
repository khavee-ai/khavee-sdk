---
status: complete
---

# Quick Task 260709-p3k: Block Editor Preview Platform/Global-Default Fallback — Summary

## Problem

User report: "i used the khavee api key but the avatar does not load in preview edit page and some info too like the bgcolor (from api response)."

Root cause: `wordpress-plugin/src/editor.js`'s live preview config (the JSON written to the mount div's `data-khaveeai-preview-config` attribute, consumed by the preview bundle) built `avatarUrl`/`bgType`/`bgColor`/`bgTransparent` purely from the block's own (possibly blank) local attributes — never falling back to platform/global-resolved values. The published front-end page doesn't have this gap: `AvatarRenderer::render()` already falls through to `get_runtime_config()`'s platform-overlaid defaults server-side when a block attribute is blank.

Initially planned a new REST endpoint to expose resolved defaults to the editor — turned out unnecessary. `Plugin.php:210-214` already localizes the full platform-overlaid `get_runtime_config()` onto `window.khaveeaiGlobalConfig` (used today only by the numeric-slider "Global default" display text via `GlobalCustomRange`). The fix is just to also read from it when building the actual preview config.

## Fix

`wordpress-plugin/src/editor.js`: added `resolvedAvatarUrl`/`resolvedBgType`/`resolvedBgColor`/`resolvedBgTransparent`, each falling back to `getGlobalConfig()`'s corresponding field only when the block's own local value is blank (`bgType === ''` is the existing "(using global default)" sentinel; `avatarUrl` blank means no local media selected). Fed into `previewConfig` in place of the raw local values.

## Files changed

- `wordpress-plugin/src/editor.js`

## Verification

- `npm run build` (wp-scripts) — compiled clean
- Live-verified in wp-env via Chrome: with a block's avatar left at "Global default," `data-khaveeai-preview-config`'s `avatarUrl` now resolves to the real platform-configured VRM/GLB URL (confirmed via a successful 200 network fetch to the platform's signed S3 model URL) instead of staying blank
- Confirmed local per-block overrides (e.g. a block with an explicit custom `bgColor`) are untouched — fallback only applies when the block's own value is the "using global default" sentinel
