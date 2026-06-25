# Phase 9: Block Studio — Visual Config, Live Preview, Chat & Lip-Sync - Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 12 (3 new, 9 modified)
**Analogs found:** 12 / 12 (every file has a concrete in-repo or khavee-app analog — this is a wiring-heavy phase; the hard pieces already exist)

> This phase is overwhelmingly a *wiring* phase (RESEARCH.md). The single load-bearing insight for the planner: every new/modified file has a near-identical existing analog whose concrete shape is reproduced below. Two cross-cutting locked constraints shape every assignment:
> - **STUDIO-02 safety (Pitfall 1):** the preview bundle is a *physically separate esbuild entry point* whose import graph never reaches `@khaveeai/providers-openai-realtime`. Safety is enforced by the bundler graph, not a runtime flag. A build-time grep assertion in `build.mjs` is the belt-and-braces guard.
> - **STUDIO-05 config transport (zero new plumbing):** new keys ride the EXISTING `block.json` attribute → `wp_parse_args` merge → `public_safe()` whitelist → `data-khaveeai-config` JSON → bundle-parse pipeline. Additive only — extend three PHP arrays + one TS interface.

## File Classification

| New/Modified File | Role | Data Flow | STUDIO-# / Part | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|----------------|---------------|
| `wordpress-plugin/src/block.json` (MOD) | config | declarative-attr | STUDIO-05 (transport) | `wordpress-plugin/src/block.json` (itself — extend existing 3 attrs) | exact (self-extension) |
| `wordpress-plugin/includes/Block/block.json` (MOD) | config | declarative-attr | STUDIO-05 | `wordpress-plugin/includes/Block/block.json` (mirror of src/) | exact (self-mirror) |
| `wordpress-plugin/src/editor.js` (MOD) | controller (inspector) | event-driven (setAttributes) | STUDIO-01/02 (Parts A/B) | `wordpress-plugin/src/editor.js` existing single-`PanelBody` (lines 71-143) | exact (self-extension) |
| `wordpress-plugin/includes/Block/AvatarBlock.php` (MOD) | controller (render_callback) | request-response | STUDIO-05 | `AvatarBlock.php:68-82` (existing 3-key merge) | exact (self-extension) |
| `wordpress-plugin/includes/Render/AvatarRenderer.php` (MOD) | service (config transport) | transform | STUDIO-05 | `AvatarRenderer.php:54-95, 138-146` (existing merge + `public_safe` whitelist) | exact (self-extension) |
| `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` (MOD) | service (defaults source) | transform | STUDIO-05 | `WpOptionsConfigSource.php:58-78` (`get_runtime_config`) | exact (self-extension) |
| `packages/wp-bundle/build.mjs` (MOD) | config (build) | batch (multi-entry) | STUDIO-02 | `packages/wp-bundle/build.mjs` (existing single-entry, lines 10-22) | exact (self-extension) |
| `packages/wp-bundle/src/index.ts` (MOD) | entry (view) | IIFE-mount | STUDIO-05 (view side) | `packages/wp-bundle/src/index.ts` (existing `mountAll`, lines 19-45) | exact (unchanged — view entry) |
| `packages/wp-bundle/src/preview.ts` (NEW) | entry (preview) | IIFE-mount | STUDIO-02 | `packages/wp-bundle/src/index.ts` (mirror, drop provider import) | role-match (new mount-point attribute) |
| `packages/wp-bundle/src/config.ts` (NEW) | model/types | transform | STUDIO-01/05 | `packages/wp-bundle/src/mount.tsx:36-52` (`KhaveeAvatarConfig`) + khavee-app `Preview.tsx:54-87` (preset vectors) | role-match (consolidates existing) |
| `packages/wp-bundle/src/preview/PreviewScene.tsx` (NEW) | component (3D scene) | request-response (render) | STUDIO-02/04 | khavee-app `PreviewModel.tsx` (full file) + `mount.tsx:54-64` `AvatarScene` | role-match (khavee-app lift) |
| `packages/wp-bundle/src/mount.tsx` (MOD) | component (live mount) | request-response | STUDIO-03/04/05 (live) | `packages/wp-bundle/src/mount.tsx` (existing, lines 54-84) | exact (self-extension) |
| `packages/wp-bundle/src/ui/ChatBox.tsx` (NEW) | component (chat UI) | event-driven (sendMessage) | STUDIO-03 | khavee-app `ChatBox.tsx` (full 175 lines) | role-match (re-authored dependency-free) |
| `packages/wp-bundle/styles.css` (MOD) | styles | declarative | STUDIO-03 (chatbox chrome) | `packages/wp-bundle/styles.css` (existing, lines 11-67) + UI-SPEC §Color/§Spacing | exact (self-extension) |

---

## Pattern Assignments

### `wordpress-plugin/src/block.json` (config, declarative-attr) — STUDIO-05

**Analog:** itself (existing 3 attributes at lines 9-22)

**Existing shape to extend** (`wordpress-plugin/src/block.json:9-23`):
```json
"attributes": {
    "voice":        { "type": "string",  "default": "" },
    "instructions": { "type": "string",  "default": "" },
    "avatar":       { "type": "number",  "default": 0 }
},
"editorScript": "file:../../assets/editor.js"
```

**Add these 13 keys** (CONCRETE shape from RESEARCH.md Code Examples; numeric defaults are `0`/`false`/`""` so they mean "use admin default" via `wp_parse_args` — mirrors how `avatar: 0` already works in Phase 8):
```json
"containerWidth":  { "type": "number",  "default": 0 },
"containerHeight": { "type": "number",  "default": 0 },
"fullWidth":       { "type": "boolean", "default": false },
"bgType":          { "type": "string",  "default": "" },
"bgColor":         { "type": "string",  "default": "" },
"bgTransparent":   { "type": "boolean", "default": false },
"bgImageId":       { "type": "number",  "default": 0 },
"lightIntensity":  { "type": "number",  "default": 0 },
"avatarScale":     { "type": "number",  "default": 0 },
"avatarOffsetX":   { "type": "number",  "default": 0 },
"avatarOffsetY":   { "type": "number",  "default": 0 },
"cameraPreset":    { "type": "string",  "default": "" },
"chatShow":        { "type": "boolean", "default": false },
"chatPlacement":   { "type": "string",  "default": "" }
```

**`editorScript` field (STUDIO-02 Open Question 1):** `editorScript` accepts a string OR array of strings per WP block-api docs. Two viable paths:
- (a) `"editorScript": ["file:../../assets/editor.js", "file:../../build/khaveeai-preview.js"]` — both load in the editor iframe.
- (b) Keep single `editorScript` for `editor.js`; register `khaveeai-preview.js` via a new `wp_enqueue_script` call on the `enqueue_block_editor_assets` hook in `Plugin.php` (mirrors how `AssetManager::enqueue()` registers the view bundle — see `AssetManager.php:47-73`).

**Recommendation:** path (b) is more explicit and decouples the two build pipelines (wp-scripts for editor.js, esbuild for preview bundle) — they have *different* externalization rules (editor.js externalizes React to `window.wp.*`; preview bundle bundles React inline).

---

### `wordpress-plugin/src/editor.js` (controller, event-driven) — STUDIO-01/02

**Analog:** existing `editor.js:71-143` — the existing single `PanelBody` is the exact pattern to multiply ×7.

**Existing pattern to extend** (`editor.js:71-113`):
```javascript
function Edit( { attributes, setAttributes } ) {
    const { voice, instructions, avatar } = attributes;
    const blockProps = useBlockProps();

    return createElement( 'div', blockProps,
        createElement( InspectorControls, null,
            createElement( PanelBody,
                { title: __( 'Khavee AI Avatar Settings', 'khaveeai' ), initialOpen: true },
                createElement( SelectControl, {
                    label: __( 'Voice', 'khaveeai' ),
                    value: voice,
                    options: VOICE_OPTIONS,
                    onChange: ( value ) => setAttributes( { voice: value } ),
                } ),
                // ...TextareaControl for instructions, MediaUpload for avatar...
            )
        ),
        // ...static placeholder div (REPLACE per STUDIO-02)...
    );
}
```

**Imports to add** (alongside existing `editor.js:30-41`):
```javascript
import {
    PanelBody, SelectControl, TextareaControl, Button,
    RangeControl, ToggleControl, ColorPalette, TextControl,
} from '@wordpress/components';
import { MediaUpload, MediaUploadCheck } from '@wordpress/block-editor';
// REMOVE: import ServerSideRender from '@wordpress/server-side-render';
```

**STUDIO-01 panel structure** (7 `PanelBody`s per UI-SPEC §Copywriting — Layout, Background, Lighting, Avatar, Camera, Voice & Behavior, Chat Box). Each panel mirrors the existing pattern exactly. Mutual-exclusivity rules (UI-SPEC §Mutual-exclusivity): pass `disabled: bgTransparent` / `disabled: bgType !== 'color'` etc. to the relevant controls (grey, not hidden).

**RangeControl ranges (lift from UI-SPEC §Copywriting + khavee-app):**
- Lighting: `min: 0, max: 2, step: 0.1` (khavee-app `BackgroundPanel.tsx:38-39` — `MIN=0, MAX=2`)
- Avatar scale: `min: 0.5, max: 2.0, step: 0.05`
- Avatar offset-X/Y: `min: -1.0, max: 1.0, step: 0.05`
- Container width: `min: 200, max: 1200`; height: similar

**STUDIO-02 — replace the placeholder div (`editor.js:115-141`) with a preview mount-point div.** The existing static placeholder block:
```javascript
createElement( 'div', { style: { border: '1px dashed #757575', ... } },
    createElement( 'p', ..., __( 'Khavee AI Avatar', 'khaveeai' ) ),
    createElement( 'p', ..., __( 'Live preview is not shown in the editor ...', 'khaveeai' ) ),
    createElement( ServerSideRender, { block: 'khaveeai/avatar', attributes: { voice, instructions, avatar } } )
)
```
becomes:
```javascript
createElement( 'div', {
    'data-khaveeai-preview-config': JSON.stringify( attributes ),  // editor.js keeps this in sync on every re-render (Gutenberg re-renders edit() on every setAttributes)
    // The preview bundle (separately enqueued) scans [data-khaveeai-preview-config] and mounts R3F inside.
} )
```
The header comment at `editor.js:1-26` documents the existing "no SPA imports" discipline — extend the comment to note Phase 9 still imports nothing SPA-side; the preview is a *separately-enqueued* bundle that owns its own React 19 (Pitfall 2).

**Pitfall 4 (undo spam):** `RangeControl.onChange` fires per-pixel. UI-SPEC interaction-state row "Preview — config reactivity lag" says "last-applied value wins; no debouncing" — but `setAttributes` writes the undo stack. Planner should task a `useRef`-backed local state for live drag + committed `setAttributes` on pointer-up OR a small debounce (~50ms). The preview bundle reads from `data-khaveeai-preview-config` which `editor.js` rewrites on every `edit()` re-render — keep that JSON sync on the same cadence as the committed attribute write to avoid preview lag.

---

### `wordpress-plugin/includes/Block/AvatarBlock.php` (controller, request-response) — STUDIO-05

**Analog:** `AvatarBlock.php:68-82` (existing 3-key `render_callback`).

**Existing pattern** (`AvatarBlock.php:68-82`):
```php
public function render_callback( array $attributes ): string {
    $attachment_id = isset( $attributes['avatar'] ) ? (int) $attributes['avatar'] : 0;
    $avatar_url    = $attachment_id > 0 ? wp_get_attachment_url( $attachment_id ) : '';
    $avatar_url    = is_string( $avatar_url ) ? $avatar_url : '';

    $renderer_atts = array(
        'voice'        => isset( $attributes['voice'] ) ? (string) $attributes['voice'] : '',
        'instructions' => isset( $attributes['instructions'] ) ? (string) $attributes['instructions'] : '',
        'avatar_url'   => $avatar_url,
    );

    $renderer_atts = array_filter( $renderer_atts, static fn( $v ) => '' !== $v );
    return $this->renderer->render( $renderer_atts );
}
```

**Extend** by (1) resolving `bgImageId` → URL exactly as `avatar` is resolved (lines 69-71), (2) extending `$renderer_atts` with the 13 new keys cast to their PHP types, (3) **fixing the `array_filter`** — the existing `static fn( $v ) => '' !== $v` would strip `0`/`0.0` due to PHP loose comparison (`'' == 0`). RESEARCH.md Pitfall/Code-Examples gives the exact safe callback:
```php
$bg_image_url = isset( $attributes['bgImageId'] ) && $attributes['bgImageId'] > 0
    ? wp_get_attachment_url( (int) $attributes['bgImageId'] ) : '';
$bg_image_url = is_string( $bg_image_url ) ? $bg_image_url : '';

$renderer_atts = array(
    // ...existing voice/instructions/avatar_url...
    'container_width'  => isset( $attributes['containerWidth'] )  ? (int)   $attributes['containerWidth']  : 0,
    'container_height' => isset( $attributes['containerHeight'] ) ? (int)   $attributes['containerHeight'] : 0,
    'full_width'       => ! empty( $attributes['fullWidth'] ),
    'bg_type'          => isset( $attributes['bgType'] )          ? (string)$attributes['bgType']         : '',
    'bg_color'         => isset( $attributes['bgColor'] )         ? (string)$attributes['bgColor']        : '',
    'bg_transparent'   => ! empty( $attributes['bgTransparent'] ),
    'bg_image_url'     => $bg_image_url,
    'light_intensity'  => isset( $attributes['lightIntensity'] )  ? (float) $attributes['lightIntensity'] : 1.0,
    'avatar_scale'     => isset( $attributes['avatarScale'] )     ? (float) $attributes['avatarScale']    : 1.0,
    'avatar_offset_x'  => isset( $attributes['avatarOffsetX'] )   ? (float) $attributes['avatarOffsetX']  : 0.0,
    'avatar_offset_y'  => isset( $attributes['avatarOffsetY'] )   ? (float) $attributes['avatarOffsetY']  : 0.0,
    'camera_preset'    => isset( $attributes['cameraPreset'] )    ? (string)$attributes['cameraPreset']   : '',
    'chat_show'        => ! empty( $attributes['chatShow'] ),
    'chat_placement'   => isset( $attributes['chatPlacement'] )   ? (string)$attributes['chatPlacement']  : '',
);

// SAFE FILTER (preserves 0 / 0.0 / false; only strips empty strings):
$renderer_atts = array_filter( $renderer_atts, static function ( $v, $k ) {
    if ( is_string( $v ) ) return '' !== $v;
    return true; // keep numeric + bool as-is
}, ARRAY_FILTER_USE_BOTH );
```

---

### `wordpress-plugin/includes/Render/AvatarRenderer.php` (service, transform) — STUDIO-05

**Analog:** `AvatarRenderer.php:54-95` (existing `render()`) + `:138-146` (existing `public_safe()` whitelist).

**Two additive changes:**

1. **Extend the `isset→cast→fallback` block** at `AvatarRenderer.php:66-74` to cover the 13 new keys (mirroring the existing `instructions`/`voice`/`avatar_url`/`model` re-application shape). Each key gets `isset( $merged[$snake] ) ? (cast) $merged[$snake] : <default>`, with blanks falling back to `(string) $defaults[$snake]` or to a literal Phase-8 hardcoded scene default.

2. **Extend `public_safe()` whitelist** at `AvatarRenderer.php:138-146` to emit the new camelCase keys. CONCRETE addition to the existing return array:
```php
return array(
    // ...existing voice/instructions/avatarUrl/model/restUrl...
    'containerWidth'  => isset( $merged['container_width'] )  ? (int)   $merged['container_width']  : 0,
    'containerHeight' => isset( $merged['container_height'] ) ? (int)   $merged['container_height'] : 0,
    'fullWidth'       => (bool) ( $merged['full_width'] ?? false ),
    'bgType'          => isset( $merged['bg_type'] )          ? (string)$merged['bg_type']          : '',
    'bgColor'         => isset( $merged['bg_color'] )         ? (string)$merged['bg_color']         : '',
    'bgTransparent'   => (bool) ( $merged['bg_transparent'] ?? false ),
    'bgImageUrl'      => isset( $merged['bg_image_url'] )     ? (string)$merged['bg_image_url']     : '',
    'lightIntensity'  => isset( $merged['light_intensity'] )  ? (float) $merged['light_intensity'] : 1.0,
    'avatarScale'     => isset( $merged['avatar_scale'] )     ? (float) $merged['avatar_scale']    : 1.0,
    'avatarOffsetX'   => isset( $merged['avatar_offset_x'] )  ? (float) $merged['avatar_offset_x'] : 0.0,
    'avatarOffsetY'   => isset( $merged['avatar_offset_y'] )  ? (float) $merged['avatar_offset_y'] : 0.0,
    'cameraPreset'    => isset( $merged['camera_preset'] )    ? (string)$merged['camera_preset']   : 'front',
    'chatShow'        => (bool) ( $merged['chat_show'] ?? false ),
    'chatPlacement'   => isset( $merged['chat_placement'] )   ? (string)$merged['chat_placement']  : 'beside',
);
```
**Security:** the existing `esc_attr( wp_json_encode( ... ) )` at line 93 already escapes whatever `public_safe()` returns — new keys benefit automatically. Do NOT add any key to `public_safe()` that contains a secret; this method must never read the API key (existing comment at lines 130-133).

**Note on snake→camel mapping:** PHP layer is snake_case (WordPress convention); the bundle consumes camelCase. `public_safe()` is the single boundary that translates.

---

### `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` (service, transform) — STUDIO-05

**Analog:** `WpOptionsConfigSource.php:58-78` (existing `get_runtime_config()`).

**Existing pattern** (4 keys returned, each with `'' !== $x ? $x : DEFAULT` fallback):
```php
return [
    'instructions' => '' !== $instructions ? $instructions : self::DEFAULT_INSTRUCTIONS,
    'voice'        => '' !== $voice        ? $voice        : self::DEFAULT_VOICE,
    'avatar_url'   => $avatar_url,
    'model'        => '' !== $model        ? $model        : self::DEFAULT_MODEL,
];
```

**Add the 13 new keys to the returned array** (snake_case). The admin Settings-page UI for editing these is explicitly OUT OF SCOPE this phase (CONTEXT `<deferred_ideas>`); only the *defaults* must exist so `wp_parse_args` has a fallback. Planner should add new `private const DEFAULT_LIGHT_INTENSITY = 1.0` etc. matching the locked CONTEXT defaults (light=1.0, scale=1.0, offsetX/Y=0.0, cameraPreset='front', chatShow=false, chatPlacement='beside'). Read each from `$settings[...]` with the same `isset ? (cast) : DEFAULT` shape — mirror lines 65-67.

---

### `packages/wp-bundle/build.mjs` (config, batch) — STUDIO-02

**Analog:** itself (existing single-entry build at lines 10-30).

**Existing pattern** (`build.mjs:10-22`):
```javascript
const buildOptions = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",            // no globalName → zero globals exposed (D-10)
  outfile: "../../wordpress-plugin/build/khaveeai-bundle.js",
  minify: true,
  target: ["es2017"],
  loader: { ".css": "css" },
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  // Deliberately NO `external` array — D-10 full isolation
};
```

**Refactor to a reusable `buildOptions(entry, outfile)` factory + emit two entries** (RESEARCH.md Code Examples):
```javascript
const buildOptions = (entry, outfile) => ({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  outfile,
  minify: true,
  target: ["es2017"],
  loader: { ".css": "css" },
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});

await esbuild.build(buildOptions("src/index.ts",  "../../wordpress-plugin/build/khaveeai-bundle.js"));
await esbuild.build(buildOptions("src/preview.ts", "../../wordpress-plugin/build/khaveeai-preview.js"));

// STUDIO-02 BUILD-TIME SAFETY ASSERTION (Pitfall 1 belt-and-braces):
import { readFileSync } from "node:fs";
const previewOut = readFileSync("../../wordpress-plugin/build/khaveeai-preview.js", "utf8");
const FORBIDDEN = [/RealtimeProvider/, /getUserMedia/, /ephemeral/];
for (const re of FORBIDDEN) {
  if (re.test(previewOut)) {
    console.error(`SAFETY VIOLATION: preview bundle matches ${re} — aborting`);
    process.exit(1);
  }
}
```
Apply the same refactor to the `watch` branch (line 24-28): build a `context` for each entry.

---

### `packages/wp-bundle/src/index.ts` (entry, IIFE-mount) — STUDIO-05 (view side)

**Analog:** itself (existing `mountAll`, lines 19-45).

**No structural change required** — the existing `index.ts:19-39` `mountAll()` already scans `[data-khaveeai-config]` and calls `mountAvatarInstance(root, config)`. The `KhaveeAvatarConfig` interface it parses will grow (see `config.ts` assignment) but parsing is duck-typed. Verify the existing header comment (lines 1-13) still holds: this is the VIEW entry, enqueued only by `AssetManager::enqueue()` from `AvatarRenderer::render()` (PERF-01 conditional enqueue).

---

### `packages/wp-bundle/src/preview.ts` (NEW entry, IIFE-mount) — STUDIO-02

**Analog:** `packages/wp-bundle/src/index.ts` (mirror its `mountAll` shape), but **mounts into `[data-khaveeai-preview-config]`** and **never imports `@khaveeai/providers-openai-realtime`**.

**Concrete pattern** (lift the structure of `index.ts:19-45`, swap attribute + mount fn + drop provider import):
```typescript
// packages/wp-bundle/src/preview.ts — STUDIO-02 safe-preview entry
import "../styles.css";
import { createRoot } from "react-dom/client";
import { mountEditorPreview } from "./preview/mountPreview";
import type { KhaveeAvatarConfig } from "./config";

function mountAllPreviews(): void {
  const roots = document.querySelectorAll<HTMLElement>("[data-khaveeai-preview-config]");
  roots.forEach((el) => {
    if (el.dataset.khaveeaiMounted === "true") return;   // idempotency guard (mirror index.ts:24)
    el.dataset.khaveeaiMounted = "true";

    let config: KhaveeAvatarConfig;
    try {
      config = JSON.parse(el.dataset.khaveeaiPreviewConfig ?? "{}") as KhaveeAvatarConfig;
    } catch { return; }                                   // per-element graceful fail (mirror index.ts:30-34)

    const root = createRoot(el);
    mountEditorPreview(root, config);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAllPreviews);
} else {
  mountAllPreviews();
}

// ⚠️ This file MUST NOT import from "@khaveeai/providers-openai-realtime".
//    The build.mjs grep assertion enforces this at build time.
```

**Config reactivity (RESEARCH Open Question 3):** `editor.js` rewrites `data-khaveeai-preview-config` on every `edit()` re-render (every `setAttributes`). To avoid WebGL-context churn (Pitfall 3), `mountEditorPreview` should use a `MutationObserver` on the mount element's `data-khaveeai-preview-config` attribute to push fresh config into React state — NOT unmount/remount the root on each change.

---

### `packages/wp-bundle/src/config.ts` (NEW model/types, transform) — STUDIO-01/05

**Analogs:**
- `packages/wp-bundle/src/mount.tsx:36-52` (`KhaveeAvatarConfig` interface — extend here, or move to `config.ts` and re-export)
- khavee-app `apps/web/src/app/[locale]/projects/[id]/settings/steps/Preview.tsx:54-87` (camera preset vectors — lift VERBATIM)

**Concrete contents:**

1. **Extended `KhaveeAvatarConfig`** (grows the existing 5 fields by 14 new optional fields, all blank-defaulting at the consumer side to Phase-8 hardcoded values):
```typescript
export interface KhaveeAvatarConfig {
  // Existing (Phase 8):
  voice?: "alloy" | "ash" | "ballad" | "coral" | "echo" | "sage" | "shimmer" | "verse" | "marin" | "cedar";
  instructions?: string;
  avatarUrl?: string;
  model?: string;
  restUrl?: string;
  // NEW (Phase 9, Part A/C):
  containerWidth?: number;     // 0 = admin default
  containerHeight?: number;
  fullWidth?: boolean;
  bgType?: "color" | "image" | "";
  bgColor?: string;
  bgTransparent?: boolean;
  bgImageUrl?: string;
  lightIntensity?: number;     // default 1.0
  avatarScale?: number;        // default 1.0
  avatarOffsetX?: number;      // default 0.0
  avatarOffsetY?: number;      // default 0.0
  cameraPreset?: CameraPreset; // default "front"
  chatShow?: boolean;
  chatPlacement?: "beside" | "below";
}
```

2. **Camera presets (LIFT VERBATIM from khavee-app `Preview.tsx:54-87` — convert `{x,y,z}` to tuple `[x,y,z]` for R3F):**
```typescript
export const CAMERA_PRESETS = {
  front:        { position: [ 0,    1.3,  3.1 ] as [number,number,number], target: [0, 0.15, 0] as [number,number,number] },
  "left-angle": { position: [-2.05, 1.28, 2.5 ] as [number,number,number], target: [0, 0.15, 0] as [number,number,number] },
  "right-angle":{ position: [ 2.05, 1.28, 2.5 ] as [number,number,number], target: [0, 0.15, 0] as [number,number,number] },
  wide:         { position: [ 0,    1.55, 5.2 ] as [number,number,number], target: [0, 0.1,  0] as [number,number,number] },
} as const;
export type CameraPreset = keyof typeof CAMERA_PRESETS;   // "front" | "left-angle" | "right-angle" | "wide"
```

3. **Light range constant** (lift from khavee-app `BackgroundPanel.tsx:38-39`):
```typescript
export const LIGHT_INTENSITY = { min: 0, max: 2, step: 0.1, default: 1.0 } as const;
```

4. **Default-resolution helper** (Phase-8 hardcoded scene values from `mount.tsx:58-60`):
```typescript
export function resolveSceneDefaults(c: KhaveeAvatarConfig) {
  return {
    lightIntensity: c.lightIntensity ?? 1.0,
    avatarScale: c.avatarScale ?? 1.0,
    avatarOffsetX: c.avatarOffsetX ?? 0.0,
    avatarOffsetY: c.avatarOffsetY ?? 0.0,
    cameraPreset: c.cameraPreset ?? "front",
    cameraPosition: CAMERA_PRESETS[c.cameraPreset ?? "front"].position,
    cameraFov: 20, // khavee-app PreviewModel.tsx:61 uses fov=20; consistent with preset vectors
    ambient: 1, directional: 2.5, // Phase-8 hardcoded at mount.tsx:59-60
  };
}
```
**`fov` choice:** khavee-app `PreviewModel.tsx:61` uses `fov = 20` (tighter framing, consistent with the lifted preset vectors). Phase 8's `mount.tsx:58` used `fov: 50`. Planner picks one; RESEARCH recommends `20` for the preview to match khavee-app, but the VIEW bundle may stay at `50` to preserve Phase-8 published-page appearance. **Whatever the choice, fov + preset vectors must be consistent** (RESEARCH A2).

---

### `packages/wp-bundle/src/preview/PreviewScene.tsx` (NEW component, 3D scene) — STUDIO-02/04

**Analog:** khavee-app `apps/web/src/components/settings/preview/PreviewModel.tsx` (full file — the SAFE-PREVIEW pattern that renders VRM without realtime/mic/token).

**khavee-app PreviewModel structure to lift** (`PreviewModel.tsx:115-148`):
```tsx
return (
  <Canvas shadows camera={{ fov: fov }} gl={{ preserveDrawingBuffer }}>
    <ModelLoadObserver ... />
    <CameraControls ... />
    <ambientLight intensity={ambientLightIntensity} />     {/* ← config-driven (Part A Lighting) */}
    <directionalLight position={[10, 10, 5]} castShadow />
    {modelUrl && (
      <VRMAvatar
        key={modelUrl}
        src={modelUrl}
        position={[0, 0, 0]}                                {/* ← replace with [offsetX, offsetY, 0] from config */}
        animations={animations}                            {/* idle/speaking/thinking from khavee-app; Phase 9 uses idle-only per Out-of-Scope */}
      />
    )}
  </Canvas>
);
```

**Phase 9 deviations from khavee-app PreviewModel** (RESEARCH.md Code Examples):
- **DROP `<Environment preset="sunset" />`** — pulls a large HDR asset (asset dependency). Rely on `ambientLight` + `directionalLight` only, matching Phase-8's `mount.tsx:59-60`.
- **DROP `<CameraControls>`** — Phase 9 uses preset dropdown only (CONTEXT Part A "preset dropdown only, no free-form XYZ"). Instead, drive the R3F camera directly: `<Canvas camera={{ position: preset.position, fov: 20 }}>`.
- **DROP custom `.fbx` motion uploads** — out of scope. Use `VRMAvatar`'s built-in `idle` animation only.
- **Apply Part A config:** scale + offset on `<VRMAvatar>` (`scale={avatarScale} position={[avatarOffsetX, avatarOffsetY, 0]}`), `bgColor`/transparent on the container div (NOT on the scene — see Pitfall 6).
- **Wrap in `<KhaveeProvider>`** (no realtime arg) so `useVRMExpressions` works for the Preview-talking viseme loop. Verified `KhaveeProvider` accepts no config: `KhaveeProvider.tsx:53-58` JSDoc shows "VRM-only app (no config needed)" and `KhaveeProvider.tsx:93-95` initializes `realtimeProvider` to `config?.realtime || null` — null is fine. **Do NOT call `useRealtime()` from the preview path** (`useRealtime.ts:36-40` throws if `realtimeProvider` is null).

**Part D — Preview-talking viseme loop** (no-audio demo, RESEARCH.md Code Examples). Viseme keys `aa/ih/ou/ee/oh` confirmed at `useRealtime.ts:61, 73` (`setMultipleExpressions({ aa, ih, ou, ee, oh })`):
```typescript
import { useVRMExpressions } from "@khaveeai/react";
const VISEME_SEQUENCE = ["aa", "ih", "ou", "ee", "oh"] as const;
const VISEME_VALUES = { aa: 0.6, ih: 0.4, ou: 0.5, ee: 0.45, oh: 0.55 };

function usePreviewTalking(enabled: boolean) {
  const { setMultipleExpressions } = useVRMExpressions();
  useEffect(() => {
    if (!enabled) { setMultipleExpressions({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }); return; }
    let i = 0;
    const interval = setInterval(() => {
      const viseme = VISEME_SEQUENCE[i % VISEME_SEQUENCE.length];
      const state = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
      state[viseme] = VISEME_VALUES[viseme];
      setMultipleExpressions(state);
      i++;
    }, 250);  // ~4Hz per UI-SPEC interaction states
    return () => clearInterval(interval);
  }, [enabled, setMultipleExpressions]);
}
```

**Container CSS (Pitfall 6 — transparent-background):** when `bgTransparent === true`, set `<Canvas gl={{ alpha: true }} style={{ background: 'transparent' }}>` and do NOT set `scene.background`; container div CSS `background: transparent`. Otherwise apply `bgColor` as container-div CSS background (cheaper than a three.js scene background).

---

### `packages/wp-bundle/src/mount.tsx` (MOD, component, live mount) — STUDIO-03/04/05

**Analog:** itself (existing `AvatarScene` + `mountAvatarInstance`, lines 54-84).

**Existing pattern to extend** (`mount.tsx:54-84`):
```tsx
function AvatarScene({ avatarUrl }: { avatarUrl: string }) {
  const isGlb = avatarUrl.toLowerCase().endsWith(".glb");
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
      <ambientLight intensity={1} />
      <directionalLight position={[10, 10, 5]} intensity={2.5} />
      {isGlb ? <GLBAvatar src={avatarUrl} /> : <VRMAvatar src={avatarUrl} />}
    </Canvas>
  );
}

export function mountAvatarInstance(root: Root, config: KhaveeAvatarConfig): void {
  const provider = new OpenAIRealtimeProvider({ useProxy: true, proxyEndpoint: config.restUrl, voice: config.voice, instructions: config.instructions, model: config.model });
  root.render(
    <KhaveeProvider config={{ realtime: provider }}>
      <div className="khaveeai-root">
        {config.avatarUrl ? <AvatarScene avatarUrl={config.avatarUrl} /> : null}
        <ClickToTalkOverlay />
        <ErrorOverlay />
      </div>
    </KhaveeProvider>
  );
}
```

**Extend** (RESEARCH.md Pattern 2 + 4):
1. `AvatarScene` becomes config-driven: apply `lightIntensity`, `avatarScale`, `avatarOffsetX/Y`, `cameraPreset` (use `resolveSceneDefaults(config)` from `config.ts`). Optionally share `PreviewScene` between view + preview via a prop; or keep `AvatarScene` (view-only) as-is and only add config fields. **Lip-sync on the published page is automatic** — no new lip-sync code: `useRealtime`'s existing effect (`useRealtime.ts:43-127`) wires `onAudioData → RealtimeAudioAnalyzer → setMultipleExpressions → VRMAvatar`. Just ensure `VRMAvatar` is inside `KhaveeProvider` (it already is).
2. `mountAvatarInstance` adds `{config.chatShow && <ChatBox placement={config.chatPlacement ?? "beside"} />}` sibling to `<AvatarScene>`.
3. **The lip-sync path runs through `useRealtime()`**, which `ChatBox` will also consume. **Text chat reuses the same realtime session** — do NOT open a second connection (UI-SPEC interaction states).

---

### `packages/wp-bundle/src/ui/ChatBox.tsx` (NEW component, chat UI) — STUDIO-03

**Analog:** khavee-app `apps/web/src/components/settings/preview/ChatBox.tsx` (175 lines, full reference).

**khavee-app patterns to LIFT** (interaction-only — re-author dependency-free, no HeroUI/lucide):

| Pattern | khavee-app source line | What to keep |
|---------|------------------------|--------------|
| Enter sends, Shift+Enter newline | `ChatBox.tsx:57-62` (`handleKeyPress`) | verbatim logic |
| Auto-scroll-to-bottom on new message | `ChatBox.tsx:41-48` (`scrollToBottom` via `lastElementChild.scrollIntoView`) | verbatim |
| Pinned-to-bottom rule (don't yank if scrolled up) | RESEARCH Pattern 4 | NEW: check `scrollHeight - scrollTop - clientHeight < threshold` before scrolling |
| User bubble right-aligned accent bg, assistant left-aligned neutral | `ChatBox.tsx:118-133` | keep alignment + bg-asymmetry (strongest speaker-turn signal per UI-SPEC §Color) |
| Empty state when `!isConnected` | `ChatBox.tsx:96-114` | keep — but **swap "Connect to AI" button for helper text** (UI-SPEC: WP connection is always initiated by the existing ClickToTalkOverlay, ChatBox must not host a competing connect affordance) |

**Deviation from khavee-app** (UI-SPEC §Copywriting):
- Header text: `"AI Assistant"` (not `"Khavee AI Assistant"`) — white-label.
- Empty/disconnected state: helper text `"Click the avatar to start, then type here."` (no Connect button).
- **Plain-text-only assistant messages** (UI-SPEC: "no markdown rendering, no HTML injection") — React auto-escapes, so just render `{msg.text}`.

**Wiring** (consume `useRealtime`, not local state — RESEARCH Pattern 4 / Don't Hand-Roll):
```tsx
import { useRealtime } from "@khaveeai/react";

export function ChatBox({ placement }: { placement: "beside" | "below" }) {
  const { conversation, sendMessage, chatStatus, isConnected } = useRealtime();
  // conversation is already { role, text }[] — matches khavee-app's prop shape exactly
  // ...
}
```
`conversation` from `useRealtime` is already `{role, text}[]` (per `useRealtime.ts:24` state + `Conversation` type from `@khaveeai/core`) — no shape conversion needed.

**CSS** (UI-SPEC §Color + §Spacing tokens): user bubble bg `#2271b1`, assistant bubble bg `rgba(255,255,255,0.92)` (light) / `rgba(30,30,30,0.92)` (dark) via `prefers-color-scheme`; bubble inner padding 16px (md); gap between bubbles 8px (sm); send button min-height 44px (touch-target floor); inline SVG paper-plane icon (UI-SPEC §Design System — "single inline SVG, no icon library").

---

### `packages/wp-bundle/styles.css` (MOD, declarative) — STUDIO-03

**Analog:** itself (existing `.khaveeai-*` classes, lines 11-67).

**Existing token references** (`styles.css:38-49`):
```css
.khaveeai-cta-button {
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  min-height: 44px;          /* ← touch-target floor — carry into ChatBox send button */
  background: #2271b1;        /* ← accent token — reuse for user bubble + send button */
  /* ... */
}
```

**Add classes for:** ChatBox card (translucent panel `rgba(255,255,255,0.92)` / `rgba(30,30,30,0.92)` via `prefers-color-scheme`), message bubbles (user=accent right-aligned, assistant=neutral left-aligned), input row, editor-preview banner (translucent panel, title+subtitle). All values from UI-SPEC §Color + §Spacing. Keep `font-family: inherit` on every text node (UI-SPEC §Design System).

---

## Shared Patterns

### Config transport pipeline (STUDIO-05) — applies to ALL PHP + bundle files

**Source:** end-to-end pipeline verified in `AvatarRenderer.php:54-95` + `wp-bundle/src/index.ts:19-39`.

```text
block.json attrs (camelCase, blank default)
   ↓ AvatarBlock::render_callback (resolve bgImageId → URL, cast types, safe-filter)
$renderer_atts (snake_case)
   ↓ wp_parse_args( $atts, WpOptionsConfigSource::get_runtime_config() )
$merged
   ↓ AvatarRenderer::public_safe() whitelist + camelCase translation
JSON object
   ↓ esc_attr( wp_json_encode( ... ) )   [existing, line 93]
data-khaveeai-config="..." on mount <div>
   ↓ JSON.parse in wp-bundle/src/index.ts:29  (and preview.ts)
KhaveeAvatarConfig (TS interface)
   ↓ resolveSceneDefaults() in config.ts
applied to <Canvas>, <VRMAvatar>, container div CSS, ChatBox
```
**Every new key rides this pipeline unchanged.** The only additive work per layer is documented in the assignments above.

### IIFE-mount entry pattern — applies to BOTH `src/index.ts` (view) and `src/preview.ts` (new)

**Source:** `packages/wp-bundle/src/index.ts:19-45`.

```typescript
function mountAll(): void {
  const roots = document.querySelectorAll<HTMLElement>("[data-khaveeai-config]");  // ← swap attribute for preview
  roots.forEach((el) => {
    if (el.dataset.khaveeaiMounted === "true") return;                              // idempotency (Pitfall 3)
    el.dataset.khaveeaiMounted = "true";
    let config: KhaveeAvatarConfig;
    try { config = JSON.parse(el.dataset.khaveeaiConfig ?? "{}") as KhaveeAvatarConfig; }
    catch { return; }                                                               // per-element graceful fail
    const root = createRoot(el);
    mountAvatarInstance(root, config);
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll);
} else { mountAll(); }
```
Preview entry mirrors this exactly with attribute `data-khaveeai-preview-config` and mount fn `mountEditorPreview`.

### WP-component createElement pattern (no JSX) — applies to ALL `editor.js` changes

**Source:** `editor.js:28-44, 71-143`.

`editor.js` is built by `@wordpress/scripts` webpack which externalizes all `@wordpress/*` to `window.wp.*`. Uses `createElement` (not JSX) and `__()` for i18n. Every new control follows the `createElement( Control, { label: __( '...', 'khaveeai' ), value, onChange } )` shape exactly. **Never** import `react` or `react-dom` in `editor.js` — it would defeat the externalization (Pitfall 2 analog).

### SDK lip-sync reuse path (STUDIO-04, published only) — applies to `mount.tsx` only

**Source:** `packages/react/src/hooks/useRealtime.ts:43-127`.

The full lip-sync chain runs automatically once the view entry constructs `OpenAIRealtimeProvider` + wraps `VRMAvatar` in `KhaveeProvider`:
```text
provider.onAudioData(analyser, audioContext)                      [useRealtime.ts:80-90]
  → RealtimeAudioAnalyzer (MFCC/DTW, lazily constructed)          [useRealtime.ts:184-210]
  → setMultipleExpressions({ aa, ih, ou, ee, oh })                [useRealtime.ts:61, 73]
  → VRMAvatar expression blend shapes per frame
```
**No new lip-sync code on the published page** — Phase 9 work is purely: ensure the view entry still constructs the provider (it does, unchanged) and `VRMAvatar` is inside `KhaveeProvider` (it is). RESEARCH Pattern 2 verifies this end-to-end.

### AssetManager enqueue shape — applies to preview-bundle registration

**Source:** `wordpress-plugin/includes/Assets/AssetManager.php:47-73`.

```php
public function enqueue(): void {
    if ( wp_script_is( self::HANDLE, 'enqueued' ) ) return;     // idempotent
    $bundle_path = plugin_dir_path( KHAVEEAI_PLUGIN_FILE ) . 'build/khaveeai-bundle.js';
    $version = file_exists( $bundle_path ) ? (string) filemtime( $bundle_path ) : KHAVEEAI_VERSION;
    wp_enqueue_script(
        self::HANDLE,
        plugins_url( 'build/khaveeai-bundle.js', KHAVEEAI_PLUGIN_FILE ),
        array(),                                                  // ← deliberately empty (D-10 full isolation)
        $version,
        array( 'in_footer' => true )
    );
    // ... parallel wp_enqueue_style for the CSS ...
}
```
For the preview bundle, register a parallel handle (e.g. `khaveeai-preview`) pointing at `build/khaveeai-preview.js`. **Critical:** the preview bundle must be enqueued ONLY via `enqueue_block_editor_assets` (editor-only), NEVER via `wp_enqueue_scripts` (Pitfall 5). The view bundle's existing path (`AssetManager::enqueue()` called only from `AvatarRenderer::render()` which only runs on published pages) stays unchanged.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every Phase-9 file has a concrete analog. This is a wiring-heavy phase; the closest existing pattern is reproduced above for each file. |

The two genuinely NEW pieces of logic (not direct lifts) are:
1. **The `array_filter` safe callback** in `AvatarBlock.php` (existing `'' !== $v` must become type-aware to preserve `0`/`0.0` — RESEARCH Pitfall/Code-Examples gives the exact replacement).
2. **The Preview-talking viseme `setInterval` loop** in `PreviewScene.tsx` (no existing setInterval viseme cycler in either repo — RESEARCH.md Code Examples provides the design; viseme keys `aa/ih/ou/ee/oh` verified against `useRealtime.ts:61, 73`).

Everything else is extension/mirroring of an existing file.

---

## Metadata

**Analog search scope:**
- khavee-sdk: `wordpress-plugin/{src,includes,assets}/**`, `packages/wp-bundle/**`, `packages/react/src/{KhaveeProvider.tsx,VRMAvatar.tsx,hooks/useRealtime.ts,hooks/useAudioLipSync.ts,index.ts}`
- khavee-app: `apps/web/src/components/settings/preview/{ChatBox.tsx,PreviewModel.tsx,BackgroundPanel.tsx}`, `apps/web/src/app/[locale]/projects/[id]/settings/steps/Preview.tsx`

**Files scanned:** 18 analog files across 2 repos
**Pattern extraction date:** 2026-06-26

**Cross-references for the planner:**
- RESEARCH.md Open Questions 1–3 (editor-iframe enqueue mechanism, `KhaveeProvider` null-realtime acceptance — **VERIFIED here**: `KhaveeProvider.tsx:53-58, 93-95` accepts null config; preview must wrap in `<KhaveeProvider>` with no `config` prop and call `useVRMExpressions` but NOT `useRealtime`)
- RESEARCH.md Pitfalls 1–6 (all mapped to concrete assignment mitigations above)
- UI-SPEC.md §Copywriting (every inspector label + bundle string is locked — assignments reference, do not re-derive)
