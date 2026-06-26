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
 */
import "../styles.css";
import { createRoot } from "react-dom/client";
import { mountEditorPreview } from "./preview/mountPreview";
import type { KhaveeAvatarConfig } from "./config";

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

function mountAllPreviews(): void {
  document
    .querySelectorAll<HTMLElement>("[data-khaveeai-preview-config]")
    .forEach(mountIfNeeded);
}

// Gutenberg renders blocks asynchronously (React 18 createRoot schedules
// its initial render after DOMContentLoaded). A one-shot DOMContentLoaded
// scan misses elements added after the event fires. Watch the entire body
// subtree for new [data-khaveeai-preview-config] nodes so the preview
// mounts regardless of when Gutenberg flushes its first render.
function startBodyObserver(): void {
  const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches("[data-khaveeai-preview-config]")) mountIfNeeded(node);
        node
          .querySelectorAll<HTMLElement>("[data-khaveeai-preview-config]")
          .forEach(mountIfNeeded);
      }
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    startBodyObserver();
    mountAllPreviews(); // catch elements already in DOM at DOMContentLoaded
  });
} else {
  startBodyObserver();
  mountAllPreviews();
}

// ⚠️ This file MUST NOT import from "@khaveeai/providers-openai-realtime".
//    See STUDIO-02 safety header above and build.mjs grep assertion.
