# Quick Task 260707-oyu: Settings Page Follow-Up Fixes - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Task Boundary

Three follow-up fixes to the Khavee WordPress admin Settings page (`wordpress-plugin/includes/Admin/SettingsPage.php`) and its live preview bundle (`packages/wp-bundle/src/preview/PreviewScene.tsx`, `packages/wp-bundle/src/mount.tsx`), based on the user's live re-test of quick task 260707-0u6:

1. Avatar section's live preview (`#khaveeai-avatar-preview`) is in the wrong layout position — must move to the right side of its fields.
2. Mock chat transcript in the Floating Widget preview is not properly contained inside a chat-box visual wrapper.
3. Transparent-toggle bug (checking then unchecking "Transparent floating background" leaves the preview stuck transparent) is STILL BROKEN despite a first fix attempt in commit `5a39d51` (Canvas `key`-prop remount, confirmed present in source and compiled bundle) — needs genuine from-scratch root-cause investigation via live reproduction, not a repeat of the same hypothesis.

</domain>

<decisions>
## Implementation Decisions

### Avatar section preview layout
- Mirror the Floating Widget section's two-column layout EXACTLY — same CSS classes, widths, and responsive breakpoints, for visual consistency across the page. Do not invent a new layout mechanism or adjust proportions.

### Transparent-toggle bug fix scope
- If live reproduction confirms the same root cause affects the real front-end floating widget (`mount.tsx`'s `AvatarScene`), fix it there too, not just the Settings-page preview (`PreviewScene.tsx`). The prior fix attempt (`5a39d51`) already touched both files with the same pattern, so scope parity is expected — investigate both, fix both if warranted.

### Claude's Discretion
- Exact mock-chat markup/nesting structure to match `ChatBox.tsx`'s real class structure — implementer's call after reading that file.
- Root-cause investigation method (browser dev tools inspection, code tracing, etc.) for the transparent-toggle bug — implementer's call, but MUST be based on live reproduction in wp-env before writing a fix, not a repeat of the untested Canvas/WebGL-context guess.

</decisions>

<specifics>
## Specific Ideas

- Transparent-toggle bug: specifically check whether `PreviewScene.tsx`'s `containerStyle.background` (a plain CSS property on the wrapping `<div>`, around lines 214-237) is the actual stuck property — this is a different code path than the Canvas/WebGL `gl` prop the first fix targeted. Also check `mountPreview.tsx`'s `PreviewHost` (MutationObserver-based re-render) for any stale-closure/missed-dependency issue in how config flows from the checkbox to `containerStyle` vs. to the Canvas `key`.
- Chat bubble containment: read `packages/wp-bundle/src/ui/ChatBox.tsx` (not yet read in any prior session) and `packages/wp-bundle/styles.css` for the real `.khaveeai-floating-chat`-equivalent nesting/classes before fixing `render_floating_preview_mock_chat()`'s markup.

</specifics>

<canonical_refs>
## Canonical References

- Quick task 260706-x6b — established the two-column sticky-preview CSS/markup pattern for the Floating Widget section, to be replicated exactly for the Avatar section.
- Quick task 260707-0u6 (commits `81eb130`, `0207b85`, `10728e3`, `5a39d51`, `724663c`) — added the Avatar preview, mock chat, and the first (incomplete) transparent-toggle fix attempt that these 3 fixes build on.
- `packages/wp-bundle/src/ui/ChatBox.tsx` and `packages/wp-bundle/styles.css` — canonical real chat-box nesting/classes for fix #2.

</canonical_refs>
