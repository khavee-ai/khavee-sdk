# Quick Task 260706-x6b: Settings Page Redesign - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Task Boundary

Redesign the Khavee WordPress admin Settings page (`wordpress-plugin/includes/Admin/SettingsPage.php`) — visual polish pass and layout restructure. Pure presentation-layer, scoped to `SettingsPage.php` only.

</domain>

<decisions>
## Implementation Decisions

### Layout scope
- Only the **Floating Widget** section gets a two-column (fields | preview) layout — fields on the left, the existing `#khaveeai-floating-preview` mount div sticky/pinned on the right so it stays visible without scrolling as the admin edits fields above it.
- The other 3 sections (Connection, Personality & Voice, Avatar) stay single-column — they have nothing to preview, so a two-column shell would leave an empty right column most of the time.

### Visual style
- **Branded**: reuse the plugin's existing purple/flat design language — solid `#6929ff` accent, `#dde1ea` borders, flat surfaces with no gradients or box-shadows, consistent with `packages/wp-bundle/styles.css`'s established convention (front-end widget, floating panel mockup, ControlBar all follow this). The settings page should feel like part of the same product, not generic WP-admin chrome.

### Section behavior
- **Always-expanded cards**, not an accordion. Each of the 4 sections becomes a distinct visual card (clear heading, generous spacing, grouped fields) — no collapse/expand interaction, no added JS state, no risk of a saved value (e.g. camera angle) being hidden in a collapsed section the user forgot about.

### Claude's Discretion
- Exact spacing/typography scale, card padding, heading hierarchy, and how form-table rows are restyled — implementer's call, following the branded flat-purple direction.
- Whether existing WP-admin classes (`form-table`, etc.) are kept with overriding CSS or replaced with new custom markup — implementer's call, whichever achieves the visual goal with the least risk to existing field behavior/accessibility.
- Responsive behavior on narrower admin viewports (e.g. does the two-column Floating Widget layout stack on small screens) — implementer's call, reasonable default expected.

</decisions>

<specifics>
## Specific Ideas

No additional specific requirements beyond the decisions above — the three original complaints (visual polish, hard to find things, preview placement) are the driving requirements, addressed by: branded flat styling, card-based sectioning, and the two-column sticky-preview layout for Floating Widget.

</specifics>

<canonical_refs>
## Canonical References

- `packages/wp-bundle/styles.css` — the plugin's existing design tokens (solid `#6929ff`, `#dde1ea` borders, 20px/12px radii, no gradients/shadows) to mirror for brand consistency.
- Quick tasks 260706-vf4 and 260706-wop — established the `#khaveeai-floating-preview` mount div and its bidirectional JS wiring (`rebuild()`, wpColorPicker, CustomEvent bridge) that must keep working unchanged through this layout restructure.

</canonical_refs>
