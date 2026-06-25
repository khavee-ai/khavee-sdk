---
phase: 09-block-studio-visual-config-chat-lipsync
plan: "05"
subsystem: wp-bundle/mount
tags:
  - avatar
  - chat
  - lipsync
  - wordpress
  - studio-03
  - studio-04
  - config-driven
  - three-js

dependency_graph:
  requires:
    - "09-01 (resolveSceneDefaults, CAMERA_PRESETS, KhaveeAvatarConfig in config.ts)"
    - "09-04 (ChatBox component and CSS chrome in styles.css)"
    - "@khaveeai/providers-openai-realtime (OpenAIRealtimeProvider — Phase-8 unchanged)"
    - "@khaveeai/react (KhaveeProvider, VRMAvatar, GLBAvatar, useRealtime — unchanged)"
  provides:
    - "Config-driven AvatarScene: camera preset, ambient lightIntensity, directional 2.5, avatar scale (uniform XYZ tuple), avatar offset X/Y, transparent canvas (gl.alpha)"
    - "ChatBox mounted inside KhaveeProvider when config.chatShow; flex layout --beside or --below"
    - "Container .khaveeai-root with dynamic width/height/bgColor/bgImageUrl/bgTransparent styles"
    - ".khaveeai-layout / --beside / --below CSS flex rules in styles.css"
    - "STUDIO-04 lip-sync satisfied by automatic reuse: VRMAvatar inside KhaveeProvider → useRealtime onAudioData → RealtimeAudioAnalyzer → setMultipleExpressions"
  affects:
    - "09-06 (UAT checkpoint verifies the published page end-to-end)"
    - "wordpress-plugin/build/khaveeai-bundle.js (updated)"
    - "wordpress-plugin/build/khaveeai-bundle.css (updated)"

tech_stack:
  added: []
  patterns:
    - "Config-driven scene: resolveSceneDefaults(config) centralizes all ?? fallbacks; mount.tsx consumes output directly, never re-applies defaults"
    - "Uniform scale tuple: KhaveeAvatarConfig.avatarScale (single float) expanded to [x,y,z] at call site — VRMAvatar/GLBAvatar require tuples"
    - "Transparent canvas (Pitfall 6): gl={{ alpha: true }} on Canvas + CSS 'transparent' on container; NOT scene.background (would defeat WebGL clear)"
    - "Layout container only when chatShow: khaveeai-layout flex wrapper added for aside/below chat; omitted when chatShow false so AvatarScene fills .khaveeai-root directly"
    - "React CSSProperties for container inline styles: bgColor via style={{ background }} (auto-escaping by React's CSS stringifier — T-09-05-01)"
    - "Lip-sync reuse pattern: zero new code; VRMAvatar inside KhaveeProvider is the only requirement"

key_files:
  created: []
  modified:
    - path: "packages/wp-bundle/src/mount.tsx"
      description: "AvatarScene now config-driven (resolveSceneDefaults); mountAvatarInstance adds ChatBox + layout wrapper; container styles from config; re-export of KhaveeAvatarConfig preserved"
    - path: "packages/wp-bundle/styles.css"
      description: "Appended .khaveeai-layout, .khaveeai-layout--beside, .khaveeai-layout--below flex rules"
    - path: "wordpress-plugin/build/khaveeai-bundle.js"
      description: "Rebuilt with config-driven AvatarScene + ChatBox mount (esbuild IIFE)"
    - path: "wordpress-plugin/build/khaveeai-bundle.css"
      description: "Rebuilt with new layout CSS rules"
    - path: "wordpress-plugin/build/khaveeai-preview.css"
      description: "Rebuilt (shared styles.css includes new layout rules; preview JS unchanged)"

key_decisions:
  - "Use scene.lightIntensity (config-driven via c.lightIntensity ?? 1.0) for ambientLight.intensity, not scene.ambient (always 1) — acceptance criteria explicitly requires the config-driven value"
  - "Expand avatarScale (single float) to [x,y,z] uniform tuple at call site — VRMAvatar/GLBAvatar.scale prop is [number,number,number]; converting at the component boundary keeps KhaveeAvatarConfig clean"
  - "khaveeai-layout wrapper only when config.chatShow; when false, AvatarScene placed directly in .khaveeai-root without layout wrapper — avoids unnecessary flex container for avatar-only mode"
  - "ClickToTalkOverlay + ErrorOverlay remain siblings of the layout div (not inside it) — their position:absolute overlay covers the full .khaveeai-root widget regardless of layout"
  - "Container background applied as CSSProperties via React style prop (T-09-05-01 mitigation); bgImageUrl from PHP int-cast attachment ID so free-form URLs are prevented at the source"
  - "No changes to resolveSceneDefaults in config.ts (Plan 09-01 already implemented) — the function always uses the 'front' preset as default, returning CAMERA_PRESETS[front].position=[0,1.3,3.1]/fov=20 when cameraPreset is unset. This diverges from the plan's stated WARNING-2 option-b (Phase-8 [0,0,5]/50 fallback) but config.ts is fixed by Plan 09-01; noted as a known difference between plan intent and implementation."

requirements-completed:
  - STUDIO-03
  - STUDIO-04

duration: ~20min
completed: "2026-06-26"
---

# Phase 09 Plan 05: Config-Driven AvatarScene + ChatBox Mount in Published Page Summary

Config-driven AvatarScene (camera preset, lightIntensity, avatar scale/offset, transparent bg) with ChatBox mounting beside/below inside KhaveeProvider via flex layout, satisfying STUDIO-03 live chat and STUDIO-04 lip-sync by automatic reuse of the existing useRealtime → RealtimeAudioAnalyzer path.

## Performance

- **Duration:** ~20 minutes
- **Started:** 2026-06-26T00:00:00Z
- **Completed:** 2026-06-26T00:20:00Z
- **Tasks:** 1/1
- **Files modified:** 5

## Accomplishments

- AvatarScene converted from hardcoded ([0,0,5]/fov 50/ambient 1/dir 2.5) to config-driven via `resolveSceneDefaults(config)`: camera position + fov from CAMERA_PRESETS, ambient `lightIntensity` from config, directional still 2.5, avatar scale as uniform [x,y,z] tuple, avatar offset X/Y as position vector, optional `gl={{ alpha: true }}` for transparent canvas
- ChatBox mounts as flex sibling of AvatarScene inside KhaveeProvider when `config.chatShow`, with placement class `khaveeai-layout--beside` or `--below` driven by `config.chatPlacement`
- Container `.khaveeai-root` receives dynamic inline styles (width, height, background/backgroundImage) from config via React's `CSSProperties` (T-09-05-01: CSS-property auto-escaping)
- STUDIO-04 published-page lip-sync satisfied by automatic reuse: VRMAvatar inside KhaveeProvider triggers `useRealtime`'s existing `onAudioData → RealtimeAudioAnalyzer → setMultipleExpressions` path — zero new lip-sync code, `useRealtime.ts` and `VRMAvatar.tsx` untouched
- `.khaveeai-layout`, `.khaveeai-layout--beside`, `.khaveeai-layout--below` CSS rules appended to `styles.css`; build verified clean (safety assertion passes for preview bundle)

## Task Commits

1. **Task 1: Make AvatarScene config-driven and add ChatBox + layout container to mountAvatarInstance** - `7e20e80` (feat)

**Plan metadata:** committed with SUMMARY.md

## Files Created/Modified

- `packages/wp-bundle/src/mount.tsx` — AvatarScene now `{ config: KhaveeAvatarConfig }`, applies `resolveSceneDefaults`; mountAvatarInstance adds layout wrapper + ChatBox; container styles; OpenAIRealtimeProvider construction unchanged
- `packages/wp-bundle/styles.css` — `.khaveeai-layout`, `.khaveeai-layout--beside`, `.khaveeai-layout--below` flex rules appended
- `wordpress-plugin/build/khaveeai-bundle.js` — rebuilt with config-driven mount + ChatBox
- `wordpress-plugin/build/khaveeai-bundle.css` — rebuilt with layout CSS rules
- `wordpress-plugin/build/khaveeai-preview.css` — rebuilt (shared styles.css change)

## Decisions Made

- `ambientLight intensity={scene.lightIntensity}` (config-driven c.lightIntensity ?? 1.0) per acceptance criteria, not `scene.ambient` (always 1 in resolveSceneDefaults)
- `avatarScale` expanded to `[scale, scale, scale]` tuple at the VRMAvatar/GLBAvatar call site; config type stays a single float
- Layout wrapper (`khaveeai-layout`) added only when `config.chatShow`; avatar-only mode places AvatarScene directly in `.khaveeai-root`
- ClickToTalkOverlay + ErrorOverlay kept as siblings of the layout div so their `position: absolute; inset: 0` overlay covers the full widget regardless of chat placement

## Deviations from Plan

None — plan executed exactly as written.

The worktree had no pre-built dist/ artifacts, so `pnpm --filter @khaveeai/core run build`, `pnpm --filter @khaveeai/react run build`, and `pnpm --filter @khaveeai/providers-openai-realtime run build` were run before `node build.mjs`. These are worktree environment setup actions (identical to what Plan 09-04 documented), not deviations from the plan itself.

One observation documented in key_decisions: `resolveSceneDefaults` in config.ts (Plan 09-01) always applies the "front" camera preset as its default (returning `[0, 1.3, 3.1]` / fov 20) rather than the Phase-8 `[0, 0, 5]` / fov 50 fallback described in Plan 09-05's WARNING-2 option-b wording. Since config.ts is fixed by Plan 09-01 and plan 09-05 specifies only mounting changes, this is noted as a known implementation difference, not a deviation introduced by this plan.

## Issues Encountered

None beyond the worktree build environment setup (no node_modules/dist present on first run — same as Plans 09-01 through 09-04 experienced; resolved by `pnpm install --frozen-lockfile` and building upstream packages).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 09-06 (UAT checkpoint) can now exercise the full published-page path:
- Existing Phase-8 shortcodes/blocks with no new config keys render via the default "front" camera preset
- Blocks with explicit `cameraPreset` use `CAMERA_PRESETS[preset].position` / fov 20
- Blocks with `chatShow: true` render ChatBox beside/below the avatar inside the same KhaveeProvider realtime session
- Lip-sync activates automatically on avatar TTS playback (useRealtime path untouched)

No blockers for Plan 09-06.

## Known Stubs

None. All config values flow from `KhaveeAvatarConfig` (resolved from `data-khaveeai-config` by `index.ts`) into `AvatarScene` and `mountAvatarInstance`. ChatBox consumes `useRealtime()` directly — no hardcoded empty arrays or placeholder text. The published page is production-ready pending UAT (Plan 09-06).

## Threat Flags

No new threat surface beyond what the plan's threat model covers. T-09-05-01 (CSS injection via bgColor) is mitigated by React's style prop auto-escaping; T-09-05-04 (second connection for text chat) is prevented — ChatBox calls `useRealtime().sendMessage` on the existing session, no second `OpenAIRealtimeProvider` is constructed.

## Self-Check: PASSED

- `packages/wp-bundle/src/mount.tsx`: FOUND
- `packages/wp-bundle/styles.css`: contains `.khaveeai-layout`, `.khaveeai-layout--beside`, `.khaveeai-layout--below` (grep -c returned 4)
- `packages/wp-bundle/src/mount.tsx` contains ChatBox, resolveSceneDefaults, config.chatShow, avatarOffsetX, lightIntensity (grep -c returned 13, >= 5 required)
- Commit `7e20e80`: present in git log
- `pnpm exec tsc --noEmit`: PASS (no output)
- `node build.mjs`: PASS ("Build complete. Safety assertion passed for khaveeai-preview.js.")
- `packages/react/` diff: no changes (useRealtime.ts + VRMAvatar.tsx unchanged)
