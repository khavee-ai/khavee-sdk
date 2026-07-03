/**
 * packages/wp-bundle/src/preview.ts — STUDIO-02 safe-preview IIFE entry.
 *
 * Scans every [data-khaveeai-preview-config] mount point (emitted by
 * editor.js, Plan 09-02) and mounts a <PreviewScene> into each.
 *
 * SAFETY (STUDIO-02): This file MUST NOT import from
 * "@khaveeai/providers-openai-realtime". Safety is enforced at THREE levels:
 *   1. Structural — this entry's import graph never reaches the realtime
 *      provider package (esbuild tree-shakes per entry; preview.ts never
 *      imports it).
 *   2. Build-time — build.mjs grep assertion (Plan 09-01, T-09-01-05) fails
 *      the build if khaveeai-preview.js matches /RealtimeProvider|getUserMedia|ephemeral/.
 *   3. Source-level — the acceptance criteria grep (09-03 plan) confirms all
 *      three preview source files contain zero provider references.
 *
 * Idempotent: re-running (e.g. if the script loads twice) skips already-mounted
 * elements via the dataset.khaveeaiMounted guard (mirrors index.ts:24).
 *
 * IFRAME AWARENESS (fix for "preview never updates" bug, debugged 2026-07-02):
 * This script is registered via block.json's "editorScript" field, which
 * WordPress loads in the TOP admin window's document — NOT inside the
 * Gutenberg block-canvas `<iframe name="editor-canvas">` (WP 6.3+ "iframed
 * editor"). This is confirmed WordPress/Gutenberg behaviour (see e.g.
 * gutenberg#59528, gutenberg#44945, gutenberg#38673) — only block.json's
 * "script" field gets special iframe-injection treatment, and switching to
 * that would load this bundle on published pages too (violates PERF-01 /
 * Pitfall 5). editor.js's mount-point div, however, genuinely lives inside
 * the iframe's DOM (Gutenberg's own React tree portals block content there).
 * So this file must explicitly find the editor-canvas iframe and scan/observe
 * ITS document, with a fallback to the top document for non-iframed editor
 * contexts (older WP, Widgets screen) where a mount point could still appear
 * directly in the top document.
 */
import "../styles.css";
import { createRoot } from "react-dom/client";
import { mountEditorPreview } from "./preview/mountPreview";
import type { KhaveeAvatarConfig } from "./config";

const MOUNT_SELECTOR = "[data-khaveeai-preview-config]";
const EDITOR_CANVAS_IFRAME_SELECTOR = 'iframe[name="editor-canvas"]';

function mountIfNeeded(el: HTMLElement): void {
  if (el.dataset.khaveeaiMounted === "true") return; // idempotency guard
  el.dataset.khaveeaiMounted = "true";

  let config: KhaveeAvatarConfig;
  try {
    config = JSON.parse(
      el.dataset.khaveeaiPreviewConfig ?? "{}"
    ) as KhaveeAvatarConfig;
  } catch {
    // Malformed config JSON must fail gracefully per-element.
    return;
  }

  const root = createRoot(el);
  mountEditorPreview(root, config, el);
}

function scanForMountPoints(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(MOUNT_SELECTOR).forEach(mountIfNeeded);
}

/**
 * Scans `doc` immediately, then watches it for [data-khaveeai-preview-config]
 * nodes added later (Gutenberg renders blocks asynchronously — a one-shot
 * scan misses elements added after this runs).
 *
 * Handles the case where `doc` is a freshly-created iframe document whose
 * `<body>` doesn't exist yet (Gutenberg's Iframe component writes the
 * doctype/head/body in asynchronously after the iframe element is inserted):
 * waits for `doc.body` to appear before attaching the real observer.
 */
function observeDocument(doc: Document): void {
  scanForMountPoints(doc);

  if (!doc.body) {
    const root = doc.documentElement;
    if (!root) return; // Not attachable yet; nothing more we can do here.
    const waitForBody = new MutationObserver(() => {
      if (doc.body) {
        waitForBody.disconnect();
        observeDocument(doc);
      }
    });
    waitForBody.observe(root, { childList: true, subtree: true });
    return;
  }

  const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        // Cross-realm guard: `node` may come from the iframe's own document,
        // whose HTMLElement constructor differs from this script's (top-window)
        // HTMLElement — `instanceof HTMLElement` would always be false for a
        // genuine iframe-realm element. nodeType is a plain number and is
        // realm-agnostic, so check that instead (fix for "preview never
        // updates" bug, debugged 2026-07-02).
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        if (el.matches(MOUNT_SELECTOR)) mountIfNeeded(el as HTMLElement);
        el
          .querySelectorAll<HTMLElement>(MOUNT_SELECTOR)
          .forEach(mountIfNeeded);
      }
    }
  });
  bodyObserver.observe(doc.body, { childList: true, subtree: true });
}

/**
 * Locates the Gutenberg block-canvas iframe (`<iframe name="editor-canvas">`)
 * in the top document this script runs in, and observes ITS document instead
 * of (or in addition to) the top document — see file header for why.
 *
 * The iframe may not exist in the DOM yet when this script first runs
 * (Gutenberg mounts the editor asynchronously), so this waits for it to
 * appear via MutationObserver, then waits for the iframe to finish loading
 * before touching its contentDocument.
 */
function findAndObserveEditorCanvas(): void {
  const iframe = document.querySelector<HTMLIFrameElement>(
    EDITOR_CANVAS_IFRAME_SELECTOR
  );

  if (iframe) {
    const attach = () => {
      if (iframe.contentDocument) observeDocument(iframe.contentDocument);
    };
    // Gutenberg's <Iframe> mounts this element pointing at an empty
    // about:blank shell first, then a React effect assigns a real
    // `blob:` URL as `src` (see @wordpress/block-editor's getIframeSrc) —
    // a genuine navigation that replaces the Document and fires a real
    // `load` event. If we only branch on the CURRENT readyState we can
    // attach() once to the throwaway about:blank document and never learn
    // about the later real navigation (fix for "preview never updates"
    // bug, debugged 2026-07-02). So: always attempt the immediate fast
    // path AND always listen for `load`, since observeDocument/mountIfNeeded
    // are idempotent (the mounted-dataset guard) — a duplicate call once
    // the real document loads is harmless.
    if (iframe.contentDocument && iframe.contentDocument.readyState !== "loading") {
      attach();
    }
    iframe.addEventListener("load", attach, { once: true });
    return;
  }

  const topObserver = new MutationObserver(() => {
    const found = document.querySelector<HTMLIFrameElement>(
      EDITOR_CANVAS_IFRAME_SELECTOR
    );
    if (found) {
      topObserver.disconnect();
      findAndObserveEditorCanvas();
    }
  });
  topObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function init(): void {
  // Non-iframed fallback (older WP, Widgets screen, or any context where a
  // mount point ends up directly in the top document).
  observeDocument(document);
  // Primary path: the iframed post/site editor canvas.
  findAndObserveEditorCanvas();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ⚠️ This file MUST NOT import from "@khaveeai/providers-openai-realtime".
//    See STUDIO-02 safety header above and build.mjs grep assertion.
