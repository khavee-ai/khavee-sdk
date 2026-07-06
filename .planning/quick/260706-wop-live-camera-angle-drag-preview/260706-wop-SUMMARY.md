---
status: complete
---

# Quick Task 260706-wop: Live Camera-Angle Drag Control — Summary

## What changed

Extended the floating widget's Settings-page live preview (260706-vf4) with a bidirectional camera-angle control:

1. **`packages/wp-bundle/src/config.ts`** — added `angleFromCameraPosition(cameraPosition, target)`, the symmetric inverse of the existing `orbitAroundTarget()`, computing a Y-axis angle in degrees from a camera position relative to a target. Round-trip identity (`angleFromCameraPosition(orbitAroundTarget(base, target, deg), target) ≈ deg`) verified to ~5.7e-14° across a range of test angles. Added `floatingCameraRotationY?: number` to `KhaveeAvatarConfig`.
2. **`packages/wp-bundle/src/floating/FloatingWidget.tsx`** — `floatingSceneConfig` now maps `config.floatingCameraRotationY` onto the generic `cameraRotationY` key, same pattern as the existing offset/scale/bg mappings.
3. **`packages/wp-bundle/src/preview/PreviewScene.tsx`** — added an `onCameraAngleChange?: (deg: number) => void` prop; `OrbitControls`'s `onEnd` (fires once per drag/zoom release, not per-frame) reads the live camera position back via the new inverse helper and reports the angle. `CameraController`'s existing reset-on-config-change behavior is untouched — this is purely an additive read-out-on-release path.
4. **`packages/wp-bundle/src/preview/mountPreview.tsx`** — since the Settings-page preview mounts via the same generic `PreviewHost`/DOM-observer path the Gutenberg block sidebar uses (confirmed by the planner's research — no separate preview mechanism exists), and the Settings page has no React tree to receive a prop callback, `PreviewHost` bridges `onCameraAngleChange` into a `khaveeai-preview-camera-angle` CustomEvent dispatched on the mount host element. The Gutenberg block's host div has no listener for this event, so its behavior is completely unchanged.
5. **PHP layer** (`WpOptionsConfigSource.php`, `AvatarRenderer.php`) — new `floating_camera_rotation_y` option default and `render_floating()` output key (`floatingCameraRotationY`), following the exact defensive isset->cast->fallback pattern used for the other floating-specific fields. The inline-embed's global `cameraRotationY` path is untouched.
6. **`SettingsPage.php`** — new "Floating camera angle" range slider (-180 to 180, live numeric readout), registered/sanitized identically to the existing offset/scale sliders. The inline JS `rebuild()` now includes `cameraRotationY` in the preview-config object, and listens for the new `khaveeai-preview-camera-angle` CustomEvent to write the dragged angle back into the slider's value and trigger `rebuild()` — completing the bidirectional loop (drag updates slider + camera; typing/dragging the slider also updates the camera).

## Verification

**Automated:**
- Round-trip math identity test: passed (~5.7e-14° precision)
- `pnpm --filter @khaveeai/wp-bundle build` — clean
- `tsc --noEmit` — clean
- `php -l` on all 3 edited PHP files — clean
- `platform-config-harness.php`, `render-logic-harness.php` — all pass
- `settings-page-harness.php` — same 1 pre-existing, unrelated failure documented in prior quick tasks — no new failures
- `git diff --stat wordpress-plugin/src/editor.js` — zero diff, confirming the Gutenberg block sidebar's own camera slider/preview is untouched

**Live human verification (wp-env, http://localhost:8888):**
- Dragging/orbiting the Settings-page live preview updated the "Floating camera angle" slider from 0 to 137, and the angle persisted (did not snap back) after releasing the drag.
- Dragging the slider directly to -180 correctly rotated the preview camera to a back view of the avatar.
- Set angle to 127, clicked Save, reloaded the page — slider showed 127 and preview matched; confirmed via `wp option get khaveeai_settings` that `floating_camera_rotation_y: 127` persisted in the DB.
- Opened the actual live floating widget on the front-end site (http://localhost:8888/test/) and confirmed via a zoomed screenshot that the avatar renders from behind (matching the 127° angle) — the front-end mount's `data-khaveeai-config` JSON correctly carried `floatingCameraRotationY: 127` through to the rendered scene.
- Confirmed no regression to the Gutenberg block editor's own camera slider (zero diff to `editor.js`).

## Commits

- `2f7f287` — Task 1: inverse-angle helper + floatingCameraRotationY config field + FloatingWidget mapping
- `b10d12f` — Task 2: PreviewScene onCameraAngleChange + OrbitControls onEnd readback + mountPreview CustomEvent bridge
- `8932e4e` — Task 3: PHP data layer (WpOptionsConfigSource + AvatarRenderer)
- `6b4f9e0` — Task 4: SettingsPage.php slider + bidirectional live-preview JS wiring
- (worktree merge, see git log)
