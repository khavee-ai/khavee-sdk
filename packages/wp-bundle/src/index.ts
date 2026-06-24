/**
 * packages/wp-bundle/src/index.ts
 *
 * Self-mounting bundle entry point. Scans the front-end DOM for every
 * `[data-khaveeai-config]` mount point (rendered server-side by
 * AvatarRenderer::render(), plans 02/04) and mounts one independent
 * KhaveeProvider+avatar tree into each. Idempotent — re-running mountAll()
 * (e.g. if the script somehow loads twice) skips already-mounted elements.
 *
 * Per D-01: this module never calls connect() itself. It only renders the
 * idle tree; the first connect() call happens inside ClickToTalkOverlay's
 * click handler, never here and never on load.
 */
import "../styles.css";
import { createRoot } from "react-dom/client";
import { mountAvatarInstance } from "./mount";
import type { KhaveeAvatarConfig } from "./mount";

function mountAll(): void {
  const roots = document.querySelectorAll<HTMLElement>(
    "[data-khaveeai-config]"
  );
  roots.forEach((el) => {
    if (el.dataset.khaveeaiMounted === "true") return; // idempotency guard
    el.dataset.khaveeaiMounted = "true";

    let config: KhaveeAvatarConfig;
    try {
      config = JSON.parse(el.dataset.khaveeaiConfig ?? "{}") as KhaveeAvatarConfig;
    } catch {
      // Malformed config JSON must fail gracefully per-element, not throw
      // uncaught and break the rest of the page (T-08-04, accepted DoS risk).
      return;
    }

    const root = createRoot(el);
    mountAvatarInstance(root, config);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll);
} else {
  mountAll();
}
