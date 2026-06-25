---
phase: 09-block-studio-visual-config-chat-lipsync
plan: 01
subsystem: wordpress-plugin / wp-bundle
tags: [config-transport, block-attributes, php, typescript, esbuild, studio-05]
dependency_graph:
  requires: []
  provides:
    - STUDIO-05 config transport spine (block.json → PHP merge → JSON injection → bundle parse)
    - packages/wp-bundle/src/config.ts (KhaveeAvatarConfig v2, CAMERA_PRESETS, LIGHT_INTENSITY, resolveSceneDefaults)
    - packages/wp-bundle/src/preview.ts stub entry (plan 09-03 populates)
    - packages/wp-bundle/build.mjs dual-entry factory + safety grep assertion
  affects:
    - All Phase-9 plans that consume config keys (09-02, 09-03, 09-04, 09-05, 09-06)
tech_stack:
  added: []
  patterns:
    - PHP wp_parse_args merge pattern extended with 13 new snake_case keys
    - ARRAY_FILTER_USE_BOTH type-aware callback (fixes 0/0.0/false stripping bug)
    - snake→camel translation boundary enforced in AvatarRenderer::public_safe()
    - esbuild buildOptions factory for multi-entry IIFE builds
    - build-time grep safety assertion for preview bundle isolation
key_files:
  created:
    - packages/wp-bundle/src/config.ts
    - packages/wp-bundle/src/preview.ts
  modified:
    - wordpress-plugin/src/block.json
    - wordpress-plugin/includes/Block/block.json
    - wordpress-plugin/includes/Block/AvatarBlock.php
    - wordpress-plugin/includes/Render/AvatarRenderer.php
    - wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php
    - packages/wp-bundle/src/mount.tsx
    - packages/wp-bundle/build.mjs
decisions:
  - "Used ARRAY_FILTER_USE_BOTH with a type-aware callback in AvatarBlock::render_callback to replace the buggy '' !== $v filter that stripped 0/0.0/false under PHP loose comparison"
  - "KhaveeAvatarConfig moved to config.ts and re-exported from mount.tsx so index.ts:17 import path is unchanged (backward compatible)"
  - "preview.ts is a stub for now — esbuild requires the entry file to exist; plan 09-03 overwrites with mountAllPreviews() implementation"
  - "build.mjs uses buildOptions(entry, outfile) factory pattern; safety grep assertion runs only in non-watch branch (watch mode can't assert on partially-written output)"
  - "cameraFov=20 in resolveSceneDefaults matches khavee-app PreviewModel.tsx:61 (consistent with lifted preset vectors); Phase-8 AvatarScene remains at fov=50 until plan 09-05"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-26"
  tasks_completed: 3
  files_changed: 9
---

# Phase 9 Plan 01: STUDIO-05 Config Transport Spine Summary

**One-liner:** Extended the block.json → PHP merge → JSON injection → bundle pipeline with 14 new visual/chat config keys end-to-end, fixed the PHP 0-stripping array_filter bug, and scaffolded the preview esbuild entry with a build-time safety grep assertion.

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Extend block.json × 2 + WpOptionsConfigSource defaults | dc609ef | 14 new attrs in both block.json copies (identical); 6 new PHP constants; 13 new snake_case defaults in get_runtime_config() |
| 2 | Extend AvatarBlock::render_callback + AvatarRenderer::public_safe() | 3ddaa12 | bgImageId→URL resolution; 13 new keys in $renderer_atts; ARRAY_FILTER_USE_BOTH fix; 13 new camelCase keys in public_safe() |
| 3 | Create config.ts + refactor build.mjs for multi-entry | acafd57 | config.ts with KhaveeAvatarConfig v2 + CAMERA_PRESETS + LIGHT_INTENSITY + resolveSceneDefaults; mount.tsx re-exports type; preview.ts stub; build.mjs factory + safety grep |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Workspace dependency packages not built**
- **Found during:** Task 3 (node build.mjs execution)
- **Issue:** `@khaveeai/core`, `@khaveeai/react`, and `@khaveeai/providers-openai-realtime` had no `dist/` directory, causing esbuild to fail resolving their entry points
- **Fix:** Built the three dependency packages via `pnpm --filter <pkg> run build` before running `node build.mjs`
- **Files modified:** None (pre-existing workspace build state, not a code change)
- **Commit:** N/A (build-time setup, not committed)

None - plan executed exactly as written except for the dependency build setup above.

## Key Decisions Made

1. **ARRAY_FILTER_USE_BOTH type-aware callback** — replaced `static fn($v) => '' !== $v` with an explicit `if (is_string($v)) return '' !== $v; return true;` callback. This is the correctness fix documented in RESEARCH.md Pitfall warning: PHP loose comparison treats `'' == 0` as true, so the old callback silently stripped `0`, `0.0`, and `false` values (T-09-01-03).

2. **KhaveeAvatarConfig moved to config.ts, re-exported from mount.tsx** — index.ts:17 `import type { KhaveeAvatarConfig } from "./mount"` remains valid; the re-export (`export type { KhaveeAvatarConfig } from "./config"`) makes the move transparent to consumers.

3. **preview.ts stub** — esbuild requires the entry file to exist at build time. The stub contains only a `console.log` and no imports, so the safety grep assertion passes trivially. Plan 09-03 overwrites it with the real `mountAllPreviews()` implementation.

4. **build.mjs safety grep runs in non-watch branch only** — watch mode cannot safely grep partially-written output files; the assertion only matters at CI/release build time.

## Threat Surface Scan

All threats from the plan's threat_model are mitigated:

| T-ID | Mitigation Applied |
|------|--------------------|
| T-09-01-01 | All new keys pass through existing `esc_attr(wp_json_encode(...))` at AvatarRenderer.php:93; each cast to primitive before public_safe() |
| T-09-01-02 | bgImageId cast to `(int)` and resolved only via `wp_get_attachment_url()` — no user URL strings accepted |
| T-09-01-03 | ARRAY_FILTER_USE_BOTH type-aware callback preserves 0/0.0/false values |
| T-09-01-04 | public_safe() has no reference to get_api_key() or any secret (grep confirms) |
| T-09-01-05 | build.mjs grep assertion established; fails build on /RealtimeProvider\|getUserMedia\|ephemeral/ in preview output |
| T-09-01-SC | Zero new packages installed |

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `console.log("preview entry stub")` | packages/wp-bundle/src/preview.ts | Placeholder for plan 09-03's mountAllPreviews() implementation |

## Self-Check: PASSED

- All 7 modified files committed across 3 commits: dc609ef, 3ddaa12, acafd57
- Both block.json copies byte-identical (diff exits 0)
- All 3 PHP files pass `php -l`
- `pnpm exec tsc --noEmit` exits 0
- `node build.mjs` exits 0; safety assertion prints "passed"
- `wordpress-plugin/build/khaveeai-bundle.js` exists and contains RealtimeProvider
- `wordpress-plugin/build/khaveeai-preview.js` exists with 0 forbidden-token matches
- `packages/wp-bundle/src/config.ts` created with all required exports
- `packages/wp-bundle/src/index.ts` unchanged
