# Phase 9: Block Studio — Visual Config, Live Preview, Chat & Lip-Sync - Research

**Researched:** 2026-06-25
**Domain:** WordPress Gutenberg block + React/three.js IIFE bundle + SDK lip-sync reuse
**Confidence:** HIGH

## Summary

Phase 9 extends the Phase-8 `khaveeai/avatar` Gutenberg block from a static placeholder into a fully styleable, previewable, chat-enabled block. The work splits cleanly across three already-distinct build targets that already exist in the repo and must remain isolated: (1) the `wordpress-plugin/src/editor.js` inspector (built by `@wordpress/scripts` webpack, which **externalizes** all `@wordpress/*` to `window.wp.*` and never bundles React/three), (2) the `packages/wp-bundle` esbuild IIFE (which **bundles everything inline** — React, three, @khaveeai/react, OpenAIRealtimeProvider), and (3) the PHP backend (`AvatarBlock.php`, `AvatarRenderer.php`, `WpOptionsConfigSource.php`) that owns the `data-khaveeai-config` JSON contract.

The single most important architectural finding is that **Part B's "safe preview" is achieved by entry-point isolation at the esbuild level**, not by runtime feature-detection. The existing `src/index.ts` mounts the live SPA by directly importing and constructing `OpenAIRealtimeProvider`. The new preview-mode entry (`src/preview.ts` or `src/index-preview.ts`) must be a **separate esbuild entry point** that imports `@khaveeai/react` (`VRMAvatar`, `useVRMExpressions`) and `@react-three/fiber` (`Canvas`) but **statically never imports `@khaveeai/providers-openai-realtime`**. Because esbuild tree-shakes per entry, the preview bundle is physically incapable of reaching the mic/WebRTC/token code — the safety property is enforced by the bundler graph, not by a flag. This mirrors exactly how `editor.js` already guarantees "no SPA imports" today (its file-header comment documents the same discipline).

The lip-sync and chat wiring is mostly **reuse, not new code**. The SDK already ships the full lip-sync path (`useRealtime` → `RealtimeAudioAnalyzer` → `getAudioAnalyser()` → `setMultipleExpressions` on `VRMAvatar`), and `OpenAIRealtimeProvider` already implements `sendMessage(text)` for the text-chat path. The ChatBox component itself is new but small (khavee-app's `ChatBox.tsx` is 175 lines of HeroUI-flavored JSX; we re-author it dependency-free in `packages/wp-bundle/src/ui/ChatBox.tsx`). The config transport adds **zero new plumbing** — new keys ride the existing `block.json` attribute → `wp_parse_args` merge → `public_safe()` whitelist → `data-khaveeai-config` JSON → bundle parse pipeline. The khavee-app reference repo yields four concrete values to lift verbatim: the four camera-preset position/target vectors, the 0–2 light-intensity range, the bg color/image/transparent structure, and the ChatBox interaction shape (Enter-to-send, shift+Enter newline, pinned-to-bottom scroll).

**Primary recommendation:** Build the preview as a separate esbuild entry (`src/preview/index.tsx`) that shares a config-driven `<PreviewScene>` component with the view path but **does not import the realtime provider**; add the new ChatBox as a dependency-free bespoke component; extend `KhaveeAvatarConfig` with the new optional fields (all blank-defaulting to Phase-8 hardcoded scene values); and mirror khavee-app's camera presets and 0–2 light range exactly.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Part A — Inspector config controls (Tier 1 knob set, finalized).** EXACTLY these knobs in collapsible panels: Layout (container width px, height px, full-width toggle); Background (type Color|Image, color picker, transparent-background overlay toggle, Media Library image picker reusing existing avatar pattern); Lighting (intensity 0–2 default 1.0); Avatar (model VRM attachment already exists, scale slider, offset-X slider, offset-Y slider); Camera (PRESET DROPDOWN ONLY — Front/Left Angle/Right Angle/Wide, NO free-form XYZ); Voice & Behavior (existing voice select + instructions textarea, regrouped). Mutual exclusivity: transparent-background toggle disables color/image fields.

**Part B — Live editor preview (SAFE PREVIEW MODE).** Editor `edit()` must render a REAL visible avatar (live 3D VRM, subtle idle animation, all Part A config applied, WYSIWYG-reactive). **Hard safety constraint (non-negotiable): the editor preview must NEVER access the microphone or mint an OpenAI Realtime token.** Architecture (locked): a separate `editorScript` "preview mode" bundle entry that renders VRM + scene + config but wires NO realtime/mic/token. Existing `viewScript` keeps running the full live SPA on the published page. Block `edit()` uses this preview-mode render (NOT `ServerSideRender` of a static placeholder).

**Part C — ChatBox (explicit must-have — do not drop).** Configurable element: show/hide toggle + placement control (beside / below the avatar within the container). Visible and laid out in editor preview. Live/functional on published page (transcript scrollback + text input that drives the same realtime session as voice).

**Part D — Talking animation / lip-sync (explicit must-have — do not drop).** Reuse SDK's EXISTING lip-sync pipeline (`@khaveeai/react` `useAudioLipSync`, MFCC/DTW in `useRealtime.ts`, `VRMAvatar` expression/bone driving). Published page: lip-sync runs for real off TTS audio analyser. Editor preview: no-audio demo (e.g. "Preview talking" toggle that loops a sample talking animation).

**Config transport (locked — reuse existing plumbing).** All new visual/chat config flows through the EXISTING contract: new `block.json` attributes → merged over admin defaults via `wp_parse_args` in `AvatarBlock::render_callback` (or shared resolver) → escaped JSON in `data-khaveeai-config` on the mount-point `<div>` → consumed by frontend bundle. No new transport. New knobs follow the same global-default + per-block-override shape already used for voice/instructions/avatar.

### Claude's Discretion
- Internal module structure of `packages/wp-bundle/src/preview/` and `src/ui/` (ChatBox internals).
- Exact esbuild multi-entry configuration shape (two `entryPoints` vs two builds).
- Editor-preview "Preview talking" no-audio animation mechanism (setInterval viseme cycling vs sample analyser feed).
- ChatBox CSS class naming and light/dark theme implementation detail (only the tokens/contract are locked in UI-SPEC).

### Deferred Ideas (OUT OF SCOPE)
- Project visibility / share-link / "chatbox-on-share" settings (khavee-app Platform concepts; WP plugin is self-hosted Custom mode).
- Free-form camera XYZ / target XYZ controls (preset dropdown only).
- Custom `.fbx` motion file uploads (idle/speaking/thinking) — too heavy for this milestone.
- Any login/auth/billing UI.
- `khavee-app` platform/backend changes of any kind (separate repo).
- Settings-page admin UI for the new global defaults (defaults must EXIST in `WpOptionsConfigSource::get_runtime_config()` but the admin form fields for them are out of scope this phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STUDIO-01 | Inspector exposes Tier-1 visual/layout controls (width/height/full-width, bg color/image/transparent, lighting intensity, avatar scale + X/Y offset, camera preset) in collapsible panels, each overriding admin default per-instance | `## Architecture Patterns → Pattern 3` (InspectorControls + PanelBody), `## Code Examples → Inspector panel`; backend merge path in `Pattern 5`; camera presets + ranges lifted from khavee-app in `## State of the Art` |
| STUDIO-02 | Block editor renders a live 3D VRM preview, WYSIWYG-reactive, NEVER mic/token while editing | `## Architecture Patterns → Pattern 1` (entry-point isolation), `## Don't Hand-Roll`, `## Common Pitfalls → Pitfall 1` (the critical safety property) |
| STUDIO-03 | Configurable ChatBox (show/hide + placement), visible in editor preview, functional on published page | `## Architecture Patterns → Pattern 4` (ChatBox), `## Code Examples → ChatBox wiring`; khavee-app `ChatBox.tsx` interaction shape lifted |
| STUDIO-04 | Avatar exhibits SDK-driven lip-sync on published page; demonstrable in editor without audio | `## Architecture Patterns → Pattern 2` (lip-sync reuse), `## Code Examples → Preview talking loop`; `useRealtime.ts` path verified |
| STUDIO-05 | All new config flows through existing `data-khaveeai-config` JSON contract via existing merge — no new transport, no khavee-app backend | `## Architecture Patterns → Pattern 5` (config transport), backend file-by-file changes in `## Code Examples` |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Visual config controls (sliders/pickers) | WP Inspector (`editor.js`) | — | Native Gutenberg UX; site-owner-facing authoring surface. Built with `@wordpress/components` externalized to `window.wp.*`. |
| Per-instance attribute persistence | WP DB (block attributes) | — | Gutenberg's native post-meta attribute storage. |
| Global-default merge + JSON emission | PHP backend (`AvatarRenderer`) | `WpOptionsConfigSource` | STUDIO-05 locks this to the existing server-side contract. |
| Live 3D VRM preview render | Bundle (preview entry) | Editor iframe | Runs inside the editor iframe; entry-point isolation guarantees safety (STUDIO-02). |
| Full live SPA (mic + realtime + TTS) | Bundle (view entry) | Published page only | Phase-8 `viewScript` path, untouched on the editor side. |
| Text chat UI (transcript + input) | Bundle (both entries) | — | ChatBox chrome authored once in `src/ui/ChatBox.tsx`, rendered in both preview (disconnected state) and published (live). |
| Lip-sync (real, off TTS audio) | SDK (`@khaveeai/react`) | Bundle view entry | Reuses `useRealtime` + `RealtimeAudioAnalyzer`. Preview entry never runs this path. |
| Lip-sync demo (no audio, editor) | Bundle preview entry | — | New `setInterval` viseme-cycling loop driving `setMultipleExpressions` directly. |
| Text → realtime session send | SDK (`OpenAIRealtimeProvider.sendMessage`) | Bundle view entry | `sendMessage(text)` already exists on `RealtimeProvider`. |

## Standard Stack

### Core (all already in repo — no new packages installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@wordpress/components` | WP core (≥6.3) | Inspector controls: `PanelBody`, `RangeControl`, `SelectControl`, `ToggleControl`, `ColorPalette`, `MediaUpload`, `TextControl` | Native Gutenberg building blocks; pre-styled, externalized via `@wordpress/scripts` webpack to `window.wp.*`. [CITED: developer.wordpress.org/block-editor/reference-guides/components/] |
| `@wordpress/block-editor` | WP core | `InspectorControls`, `useBlockProps`, `MediaUpload`, `MediaUploadCheck` | Standard for inspector + block-DOM integration. [CITED: developer.wordpress.org/block-editor/reference-guides/block-api/] |
| `@wordpress/scripts` | `^32.5.0` (already in `wordpress-plugin/package.json`) | webpack build of `editor.js` → `assets/editor.js` | Phase 8 chose this; externalizes all `@wordpress/*` imports. No change this phase. |
| esbuild | `^0.28.1` (already in `packages/wp-bundle`) | IIFE bundling of the SPA bundle(s) | Phase 8's locked choice (D-10 full isolation). Phase 9 extends `build.mjs` to emit a second entry. |
| `@react-three/fiber` | `^9.3.0` (already a wp-bundle dep) | `<Canvas>` React renderer for three.js | Used by both the live `AvatarScene` and the new preview scene. |
| `@khaveeai/react` | `workspace:*` (in-repo) | `KhaveeProvider`, `VRMAvatar`, `GLBAvatar`, `useVRMExpressions`, `useRealtime` | The lip-sync + avatar render primitives. Imported by BOTH bundle entries. |
| `@khaveeai/providers-openai-realtime` | `workspace:*` (in-repo) | `OpenAIRealtimeProvider` (mic + WebRTC + token) | Imported by the VIEW entry ONLY. The preview entry must NOT import it. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@wordpress/server-side-render` | WP core | Server-rendered block preview | **REMOVE** from the editor preview path (Phase 9 replaces the static placeholder). Keep available as a fallback if ever needed. |
| `react` / `react-dom` | `^19.1.0` | React runtime for the bundle | Already bundled inline by esbuild (D-10). Both entries share the same bundled copy via esbuild code-splitting. |
| `three` | (transitive via `@react-three/fiber`/`@khaveeai/react`) | WebGL scene graph | Pulled in by `VRMAvatar`/`GLBAvatar`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate esbuild entry for preview | Single entry with runtime `mode` flag | **REJECTED** — a runtime flag does NOT guarantee "no mic prompt"; the import graph still contains `OpenAIRealtimeProvider`, and any code path that constructs it fires mic/token. Entry-point isolation makes the guarantee structural. CONTEXT.md locks the separate-entry architecture. |
| `viewScript` field in block.json for the live bundle | `AssetManager::enqueue()` PHP-side (current) | **KEEP CURRENT** — `viewScript` only registers and has known enqueue quirks; the Phase-8 PHP-side conditional enqueue (PERF-01) is already correct and idempotent. Don't change what works. |
| `@wordpress/scripts` to build the preview bundle | esbuild (current wp-bundle toolchain) | **REJECTED** — `@wordpress/scripts` externalizes `react`/`three` to `window.*`, which the editor iframe does NOT provide. The preview bundle must be a self-contained IIFE just like the view bundle. |

**Installation:** No `npm install` / `pnpm add` needed. Every dependency is already present in the repo. The only "new" thing is a second esbuild `entryPoints` entry in `build.mjs`.

**Version verification:** All packages verified present in `packages/wp-bundle/package.json` and `wordpress-plugin/package.json` during this research session (esbuild `^0.28.1`, `@react-three/fiber` `^9.3.0`, `react` `^19.1.0`, `@wordpress/scripts` `^32.5.0`). No registry lookups needed — workspace / already-installed.

## Package Legitimacy Audit

> No external packages are installed this phase. All "stack" entries are either (a) WP core packages already present on every WP install (externalized, never bundled), (b) in-repo `@khaveeai/*` workspace packages, or (c) already-installed npm deps verified in `packages/wp-bundle/package.json` during this session.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none new) | — | — | — | — | — | N/A — Phase 9 adds zero new registry dependencies |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
                    ┌─────────────────────────────────────────────────────────────┐
                    │                AUTHOR IN WORDPRESS ADMIN                    │
                    │                                                             │
                    │  editor.js (webpack, @wordpress/scripts)                    │
                    │  ┌────────────────────┐    ┌────────────────────────────┐  │
                    │  │ InspectorControls   │    │ edit() render              │  │
                    │  │ - PanelBody ×6      │    │  <div data-khaveeai-       │  │
                    │  │   (Layout/BG/Light/ │    │         preview-config>    │  │
                    │  │    Avatar/Camera/   │    │        ↑mount point↑       │  │
                    │  │    Voice/Chat)      │    │  (no ServerSideRender)     │  │
                    │  │ - RangeControl      │    └─────────────┬──────────────┘  │
                    │  │ - SelectControl     │                  │                 │
                    │  │ - ColorPalette      │     preview-mode bundle entry      │
                    │  │ - MediaUpload       │     (esbuild IIFE, editorScript)   │
                    │  │ - ToggleControl     │     ┌─────────────▼──────────────┐ │
                    │  └────────────────────┘     │ <Canvas> + VRMAvatar        │ │
                    │           │                 │ + ambientLight/dirLight     │ │
                    │           │                 │ + idle anim                 │ │
                    │           │                 │ + (optional) Preview-talking│ │
                    │           │                 │   viseme loop               │ │
                    │           │                 │ ⚠️ NO OpenAIRealtimeProvider│ │
                    │           │                 │ ⚠️ NO mic, NO token mint    │ │
                    │           │                 └─────────────────────────────┘ │
                    │     setAttributes()                                         │
                    └──────────────────┬──────────────────────────────────────────┘
                                       │ (block attrs persisted to post content)
                                       ▼
                    ┌─────────────────────────────────────────────────────────────┐
                    │           PHP BACKEND (AvatarBlock::render_callback)        │
                    │                                                             │
                    │   block atts  ──┐                                           │
                    │                 ▼                                           │
                    │   wp_parse_args( $atts, WpOptionsConfigSource::defaults )   │
                    │                 │                                           │
                    │                 ▼                                           │
                    │   AvatarRenderer::public_safe()  ← whitelist (STUDIO-05)    │
                    │                 │                                           │
                    │                 ▼                                           │
                    │   <div data-khaveeai-config='{...escaped JSON...}'>         │
                    └──────────────────┬──────────────────────────────────────────┘
                                       │ (rendered into the published page HTML)
                                       ▼
                    ┌─────────────────────────────────────────────────────────────┐
                    │                  PUBLISHED PAGE (visitor)                   │
                    │                                                             │
                    │   view bundle entry (esbuild IIFE, existing viewScript)     │
                    │   ┌──────────────────────────────────────────────────────┐ │
                    │   │ mountAll() scans [data-khaveeai-config]              │ │
                    │   │  → new OpenAIRealtimeProvider(useProxy, restUrl)     │ │
                    │   │  → KhaveeProvider                                    │ │
                    │   │     ├ <Canvas>+VRMAvatar (config-driven: bg/light/   │ │
                    │   │     │  scale/offset/camera-preset)                    │ │
                    │   │     ├ ChatBox (if chatShow)  ←─ text input            │ │
                    │   │     │   sendMessage(text) ─┐                          │ │
                    │   │     ├ ClickToTalkOverlay  │                          │ │
                    │   │     └ ErrorOverlay        │                          │ │
                    │   │                           ▼                          │ │
                    │   │   useRealtime() → onAudioData → RealtimeAudioAnalyzer│ │
                    │   │     → setMultipleExpressions → VRMAvatar mouth anim  │ │
                    │   └──────────────────────────────────────────────────────┘ │
                    └─────────────────────────────────────────────────────────────┘
```

The two bundle entries (preview, view) are **physically separate IIFE files** built from **physically separate esbuild entry points**. They share source modules (`PreviewScene`, `ChatBox`, the config type) via esbuild's normal module resolution, but the preview entry's import graph excludes the realtime provider entirely.

### Recommended Project Structure
```
packages/wp-bundle/src/
├── index.ts                 # CHANGED: existing view entry (mountAll → mountAvatarInstance)
├── mount.tsx                # CHANGED: consume new config fields; render ChatBox; apply scene config
├── preview.ts               # NEW: preview-mode entry — scans [data-khaveeai-preview-config], mounts <PreviewScene>, NO provider import
├── config.ts                # NEW: shared KhaveeAvatarConfig type + defaults + camera-preset map + applySceneConfig()
├── preview/
│   └── PreviewScene.tsx     # NEW: <Canvas> + lights + VRMAvatar + idle + Preview-talking viseme loop
├── ui/
│   ├── ClickToTalkOverlay.tsx  # existing (unchanged)
│   ├── ErrorOverlay.tsx        # existing (unchanged)
│   └── ChatBox.tsx             # NEW: bespoke chat panel (transcript + input + send)
└── ../styles.css              # CHANGED: add ChatBox + preview-banner + light/dark theme

wordpress-plugin/src/
├── block.json               # CHANGED: add 14 new attributes (see Component Inventory)
├── editor.js                # CHANGED: 6 new PanelBody panels; replace placeholder div with preview mount-point + config JSON
└── (built → assets/editor.js, assets/editor.asset.php via @wordpress/scripts)

wordpress-plugin/includes/
├── Block/AvatarBlock.php    # CHANGED: extend $renderer_atts with new keys + bgImageId→URL resolution
├── Render/AvatarRenderer.php # CHANGED: extend public_safe() whitelist with new camelCase keys
├── ConfigSource/WpOptionsConfigSource.php # CHANGED: add new keys to get_runtime_config() defaults
└── Block/block.json         # CHANGED: mirror src/block.json attributes

packages/wp-bundle/build.mjs # CHANGED: add second entry point (or second build) for preview bundle → wordpress-plugin/build/khaveeai-preview.js
```

### Pattern 1: Safe preview via entry-point isolation (STUDIO-02 — CRITICAL)
**What:** The preview-mode bundle is a separate esbuild entry point whose import graph never reaches `@khaveeai/providers-openai-realtime`.
**When to use:** This is the ONLY acceptable mechanism for Part B. A runtime `if (preview) { … } else { … }` flag in a shared entry is REJECTED because the import graph still physically contains the provider, and any accidental construction call fires mic+token.
**Why it works:** esbuild tree-shakes per entry. The preview entry imports `@khaveeai/react` (which has zero dependency on the realtime provider — verified by reading `packages/react/src/` and `packages/react/package.json`) and `@react-three/fiber`. It does not import `@khaveeai/providers-openai-realtime`. Therefore the preview bundle's IIFE physically cannot call `new OpenAIRealtimeProvider(...)`, cannot `getUserMedia()`, cannot fetch the ephemeral token. The safety property is enforced by the bundler graph, not by developer discipline at runtime.
**Example:**
```typescript
// packages/wp-bundle/src/preview.ts  — the preview-mode entry
// Source: pattern lifted from src/index.ts structure; safety property per CONTEXT Part B
import "../styles.css";
import { createRoot } from "react-dom/client";
import { mountEditorPreview } from "./preview/mountPreview";

function mountAllPreviews(): void {
  const roots = document.querySelectorAll<HTMLElement>(
    "[data-khaveeai-preview-config]"
  );
  roots.forEach((el) => {
    if (el.dataset.khaveeaiMounted === "true") return;
    el.dataset.khaveeaiMounted = "true";
    let config: KhaveeAvatarConfig;
    try {
      config = JSON.parse(el.dataset.khaveeaiPreviewConfig ?? "{}");
    } catch { return; }
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
//    A grep-based lint check in build.mjs is a recommended belt-and-braces guard.
```

```javascript
// packages/wp-bundle/build.mjs — second entry
// Source: esbuild multi-entry pattern (esbuild.github.io/api/#entry-points)
const buildOptions = (entry, outfile) => ({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  outfile,
  minify: true,
  target: ["es2017"],
  loader: { ".css": ".css" },
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  // NO `external` array — full isolation (D-10 carries forward)
});
await esbuild.build(buildOptions("src/index.ts",  "../../wordpress-plugin/build/khaveeai-bundle.js"));
await esbuild.build(buildOptions("src/preview.ts", "../../wordpress-plugin/build/khaveeai-preview.js"));
```

### Pattern 2: Lip-sync reuse (STUDIO-04 — published page)
**What:** The published-page bundle reuses the SDK's existing `useRealtime()` → `RealtimeAudioAnalyzer` → `setMultipleExpressions` → `VRMAvatar` path unchanged.
**When to use:** On the published page only. The path is already wired: `useRealtime` subscribes to `provider.onAudioData(analyser, audioContext)`, lazily constructs `RealtimeAudioAnalyzer`, which calls `provider.getAudioAnalyser()` to pull the TTS `AnalyserNode`, runs MFCC/DTW phoneme detection, and drives `setMultipleExpressions({aa,ih,ou,ee,oh})`. `VRMAvatar` applies those to the VRM expression blend shapes every frame. **No new lip-sync code is required on the published page.** The Phase-9 work is purely: ensure the view entry still constructs `OpenAIRealtimeProvider` (it does — unchanged from Phase 8), and that `VRMAvatar` is rendered inside `KhaveeProvider`.
**Verified path:** `packages/react/src/hooks/useRealtime.ts:80-90` (`onAudioData`), `:184-210` (`RealtimeAudioAnalyzer` construction + `setMultipleExpressions`), `:138-143` (`sendMessage` for text chat), `packages/core/src/types/realtime.ts:99` (`sendMessage`), `:113` (`getAudioAnalyser`).
**Example (already working in Phase 8 — no change):**
```typescript
// packages/wp-bundle/src/mount.tsx (existing, extended with config + ChatBox)
const provider = new OpenAIRealtimeProvider({
  useProxy: true, proxyEndpoint: config.restUrl,
  voice: config.voice, instructions: config.instructions, model: config.model,
});
root.render(
  <KhaveeProvider config={{ realtime: provider }}>
    <div className="khaveeai-root" style={containerStyle(config)}>
      {config.avatarUrl && <AvatarScene avatarUrl={config.avatarUrl} config={config} />}
      {config.chatShow && <ChatBox placement={config.chatPlacement} />}
      <ClickToTalkOverlay />
      <ErrorOverlay />
    </div>
  </KhaveeProvider>
);
// useRealtime() is consumed INSIDE ChatBox + ClickToTalkOverlay; lip-sync runs
// automatically via the effect in useRealtime once the provider connects.
```

### Pattern 3: Inspector panels (STUDIO-01)
**What:** Six collapsible `PanelBody` panels inside `InspectorControls`, each wrapping the locked knob set. Built with `createElement` (no JSX) and `@wordpress/components` — exactly as Phase 8's single panel was built.
**When to use:** Always — this is the native Gutenberg pattern.
**Example:**
```javascript
// wordpress-plugin/src/editor.js — pattern lifted from existing Phase-8 single PanelBody
import { RangeControl, SelectControl, ToggleControl, ColorPalette, TextControl } from '@wordpress/components';

createElement( InspectorControls, null,
  // Panel 1: Layout
  createElement( PanelBody, { title: __( 'Layout', 'khaveeai' ), initialOpen: true },
    createElement( RangeControl, {
      label: __( 'Container width (px)', 'khaveeai' ),
      value: containerWidth || undefined,  // undefined = "use default" placeholder
      min: 200, max: 1200,
      onChange: ( v ) => setAttributes( { containerWidth: v } ),
    } ),
    // …height, fullWidth ToggleControl
  ),
  // Panel 2: Background (type select, color picker, transparent toggle, MediaUpload)
  // Panel 3: Lighting (RangeControl 0–2 step 0.1, initial 1.0)
  // Panel 4: Avatar (existing MediaUpload + RangeControl scale + offset-X/Y)
  // Panel 5: Camera (SelectControl — Front/Left Angle/Right Angle/Wide ONLY)
  // Panel 6: Voice & Behavior (existing SelectControl + TextareaControl)
  // Panel 7: Chat Box (ToggleControl show + SelectControl placement + ToggleControl previewTalking)
)
```
**Mutual-exclusivity rule** (CONTEXT Part A): when `bgTransparent` is true, the color and image controls render with `disabled: true` (greyed, not hidden). When `bgType === 'color'`, the image picker is disabled; vice-versa.

### Pattern 4: ChatBox component (STUDIO-03)
**What:** A bespoke, dependency-free chat panel authored in `packages/wp-bundle/src/ui/ChatBox.tsx`, mirroring khavee-app's `ChatBox.tsx` interaction (transcript scrollback + text input + send) but with zero HeroUI/lucide deps.
**When to use:** On the published page (live, via `useRealtime()`) and in the editor preview (disconnected state, transcript empty).
**Lifted from khavee-app** (`apps/web/src/components/settings/preview/ChatBox.tsx`):
- Enter sends, Shift+Enter inserts a newline (`handleKeyPress` lines 57-62).
- Auto-scroll-to-bottom on new message via `scrollIntoView` on the last child (lines 41-48).
- User bubbles right-aligned accent bg; assistant bubbles left-aligned neutral bg (the strongest visual signal of speaker turn, per UI-SPEC color contract).
- Empty state when `!isConnected`.
**Deviation from khavee-app** (UI-SPEC): the WP ChatBox does NOT host a "Connect to AI" button — connection is always initiated by the existing Phase-8 "Click to talk" overlay. The disconnected state shows helper text "Click the avatar to start, then type here." instead.
**Wiring:**
```typescript
// packages/wp-bundle/src/ui/ChatBox.tsx
import { useRealtime } from "@khaveeai/react";
export function ChatBox({ placement }: { placement: "beside" | "below" }) {
  const { conversation, sendMessage, chatStatus, isConnected } = useRealtime();
  // …render bubbles from `conversation` (already {role, text}[] shape),
  // input drives sendMessage(text) on Enter
}
```

### Pattern 5: Config transport — zero new plumbing (STUDIO-05)
**What:** New keys ride the existing pipeline. The change is purely additive: extend three PHP arrays + one TS interface.
**Verified pipeline** (end-to-end, from existing source):
1. `block.json` `attributes` (new keys, `default: ""`/`0`/`false`) — Gutenberg persists them as post-content block markup.
2. `AvatarBlock::render_callback()` (`wordpress-plugin/includes/Block/AvatarBlock.php:68`) — extend `$renderer_atts` with the new keys; for `bgImageId`, resolve to URL via `wp_get_attachment_url()` exactly as `avatar` already is (line 69-71).
3. `AvatarRenderer::public_safe()` (`includes/Render/AvatarRenderer.php:138`) — extend the whitelist array with the new camelCase keys (e.g. `containerWidth`, `bgType`, `bgColor`, `bgTransparent`, `bgImageUrl`, `lightIntensity`, `avatarScale`, `avatarOffsetX`, `avatarOffsetY`, `cameraPreset`, `chatShow`, `chatPlacement`).
4. `WpOptionsConfigSource::get_runtime_config()` (`includes/ConfigSource/WpOptionsConfigSource.php:58`) — add the new keys to the returned defaults array (e.g. `'light_intensity' => 1.0`, `'camera_preset' => 'front'`). Note: snake_case in PHP, mapped to camelCase in `public_safe()`.
5. `data-khaveeai-config` JSON attribute — already escaped via `esc_attr(wp_json_encode(...))` (line 92-93). No change.
6. `packages/wp-bundle/src/index.ts:29` — already parses the JSON; `mountAvatarInstance(root, config)` receives the extended object. Extend `KhaveeAvatarConfig` in `mount.tsx` with optional fields, all blank-defaulting to Phase-8 hardcoded scene values (`ambient 1`, `directional 2.5`, camera `[0,0,5]` fov 50).

### Anti-Patterns to Avoid
- **DO NOT** put `bgColor`, `lightIntensity`, etc. as inline CSS on the mount div in PHP. Apply them inside the bundle's `<Canvas>` scene graph (three.js world units for lights/scale, CSS only for the container). The PHP layer only emits JSON.
- **DO NOT** mount the live SPA (`viewScript`/`index.ts` entry) inside the editor iframe. Only the preview entry mounts in the editor. (See Pitfall 1.)
- **DO NOT** import `OpenAIRealtimeProvider` from `src/preview.ts` or any module in its import graph. Add a grep-based build-time guard in `build.mjs` to fail the build if `providers-openai-realtime` appears in the preview entry's module graph.
- **DO NOT** use `ServerSideRender` for the editor preview anymore — Phase 9 replaces it with a real mount-point div that the preview bundle mounts into.
- **DO NOT** use `viewScript` in block.json to enqueue the live bundle — keep the Phase-8 PHP-side `AssetManager::enqueue()` (PERF-01) which is conditional + idempotent. The preview bundle, by contrast, is registered as a real `editorScript`-style asset (enqueued only in the editor by `wp_enqueue_script` on `enqueue_block_editor_assets` or via a second `block.json` `editorScript` entry — see Open Questions).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MFCC/DTW phoneme detection for lip-sync | A new phoneme classifier | `RealtimeAudioAnalyzer` in `packages/react/src/hooks/useRealtime.ts` (already runs on `onAudioData`) | 200+ lines of tested MFCC template matching; rebuilding risks regression and is explicitly out of scope (CONTEXT Part D "reuse, don't rebuild"). |
| Text-input → realtime-session send | A second WebSocket / custom message channel | `OpenAIRealtimeProvider.sendMessage(text)` + the `useRealtime().sendMessage` wrapper | Already implemented; text shares the existing realtime session, does NOT open a second connection (UI-SPEC). |
| Camera position math for presets | Free-form XYZ controls | A static lookup table mapping `front|left-angle|right-angle|wide` → `{position, target}` vectors | Presets are locked by CONTEXT (no free-form). Lift the 4 vectors verbatim from khavee-app `Preview.tsx:54-87` (see Code Examples). |
| Chat transcript state | A `useState` transcript in the ChatBox | `useRealtime().conversation` (already mirrored from the provider) | The provider is the single source of truth; mirroring locally would diverge from voice-originated messages. |
| Block-inspector sliders | Custom HTML range inputs | `@wordpress/components` `RangeControl` | Pre-styled, accessible, wp-admin-native; matches Phase-8 approach. |
| Color picker | Custom color input | `@wordpress/components` `ColorPalette` | WP-core, accessible, ships with theme color swatches. |
| Background-image upload | A custom file picker | `@wordpress/components` `MediaUpload` (already used for avatar) | Reuse the exact Phase-8 Media Library flow + `upload_mimes` allow-listing already in place. |

**Key insight:** This phase is overwhelmingly a *wiring* phase — the hard algorithmic pieces (lip-sync, realtime protocol, VRM expression driving) already exist and are tested. The risk is in mis-wiring the config transport or breaking the preview safety property, not in building new algorithms.

## Runtime State Inventory

> This phase adds config keys but does NOT rename or migrate any existing stored state. Block attributes are forward-compatible (new keys default blank → fall through to global defaults → fall through to Phase-8 hardcoded scene values). Existing Phase-8 shortcodes/blocks render identically until an author sets a value. No data migration is required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New block attributes added to `block.json`; existing posts' block markup is forward-compatible (Gutenberg tolerates unknown attributes; new defaults apply) | None — no migration |
| Live service config | None — no external services store these strings (Custom mode only, no khavee-app backend) | None |
| OS-registered state | None | None |
| Secrets/env vars | None new (existing `OPENAI_API_KEY` in wp_options unchanged) | None |
| Build artifacts | `wordpress-plugin/assets/editor.js` + `editor.asset.php` will be regenerated by `wp-scripts build`; `wordpress-plugin/build/khaveeai-bundle.js` regenerated + new `khaveeai-preview.js` emitted by esbuild | Rebuild step required in plan |

## Common Pitfalls

### Pitfall 1: Editor preview firing mic prompts / token mints (STUDIO-02 — the load-bearing safety property)
**What goes wrong:** The author types in the inspector and a browser mic-permission prompt pops up, or the REST token endpoint gets hammered on every keystroke.
**Why it happens:** Any code path in the editor that constructs `OpenAIRealtimeProvider` and calls `connect()` (or that the constructor eagerly calls `getUserMedia`) triggers it. Phase 8's EMBED-05 documented this; Phase 9 must preserve it while replacing the static placeholder with a real preview.
**How to avoid:** (1) The preview entry point (`src/preview.ts`) MUST NOT import `@khaveeai/providers-openai-realtime`. Verify by inspecting the import graph. (2) Add a build-time guard in `build.mjs`: after building the preview bundle, grep the output for `RealtimeProvider`/`getUserMedia`/`ephemeral` and fail the build if found. (3) The preview bundle should be registered/enqueued ONLY via `enqueue_block_editor_assets` (editor-only), never via `wp_enqueue_scripts` (front-end). (4) The live view bundle (`src/index.ts`) must NOT be enqueued in the editor at all.
**Warning signs:** A mic prompt appears when the block is selected; OpenAI billing shows token mints from admin IPs; `khaveeai-preview.js` contains the string `RealtimeProvider` after minification.

### Pitfall 2: React/three version conflict in the editor iframe
**What goes wrong:** The preview bundle mounts React 19 inside the editor iframe while Gutenberg's own React (WP core ships React ~18.3 via `wp-element`) also runs in the same iframe; the two copies clash, causing "Invalid hook call" crashes.
**Why it happens:** Both `@wordpress/scripts` (for `editor.js`) and the preview bundle run in the editor iframe. `editor.js` correctly externalizes React to `window.wp.element` (so it shares WP's copy). The preview bundle, however, is an esbuild IIFE that bundles its OWN React 19 copy (D-10 full isolation).
**How to avoid:** This is actually FINE because of full isolation: the preview bundle's React 19 lives inside its own IIFE module scope and is NOT assigned to `window.React` (D-10: no `globalName`). The two React copies never see each other. The preview bundle mounts into a div that the `editor.js` createElement tree leaves alone (editor.js renders the mount-point div; the preview bundle owns everything inside it). DO NOT try to share React between `editor.js` and the preview bundle — that would require externalizing React in the preview bundle, which the editor iframe's `window.wp.element` wrapper does NOT expose in a form `react-dom/client`'s `createRoot` can consume cleanly. Keep them fully isolated.
**Warning signs:** "Invalid hook call" or "Cannot read properties of null (reading 'useMemo')" in the editor console when the block is selected.
**Verification:** The preview bundle's IIFE output must NOT contain any reference to `window.wp.element` or `window.React`. Confirmed by reading `packages/wp-bundle/build.mjs` (no `external` array, no `globalName`).

### Pitfall 3: WebGL context loss in the editor
**What goes wrong:** When the author toggles the block inspector panels rapidly, switches blocks, or undoes/redoes, the editor iframe may destroy and recreate the block's DOM. A stale WebGL context leaks or the canvas goes black.
**Why it happens:** three.js WebGL contexts are a finite browser resource (~16 concurrent contexts). The editor may mount multiple block instances (avatar block used twice on a page) or rapidly remount on undo/redo.
**How to avoid:** (1) R3F's `<Canvas>` already handles context loss via its `onCreated`/frameloop lifecycle — but only if the component unmounts cleanly. The preview entry's `mountAllPreviews()` must use an idempotency guard (`dataset.khaveeaiMounted`) exactly as `index.ts:24` does, AND must properly unmount the React root when the block's DOM node is removed (MutationObserver on the editor canvas, or rely on WP's `core/block-editor` re-render which destroys the mount div). (2) Cap concurrent preview canvases: if multiple avatar blocks exist, consider a single shared preview that reflects the currently-selected block (out of scope — but note for the executor). (3) The `gl={{ preserveDrawingBuffer: false }}` default is fine for preview (we don't capture screenshots).
**Warning signs:** "Too many WebGL contexts" console warning; oldest canvas going black after opening several blocks.

### Pitfall 4: Editor undo/redo + attribute persistence races
**What goes wrong:** Dragging a slider rapidly causes attribute writes that spam the undo stack, making undo practically useless (one undo step per pixel of slider movement).
**Why it happens:** `RangeControl.onChange` fires on every pixel; `setAttributes` writes to the block store on each fire; each write is an undo history entry.
**How to avoid:** (1) Use `onChange` for live preview reactivity but debounce the `setAttributes` write, OR (2) prefer `onChange` (live) + `onMouseUp`/`onBlur` for the committed value. `@wordpress/components` `RangeControl` does not have a built-in commit-on-release, so the executor should track a local state in the `Edit` component for the live drag and call `setAttributes` on a debounce or on pointer-up. Note: the preview bundle reads config from the `data-khaveeai-preview-config` JSON attribute, which `editor.js` must keep in sync with `attributes` — the executor should update that JSON on the SAME cadence as `setAttributes` to avoid preview lag.
**Warning signs:** Undo history has 50+ entries after one slider drag; preview lags behind the inspector handle.

### Pitfall 5: Conditional enqueue — preview bundle loading on published pages (or vice versa)
**What goes wrong:** The 400KB+ preview bundle loads on every published page (site-wide performance regression), OR the live SPA loads in the editor (safety regression — see Pitfall 1).
**Why it happens:** Mis-registering the preview bundle via `wp_enqueue_scripts` instead of `enqueue_block_editor_assets`, or wiring the live bundle to load in the editor.
**How to avoid:** (1) Live bundle (`khaveeai-bundle.js`) — keep the Phase-8 path: enqueued ONLY by `AssetManager::enqueue()`, called from `AvatarRenderer::render()` which only runs on published pages where the block is present. (2) Preview bundle (`khaveeai-preview.js`) — register via `wp_enqueue_script` on the `enqueue_block_editor_assets` hook (editor-only), or as a second `editorScript` entry in `block.json`. NEVER enqueue it via `wp_enqueue_scripts`.
**Warning signs:** Network tab on a published page shows `khaveeai-preview.js`; admin editor network tab shows `khaveeai-bundle.js`.

### Pitfall 6: Transparent-background overlay vs. canvas clear color
**What goes wrong:** Author enables "transparent background" but the avatar still renders over an opaque background.
**Why it happens:** three.js `<Canvas>` defaults to a non-transparent clear. The `bgColor` config sets the container div's CSS background, not the WebGL clear color. For overlay mode, the canvas itself must be transparent (`gl={{ alpha: true }}` + `scene.background = null`), and the container div must NOT paint an opaque bg.
**How to avoid:** When `bgTransparent === true`: (a) `<Canvas gl={{ alpha: true }}>` and `style={{ background: 'transparent' }}` on the canvas; (b) container div CSS `background: transparent`; (c) do NOT set `scene.background`. When false: apply `bgColor` as the container div's CSS background (cheaper than a three.js scene background and works for image backgrounds too).
**Warning signs:** Overlay mode shows a white/black box around the avatar instead of the page behind it.

## Code Examples

Verified patterns lifted from official WP docs, the existing codebase, and the khavee-app reference repo.

### Camera preset vectors (lift VERBATIM from khavee-app)
```typescript
// Source: /Users/whitemalt/Documents/khavee-app/apps/web/src/app/[locale]/projects/[id]/settings/steps/Preview.tsx:54-87
// [VERIFIED: read from khavee-app source during this research session]
export const CAMERA_PRESETS = {
  front:       { position: [ 0,    1.3,  3.1 ], target: [0, 0.15, 0] },
  "left-angle":  { position: [-2.05, 1.28, 2.5 ], target: [0, 0.15, 0] },
  "right-angle": { position: [ 2.05, 1.28, 2.5 ], target: [0, 0.15, 0] },
  wide:        { position: [ 0,    1.55, 5.2 ], target: [0, 0.1,  0] },
} as const;
export type CameraPreset = keyof typeof CAMERA_PRESETS;
```
**Application:** Inside `PreviewScene.tsx`, set the R3F camera position via `<Canvas camera={{ position: preset.position, fov: 20 }}>`. Note khavee-app uses `fov: 20` (PreviewModel.tsx line 61) — tighter than Phase 8's `fov: 50`. The executor should pick one; `fov: 20` matches khavee-app's framing and is recommended for consistency with the preset vectors. **`fov` choice must be consistent with the preset vectors** — changing fov without re-tuning the vectors reframes the avatar. [VERIFIED via PreviewModel.tsx: `fov = 20` default, applied as `<Canvas camera={{ fov: fov }}>`]

### Lighting (lift range from khavee-app BackgroundPanel)
```typescript
// Source: /Users/whitemalt/Documents/khavee-app/apps/web/src/components/settings/preview/BackgroundPanel.tsx:38-39
// [VERIFIED: MIN=0, MAX=2, default in PreviewModel.tsx:64 is 0.7, but CONTEXT.md locks default 1.0]
// CONTEXT.md Part A locks: "range 0–2, default 1.0 — matches khavee-app's BackgroundPanel.tsx"
// Note: khavee-app's runtime default is 0.7 (PreviewModel default) but its slider default is 0.4
// (BackgroundPanel line 345). CONTEXT.md arbitrates → use 1.0 as the WP default.
export const LIGHT_INTENSITY = { min: 0, max: 2, step: 0.1, default: 1.0 };

// In PreviewScene.tsx:
<ambientLight intensity={config.lightIntensity ?? 1.0} />
<directionalLight position={[10, 10, 5]} intensity={2.5} />
// Note: khavee-app also adds <Environment preset="sunset" /> from @react-three/drei — that
// pulls a large HDR asset. Phase 9 should SKIP Environment (avoid the asset dependency) and
// rely on ambient + directional only, matching Phase 8's existing AvatarScene (mount.tsx:59-60).
```

### Preview-talking no-audio viseme loop (Part D editor demo)
```typescript
// Source: design pattern; viseme names from packages/react/src/hooks/useAudioLipSync.ts (aa/ih/ou/ee/oh)
// [ASSUMED — exact cycling values are Claude's discretion per CONTEXT; verify viseme keys against VRMAvatar]
import { useVRMExpressions } from "@khaveeai/react";

const VISEME_SEQUENCE = ["aa", "ih", "ou", "ee", "oh"] as const;
const VISEME_VALUES = { aa: 0.6, ih: 0.4, ou: 0.5, ee: 0.45, oh: 0.55 }; // demo intensities

function usePreviewTalking(enabled: boolean) {
  const { setMultipleExpressions } = useVRMExpressions();
  useEffect(() => {
    if (!enabled) {
      setMultipleExpressions({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
      return;
    }
    let i = 0;
    const interval = setInterval(() => {
      const viseme = VISEME_SEQUENCE[i % VISEME_SEQUENCE.length];
      const state = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
      state[viseme] = VISEME_VALUES[viseme];
      setMultipleExpressions(state);
      i++;
    }, 250); // ~4Hz cycle per UI-SPEC interaction states
    return () => clearInterval(interval);
  }, [enabled, setMultipleExpressions]);
}
```

### AvatarBlock.php — extend render_callback (backend, STUDIO-05)
```php
// Source: pattern lifted from existing AvatarBlock.php:68-81
// [VERIFIED: read during this research session]
public function render_callback( array $attributes ): string {
  $avatar_url = isset( $attributes['avatar'] ) && $attributes['avatar'] > 0
    ? wp_get_attachment_url( (int) $attributes['avatar'] ) : '';
  $bg_image_url = isset( $attributes['bgImageId'] ) && $attributes['bgImageId'] > 0
    ? wp_get_attachment_url( (int) $attributes['bgImageId'] ) : '';

  $renderer_atts = array(
    'voice'           => isset( $attributes['voice'] ) ? (string) $attributes['voice'] : '',
    'instructions'    => isset( $attributes['instructions'] ) ? (string) $attributes['instructions'] : '',
    'avatar_url'      => is_string( $avatar_url ) ? $avatar_url : '',
    // NEW:
    'container_width'   => isset( $attributes['containerWidth'] ) ? (int) $attributes['containerWidth'] : 0,
    'container_height'  => isset( $attributes['containerHeight'] ) ? (int) $attributes['containerHeight'] : 0,
    'full_width'        => ! empty( $attributes['fullWidth'] ),
    'bg_type'           => isset( $attributes['bgType'] ) ? (string) $attributes['bgType'] : '',
    'bg_color'          => isset( $attributes['bgColor'] ) ? (string) $attributes['bgColor'] : '',
    'bg_transparent'    => ! empty( $attributes['bgTransparent'] ),
    'bg_image_url'      => is_string( $bg_image_url ) ? $bg_image_url : '',
    'light_intensity'   => isset( $attributes['lightIntensity'] ) ? (float) $attributes['lightIntensity'] : 1.0,
    'avatar_scale'      => isset( $attributes['avatarScale'] ) ? (float) $attributes['avatarScale'] : 1.0,
    'avatar_offset_x'   => isset( $attributes['avatarOffsetX'] ) ? (float) $attributes['avatarOffsetX'] : 0.0,
    'avatar_offset_y'   => isset( $attributes['avatarOffsetY'] ) ? (float) $attributes['avatarOffsetY'] : 0.0,
    'camera_preset'     => isset( $attributes['cameraPreset'] ) ? (string) $attributes['cameraPreset'] : '',
    'chat_show'         => ! empty( $attributes['chatShow'] ),
    'chat_placement'    => isset( $attributes['chatPlacement'] ) ? (string) $attributes['chatPlacement'] : '',
  );

  // Filter blanks so they don't override defaults (existing line 79 pattern).
  // NOTE: numeric 0 / 0.0 for scale/offset/light should NOT be filtered as "blank"
  // the same way '' is — only filter empty strings and unset. Keep explicit defaults above.
  $renderer_atts = array_filter( $renderer_atts, static function ( $v, $k ) {
    if ( is_string( $v ) ) return '' !== $v;
    return true; // keep numeric/bool values as-is
  }, ARRAY_FILTER_USE_BOTH );

  return $this->renderer->render( $renderer_atts );
}
```
⚠️ **Pitfall warning:** the existing `array_filter( $renderer_atts, fn( $v ) => '' !== $v )` would strip `0` and `0.0` (since `'' == 0` in PHP loose comparison). The executor MUST use the explicit callback above to preserve zero-valued scale/offset. [CITED: PHP `empty()`/loose-comparison gotcha — php.net/types.comparisons]

### block.json — new attributes (STUDIO-05)
```json
// Source: extending existing wordpress-plugin/src/block.json; default-blank pattern per CONTEXT
{
  "containerWidth":  { "type": "number", "default": 0 },
  "containerHeight": { "type": "number", "default": 0 },
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
}
```
Note: numeric defaults are `0` (not the real default like 1.0) so that `0` means "use admin default" — the PHP layer's `wp_parse_args` + the bundle's `?? 1.0` fallback resolve the real default. This mirrors how `avatar: 0` already means "use global default" in Phase 8. [VERIFIED: existing pattern at block.json:18-21]

## State of the Art

| Old Approach (Phase 8) | Current Approach (Phase 9) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static `ServerSideRender` placeholder in editor | Live R3F preview via separate preview-mode bundle entry | Phase 9 (this phase) | Authors see WYSIWYG avatar; safety preserved by entry isolation not placeholder |
| 3 block attributes (voice/instructions/avatar) | 17 block attributes (+14 visual/chat) | Phase 9 | All ride existing JSON contract; forward-compatible |
| Single esbuild entry (`src/index.ts` → `khaveeai-bundle.js`) | Two esbuild entries (+ `src/preview.ts` → `khaveeai-preview.js`) | Phase 9 | Live + preview bundles fully isolated; preview cannot reach realtime code |
| Hardcoded `<Canvas camera={{position:[0,0,5], fov:50}}>` + ambient 1 + dir 2.5 | Config-driven scene (preset camera, 0–2 light, scale/offset, bg color/image/transparent) | Phase 9 | All knobs in CONTEXT Part A; blank → Phase-8 defaults |
| No chat UI | Bespoke ChatBox in both preview (disconnected) and published (live) | Phase 9 | Text shares realtime session; no second connection |

**Deprecated/outdated this phase:**
- `ServerSideRender` import in `editor.js` — remove once preview bundle replaces the placeholder.
- The static placeholder `<div>` with "Live preview is not shown in the editor…" copy in `editor.js` — replaced by the preview mount-point.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The editor iframe runs the preview bundle's React 19 isolated from WP core's React via the IIFE-with-no-globalName pattern (D-10) | Pattern 1, Pitfall 2 | LOW — D-10 is a Phase-8 locked decision already in production; the same isolation applies. But the executor should smoke-test by selecting the block and watching for hook-call errors. |
| A2 | khavee-app uses `fov: 20` for its preview camera (PreviewModel.tsx:61), consistent with the lifted preset vectors | Code Examples | LOW — verified by reading PreviewModel.tsx; but if the executor chooses `fov: 50` (Phase 8's value) the preset vectors will frame too wide. Pick one and stay consistent. |
| A3 | `@khaveeai/react` exports `useVRMExpressions` with `setMultipleExpressions({aa,ih,ou,ee,oh})` usable WITHOUT a realtime provider present | Code Examples (Preview talking) | LOW — verified `VRMAvatar.tsx:577` exports `useVRMExpressions` and `useRealtime.ts:19` consumes it; but `useVRMExpressions` reads from `useKhavee()` context, which requires a `KhaveeProvider`. The preview must wrap `PreviewScene` in `<KhaveeProvider config={{ realtime: null }}>`. **Executor must verify `KhaveeProvider` accepts a null realtime provider for the preview path** — if it throws, a no-op provider stub is needed. |
| A4 | Gutenberg apiVersion 3 iframe rendering will load a separately-enqueued `editorScript`-style preview bundle inside the iframe | Architecture Diagram, Pitfall 1 | MEDIUM — verified apiVersion 3 enables iframe rendering and that editor scripts run in the editor context; the exact mechanism for getting a second script (beyond `editorScript`) into the iframe may require `enqueue_block_editor_assets` hook rather than a block.json field. See Open Question 1. |
| A5 | PHP `array_filter` with `'' !== $v` would strip numeric `0` due to loose comparison | Code Examples (AvatarBlock.php) | LOW — well-known PHP gotcha; the executor should write the explicit callback. |

**Note on confidence:** A1–A3 are LOW risk and individually addressable during execution. A4 is the one open architectural question worth resolving before the planner finalizes the editor-enqueue task.

## Open Questions

1. **How exactly is the preview bundle enqueued in the editor iframe?**
   - What we know: `block.json` has a single `editorScript` field (currently `file:../../assets/editor.js`). `editor.js` is built by `@wordpress/scripts`. The Phase-8 setup uses ONE editor script.
   - What's unclear: Can `editorScript` take an ARRAY of files (WP docs say yes — `editorScript` accepts a string OR array of strings)? Or must the preview bundle be enqueued separately via `enqueue_block_editor_assets` PHP hook? The cleanest approach is likely: register `khaveeai-preview.js` via `wp_enqueue_script` on `enqueue_block_editor_assets` in `Plugin.php` (alongside the existing editor.js registration), so editor.js (inspector + mount-point) and khaveeai-preview.js (R3F preview mount) load together in the iframe. [CITED: developer.wordpress.org/block-editor/reference-guides/block-api/block-metadata/]
   - Recommendation: Planner includes a Wave-0 spike task to confirm `editorScript` array vs `enqueue_block_editor_assets` for the second script. Either works; the latter is more explicit and decouples the two bundles' build pipelines.

2. **Does `KhaveeProvider` accept a null realtime provider?**
   - What we know: `useRealtime()` throws if `realtimeProvider` is null (`useRealtime.ts:36-40`). The preview path must NOT construct `OpenAIRealtimeProvider`. But the preview still needs `useVRMExpressions()` which reads from `useKhavee()`.
   - What's unclear: Does `KhaveeProvider` accept `config={{ realtime: null }}` without throwing? If it does, the preview can wrap `<KhaveeProvider config={{ realtime: null as any }}>` and only call `useVRMExpressions` (never `useRealtime`). If it doesn't, a no-op stub object satisfying the `RealtimeProvider` interface surface (but never connecting) is needed.
   - Recommendation: Planner includes a verification task. This is the single biggest unknown in the preview-mount path.

3. **Should `editor.js` (inspector) re-render the preview mount-point's config JSON on every attribute change?**
   - What we know: The preview bundle reads `data-khaveeai-preview-config`. When the author drags a slider, `editor.js` must update that JSON so the preview re-renders.
   - What's unclear: Does the preview bundle watch the attribute via MutationObserver, or does `editor.js` need to unmount/remount the React root on each change? The cleanest pattern is: `editor.js` re-renders the mount div with fresh `data-khaveeai-preview-config` on every `attributes` change (Gutenberg re-renders `edit()` on every setAttributes), and the preview bundle uses a MutationObserver to re-read the JSON and update the scene via React state — NOT unmount/remount (which would leak WebGL contexts).
   - Recommendation: Planner tasks the executor with a MutationObserver-based config-sync in the preview entry.

## Environment Availability

> Phase 9 has no NEW external runtime dependencies. Everything required is already installed. Verification commands run during this research session:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | wp-bundle esbuild build, wp-scripts build | ✓ (CLAUDE.md: v23.5.0 observed; CI uses 18) | 23.5.0 / 18 | — |
| pnpm | workspace install for `@khaveeai/*` deps | ✓ (CLAUDE.md: 10.12.1) | 10.12.1 | — |
| `@wordpress/scripts` | build `editor.js` → `assets/editor.js` | ✓ (wordpress-plugin/package.json) | ^32.5.0 | — |
| esbuild | build wp-bundle entries → `wordpress-plugin/build/*.js` | ✓ (packages/wp-bundle/package.json) | ^0.28.1 | — |
| WordPress (test env) | runtime test of the block + preview | NOT VERIFIED in repo (no Docker WP setup in repo) | — | Manual test against a local WP install required for STUDIO-02/03/04 UAT |

**Missing dependencies with no fallback:**
- A local WordPress install for end-to-end testing of the editor preview + published page. The repo has no `docker-compose.yml` for WP (only for pgvector). The planner should add a manual-verification task (or a quick-task to spin up a local WP) for the safety-critical STUDIO-02 acceptance test.

**Missing dependencies with fallback:**
- None — all build/runtime deps are present.

## Validation Architecture

> `.planning/config.json` was not found in the working directory; `workflow.nyquist_validation` key absent → section included per default-enabled behavior. However, the existing codebase has NO test framework configured for `packages/wp-bundle` or `wordpress-plugin` (verified: no vitest/jest config in either). Phase 9 inherits this gap. The phase is dominated by UI/visual/WordPress-runtime concerns that are not unit-testable without a WP install.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | none configured for `packages/wp-bundle` or `wordpress-plugin` (existing repo state) |
| Config file | none |
| Quick run command | `pnpm --filter @khaveeai/wp-bundle typecheck` (tsc only — no runtime tests) |
| Full suite command | `pnpm --filter @khaveeai/wp-bundle typecheck` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STUDIO-01 | Inspector renders 7 panels with correct controls | manual-only (no WP test harness) | — | ❌ Wave 0 (none feasible) |
| STUDIO-02 | Preview never imports realtime provider | static (grep build output) | `grep -c "RealtimeProvider\|getUserMedia" wordpress-plugin/build/khaveeai-preview.js` must return 0 | ❌ Wave 0 — add as build-step assertion |
| STUDIO-02 | Preview renders VRM with config applied | manual-only (visual) | — | ❌ |
| STUDIO-03 | ChatBox sends text into realtime session | manual-only (needs WP + OpenAI) | — | ❌ |
| STUDIO-04 | Lip-sync drives mouth on published page | manual-only (visual + audio) | — | ❌ |
| STUDIO-05 | New keys flow through JSON contract | static (PHP unit test possible) | `phpunit tests/AvatarRendererPublicSafeTest.php` | ❌ Wave 0 — PHP has no test harness currently |

**Sampling rate:** Because the bulk of acceptance is visual/runtime, the planner should treat this as a **manual-verification-heavy phase**. The single most valuable automated check is a **build-time grep assertion** that `khaveeai-preview.js` contains zero references to `RealtimeProvider`/`getUserMedia`/`ephemeral` (Pitfall 1 safety property). The executor should add this as a line in `build.mjs` that fails the build if the grep returns non-zero.

**Manual UAT script (for the planner to encode as a verification task):**
1. Build all three artifacts (`editor.js`, `khaveeai-bundle.js`, `khaveeai-preview.js`).
2. Activate the plugin in a local WP.
3. Add the block to a page; confirm NO mic prompt, NO network call to `/wp-json/khaveeai/v1/session` in the editor's network tab.
4. Drag each inspector slider; confirm the preview updates within one frame.
5. Toggle "Preview talking"; confirm mouth animates on a timer.
6. Publish; on the published page click "Click to talk"; confirm mic prompt + token mint fire NOW (not before).
7. Type in the ChatBox; confirm assistant reply streams; confirm mouth animates during TTS.
8. Verify a second block instance on the same page renders independently.

### Wave 0 Gaps
- [ ] `packages/wp-bundle` has no test framework — if the team wants unit coverage for `config.ts` (the camera-preset map, default-resolution logic) and `ChatBox.tsx` (render given a mock `useRealtime` return), the executor should add vitest. But this is OPTIONAL — the existing `openai-stt-tts` provider's vitest setup is the only test config in the repo and it is package-local, not workspace-wide.
- [ ] `wordpress-plugin` has no PHP test harness — `composer.json` exists but `phpunit` is not configured. A `public_safe()` whitelist test is the highest-value PHP test but is out of scope to bootstrap this phase unless the planner explicitly tasks it.
- [ ] Build-time grep assertion for preview-bundle safety (Pitfall 1) — add to `build.mjs`.

*If the planner chooses to skip test infrastructure:* "None — existing infrastructure (tsc typecheck only) covers the type-level safety; runtime/visual acceptance is manual per the UAT script above."

## Security Domain

> `security_enforcement` not explicitly set in `.planning/config.json` (file absent) → treated as enabled. However, Phase 9 introduces NO new attack surface beyond Phase 8's already-reviewed plugin. The threat model is unchanged: same `data-khaveeai-config` JSON contract, same REST token route, same Media Library flow. The new keys are non-secret visual config (colors, dimensions, presets).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | unchanged from Phase 8 (REST token route is anonymous by design) |
| V3 Session Management | no | unchanged (OpenAI ephemeral token path) |
| V4 Access Control | yes (inspector fields) | Block attributes written via Gutenberg's `setAttributes` (capability-checked by WP core at the block-editor boundary); `AvatarRenderer::public_safe()` whitelist remains the server-side authority on what reaches the DOM — new keys MUST be added to the whitelist explicitly (never pass `$atts` through unfiltered) |
| V5 Input Validation | yes | `wp_json_encode` + `esc_attr` on the JSON blob (existing); each new key cast in `AvatarBlock::render_callback` (`(int)`, `(float)`, `(string)`, `(bool)`); `wp_kses_post` NOT needed since assistant chat messages render as plain text (UI-SPEC: "no markdown rendering, no HTML injection") |
| V6 Cryptography | no | no new crypto |

### Known Threat Patterns for the WordPress plugin

| Pattern | STRIDE | Standard Mitigation (Phase 9) |
|---------|--------|------------------------------|
| XSS via new config keys (e.g. `bgColor`) injected into the JSON → escaped into HTML attribute | Tampering | `esc_attr(wp_json_encode(...))` already used (AvatarRenderer.php:92-93) — carries forward unchanged; new keys benefit automatically |
| XSS via assistant chat message containing `<script>` | Tampering / XSS | Render assistant messages as plain text (React auto-escapes); UI-SPEC explicitly forbids markdown/HTML rendering in bubbles |
| Path traversal via `bgImageId` / `avatar` Media Library IDs | Tampering | `wp_get_attachment_url()` is the only resolver (already used for avatar); IDs are cast `(int)`; no user-supplied paths accepted |
| SSRF via background-image URL | Tampering | bg images come from Media Library attachment IDs only (resolved server-side by WP core), never from a free-form URL field — `bgType=image` uses `MediaUpload`, not a text input |
| DoS via rapid token minting from the editor (STUDIO-02 safety) | DoS | Entry-point isolation (Pattern 1) + build-time grep assertion; the preview bundle physically cannot call the token endpoint |
| Information disclosure: API key in editor | Information | `public_safe()` never reads the API key (unchanged); preview bundle reads the same JSON the view bundle does, which contains no secrets |

## Sources

### Primary (HIGH confidence)
- **Existing repo source (read this session):** `packages/wp-bundle/src/{index.ts,mount.tsx}`, `packages/wp-bundle/build.mjs`, `packages/wp-bundle/package.json`, `packages/wp-bundle/styles.css`, `wordpress-plugin/src/{editor.js,block.json}`, `wordpress-plugin/includes/{Block/AvatarBlock.php,Render/AvatarRenderer.php,ConfigSource/WpOptionsConfigSource.php,Assets/AssetManager.php}`, `wordpress-plugin/includes/Block/block.json`, `wordpress-plugin/package.json`, `wordpress-plugin/assets/editor.js`
- **SDK lip-sync path (read this session):** `packages/react/src/hooks/useRealtime.ts` (lines 1-240), `packages/react/src/hooks/useAudioLipSync.ts`, `packages/react/src/VRMAvatar.tsx` (export surface), `packages/core/src/types/realtime.ts` (`RealtimeProvider` interface: connect/disconnect/sendMessage/getAudioAnalyser)
- **khavee-app reference repo (read this session):** `apps/web/src/app/[locale]/projects/[id]/settings/steps/Preview.tsx` (camera presets lines 54-87, ambient-light wiring), `apps/web/src/components/settings/preview/{ChatBox.tsx,PreviewModel.tsx,PreviewContent.tsx,BackgroundPanel.tsx}`
- **UI-SPEC.md** (Phase 9 UI Design Contract) — the approved interaction/color/copy contract this research aligns to
- **CONTEXT.md** (Phase 9) — locked user decisions

### Secondary (MEDIUM confidence)
- [developer.wordpress.org/block-editor/reference-guides/block-api/block-metadata/](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-metadata/) — `editorScript`/`viewScript` field semantics, apiVersion 3
- [developer.wordpress.org/block-editor/reference-guides/block-api/block-api-versions/block-migration-for-iframe-editor-compatibility/](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-api-versions/block-migration-for-iframe-editor-compatibility/) — iframe editor compatibility, apiVersion 3
- [developer.wordpress.org/block-editor/reference-guides/components/](https://developer.wordpress.org/block-editor/reference-guides/components/) — `PanelBody`, `RangeControl`, `SelectControl`, `ColorPalette`, `MediaUpload`, `ToggleControl`
- [esbuild.github.io/api/#entry-points](https://esbuild.github.io/api/#entry-points) — multi-entry builds, tree-shaking per entry
- [wordpress.stackexchange.com/questions/402946](https://wordpress.stackexchange.com/questions/402946/does-viewscript-in-block-json-actually-enqueue-a-js-file) — `viewScript` registers but does not always enqueue; justifies keeping the PHP-side `AssetManager::enqueue()` path

### Tertiary (LOW confidence)
- [php.net/types.comparisons](https://www.php.net/manual/en/types.comparisons.php) — PHP loose-comparison `'' == 0` gotcha (well-known, but flagged for the executor)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency already in repo; no new packages; verified by reading package.json files this session.
- Architecture (entry-point isolation): HIGH — the safety mechanism is structural (esbuild per-entry tree-shaking); verified by reading `build.mjs` and the existing `index.ts` import graph.
- Camera presets / light range: HIGH — lifted verbatim from khavee-app source read this session.
- ChatBox interaction shape: HIGH — khavee-app `ChatBox.tsx` read in full (175 lines).
- Lip-sync reuse: HIGH — full `useRealtime.ts` path read and verified end-to-end (onAudioData → RealtimeAudioAnalyzer → setMultipleExpressions).
- Editor-iframe enqueue mechanism (Open Question 1): MEDIUM — apiVersion 3 iframe rendering confirmed via web search; the exact mechanism for loading a second editor script needs a Wave-0 confirmation.
- KhaveeProvider null-realtime acceptance (Open Question 2): MEDIUM — needs executor verification; not directly tested this session.

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (30 days — stable; no fast-moving external deps added)
