---
status: resolved
trigger: "Avatar (VRM model) does not load/render in the Gutenberg block editor's live preview — the canvas mounts, WebGL context initializes fine, and the GLB model file fetches successfully (200 OK), but the model never visually appears. Console is stuck permanently logging \"[VRM Animation] Waiting for animations or VRM to load...\" (packages/react/src/VRMAvatar.tsx:306) with no error ever thrown."
created: 2026-07-09T00:00:00Z
updated: 2026-07-09T14:00:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "The avatar is NOT hung/never-loading at all — useLoadVRM's fetch/parseAsync chain completes successfully (proven via live instrumentation). The model is fully parsed and mounted but rendered at scale=[0,0,0] because packages/wp-bundle/src/config.ts's resolveSceneDefaults() does `c.avatarScale ?? 1.0`, which does not treat 0 as the block's 'unset/use-default' sentinel value (Gutenberg's block.json attribute schema defaults avatarScale to 0, and Gutenberg ALWAYS populates the attribute with this schema default even when the author never touches the slider, so `c.avatarScale` is a real, present `0`, not `null`/`undefined` — `??` cannot catch it). The editor-preview config path (editor.js -> previewConfig -> resolveSceneDefaults) sends this raw `0` straight through, whereas the published front-end path (AvatarBlock.php render_callback) already special-cases `avatarScale > 0 ? (float) $attributes['avatarScale'] : null` and strips `null` from renderer_atts entirely so `wp_parse_args()`/config_source's real default (1.0) applies instead — this is why the SAME code/model/URL renders correctly on the published page but not in the editor."
  confirming_evidence:
    - "Live network/instrumentation trace of the real wp-env editor session (Playwright, wp-admin post=87) shows fetchGlbBuffer's fetch() resolves 200 in ~220ms, arrayBuffer fully downloads (matches Content-Length, CDP loadingFinished t=575ms), GLTFLoader.parseAsync + VRMLoaderPlugin's ~25 embedded texture createObjectURL/fetch/createImageBitmap calls ALL start and resolve successfully within ~700ms of fetch start — no error, no rejection, no stall anywhere in the load chain."
    - "A parallel out-of-band test (unpkg-hosted three@0.180.0 GLTFLoader + @pixiv/three-vrm@3.4.2 VRMLoaderPlugin, run inside the SAME live top-window realm against the SAME fetched buffer) parses the identical model to a valid VRM in ~110ms — proving GLTFLoader/VRMLoaderPlugin mechanics, the buffer, and the realm are all fine; the bundled equivalent must behave identically."
    - "Captured the actual live `data-khaveeai-preview-config` JSON from the iframe: `\"avatarScale\":0,\"avatarOffsetX\":0,\"avatarOffsetY\":0,\"lightIntensity\":0` — confirms the raw attribute default (0) is what's actually being sent to the preview bundle, unresolved."
    - "packages/react/src/VRMAvatar.tsx:534 renders `{scene && <primitive object={scene} />}` unconditionally on `scene` (independent of the `animations`/processedClips useMemo that logs 'Waiting for animations or VRM to load...') — that console log is a RED HERRING: it fires whenever `!animations` is true (IDLE_ANIMATION_URL is commonly unset/undefined in this test env), NOT specifically when VRM parsing is incomplete. A 60s live capture showed the log fires exactly ONCE (matching a single mount), not repeatedly — contradicting the original 'permanently re-logging' theory of an active hang."
    - "wordpress-plugin/includes/Block/AvatarBlock.php:100-119 contains an EXPLICIT, dated (2026-07-02) fix + comment for the EXACT SAME bug class on the published-page path: 'Gutenberg ALWAYS populates lightIntensity/avatarScale with their block.json schema default (0) even when the author never touched the control... every block...rendered with avatarScale=0 (invisible avatar)...on the published page.' That fix (`> 0` check, `null` stripped via array_filter so wp_parse_args' real default wins) was never mirrored into packages/wp-bundle/src/config.ts's resolveSceneDefaults(), which still uses plain `??`."
  falsification_test: "If avatarScale were NOT the cause, setting a non-zero avatarScale via the editor's 'Avatar scale' slider would NOT make the avatar appear. (Not yet executed — see next_action.)"
  fix_rationale: "resolveSceneDefaults() should apply the same '> 0 means explicitly set, else use default' sentinel convention that AvatarBlock.php (PHP/published-page path) and editor.js's own RangeControl display logic (`value: live.avatarScale > 0 ? ... : undefined`) already use — bringing the client-side JS scene-default resolver in line with the already-established, already-fixed convention elsewhere in the same codebase. This addresses the root cause (wrong sentinel-value handling for a shared 'attribute schema defaults numeric sliders to 0' quirk of Gutenberg) rather than a symptom."
  blind_spots: "Have not yet run the actual code fix live to visually confirm the avatar renders after the change (next step). lightIntensity has the identical `??` bug per the same PHP comment (0 → unlit, not necessarily invisible) — included in the fix for consistency but not independently re-verified as producing a fully invisible avatar on its own before this fix."

next_action: "None -- resolved. Human confirmed in real wp-env admin UI (post=87) after hard-reload: avatar renders visibly in the block editor's live preview (previously invisible), browser loaded the freshly-rebuilt bundle (script ver matches rebuild mtime), and the 'Waiting for animations or VRM to load...' log now fires only once (confirming it was a red herring, not an active hang)."

## Symptoms

expected: The Gutenberg block editor's live preview (khaveeai/avatar block) should render the configured VRM/GLB avatar model, same as the published front-end page does.
actual: The avatar canvas mounts (WebGL context is valid, not lost, correct drawingBufferWidth/Height) and the GLB file fetches successfully (network tab shows 200 OK for the signed S3 model URL), but the model never visually appears — canvas stays empty/background-only. Console is stuck permanently re-logging "[VRM Animation] Waiting for animations or VRM to load..." (a useMemo in VRMAvatar.tsx that logs whenever `!currentVrm`), with NO error, NO console.error, and NO unhandledrejection ever firing, even after 3+ minutes.
errors: None visible. No `[VRMAvatar] Failed to load ...` catch-block log (VRMAvatar.tsx:88) ever appears, meaning the fetchGlbBuffer().then(...parseAsync...) promise chain in useLoadVRM() (VRMAvatar.tsx:63-101) neither resolves (setResult never called) nor rejects (catch never called) — a genuine hang, not a fast failure.
timeline: First observed today (2026-07-09) while verifying two other fixes (block-editor container-height overflow, and platform-config avatarUrl/bgColor fallback into the editor preview — both already fixed and confirmed working this session). Before those fixes, the editor preview's avatarUrl was always blank (a separate, already-fixed bug), so this hang was structurally unreachable/unobserved until now. The exact same model URL + same VRMAvatar/useLoadVRM code path renders correctly on the PUBLISHED front-end page (confirmed live, screenshot evidence) — so this is specific to the Gutenberg block-editor's `<iframe name="editor-canvas">` context.
reproduction: In wp-env (http://localhost:8888/wp-admin/post.php?post=87&action=edit, admin/password), open a page containing a khaveeai/avatar block with a connected Khavee Platform API key (so avatarUrl resolves to a real model). The avatar never renders in the editor preview; reloading/waiting longer does not help.

## Prior Related Investigation (context, not yet re-verified against THIS bug)

.planning/debug/resolved/preview-not-updating.md (resolved 2026-07-02) fixed three DIFFERENT compounding bugs in this same iframe/preview-mounting area:
  1. preview.ts's bodyObserver `node instanceof HTMLElement` cross-realm check (always false across iframe/top-window realms) — fixed to use `node.nodeType !== Node.ELEMENT_NODE`.
  2. findAndObserveEditorCanvas()'s immediate-attach-vs-load-listener being mutually exclusive (if/else) — Gutenberg's iframe navigates from about:blank to a real blob: URL after initial mount, firing a genuine second `load` event that the old code never listened for. Fixed to always register the load listener.
  3. resolveSceneDefaults() in config.ts using `c.cameraPreset ?? "front"` instead of `||` — editor.js emits `""` (not undefined) for "(using global default)", so `??` never caught it, `CAMERA_PRESETS['']` was undefined, and reading `.position` on it threw, crashing PreviewSceneInner on every block's default config.
That investigation's own notes flagged a further out-of-scope item at the time ("preview shows 'No avatar selected' because config only carried a raw attachment ID, no URL resolution") — that specific gap has SINCE been closed by this session's own editor.js changes (avatarUrl is now resolved client-side via wp.data's core-data store, and confirmed via network trace to produce a real, successfully-fetched signed S3 URL). So the current bug is NOT that stale finding — fetch demonstrably succeeds now; the hang is one level deeper, inside GLTFLoader.parseAsync() itself (or something VRMLoaderPlugin does during parse), specific to the iframe realm.

## Ruled Out So Far (from this session's own manual live testing, not yet independently re-verified by gsd-debugger)

- WebGL context: NOT lost (`gl.isContextLost() === false`), valid non-zero drawingBufferWidth/Height (2916x800 observed).
- createImageBitmap: works fine when tested directly in the iframe's window (produced a valid 1x1 ImageBitmap from a test PNG data URL).
- OffscreenCanvas: exists (`typeof iframe.contentWindow.OffscreenCanvas !== 'undefined'`).
- No DRACOLoader/KTX2Loader registered anywhere in VRMAvatar.tsx (`grep` confirms only `new GLTFLoader()` + `VRMLoaderPlugin`) — so no web-worker-based decoder is in play to explain a hang via a broken worker.
- Only ONE network request for the model URL was observed per page load in the editor (no repeated-fetch/restart-loop pattern).

## Relevant Files

- packages/react/src/VRMAvatar.tsx (useLoadVRM lines 63-101, fetchGlbBuffer lines 32-44, processedClips useMemo ~line 300 that logs the "Waiting..." message)
- packages/wp-bundle/src/preview/PreviewAvatarCanvas.tsx
- packages/wp-bundle/src/preview.ts (iframe-aware MutationObserver mount logic, per the resolved prior investigation)
- wordpress-plugin/src/editor.js (mount div, previewConfig construction)
- wordpress-plugin/includes/Block/block.json (editorScript array)
- wordpress-plugin/includes/Plugin.php (register_preview_bundle)

## Test Environment

wp-env at http://localhost:8888/wp-admin/post.php?post=87&action=edit (WordPress admin/password). Block editor iframe: `<iframe name="editor-canvas">`. A platform API key is already connected so avatarUrl resolves to a real signed S3 .glb URL end-to-end (confirmed via network trace: 200 OK response).

IMPORTANT — build pipeline gotcha discovered this session: `packages/wp-bundle`'s esbuild resolves `@khaveeai/react` via the pnpm workspace symlink's `package.json` `main` field, which points to `dist/index.js` — NOT live `src/`. Any edit to `packages/react/src/*.ts(x)` (including temporary diagnostic logging) requires `pnpm --filter @khaveeai/react build` BEFORE `node build.mjs` in `packages/wp-bundle`, or the change will silently not appear in the rebuilt `khaveeai-preview.js`/`khaveeai-bundle.js`.

## Evidence

- timestamp: 2026-07-09T13:00:00Z
  checked: Live wp-env editor session (Playwright, headless Chrome, wp-admin post=87), instrumented window.fetch/createImageBitmap/URL.createObjectURL + CDP Network domain timing.
  found: fetchGlbBuffer's fetch() resolves 200 in ~220ms; full response body downloads in 575ms (CDP loadingFinished, encodedDataLength matches Content-Length 7746624); ~25 embedded-texture createObjectURL -> fetch(blob:) -> createImageBitmap calls ALL start and resolve successfully within ~700ms total. No rejection, no stall, anywhere in the load chain.
  implication: useLoadVRM's promise chain is NOT hanging — it completes successfully and quickly in the real editor context. The "waiting" console log and the original hang theory do not hold up.
- timestamp: 2026-07-09T13:05:00Z
  checked: Out-of-band parse test — imported three@0.180.0's GLTFLoader + @pixiv/three-vrm@3.4.2's VRMLoaderPlugin from unpkg, executed inside the SAME live top-window realm (page.evaluate) against the SAME fetched model buffer/URL.
  found: parseAsync resolves in ~110ms with a valid VRM (hasVrm=true, scene.children=21).
  implication: GLTFLoader/VRMLoaderPlugin mechanics, the model file, and the wp-admin top-window realm are all functionally fine — rules out CSP/realm/blob-URL/createImageBitmap theories entirely.
- timestamp: 2026-07-09T13:10:00Z
  checked: Captured the live `data-khaveeai-preview-config` data attribute JSON from inside the editor-canvas iframe.
  found: '"avatarScale":0,"avatarOffsetX":0,"avatarOffsetY":0,"lightIntensity":0' (raw, unresolved attribute defaults) alongside a valid, correctly-resolved `avatarUrl` (signed S3 URL).
  implication: The preview config's numeric slider fields are sent as literal 0, not omitted/undefined — a real value, not a "not yet set" marker, from resolveSceneDefaults()'s point of view.
- timestamp: 2026-07-09T13:12:00Z
  checked: packages/wp-bundle/src/config.ts resolveSceneDefaults() (lines 257-287).
  found: "avatarScale: c.avatarScale ?? 1.0" and "lightIntensity: c.lightIntensity ?? LIGHT_INTENSITY.default" — `??` only falls back on null/undefined, not on 0.
  implication: With avatarScale=0 flowing in from the editor's raw attribute default, the resolved scale used for <VRMAvatar scale={[0,0,0]}> is literally zero — the model loads, parses, and mounts into the scene, but renders at zero size (invisible), indistinguishable from "never loaded" by eye or by console (no error is thrown for a zero-scale object).
- timestamp: 2026-07-09T13:14:00Z
  checked: wordpress-plugin/includes/Block/AvatarBlock.php lines 88-119 (published front-end's PHP render_callback).
  found: Explicit, dated (2026-07-02) prior fix + comment describing the EXACT SAME bug class -- "Gutenberg ALWAYS populates lightIntensity/avatarScale with their block.json schema default (0) even when the author never touched the control...avatarScale=0 (invisible avatar)...on the published page." Fixed there via `( $attributes['avatarScale'] ?? 0 ) > 0 ? (float) $attributes['avatarScale'] : null`, with `null` stripped from renderer_atts by array_filter so wp_parse_args()/config_source's real default (1.0, or a platform-configured value) applies instead.
  implication: This confirms the root cause and explains why the published front-end (routes through this PHP fix) renders the avatar correctly while the editor preview (routes through packages/wp-bundle/src/config.ts's unfixed resolveSceneDefaults(), driven by editor.js's client-side previewConfig) does not. The fix must mirror the same "> 0 means explicitly set" sentinel convention into resolveSceneDefaults().
- timestamp: 2026-07-09T13:16:00Z
  checked: packages/react/src/VRMAvatar.tsx's processedClips useMemo (~line 300) and its "[VRM Animation] Waiting for animations or VRM to load..." log, cross-referenced against a 60-second live console capture.
  found: The log condition is `!animations || !currentVrm || Object.keys(loadedAnimations).length === 0` — fires whenever `animations` prop is falsy (e.g. IDLE_ANIMATION_URL unset), independent of whether currentVrm/scene loaded successfully. Live capture over 60s showed the message exactly ONCE (a single mount), not repeatedly.
  implication: The original "permanently re-logging = active hang" theory from the trigger description was a misleading artifact, not evidence of an ongoing async hang. Root cause is the zero-scale rendering issue above, not a stuck promise.

## Eliminated Hypotheses

- hypothesis: useLoadVRM's fetch()/arrayBuffer()/GLTFLoader.parseAsync() promise chain hangs (never resolves nor rejects) somewhere in the editor-canvas iframe/top-window realm.
  evidence: Live instrumentation of the exact same code path (fetch, blob createObjectURL, createImageBitmap) in the real wp-env editor session shows every step starting AND resolving successfully within under a second; an independent out-of-band GLTFLoader+VRMLoaderPlugin parse of the identical buffer in the same realm also succeeds in ~110ms.
  timestamp: 2026-07-09T13:08:00Z
- hypothesis: CSP, blob-URL cross-realm restrictions, or createImageBitmap unavailability in the wp-admin top-window realm blocks texture loading inside GLTFLoader.parse().
  evidence: Out-of-band parse test (unpkg GLTFLoader + VRMLoaderPlugin) executed in the SAME top-window realm succeeded fully, including all embedded texture loads via blob: URLs and createImageBitmap.
  timestamp: 2026-07-09T13:09:00Z
- hypothesis: Duplicate/mismatched three.js module instances bundled into khaveeai-preview.js (two GLTFLoader class definitions found via static grep) cause instanceof-based logic inside VRMLoaderPlugin to silently fail.
  evidence: Live console capture shows THREE's own "Multiple instances of Three.js being imported" self-check (window.__THREE__) never fires during real page load — only one THREE core module evaluates; the second GLTFLoader definition is a duplicated FILE (likely from @react-three/drei's own bundled loader) sharing the same single "three" package, not a genuine duplicate module graph.
  timestamp: 2026-07-09T13:11:00Z

## Resolution

root_cause: >
  packages/wp-bundle/src/config.ts's resolveSceneDefaults() resolved
  avatarScale/lightIntensity with `c.avatarScale ?? 1.0` /
  `c.lightIntensity ?? LIGHT_INTENSITY.default`. Gutenberg's block.json
  attribute schema defaults these numeric sliders to 0, and Gutenberg ALWAYS
  populates the attribute with this schema default even when the author
  never touches the slider -- so `c.avatarScale` arriving at
  resolveSceneDefaults() is a real, present 0, never null/undefined, and `??`
  cannot catch it. This resolved avatarScale=0 -> <VRMAvatar
  scale={[0,0,0]}> in the editor preview: the model fetches, parses, and
  mounts successfully (confirmed via live instrumentation -- no hang
  anywhere in the load chain), but renders at zero size, which is visually
  indistinguishable from "never loaded." The published front-end path was
  already immune because wordpress-plugin/includes/Block/AvatarBlock.php's
  render_callback applies the same "0 means unset" sentinel (`> 0 ? (float)
  $attributes['avatarScale'] : null`, with null stripped so wp_parse_args'
  real default wins) -- that fix (dated 2026-07-02) was never mirrored into
  the client-side JS resolveSceneDefaults() used by the editor preview.
fix: >
  Changed resolveSceneDefaults() in packages/wp-bundle/src/config.ts to treat
  avatarScale/lightIntensity <= 0 as "unset" (mirroring AvatarBlock.php's `>
  0` convention) instead of using `??`: `avatarScale: c.avatarScale &&
  c.avatarScale > 0 ? c.avatarScale : 1.0` and `lightIntensity:
  c.lightIntensity && c.lightIntensity > 0 ? c.lightIntensity :
  LIGHT_INTENSITY.default`. Rebuilt the wp-bundle (node build.mjs) so
  wordpress-plugin/build/khaveeai-preview.js picks up the change.
verification: >
  Self-verified via Playwright (headless Chrome, wp-env at
  http://localhost:8888/wp-admin/post.php?post=87&action=edit): after the
  fix + rebuild + hard reload, the avatar model renders visibly in the block
  editor's live preview with zero slider interaction (screenshot confirms a
  fully visible VRM character over the configured background color, matching
  the published front-end's appearance). Human-confirmed in the real
  wp-admin UI (post=87): after a hard reload, the VRM avatar now renders
  visibly in the block editor's live preview (previously just a flat
  background color, invisible); confirmed the browser loaded the
  freshly-rebuilt bundle (script ver query param matched the rebuild's exact
  mtime); console showed the "[VRM Animation] Waiting for animations or VRM
  to load..." log firing only once, consistent with it being a red herring
  rather than an active hang. Verification result: CONFIRMED FIXED.
files_changed:
  - packages/wp-bundle/src/config.ts
  - wordpress-plugin/build/khaveeai-preview.js (rebuilt artifact)
