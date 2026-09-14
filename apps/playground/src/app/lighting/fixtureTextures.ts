/**
 * fixtureTextures — procedural backdrop fixtures at 16:9, 1:1 and 9:16.
 *
 * Graduated from `lighting-spike/testTexture.ts` per plan 16-06: no binary
 * image assets enter the repo, and the three aspect ratios are exact by
 * construction.
 *
 * Each fixture has visually distinguishable content in every region so a wrong
 * crop is obvious by eye.
 */
import * as THREE from "three";

export interface FixtureOptions {
  aspect: number;
  size?: number;
  label?: string;
}

/**
 * Generates a test pattern with a border, rulers, crosshair and aspect label.
 * If any edge is missing on screen, that edge was cropped — readable off the rulers.
 */
function makeTestPatternDataURL({ aspect, size = 1024, label = "" }: FixtureOptions): string {
  const w = aspect >= 1 ? size : Math.round(size * aspect);
  const h = aspect >= 1 ? Math.round(size / aspect) : size;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Base gradient
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#2b3a67");
  grad.addColorStop(0.5, "#4a6fa5");
  grad.addColorStop(1, "#8e6fa5");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // High-frequency grid
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  const step = Math.round(Math.min(w, h) / 16);
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Outer border
  const inset = Math.round(Math.min(w, h) * 0.02);
  ctx.strokeStyle = "#ff3b6b";
  ctx.lineWidth = Math.max(4, Math.round(Math.min(w, h) * 0.012));
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

  // Edge rulers
  ctx.fillStyle = "#ffd166";
  const tick = Math.round(Math.min(w, h) * 0.03);
  for (let i = 1; i < 10; i++) {
    const x = (w * i) / 10;
    const y = (h * i) / 10;
    ctx.fillRect(x - 1, 0, 2, tick);
    ctx.fillRect(x - 1, h - tick, 2, tick);
    ctx.fillRect(0, y - 1, tick, 2);
    ctx.fillRect(w - tick, y - 1, tick, 2);
  }

  // Centre crosshair
  ctx.strokeStyle = "#00e5a0";
  ctx.lineWidth = Math.max(3, Math.round(Math.min(w, h) * 0.008));
  const cx = w / 2;
  const cy = h / 2;
  const arm = Math.min(w, h) * 0.08;
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy);
  ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm);
  ctx.lineTo(cx, cy + arm);
  ctx.stroke();

  // Corner tags
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(Math.min(w, h) * 0.045)}px monospace`;
  const pad = inset + tick;
  ctx.textBaseline = "top";
  ctx.fillText("TL", pad, pad);
  ctx.textAlign = "right";
  ctx.fillText("TR", w - pad, pad);
  ctx.textBaseline = "bottom";
  ctx.fillText("BR", w - pad, h - pad);
  ctx.textAlign = "left";
  ctx.fillText("BL", pad, h - pad);

  // Aspect label at centre
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `bold ${Math.round(Math.min(w, h) * 0.05)}px monospace`;
  ctx.fillText(label || `${aspect.toFixed(3)}`, cx, cy + arm * 1.4);
  ctx.font = `${Math.round(Math.min(w, h) * 0.03)}px monospace`;
  ctx.fillText(`${w}x${h}`, cx, cy + arm * 1.4 + Math.min(w, h) * 0.06);

  return canvas.toDataURL("image/png");
}

/**
 * Generates a sky-over-ground fixture: saturated upper region, dark lower region.
 * Makes a wrong rim derivation visible — the rim should pick up the upper hue,
 * not the dark ground or a grey average.
 */
function makeSkyGroundDataURL({ aspect, size = 1024, label = "" }: FixtureOptions): string {
  const w = aspect >= 1 ? size : Math.round(size * aspect);
  const h = aspect >= 1 ? Math.round(size / aspect) : size;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Sky gradient — saturated cool blue
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  skyGrad.addColorStop(0, "#4a8fff");
  skyGrad.addColorStop(1, "#2b5a9e");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h * 0.6);

  // Ground — dark, low saturation
  const groundGrad = ctx.createLinearGradient(0, h * 0.6, 0, h);
  groundGrad.addColorStop(0, "#2a3a2e");
  groundGrad.addColorStop(1, "#1a2a1e");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, h * 0.6, w, h * 0.4);

  // Horizon line
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.6);
  ctx.lineTo(w, h * 0.6);
  ctx.stroke();

  // Label
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(Math.min(w, h) * 0.05)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label || "sky/ground", w / 2, h / 2);
  ctx.font = `${Math.round(Math.min(w, h) * 0.03)}px monospace`;
  ctx.fillText(`${w}x${h}`, w / 2, h / 2 + Math.min(w, h) * 0.06);

  return canvas.toDataURL("image/png");
}

export const FIXTURES = {
  landscape_16_9: makeTestPatternDataURL({ aspect: 16 / 9, label: "16:9" }),
  square_1_1: makeTestPatternDataURL({ aspect: 1, label: "1:1" }),
  portrait_9_16: makeTestPatternDataURL({ aspect: 9 / 16, label: "9:16" }),
  sky_ground: makeSkyGroundDataURL({ aspect: 16 / 9, label: "sky/ground" }),
} as const;
