---
phase: quick-260709-gyv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/wp-bundle/src/preview/PreviewFloatingWidget.tsx
  - wordpress-plugin/build/khaveeai-preview.js
  - wordpress-plugin/build/khaveeai-preview.css
autonomous: true
requirements:
  - GYV-01  # Remove the static non-functional "Click to talk" CTA from the Floating Widget Settings-page preview only

must_haves:
  truths:
    - "The Settings-page Floating Widget preview no longer shows a 'Click to talk' pill button in the avatar area"
    - "The real front-end FloatingWidget.tsx (with its functional ClickToTalkOverlay) is untouched — this is preview-only"
  artifacts:
    - path: "packages/wp-bundle/src/preview/PreviewFloatingWidget.tsx"
      provides: "Avatar area without the static CTA stand-in"
---

<objective>
Remove the static, non-functional "Click to talk" pill button from the Settings page's Floating Widget live preview (`PreviewFloatingWidget.tsx`, added in quick task 260708-1ws as a visual stand-in for the real widget's `ClickToTalkOverlay`). User explicitly requested it removed from the preview. Does NOT touch the real front-end widget (`FloatingWidget.tsx`), which keeps its functional `ClickToTalkOverlay`.
</objective>

<tasks>

<task type="auto">
  <name>Task 1: Remove the static CTA block from PreviewFloatingWidget.tsx and rebuild</name>
  <files>packages/wp-bundle/src/preview/PreviewFloatingWidget.tsx, wordpress-plugin/build/khaveeai-preview.js, wordpress-plugin/build/khaveeai-preview.css</files>
  <action>
In `packages/wp-bundle/src/preview/PreviewFloatingWidget.tsx`, remove the `<div className="khaveeai-overlay"><button type="button" className="khaveeai-cta-button">Click to talk</button></div>` block (currently rendered as a sibling right after `<PreviewAvatarCanvas .../>` inside `.khaveeai-floating-avatar-area`). Update the file-header comment's bullet point describing the static CTA stand-in to remove that mention (or note it was removed per user request), since it no longer applies. Leave `PreviewAvatarCanvas` and everything else in the avatar area untouched.

Rebuild: `pnpm --filter @khaveeai/wp-bundle build` (build dependency chain first if needed: `pnpm --filter @khaveeai/core build && pnpm --filter @khaveeai/react build && pnpm --filter @khaveeai/providers-openai-realtime build` before wp-bundle). Confirm "Safety assertion passed for khaveeai-preview.js."
  </action>
  <verify>
    <automated>cd packages/wp-bundle && npx tsc --noEmit -p tsconfig.json && ! grep -q "Click to talk" src/preview/PreviewFloatingWidget.tsx && node build.mjs 2>&1 | grep -q "Safety assertion passed"</automated>
  </verify>
  <done>tsc clean; "Click to talk" no longer in PreviewFloatingWidget.tsx; build succeeds with safety assertion passed; khaveeai-preview.js/css regenerated with the button removed.</done>
</task>

</tasks>

<output>
Create `.planning/quick/260709-gyv-remove-click-to-talk-preview/260709-gyv-SUMMARY.md` when done.
</output>
