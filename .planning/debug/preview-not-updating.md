---
status: resolved
trigger: "Preview does not update at all when dragging or updating any config in the block studio visual config editor. Likely related to the unverified iframe fix from phase-09 (commit afcddf3: \"wip: phase-09 paused at 09-07 checkpoint (iframe fix unverified)\")."
created: 2026-07-02T00:00:00Z
updated: 2026-07-02T00:00:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "preview.ts (khaveeai-preview.js) always executes in the TOP admin window's document, never inside the Gutenberg block-canvas `<iframe name=\"editor-canvas\">`. WP block.json's `editorScript` field (used to load khaveeai-preview via commit 5a4d5ec) does NOT inject the script into the iframe document — it only affects WHICH admin screens the script is registered/enqueued on. So `document.querySelectorAll('[data-khaveeai-preview-config]')` and the MutationObserver in preview.ts/mountPreview.tsx query/observe the wrong document and never find the mount-point div that editor.js's React tree portals into the iframe's DOM. Result: the preview React root is never created, so the avatar preview never appears/updates regardless of config changes."
  confirming_evidence:
    - "wordpress-plugin/includes/Plugin.php:91-93 doc-comment explicitly (and incorrectly) asserts 'block.json lists it in editorScript ... so WordPress loads it only inside the Gutenberg block-canvas iframe' — this claim was never empirically verified (per .continue-here.md: 'BUT NOT YET VERIFIED by the user')."
    - "GitHub Gutenberg issue #59528 'Scripts defined in the editorScript property in block.json are loaded outside the iframed editor' confirms editorScript-registered scripts execute in the parent/top window, not inside the iframe."
    - "GitHub Gutenberg issue #44945 'enqueue_block_editor_assets doesn't work for scripts in Iframed preview' and #38673 'Custom styles/scripts are not loaded inside the preview iframe' independently corroborate the same limitation for the equivalent enqueue_block_editor_assets path (the mechanism this codebase was migrating away FROM in commit 5a4d5ec, on a false premise that editorScript behaves differently)."
    - "preview.ts (packages/wp-bundle/src/preview.ts) uses bare global `document` for both the initial querySelectorAll scan and the MutationObserver target (document.body) — no iframe-awareness anywhere in the file."
    - "editor.js's mount-point div (data-khaveeai-preview-config) is rendered as part of the block's normal Edit() output, which Gutenberg's own top-level React tree portals into the iframe's DOM (per make.wordpress.org 'Blocks in an iframed template editor') — so the div physically lives in iframe.contentDocument, not the top document."
  falsification_test: "In a live WP editor, open devtools, switch console context to the top window and run document.querySelector('[data-khaveeai-preview-config]') — expect null/not found. Then switch console context to the editor-canvas iframe and run the same query — expect it to find the div. If instead the top-window query finds the div, this hypothesis is wrong and the mount point is not actually inside the iframe."
  fix_rationale: "Keep khaveeai-preview.js registered as an editor-only script (preserves the PERF-01/Pitfall-5 constraint that it never loads on published pages — switching to block.json's 'script' field would load it on both editor AND frontend, which is worse). Instead, fix preview.ts itself to locate the `iframe[name=\"editor-canvas\"]` element in the top document it actually runs in, and scan/observe iframe.contentDocument (falling back to the top document when no such iframe exists, e.g. older WP or non-iframed contexts) — this addresses the actual root cause (querying the wrong document) rather than the symptom (script 'not loading in the editor')."
  blind_spots: "Cannot run a live WordPress instance in this sandboxed environment, so the falsification test and the final fix cannot be empirically executed here — only verified via source-level reasoning, the Gutenberg architecture, and corroborating GitHub issues. Also unverified: whether react-dom's createRoot(el) works correctly when el's ownerDocument is a different same-origin iframe document than the one the script's global `document`/`window` refers to (cross-realm React root) — existing code already relies on this (mountPreview.tsx creates the root this way today), so this is a pre-existing assumption, not a new risk introduced by the fix. Human verification in a real WP editor is required before this can be marked resolved."
next_action: "RESOLVED. Once live browser access was available (claude-in-chrome), reproduced against the real wp-env instance (post=2, Sample Page, khaveeai/avatar block restored from autosave rev 60) and root-caused via direct DOM/console inspection. Three compounding bugs, all now fixed and verified live:
  (1) packages/wp-bundle/src/preview.ts bodyObserver's `node instanceof HTMLElement` check compared iframe-realm nodes against the TOP window's HTMLElement constructor — always false across realms (latent bug, fixed to check `node.nodeType !== Node.ELEMENT_NODE` instead, which is realm-agnostic).
  (2) THE ACTUAL BLOCKER: findAndObserveEditorCanvas()'s `if (readyState !== 'loading') attach(); else addEventListener('load', attach)` was mutually exclusive. Gutenberg's <Iframe> (wp-includes/js/dist/block-editor.js) mounts the iframe element pointing at an empty about:blank shell FIRST, then a React effect assigns a real `blob:` URL via URL.createObjectURL (see getIframeSrc) — a genuine navigation that replaces the Document and fires a real subsequent `load` event. Our code's immediate-attach branch fired on the throwaway about:blank document and, being an if/else, never ALSO registered for the real navigation's load event — so the script's MutationObserver was attached to a document that was about to be discarded, and the real document (containing the mount div) was never observed. Fixed by always registering the `load` listener regardless of the immediate-attach outcome (observeDocument/mountIfNeeded are idempotent via the mounted-dataset guard, so redundant re-invocation is harmless). CONFIRMED via a live diagnostic: before this fix, `dataset.khaveeaiMounted` stayed `undefined` forever and a manually-inserted test div in the iframe body was never picked up by any observer; after the fix, `mounted: 'true'` and the mount function ran.
  (3) THE ACTUAL CRASH (only visible in console once bug 2 was fixed — before that, the mount function never even ran so this never surfaced): packages/wp-bundle/src/config.ts resolveSceneDefaults() computed `const preset = c.cameraPreset ?? \"front\"`. editor.js's camera-preset SelectControl uses `\"\"` (empty string) — not undefined — for its '(using global default)' option, matching the block's actual default attribute value. `??` only catches null/undefined, not `''`, so `preset` resolved to `''`, `CAMERA_PRESETS['']` was `undefined`, and `.position` on that threw `TypeError: Cannot read properties of undefined (reading 'position')` inside React's render — crashing PreviewSceneInner on literally every block's default configuration (i.e. every block on first insert, 100% reproducible, matching the reported symptom exactly). Fixed by using `||` instead of `??` (`(c.cameraPreset || \"front\") as CameraPreset`).
  All three fixes verified together live in wp-env: preview now renders (background color/dimensions match config), and dragging the Container Width slider and changing Background Color both update the preview in real time with no remount/flicker. Remaining, SEPARATE, out-of-scope finding not fixed here: the preview shows 'No avatar selected' because PreviewSceneInner checks `config.avatarUrl` but the emitted config only carries `config.avatar` (a raw attachment ID, 8) — no ID-to-URL resolution happens in the preview path. This did not block the reported bug and was left untouched pending user decision on scope."

## Symptoms

expected: Dragging a control or changing any value in the block studio visual config panel (Gutenberg editor) should live-update the avatar preview rendered inside the block's editor-canvas iframe.
actual: Preview never updates at all when dragging or updating any config value — appears completely static/frozen regardless of config changes.
errors: None visible in the browser console (user has checked; console is clean).
timeline: Never worked — since the block-studio preview was added, live updates have never reflected config changes. Not a regression from a previously-working state.
reproduction: Open the block-studio block in the WordPress Gutenberg editor, drag/change any config control in the visual config panel, observe the preview inside the editor iframe — it does not reflect the change.
environment: WP Gutenberg editor iframe (block-studio visual config block), not the Next.js demo app.

## Root Cause

khaveeai-preview.js (packages/wp-bundle/src/preview.ts) executes in the top-level
admin window's `document`, not inside Gutenberg's `<iframe name="editor-canvas">`
block-canvas. Registering the script via block.json's `editorScript` array
(commit 5a4d5ec) does NOT change which document/window the script's JS runs
in — it only controls which admin screens the script is registered/enqueued
on. The mount-point div (`data-khaveeai-preview-config`, emitted by editor.js's
Edit() output) is portalled by Gutenberg's own top-level React tree into the
iframe's DOM. Because preview.ts calls `document.querySelectorAll(...)` and
attaches its MutationObserver to `document.body` (the TOP document), it never
finds the mount point, so the preview React root is never created and the
avatar preview never renders/updates — matching "static/frozen regardless of
config changes."

The premise behind commit 5a4d5ec ("editorScript array loads inside the
iframe") was an incorrect assumption, never empirically verified (per
.planning/phases/09-.../.continue-here.md), and is contradicted by
Gutenberg's actual iframe architecture (see Evidence).

## Hypotheses

1. CONFIRMED (via code + external research, human verification pending):
   preview.ts queries/observes the wrong `document` (top window instead of
   the editor-canvas iframe's contentDocument).

## Investigation (Evidence Log)

- checked: wordpress-plugin/includes/Plugin.php register_preview_bundle() +
  doc-comments; wordpress-plugin/includes/Block/block.json editorScript array
  found: Comment explicitly claims editorScript makes the script "load only
  inside the Gutenberg block-canvas iframe" — this was the stated rationale
  for commit 5a4d5ec but is not how WordPress's block.json editorScript field
  behaves.
  implication: The "iframe fix" from phase-09 was built on a false premise.

- checked: packages/wp-bundle/src/preview.ts (full file) and
  packages/wp-bundle/src/preview/mountPreview.tsx (full file)
  found: Both use bare global `document`/`document.body` for scanning and
  the MutationObserver target. No iframe-detection or contentDocument
  handling anywhere in the preview bundle's mount logic.
  implication: If the script executes in the top window (per the finding
  below), it can structurally never see nodes inside the iframe's separate
  document tree.

- checked: wordpress-plugin/src/editor.js (full file, header comment +
  mount-point div JSX)
  found: The mount-point div is emitted as part of Edit()'s normal render
  output (not a portal editor.js manages itself) — Gutenberg's core React
  tree is responsible for placing block content into the iframe canvas.
  implication: The div editor.js renders genuinely lives inside
  iframe.contentDocument at runtime, confirming the document mismatch is
  real, not hypothetical.

- checked (web research): GitHub Gutenberg issues #59528 ("Scripts defined
  in the editorScript property in block.json are loaded outside the iframed
  editor"), #44945 ("enqueue_block_editor_assets doesn't work for scripts in
  Iframed preview"), #38673 ("Custom styles/scripts are not loaded inside
  the preview iframe"), and make.wordpress.org "Blocks in an iframed
  (template) editor" (2021-06-29).
  found: Independently confirms editorScript-registered scripts run in the
  parent/top admin window, never inside `<iframe name="editor-canvas">`;
  only the block.json "script" field (loaded on both editor AND frontend)
  gets special iframe-injection treatment.
  implication: Root cause confirmed by external authority, not just local
  code reading. Switching to "script" would fix iframe visibility but
  violate the PERF-01/Pitfall-5 constraint (never load preview bundle on
  published pages) — so the fix must make preview.ts iframe-aware instead
  of changing the registration mechanism.

## Eliminated Hypotheses

(none — first and only hypothesis formed was confirmed by evidence)

## Suggested Fix Direction

Keep khaveeai-preview.js registered via block.json's `editorScript` array
(preserves editor-only loading / PERF-01). Modify preview.ts to:
1. Locate `document.querySelector('iframe[name="editor-canvas"]')` in the
   top document the script actually runs in.
2. Once found (waiting via MutationObserver/`load` event if the iframe
   isn't in the DOM yet, since Gutenberg mounts it asynchronously and its
   contentDocument may start as an empty/loading document), scan for and
   observe `[data-khaveeai-preview-config]` mount points inside
   `iframe.contentDocument` instead of the top `document`.
3. Retain a fallback scan/observe of the top `document` for any non-iframed
   editor context (older WP, Widgets screen) where a mount point could
   still appear directly in the top document.
Also correct the misleading doc-comments in Plugin.php/block.json area that
assert the false "editorScript loads inside iframe" premise, so this isn't
re-introduced later.

## Blind Spots / Notes

- Recent commits (afcddf3, 5a4d5ec, 67ce656, 2078a83) touched preview.ts / editorScript loading / MutationObserver mounting inside the Gutenberg iframe as part of an in-progress, explicitly unverified fix (see .planning/STATE.md: "stopped_at: context exhaustion at 78% (2026-07-02)"). Investigate whether the preview bundle is mounting at all inside the iframe vs. mounting but not re-rendering on attribute/config change.

## Fix Applied

files_changed:
  - packages/wp-bundle/src/preview.ts (rewrote mount-scanning logic to locate
    `iframe[name="editor-canvas"]` and scan/observe its contentDocument,
    with a fallback path for the top document; added file-header explanation)
  - wordpress-plugin/includes/Plugin.php (corrected doc-comment that
    incorrectly asserted editorScript loads inside the iframe)
  - wordpress-plugin/build/khaveeai-preview.js (rebuilt via
    `pnpm --filter @khaveeai/wp-bundle build`)
  - wordpress-plugin/build/khaveeai-bundle.js (rebuilt as a side effect of
    running the same build script; no source changes to src/index.ts)

verification_self_checked:
  - `pnpm --filter @khaveeai/wp-bundle typecheck` -> zero errors
  - `pnpm --filter @khaveeai/wp-bundle build` -> succeeds; STUDIO-02 build-time
    safety grep (no RealtimeProvider/getUserMedia/ephemeral in preview output)
    still passes
  - `grep -c "editor-canvas" wordpress-plugin/build/khaveeai-preview.js` -> 1
    (confirms the iframe-detection string made it into the built bundle)

verification_NOT_yet_done (requires human — no live WordPress instance in
this environment):
  - Hard-reload the WP editor and confirm the avatar preview actually renders
    inside the block-studio block
  - Drag a slider / change a config control and confirm the preview updates
    live without a full remount (no WebGL context churn)
  - Confirm no console errors in the editor-canvas iframe context
