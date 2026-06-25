# @khaveeai/wp-bundle

Internal build target — **not published, not meant to be imported by app code.** You only need this package if you're working on the WordPress plugin (`wordpress-plugin/`).

## What this is

A self-contained IIFE bundle that mounts the Khavee voice-chat avatar onto a WordPress front-end page. It scans the page for every element with a `data-khaveeai-config` attribute (rendered server-side by the WordPress plugin's `AvatarRenderer`), and mounts one independent `KhaveeProvider` + `VRMAvatar`/`GLBAvatar` tree into each one it finds.

Built with `@khaveeai/react` and `@khaveeai/providers-openai-realtime` — it always constructs `OpenAIRealtimeProvider` with `useProxy: true` and a `proxyEndpoint`, never a direct API key, since this code ships to a public browser.

Key properties of the build (`build.mjs`, esbuild):
- Output format is `iife` with no `--global-name` — nothing is assigned to `window`. The bundle is fully self-contained.
- React, ReactDOM, three.js, and `@pixiv/three-vrm` are bundled inline (no `external` array), so this script doesn't depend on anything else being loaded on the page.
- Output goes to `../../wordpress-plugin/build/khaveeai-bundle.js`.
- Each mount point is independent — multiple avatar instances on one page never share connection state, since a new `OpenAIRealtimeProvider` is constructed per mount.
- The avatar never auto-connects — `connect()` is only called from the click-to-talk overlay's click handler, never on page load.

## Commands

```bash
pnpm build       # one-shot build -> wordpress-plugin/build/khaveeai-bundle.js
pnpm dev         # esbuild --watch, rebuilds on change
pnpm typecheck   # tsc --noEmit
```

## When you'd touch this

Only when changing how the avatar embeds into WordPress pages (mount logic in `src/mount.tsx`, the click-to-talk/error overlays in `src/ui/`, or the bundling config in `build.mjs`). For anything about the avatar/voice pipeline itself, see `@khaveeai/react` and `@khaveeai/providers-openai-realtime` instead.
