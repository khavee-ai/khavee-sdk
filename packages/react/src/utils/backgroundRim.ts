import { useEffect, useState } from "react";
import { deriveRimColor, toHex } from "./deriveRimColor";
import type { AvatarBackground } from "./AvatarBackdrop";
import type { LightRigOptions, LightSpec } from "./renderQuality";

/**
 * backgroundRim - Graduated from spike 007 (rim-from-background).
 *
 * Derives a rim-light colour from a background (flat COLOR or uploaded IMAGE)
 * and provides a helper to merge that derived colour into a light rig's rim
 * spec without overriding an explicit caller-specified colour.
 *
 * **Sampling bound:** Image readback is downsampled to a 128px long edge before
 * derivation (T-16-12 bounded-work mitigation). Consequence: a saturated region
 * smaller than roughly 1% of the frame is averaged away by the downsample. This
 * is a documented limit, not a bug.
 *
 * **Known limit (accepted, not tuned against):** A background split evenly
 * between two opposing saturated hues (e.g. a perfect red/cyan checkerboard)
 * has no single correct rim colour. This edge case is documented here rather
 * than handled, because tuning for it would sacrifice the common case (natural
 * photos with a single dominant light source).
 */

// Re-use the validateUrl helper from AvatarBackdrop to keep the allowlist DRY.
const ALLOWED_SCHEMES = ["http:", "https:", "blob:", "data:"];

/**
 * Validate a URL against the allowlist and data: media-type constraint.
 * Returns true if valid, false otherwise.
 */
function isValidUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return false;
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return false;
  }

  // data: URLs must have an image/ media type.
  if (parsed.protocol === "data:") {
    const match = /^data:([^;,]+)/.exec(url);
    if (!match || !match[1].startsWith("image/")) {
      return false;
    }
  }

  return true;
}

/** Maximum image dimensions (width * height) before rejection. */
const MAX_MEGAPIXELS = 50_000_000;

/** Maximum long-edge dimension for readback canvas (T-16-12 bounded-work). */
const MAX_READBACK_DIM = 128;

/**
 * useBackgroundRimColor - Derive a rim-light colour from the supplied background.
 *
 * @param background - Background source (COLOR or IMAGE), or undefined for no derivation.
 * @param onError - Reported on URL validation failure, load failure, tainted-canvas SecurityError, or oversized image.
 * @returns Hex colour string (`#rrggbb`), or undefined when derivation is absent or failed.
 *
 * **COLOR case:** Returns `background.value` directly with no canvas work and no
 * effect. Spike 007 proved every derivation agrees trivially on a flat colour.
 *
 * **IMAGE case:** Loads the image, downsamples to ≤128px, reads pixels, derives
 * via saturation-weighted upper-region mean. Failures (rejected URL, load error,
 * CORS-blocked readback) report through `onError` and leave the state undefined.
 *
 * **Server-side safety:** Guards on `typeof document === "undefined"` so a
 * server-rendered import of this package does not throw.
 */
export function useBackgroundRimColor(
  background: AvatarBackground | undefined,
  onError?: (error: Error) => void,
): string | undefined {
  const [derivedColor, setDerivedColor] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Guard against server-side execution.
    if (typeof document === "undefined") {
      return;
    }

    // No background → no derivation.
    if (!background) {
      setDerivedColor(undefined);
      return;
    }

    // COLOR background → return the colour directly (spike 007: all derivations
    // agree trivially on a flat colour).
    if (background.type === "color") {
      setDerivedColor(background.value);
      return;
    }

    // IMAGE background → load, downsample, readback, derive.
    const { url } = background;

    // Validate URL scheme before attempting load.
    if (!isValidUrl(url)) {
      const err = new Error(`Invalid or unsupported URL: ${url}`);
      onError?.(err);
      return;
    }

    let cancelled = false;

    const img = new Image();
    // Set crossOrigin to enable pixel readback (T-16-12).
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (cancelled) return;

      // Reject oversized images to prevent exhaustion (T-16-13).
      if (img.width * img.height > MAX_MEGAPIXELS) {
        const err = new Error(
          `Image too large: ${img.width}×${img.height} exceeds ${MAX_MEGAPIXELS} pixels`,
        );
        onError?.(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      try {
        // Downsample to ≤128px long edge (preserving aspect, minimum 1px per axis).
        const longEdge = Math.max(img.width, img.height);
        const scale = Math.min(1, MAX_READBACK_DIM / longEdge);
        const w = Math.max(1, Math.floor(img.width * scale));
        const h = Math.max(1, Math.floor(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          const err = new Error("Failed to get 2D context for rim color sampling");
          onError?.(err instanceof Error ? err : new Error(String(err)));
          return;
        }

        ctx.drawImage(img, 0, 0, w, h);

        // getImageData throws SecurityError on a tainted canvas (CORS failure).
        const imageData = ctx.getImageData(0, 0, w, h);

        // Derive rim colour via saturation-weighted upper-region mean (spike 007).
        const rgb = deriveRimColor({ data: imageData.data, width: w, height: h });
        if (rgb) {
          setDerivedColor(toHex(rgb));
        } else {
          // Null result (no opaque pixels) leaves the state undefined.
          setDerivedColor(undefined);
        }
      } catch (error) {
        // Normalize error before reporting (repo pattern).
        const err =
          error instanceof Error ? error : new Error(String(error));
        onError?.(err);
        setDerivedColor(undefined);
      }
    };

    img.onerror = () => {
      if (cancelled) return;
      const err = new Error(`Failed to load image: ${url}`);
      onError?.(err instanceof Error ? err : new Error(String(err)));
      setDerivedColor(undefined);
    };

    img.src = url;

    // Cleanup: cancel stale loads so a late-resolving image for a previous URL
    // cannot overwrite the current one.
    return () => {
      cancelled = true;
    };
  }, [
    background?.type,
    background?.type === "color" ? background.value : null,
    background?.type === "image" ? background.url : null,
    onError,
  ]);

  return derivedColor;
}

/**
 * mergeRimColor - Merge a derived rim colour into a lighting config without
 * overriding an explicit caller-specified `rim.color`.
 *
 * @param lighting - Caller's lighting config, or undefined for SDK defaults.
 * @param derived - Derived rim colour from `useBackgroundRimColor`, or undefined.
 * @returns A new `LightRigOptions` object with `rim.color` set to `derived`,
 *   unless the caller already specified `rim.color` explicitly (in which case
 *   the caller's value wins). Returns `lighting` unchanged when `derived` is
 *   undefined.
 *
 * **Caller intent always wins over derivation:** If the caller's `lighting` prop
 * contains an explicit `rim.color`, it is kept verbatim. A bare numeric `rim`
 * (intensity shorthand) keeps its intensity and gains the derived colour.
 */
export function mergeRimColor(
  lighting: LightRigOptions | undefined,
  derived: string | undefined,
): LightRigOptions | undefined {
  // No derived color → return lighting unchanged.
  if (!derived) {
    return lighting;
  }

  // No lighting config → create one with only the derived rim color.
  if (!lighting) {
    return {
      rim: { color: derived },
    };
  }

  // Lighting config exists → normalize rim and merge derived color.
  const { rim } = lighting;

  // If rim is not set, add it with the derived color.
  if (rim === undefined) {
    return {
      ...lighting,
      rim: { color: derived },
    };
  }

  // If rim is a bare number (intensity shorthand), expand it and add the derived color.
  if (typeof rim === "number") {
    return {
      ...lighting,
      rim: { intensity: rim, color: derived },
    };
  }

  // rim is a LightSpec object.
  // If it already has an explicit color, do NOT override it (caller intent wins).
  if (rim.color !== undefined) {
    return lighting;
  }

  // rim is a LightSpec without color → add the derived color.
  return {
    ...lighting,
    rim: { ...rim, color: derived },
  };
}
