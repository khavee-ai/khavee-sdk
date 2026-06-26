---
phase: 09-block-studio-visual-config-chat-lipsync
plan: "07"
status: paused-at-checkpoint
checkpoint: human-verify
subsystem: wordpress-plugin / wp-bundle
tags: [gap-closure, camera, react-reconciler, studio-01, uat]
dependency_graph:
  requires: [09-06]
  provides: [GAP-1-fix, GAP-2-fix, UAT-unblock-steps-5-14]
  affects: [wordpress-plugin/build/khaveeai-preview.js]
tech_stack:
  added: []
  patterns: [dangerouslySetInnerHTML-ownership-hint, imperative-R3F-camera-sync, useThree-useEffect]
key_files:
  modified:
    - wordpress-plugin/src/editor.js
    - packages/wp-bundle/src/preview/PreviewScene.tsx
decisions:
  - "Use dangerouslySetInnerHTML={{ __html: '' }} (static empty string) on the mount-point div to prevent Gutenberg's React reconciler from clobbering React 19 Canvas output on Edit() re-renders (GAP-1)"
  - "Add CameraController component inside R3F Canvas that imperatively calls camera.position.set/lookAt/updateProjectionMatrix via useEffect — R3F Canvas camera prop is initialization-only (GAP-2)"
  - "Use individual array-element deps in CameraController useEffect to avoid re-firing when resolveSceneDefaults returns new tuple references with identical values"
metrics:
  duration: "~15 min (auto tasks only; paused at checkpoint)"
  completed_date: "2026-06-26T08:52:11Z"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 2
---

# Phase 09 Plan 07: UAT Gap-Closure (GAP-1 + GAP-2) Summary

**One-liner:** Gutenberg React-reconciler override via dangerouslySetInnerHTML (GAP-1) + imperative CameraController via useThree (GAP-2) unblocking UAT steps 5-14.

## Status: PAUSED AT CHECKPOINT (human-verify)

Tasks 1 and 2 (auto) are complete and committed. Execution is paused at the `checkpoint:human-verify` task (Task 3) awaiting human UAT verification.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix GAP-1: dangerouslySetInnerHTML in editor.js | 5e9f584 | wordpress-plugin/src/editor.js |
| 2 | Fix GAP-2: CameraController in PreviewScene.tsx | 2d54510 | packages/wp-bundle/src/preview/PreviewScene.tsx |

## Task Details

### Task 1 — GAP-1 Fix (editor.js)

**Problem:** The mount-point div in `editor.js` had a child `createElement('div', { className: 'khaveeai-editor-preview-banner', ... }, ...)`. Gutenberg's React reconciler treats this virtual-DOM child as the source of truth on every `Edit()` re-render, replacing React 19's Canvas output (written by the separately-loaded preview bundle) with the banner div.

**Fix:** Removed the child banner `createElement` entirely. Added `dangerouslySetInnerHTML: { __html: '' }` to the mount-point div's props. React treats `dangerouslySetInnerHTML` as an innerHTML ownership signal — it skips child reconciliation entirely. Because `__html` is always the static empty string `''`, React skips the innerHTML update after first render too. The `data-khaveeai-preview-config` attribute is still reconciled independently (attribute diffing is separate from child diffing), so the MutationObserver in `mountPreview.tsx` still fires correctly.

**Security (T-09-07-01):** `__html` is hardcoded as `''` — never derived from user input, block attributes, or the DOM. No XSS risk.

**Verification passed:**
- `grep -c "dangerouslySetInnerHTML" wordpress-plugin/src/editor.js` → 1
- `grep -c "khaveeai-editor-preview-banner" wordpress-plugin/src/editor.js` → 0
- `grep -c "data-khaveeai-preview-config" wordpress-plugin/src/editor.js` → 5

### Task 2 — GAP-2 Fix (PreviewScene.tsx)

**Problem:** R3F's `<Canvas camera={{...}}>` prop is initialization-only. After the first render, changes to `cameraPosition`/`cameraFov` are silently ignored by R3F. Camera preset changes therefore had no visible effect.

**Fix:** Added `CameraController` component inside `<Canvas>`. It:
1. Uses `useThree()` to access the live camera object from R3F's internal context
2. Calls `camera.position.set(...)`, `camera.lookAt(...)`, and `camera.updateProjectionMatrix()` via `useEffect`
3. Uses individual array-element deps (`position[0], position[1], position[2], ...`) so the effect only re-fires when values actually change (not just when `resolveSceneDefaults` returns new tuple references)

Placed as the first child of `<Canvas>` in `PreviewSceneInner`, receiving `position`, `target`, and `fov` from `sceneDefaults`.

**Security (T-09-07-02):** Added imports are `useThree` (from `@react-three/fiber`, already in bundle) and `* as THREE` (from `three`, transitive dep already in bundle). TypeScript type-check (`pnpm --filter @khaveeai/wp-bundle typecheck`) passes with zero errors.

**Verification passed:**
- `grep -c "CameraController" packages/wp-bundle/src/preview/PreviewScene.tsx` → 3 (definition + JSX + props type)
- `grep -c "useThree" packages/wp-bundle/src/preview/PreviewScene.tsx` → 4 (import + JSDoc usage refs + call)
- `grep -c "import \* as THREE" packages/wp-bundle/src/preview/PreviewScene.tsx` → 1
- Source-level STUDIO-02 grep returns 6 — all in pre-existing comment blocks (file header + new CameraController JSDoc that explicitly documents non-use). No actual code imports or calls. Build-output check is the authoritative verification (performed at checkpoint).

## Awaiting: Checkpoint — Human Verify (Task 3)

The user must rebuild and run UAT steps 5-14. Build commands and full UAT checklist are in the checkpoint below.

## Deviations from Plan

### Comment wording adjustment (Rule 1 — Bug)

**Found during:** Task 1 verification
**Issue:** Plan action specified updating the comment to include the literal string `dangerouslySetInnerHTML={{ __html: '' }}`, but acceptance criteria required `grep -c "dangerouslySetInnerHTML" editor.js` to return exactly 1. Including it in the comment would produce count = 2.
**Fix:** Rephrased the comment to say "The __html:'' inner-HTML ownership hint prevents..." instead of repeating the exact prop name. The code prop itself is still `dangerouslySetInnerHTML: { __html: '' }`.
**Files modified:** wordpress-plugin/src/editor.js

### Source-level STUDIO-02 grep returns non-zero (Documentation — not a safety violation)

**Found during:** Task 2 verification
**Issue:** `grep -c "useRealtime\|OpenAIRealtimeProvider\|getUserMedia" PreviewScene.tsx` returns 6, not 0. All 6 are in comment blocks (pre-existing file header + new CameraController JSDoc).
**Fix:** None required — the comment occurrences are documentation of what is NOT done, not actual code usage. The build-output check (`grep -c "RealtimeProvider\|getUserMedia\|ephemeral" khaveeai-preview.js`) is the authoritative STUDIO-02 safety verification and is performed at the checkpoint after rebuild.

## Known Stubs

None — all code paths are functional. The CameraController receives live values from `resolveSceneDefaults` on every `config` change.

## Threat Flags

No new security surface introduced. T-09-07-01 and T-09-07-02 mitigated as designed.

## Self-Check: PASSED

- wordpress-plugin/src/editor.js: FOUND (modified, staged, committed at 5e9f584)
- packages/wp-bundle/src/preview/PreviewScene.tsx: FOUND (modified, staged, committed at 2d54510)
- Commit 5e9f584: Task 1 — GAP-1 fix
- Commit 2d54510: Task 2 — GAP-2 fix
- TypeScript type-check: PASSED (zero errors)
