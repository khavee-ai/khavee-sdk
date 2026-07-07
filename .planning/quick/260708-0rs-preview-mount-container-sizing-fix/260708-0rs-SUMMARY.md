---
phase: quick-260708-0rs
plan: 01
subsystem: ui
tags: [wordpress-plugin, php, preview, react, r3f, settings-page]

# Dependency graph
requires:
  - phase: quick-260707-0u6
    provides: Avatar section live preview mount
  - phase: quick-260706-vf4
    provides: Floating Widget live preview mount
provides:
  - containerWidth/containerHeight added to both Settings-page preview mount configs
affects: [wordpress-plugin-settings-page, avatar-preview, floating-widget-preview]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PreviewScene.tsx config keys (containerWidth/containerHeight) must be set by every PHP caller that mounts a fixed-size preview box, since the React container has no ancestor-based height to inherit percentage sizing from"

key-files:
  created: []
  modified:
    - wordpress-plugin/includes/Admin/SettingsPage.php

key-decisions:
  - "Matched containerWidth/containerHeight exactly to each mount div's own hardcoded inline pixel dimensions (280x340 for Avatar, 360x520 for Floating) rather than introducing new shared constants, to keep the fix minimal and scoped to the JSON config"
  - "Did not touch PreviewScene.tsx, mountPreview.tsx, or any build artifact — the React sizing logic was already correct and just needed values to consume"

requirements-completed: [RS-01, RS-02]

# Metrics
duration: 5min + live verification
completed: 2026-07-08
status: complete
---

# Quick Task 260708-0rs: Preview Mount Container Sizing Fix Summary

**Added missing `containerWidth`/`containerHeight` JSON config keys to both WordPress Settings-page preview mounts (Avatar section, Floating Widget), fixing a canvas-collapse bug where the avatar filled only ~140-180px of its 280x340/360x520 mount box.**

## Performance

- **Duration:** ~5 min (Task 1 only; plan has a pending human-verify checkpoint)
- **Started:** 2026-07-07T17:30:00Z (approx)
- **Completed (Task 1):** 2026-07-07T17:36:17Z
- **Tasks:** 1 of 2 (Task 1 complete; Task 2 is a `checkpoint:human-verify` requiring live wp-env browser interaction, not executable in this session)
- **Files modified:** 1

## Accomplishments
- `render_avatar_section_preview_mount()`'s `$config` array now includes `containerWidth => 280, containerHeight => 340`
- `render_floating_preview_mount()`'s `$config` array now includes `containerWidth => 360, containerHeight => 520`
- Both additions include an inline comment explaining why the keys are needed (so a future editor doesn't remove them as "redundant" with the mount div's own inline style)
- `php -l` clean; both configs confirmed via `grep -c "'containerHeight'"` returning `2`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add containerWidth/containerHeight to both preview mount configs (RS-01, RS-02)** - `4780b42` (fix)

Task 2 is a `checkpoint:human-verify` gate requiring live browser verification in wp-env — not executed in this session (no browser tooling available here). The orchestrator will perform live verification directly.

## Files Created/Modified
- `wordpress-plugin/includes/Admin/SettingsPage.php` - Added `containerWidth`/`containerHeight` keys to both `render_avatar_section_preview_mount()` and `render_floating_preview_mount()`'s `$config` arrays

## Decisions Made
- Matched the new config values exactly to each mount div's own already-hardcoded inline `width`/`height` (280x340 and 360x520) rather than introducing shared PHP constants, keeping the change a minimal, targeted JSON-config addition
- Left `PreviewScene.tsx`, `mountPreview.tsx`, mount div inline styles, and `chatShow` untouched, per plan constraints — this is a pure sizing fix consumed by already-correct existing React logic

## Deviations from Plan

None - plan executed exactly as written for Task 1.

## Issues Encountered
None for Task 1. Note: `settings-page-harness.php` has 1 pre-existing failing case (`shape: get_runtime_config() returns exactly the keys {instructions, voice, avatar_url, model}`) — this is unrelated to the preview mount config changes (it concerns `get_runtime_config()`'s key shape, not either preview mount function) and was not introduced or touched by this task. `render-logic-harness.php` and `platform-config-harness.php` pass fully.

## User Setup Required

None - no external service configuration required.

## Live Verification (performed by orchestrator via Chrome browser automation)

Confirmed live in wp-env: both preview mounts correctly filled their boxes (280x340 Avatar, 360x520 Floating) with no dead space, matching the fix's intent.

**Discovered during verification: a separate, pre-existing latent bug this sizing fix exposed.** Once both previews were sized to their full boxes and both attempted to render the SAME avatar URL simultaneously, only ONE of them displayed the model — the other stayed blank. This was NOT caused by this sizing change; it was a latent shared-scene bug in `@khaveeai/react`'s `VRMAvatar.tsx` (drei's `useGLTF` caches the parsed GLTF/VRM globally by URL, so two simultaneous instances of the same avatar shared — and fought over — the same `THREE.Object3D`). This sizing fix simply made both previews render at full visibility at the same time for the first time, surfacing the bug. Root-caused, researched, and fixed separately as quick task **260708-16h** (see that task's SUMMARY.md). After 260708-16h landed, both previews render correctly and independently.

## Next Phase Readiness

Both tasks complete. Fully live-verified after the companion fix in 260708-16h landed.

---
*Phase: quick-260708-0rs*
*Completed: 2026-07-08 — fully verified live (see 260708-16h for the related shared-scene fix this verification surfaced)*

## Self-Check: PASSED

- FOUND: wordpress-plugin/includes/Admin/SettingsPage.php
- FOUND: .planning/quick/260708-0rs-preview-mount-container-sizing-fix/260708-0rs-SUMMARY.md
- FOUND: commit 4780b42
