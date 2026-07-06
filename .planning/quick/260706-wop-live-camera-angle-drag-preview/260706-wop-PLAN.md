---
phase: quick-260706-wop
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/wp-bundle/src/config.ts
  - packages/wp-bundle/src/floating/FloatingWidget.tsx
  - packages/wp-bundle/src/preview/PreviewScene.tsx
  - packages/wp-bundle/src/preview/mountPreview.tsx
  - wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php
  - wordpress-plugin/includes/Render/AvatarRenderer.php
  - wordpress-plugin/includes/Admin/SettingsPage.php
autonomous: false
requirements: [QUICK-260706-wop]
must_haves:
  truths:
    - "Dragging/orbiting the Settings-page live preview writes the resulting Y angle into the Floating camera angle slider and persists it"
    - "Typing/dragging the Floating camera angle slider rotates the preview camera (existing config-driven path)"
    - "The saved floating_camera_rotation_y drives the real front-end floating widget's camera"
    - "The Gutenberg block sidebar's own cameraRotationY slider/preview is unchanged"
  artifacts:
    - path: packages/wp-bundle/src/config.ts
      provides: "angleFromCameraPosition inverse helper + floatingCameraRotationY field"
    - path: wordpress-plugin/includes/Admin/SettingsPage.php
      provides: "Floating camera angle slider + bidirectional live-preview JS wiring"
  key_links:
    - from: packages/wp-bundle/src/preview/PreviewScene.tsx
      to: packages/wp-bundle/src/preview/mountPreview.tsx
      via: "onCameraAngleChange prop -> CustomEvent on hostEl"
    - from: wordpress-plugin/includes/Admin/SettingsPage.php
      to: packages/wp-bundle/src/floating/FloatingWidget.tsx
      via: "floating_camera_rotation_y option -> floatingCameraRotationY -> cameraRotationY"
---

<objective>
Add a live camera-angle drag control to the floating widget's Settings-page preview, and expose a matching floating-specific `floatingCameraRotationY` / `floating_camera_rotation_y` setting.

Dragging/orbiting the live preview camera reads the resulting Y-axis angle back out (inverse of the existing `orbitAroundTarget` math), writes it into a new "Floating camera angle" slider, and round-trips through the same `rebuild()` config-write path that already drives the preview. The slider is also a manual-entry fallback that coexists with drag. The angle persists through the same floating-only PHP config pipeline used by the offset/scale fields (quick tasks 260705-p30, 260706-vf4), so the real front-end floating widget honors the saved angle.

Purpose: Users want dragging the preview camera to actually persist as a camera angle, not just transiently "look around".
Output: One new floating-only config field wired end-to-end (TS math + React readback bridge + PHP data layer + Settings slider + bidirectional live-preview JS).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

Key existing infrastructure already read during planning (do not re-discover):

- `config.ts` — `orbitAroundTarget(position, target, degrees)` (lines ~185-200) is the FORWARD math (Y-orbit of a position around a target). `resolveSceneDefaults()` (lines ~218-248) applies it when `cameraRotationY` is nonzero and returns `cameraPosition`, `cameraTarget`, `cameraPreset`. `CAMERA_PRESETS` (lines ~50-67) hold each preset's base `position`/`target`. `KhaveeAvatarConfig` floating-only fields (`floatingBgColor`, `floatingAvatarOffsetX/Y`, `floatingAvatarScale`) live at lines ~159-172.
- `PreviewScene.tsx` — `CameraController` (lines ~68-93) imperatively resets the R3F camera to config-derived position/target/fov on prop change (DO NOT MODIFY its reset behavior — this task is additive). `<OrbitControls target={sceneDefaults.cameraTarget} makeDefault />` at line ~224. `PreviewSceneInner` computes `sceneDefaults = resolveSceneDefaults(config)`.
- `mountPreview.tsx` — `PreviewHost` (the ONLY bridge between the React tree and the plain-JS host page) holds `hostEl` and renders `<PreviewScene config={config} />`. This is where a React callback must be converted into a DOM `CustomEvent` on `hostEl` so the Settings-page plain JS can hear it.
- `preview.ts` — the Settings-page preview mounts via the top-document `observeDocument(document)` fallback (lines ~164-170), the SAME generic bundle path the Gutenberg block uses. No changes needed here.
- `FloatingWidget.tsx` — `floatingSceneConfig` (lines ~46-52) maps `floatingAvatarScale/OffsetX/Y` onto the generic `avatarScale/avatarOffsetX/Y` keys AvatarScene reads. Add `cameraRotationY` mapping here the same way.
- `WpOptionsConfigSource.php` — floating defaults at lines ~155-159 (`floating_bg_color` etc.). `DEFAULT_CAMERA_ROTATION_Y = 0.0` const already exists (line ~105).
- `AvatarRenderer.php` — `render_floating()` adds `floatingBgColor`/`floatingAvatarOffsetX` etc. AFTER `public_safe()` (lines ~118-122). `apply_defensive_defaults()` re-applies floating keys at lines ~189-195. The generic `camera_rotation_y` already flows through `public_safe()` (line ~268) for the INLINE embed — do not touch that; add a SEPARATE `floatingCameraRotationY` output key.
- `SettingsPage.php` — floating `add_settings_field` calls at lines ~809-831; sanitize at lines ~933-937; render_form_table_row layout at lines ~1240-1242; `render_floating_avatar_scale_field()` slider pattern at lines ~1835-1856; `render_floating_preview_mount()` (config keys + mount div) at lines ~1883-1916; inline `rebuild()` JS + listener wiring at lines ~332-444.

CRITICAL constraint: every change is floating-widget-only. Do NOT touch editor.js, the Gutenberg block's `cameraRotationY` attribute, or the inline-embed global camera config.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Inverse-angle helper + floatingCameraRotationY config field + FloatingWidget mapping</name>
  <files>packages/wp-bundle/src/config.ts, packages/wp-bundle/src/floating/FloatingWidget.tsx</files>
  <behavior>
    - angleFromCameraPosition([px,py,pz], target, basePosition) returns the Y-degrees delta such that orbitAroundTarget(basePosition, target, deg) reproduces the camera's azimuth around target. It is the symmetric inverse of orbitAroundTarget's trig: compute baseAzimuth = atan2(basePosition[2]-target[2], basePosition[0]-target[0]) and curAzimuth = atan2(cameraPosition[2]-target[2], cameraPosition[0]-target[0]); deg = (baseAzimuth - curAzimuth) in degrees, normalized to (-180, 180].
    - Round-trip identity (within ~0.01deg): for any deg in [-179,179], angleFromCameraPosition(orbitAroundTarget(base, target, deg), target, base) === deg.
    - deg === 0 when cameraPosition === basePosition.
    - FloatingWidget's floatingSceneConfig sets cameraRotationY = config.floatingCameraRotationY ?? 0.0 (leaving cameraPreset to resolveSceneDefaults' own "front" default).
  </behavior>
  <action>
    In config.ts: export a new `angleFromCameraPosition(cameraPosition, target, basePosition)` helper placed directly beside `orbitAroundTarget` (mirror its signature style and header-comment discipline — document that it is the inverse used to READ a drag-orbited camera back into a rotation angle). Reuse the same dx/dz-around-target framing; use `Math.atan2` on the (z, x) deltas for both the base and current positions and return the base-minus-current difference in degrees, normalized into (-180, 180]. It MUST take `basePosition` (the preset's un-rotated position) because `orbitAroundTarget` rotates relative to the preset base, not the world origin. Add the field `floatingCameraRotationY?: number` to `KhaveeAvatarConfig` alongside the other `floating*` fields (~line 172), with a JSDoc line mirroring `cameraRotationY`'s doc but scoped "floating panel only". Do NOT change `orbitAroundTarget`, `resolveSceneDefaults`, or `CAMERA_PRESETS`.
    In FloatingWidget.tsx: in `floatingSceneConfig` (~line 46-52), add `cameraRotationY: config.floatingCameraRotationY ?? 0.0,` exactly mirroring how `avatarScale`/`avatarOffsetX/Y` are mapped from the floating* fields, so the real floating widget's AvatarScene renders at the saved angle.
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk && node -e "const s=require('fs').readFileSync('packages/wp-bundle/src/config.ts','utf8'); if(!/export function angleFromCameraPosition/.test(s)) throw new Error('helper missing'); if(!/floatingCameraRotationY\?: number/.test(s)) throw new Error('field missing'); const f=require('fs').readFileSync('packages/wp-bundle/src/floating/FloatingWidget.tsx','utf8'); if(!/cameraRotationY: config\.floatingCameraRotationY/.test(f)) throw new Error('mapping missing'); console.log('ok')"</automated>
  </verify>
  <done>angleFromCameraPosition exported and round-trip-correct vs orbitAroundTarget; floatingCameraRotationY on KhaveeAvatarConfig; FloatingWidget maps it to cameraRotationY.</done>
</task>

<task type="auto">
  <name>Task 2: PreviewScene onCameraAngleChange + OrbitControls onEnd readback + mountPreview CustomEvent bridge</name>
  <files>packages/wp-bundle/src/preview/PreviewScene.tsx, packages/wp-bundle/src/preview/mountPreview.tsx</files>
  <action>
    In PreviewScene.tsx: add an optional prop `onCameraAngleChange?: (deg: number) =&gt; void` to both the exported `PreviewScene` and the inner `PreviewSceneInner`, threading it down. Import `angleFromCameraPosition` and `CAMERA_PRESETS` from ../config. On `&lt;OrbitControls&gt;`, add an `onEnd` handler (fires ONCE when the user releases a drag/zoom — NOT per frame; do not use onChange to avoid write-thrash). In the handler, read the live camera via the OrbitControls event or a captured camera ref: get `camera.position` as an [x,y,z] tuple, use `sceneDefaults.cameraTarget` as the target and `CAMERA_PRESETS[sceneDefaults.cameraPreset].position` as the base position, compute `deg = angleFromCameraPosition(cameraPos, target, basePos)`, and call `onCameraAngleChange?.(deg)`. Prefer reading the camera from the OrbitControls instance the event provides; if simplest, add a small `useThree`-based capture inside a child of the Canvas (a sibling to CameraController) that exposes the camera to the onEnd handler via a ref — do NOT add a second imperative camera-mover and do NOT alter CameraController's existing reset-on-config-change effect. Keep the `makeDefault` and existing `target` prop on OrbitControls.
    In mountPreview.tsx: in `PreviewHost`, pass `onCameraAngleChange={(deg) =&gt; hostEl.dispatchEvent(new CustomEvent('khaveeai-preview-camera-angle', { detail: { deg } }))}` to `&lt;PreviewScene&gt;`. This is the ONLY React-to-plain-JS bridge; it is generic and additive — the Gutenberg block's host div simply has no listener for this event, so its behavior is unchanged. Add a short doc comment explaining the bridge and that the Settings page listens for this event.
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk && node -e "const p=require('fs').readFileSync('packages/wp-bundle/src/preview/PreviewScene.tsx','utf8'); if(!/onCameraAngleChange/.test(p)) throw new Error('prop missing'); if(!/onEnd/.test(p)) throw new Error('onEnd missing'); if(!/angleFromCameraPosition/.test(p)) throw new Error('helper import missing'); const m=require('fs').readFileSync('packages/wp-bundle/src/preview/mountPreview.tsx','utf8'); if(!/khaveeai-preview-camera-angle/.test(m)||!/onCameraAngleChange/.test(m)) throw new Error('bridge missing'); console.log('ok')"</automated>
  </verify>
  <done>OrbitControls onEnd computes the Y angle via the inverse helper and calls onCameraAngleChange; PreviewHost dispatches it as a khaveeai-preview-camera-angle CustomEvent on hostEl; CameraController untouched.</done>
</task>

<task type="auto">
  <name>Task 3: PHP data layer — floating_camera_rotation_y default + render_floating output key</name>
  <files>wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php, wordpress-plugin/includes/Render/AvatarRenderer.php</files>
  <action>
    In WpOptionsConfigSource.php `get_runtime_config()`: add `'floating_camera_rotation_y' =&gt; isset( $settings['floating_camera_rotation_y'] ) ? (float) $settings['floating_camera_rotation_y'] : self::DEFAULT_CAMERA_ROTATION_Y,` to the floating-only block (after `floating_avatar_scale`, ~line 159). Reuse the EXISTING `DEFAULT_CAMERA_ROTATION_Y` const (0.0) — do not add a new const. Follow the exact isset-&gt;cast-&gt;fallback shape of the sibling floating keys.
    In AvatarRenderer.php: in `apply_defensive_defaults()` add `$merged['floating_camera_rotation_y'] = isset( $merged['floating_camera_rotation_y'] ) ? (float) $merged['floating_camera_rotation_y'] : 0.0;` alongside the other floating re-applications (~line 195). In `render_floating()` add `$config['floatingCameraRotationY'] = (float) $merged['floating_camera_rotation_y'];` beside the other `$config['floating*']` assignments (~line 122). Do NOT touch `public_safe()`'s generic `cameraRotationY` (that is the inline-embed path and must stay independent).
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk && php -l wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php && php -l wordpress-plugin/includes/Render/AvatarRenderer.php && grep -q "floating_camera_rotation_y" wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php && grep -q "floatingCameraRotationY" wordpress-plugin/includes/Render/AvatarRenderer.php && echo ok</automated>
  </verify>
  <done>php -l clean on both files; floating_camera_rotation_y default present; floatingCameraRotationY emitted by render_floating (and defensively re-applied); inline-embed cameraRotationY untouched.</done>
</task>

<task type="auto">
  <name>Task 4: SettingsPage.php — floating camera angle slider + bidirectional live-preview JS wiring</name>
  <files>wordpress-plugin/includes/Admin/SettingsPage.php</files>
  <action>
    Registration: add an `add_settings_field( 'floating_camera_rotation_y', __( 'Floating camera angle', 'khaveeai' ), array( $this, 'render_floating_camera_rotation_y_field' ), self::PAGE_SLUG, 'khaveeai_main' )` after the `floating_avatar_scale` field (~line 831). In `sanitize_settings()` add `$sanitized['floating_camera_rotation_y'] = isset( $input['floating_camera_rotation_y'] ) ? (float) $input['floating_camera_rotation_y'] : 0.0;` beside the other floating sanitizers (~line 937).
    Field renderer: add `render_floating_camera_rotation_y_field()` mirroring `render_floating_avatar_scale_field()` VERBATIM in structure (get_option -&gt; isset read with 0.0 default -&gt; printf a `&lt;span&gt;`-wrapped `&lt;input type="range" min="-180" max="180" step="1" id="khaveeai_floating_camera_rotation_y" name="%s[floating_camera_rotation_y]" value="%s" /&gt;&lt;output id="khaveeai_floating_camera_rotation_y_out" for="..."&gt;%s&lt;/output&gt;&lt;/span&gt;` plus a `&lt;p class="description"&gt;` explaining it is the floating widget's camera angle in degrees, and that dragging the live preview also updates it). Add `$this-&gt;render_form_table_row( __( 'Floating camera angle', 'khaveeai' ), array( $this, 'render_floating_camera_rotation_y_field' ) );` after the scale row (~line 1242).
    Preview mount config: in `render_floating_preview_mount()` add `'cameraRotationY' =&gt; isset( $settings['floating_camera_rotation_y'] ) ? (float) $settings['floating_camera_rotation_y'] : 0.0,` to the `$config` array so the preview loads at the saved angle.
    Inline JS (`enqueue_settings_assets()` `$js`): (a) in `rebuild()`, read `var rotEl = document.getElementById( 'khaveeai_floating_camera_rotation_y' );` and add `cameraRotationY: rotEl ? parseFloat( rotEl.value ) : 0.0` to the `cfg` object, and update its `_out` readout like the other sliders; (b) add `'khaveeai_floating_camera_rotation_y'` to the `ids` array that gets input/change listeners; (c) add a NEW listener that closes the drag loop: `mount.addEventListener( 'khaveeai-preview-camera-angle', function ( e ) { var d = Math.round( e.detail.deg ); var el = document.getElementById( 'khaveeai_floating_camera_rotation_y' ); if ( el ) { el.value = d; } var out = document.getElementById( 'khaveeai_floating_camera_rotation_y_out' ); if ( out ) { out.textContent = d; } rebuild(); } );`. This makes drag-orbit write the slider value AND round-trip through rebuild (which writes cameraRotationY into the preview config; CameraController then re-applies the SAME angle it was just read from — no oscillation, since onEnd fires only on user interaction, never on the programmatic reset). Typing/dragging the slider directly already rotates the camera via the existing input/change -&gt; rebuild path.
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk && php -l wordpress-plugin/includes/Admin/SettingsPage.php && grep -q "render_floating_camera_rotation_y_field" wordpress-plugin/includes/Admin/SettingsPage.php && grep -q "khaveeai-preview-camera-angle" wordpress-plugin/includes/Admin/SettingsPage.php && grep -q "floating_camera_rotation_y" wordpress-plugin/includes/Admin/SettingsPage.php && echo ok</automated>
  </verify>
  <done>Slider registered/sanitized/rendered as a form-table row; preview config carries cameraRotationY; rebuild() reads the slider; drag-orbit event writes back into the slider + rebuild; php -l clean.</done>
</task>

<task type="auto">
  <name>Task 5: Full build + PHP harness verification</name>
  <files>(no source changes — verification only)</files>
  <action>Run the wp-bundle build and the bare-PHP harnesses to confirm the whole change compiles and the PHP layer stays green. If the build fails, fix type errors in the Task 1/2 files (likely: the OrbitControls onEnd camera-read typing, or the new prop threading) before proceeding. The one pre-existing settings-page-harness failure documented in 260706-vf4 / 260705-p30 is expected and is NOT a regression — only flag NEW failures.</action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk && pnpm --filter @khaveeai/wp-bundle build && php -l wordpress-plugin/includes/Admin/SettingsPage.php && php -l wordpress-plugin/includes/Render/AvatarRenderer.php && php -l wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php && echo BUILD_AND_LINT_OK</automated>
  </verify>
  <done>pnpm --filter @khaveeai/wp-bundle build completes with no errors; all three edited PHP files are php -l clean; existing harnesses show no NEW failures (run the repo's settings-page/platform-config/render-logic harnesses if present).</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>A live camera-angle drag control on the floating widget's Settings-page preview, backed by a new floating-only `floating_camera_rotation_y` setting wired end-to-end (TS inverse-angle math, React onEnd readback bridged via a CustomEvent, PHP config pipeline, a "Floating camera angle" slider, and bidirectional live-preview JS).</what-built>
  <how-to-verify>
    On the running wp-env instance, visit http://localhost:8888/wp-admin/admin.php?page=khaveeai-settings and confirm:
    1. Dragging/orbiting the live preview's camera updates the "Floating camera angle" slider's value/readout AND the angle persists (does not snap back) after you release the drag.
    2. Typing/dragging the "Floating camera angle" slider directly rotates the preview's camera to that angle.
    3. Save, then reload the page — the dragged-in angle is preserved in both the slider and the preview.
    4. Open the actual floating widget on the front-end site (not just the admin preview) — it reflects the saved camera angle.
    5. Regression check: the Gutenberg block editor's own camera-angle slider/preview still works exactly as before (unchanged by this task).
  </how-to-verify>
  <resume-signal>Type "approved" or describe any issues.</resume-signal>
</task>

</tasks>

<verification>
- `pnpm --filter @khaveeai/wp-bundle build` — no errors.
- `php -l` clean on WpOptionsConfigSource.php, AvatarRenderer.php, SettingsPage.php.
- Existing bare-PHP harnesses (settings-page/platform-config/render-logic) show no NEW failures (one pre-existing settings-page-harness failure is known/expected).
- Human-verify checkpoint on wp-env confirms drag-persist, slider-drives-camera, save/reload persistence, front-end widget reflects the angle, and Gutenberg block unregressed.
</verification>

<success_criteria>
- Dragging the Settings-page preview camera persists as `floating_camera_rotation_y` via the slider + rebuild round-trip.
- The slider is a working manual-entry fallback that coexists with drag and drives the preview camera.
- The saved angle flows through WpOptionsConfigSource -> AvatarRenderer::render_floating -> FloatingWidget (cameraRotationY) to the real front-end floating widget.
- Zero changes to editor.js, the Gutenberg block's cameraRotationY, the inline-embed camera config, or CameraController's reset behavior.
- No new npm dependencies.
</success_criteria>

<output>
Create `.planning/quick/260706-wop-live-camera-angle-drag-preview/260706-wop-SUMMARY.md` when done.
</output>
