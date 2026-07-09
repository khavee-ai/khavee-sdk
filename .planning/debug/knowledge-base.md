# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## vrm-parse-hang-in-editor — VRM avatar invisible in Gutenberg block editor preview, misdiagnosed as a parse hang
- **Date:** 2026-07-09
- **Error patterns:** VRM, avatar, block editor, preview, invisible, never appears, no error, avatarScale, lightIntensity, resolveSceneDefaults, Gutenberg schema default, zero scale, "Waiting for animations or VRM to load", GLTFLoader, VRMLoaderPlugin, iframe editor-canvas
- **Root cause:** packages/wp-bundle/src/config.ts's resolveSceneDefaults() resolved avatarScale/lightIntensity with `c.avatarScale ?? 1.0` / `c.lightIntensity ?? LIGHT_INTENSITY.default`. Gutenberg's block.json attribute schema defaults these numeric sliders to 0, and Gutenberg ALWAYS populates the attribute with this schema default even when the author never touches the slider — so the incoming value is a real, present 0, never null/undefined, and `??` cannot catch it. This resolved avatarScale=0 -> <VRMAvatar scale={[0,0,0]}> in the editor preview: the model fetches, parses, and mounts successfully (no hang anywhere in the load chain), but renders at zero size, visually indistinguishable from "never loaded." The published front-end path was already immune because wordpress-plugin/includes/Block/AvatarBlock.php's render_callback applies the same "0 means unset" sentinel (`> 0 ? (float) $attributes['avatarScale'] : null`, with null stripped so wp_parse_args' real default wins) — that fix (dated 2026-07-02) was never mirrored into the client-side JS resolveSceneDefaults() used by the editor preview. The "[VRM Animation] Waiting for animations or VRM to load..." log that appeared to loop forever was a red herring, unrelated to VRM/parse state (fires whenever the `animations` prop is falsy, e.g. IDLE_ANIMATION_URL unset), and only fired once per mount.
- **Fix:** Changed resolveSceneDefaults() to treat avatarScale/lightIntensity <= 0 as "unset" (mirroring AvatarBlock.php's `> 0` convention) instead of using `??`: `avatarScale: c.avatarScale && c.avatarScale > 0 ? c.avatarScale : 1.0` and `lightIntensity: c.lightIntensity && c.lightIntensity > 0 ? c.lightIntensity : LIGHT_INTENSITY.default`. Rebuilt wordpress-plugin/build/khaveeai-preview.js.
- **Files changed:** packages/wp-bundle/src/config.ts, wordpress-plugin/build/khaveeai-preview.js (rebuilt artifact)
---
