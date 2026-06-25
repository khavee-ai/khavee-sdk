---
phase: 09-block-studio-visual-config-chat-lipsync
plan: 02
subsystem: wordpress-plugin / gutenberg-editor
tags: [gutenberg, inspector, wordpress-components, rangecontrol, panelbody, undo-stack, debounce, react-hooks]

dependency_graph:
  requires:
    - phase: 09-01
      provides: "14 new block attributes in block.json (containerWidth, bgType, etc.)"
  provides:
    - "STUDIO-01: 7 PanelBody inspector panels with UI-SPEC-locked knob set"
    - "data-khaveeai-preview-config JSON mount-point div for preview bundle (Plan 09-03/09-06)"
    - "previewTalking editor-only state (flows to preview bundle, not block attributes)"
    - "Debounced RangeControl setAttributes (undo-spam mitigation per RESEARCH Pitfall 4)"
    - "Mutual-exclusivity greys color/image/placement controls per UI-SPEC rules"
  affects:
    - "09-03 (preview bundle reads data-khaveeai-preview-config)"
    - "09-06 (mounts R3F scene into the mount-point div)"

tech-stack:
  added: []
  patterns:
    - "7 PanelBody panels via createElement (no JSX, externalized to window.wp.*)"
    - "useRef-backed debounce (~50ms) for RangeControl setAttributes persistence"
    - "useState live-values object for smooth slider drag + undo/redo sync via useEffect"
    - "Belt-and-braces ColorPalette mutual-exclusivity: both disabled prop AND onChange guard"
    - "data-khaveeai-preview-config as JSON attribute on editor canvas mount-point div"

key-files:
  created: []
  modified:
    - wordpress-plugin/src/editor.js
    - wordpress-plugin/assets/editor.js
    - wordpress-plugin/assets/editor.asset.php

key-decisions:
  - "Combined Task 1 and Task 2 panel code into a single file while keeping two atomic commits — Task 1 intermediate state used old placeholder div, Task 2 swapped in the mount-point div"
  - "Live RangeControl state stored in a single `live` useState object rather than 6 individual states — cleaner undo/redo sync via single useEffect"
  - "Belt-and-braces ColorPalette mutual-exclusivity: passes both disabled prop AND blocks onChange — handles any @wordpress/components version that may not fully support ColorPalette disabled prop"
  - "avatarOffsetX/Y pass raw value (including 0) to RangeControl since 0 is both the attribute default and a valid visual center position — no undefined mask needed"
  - "Fallback banner inside mount-point div (not replacing it) so the block is selectable before khaveeai-preview.js mounts"
  - "TextControl imported per plan spec but not used in panels — externalized to window.wp.* so no bundle size impact"

patterns-established:
  - "Preview-config JSON pattern: data-khaveeai-preview-config attribute on the editor canvas div carries all 16 attrs + previewTalking flag; rebuilt on every re-render so MutationObserver in Plan 09-03 always sees current values"
  - "debouncedAttr(key, value) helper: updates local live state immediately (smooth UI) + debounces setAttributes at 50ms (undo stack protection)"

requirements-completed:
  - STUDIO-01

duration: ~25min
completed: 2026-06-26
---

# Phase 9 Plan 02: STUDIO-01 Inspector Panels Summary

**Built 7 collapsible PanelBody inspector panels with the locked knob set (Layout, Background, Lighting, Avatar, Camera, Voice & Behavior, Chat Box), mutual-exclusivity greys, debounced RangeControl persistence, and the data-khaveeai-preview-config JSON mount-point div that Plan 09-06 will mount the live preview into.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-06-26
- **Tasks:** 2 / 2
- **Files modified:** 3 (src/editor.js + built assets)

## Accomplishments

### Task 1 — 7 PanelBody panels with locked knob set

- Updated file-header comment to document Phase 9's separate-bundle preview model
- Removed `import ServerSideRender from '@wordpress/server-side-render'`
- Added `RangeControl`, `ToggleControl`, `ColorPalette`, `TextControl` to @wordpress/components import
- Destructured all 16 new block attributes in the `Edit()` function
- Built 7 PanelBody panels:
  - **Layout**: Container width (px) / Container height (px) RangeControls (200–1200) + Full-width ToggleControl
  - **Background**: Background type SelectControl + ColorPalette (with custom label element, disabled when bgTransparent or bgType!=='color') + Transparent background ToggleControl + background image MediaUpload with destructive Remove button (#d63638 + window.confirm)
  - **Lighting**: Light intensity RangeControl (0–2, step 0.1)
  - **Avatar**: Model picker MediaUpload (regrouped from Phase 8) + Avatar scale RangeControl (0.5–2.0 step 0.05) + Horizontal/Vertical offset RangeControls (−1.0 to 1.0 step 0.05)
  - **Camera**: Camera preset SelectControl only (Front / Left Angle / Right Angle / Wide) — no free-form XYZ per CONTEXT locked decision
  - **Voice & Behavior**: Voice SelectControl + Instructions TextareaControl (regrouped from Phase 8)
  - **Chat Box**: Show chat box ToggleControl + Chat box position SelectControl (disabled when !chatShow) + Preview talking ToggleControl (ALWAYS ENABLED per UI-SPEC mutual-exclusivity correction)

### Task 2 — Preview mount-point div, previewTalking state, debounced RangeControls

- Added `useState`, `useRef`, `useEffect` to @wordpress/element import
- `previewTalking` local useState (editor-only, wired to Preview talking ToggleControl — NOT setAttributes)
- `live` useState object tracks in-progress RangeControl drag values for 6 numeric attrs; `useEffect` syncs back from attributes on undo/redo
- `debouncedAttr(key, value)` helper: updates `live` state immediately + debounces `setAttributes` at 50ms
- Replaced static placeholder div with preview mount-point div carrying `data-khaveeai-preview-config` JSON (all 16 attrs + previewTalking; live.* used for the 6 range fields so preview stays current during drag)
- Fallback banner inside mount-point div: "Khavee AI Avatar — preview" / "Live preview — view the published page to talk." (UI-SPEC §Copywriting verbatim)

## Verification

```
pnpm exec wp-scripts build (from wordpress-plugin/)
  → webpack 5 compiled successfully
  → editor.js: 8.67 KiB (minified, all @wordpress/* externalized to window.wp.*)

grep "server-side-render" src/editor.js  → 0 hits (import removed)
grep "^import.*@khaveeai" src/editor.js   → 0 hits (structural isolation preserved)
grep "data-khaveeai-preview-config" src/editor.js → 6 hits
grep "previewTalking" src/editor.js       → 5 hits
grep "debouncedAttr" src/editor.js        → 7 hits (function def + 6 RangeControl calls)
PanelBody titles: Layout, Background, Lighting, Avatar, Camera, Voice & Behavior, Chat Box ✓
bgTransparent mutual-exclusivity on ColorPalette + image MediaUpload ✓
!chatShow mutual-exclusivity on Chat box position SelectControl ✓
Preview talking has NO disabled prop ✓
```

## Deviations from Plan

### Auto-applied implementation decisions

**1. [Rule 2 - Missing functionality] Belt-and-braces ColorPalette mutual-exclusivity**
- **Found during:** Task 1 implementation
- **Issue:** WP's ColorPalette `disabled` prop has inconsistent support across @wordpress/components versions
- **Fix:** Added both `disabled: bgTransparent || bgType !== 'color'` AND an `onChange` guard that returns a no-op when disabled — ensures no color changes can propagate regardless of WP component version
- **Files modified:** wordpress-plugin/src/editor.js

**2. Task split approach:** Tasks 1 and 2 were planned as sequential modifications to the same file. Two atomic commits were made by writing an intermediate Task 1 state (7 panels + old placeholder + no debounce) and committing it, then writing the full Task 2 state. This accurately reflects the two-task structure without losing either commit.

## Known Stubs

- `TextControl` is imported (per plan spec) but not used in any of the 7 panels. The control is externalized to `window.wp.*` so it adds zero bundle size. Future panels or a rich text label field could use it.
- Preview-talking ToggleControl is wired to local state; the actual mouth-animation viseme loop is implemented in Plan 09-03's `PreviewScene.tsx` — the toggle value flows via `data-khaveeai-preview-config` to that bundle.

## Self-Check

- [x] wordpress-plugin/src/editor.js exists and contains 7 PanelBody panels
- [x] Commits exist: 7796f91 (Task 1), 97fc931 (Task 2)
- [x] Build output wordpress-plugin/assets/editor.js is current and contains PanelBody/RangeControl/ColorPalette references
- [x] No @khaveeai/* imports in editor.js (only in comments)
- [x] data-khaveeai-preview-config attribute emitted on mount-point div

## Self-Check: PASSED
