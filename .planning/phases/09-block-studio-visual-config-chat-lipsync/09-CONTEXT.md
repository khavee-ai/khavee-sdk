# Phase 9: Block Studio — Visual Config, Live Preview, Chat & Lip-Sync — Context

**Gathered:** 2026-06-25
**Status:** Ready for UI design (`/gsd:ui-phase 9`)

<domain>
## Task Boundary

Expand the existing `Khavee AI Avatar` WordPress Gutenberg block (built in Phase 8) into a fully styleable, previewable block with four parts: (A) Tier-1 visual/layout config controls in the inspector, (B) a safe live 3D editor preview, (C) an integrated ChatBox, and (D) SDK-driven talking (lip-sync) animation. Self-hosted Custom mode only — no `khavee-app` backend dependency.

The block currently exposes only 3 per-block attributes (`voice`, `instructions`, `avatar` attachment ID) and shows a static placeholder in the editor (Phase 8's EMBED-05 deliberately avoided mounting the live SPA to prevent mic prompts + OpenAI token mints on every keystroke). This phase replaces that placeholder with a true live preview and adds the visual config + chat + lip-sync surfaces.

</domain>

<decisions>
## Implementation Decisions

These are LOCKED user decisions. The UI researcher must design to them and must NOT re-ask them.

### Part A — Inspector config controls (Tier 1 knob set, finalized)
The inspector exposes EXACTLY these knobs, organized into collapsible panels (not a flat wall):
- **Layout**: container width (px), height (px), full-width toggle
- **Background**: type = Color | Image; color picker; transparent-background toggle (overlay mode); Media Library image picker (reuse the existing avatar Media Library pattern)
- **Lighting**: intensity slider (range 0–2, default 1.0 — matches khavee-app's `BackgroundPanel.tsx`)
- **Avatar**: model (VRM attachment — already exists), scale slider, offset-X slider, offset-Y slider
- **Camera**: PRESET DROPDOWN ONLY — Front / Left Angle / Right Angle / Wide (matches khavee-app's `Preview.tsx:54-87` presets). NO free-form camera XYZ/target controls.
- **Voice & Behavior (existing)**: voice select, instructions textarea — keep, grouped in their own panel

Mutual exclusivity: transparent-background toggle disables the color/image fields.

### Part B — Live editor preview (SAFE PREVIEW MODE) — critical architectural decision
The editor preview (`edit()`) must render a REAL visible avatar: live 3D VRM with subtle idle animation, all Part A config applied, WYSIWYG-reactive as the author drags sliders.

**Hard safety constraint (non-negotiable):** the editor preview must NEVER access the microphone or mint an OpenAI Realtime token. This is the Phase 8 EMBED-05 concern, now solved with a real preview instead of a static placeholder.

**Architecture (locked):** a separate `editorScript` "preview mode" bundle entry that renders VRM + scene + config but wires NO realtime/mic/token. The existing `viewScript` keeps running the full live SPA on the published page. This mirrors how khavee-app's `PreviewModel.tsx` renders without realtime bits. The block's `edit()` uses this preview-mode render (NOT `ServerSideRender` of a static placeholder).

### Part C — ChatBox (explicit must-have — do not drop)
A chat UI alongside the avatar (transcript/message history + text input), like khavee-app shows. Must be:
- (a) a configurable element of the block: a show/hide toggle + placement control (e.g. beside / below the avatar within the container)
- (b) visible and laid out in the editor preview
- (c) live/functional on the published page (transcript scrollback + text input that drives the same realtime session as voice)

UX to specify: message bubble styling (user vs assistant), scrollback behavior, input affordance, and how the ChatBox visually coexists with the 3D avatar inside the configurable container (width/height from Part A bounds both).

### Part D — Talking animation / lip-sync (explicit must-have — do not drop)
When the avatar speaks it must animate (mouth/phoneme/expression movement) like khavee-app — driven by the SDK's EXISTING lip-sync pipeline (`@khaveeai/react` `useAudioLipSync`, MFCC/DTW phoneme detection in `useRealtime.ts`, `VRMAvatar` expression/bone driving). Reuse, don't rebuild.
- Published page: lip-sync runs for real off the TTS audio analyser.
- Editor preview: provide a no-audio way to demonstrate the motion (e.g. a "Preview talking" toggle that loops a sample talking animation) so the author can see it without a live session.

### Config transport (locked — reuse existing plumbing)
All new visual/chat config flows through the EXISTING contract: new `block.json` attributes → merged over admin defaults via `wp_parse_args` in `AvatarBlock::render_callback` (or a shared resolver) → escaped JSON in `data-khaveeai-config` on the mount-point `<div>` → consumed by the frontend bundle. No new transport. New knobs follow the same global-default + per-block-override shape already used for voice/instructions/avatar.

### Where the real work is (scope signal for the researcher)
The bulk of implementation effort is in the BUNDLE, not the inspector:
1. The bundle must become config-driven — consume `bgColor`, `width`, `height`, `scale`, `offsetX/Y`, `lightIntensity`, `cameraPreset`, `chatbox*` from `data-khaveeai-config` and apply them to the canvas/container/scene.
2. The bundle needs a preview-mode entry (Part B) separate from the live viewScript.
3. ChatBox component + lip-sync wiring live in the bundle.
The UI-SPEC must make the bundle's UI responsibilities explicit, not just the WP-admin inspector surface.

</decisions>

<specifics>
## Specific Ideas / References

### UX reference (visual + interaction): khavee-app
- Preview page: `/Users/whitemalt/Documents/khavee-app/apps/web/src/app/[locale]/projects/[id]/settings/steps/Preview.tsx`
- 3D render (the pattern to lift for the safe preview): `apps/web/src/components/settings/preview/PreviewModel.tsx` (+ `PreviewContent.tsx`, `PreviewCamera`)
- Config panels (control patterns + ranges to mirror): `BackgroundPanel.tsx` (bg color/image, light intensity 0–2), `CameraPositionPanel.tsx`, `MotionPanel.tsx` — under `apps/web/src/components/settings/preview/`
- Config type shape: `apps/web/src/types/project-model.ts` (`ProjectModel`)
- ChatBox + talking-animation specifics: researcher should locate the chat UI component and the speaking-state→lip-sync wiring in `apps/web/src/components/` (not pre-located)

### SDK side (the plugin to extend): khavee-sdk
- Block definition: `wordpress-plugin/src/block.json`, `wordpress-plugin/assets/block.json`, `wordpress-plugin/src/editor.js`
- Block server render + attribute merge: `wordpress-plugin/includes/Block/AvatarBlock.php`
- Frontend config injection (the JSON contract): `wordpress-plugin/includes/Render/AvatarRenderer.php` (escaped JSON in `data-khaveeai-config`)
- Global config source (admin defaults): `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php`
- Frontend bundle source (becomes config-driven + gains preview-mode entry): `packages/wp-bundle/`
- SDK lip-sync to reuse: `packages/react/src/hooks/useAudioLipSync.ts`, `packages/react/src/hooks/useRealtime.ts`, `packages/react/src/VRMAvatar.tsx`

### Confirmed inspector layout (mockup approved by user)
Collapsible panels: LAYOUT → BACKGROUND → LIGHTING → AVATAR → CAMERA → VOICE & BEHAVIOR. Camera is a preset dropdown (no XYZ). See Phase 9 discussion for the approved ASCII mockup of the inspector and the editor-canvas preview.

</specifics>

<canonical_refs>
## Out of Scope (user-confirmed — do NOT design these)

- Project visibility / share-link / "chatbox-on-share" settings — these are khavee-app Platform concepts; the WP plugin is self-hosted Custom mode with no projects/share-links/visibility.
- Free-form camera XYZ / target XYZ controls (preset dropdown only).
- Custom `.fbx` motion file uploads (idle/speaking/thinking) — too heavy for this milestone; motion presets may be revisited later.
- Any login/auth/billing UI.
- `khavee-app` platform/backend changes of any kind (separate repo).

## Constraints
- Custom mode only this milestone — no `khavee-app` backend dependency. All config lives in WP (wp_options global defaults + per-block attributes).
- Native Gutenberg UX conventions: `InspectorControls` panels, block dimensions, Media Library flow, iframe-safe rendering for the live preview.
- Beginner-DX audience (site owners, not developers) — inspector copy must be plain-language.
- Must not regress Phase 8's EMBED-05 (no mic prompt / no token mint in the editor) — Part B extends it to a live preview while preserving the safety property.

</canonical_refs>
