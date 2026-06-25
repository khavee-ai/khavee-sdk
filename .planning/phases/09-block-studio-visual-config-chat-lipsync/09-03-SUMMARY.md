---
phase: 09-block-studio-visual-config-chat-lipsync
plan: 03
subsystem: wp-bundle (preview entry)
tags: [studio-02, studio-04, preview-bundle, react-three-fiber, webgl, safety, iife]
dependency_graph:
  requires:
    - 09-01 (config.ts with KhaveeAvatarConfig + resolveSceneDefaults; build.mjs safety grep assertion)
  provides:
    - packages/wp-bundle/src/preview.ts (real IIFE entry replacing stub)
    - packages/wp-bundle/src/preview/mountPreview.tsx (MutationObserver config-sync mount)
    - packages/wp-bundle/src/preview/PreviewScene.tsx (config-driven 3D VRM preview + no-audio viseme cycler)
    - wordpress-plugin/build/khaveeai-preview.js (built + safety-verified preview bundle)
    - wordpress-plugin/build/khaveeai-preview.css (bundled styles)
  affects:
    - 09-06 (wires khaveeai-preview.js into editor via enqueue_block_editor_assets)
    - STUDIO-02 safety property (preview bundle import graph exclusion of openai-realtime)
    - STUDIO-04 editor-side no-audio talking demo
tech_stack:
  added: []
  patterns:
    - IIFE entry mirroring index.ts mountAll shape (attribute + mount fn swapped)
    - MutationObserver on data-khaveeai-preview-config for config re-sync without WebGL context churn (Pitfall 3 avoidance)
    - KhaveeProvider with no realtime config → useVRMExpressions() safe, useRealtime() NOT called
    - setInterval viseme cycler at 250ms (~4Hz) for no-audio Preview-talking demo
    - PreviewAvatarConfig local interface extending KhaveeAvatarConfig with previewTalking flag
    - Container-div CSS background (NOT scene.background) for bgColor/bgImage/transparent (Pitfall 6)
    - Three-layer STUDIO-02 defence: structural/build-time/source-grep
key_files:
  created:
    - packages/wp-bundle/src/preview/mountPreview.tsx
    - packages/wp-bundle/src/preview/PreviewScene.tsx
    - wordpress-plugin/build/khaveeai-preview.css
  modified:
    - packages/wp-bundle/src/preview.ts (stub replaced with real IIFE entry)
    - wordpress-plugin/build/khaveeai-preview.js (now contains real preview code; safety-verified)
decisions:
  - "PreviewScene splits into outer PreviewScene (KhaveeProvider wrap) + inner PreviewSceneInner (Canvas + hooks) so useVRMExpressions/usePreviewTalking are called inside the provider subtree — React rules of hooks compliant"
  - "PreviewAvatarConfig defined as a local interface extending KhaveeAvatarConfig with previewTalking?: boolean — keeps config.ts unchanged (not in this plan's files_modified) while allowing type-safe access to the editor-only flag"
  - "background applied to container div CSS (not scene.background) per Pitfall 6 — CSS background cheaper than three.js clear-color manipulation and works for color, image, and transparent without extra three.js code"
  - "Build dependency packages (@khaveeai/core, @khaveeai/react, @khaveeai/providers-openai-realtime) needed pnpm install + pnpm --filter build before node build.mjs — same pre-existing workspace state issue as Plan 09-01 deviation"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-26"
  tasks_completed: 2
  files_changed: 5
---

# Phase 9 Plan 03: STUDIO-02 Preview Bundle Entry + STUDIO-04 No-Audio Talking Demo Summary

**One-liner:** Real IIFE entry scanning `[data-khaveeai-preview-config]` mounts a config-driven 3D VRM preview (KhaveeProvider-with-no-realtime, camera presets, lights, bg, viseme cycler) with MutationObserver config-sync — no mic, no token, safety-verified by source grep and bundle grep assertion.

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | preview.ts stub → real IIFE entry + mountPreview.tsx MutationObserver mount | 55292fa | preview.ts: mountAllPreviews() scanning [data-khaveeai-preview-config]; mountPreview.tsx: PreviewHost with useState(config) + MutationObserver pushing fresh config on attribute change (no unmount) |
| 2 | PreviewScene.tsx config-driven 3D preview + usePreviewTalking viseme cycler | e4ad260 | PreviewScene wrapping KhaveeProvider; PreviewSceneInner with Canvas, lights, VRMAvatar/GLBAvatar, empty-state, pill label; usePreviewTalking cycling aa/ih/ou/ee/oh at 250ms; built output committed |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Workspace dependency packages not built**
- **Found during:** Task 1 verification (`node build.mjs`)
- **Issue:** Same pre-existing state as Plan 09-01: `@khaveeai/core`, `@khaveeai/react`, and `@khaveeai/providers-openai-realtime` had no `dist/` directory in the worktree's freshly-installed node_modules
- **Fix:** Ran `pnpm install --frozen-lockfile` at worktree root, then `pnpm --filter @khaveeai/core run build`, `pnpm --filter @khaveeai/react run build`, `pnpm --filter @khaveeai/providers-openai-realtime run build` before `node build.mjs`
- **Files modified:** None (build-time setup, not committed — matches Plan 09-01 precedent)
- **Commit:** N/A

**2. [Rule 2 - Missing critical functionality] Local PreviewAvatarConfig type for previewTalking**
- **Found during:** Task 2 implementation
- **Issue:** `config.ts`'s `KhaveeAvatarConfig` does not include `previewTalking` (an editor-only flag emitted by Plan 09-02) — accessing it without a type definition would be either `any` or a TS error
- **Fix:** Defined `interface PreviewAvatarConfig extends KhaveeAvatarConfig { previewTalking?: boolean }` locally in `PreviewScene.tsx`. This keeps `config.ts` unchanged (it is not in this plan's `files_modified`) while preserving strict-mode type safety
- **Files modified:** `packages/wp-bundle/src/preview/PreviewScene.tsx` (local interface only)

## Key Decisions Made

1. **PreviewScene outer/inner split** — `PreviewScene` wraps `<KhaveeProvider>` and renders `<PreviewSceneInner>` which calls `usePreviewTalking` (and inside it, `useVRMExpressions`). This is required because hooks must be called inside the provider's subtree. Single-component approach would require calling `useVRMExpressions` before the `<KhaveeProvider>` return, violating React rules of hooks.

2. **Local `PreviewAvatarConfig` interface** — Rather than modifying `config.ts` (not in this plan's scope) or using `(config as any).previewTalking`, a local interface extension provides type safety without cross-plan scope creep. The preview entry is the only consumer of this flag.

3. **CSS background on container div** — `bgColor`, `bgImageUrl`, and `bgTransparent` are all applied as CSS on the container `<div>`, not via three.js `scene.background`. This is cheaper (no three.js background clear-color interaction), simpler (plain CSS), and works correctly for all three background modes without Pitfall 6 (transparent canvas requiring `gl={{ alpha: true }}`).

4. **`directional` intensity from `sceneDefaults`** — Used `sceneDefaults.directional` (2.5, matching Phase-8 `mount.tsx:60`) rather than a magic constant, ensuring consistency with `resolveSceneDefaults()` as the single source of truth.

## STUDIO-02 Safety Verification

The load-bearing STUDIO-02 safety property is verified at three layers:

| Layer | Check | Result |
|-------|-------|--------|
| Structural | preview.ts import graph: no `import ... from "@khaveeai/providers-openai-realtime"` | PASS (source grep: 0 actual import statements) |
| Build-time | `node build.mjs` grep assertion: `khaveeai-preview.js` matches `/RealtimeProvider\|getUserMedia\|ephemeral/` | PASS (0 matches; build exits 0) |
| Source-level | `grep "useRealtime()\|OpenAIRealtimeProvider" PreviewScene.tsx mountPreview.tsx preview.ts` for actual calls/imports | PASS (0 actual calls; strings appear only in safety-documenting comments) |

## Known Stubs

None — all three files are fully implemented. The `previewTalking` flag defaults to `false` when absent from the JSON config (Plan 09-02 emits it; Plan 09-03 consumes it defensively with `?? false`).

## Threat Flags

No new security-relevant surface beyond what is documented in the plan's threat model. The preview bundle introduces zero new network endpoints, auth paths, or file access patterns. The MutationObserver watches only the `data-khaveeai-preview-config` attribute on the mount-point div, which is controlled by editor.js (same origin, Gutenberg edit context).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/wp-bundle/src/preview.ts | FOUND |
| packages/wp-bundle/src/preview/mountPreview.tsx | FOUND |
| packages/wp-bundle/src/preview/PreviewScene.tsx | FOUND |
| wordpress-plugin/build/khaveeai-preview.js | FOUND |
| wordpress-plugin/build/khaveeai-preview.css | FOUND |
| .planning/phases/09-block-studio-visual-config-chat-lipsync/09-03-SUMMARY.md | FOUND |
| Commit 55292fa (Task 1) | VERIFIED |
| Commit e4ad260 (Task 2) | VERIFIED |
