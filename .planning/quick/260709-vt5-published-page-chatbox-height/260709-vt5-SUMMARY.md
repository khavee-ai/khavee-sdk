---
status: complete
---

# Quick Task 260709-vt5: Published-Page Chatbox Height Mismatch — Summary

## Problem

User report: "the chatbox height in publish page is not match the container."

## Root cause

Same architectural bug class as 260709-h8x (the block editor's version of this bug), in the parallel published-page implementation: `packages/wp-bundle/src/mount.tsx`'s `containerStyle.height` was only ever set when `config.containerHeight > 0`; when left at 0 ("global default"), height stayed completely unset. `.khaveeai-root` (styles.css) only declares `min-height: 32px`, never an explicit height, and the published page's mount div (`AvatarRenderer::render()`'s output — a bare `<div id="..." class="khaveeai-root">`) has no other height constraint from the surrounding page either. With no explicit height anywhere in the chain, `.khaveeai-layout`'s `height:100%` had nothing real to resolve against — visually this meant the chat panel rendered at a short, content-driven height while the avatar canvas occupied a taller, separately-resolved height, i.e. they didn't match.

## Fix

`mount.tsx`: default `containerStyle.height` to `"400px"` when `containerHeight` isn't explicitly configured, mirroring the fallback already applied to the editor/Settings-page preview path (`PreviewScene.tsx`, quick task 260709-h8x) so the published page and the editor preview agree (explicit design goal per existing comments in the codebase).

## Files changed

- `packages/wp-bundle/src/mount.tsx`

## Verification

- `node build.mjs` (wp-bundle) — "Safety assertion passed for khaveeai-preview.js"
- `tsc --noEmit` — only the one pre-existing, unrelated `OpenAIRealtimeProvider`/`toggleMicrophone()` type error remains (confirmed present before this change too)
- Live-verified in wp-env on the published front-end: chat panel now stretches to match the avatar canvas's full height instead of rendering short/collapsed; avatar itself still renders correctly (ruled out a regression — initial "avatar missing" observation was just VRM model load time, confirmed by waiting longer)
