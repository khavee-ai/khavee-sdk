---
status: complete
---

# Quick Task 260709-gyv: Remove Click-to-Talk Button in Preview — Summary

## What changed

Removed the static, non-functional "Click to talk" pill button from the Settings page's Floating Widget live preview (`packages/wp-bundle/src/preview/PreviewFloatingWidget.tsx`), per direct user request. The real front-end widget (`FloatingWidget.tsx`) and its functional `ClickToTalkOverlay` are untouched — this is preview-only.

Rebuilt `khaveeai-preview.js`/`.css`.

## Commits

- `79333ea` — pre-dispatch plan
- (direct edit, orchestrator applied given small scope + context constraints)

## Verification

- `tsc --noEmit` clean
- `node build.mjs` — "Safety assertion passed for khaveeai-preview.js"
- Compiled `khaveeai-preview.js` has 0 occurrences of "Click to talk" (source file's only remaining mention is a doc-comment explaining the removal)
- Live-verified in wp-env: avatar area shows just the avatar, no CTA pill; header and chat sections unchanged
