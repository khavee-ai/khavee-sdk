/**
 * measureSaturation.ts — SPIKE 003 observability layer.
 *
 * Tone mapping changes brightness AND saturation at the same time, so a naked
 * A/B is easy to misread as "the brighter one is better". This samples the
 * rendered canvas and reports the two separately, so the choice can be made on
 * a number instead of an impression.
 *
 * Only pixels the avatar actually covers are counted: the R3F canvas is
 * transparent, so alpha masks out the page background.
 */

export interface FrameStats {
  /** Mean HSV saturation over covered pixels, 0-1. Higher = more colourful. */
  meanSaturation: number;
  /** Mean HSV value (brightness) over covered pixels, 0-1. */
  meanValue: number;
  /** Mean absolute deviation of value — a crude read on shading contrast. */
  valueSpread: number;
  /** How many pixels the avatar covered (sanity check that anything rendered). */
  coveredPixels: number;
}

/**
 * Sample a WebGL canvas. Requires the canvas to have been created with
 * `preserveDrawingBuffer: true`, otherwise the drawing buffer is already
 * cleared by the time this runs and every pixel reads as transparent.
 */
export function measureCanvas(canvas: HTMLCanvasElement): FrameStats | null {
  const w = Math.min(canvas.width, 512);
  const h = Math.min(canvas.height, 512);
  if (w === 0 || h === 0) return null;

  const scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, w, h);

  const { data } = ctx.getImageData(0, 0, w, h);
  let covered = 0;
  let sumS = 0;
  let sumV = 0;
  const values: number[] = [];

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // background
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const s = max === 0 ? 0 : (max - min) / max;
    covered++;
    sumS += s;
    sumV += max;
    values.push(max);
  }

  if (covered === 0) return null;
  const meanValue = sumV / covered;
  const spread = values.reduce((acc, v) => acc + Math.abs(v - meanValue), 0) / covered;

  return {
    meanSaturation: sumS / covered,
    meanValue,
    valueSpread: spread,
    coveredPixels: covered,
  };
}
