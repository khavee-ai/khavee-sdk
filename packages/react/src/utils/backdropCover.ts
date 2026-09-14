/**
 * backdropCover - Graduated from spike 004 (backdrop-plane-dof).
 *
 * Pure arithmetic for sizing and cropping an in-canvas backdrop plane to
 * reproduce CSS `background-size: cover` or `background-size: contain`. These
 * functions compute the world-space plane dimensions and texture repeat/offset
 * needed to fill a perspective camera's view at a given distance, matching the
 * image's aspect ratio while center-cropping overflow (cover) or letterboxing
 * to fit (contain).
 *
 * Spike 004 validated this arithmetic headlessly — the 31.6% visible fraction
 * for a 9:16 image against a 16:9 viewport under cover mode is a measured fact,
 * not a guess. The degenerate-input guard ensures non-finite or non-positive
 * dimensions fall back to a no-crop layout instead of propagating NaN through
 * three.js (which renders NaN-scaled meshes as invisible, with no error).
 *
 * No `three` import: this module is kept pure so it can be tested under
 * `environment: "node"` (see `backdropCover.test.ts` and `vitest.config.ts`),
 * just like `mtoonRepair.ts`. Plans 16-03 and 16-04 consume these functions to
 * build the actual backdrop mesh and texture material.
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
 * @param fovDegrees - Vertical field of view in degrees (three.js PerspectiveCamera.fov).
 * @param cameraAspect - Camera aspect ratio (width / height).
 * @param distance - Distance from camera to plane, in world units.
 * @returns Plane dimensions that exactly fill the camera's frustum at this distance.
 *
 * **Why vertical FOV matters:** three.js `PerspectiveCamera.fov` is the VERTICAL
 * field of view in degrees, so height is the primary derivation and width follows
 * from aspect. Getting this backwards (treating `fov` as horizontal) is the classic
 * bug: it looks correct at 16:9 and breaks on portrait.
 */
export function planeSizeForDistance(
  fovDegrees: number,
  cameraAspect: number,
  distance: number,
): ViewportSize {
  // Guard against degenerate inputs that would produce NaN.
  if (
    !isFinite(fovDegrees) ||
    !isFinite(cameraAspect) ||
    !isFinite(distance) ||
    fovDegrees <= 0 ||
    cameraAspect <= 0 ||
    distance <= 0
  ) {
    // Fall back to a unit square rather than propagating NaN.
    return { width: 1, height: 1 };
  }

  const height = 2 * distance * Math.tan((fovDegrees * Math.PI) / 360);
  return { width: height * cameraAspect, height };
}

/** Texture crop expressed the way three.js wants it (repeat/offset). */
export interface CoverTransform {
  /** Texture repeat (scale) on each axis. <= 1 crops, > 1 tiles. */
  repeat: [number, number];
  /** Texture offset (translation) on each axis, in [0, 1) texture space. */
  offset: [number, number];
}

/**
 * Texture `repeat`/`offset` reproducing CSS `background-size: cover` —
 * fill the target, preserve the image's aspect ratio, center-crop the overflow.
 *
 * @param planeAspect - Aspect ratio of the target plane (width / height).
 * @param imageAspect - Aspect ratio of the source image (width / height).
 * @returns Repeat <= 1 on exactly one axis (the cropped one) and exactly 1 on
 *   the other. Both are 1 only when the aspects match.
 */
export function coverTransform(
  planeAspect: number,
  imageAspect: number,
): CoverTransform {
  // Degenerate input guard: zero-height container mid-layout, texture not yet
  // loaded, or other non-finite values. Fall back to "no crop" rather than
  // emitting NaN, which three.js would silently turn into an invisible texture.
  if (
    !isFinite(planeAspect) ||
    !isFinite(imageAspect) ||
    planeAspect <= 0 ||
    imageAspect <= 0
  ) {
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
 *
 * @param planeAspect - Aspect ratio of the target plane (width / height).
 * @param imageAspect - Aspect ratio of the source image (width / height).
 * @returns Fraction in [0, 1]. 1 means nothing was cropped. A very low number
 *   means the customer's image is being aggressively cropped and they will
 *   likely complain about what got cut off.
 */
export function visibleFraction(
  planeAspect: number,
  imageAspect: number,
): number {
  const { repeat } = coverTransform(planeAspect, imageAspect);
  return repeat[0] * repeat[1];
}

/** Background fit mode: cover or contain. */
export type BackgroundFit = "cover" | "contain";

/** Complete backdrop layout: plane size, texture transform, and diagnostic visible fraction. */
export interface BackdropLayout {
  /** Plane width in world units. */
  planeWidth: number;
  /** Plane height in world units. */
  planeHeight: number;
  /** Texture repeat (scale) on each axis. */
  repeat: [number, number];
  /** Texture offset (translation) on each axis. */
  offset: [number, number];
  /** Visible fraction of the source image, in [0, 1]. */
  visibleFraction: number;
}

/**
 * Compute the complete backdrop layout for a given camera, distance, and image.
 *
 * @param opts.fovDegrees - Camera vertical FOV in degrees.
 * @param opts.cameraAspect - Camera aspect ratio (width / height).
 * @param opts.distance - Distance from camera to backdrop plane, in world units.
 * @param opts.imageAspect - Source image aspect ratio (width / height).
 * @param opts.fit - "cover" (fill, center-crop overflow) or "contain" (fit, letterbox).
 * @returns Complete layout: plane size, texture repeat/offset, visible fraction.
 *
 * **"contain" sizing rule:** Under `contain`, the texture is not cropped
 * (`repeat [1,1]`, `offset [0,0]`), and the *plane* shrinks to the largest rect
 * of the image's aspect that fits inside the frustum rect. The alternative —
 * keeping a frustum-sized plane and letterboxing via `repeat > 1` — is wrong
 * under `ClampToEdgeWrapping`, which stretches the edge pixel across the
 * letterbox instead of leaving it empty.
 */
export function backdropLayout(opts: {
  fovDegrees: number;
  cameraAspect: number;
  distance: number;
  imageAspect: number;
  fit: BackgroundFit;
}): BackdropLayout {
  const { fovDegrees, cameraAspect, distance, imageAspect, fit } = opts;

  // Apply the same degenerate-input guard as the other functions.
  const hasDegenerate =
    !isFinite(fovDegrees) ||
    !isFinite(cameraAspect) ||
    !isFinite(distance) ||
    !isFinite(imageAspect) ||
    fovDegrees <= 0 ||
    cameraAspect <= 0 ||
    distance <= 0 ||
    imageAspect <= 0;

  if (hasDegenerate) {
    // Fall back to a finite no-crop layout.
    return {
      planeWidth: 1,
      planeHeight: 1,
      repeat: [1, 1],
      offset: [0, 0],
      visibleFraction: 1,
    };
  }

  const frustumSize = planeSizeForDistance(fovDegrees, cameraAspect, distance);

  if (fit === "cover") {
    // Plane fills the frustum exactly; texture is center-cropped.
    const transform = coverTransform(cameraAspect, imageAspect);
    return {
      planeWidth: frustumSize.width,
      planeHeight: frustumSize.height,
      repeat: transform.repeat,
      offset: transform.offset,
      visibleFraction: visibleFraction(cameraAspect, imageAspect),
    };
  }

  // fit === "contain"
  // Texture is uncropped; plane shrinks to fit the image's aspect inside the frustum.
  const frustumAspect = cameraAspect;

  let planeWidth: number;
  let planeHeight: number;

  if (imageAspect > frustumAspect) {
    // Image is wider than frustum — constrain by width.
    planeWidth = frustumSize.width;
    planeHeight = planeWidth / imageAspect;
  } else {
    // Image is taller than (or same aspect as) frustum — constrain by height.
    planeHeight = frustumSize.height;
    planeWidth = planeHeight * imageAspect;
  }

  return {
    planeWidth,
    planeHeight,
    repeat: [1, 1],
    offset: [0, 0],
    visibleFraction: 1,
  };
}
