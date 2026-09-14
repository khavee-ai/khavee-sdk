/**
 * deriveRimColor - Graduated from spike 007 (rim-from-background).
 *
 * Derives a rim-light colour from a background image by computing a
 * saturation-weighted mean of the top third of the image. This is the
 * upper-region derivation validated by spike 007's measured comparison:
 * it beats a plain mean (which reproduces Phase 15's grey-rim defect) and
 * beats the dominant-colour histogram approach (which picks the wrong half of
 * a sky/ground photo).
 *
 * **Why upper-region:** In most photographs the top third is sky or ceiling —
 * i.e. where the light comes from. Weighting by saturation ensures a small
 * vivid region (e.g. a sunset) outvotes a large drab one (e.g. a grey wall).
 *
 * **Known limit (accepted, not tuned against):** A background split evenly
 * between two opposing saturated hues (e.g. a perfect red/cyan checkerboard)
 * defeats every derivation, including this one. That edge case is documented
 * here rather than handled, because tuning for it would sacrifice the common
 * case (natural photos with a single dominant light source).
 *
 * **Achromatic guarantee:** When the sampled region has zero total saturation
 * weight (genuinely grey input), the result is the plain mean of that region,
 * so no hue is invented. This mirrors Phase 15's MTOON-03 achromatic branch
 * and is explicitly tested, because WR-02 showed this class of guarantee
 * failing silently in shipped code.
 *
 * No `three` import: this module is kept pure so it can be tested under
 * `environment: "node"` (see `deriveRimColor.test.ts` and `vitest.config.ts`).
 * Plan 16-04 consumes this function to derive rim colour from a canvas-sampled
 * background texture (downsampled to ≤128px before readback, a bounded-work
 * mitigation documented in that plan's threat register).
 */

/** RGB colour in 0-255 range. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Image pixel data + dimensions. */
export interface SampledImage {
  data: Uint8Array | Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/**
 * HSV saturation of a single pixel, in [0, 1].
 *
 * @param r - Red channel, in [0, 1].
 * @param g - Green channel, in [0, 1].
 * @param b - Blue channel, in [0, 1].
 * @returns Saturation in [0, 1]. 0 means achromatic (grey/black/white).
 */
function pixelSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Plain mean of every sufficiently-opaque pixel in the given region.
 *
 * @param data - Pixel data (RGBA, 4 bytes per pixel).
 * @param length - Number of bytes to process (not pixels - this is the buffer length).
 * @returns Mean RGB, or null if no opaque pixels exist.
 */
function meanColor(
  data: Uint8Array | Uint8ClampedArray | number[],
  length: number,
): RGB | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < length; i += 4) {
    if (data[i + 3] < 128) continue; // Skip low-alpha pixels
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return n === 0 ? null : { r: r / n, g: g / n, b: b / n };
}

/**
 * Saturation-weighted mean of the given region.
 *
 * Each pixel contributes to the mean proportional to its own saturation, so a
 * small vivid area outvotes a large drab one. Falls back to the plain mean when
 * the image is genuinely achromatic (zero total weight) — with nothing to
 * prefer, inventing a hue would reproduce Phase 15's grey-rim failure mode.
 *
 * @param data - Pixel data (RGBA, 4 bytes per pixel).
 * @param length - Number of bytes to process.
 * @returns Saturation-weighted mean RGB, or null if no opaque pixels exist.
 */
function saturationWeightedColor(
  data: Uint8Array | Uint8ClampedArray | number[],
  length: number,
): RGB | null {
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i + 3 < length; i += 4) {
    if (data[i + 3] < 128) continue; // Skip low-alpha pixels
    const s = pixelSaturation(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    r += data[i] * s;
    g += data[i + 1] * s;
    b += data[i + 2] * s;
    w += s;
  }

  // Achromatic fallback: when total saturation weight is negligible, return
  // the plain mean so a grey input stays grey and no hue is invented.
  if (w < 1e-6) {
    return meanColor(data, length);
  }

  return { r: r / w, g: g / w, b: b / w };
}

/**
 * Derive a rim-light colour from a background image.
 *
 * Computes a saturation-weighted mean of the top third of the image. Pixels
 * with alpha < 128 are excluded. Returns `null` (not black) when no
 * sufficiently-opaque pixel exists, so the caller can fall back to a static
 * default rim colour instead of silently shipping a black rim (which looks like
 * "the rim feature did not work").
 *
 * @param img - Sampled image data (RGBA, 4 bytes per pixel).
 * @returns Derived RGB colour in 0-255 range, or `null` if no data to derive from.
 */
export function deriveRimColor(img: SampledImage): RGB | null {
  const { data, width, height } = img;

  // Guard against zero-dimension images.
  if (width <= 0 || height <= 0) {
    return null;
  }

  // Compute byte index bound for the top third of the image.
  // Iterate the top third in place (no buffer copy) to avoid allocating a large
  // slice when the input is a high-res Uint8ClampedArray.
  const rowBytes = width * 4;
  const topThirdRows = Math.max(1, Math.floor(height / 3));
  const topThirdLength = topThirdRows * rowBytes;

  return saturationWeightedColor(data, topThirdLength);
}

/**
 * HSV saturation of a derived colour — the headline number for comparing
 * derivations or asserting achromatic guarantees.
 *
 * @param rgb - RGB colour in 0-255 range.
 * @returns Saturation in [0, 1]. 0 means achromatic (grey).
 */
export function saturationOf({ r, g, b }: RGB): number {
  return pixelSaturation(r / 255, g / 255, b / 255);
}

/**
 * Convert RGB to hex string.
 *
 * @param rgb - RGB colour in 0-255 range (out-of-range values are clamped).
 * @returns Hex string in `#rrggbb` format.
 */
export function toHex({ r, g, b }: RGB): string {
  const h = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
