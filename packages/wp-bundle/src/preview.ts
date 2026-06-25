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

function mountAllPreviews(): void {
  const roots = document.querySelectorAll<HTMLElement>(
    "[data-khaveeai-preview-config]"
  );
  roots.forEach((el) => {
    if (el.dataset.khaveeaiMounted === "true") return; // idempotency guard (mirror index.ts:24)
    el.dataset.khaveeaiMounted = "true";

    let config: KhaveeAvatarConfig;
    try {
      config = JSON.parse(
        el.dataset.khaveeaiPreviewConfig ?? "{}"
      ) as KhaveeAvatarConfig;
    } catch {
      // Malformed config JSON must fail gracefully per-element, not throw
      // uncaught and break the rest of the editor page (mirrors index.ts:30-34).
      return;
    }

    const root = createRoot(el);
    mountEditorPreview(root, config, el);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAllPreviews);
} else {
  mountAllPreviews();
}

// ⚠️ This file MUST NOT import from "@khaveeai/providers-openai-realtime".
//    See STUDIO-02 safety header above and build.mjs grep assertion.
