---
status: complete
---

# Quick Task 260709-mdb: Instructions Preview Markdown + Scrollable — Summary

## What changed

The "Personality / Instructions" (Synced from Platform) preview box in `SettingsPage.php` previously rendered via plain `esc_html()`, which collapses all newlines — the full composed multi-section instructions (from quick task 260709-g4v) rendered as one giant run-on paragraph, unbounded height.

Added a lightweight markdown-lite renderer (`render_markdown_lite()`) scoped to exactly the subset `PlatformClient::build_personality_instructions()` emits (`## `/`### ` headings, `- ` bullets, blank-line breaks) — every fragment still escaped via `esc_html()` per line, not a general parser. `render_managed_field_preview()` gained an optional `$render_markdown` param; only the instructions field call site passes `true` (voice/avatar-name preview fields unchanged, still plain single-line).

Preview box also gained `max-height:280px; overflow-y:auto` when in markdown mode, so long compositions scroll instead of pushing the rest of the page down.

## Files changed

- `wordpress-plugin/includes/Admin/SettingsPage.php`

## Verification

- `php -l` clean
- Live-verified in wp-env: headers ("Identity", "Memory — Read carefully...") render bold, line breaks preserved, box has a fixed height with visible scroll (content cut off at "Never contradict or forget..." confirms the box is bounded, not fully expanded)
