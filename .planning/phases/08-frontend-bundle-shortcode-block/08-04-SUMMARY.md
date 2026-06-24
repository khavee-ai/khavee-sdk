---
phase: 08-frontend-bundle-shortcode-block
plan: 04
subsystem: wordpress-plugin
tags: [gutenberg, block.json, wp-scripts, php, server-side-render, wordpress]

# Dependency graph
requires:
  - phase: 08-frontend-bundle-shortcode-block (plan 02)
    provides: AvatarRenderer::render(), AssetManager, Plugin.php composition root with $renderer wired for the shortcode
provides:
  - khaveeai/avatar Gutenberg block (block.json + AvatarBlock.php render_callback delegating to the shared AvatarRenderer)
  - Built editor.js (InspectorControls voice/instructions/avatar mirroring the settings page, ServerSideRender preview, zero @khaveeai/* imports)
  - wordpress-plugin standalone npm/@wordpress-scripts toolchain (intentionally outside the pnpm workspace)
affects: [08-frontend-bundle-shortcode-block remaining plans, any future Gutenberg/embed work]

# Tech tracking
tech-stack:
  added: ["@wordpress/scripts ^32.5.0 (devDependency, wordpress-plugin/package.json)"]
  patterns:
    - "Dynamic Gutenberg block: render_callback as the SINGLE render path for both editor (ServerSideRender) and front end — no viewScript, no client save() markup"
    - "Editor source kept OUTSIDE the webpack --output-path directory (wordpress-plugin/src/ vs assets/) to avoid output.clean deleting source on rebuild"

key-files:
  created:
    - wordpress-plugin/includes/Block/block.json
    - wordpress-plugin/includes/Block/AvatarBlock.php
    - wordpress-plugin/src/editor.js
    - wordpress-plugin/src/block.json
    - wordpress-plugin/package.json
    - wordpress-plugin/package-lock.json
    - wordpress-plugin/assets/editor.js (built artifact, committed)
    - wordpress-plugin/assets/editor.asset.php (built artifact, committed)
    - wordpress-plugin/assets/block.json (built artifact, committed — webpack JSON-import copy)
  modified:
    - wordpress-plugin/includes/Plugin.php (wires AvatarBlock reusing the existing $renderer, registers on init)
    - wordpress-plugin/.gitignore (added /node_modules/)

key-decisions:
  - "Moved editor source from the plan's suggested assets/src/editor.js to wordpress-plugin/src/editor.js — wp-scripts' webpack output.clean wipes --output-path (assets/) before every build, which would delete a nested assets/src/ source directory on the very first rebuild"
  - "Added /node_modules/ to wordpress-plugin/.gitignore — CLAUDE.md flags that root .gitignore only excludes the top-level /node_modules, and this plan introduces the first npm-based nested toolchain in wordpress-plugin/"

requirements-completed: []  # EMBED-03, EMBED-05 code/build verified; full requirement closure pending Task 3 live-WP checkpoint

# Metrics
duration: in progress (Tasks 1-2 complete; paused at Task 3 checkpoint)
completed: PENDING — checkpoint not yet resolved
---

# Phase 08 Plan 04: Gutenberg Block (interim — Task 3 checkpoint pending)

**khaveeai/avatar Gutenberg block built and wired through the shared AvatarRenderer; editor.js built and verified import/runtime-isolation-clean — live wp-env verification (Task 3) still required before this plan can close.**

## Performance

- **Started:** 2026-06-24T22:08:00Z (approx, per STATE.md session)
- **Tasks completed:** 2 of 3 (Task 3 is a `checkpoint:human-verify` requiring a live WordPress install)
- **Files modified:** 11

## Accomplishments

- `block.json` declares `khaveeai/avatar` with attributes mirroring the shortcode 1:1 (`voice`, `instructions`, `avatar`); deliberately no `viewScript`, no `render` field.
- `AvatarBlock::render_callback()` delegates to the SAME `AvatarRenderer` instance the shortcode uses (EMBED-04 parity) — `Plugin.php` constructs exactly one `AvatarRenderer` for both.
- `src/editor.js` registers the block with `InspectorControls` (voice `SelectControl` with all 10 voices + "(using global default)" placeholder, instructions `TextareaControl`, `wp.media`-based avatar picker via `MediaUpload`/`MediaUploadCheck`), `save: () => null`, and a `ServerSideRender` preview — built and verified to contain zero `RTCPeerConnection` references and zero imports from any `@khaveeai/*` package.
- Standalone `wordpress-plugin/package.json` + `@wordpress/scripts` toolchain installed and built successfully (`npm install && npm run build`), producing the committed `assets/editor.js` + `editor.asset.php`.

## Task Commits

Each task was committed atomically:

1. **Task 1: block.json + AvatarBlock.php (render_callback delegates to shared renderer) + Plugin.php wiring** - `d4a08b1` (feat)
2. **Task 2: assets/editor.js — block registration + InspectorControls + ServerSideRender + @wordpress/scripts build** - `0a4537f` (feat)
3. **Task 3: Live WordPress verification** - NOT STARTED (checkpoint:human-verify — requires a live wp-env/Docker or manual local WP install; cannot be automated by the executor)

**Plan metadata commit:** pending — will be created once Task 3 resolves and the plan is fully complete.

## Files Created/Modified

- `wordpress-plugin/includes/Block/block.json` - Block metadata: `khaveeai/avatar`, attributes (voice/instructions/avatar), `editorScript`, no `viewScript`/`render`
- `wordpress-plugin/includes/Block/AvatarBlock.php` - `register()` + `render_callback()` delegating to the shared `AvatarRenderer`, normalizing empty/zero attrs identically to `AvatarShortcode`
- `wordpress-plugin/includes/Plugin.php` - Reuses the existing `$renderer`/`$config_source` to construct and register `AvatarBlock` on `init`
- `wordpress-plugin/package.json` - Standalone `@wordpress/scripts` build, marked `private: true`, with an explicit `_comment` documenting it is intentionally outside the pnpm workspace
- `wordpress-plugin/package-lock.json` - npm lockfile for the standalone toolchain
- `wordpress-plugin/src/editor.js` - Block registration + `InspectorControls` + `ServerSideRender`, zero `@khaveeai/*` imports
- `wordpress-plugin/src/block.json` - Copy of the block metadata consumed by `registerBlockType()` in the editor bundle (webpack JSON import)
- `wordpress-plugin/assets/editor.js`, `wordpress-plugin/assets/editor.asset.php`, `wordpress-plugin/assets/block.json` - Built artifacts, committed (zero-toolchain install for plugin distribution, same rationale as the front-end bundle)
- `wordpress-plugin/.gitignore` - Added `/node_modules/` to exclude the new npm toolchain's dependency tree

## Decisions Made

- **Editor source relocated to `wordpress-plugin/src/` instead of the plan's literal `assets/src/editor.js` path.** `@wordpress/scripts build <entry> --output-path=assets` runs webpack with `output.clean` enabled by default, which deletes the entire `--output-path` directory before each build. Since `assets/src/` is nested INSIDE `assets/`, the very first rebuild would have deleted the source file that produced the build. Moving source to a sibling `wordpress-plugin/src/` directory (output remains `assets/`) preserves the source across rebuilds while keeping the build output exactly where `block.json`'s `editorScript: "file:../../assets/editor.js"` path expects it. This is a Rule 1 (bug) auto-fix — the plan's literal path would have silently destroyed source on the next `npm run build`.
- **Added `/node_modules/` to `wordpress-plugin/.gitignore`.** The root `.gitignore` only excludes the top-level `/node_modules` (per CLAUDE.md's explicit warning), and this plan introduces the first npm-based nested toolchain inside `wordpress-plugin/`. Without this, `wordpress-plugin/node_modules/` would appear as untracked and risk being staged. Rule 2 (missing critical hygiene).
- Comment wording in `src/editor.js` documenting "no `@khaveeai/*` imports" was phrased to avoid the literal substring `@khaveeai/` so the project's own `grep -c "@khaveeai/"` acceptance check (intended to catch real import statements) doesn't false-positive on documentation prose.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Editor source path changed from `assets/src/editor.js` to `src/editor.js`**
- **Found during:** Task 2 (first `npm run build` run)
- **Issue:** Plan specified source at `wordpress-plugin/assets/src/editor.js`, output at `wordpress-plugin/assets/`. `wp-scripts build --output-path=assets` cleans (deletes) the entire output directory before each build by default — the first build run deleted `assets/src/editor.js` along with anything else previously in `assets/`, since `src/` was a child of the cleaned `assets/` directory.
- **Fix:** Moved editor source (and its co-located `block.json` import) to `wordpress-plugin/src/`, a sibling of `assets/` rather than a child. Updated `package.json`'s build script to `wp-scripts build src/editor.js --output-path=assets`. Verified the relocated source survives a second `npm run build` run unchanged.
- **Files modified:** wordpress-plugin/package.json, wordpress-plugin/src/editor.js (new location), wordpress-plugin/src/block.json (new location)
- **Verification:** Ran `npm run build` twice in succession; `wordpress-plugin/src/editor.js` and `wordpress-plugin/src/block.json` remained present after both runs; `wordpress-plugin/assets/editor.js` rebuilt successfully each time.
- **Committed in:** 0a4537f (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added `/node_modules/` to wordpress-plugin/.gitignore**
- **Found during:** Task 2 (post-`npm install`, pre-commit `git status` check)
- **Issue:** `wordpress-plugin/node_modules/` appeared as untracked after `npm install`; the repo-root `.gitignore` only excludes the top-level `/node_modules`, not nested workspace/toolchain `node_modules` directories (explicitly flagged as a hazard in this session's CLAUDE.md/operator instructions).
- **Fix:** Added a local `wordpress-plugin/.gitignore` entry (`/node_modules/`), alongside the pre-existing `/vendor/` Composer exclusion.
- **Files modified:** wordpress-plugin/.gitignore
- **Verification:** `git status --short` after the gitignore edit no longer lists `wordpress-plugin/node_modules/` as untracked.
- **Committed in:** 0a4537f (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical hygiene)
**Impact on plan:** Both fixes were necessary for correctness (source survival across rebuilds) and repo hygiene (no generated dependency tree accidentally staged). No scope creep — the block/editor functionality matches the plan's `<action>` and `<acceptance_criteria>` exactly; only the on-disk source path and a gitignore entry changed.

## Issues Encountered

None beyond the two auto-fixed deviations above. `npm install` produced `EBADENGINE` warnings for some transitive Jest-family packages (Node v23.5.0 vs their `^18 || ^20 || ^22 || >=24` engine range) — these are non-fatal warnings, not errors; the install and build both completed successfully.

## User Setup Required

None - no external service configuration required for Tasks 1-2. Task 3 (the live-WP checkpoint) requires a WordPress runtime (wp-env/Docker or manual local install) which is environment setup, not external service credentials — see Checkpoint section below.

## Next Phase Readiness

**This plan is NOT complete.** Tasks 1 and 2 are fully verified (PHP lint clean, block.json valid with no viewScript/render, editor bundle built with zero RTCPeerConnection/zero @khaveeai/* imports, ServerSideRender wired). Task 3 — the `checkpoint:human-verify` live WordPress verification of PERF-01, EMBED-05, EMBED-01/03/02, and Criterion 6 — has NOT been performed and requires either:
- A live `wp-env`/Docker WordPress install, or
- A manual local WordPress install

with the plugin activated, a real (or test) OpenAI API key configured, and the six manual checks in the plan's `<how-to-verify>` performed and recorded. See the `## CHECKPOINT REACHED` section returned alongside this summary for the exact steps and what is awaited.

---
*Phase: 08-frontend-bundle-shortcode-block*
*Status: PAUSED AT CHECKPOINT (Task 3 of 3)*

## Self-Check: PASSED

All 11 created/modified files referenced above were verified present on disk; both task commit hashes (`d4a08b1`, `0a4537f`) were verified present in `git log --oneline --all`.
