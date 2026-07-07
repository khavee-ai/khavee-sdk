---
phase: quick-260707-oyu
plan: 01
subsystem: wordpress-plugin (Settings page + wp-bundle preview)
tags: [wordpress, settings-page, react-three-fiber, webgl, admin-ui]
status: checkpoint-reached
dependency-graph:
  requires: [260707-0u6]
  provides: [avatar-two-col-layout, mock-chat-containment, transparent-toggle-genuine-fix]
  affects: [wordpress-plugin/includes/Admin/SettingsPage.php, packages/wp-bundle/src/preview/PreviewScene.tsx, packages/wp-bundle/src/mount.tsx]
tech-stack:
  added: []
  patterns: [reuse-existing-two-col-css-class, container-css-drives-canvas-background-not-gl-alpha]
key-files:
  created: []
  modified:
    - wordpress-plugin/includes/Admin/SettingsPage.php
    - packages/wp-bundle/src/preview/PreviewScene.tsx
    - packages/wp-bundle/src/mount.tsx
    - wordpress-plugin/build/khaveeai-preview.js
    - wordpress-plugin/build/khaveeai-bundle.js
decisions:
  - "Avatar section two-column layout mirrors the Floating Widget card EXACTLY (same CSS classes/widths/breakpoints), per locked decision D — no new layout mechanism"
  - "Transparent-toggle bug: disproven the commit 5a39d51 'Canvas key-prop remount' hypothesis via source-level trace (not guesswork) — root cause is that the remount was a no-op that only added WebGL-context churn risk; fix removes the key + differentiated gl prop entirely"
metrics:
  duration: ~90 min (Tasks 1-3)
  completed: 2026-07-07
---

# Phase quick-260707-oyu Plan 01: Settings Page Follow-Up Fixes Summary

Three follow-up fixes to the Khavee WordPress admin Settings page: Avatar section preview moved into a right-hand column matching the Floating Widget layout; mock chat bubbles now nested inside a real chat-box wrapper (header + bounded transcript) matching `ChatBox.tsx`; and the transparent-toggle bug given a genuine, source-verified root-cause fix (removing a functionally-inert, WebGL-context-churning `key`-based Canvas remount) that replaces the disproven `key`-prop hypothesis from commit `5a39d51`.

**Status: CHECKPOINT REACHED.** Tasks 1-3 are complete, committed, and automated-verified (PHP `-l`, PHP test harnesses, TypeScript build/typecheck). Task 4 (`checkpoint:human-verify`, live confirmation in wp-env) could not be completed by this agent — see "Checkpoint Status" below for why, and exactly what still needs manual verification.

## Tasks Completed

### Task 1 — Avatar section two-column preview layout (OYU-01)

`render_page()`'s Avatar card now wraps its `form-table` (left) and `render_avatar_section_preview_mount()`'s output (right, inside `.khaveeai-settings__preview-col`) in `.khaveeai-settings__two-col` — the exact same CSS classes the Floating Widget card already uses (defined once in `render_settings_page_styles()`, including the `@media (max-width:1100px)` single-column collapse). No new CSS class was added; the mount div's id/class/data-attribute (`#khaveeai-avatar-preview`) is untouched. Dropped the now-redundant `margin-top:16px` on the "Live preview" heading since it now sits at the top of its own column.

Commit: `c342a56`

### Task 2 — Mock chat transcript containment (OYU-02)

Rewrote `render_floating_preview_mock_chat()` to match `ChatBox.tsx`'s real DOM nesting: `khaveeai-chat khaveeai-chat--below` > `khaveeai-chat__header` ("AI Assistant") + `khaveeai-chat__transcript` > three bubbles. Removed the inline `max-height:none; width:360px` overrides that previously defeated `.khaveeai-chat--below`'s own CSS (`max-height:400px`, `margin:16px`, a bounded `overflow:hidden` flex column) and omitted the header entirely — that inline-style override was the actual containment defect. No new CSS or JS was added; the fix reuses the already-compiled `.khaveeai-chat*` classes. `.khaveeai-chat--below`'s default `width:calc(100% - 32px)` already fits comfortably inside the ~360px preview column, so no width override was needed.

Commit: `55a0fce`

### Task 3 — Transparent-toggle bug: genuine root-cause fix (OYU-03)

**This is the substantive investigation task.** Re-investigated from scratch per the plan's explicit instruction not to repeat the untested `5a39d51` Canvas-`key`-prop-remount hypothesis.

**Investigation method:** Direct source-level trace against the actually-installed `@react-three/fiber@9.3.0` and `three@0.180.0` packages in `node_modules` (not documentation, not guesswork):

1. `@react-three/fiber`'s renderer-creation code (`dist/react-three-fiber.cjs.dev.js` / `events-*.cjs.dev.js`) does:
   ```js
   const defaultProps = { canvas, powerPreference: 'high-performance', antialias: true, alpha: true };
   gl = new THREE.WebGLRenderer({ ...defaultProps, ...glConfig });
   ```
   When `glConfig` (the `gl` prop) is `undefined`, `...glConfig` is a no-op spread — `alpha` stays `true` from `defaultProps`. **The prior "opaque" branch's `gl={undefined}` NEVER produced an `alpha:false` context — it was always identical to `gl={{alpha:true}}`.** This disproves the entire premise of the `5a39d51` fix: the two `key`-branched Canvas mounts ("gl-alpha" / "gl-opaque") were rendering with the SAME renderer settings the whole time.
2. `three.js`'s `WebGLBackground` module (`build/three.cjs:60073`) further confirms: `let clearAlpha = alpha === true ? 0 : 1;` — since `alpha` was always `true` (per #1), the canvas has ALWAYS cleared to fully transparent by default in both branches. This is consistent with the file's own stated design (`PreviewScene.tsx`'s header comment: background is applied to the container div's CSS, "NOT to scene.background... avoids three.js background clear-color interaction") — the canvas was never supposed to block the container's color; the container's CSS `background` property does 100% of the actual visible switching, and it already recomputes correctly on every render from live `config` (traced through `rebuild()`'s JS in `SettingsPage.php` → `mount.dataset.khaveeaiPreviewConfig` → `PreviewHost`'s `MutationObserver` → `setConfig` → `containerStyle.background`).

**Root cause, stated plainly:** The `key={bgTransparent ? "gl-alpha" : "gl-opaque"}` prop added in `5a39d51` forced React to fully unmount and remount the entire `<Canvas>` subtree (destroying and recreating the WebGLRenderer/WebGL context, and reloading the VRM avatar) on **every single checkbox toggle** — for **zero actual behavioral difference** in the renderer's alpha/transparency handling (both branches were already identical). This directly contradicts `mountPreview.tsx`'s own explicitly-documented design goal ("This keeps a single Canvas/WebGL context alive for the lifetime of the block"). Repeatedly creating/destroying WebGL contexts in quick succession — exactly the "toggle a few times" scenario the Task 4 checkpoint's own verify steps call for — is a well-known trigger for WebGL context loss/exhaustion in browsers (limited concurrent-context budgets), which is the most plausible explanation for a toggle sequence going genuinely "stuck" after the code otherwise traces out as correct.

I considered and rejected the plan's literal "candidate fix" (explicitly set `gl={{alpha:false}}` on the opaque branch) after tracing it further: making the context genuinely `alpha:false` would default `clearAlpha` to `1` with the renderer's default `clearColor` of `0x000000` (black) — since nothing in this code ever calls `setClearColor(config.bgColor)` (by design, to avoid the "three.js background clear-color interaction" the file's own comment says to avoid), that literal fix would have painted the canvas **solid black**, hiding the container's actual configured `bgColor` — a worse regression than the reported bug, not a fix.

**The fix applied** (both `PreviewScene.tsx` and `mount.tsx`'s `AvatarScene`, per locked decision D on scope parity — the same defect/pattern existed verbatim in both files):
- Removed the `key={...}` prop from `<Canvas>` entirely.
- Removed the differentiated `canvasGl` value; `<Canvas gl={{ alpha: true }}>` is now a **constant** prop.
- The container div's `background` CSS (already correct, unchanged) is now the sole mechanism switching between `"transparent"` and `config.bgColor`.
- Extended the file-header and inline pitfall comments in both files to record this trace and explicitly supersede the disproven `5a39d51` narrative (comments are preserved, not deleted, per the codebase's traceability-comment convention).

**Automated verification performed:**
- `pnpm --filter @khaveeai/wp-bundle typecheck` — clean.
- `pnpm --filter @khaveeai/core build`, `@khaveeai/react build`, `@khaveeai/providers-openai-realtime build` — all clean (needed first; this worktree had no `node_modules` installed at all — ran `pnpm install` from the existing lockfile, a standard dependency install, not a new-package install).
- `pnpm --filter @khaveeai/wp-bundle build` — clean; STUDIO-02 safety assertion passed (no `RealtimeProvider`/`getUserMedia`/`ephemeral` in `khaveeai-preview.js`); all four `build/khaveeai-*` artifacts regenerated (CSS files are byte-identical since no CSS-affecting code changed — no diff, as expected).
- `grep -c "gl-opaque\|gl-alpha"` on both rebuilt bundles returns `0` — confirms the removed key strings are genuinely gone from the compiled output, not just the source.
- All 5 PHP test harnesses run: `platform-config-harness.php`, `render-logic-harness.php`, `token-provider-harness.php`, `rest-logic-harness.php` — all cases PASSED. `settings-page-harness.php` shows exactly the same single pre-existing, already-documented, unrelated failure (`shape: get_runtime_config() returns exactly the keys {instructions, voice, avatar_url, model}`) with no new failures.

Commit: `3f4fa74`

## Checkpoint Status (Task 4 — NOT completed by this agent)

Task 4 is a `checkpoint:human-verify` requiring live interactive confirmation in wp-env at `http://localhost:8888/wp-admin/admin.php?page=khaveeai-settings`. **This agent could not perform that live verification**, for two independent, environment-level reasons:

1. **No browser automation tooling is available in this session** — only `Read`/`Write`/`Edit`/`Bash` tools are available; there is no Playwright/Puppeteer/similar MCP tool registered to drive a real browser, click checkboxes, or visually inspect WebGL canvas rendering.
2. **wp-env's plugin mount does not reflect this worktree.** Inspecting the running `wp-env-wordpress-plugin-d9d2827f-wordpress` container (`docker inspect ... --format '{{json .Mounts}}'`) shows the plugin directory is bind-mounted from `/Users/whitemalt/Documents/khavee-sdk/wordpress-plugin` — the **main repository checkout**, not this worktree (`/Users/whitemalt/Documents/khavee-sdk/.claude/worktrees/agent-a26bc41b130a97713/wordpress-plugin`). The main checkout is currently at commit `87ee5d6` (same branch, `feat/multiple-provider`), i.e. **before** this quick task's three commits. Even with a browser tool, wp-env as currently configured would serve the PRE-fix code, not the changes made here. This is a structural consequence of the parallel-worktree execution model and is out of scope for this agent to fix (it is not part of any task in this plan, and copying files into the main checkout from inside a worktree would violate worktree isolation).

**What still needs manual verification, and why**, exactly per the plan's Task 4 `how-to-verify` steps, once this worktree's branch is merged/available to whatever WordPress environment is used for verification:

1. **AVATAR LAYOUT** — Confirm the Avatar section shows fields on the LEFT, live preview on the RIGHT (matching Floating Widget's two-column look), and collapses to single column below ~1100px viewport width.
2. **MOCK CHAT** — Confirm the three mock chat bubbles sit INSIDE a white chat-box card with an "AI Assistant" header, properly contained (not loose/overflowing).
3. **TRANSPARENT TOGGLE** — CHECK "Transparent floating background" (preview should go transparent), then UNCHECK it (preview MUST return to the opaque background color — this is the bug being fixed). Toggle a few times to confirm reliability. This is the step my code trace is confident about but cannot visually confirm myself.
4. **REGRESSION** — Confirm color picker, offset/scale/camera-angle sliders, and orbit-drag still update the Floating preview live (prior 260706 wiring must survive; nothing in Tasks 1-3 touched that wiring, but live confirmation is still prudent).

If verification reveals the transparent-toggle bug is STILL present after this fix, per the plan's own resume-signal guidance, a second root-cause pass would be needed — but note that step 3's failure mode would now be informative: if it's STILL stuck, the bug is confirmed to be in the `containerStyle.background` / `rebuild()` / `MutationObserver` chain (which this investigation traced as structurally correct but could not visually confirm), not in the Canvas GL layer (which is now conclusively fixed/simplified per the source-level proof above).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Worktree had no `node_modules` installed**
- **Found during:** Task 3 verification (`pnpm --filter @khaveeai/wp-bundle build` failed with `ERR_MODULE_NOT_FOUND` for `esbuild`)
- **Issue:** This worktree checkout had never had `pnpm install` run — no `node_modules` existed anywhere in the tree.
- **Fix:** Ran `pnpm install` from the existing, committed `pnpm-lock.yaml` (a standard dependency install from the existing lockfile, not introducing any new package) at the workspace root, then built `@khaveeai/core`, `@khaveeai/react`, and `@khaveeai/providers-openai-realtime` (workspace-local dependencies `@khaveeai/wp-bundle` needs pre-built `dist/` output from) before the `wp-bundle` build would resolve.
- **Files modified:** None (only `node_modules/` populated, which is gitignored).
- **Commit:** N/A (no tracked files changed by this step).

**2. [Rule 1 - Bug, genuine root-cause reversal of plan's literal candidate fix] Did not apply the plan's literal `gl={{alpha:false}}` suggestion verbatim**
- **Found during:** Task 3 investigation
- **Issue:** The plan's `<action>` block suggested, as a "candidate fix," setting `gl={{ alpha: false }}` on the opaque branch. Tracing this through `three.js`'s `WebGLBackground` source showed this would default `clearAlpha` to `1` with the renderer's default `clearColor` of black — painting the canvas solid black instead of the user's configured background color, since nothing in this code sets `setClearColor` to match `config.bgColor` (by design). This would have been a worse regression than the bug being fixed.
- **Fix:** Applied a different, smaller, and — per source-level trace — actually-correct fix: remove the `key` and the differentiated `gl` config entirely, since both branches were already functionally identical (`alpha:true`); let the Canvas mount once with a constant `gl={{alpha:true}}` and let the (already-correct) container CSS drive the visible background exclusively.
- **Files modified:** `packages/wp-bundle/src/preview/PreviewScene.tsx`, `packages/wp-bundle/src/mount.tsx`
- **Commit:** `3f4fa74`

### Deferred to Task 4 (not a deviation — per plan design)

Live human verification of all three fixes (see "Checkpoint Status" above).

## Known Stubs

None — no stub patterns (hardcoded empty UI data, placeholder text, unwired components) were introduced by this plan.

## Threat Flags

None — no new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries were introduced. All three fixes are presentation-layer (admin-only PHP markup) and rendering-layer (WebGL canvas config) changes with no new data flow.

## Self-Check: PASSED

All modified files verified present on disk:
- `wordpress-plugin/includes/Admin/SettingsPage.php` — FOUND
- `packages/wp-bundle/src/preview/PreviewScene.tsx` — FOUND
- `packages/wp-bundle/src/mount.tsx` — FOUND
- `wordpress-plugin/build/khaveeai-preview.js` — FOUND
- `wordpress-plugin/build/khaveeai-bundle.js` — FOUND

All three task commits verified present in `git log`:
- `c342a56` (Task 1) — FOUND
- `55a0fce` (Task 2) — FOUND
- `3f4fa74` (Task 3) — FOUND
