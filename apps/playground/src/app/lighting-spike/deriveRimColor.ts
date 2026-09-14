/**
 * deriveRimColor — SPIKE 007 (rim-from-background). Throwaway.
 *
 * CONTEXT D-05 locks "the rim light derives its colour from the background".
 * It does NOT say how, and that gap is the whole spike: Phase 15 already learned
 * once that deriving a rim from an average produces grey. R1's original bug was
 * taking the tint from `litFactor`, which VRoid leaves white — the fix was to
 * sample the base texture instead. Averaging a whole background photo is the
 * same class of mistake one level up: average enough different colours together
 * and you get mud, whatever the source was.
 *
 * So this module offers several derivations and the spike compares them. Pure
 * functions over RGBA bytes, no canvas or three.js import, so the arithmetic can
 * be driven headlessly against synthetic images whose right answer is known.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type DerivationId = "mean" | "saturation-weighted" | "dominant" | "upper-region";

export const DERIVATIONS: { id: DerivationId; label: string; rationale: string }[] = [
  { id: "mean", label: "mean", rationale: "what averageTextureColor already does — the naive choice, included to be beaten" },
  { id: "saturation-weighted", label: "saturation-weighted", rationale: "weight each pixel by its own saturation, so a small vivid area outvotes a large drab one" },
  { id: "dominant", label: "dominant", rationale: "coarse colour histogram, most-populated bucket — representative rather than averaged" },
  { id: "upper-region", label: "upper region", rationale: "top third only; in most photographs that is sky/ceiling, i.e. where the light comes from" },
];

/** HSV saturation of a single pixel, 0-1. */
function pixelSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

interface ImageData8 {
  data: Uint8Array | Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/** Plain mean of every sufficiently-opaque pixel. */
function meanColor({ data }: ImageData8): RGB {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  return n === 0 ? { r: 0, g: 0, b: 0 } : { r: r / n, g: g / n, b: b / n };
}

/**
 * Mean weighted by each pixel's own saturation.
 *
 * The point: a background that is 70% grey wall and 30% red neon should yield a
 * red-ish rim, because the red is the light with a colour in it. A plain mean
 * yields a slightly-warm grey, which is the "grey rim" failure again.
 *
 * Falls back to the plain mean when the image is genuinely achromatic — with
 * zero total weight there is nothing to prefer, and inventing a hue is the
 * failure mode Phase 15's achromatic branch exists to prevent.
 */
function saturationWeightedColor(img: ImageData8): RGB {
  const { data } = img;
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const s = pixelSaturation(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    r += data[i] * s; g += data[i + 1] * s; b += data[i + 2] * s; w += s;
  }
  if (w < 1e-6) return meanColor(img);
  return { r: r / w, g: g / w, b: b / w };
}

/** Most-populated bucket of a coarse RGB histogram (4 bits per channel). */
function dominantColor({ data }: ImageData8): RGB {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; e.n++;
    buckets.set(key, e);
  }
  let best: { r: number; g: number; b: number; n: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return best ? { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n } : { r: 0, g: 0, b: 0 };
}

/** Saturation-weighted mean restricted to the top third of the image. */
function upperRegionColor(img: ImageData8): RGB {
  const rowBytes = img.width * 4;
  const cutoff = Math.max(1, Math.floor(img.height / 3)) * rowBytes;
  return saturationWeightedColor({
    data: Array.prototype.slice.call(img.data, 0, cutoff),
    width: img.width,
    height: Math.max(1, Math.floor(img.height / 3)),
  });
}

export function deriveRimColor(img: ImageData8, how: DerivationId): RGB {
  if (how === "mean") return meanColor(img);
  if (how === "saturation-weighted") return saturationWeightedColor(img);
  if (how === "dominant") return dominantColor(img);
  return upperRegionColor(img);
}

/** HSV saturation of a derived colour — the headline number for comparing derivations. */
export function saturationOf({ r, g, b }: RGB): number {
  return pixelSaturation(r / 255, g / 255, b / 255);
}

export function toHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
