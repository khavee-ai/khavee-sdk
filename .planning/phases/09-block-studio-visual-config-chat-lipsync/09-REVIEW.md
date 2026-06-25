---
phase: 09-block-studio-visual-config-chat-lipsync
reviewed: 2026-06-26T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - packages/wp-bundle/build.mjs
  - packages/wp-bundle/src/config.ts
  - packages/wp-bundle/src/mount.tsx
  - packages/wp-bundle/src/preview.ts
  - packages/wp-bundle/src/preview/PreviewScene.tsx
  - packages/wp-bundle/src/preview/mountPreview.tsx
  - packages/wp-bundle/src/ui/ChatBox.tsx
  - packages/wp-bundle/styles.css
  - wordpress-plugin/includes/Block/AvatarBlock.php
  - wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php
  - wordpress-plugin/includes/Plugin.php
  - wordpress-plugin/includes/Render/AvatarRenderer.php
  - wordpress-plugin/includes/Block/block.json
  - wordpress-plugin/src/editor.js
findings:
  critical: 3
  warning: 5
  info: 5
  total: 13
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-06-26
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 9 implements the Block Studio visual-config and editor-preview subsystem. The PHP escaping and STUDIO-02 isolation work correctly: no secret credentials leak into HTML, `wp_json_encode` + `esc_attr` properly double-encodes the config JSON, and the built `khaveeai-preview.js` contains none of the forbidden identifiers (`RealtimeProvider`, `getUserMedia`, `ephemeral`). The MutationObserver → React state push approach for preview updates is architecturally sound.

However, three blockers mean the core deliverable does not function at all for freshly placed blocks: (1) the editor preview crashes with a TypeError on any block with a default `cameraPreset`, (2) the editor preview permanently shows "No avatar selected" because the avatar URL is never passed to the preview bundle, and (3) all newly placed blocks on published pages render with a completely dark scene and invisible avatar because the sentinel-0 values for `lightIntensity` and `avatarScale` are never filtered out before overriding the admin defaults.

---

## Critical Issues

### CR-01: `resolveSceneDefaults` crashes with TypeError for all new blocks in the editor

**File:** `packages/wp-bundle/src/config.ts:146-154`

**Issue:** `block.json` sets `cameraPreset` default to `""`. When `editor.js` builds `previewConfig` it includes `cameraPreset: ""`. In `resolveSceneDefaults()`:

```typescript
const preset = c.cameraPreset ?? "front";   // "" ?? "front" === ""  ← nullish coalescing
//                                             does NOT catch empty string
...
cameraPosition: CAMERA_PRESETS[preset].position,  // CAMERA_PRESETS[""] is undefined
cameraTarget:   CAMERA_PRESETS[preset].target,    // undefined.position → TypeError
```

`??` guards against `null`/`undefined` only. The empty string falls through and `CAMERA_PRESETS[""]` is `undefined`, so accessing `.position` throws. The same crash occurs for any unrecognised `cameraPreset` value (e.g., from a manual block-metadata edit). There is no React error boundary in `PreviewScene.tsx`, so the TypeError propagates to the React root and crashes the entire Gutenberg page script for any block with a default or invalid `cameraPreset`. Because `""` is the block.json default, **every newly inserted block crashes the editor preview on mount.**

The view bundle (`mount.tsx`) is safe only because PHP's `AvatarRenderer::render()` already coerces `""` → `"front"` before emitting the JSON. The preview bundle has no such PHP-side guard.

**Fix:**

```typescript
// packages/wp-bundle/src/config.ts  — resolveSceneDefaults()
const rawPreset = c.cameraPreset;
const preset: CameraPreset =
  rawPreset && rawPreset in CAMERA_PRESETS
    ? (rawPreset as CameraPreset)
    : "front";
```

---

### CR-02: Sentinel-0 for `lightIntensity` and `avatarScale` overrides admin defaults — dark scene and invisible avatar on all new blocks

**File:** `wordpress-plugin/includes/Block/AvatarBlock.php:100-101`

**Issue:** `block.json` uses `0` as the "use admin default" sentinel for numeric attributes including `lightIntensity` and `avatarScale`. The `render_callback` comment correctly states the intent: *"the render_callback applies the real default so `wp_parse_args` receives a meaningful value to merge."* But the code does not implement this intent:

```php
// AvatarBlock.php:100-101
'light_intensity' => isset( $attributes['lightIntensity'] ) ? (float) $attributes['lightIntensity'] : 1.0,
'avatar_scale'    => isset( $attributes['avatarScale'] )    ? (float) $attributes['avatarScale']    : 1.0,
```

`isset( 0 )` is `true`. So for a new block where `lightIntensity = 0` (block.json default), the code produces `(float) 0 = 0.0`. The `array_filter` callback at line 113–122 explicitly preserves all numeric values (including `0.0`) to avoid stripping valid zero offsets. Consequently `wp_parse_args(['light_intensity' => 0.0], ['light_intensity' => 1.0])` picks the first argument — the block's `0.0` wins over the admin's `1.0`.

In `config.ts:resolveSceneDefaults()`:
```typescript
lightIntensity: c.lightIntensity ?? LIGHT_INTENSITY.default
// 0 ?? 1.0  ===  0   ← again, ?? does not catch 0
```

End result: `lightIntensity = 0` (completely dark scene) and `avatarScale = 0` (`uniformScale = [0,0,0]`, avatar invisible) for **every block placed with default attributes**, until the editor explicitly drags the slider off zero.

`avatarOffsetX` and `avatarOffsetY` with default 0 are not affected — 0 is the correct physical centre for those fields.

**Fix in AvatarBlock.php:** Only pass the attribute value when it is a meaningful non-zero:

```php
// AvatarBlock.php  — inside render_callback, $renderer_atts build
'light_intensity' => ( isset( $attributes['lightIntensity'] ) && $attributes['lightIntensity'] > 0 )
    ? (float) $attributes['lightIntensity']
    : 0,          // keep 0 here; array_filter will drop it so wp_parse_args falls back to admin default

'avatar_scale'    => ( isset( $attributes['avatarScale'] ) && $attributes['avatarScale'] > 0 )
    ? (float) $attributes['avatarScale']
    : 0,
```

Alternatively, change the `array_filter` callback to strip `0.0` for these two specific keys (using the already-passed `$k` argument):

```php
static function ( $v, $k ) {
    if ( in_array( $k, [ 'light_intensity', 'avatar_scale' ], true ) ) {
        return (float) $v > 0;   // 0 = sentinel → drop so wp_parse_args uses default
    }
    if ( is_string( $v ) ) {
        return '' !== $v;
    }
    return true;
},
```

And apply the same fix in `config.ts:resolveSceneDefaults()` so the JS-side preview also falls back correctly:

```typescript
lightIntensity: (c.lightIntensity != null && c.lightIntensity > 0)
    ? c.lightIntensity
    : LIGHT_INTENSITY.default,
avatarScale: (c.avatarScale != null && c.avatarScale > 0)
    ? c.avatarScale
    : 1.0,
```

---

### CR-03: `previewConfig` in `editor.js` omits `avatarUrl` and `bgImageUrl` — editor preview permanently shows "No avatar selected"

**File:** `wordpress-plugin/src/editor.js:182-201`

**Issue:** The `previewConfig` JSON that `editor.js` writes into `data-khaveeai-preview-config` includes only the raw Gutenberg block attribute values, which store attachment IDs:

```javascript
const previewConfig = JSON.stringify({
    ...
    avatar,        // integer attachment ID — e.g. 42
    bgImageId,     // integer attachment ID
    ...
    // avatarUrl and bgImageUrl are ABSENT
});
```

The preview bundle (`PreviewScene.tsx`) operates on `KhaveeAvatarConfig`, which has `avatarUrl?: string` (a URL) and `bgImageUrl?: string`. There is no `avatar: number` field in that interface. When the preview bundle parses the JSON, `config.avatarUrl` is `undefined`.

`PreviewScene.tsx:165` checks:
```typescript
{config.avatarUrl && ( isGlb ? <GLBAvatar ...> : <VRMAvatar ...> )}
```

`config.avatarUrl` is always `undefined` → the avatar block never renders → the "No avatar selected" empty-state placeholder is shown instead, **for every block regardless of which avatar is configured.** Background images are equally invisible because `bgImageUrl` is absent from `previewConfig`.

The PHP path works correctly because `AvatarBlock::render_callback()` calls `wp_get_attachment_url( (int) $attributes['avatar'] )` to resolve the ID to a URL. The editor JS has no equivalent resolution.

**Fix:** In `editor.js`, resolve the attachment ID to a URL using Gutenberg's `useSelect` hook from `@wordpress/data`:

```javascript
import { useSelect } from '@wordpress/data';

// inside Edit():
const avatarMedia    = useSelect( ( select ) => avatar    ? select( 'core' ).getMedia( avatar )    : null, [ avatar ] );
const bgImageMedia   = useSelect( ( select ) => bgImageId ? select( 'core' ).getMedia( bgImageId ) : null, [ bgImageId ] );

const resolvedAvatarUrl  = avatarMedia?.source_url   ?? '';
const resolvedBgImageUrl = bgImageMedia?.source_url  ?? '';

const previewConfig = JSON.stringify({
    ...
    avatarUrl:  resolvedAvatarUrl,
    bgImageUrl: resolvedBgImageUrl,
    // keep avatar / bgImageId as well for reference
    avatar,
    bgImageId,
    ...
});
```

---

## Warnings

### WR-01: Unquoted URL in CSS `backgroundImage` breaks files with parentheses in their names

**File:** `packages/wp-bundle/src/mount.tsx:139` and `packages/wp-bundle/src/preview/PreviewScene.tsx:126`

**Issue:**

```typescript
containerStyle.backgroundImage = `url(${config.bgImageUrl})`;
```

The CSS `url()` function requires quoting when the URL contains parentheses, spaces, or certain other characters. A media file named `avatar(1).jpg` (which is legal in the WordPress Media Library) produces:

```css
background-image: url(https://site.com/wp-content/uploads/avatar(1).jpg)
```

The unmatched `)` terminates the `url()` call early; the browser silently ignores the invalid value and the background image is never displayed.

**Fix:**

```typescript
containerStyle.backgroundImage = `url("${config.bgImageUrl}")`;
```

Apply in both `mount.tsx:139` and `PreviewScene.tsx:126`.

---

### WR-02: `window.confirm()` is blocked in sandboxed-iframe Gutenberg setups

**File:** `wordpress-plugin/src/editor.js:313`

**Issue:**

```javascript
if ( window.confirm( __( 'Remove background image and switch back to color?', 'khaveeai' ) ) ) {
    setAttributes( { bgImageId: 0, bgType: 'color' } );
}
```

Gutenberg can run inside an `<iframe sandbox>` in some hosting configurations. Browsers (notably Firefox and Chrome behind an `allow-modals`-absent sandbox attribute) block synchronous dialog APIs (`confirm`, `alert`, `prompt`) in sandboxed iframes; the call returns `false` silently. In that context the "Remove" button fires but the `confirm` always returns false, preventing the removal. Authors see a button that appears broken.

**Fix:** Replace with Gutenberg's `@wordpress/components` `ConfirmDialog` or a `Button` + `Modal` composition:

```javascript
import { Modal, Button } from '@wordpress/components';
// manage local state: const [showConfirm, setShowConfirm] = useState(false);
// render: <ConfirmDialog ... onConfirm={() => { setAttributes({bgImageId:0,bgType:'color'}); setShowConfirm(false); }} />
```

---

### WR-03: Safety assertion `/RealtimeProvider/` is ineffective against minified bundle output

**File:** `packages/wp-bundle/build.mjs:62`

**Issue:**

```javascript
const FORBIDDEN = [/RealtimeProvider/, /getUserMedia/, /ephemeral/];
```

`build.mjs` sets `minify: true` for both entries. esbuild's identifier minification renames class and function identifiers to short tokens (`RealtimeProvider` → `X` or `O` etc.). If `OpenAIRealtimeProvider` were ever accidentally pulled in via a transitive import, the minified bundle would not contain the literal string `RealtimeProvider`, so the grep check would pass while the unsafe code is present.

`getUserMedia` (a browser property name accessed via `navigator.mediaDevices.getUserMedia`) and `ephemeral` (appears in string literals, e.g. token endpoint paths) are NOT minified by esbuild and those two checks remain effective.

The structural import isolation (preview entry never imports `@khaveeai/providers-openai-realtime`) is correctly stated as the primary defense; this is a secondary check that is partially broken for the class-name pattern.

**Fix:** Add a comment clarifying the limited scope of the `RealtimeProvider` grep, or switch to checking for the module path string instead:

```javascript
const FORBIDDEN = [
  /providers-openai-realtime/,  // module path survives minification; class name does not
  /getUserMedia/,
  /ephemeral/,
];
```

---

### WR-04: Return value of `mountEditorPreview()` is discarded — MutationObserver leaks when block is deleted

**File:** `packages/wp-bundle/src/preview.ts:45`

**Issue:**

```typescript
mountEditorPreview(root, config, el);   // return value { unmount } is discarded
```

`mountEditorPreview()` returns `{ unmount: () => void }` specifically so callers can trigger `root.unmount()` during cleanup. When a block is deleted in the Gutenberg editor, the host `<div>` is removed from the DOM, but the React root is never unmounted and the `MutationObserver` inside `PreviewHost` is never disconnected (its `useEffect` cleanup only runs on React component unmount, which requires an explicit `root.unmount()` call). This leaves a live `MutationObserver` observing a detached DOM node for the lifetime of the editor session.

**Fix:**

```typescript
// preview.ts — inside roots.forEach()
const { unmount } = mountEditorPreview(root, config, el);

// Register cleanup when the host element is removed from the DOM:
new MutationObserver(() => {
  if (!document.contains(el)) {
    unmount();
    cleanupObserver.disconnect();
  }
}).observe(document.body, { childList: true, subtree: true });
// assign to variable so it can be disconnected
const cleanupObserver = ...; // refactor to capture reference
```

Or use a simpler `disconnect`-on-body-change pattern scoped to the `el` identity.

---

### WR-05: Debounce timeouts not cancelled on component unmount

**File:** `wordpress-plugin/src/editor.js:169-175`

**Issue:**

```javascript
function debouncedAttr( key, value ) {
    setLive( ( prev ) => ( { ...prev, [ key ]: value } ) );
    clearTimeout( debounceRef.current[ key ] );
    debounceRef.current[ key ] = setTimeout( () => {
        setAttributes( { [ key ]: value } );
    }, 50 );
}
```

If the block is deleted while a debounce timer is still pending (e.g., user drags a slider and immediately deletes the block within 50 ms), the `setTimeout` callback fires and calls `setAttributes` after the component has been unmounted. In Gutenberg this triggers a React warning and may cause state inconsistencies in the undo stack.

**Fix:** Add a `useEffect` cleanup to cancel all pending timers:

```javascript
useEffect( () => {
    return () => {
        Object.values( debounceRef.current ).forEach( clearTimeout );
    };
}, [] );
```

---

## Info

### IN-01: `ARRAY_FILTER_USE_BOTH` passed but `$k` is never used in the callback

**File:** `wordpress-plugin/includes/Block/AvatarBlock.php:113-122`

**Issue:** The `array_filter` callback accepts `($v, $k)` (two parameters) via `ARRAY_FILTER_USE_BOTH`, but `$k` is never referenced inside the function body. `ARRAY_FILTER_USE_VALUE` is sufficient and makes the intent clearer.

**Fix:**

```php
$renderer_atts = array_filter(
    $renderer_atts,
    static function ( $v ) {
        if ( is_string( $v ) ) {
            return '' !== $v;
        }
        return true;
    }
);
```

(Note: if CR-02 is fixed by inspecting `$k` to drop zero for specific keys, `ARRAY_FILTER_USE_BOTH` becomes genuinely needed — apply that fix first.)

---

### IN-02: `key={i}` (array index) used for conversation bubbles

**File:** `packages/wp-bundle/src/ui/ChatBox.tsx:101`

**Issue:**

```tsx
{conversation.map((msg, i) => (
    <div key={i} className={`...`}>
```

React discourages index keys for lists that can mutate. If the `conversation` array ever has items prepended or removed from the middle (e.g., due to a trimHistory call that removes from the front), stale DOM state may be associated with the wrong message.

**Fix:** Use a stable per-message identifier if one exists in the `Conversation` type (e.g., `msg.id`). If no stable ID exists, this is acceptable for append-only transcripts but the ID field should be added to the type.

---

### IN-03: `handleSend` and `handleKeyDown` are not memoized

**File:** `packages/wp-bundle/src/ui/ChatBox.tsx:48-64`

**Issue:** Both handlers are plain function declarations inside the component body, creating new references on every render. They are passed to `<textarea onKeyDown>` and `<button onClick>` — both DOM elements that do not forward props to child components — so the performance impact is negligible. However, the project convention (from CLAUDE.md) for hot-path handlers is `useCallback`.

**Fix:** Wrap with `useCallback`:

```typescript
const handleSend = useCallback(() => { ... }, [input, isConnected, sendMessage]);
const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => { ... }, [handleSend]);
```

---

### IN-04: Three copies of `block.json` that must be kept in sync manually

**Files:** `wordpress-plugin/src/block.json`, `wordpress-plugin/includes/Block/block.json`, `wordpress-plugin/assets/block.json`

**Issue:** All three files are currently identical. `src/block.json` is the source consumed by `editor.js`. `includes/Block/block.json` is consumed by `register_block_type(__DIR__)` on the PHP side. `assets/block.json` is the `@wordpress/scripts` build output. If a new attribute is added to `src/block.json` but not to `includes/Block/block.json` (or vice versa), the PHP block registration and the Gutenberg JS registration will have different attribute schemas, causing silent data loss for the undeclared attribute.

**Fix:** Establish `src/block.json` as the single source of truth and add a build step that copies it to `includes/Block/block.json`. Alternatively, use `register_block_type( plugin_dir_path( KHAVEEAI_PLUGIN_FILE ) . 'assets' )` so PHP reads the already-copied assets version.

---

### IN-05: `chatPlacement` `SelectControl` has no "(using global default)" escape hatch

**File:** `wordpress-plugin/src/editor.js:99-102`

**Issue:**

```javascript
const CHAT_PLACEMENT_OPTIONS = [
    { label: __( 'Beside avatar', 'khaveeai' ), value: 'beside' },
    { label: __( 'Below avatar', 'khaveeai' ), value: 'below' },
];
```

The block attribute default for `chatPlacement` is `""` (meaning "use admin default"). Once an author changes the control away from the visual default (which shows "Beside avatar" because `""` is not in the list), there is no way to restore the `""` sentinel value — the options only offer explicit values. Every other selector that has a global-default concept (voice, cameraPreset, bgType) includes a `{ label: '(using global default)', value: '' }` option.

**Fix:**

```javascript
const CHAT_PLACEMENT_OPTIONS = [
    { label: __( '(using global default)', 'khaveeai' ), value: '' },
    { label: __( 'Beside avatar', 'khaveeai' ), value: 'beside' },
    { label: __( 'Below avatar', 'khaveeai' ), value: 'below' },
];
```

---

_Reviewed: 2026-06-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
