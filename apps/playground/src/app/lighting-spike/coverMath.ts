/**
 * coverMath — SPIKE 004 (backdrop-plane-dof). Throwaway.
 *
 * The two pieces of arithmetic that decide whether an in-canvas backdrop plane
 * can reproduce CSS `background-size: cover`:
 *
 *   1. How big must a plane be, at distance D from a perspective camera, to
 *      exactly fill the viewport? (Must be recomputed on every resize, because
 *      the camera's aspect changes.)
 *   2. Given that plane and an image of some other aspect ratio, how must the
 *      texture be cropped so the image covers the plane without distortion?
 *
 * Kept as a pure module with no three.js import so it can be exercised
 * headlessly (see `verify-cover-math.mjs` in the spike directory) — the
 * arithmetic is a FACT question, separate from the "does it look right"
 * question the page answers.
 */

/** Size of the camera frustum's cross-section at a given distance. */
export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * World-space size a plane must be to exactly fill a perspective camera's
 * view at `distance`.
 *
 * three.js `PerspectiveCamera.fov` is the VERTICAL field of view in degrees,
 * so height is the primary derivation and width follows from aspect. Getting
 * this backwards is the classic bug: it looks correct at 16:9 and breaks on
 * portrait.
 */
export function planeSizeForDistance(
  fovDegrees: number,
  cameraAspect: number,
  distance: number,
): ViewportSize {
  const height = 2 * distance * Math.tan((fovDegrees * Math.PI) / 360);
  return { width: height * cameraAspect, height };
}

/** A texture crop expressed the way three.js wants it. */
export interface CoverTransform {
  repeat: [number, number];
  offset: [number, number];
}

/**
 * Texture `repeat`/`offset` reproducing CSS `background-size: cover` —
 * fill the target, preserve the image's aspect ratio, centre-crop the overflow.
 *
 * Returns repeat <= 1 on exactly one axis (the cropped one) and exactly 1 on
 * the other. Both are 1 only when the aspects match.
 */
export function coverTransform(
  planeAspect: number,
  imageAspect: number,
): CoverTransform {
  if (!isFinite(planeAspect) || !isFinite(imageAspect) || planeAspect <= 0 || imageAspect <= 0) {
    // Degenerate input (zero-height container mid-layout, texture not yet
    // loaded). Fall back to "no crop" rather than emitting NaN, which three.js
    // would silently turn into an invisible texture.
    return { repeat: [1, 1], offset: [0, 0] };
  }

  if (imageAspect > planeAspect) {
    // Image is relatively wider — crop its left/right.
    const r = planeAspect / imageAspect;
    return { repeat: [r, 1], offset: [(1 - r) / 2, 0] };
  }
  // Image is relatively taller — crop its top/bottom.
  const r = imageAspect / planeAspect;
  return { repeat: [1, r], offset: [0, (1 - r) / 2] };
}

/**
 * The visible portion of the source image, as a fraction of its area.
 * 1 means nothing was cropped. Useful as a diagnostic readout — a very low
 * number means the customer's image is being aggressively cropped and they
 * will likely complain about what got cut off.
 */
export function visibleFraction(planeAspect: number, imageAspect: number): number {
  const { repeat } = coverTransform(planeAspect, imageAspect);
  return repeat[0] * repeat[1];
}
