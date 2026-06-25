/**
 * packages/wp-bundle/src/preview/mountPreview.tsx — STUDIO-02 preview mount.
 *
 * Exports `mountEditorPreview(root, initialConfig, hostEl)` which mounts
 * <PreviewScene> into a React root and sets up a MutationObserver on hostEl
 * to re-sync config whenever data-khaveeai-preview-config changes.
 *
 * MutationObserver approach (Pitfall 3 — WebGL context leak avoidance):
 * Gutenberg rewrites data-khaveeai-preview-config on every setAttributes call.
 * Instead of unmounting/remounting the React root (which creates a new WebGL
 * context each time), the observer pushes fresh config into React state.
 * This keeps a single Canvas/WebGL context alive for the lifetime of the block.
 */
import React, { useState, useEffect } from "react";
import type { Root } from "react-dom/client";
import type { KhaveeAvatarConfig } from "../config";
import { PreviewScene } from "./PreviewScene";

// ── PreviewHost ────────────────────────────────────────────────────────────────

interface PreviewHostProps {
  initialConfig: KhaveeAvatarConfig;
  hostEl: HTMLElement;
}

/**
 * Internal component holding the live config state and the MutationObserver.
 * Renders <PreviewScene> with the current config; when Gutenberg rewrites
 * data-khaveeai-preview-config, the observer calls setConfig which re-renders
 * PreviewScene without tearing down the React root or the WebGL context.
 */
function PreviewHost({ initialConfig, hostEl }: PreviewHostProps) {
  const [config, setConfig] = useState<KhaveeAvatarConfig>(initialConfig);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const raw = hostEl.dataset.khaveeaiPreviewConfig;
      if (!raw) return;
      try {
        setConfig(JSON.parse(raw) as KhaveeAvatarConfig);
      } catch {
        // Malformed JSON from a rapid attribute update — keep the last valid config.
      }
    });

    observer.observe(hostEl, {
      attributes: true,
      // Only watch the preview-config attribute; ignore class/style/data-* churn.
      attributeFilter: ["data-khaveeai-preview-config"],
    });

    return () => observer.disconnect();
  }, [hostEl]);

  return <PreviewScene config={config} />;
}

// ── mountEditorPreview ─────────────────────────────────────────────────────────

/**
 * Mounts the editor preview into the given React root.
 *
 * Uses a MutationObserver on hostEl to detect data-khaveeai-preview-config
 * attribute changes and push fresh config into React state — this avoids
 * unmounting/remounting the React root on every Gutenberg setAttributes call,
 * which would leak WebGL contexts (RESEARCH Pitfall 3).
 *
 * The hostEl argument is the same <div data-khaveeai-preview-config> that
 * preview.ts passed to createRoot(el). The MutationObserver has a stable node
 * to watch for the lifetime of the block editor session.
 *
 * @param root          - React root created by createRoot(el) in preview.ts.
 * @param initialConfig - The initial parsed KhaveeAvatarConfig.
 * @param hostEl        - The mount-point HTMLElement; observed for attribute changes.
 * @returns An object with an unmount() method for clean teardown.
 */
export function mountEditorPreview(
  root: Root,
  initialConfig: KhaveeAvatarConfig,
  hostEl: HTMLElement
): { unmount: () => void } {
  root.render(
    <PreviewHost initialConfig={initialConfig} hostEl={hostEl} />
  );

  return {
    unmount: () => {
      root.unmount();
    },
  };
}
